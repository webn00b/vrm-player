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

import { ref, computed, useTemplateRef } from 'vue';
import Button from 'primevue/button';
import { readLibraryAlias, writeLibraryAlias } from '../ui';
import type { QueueLoopMode } from '../animationController';
import QueueEmptyState from './queuePanel/QueueEmptyState.vue';
import QueueExportsTools from './queuePanel/QueueExportsTools.vue';
import QueueItemRow from './queuePanel/QueueItemRow.vue';
import QueueTabs from './queuePanel/QueueTabs.vue';
import QueueTools from './queuePanel/QueueTools.vue';
import { useQueueExportState } from './queuePanel/useQueueExportState';
import {
  formatDuration,
  type QueueItem,
  type QueuePanelProps,
} from './queuePanel/queuePanelTypes';

const props = defineProps<QueuePanelProps>();

// ── State ────────────────────────────────────────────────────────────────────
const items       = ref<QueueItem[]>([]);
const activeIndex = ref(-1);
const draggedIndex = ref(-1);
const dropTarget   = ref(-1);
/** Index of the item currently being inline-renamed, or -1. */
const renamingIndex = ref(-1);
const renameValue   = ref('');
const loopMode      = ref<QueueLoopMode>(props.loopMode ?? 'queue');
const agentOgiExportEnabled = ref(false);

const activeTab = ref<'queue' | 'exports'>(props.mode === 'exportsOnly' ? 'exports' : 'queue');

let nextId = 1;
const {
  clearExportState,
  clearAllExportStates,
  rowExportState,
  runExport,
} = useQueueExportState(items);

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
  clearAllExportStates();
}
function reorder(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  if (fromIndex >= items.value.length || toIndex > items.value.length) return;
  const [moved] = items.value.splice(fromIndex, 1);
  items.value.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, moved);
}
defineExpose({ push, remove, setActive, reorder, clear });

// ── Display helpers ──────────────────────────────────────────────────────────
const isEmpty = computed(() => items.value.length === 0);
const totalDuration = computed(() =>
  items.value.reduce((sum, item) => sum + (Number.isFinite(item.duration) ? Math.max(item.duration, 0) : 0), 0),
);
const queueSummary = computed(() => {
  const count = items.value.length;
  const label = count === 1 ? '1 clip' : `${count} clips`;
  return `${label} · ${formatDuration(totalDuration.value)}`;
});

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

function toggleLoopMode(): void {
  loopMode.value = loopMode.value === 'queue' ? 'one' : 'queue';
  props.onLoopModeChange?.(loopMode.value);
}

// ── Add more files (picker + file drop onto the populated list) ─────────────
const addInputRef = useTemplateRef<HTMLInputElement>('queueAddInput');
const fileDropActive = ref(false);

function dispatchAnimationFiles(files: File[]): void {
  if (files.length === 0) return;
  window.dispatchEvent(new CustomEvent<File[]>('vrm-player:add-animation-files', { detail: files }));
}
function openAddPicker(): void {
  addInputRef.value?.click();
}
function onAddFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  dispatchAnimationFiles(files);
}
function hasDraggedFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.items ?? []).some((item) => item.kind === 'file');
}
function onRootDragOver(e: DragEvent): void {
  // Empty state owns its own drop zone; internal reorder drags are not files.
  if (props.mode === 'exportsOnly' || isEmpty.value) return;
  if (draggedIndex.value >= 0 || !hasDraggedFiles(e)) return;
  e.preventDefault();
  fileDropActive.value = true;
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}
function onRootDragLeave(e: DragEvent): void {
  const next = e.relatedTarget as Node | null;
  if (next && (e.currentTarget as HTMLElement).contains(next)) return;
  fileDropActive.value = false;
}
function onRootDrop(e: DragEvent): void {
  if (!fileDropActive.value) return;
  e.preventDefault();
  fileDropActive.value = false;
  dispatchAnimationFiles(Array.from(e.dataTransfer?.files ?? []));
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
function onListDragOver(e: DragEvent): void {
  // Dragging below the last row drops at the end of the queue.
  if (props.mode === 'exportsOnly' || draggedIndex.value < 0) return;
  if ((e.target as HTMLElement).closest('.q-item')) return;
  e.preventDefault();
  dropTarget.value = items.value.length;
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

</script>

<template>
  <div
    class="queue-panel-root"
    :data-tab="activeTab"
    :class="{ 'file-drop-active': fileDropActive }"
    @dragenter="onRootDragOver"
    @dragover="onRootDragOver"
    @dragleave="onRootDragLeave"
    @drop="onRootDrop"
  >
    <QueueTabs v-if="mode !== 'exportsOnly'" v-model:active-tab="activeTab" />

    <QueueTools
      v-if="mode !== 'exportsOnly' && activeTab === 'queue' && !isEmpty"
      :loop-mode="loopMode"
      :summary="queueSummary"
      @toggle-loop-mode="toggleLoopMode"
      @clear-queue="props.onClear?.(); clear()"
    />

    <QueueExportsTools
      v-if="mode !== 'exportsOnly'"
      v-show="activeTab === 'exports'"
      v-model:agent-ogi-export-enabled="agentOgiExportEnabled"
      :can-export-agent-ogi="!!onExportAgentOgi"
    />

    <ul
      class="queue-list"
      @dragover="onListDragOver"
      @drop="onDrop"
    >
      <QueueItemRow
        v-for="(item, qi) in items"
        :key="item.id"
        :item="item"
        :queue-index="qi"
        :active-index="activeIndex"
        :dragged-index="draggedIndex"
        :drop-class="dropClass(qi)"
        :mode="mode"
        :active-tab="activeTab"
        :renaming="renamingIndex === qi"
        :rename-value="renameValue"
        :row-export-state="rowExportState(qi)"
        :agent-ogi-export-enabled="agentOgiExportEnabled"
        :on-export-vrma="onExportVrma"
        :on-export-bvh="onExportBvh"
        :on-export-glb="onExportGlb"
        :on-export-agent-ogi="onExportAgentOgi"
        :can-retarget="!!onRetarget"
        @item-click="onItemClick"
        @drag-start="onDragStart"
        @drag-end="onDragEnd"
        @drag-over="onDragOver"
        @drop="onDrop"
        @start-rename="startRename"
        @commit-rename="commitRename"
        @update-rename-value="renameValue = $event"
        @export="runExport"
        @jump="props.onJump?.($event)"
        @duplicate="props.onDuplicate?.($event)"
        @retarget="props.onRetarget?.($event)"
        @remove="(index) => { props.onRemove?.(index); remove(index); }"
      />
    </ul>

    <div
      v-if="mode !== 'exportsOnly' && activeTab === 'queue' && !isEmpty"
      class="queue-add-row"
    >
      <input
        ref="queueAddInput"
        type="file"
        accept=".bvh,.vrma,.fbx"
        multiple
        hidden
        @change="onAddFileChange"
      />
      <Button
        class="queue-add-more-btn"
        icon="pi pi-plus"
        label="Add animation"
        text
        size="small"
        title="Add animation files (or drop them anywhere on this panel)"
        data-testid="queue-add-more"
        @click="openAddPicker"
      />
    </div>

    <QueueEmptyState v-if="isEmpty" :mode="mode" />

    <div v-if="fileDropActive" class="queue-file-drop-hint">
      <span>Drop to add</span>
    </div>
  </div>
</template>

<style scoped>
/* Inherit the existing dark-theme palette from the player's global stylesheet
   (index.html). These rules only style elements specific to this Vue island. */

.queue-panel-root {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-family: var(--font-ui);
  font-size: 11px;
}

.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  align-content: start;
  gap: 2px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
}

.queue-add-row {
  flex-shrink: 0;
  margin-top: 6px;
}

:deep(.queue-add-more-btn.p-button) {
  width: 100%;
  height: 26px;
  justify-content: center;
  color: rgba(255, 255, 255, 0.42);
  border: 1px dashed rgba(169, 210, 215, 0.18);
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
}

:deep(.queue-add-more-btn.p-button:hover) {
  color: #b9fbff;
  border-color: rgba(123, 225, 232, 0.45);
  background: rgba(30, 188, 196, 0.1);
}

/* Full-panel highlight while dragging files over a populated queue. */
.queue-file-drop-hint {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(30, 188, 196, 0.12);
  border: 1.5px dashed rgba(123, 225, 232, 0.72);
  border-radius: 8px;
  color: #b9fbff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
</style>
