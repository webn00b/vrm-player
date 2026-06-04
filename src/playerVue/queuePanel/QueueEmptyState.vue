<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import Button from 'primevue/button';
import type { QueuePanelMode } from './queuePanelTypes';

const props = defineProps<{
  mode?: QueuePanelMode;
}>();

const addInputRef = useTemplateRef<HTMLInputElement>('addInput');
const emptyDropActive = ref(false);
const emptyText = computed(() => (
  props.mode === 'exportsOnly'
    ? 'Load animations on the Player page'
    : 'Drag animations here'
));

function hasDraggedFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.items ?? []).some((item) => item.kind === 'file');
}

function openAddPicker(): void {
  addInputRef.value?.click();
}

function dispatchFiles(files: File[]): void {
  if (files.length === 0) return;
  window.dispatchEvent(new CustomEvent<File[]>('vrm-player:add-animation-files', { detail: files }));
}

function onAddFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  dispatchFiles(files);
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
  dispatchFiles(Array.from(e.dataTransfer?.files ?? []));
}
</script>

<template>
  <input
    ref="addInput"
    type="file"
    accept=".bvh,.vrma,.fbx"
    multiple
    hidden
    @change="onAddFileChange"
  />
  <div
    class="queue-empty"
    :class="{ 'drag-over': emptyDropActive }"
    @dragenter.prevent.stop="onEmptyDragOver"
    @dragover.prevent.stop="onEmptyDragOver"
    @dragleave="onEmptyDragLeave"
    @drop.prevent.stop="onEmptyDrop"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M12 5v14M5 12l7-7 7 7" />
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
</template>

<style scoped>
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
