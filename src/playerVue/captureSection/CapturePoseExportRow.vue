<script setup lang="ts">
import Button from 'primevue/button';

defineProps<{
  title: string;
  bvhLabel: string;
  bvhTitle: string;
  bvhDisabled: boolean;
  jsonLabel: string;
  jsonTitle: string;
  jsonDisabled: boolean;
}>();

const emit = defineEmits<{
  exportPose: [];
  exportPoseWithJson: [];
}>();
</script>

<template>
  <div class="capture-single-pose-row" data-testid="single-pose-block">
    <span class="capture-single-pose-title" data-testid="single-pose-label">{{ title }}</span>
    <Button
      class="dbg-toggle off capture-pose-button"
      :disabled="bvhDisabled"
      :label="bvhLabel"
      :title="bvhTitle"
      text
      size="small"
      @click="emit('exportPose')"
    />
    <Button
      class="dbg-toggle off capture-pose-button"
      :disabled="jsonDisabled"
      :label="jsonLabel"
      :title="jsonTitle"
      text
      size="small"
      @click="emit('exportPoseWithJson')"
    />
  </div>
</template>

<style scoped>
.capture-single-pose-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding: 7px;
  border: 1px solid lightgray;
  border-radius: 5px;
}

.capture-single-pose-title {
  flex: 1 1 100%;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-transform: lowercase;
}

:deep(.p-button.capture-pose-button) {
  color: #fff;
  font-size: 10px;
  min-height: 24px;
  padding: 1px 6px;
}

:deep(.p-button.capture-pose-button .p-button-label) {
  color: #fff;
  font-size: 10px;
}
</style>
