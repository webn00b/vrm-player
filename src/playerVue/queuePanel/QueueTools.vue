<script setup lang="ts">
import Button from 'primevue/button';
import type { QueueLoopMode } from '../../animationController';

defineProps<{
  loopMode: QueueLoopMode;
  summary: string;
}>();

const emit = defineEmits<{
  toggleLoopMode: [];
  clearQueue: [];
}>();
</script>

<template>
  <div class="queue-tools">
    <Button
      class="queue-tool-btn queue-loop-btn"
      :class="{ active: loopMode === 'one' }"
      icon="pi pi-refresh"
      :label="loopMode === 'one' ? 'Loop one' : 'Loop queue'"
      text
      size="small"
      aria-label="Toggle loop mode"
      :title="loopMode === 'one' ? 'Repeat the current clip' : 'Play through the whole queue'"
      :aria-pressed="loopMode === 'one'"
      data-testid="queue-loop-toggle"
      @click="emit('toggleLoopMode')"
    />
    <span class="queue-summary">{{ summary }}</span>
    <Button
      class="queue-tool-btn"
      icon="pi pi-trash"
      label="Clear queue"
      text
      size="small"
      title="Remove every clip from the queue"
      @click="emit('clearQueue')"
    />
  </div>
</template>

<style scoped>
.queue-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -2px 0 6px;
}

:deep(.queue-tool-btn.p-button) {
  height: 24px;
  padding: 0 8px;
  color: rgba(255, 255, 255, 0.48);
  font-size: 10px;
  font-weight: 700;
}

:deep(.queue-tool-btn.p-button:hover) {
  color: #fca5a5;
  background: rgba(248, 113, 113, 0.1);
}

:deep(.queue-loop-btn.p-button) {
  color: rgba(255, 255, 255, 0.62);
}

:deep(.queue-loop-btn.p-button:hover),
:deep(.queue-loop-btn.p-button.active) {
  color: #b9fbff;
  background: rgba(30, 188, 196, 0.18);
}

.queue-summary {
  flex: 1;
  min-width: 0;
  color: rgba(255, 255, 255, 0.42);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
  white-space: nowrap;
}
</style>
