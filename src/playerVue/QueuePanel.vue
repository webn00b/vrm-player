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

interface QueueItem {
  /** Raw library name (not user alias). Stable per item — used as React-style key. */
  rawName: string;
  /** Auto-incrementing unique id so re-ordered items keep their identity. */
  id: number;
}

const props = defineProps<{
  mode?:         'full' | 'exportsOnly';
  onJump?:       (queueIndex: number) => void;
  onReorder?:    (fromIndex: number, toIndex: number) => void;
  onRemove?:     (queueIndex: number) => void;
  /** ⬇ VRMA — only useful for items whose source was BVH. */
  onExportVrma?: (queueIndex: number) => void;
  onExportBvh?:  (queueIndex: number) => void;
  onExportGlb?:  (queueIndex: number) => void;
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

const activeTab = ref<'queue' | 'exports'>(props.mode === 'exportsOnly' ? 'exports' : 'queue');

let nextId = 1;

// ── Imperative API exposed to main.ts ────────────────────────────────────────
function push(name: string): void {
  items.value.push({ rawName: name, id: nextId++ });
}
function remove(queueIndex: number): void {
  if (queueIndex < 0 || queueIndex >= items.value.length) return;
  items.value.splice(queueIndex, 1);
  if (activeIndex.value === queueIndex)      activeIndex.value = -1;
  else if (activeIndex.value > queueIndex)   activeIndex.value--;
}
function setActive(queueIndex: number): void {
  activeIndex.value = queueIndex;
}
function reorder(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  if (fromIndex >= items.value.length || toIndex > items.value.length) return;
  const [moved] = items.value.splice(fromIndex, 1);
  items.value.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, moved);
}
defineExpose({ push, remove, setActive, reorder });

// ── Display helpers ──────────────────────────────────────────────────────────
const displayName = (rawName: string): string => formatLibraryName(rawName);

const isEmpty = computed(() => items.value.length === 0);

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

    <!-- Exports tab tools -->
    <div v-if="mode !== 'exportsOnly'" v-show="activeTab === 'exports'" class="exports-tools">
      <div class="title">File-to-file converters</div>
      <a href="/exports.html" target="_blank" rel="noopener" class="converter-link">
        🛠 Open converter window
      </a>
      <div class="hint">
        Standalone page — no avatar, lightweight. Supports
        <code>.fbx</code> / <code>.bvh</code> / <code>.glb</code> /
        <code>.gltf</code> / <code>.vrma</code> → JSON.
      </div>
      <div class="title spaced">Per-clip downloads</div>
      <div class="hint">Click ⬇bvh / ⬇glb / ⬇ next to each item below</div>
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

        <!-- Exports tab: per-format download buttons -->
        <Button
          v-if="onExportBvh"
          class="q-action q-export-bvh"
          label="⬇bvh"
          text
          size="small"
          aria-label="Record this clip as BVH"
          @click.stop="onExportBvh?.(qi)"
        />
        <Button
          v-if="onExportGlb"
          class="q-action q-export-glb"
          label="⬇glb"
          text
          size="small"
          aria-label="Download as glTF/GLB"
          @click.stop="onExportGlb?.(qi)"
        />
        <Button
          v-if="onExportVrma"
          class="q-action q-export"
          label="⬇"
          text
          size="small"
          aria-label="Download as VRMA"
          @click.stop="onExportVrma?.(qi)"
        />

        <!-- Queue tab: remove only -->
        <Button
          class="q-action q-remove"
          icon="pi pi-times"
          text
          rounded
          size="small"
          aria-label="Remove from queue"
          @click.stop="props.onRemove?.(qi); remove(qi)"
        />
      </li>
    </ul>

    <!-- Empty placeholder -->
    <div v-if="isEmpty" class="queue-empty">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 5v14M5 12l7-7 7 7"/>
      </svg>
      {{ emptyText }}
    </div>
  </div>
</template>

<style scoped>
/* Inherit the existing dark-theme palette from the player's global stylesheet
   (index.html). These rules only style elements specific to this Vue island. */

.queue-panel-root {
  display: flex;
  flex-direction: column;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
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
  background: rgba(110, 168, 255, 0.06);
  border-radius: 3px;
}
.exports-tools .title       { font-weight: 600; opacity: .7; margin-bottom: 4px; }
.exports-tools .title.spaced { margin-top: 10px; }
.exports-tools .hint        { opacity: .55; font-size: 10px; }
.converter-link {
  display: inline-block;
  padding: 6px 10px;
  margin: 4px 0;
  color: #fff;
  background: #3b5bdb;
  border-radius: 3px;
  text-decoration: none;
  font-weight: 600;
  font-size: 11px;
}
.converter-link:hover { background: #4c6ce8; }
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
  padding: 4px 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  user-select: none;
  transition: background 100ms;
}
.q-item:hover { background: rgba(255, 255, 255, 0.07); }
.q-item.active {
  background: rgba(110, 168, 255, 0.18);
  outline: 1px solid rgba(110, 168, 255, 0.4);
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
.q-export-bvh, .q-export-glb { font-size: 9px; padding: 0 4px; letter-spacing: 0.05em; }
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

/* Per-tab button visibility — same rules as the vanilla CSS in index.html. */
.queue-panel-root[data-tab="queue"]   .q-export,
.queue-panel-root[data-tab="queue"]   .q-export-bvh,
.queue-panel-root[data-tab="queue"]   .q-export-glb { display: none; }
.queue-panel-root[data-tab="exports"] .q-remove     { display: none; }

.queue-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 12px;
  font-size: 12px;
  opacity: 0.35;
  border: 1.5px dashed rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  margin-top: 4px;
}
.queue-empty.drag-over { opacity: 0.7; border-color: #3b5bdb; }
</style>
