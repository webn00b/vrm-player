<script setup lang="ts">
import Button from 'primevue/button';

defineProps<{
  previewMode: 'original' | 'corrected' | '';
  previewing: boolean;
  canPreview: boolean;
  previewName: string;
  previewDuration: number;
}>();

const previewTime = defineModel<number>('previewTime', { required: true });
const emit = defineEmits<{
  preview: [corrected: boolean];
  seek: [];
  stop: [];
}>();
</script>

<template>
  <div class="preview-controls">
    <div class="preview-title">
      <span>Preview</span>
      <small>{{ previewMode || 'idle' }}</small>
    </div>
    <div class="quat-actions">
      <Button
        label="Original"
        icon="pi pi-play"
        size="small"
        text
        :loading="previewing && previewMode === 'original'"
        :disabled="!canPreview"
        @click="emit('preview', false)"
      />
      <Button
        label="Corrected"
        icon="pi pi-check"
        size="small"
        :loading="previewing && previewMode === 'corrected'"
        :disabled="!canPreview"
        @click="emit('preview', true)"
      />
      <Button
        label="Stop"
        icon="pi pi-stop"
        size="small"
        text
        severity="secondary"
        :disabled="!previewName"
        @click="emit('stop')"
      />
    </div>
    <div class="preview-scrub">
      <input
        v-model.number="previewTime"
        type="range"
        min="0"
        :max="Math.max(previewDuration, 0)"
        step="0.01"
        :disabled="!previewName || previewDuration <= 0"
        @input="emit('seek')"
      />
      <span>{{ previewTime.toFixed(2) }} / {{ previewDuration.toFixed(2) }}s</span>
    </div>
    <div v-if="previewName" class="preview-name">{{ previewName }}</div>
  </div>
</template>

<style scoped>
.preview-controls {
  margin-top: 10px;
  border: 1px solid rgba(147, 180, 255, 0.14);
  border-radius: 7px;
  background: rgba(147, 180, 255, 0.06);
  padding: 8px;
}

.preview-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
}

.preview-title small,
.preview-name,
.preview-scrub span {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.52);
}

.quat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.preview-scrub {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.preview-scrub input {
  width: 100%;
}

.preview-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 6px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
</style>
