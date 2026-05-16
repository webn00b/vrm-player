<script setup lang="ts">
/**
 * Vue replacement for the imperative `mountQueue()` in src/ui.ts.
 *
 * Feature parity with the vanilla version:
 *   - Push/remove/setActive/reorder via imperative `defineExpose` API
 *     (matches the legacy QueueHandle shape so the call sites in main.ts
 *     barely change).
 *   - Two tabs: Queue (✕ remove only) vs Exports (⬇bvh / ⬇glb / ⬇ VRMA
 *     download buttons). Switching is reactive, no CSS-attribute hacks.
 *   - Drag-and-drop reorder with `.drop-before` / `.drop-after` visual
 *     indicators on the hovered item.
 *   - Double-click on item label → inline rename input. Alias persisted
 *     to localStorage via the same shared helpers the old code used.
 *   - Empty state with "Drag animations here" placeholder.
 *
 * The component owns the queue items as a reactive `ref<QueueItem[]>`.
 * main.ts gets a ref handle to the component instance and calls
 * `handle.push(name)` / `remove(qi)` / etc. when AnimationController
 * fires its state change events.
 */

import { ref, computed } from 'vue';
import Button from 'primevue/button';
import { formatLibraryName, readLibraryAlias, writeLibraryAlias } from '../ui';
import type { QueueLoopMode } from '../animationController';

interface QueueItem {
  /** Raw library name (not user alias). Stable per item — used as React-style key. */
  rawName: string;
  duration: number;
  /** Auto-incrementing unique id so re-ordered items keep their identity. */
  id: number;
}

type ExportKind = 'bvh' | 'glb' | 'vrma';
type ExportPhase = 'loading' | 'done' | 'error';
type ExportCallback = (queueIndex: number) => void | Promise<unknown>;

interface RowExportState {
  kind: ExportKind;
  phase: ExportPhase;
}

const props = defineProps<{
  mode?:         'full' | 'exportsOnly';
  onJump?:       (queueIndex: number) => void;
  onReorder?:    (fromIndex: number, toIndex: number) => void;
  onRemove?:     (queueIndex: number) => void;
  onClear?:      () => void;
  onDuplicate?:  (queueIndex: number) => void;
  onRetarget?:   (queueIndex: number) => void;
  loopMode?:      QueueLoopMode;
  onLoopModeChange?: (mode: QueueLoopMode) => void;
  /** ⬇ VRMA — only useful for items whose source was BVH. */
  onExportVrma?: ExportCallback;
  onExportBvh?:  ExportCallback;
  onExportGlb?:  ExportCallback;
  onRename?:     (queueIndex: number, newDisplayName: string) => void;
}>();

// ── State ────────────────────────────────────────────────────────────────────
const items       = ref<QueueItem[]>([]);
const activeIndex = ref(-1);
const draggedIndex = ref(-1);
const dropTarget   = ref(-1);
/** Index of the item currently being inline-renamed, or -1. */
const renamingIndex = ref(-1);
const renameValue   = ref('');
const addInputRef   = ref<HTMLInputElement | null>(null);
const loopMode      = ref<QueueLoopMode>(props.loopMode ?? 'queue');
const emptyDropActive = ref(false);
const exportStates = ref<Record<number, RowExportState | undefined>>({});

const activeTab = ref<'queue' | 'exports'>(props.mode === 'exportsOnly' ? 'exports' : 'queue');

let nextId = 1;
const exportResetTimers = new Map<number, number>();

// ── Imperative API exposed to main.ts ────────────────────────────────────────
function push(name: string, duration = 0): void {
  items.value.push({ rawName: name, duration, id: nextId++ });
}
function remove(queueIndex: number): void {
  if (queueIndex < 0 || queueIndex >= items.value.length) return;
  clearExportState(items.value[queueIndex].id);
  items.value.splice(queueIndex, 1);
  if (activeIndex.value === queueIndex)      activeIndex.value = -1;
  else if (activeIndex.value > queueIndex)   activeIndex.value--;
}
function setActive(queueIndex: number): void {
  activeIndex.value = queueIndex;
}
function clear(): void {
  items.value = [];
  activeIndex.value = -1;
  draggedIndex.value = -1;
  dropTarget.value = -1;
  renamingIndex.value = -1;
  for (const id of exportResetTimers.keys()) clearExportState(id);
}
function reorder(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  if (fromIndex >= items.value.length || toIndex > items.value.length) return;
  const [moved] = items.value.splice(fromIndex, 1);
  items.value.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, moved);
}
defineExpose({ push, remove, setActive, reorder, clear });

// ── Display helpers ──────────────────────────────────────────────────────────
const displayName = (rawName: string): string => formatLibraryName(rawName);
const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const isEmpty = computed(() => items.value.length === 0);
const totalDuration = computed(() =>
  items.value.reduce((sum, item) => sum + (Number.isFinite(item.duration) ? Math.max(item.duration, 0) : 0), 0),
);
const queueSummary = computed(() => {
  const count = items.value.length;
  const label = count === 1 ? '1 clip' : `${count} clips`;
  return `${label} · ${formatDuration(totalDuration.value)}`;
});

function clearExportState(itemId: number): void {
  const timer = exportResetTimers.get(itemId);
  if (timer) window.clearTimeout(timer);
  exportResetTimers.delete(itemId);
  delete exportStates.value[itemId];
}

function scheduleExportStateReset(itemId: number, delay: number): void {
  const timer = exportResetTimers.get(itemId);
  if (timer) window.clearTimeout(timer);
  exportResetTimers.set(itemId, window.setTimeout(() => {
    clearExportState(itemId);
  }, delay));
}

function rowExportState(qi: number): RowExportState | null {
  const item = items.value[qi];
  return item ? exportStates.value[item.id] ?? null : null;
}

function isExporting(qi: number, kind?: ExportKind): boolean {
  const state = rowExportState(qi);
  return state?.phase === 'loading' && (!kind || state.kind === kind);
}

function exportButtonClass(qi: number, kind: ExportKind): Record<string, boolean> {
  const state = rowExportState(qi);
  return {
    'export-loading': state?.phase === 'loading' && state.kind === kind,
    'export-done': state?.phase === 'done' && state.kind === kind,
    'export-error': state?.phase === 'error' && state.kind === kind,
  };
}

function exportKindLabel(kind: ExportKind): string {
  return kind === 'vrma' ? 'VRMA' : kind.toUpperCase();
}

function exportStatusText(qi: number): string {
  const state = rowExportState(qi);
  if (!state) return '';
  const label = exportKindLabel(state.kind);
  if (state.phase === 'loading') return `Saving ${label}`;
  if (state.phase === 'done') return `Saved ${label}`;
  return `Failed ${label}`;
}

function exportStatusClass(qi: number): string {
  const state = rowExportState(qi);
  return state ? `export-status-${state.phase}` : '';
}

async function runExport(qi: number, kind: ExportKind, callback?: ExportCallback): Promise<void> {
  if (!callback || isExporting(qi)) return;
  const item = items.value[qi];
  if (!item) return;
  clearExportState(item.id);
  exportStates.value[item.id] = { kind, phase: 'loading' };
  try {
    await Promise.resolve(callback(qi));
    exportStates.value[item.id] = { kind, phase: 'done' };
    scheduleExportStateReset(item.id, 2600);
  } catch {
    exportStates.value[item.id] = { kind, phase: 'error' };
    scheduleExportStateReset(item.id, 4200);
  }
}

// ── Click → jump (skipped when click target is a button or rename input) ────
function onItemClick(e: MouseEvent, qi: number): void {
  const t = e.target as HTMLElement;
  if (t.closest('button, input, .q-action')) return;
  if (draggedIndex.value >= 0) return;
  props.onJump?.(qi);
}

// ── Inline rename ────────────────────────────────────────────────────────────
function startRename(qi: number): void {
  renamingIndex.value = qi;
  renameValue.value   = readLibraryAlias(items.value[qi].rawName) ?? '';
  // Focus + select on next tick — input is rendered after `renamingIndex` flips.
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>('.q-rename-input');
    el?.focus();
    el?.select();
  });
}
function commitRename(qi: number, save: boolean): void {
  if (qi !== renamingIndex.value) return;
  if (save) {
    const v = renameValue.value.trim();
    const item = items.value[qi];
    writeLibraryAlias(item.rawName, v || null);
    props.onRename?.(qi, v || item.rawName);
  }
  renamingIndex.value = -1;
}

function openAddPicker(): void {
  addInputRef.value?.click();
}

function onAddFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length === 0) return;
  window.dispatchEvent(new CustomEvent<File[]>('vrm-player:add-animation-files', { detail: files }));
}

function toggleLoopMode(): void {
  loopMode.value = loopMode.value === 'queue' ? 'one' : 'queue';
  props.onLoopModeChange?.(loopMode.value);
}

function hasDraggedFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.items ?? []).some((item) => item.kind === 'file');
}

function onEmptyDragOver(e: DragEvent): void {
  if (props.mode === 'exportsOnly' || !hasDraggedFiles(e)) return;
  e.preventDefault();
  e.stopPropagation();
  emptyDropActive.value = true;
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}

function onEmptyDragLeave(e: DragEvent): void {
  const next = e.relatedTarget as Node | null;
  if (next && (e.currentTarget as HTMLElement).contains(next)) return;
  emptyDropActive.value = false;
}

function onEmptyDrop(e: DragEvent): void {
  if (props.mode === 'exportsOnly') return;
  e.preventDefault();
  e.stopPropagation();
  emptyDropActive.value = false;
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  window.dispatchEvent(new CustomEvent<File[]>('vrm-player:add-animation-files', { detail: files }));
}

// ── Drag-and-drop reorder ────────────────────────────────────────────────────
function onDragStart(e: DragEvent, qi: number): void {
  if (props.mode === 'exportsOnly') return;
  draggedIndex.value = qi;
  e.dataTransfer!.effectAllowed = 'move';
  e.dataTransfer!.setData('text/plain', `queue:${qi}`);
}
function onDragEnd(): void {
  draggedIndex.value = -1;
  dropTarget.value = -1;
}
function onDragOver(e: DragEvent, qi: number): void {
  if (props.mode === 'exportsOnly') return;
  if (draggedIndex.value < 0) return;
  e.preventDefault();
  if (qi === draggedIndex.value) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const isTopHalf = e.clientY < rect.top + rect.height / 2;
  dropTarget.value = isTopHalf ? qi : qi + 1;
}
function onDrop(e: DragEvent): void {
  if (props.mode === 'exportsOnly') return;
  if (draggedIndex.value < 0 || dropTarget.value < 0) return;
  e.preventDefault();
  const from = draggedIndex.value;
  const to   = dropTarget.value;
  draggedIndex.value = -1;
  dropTarget.value = -1;
  if (to === from || to === from + 1) return;
  reorder(from, to);
  props.onReorder?.(from, to);
}

// ── Per-item drop-indicator classes ──────────────────────────────────────────
function dropClass(qi: number): string {
  if (draggedIndex.value < 0) return '';
  if (dropTarget.value === qi)     return 'drop-before';
  if (dropTarget.value === qi + 1) return 'drop-after';
  return '';
}

const emptyText = computed(() =>
  props.mode === 'exportsOnly'
    ? 'Load animations on the Player page'
    : 'Drag animations here',
);
</script>

<template>
  <div class="queue-panel-root" :data-tab="activeTab">
    <!-- Tabs -->
    <div v-if="mode !== 'exportsOnly'" class="dbg-tabs">
      <Button
        class="dbg-tab"
        label="Queue"
        text
        :class="{ active: activeTab === 'queue' }"
        @click="activeTab = 'queue'"
      />
      <Button
        class="dbg-tab"
        label="Exports"
        text
        :class="{ active: activeTab === 'exports' }"
        @click="activeTab = 'exports'"
      />
    </div>

    <div v-if="mode !== 'exportsOnly' && activeTab === 'queue' && !isEmpty" class="queue-tools">
      <Button
        class="queue-tool-btn queue-loop-btn"
        :class="{ active: loopMode === 'one' }"
        icon="pi pi-refresh"
        :label="loopMode === 'one' ? 'Loop one' : 'Loop queue'"
        text
        size="small"
        aria-label="Toggle loop mode"
        :title="loopMode === 'one' ? 'Repeat the current clip' : 'Play through the whole queue'"
        :aria-pressed="loopMode === 'one'"
        data-testid="queue-loop-toggle"
        @click="toggleLoopMode"
      />
      <span class="queue-summary">{{ queueSummary }}</span>
      <Button
        class="queue-tool-btn"
        icon="pi pi-trash"
        label="Clear queue"
        text
        size="small"
        title="Remove every clip from the queue"
        @click="props.onClear?.(); clear()"
      />
    </div>

    <!-- Exports tab tools -->
    <div v-if="mode !== 'exportsOnly'" v-show="activeTab === 'exports'" class="exports-tools">
      <div class="title">File-to-file converters</div>
      <a href="/exports.html" target="_blank" rel="noopener" class="converter-link">
        Open converter window
      </a>
      <div class="hint">
        Standalone page — no avatar, lightweight. Supports
        <code>.fbx</code> / <code>.bvh</code> / <code>.glb</code> /
        <code>.gltf</code> / <code>.vrma</code> → JSON.
      </div>
      <div class="title spaced">Per-clip downloads</div>
      <div class="hint">Use BVH, GLB, or VRMA next to each item below</div>
    </div>

    <!-- Items list (visible in both tabs; action buttons swap via CSS classes) -->
    <ul class="queue-list">
      <li
        v-for="(item, qi) in items"
        :key="item.id"
        class="q-item"
        :class="[
          dropClass(qi),
          {
            active:   qi === activeIndex,
            dragging: qi === draggedIndex,
          },
        ]"
        :draggable="mode !== 'exportsOnly' && renamingIndex !== qi"
        @click="onItemClick($event, qi)"
        @dragstart="onDragStart($event, qi)"
        @dragend="onDragEnd"
        @dragover="onDragOver($event, qi)"
        @drop="onDrop"
      >
        <span class="q-num">{{ String(qi + 1).padStart(2, '0') }}.</span>

        <!-- Label or inline rename input -->
        <input
          v-if="renamingIndex === qi"
          class="q-rename-input"
          v-model="renameValue"
          :placeholder="item.rawName"
          @blur="commitRename(qi, true)"
          @keydown.enter.prevent="commitRename(qi, true)"
          @keydown.escape.prevent="commitRename(qi, false)"
        />
        <span
          v-else
          class="q-label"
          :title="item.rawName"
          @dblclick.stop="startRename(qi)"
        >{{ displayName(item.rawName) }}</span>
        <span class="q-duration">{{ formatDuration(item.duration) }}</span>

        <!-- Exports tab: per-format download buttons -->
        <Button
          v-if="onExportBvh"
          class="q-action q-export-bvh"
          :class="exportButtonClass(qi, 'bvh')"
          label="BVH"
          text
          size="small"
          :disabled="isExporting(qi)"
          :loading="isExporting(qi, 'bvh')"
          aria-label="Record this clip as BVH"
          title="Export this clip as BVH"
          @click.stop="runExport(qi, 'bvh', onExportBvh)"
        />
        <Button
          v-if="onExportGlb"
          class="q-action q-export-glb"
          :class="exportButtonClass(qi, 'glb')"
          label="GLB"
          text
          size="small"
          :disabled="isExporting(qi)"
          :loading="isExporting(qi, 'glb')"
          aria-label="Download as glTF/GLB"
          title="Export this clip as GLB"
          @click.stop="runExport(qi, 'glb', onExportGlb)"
        />
        <Button
          v-if="onExportVrma"
          class="q-action q-export"
          :class="exportButtonClass(qi, 'vrma')"
          label="VRMA"
          text
          size="small"
          :disabled="isExporting(qi)"
          :loading="isExporting(qi, 'vrma')"
          aria-label="Download as VRMA"
          title="Export this clip as VRMA"
          @click.stop="runExport(qi, 'vrma', onExportVrma)"
        />
        <span
          v-if="exportStatusText(qi)"
          class="q-export-status"
          :class="exportStatusClass(qi)"
        >{{ exportStatusText(qi) }}</span>

        <!-- Queue tab: remove only -->
        <Button
          v-if="mode !== 'exportsOnly'"
          class="q-action q-play"
          icon="pi pi-play"
          text
          rounded
          size="small"
          aria-label="Play this clip"
          title="Play this clip"
          @click.stop="props.onJump?.(qi)"
        />
        <Button
          v-if="mode !== 'exportsOnly'"
          class="q-action q-duplicate"
          icon="pi pi-copy"
          text
          rounded
          size="small"
          aria-label="Duplicate in queue"
          title="Duplicate this clip in the queue"
          @click.stop="props.onDuplicate?.(qi)"
        />
        <Button
          v-if="mode !== 'exportsOnly' && onRetarget"
          class="q-action q-retarget"
          icon="pi pi-sliders-h"
          text
          rounded
          size="small"
          aria-label="Open in Retarget Lab"
          title="Open this clip in Retarget Lab"
          @click.stop="props.onRetarget?.(qi)"
        />

        <Button
          class="q-action q-remove"
          icon="pi pi-times"
          text
          rounded
          size="small"
          aria-label="Remove from queue"
          title="Remove this clip from the queue"
          @click.stop="props.onRemove?.(qi); remove(qi)"
        />
      </li>
    </ul>

    <input
      ref="addInputRef"
      type="file"
      accept=".bvh,.vrma,.fbx"
      multiple
      hidden
      @change="onAddFileChange"
    />

    <!-- Empty placeholder -->
    <div
      v-if="isEmpty"
      class="queue-empty"
      :class="{ 'drag-over': emptyDropActive }"
      @dragenter.prevent.stop="onEmptyDragOver"
      @dragover.prevent.stop="onEmptyDragOver"
      @dragleave="onEmptyDragLeave"
      @drop.prevent.stop="onEmptyDrop"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 5v14M5 12l7-7 7 7"/>
      </svg>
      <span>{{ emptyText }}</span>
      <Button
        v-if="mode !== 'exportsOnly'"
        class="queue-add-btn"
        icon="pi pi-plus"
        label="Add animation"
        size="small"
        data-testid="queue-add-animation"
        @click="openAddPicker"
      />
    </div>
  </div>
</template>

<style scoped>
/* Inherit the existing dark-theme palette from the player's global stylesheet
   (index.html). These rules only style elements specific to this Vue island. */

.queue-panel-root {
  display: flex;
  flex-direction: column;
  font-family: var(--font-ui);
  font-size: 11px;
}

/* Tabs reuse the existing .dbg-tab styles from index.html. We bind extra
   `data-tab` on root so external CSS rules continue to drive per-tab button
   visibility on the action buttons below. */
.dbg-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.dbg-tab {
  flex: 1;
  background: transparent;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 5px 8px;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  opacity: 0.4;
  transition: opacity 120ms, border-color 120ms;
  font-family: inherit;
}
:deep(.dbg-tab.p-button) {
  justify-content: center;
  border-radius: 0;
}
.dbg-tab:hover { opacity: 0.7; }
.dbg-tab.active { opacity: 1; border-bottom-color: #3b5bdb; }

.exports-tools {
  font-size: 11px;
  margin-bottom: 8px;
  padding: 8px 10px;
  background: rgba(30, 188, 196, 0.07);
  border: 1px solid rgba(123, 225, 232, 0.12);
  border-radius: 6px;
}

.queue-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -2px 0 6px;
}

:deep(.queue-tool-btn.p-button) {
  height: 24px;
  padding: 0 8px;
  color: rgba(255, 255, 255, 0.48);
  font-size: 10px;
  font-weight: 700;
}

:deep(.queue-tool-btn.p-button:hover) {
  color: #fca5a5;
  background: rgba(248, 113, 113, 0.1);
}

:deep(.queue-loop-btn.p-button) {
  color: rgba(255, 255, 255, 0.62);
}

:deep(.queue-loop-btn.p-button:hover),
:deep(.queue-loop-btn.p-button.active) {
  color: #b9fbff;
  background: rgba(30, 188, 196, 0.18);
}

.queue-summary {
  flex: 1;
  min-width: 0;
  color: rgba(255, 255, 255, 0.42);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
  white-space: nowrap;
}
.exports-tools .title       { font-weight: 600; opacity: .7; margin-bottom: 4px; }
.exports-tools .title.spaced { margin-top: 10px; }
.exports-tools .hint        { opacity: .55; font-size: 10px; }
.converter-link {
  display: inline-block;
  padding: 6px 10px;
  margin: 4px 0;
  color: #fff;
  background: rgba(30, 188, 196, 0.72);
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
  font-size: 11px;
}
.converter-link:hover { background: #1ebcc4; }
.exports-tools code {
  background: rgba(255, 255, 255, 0.07);
  padding: 0 4px;
  border-radius: 2px;
}

.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.q-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 5px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  user-select: none;
  border: 1px solid transparent;
  transition: background 100ms, border-color 100ms;
}
.q-item:hover { background: rgba(255, 255, 255, 0.07); }
.q-item.active {
  background: rgba(30, 188, 196, 0.16);
  border-color: rgba(123, 225, 232, 0.32);
}
.q-item.dragging   { opacity: 0.4; }
.q-item.drop-before { box-shadow: 0 -2px 0 #3b5bdb; }
.q-item.drop-after  { box-shadow: 0  2px 0 #3b5bdb; }

.q-num   { opacity: 0.35; flex-shrink: 0; width: 18px; }
.q-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.q-duration {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.36);
  font-size: 10px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.q-export-status {
  flex-shrink: 0;
  min-width: 62px;
  color: rgba(255, 255, 255, 0.48);
  font-size: 10px;
  font-family: var(--font-mono);
  white-space: nowrap;
}
.q-export-status.export-status-loading { color: #bfdbfe; }
.q-export-status.export-status-done    { color: #86efac; }
.q-export-status.export-status-error   { color: #fca5a5; }
.q-rename-input {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: 11px;
  background: #111;
  color: #fff;
  border: 1px solid #3b5bdb;
  border-radius: 3px;
  padding: 2px 5px;
  box-sizing: border-box;
}
.q-action {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid #444;
  color: #aaa;
  border-radius: 3px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  font-family: inherit;
}
:deep(.q-action.p-button) {
  min-width: 0;
  height: 18px;
}
.q-action:hover { background: #2a3550; color: #fff; border-color: #3b5bdb; }
.q-export-bvh,
.q-export-glb,
.q-export {
  font-size: 9px;
  padding: 0 5px;
  letter-spacing: 0.05em;
}
.q-action.export-loading {
  color: #b9fbff;
  border-color: rgba(123, 225, 232, 0.42);
  background: rgba(30, 188, 196, 0.14);
}
.q-action.export-done {
  color: #86efac;
  border-color: rgba(134, 239, 172, 0.36);
  background: rgba(34, 197, 94, 0.12);
}
.q-action.export-error {
  color: #fca5a5;
  border-color: rgba(252, 165, 165, 0.4);
  background: rgba(248, 113, 113, 0.12);
}
.q-remove {
  border: none;
  color: rgba(255, 255, 255, 0.2);
  padding: 2px 3px;
  font-size: 9px;
  line-height: 1;
}
:deep(.q-remove.p-button) {
  width: 18px;
}
.q-remove:hover { color: #f87171; background: rgba(248, 113, 113, 0.1); border-color: transparent; }
:deep(.q-play.p-button),
:deep(.q-duplicate.p-button),
:deep(.q-retarget.p-button) {
  width: 18px;
}
.q-play:hover,
.q-duplicate:hover,
.q-retarget:hover {
  color: #fff;
  background: rgba(30, 188, 196, 0.2);
  border-color: transparent;
}

/* Per-tab button visibility — same rules as the vanilla CSS in index.html. */
.queue-panel-root[data-tab="queue"]   .q-export,
.queue-panel-root[data-tab="queue"]   .q-export-bvh,
.queue-panel-root[data-tab="queue"]   .q-export-glb { display: none; }
.queue-panel-root[data-tab="exports"] .q-remove,
.queue-panel-root[data-tab="exports"] .q-play,
.queue-panel-root[data-tab="exports"] .q-duplicate,
.queue-panel-root[data-tab="exports"] .q-retarget   { display: none; }

.queue-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
  border: 1.5px dashed rgba(169, 210, 215, 0.16);
  border-radius: 6px;
  margin-top: 4px;
  background: rgba(255, 255, 255, 0.025);
}
.queue-empty svg,
.queue-empty span {
  opacity: 0.38;
}
.queue-empty.drag-over {
  color: #fff;
  background: rgba(30, 188, 196, 0.14);
  border-color: rgba(123, 225, 232, 0.72);
  box-shadow: inset 0 0 0 1px rgba(123, 225, 232, 0.18);
}

.queue-empty.drag-over svg,
.queue-empty.drag-over span {
  opacity: 0.8;
}

:deep(.queue-add-btn.p-button) {
  height: 28px;
  padding: 0 10px;
  background: #10b981;
  border-color: #10b981;
  color: #fff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
}

:deep(.queue-add-btn.p-button:hover) {
  background: #12c992;
  border-color: #12c992;
}
</style>
