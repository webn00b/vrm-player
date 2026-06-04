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
      @click="emit('selectSource', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
  <div class="capture-preset-caption">{{ caption }}</div>
</template>

<style scoped>
.capture-source {
  display: flex;
  width: 100%;
  margin-bottom: 5px;
}

.capture-src-btn {
  flex: 1;
  border-radius: 0;
  background: transparent;
  color: #ccc;
  border: 1px solid #2a2a2a;
  border-right: 0;
  font-size: 11px;
  font-family: var(--font-ui);
  padding: 6px;
  cursor: pointer;
  transition: background 100ms, color 100ms;
}

.capture-src-btn:first-child {
  border-radius: 5px 0 0 5px;
}

.capture-src-btn:last-child {
  border-radius: 0 5px 5px 0;
  border-right: 1px solid #2a2a2a;
}

.capture-src-btn:hover {
  background: #1c1c1c;
}

.capture-src-btn[aria-pressed="true"] {
  background: #2a3550;
  color: #fff;
}

.capture-preset-caption {
  margin-bottom: 8px;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.42);
}
</style>
