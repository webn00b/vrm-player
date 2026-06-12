<script setup lang="ts">
import { computed } from 'vue';
import { formatLibraryName } from '../../ui';
import {
  formatDuration,
  type ExportCallback,
  type ExportKind,
  type QueueItem,
  type QueuePanelMode,
  type QueuePanelTab,
  type RowExportState,
} from './queuePanelTypes';
import QueueExportActions from './QueueExportActions.vue';
import QueuePlaybackActions from './QueuePlaybackActions.vue';

const props = defineProps<{
  item: QueueItem;
  queueIndex: number;
  activeIndex: number;
  draggedIndex: number;
  dropClass: string;
  mode?: QueuePanelMode;
  activeTab: QueuePanelTab;
  renaming: boolean;
  renameValue: string;
  rowExportState: RowExportState | null;
  agentOgiExportEnabled: boolean;
  onExportVrma?: ExportCallback;
  onExportBvh?: ExportCallback;
  onExportGlb?: ExportCallback;
  onExportAgentOgi?: ExportCallback;
  canRetarget: boolean;
}>();

const emit = defineEmits<{
  itemClick: [event: MouseEvent, queueIndex: number];
  dragStart: [event: DragEvent, queueIndex: number];
  dragEnd: [];
  dragOver: [event: DragEvent, queueIndex: number];
  drop: [event: DragEvent];
  startRename: [queueIndex: number];
  commitRename: [queueIndex: number, save: boolean];
  updateRenameValue: [value: string];
  export: [queueIndex: number, kind: ExportKind, callback?: ExportCallback];
  jump: [queueIndex: number];
  duplicate: [queueIndex: number];
  retarget: [queueIndex: number];
  remove: [queueIndex: number];
}>();

const displayName = (rawName: string): string => formatLibraryName(rawName);
const showExports = computed(() => props.activeTab === 'exports' || props.mode === 'exportsOnly');
const showQueueActions = computed(() => props.mode !== 'exportsOnly' && props.activeTab === 'queue');
</script>

<template>
  <li
    class="q-item"
    :class="[
      dropClass,
      {
        active: queueIndex === activeIndex,
        dragging: queueIndex === draggedIndex,
        'has-export-state': rowExportState !== null,
      },
    ]"
    :draggable="mode !== 'exportsOnly' && !renaming"
    tabindex="0"
    @click="emit('itemClick', $event, queueIndex)"
    @keydown.enter.self.prevent="emit('jump', queueIndex)"
    @keydown.delete.self.prevent="emit('remove', queueIndex)"
    @keydown.f2.self.prevent="emit('startRename', queueIndex)"
    @dragstart="emit('dragStart', $event, queueIndex)"
    @dragend="emit('dragEnd')"
    @dragover="emit('dragOver', $event, queueIndex)"
    @drop="emit('drop', $event)"
  >
    <span class="q-num">
      <i v-if="queueIndex === activeIndex" class="pi pi-play q-now" aria-label="Now playing" />
      <template v-else>{{ String(queueIndex + 1).padStart(2, '0') }}</template>
    </span>

    <input
      v-if="renaming"
      class="q-rename-input"
      :value="renameValue"
      :placeholder="item.rawName"
      @input="emit('updateRenameValue', ($event.target as HTMLInputElement).value)"
      @blur="emit('commitRename', queueIndex, true)"
      @keydown.enter.prevent="emit('commitRename', queueIndex, true)"
      @keydown.escape.prevent="emit('commitRename', queueIndex, false)"
    />
    <span
      v-else
      class="q-label"
      :title="`${item.rawName}\nDouble-click (or F2) to rename`"
      @dblclick.stop="emit('startRename', queueIndex)"
    >{{ displayName(item.rawName) }}</span>
    <span class="q-duration">{{ formatDuration(item.duration) }}</span>

    <div v-if="showExports" class="q-actions q-actions-exports">
      <QueueExportActions
        :queue-index="queueIndex"
        :row-export-state="rowExportState"
        :agent-ogi-export-enabled="agentOgiExportEnabled"
        :on-export-vrma="onExportVrma"
        :on-export-bvh="onExportBvh"
        :on-export-glb="onExportGlb"
        :on-export-agent-ogi="onExportAgentOgi"
        @export="(index, kind, callback) => emit('export', index, kind, callback)"
      />
    </div>
    <div v-if="showQueueActions" class="q-actions q-actions-queue">
      <QueuePlaybackActions
        :queue-index="queueIndex"
        :can-retarget="canRetarget"
        @jump="emit('jump', $event)"
        @duplicate="emit('duplicate', $event)"
        @retarget="emit('retarget', $event)"
        @remove="emit('remove', $event)"
      />
    </div>
  </li>
</template>

<style scoped>
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

.q-item:hover {
  background: rgba(255, 255, 255, 0.07);
}

.q-item.active {
  background: rgba(30, 188, 196, 0.16);
  border-color: rgba(123, 225, 232, 0.32);
}

.q-item.dragging {
  opacity: 0.4;
}

.q-item.drop-before {
  box-shadow: 0 -2px 0 var(--ui-accent);
}

.q-item.drop-after {
  box-shadow: 0 2px 0 var(--ui-accent);
}

.q-item:focus-visible {
  outline: 1px solid rgba(123, 225, 232, 0.55);
  outline-offset: -1px;
}

.q-num {
  opacity: 0.35;
  flex-shrink: 0;
  width: 18px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.q-now {
  font-size: 9px;
  color: var(--ui-accent);
}

.q-item.active .q-num {
  opacity: 1;
}

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

.q-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 3px;
}

/* Size overrides for the PrimeVue buttons rendered by the multi-root
   action components: their own scoped `:deep(...)` rules cannot match
   (the buttons ARE the component roots), so the wrapper styles them. */
.q-actions :deep(.q-action.p-button) {
  width: 20px;
  height: 20px;
  min-width: 0;
  padding: 0;
}

.q-actions :deep(.q-action.p-button .p-button-icon) {
  font-size: 10px;
}

.q-actions-exports :deep(.q-action.p-button) {
  width: auto;
  padding: 0 5px;
}

/* Actions stay out of the way until the row is hovered, focused, or active —
   the narrow panel otherwise crushes the clip label. Export actions also pin
   themselves while an export is running or just finished, so the feedback
   ("Saving…" / "Saved") does not vanish when the pointer leaves the row. */
.q-actions-queue,
.q-actions-exports {
  display: none;
}

.q-item:hover .q-actions-queue,
.q-item:focus-within .q-actions-queue,
.q-item.active .q-actions-queue,
.q-item:hover .q-actions-exports,
.q-item:focus-within .q-actions-exports,
.q-item.has-export-state .q-actions-exports {
  display: flex;
}

/* Trade the duration for the action buttons while they are visible. */
.q-item:hover .q-duration,
.q-item:focus-within .q-duration,
.q-item.active .q-duration,
.q-item.has-export-state .q-duration {
  display: none;
}

.q-rename-input {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: 11px;
  background: #0d1417;
  color: #fff;
  border: 1px solid rgba(123, 225, 232, 0.6);
  border-radius: 3px;
  padding: 2px 5px;
  box-sizing: border-box;
}
</style>
