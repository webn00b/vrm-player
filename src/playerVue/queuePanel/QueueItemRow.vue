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
      },
    ]"
    :draggable="mode !== 'exportsOnly' && !renaming"
    @click="emit('itemClick', $event, queueIndex)"
    @dragstart="emit('dragStart', $event, queueIndex)"
    @dragend="emit('dragEnd')"
    @dragover="emit('dragOver', $event, queueIndex)"
    @drop="emit('drop', $event)"
  >
    <span class="q-num">{{ String(queueIndex + 1).padStart(2, '0') }}.</span>

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
      :title="item.rawName"
      @dblclick.stop="emit('startRename', queueIndex)"
    >{{ displayName(item.rawName) }}</span>
    <span class="q-duration">{{ formatDuration(item.duration) }}</span>

    <QueueExportActions
      v-if="showExports"
      :queue-index="queueIndex"
      :row-export-state="rowExportState"
      :agent-ogi-export-enabled="agentOgiExportEnabled"
      :on-export-vrma="onExportVrma"
      :on-export-bvh="onExportBvh"
      :on-export-glb="onExportGlb"
      :on-export-agent-ogi="onExportAgentOgi"
      @export="(index, kind, callback) => emit('export', index, kind, callback)"
    />
    <QueuePlaybackActions
      v-if="showQueueActions"
      :queue-index="queueIndex"
      :can-retarget="canRetarget"
      @jump="emit('jump', $event)"
      @duplicate="emit('duplicate', $event)"
      @retarget="emit('retarget', $event)"
      @remove="emit('remove', $event)"
    />
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
  box-shadow: 0 -2px 0 #3b5bdb;
}

.q-item.drop-after {
  box-shadow: 0 2px 0 #3b5bdb;
}

.q-num {
  opacity: 0.35;
  flex-shrink: 0;
  width: 18px;
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
</style>
