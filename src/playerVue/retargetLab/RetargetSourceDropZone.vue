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
    :class="{ active: dragActive }"
    @click="fileInput?.click()"
    @dragover.prevent="dragActive = true"
    @dragleave="dragActive = false"
    @drop.prevent="onDrop"
  >
    <i class="pi pi-upload" />
    <span>{{ currentFileName ?? 'Drop or choose .bvh / .fbx / .vrma' }}</span>
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

.hidden-input {
  display: none;
}
</style>
