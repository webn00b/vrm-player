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

</script>

<template>
  <div class="queue-panel-root" :data-tab="activeTab">
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

    <ul class="queue-list">
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

    <QueueEmptyState v-if="isEmpty" :mode="mode" />
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

.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
