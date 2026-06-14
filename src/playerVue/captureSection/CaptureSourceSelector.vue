<script setup lang="ts">
import type { CaptureSource, CaptureSourceOption } from './captureSectionTypes';

defineProps<{
  options: CaptureSourceOption[];
  currentSource: CaptureSource;
  caption: string;
}>();

const emit = defineEmits<{
  selectSource: [source: CaptureSource];
}>();
</script>

<template>
  <div
    class="capture-source"
    role="group"
    aria-label="Capture source"
    data-testid="capture-source"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="capture-src-btn"
      :aria-pressed="currentSource === option.value"
      :data-testid="`capture-src-${option.value}`"
      :title="option.hint"
      @click="emit('selectSource', option.value)"
    >
      <span class="capture-src-icon" aria-hidden="true">{{ option.icon }}</span>
      <span class="capture-src-label">{{ option.label }}</span>
    </button>
  </div>
  <div class="capture-preset-caption">{{ caption }}</div>
</template>

<style scoped>
.capture-source {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  width: 100%;
  margin-bottom: 8px;
}

.capture-src-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.62);
  border: 1px solid #2a2a2a;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-ui);
  padding: 9px 6px;
  cursor: pointer;
  transition: background 100ms, color 100ms, border-color 100ms;
}

.capture-src-icon {
  font-size: 17px;
  line-height: 1;
}

.capture-src-label {
  line-height: 1;
}

.capture-src-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e6e6e6;
}

.capture-src-btn[aria-pressed="true"] {
  background: #2a3550;
  border-color: #3b5bdb;
  color: #fff;
}

.capture-preset-caption {
  margin-bottom: 10px;
  font-size: 10px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.45);
}
</style>
