<script setup lang="ts">
import { ref } from 'vue';
import { isRetargetLabFile } from '../../retargetLabModel';

defineProps<{
  currentFileName: string | null;
}>();

const emit = defineEmits<{
  analyzeFile: [file: File];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const dragActive = ref(false);

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) emit('analyzeFile', file);
  input.value = '';
}

function onDrop(event: DragEvent): void {
  dragActive.value = false;
  const file = Array.from(event.dataTransfer?.files ?? []).find(isRetargetLabFile);
  if (file) emit('analyzeFile', file);
}
</script>

<template>
  <button
    type="button"
    class="drop-zone"
    :class="{ active: dragActive, compact: currentFileName }"
    :title="currentFileName ? 'Drop or choose another .bvh / .fbx / .vrma file to replace the source' : undefined"
    @click="fileInput?.click()"
    @dragover.prevent="dragActive = true"
    @dragleave="dragActive = false"
    @drop.prevent="onDrop"
  >
    <i class="pi pi-upload" />
    <span>{{ currentFileName ? 'Replace source file' : 'Drop or choose .bvh / .fbx / .vrma' }}</span>
  </button>
  <input
    ref="fileInput"
    type="file"
    accept=".bvh,.fbx,.vrma"
    class="hidden-input"
    @change="onPick"
  />
</template>

<style scoped>
.drop-zone {
  width: 100%;
  min-height: 116px;
  margin-top: 14px;
  border-radius: 8px;
  border: 1px dashed rgba(147, 180, 255, 0.45);
  background: rgba(42, 53, 80, 0.24);
  color: #dce7ff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font: inherit;
}

.drop-zone.active {
  border-color: #93b4ff;
  background: rgba(59, 91, 219, 0.28);
}

/* Once a file is loaded its name lives in the context card above; the zone
   shrinks to a slim "replace" strip instead of a 116px billboard. */
.drop-zone.compact {
  flex-direction: row;
  gap: 8px;
  min-height: 0;
  margin-top: 10px;
  padding: 8px 10px;
  font-size: 11px;
  color: rgba(220, 231, 255, 0.75);
  background: rgba(42, 53, 80, 0.16);
  border-color: rgba(147, 180, 255, 0.3);
}

.drop-zone.compact:hover,
.drop-zone.compact.active {
  color: #dce7ff;
  border-color: #93b4ff;
}

.hidden-input {
  display: none;
}
</style>
