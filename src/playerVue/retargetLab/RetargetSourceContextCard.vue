<script setup lang="ts">
import Button from 'primevue/button';

defineProps<{
  file: File;
  sourceOrigin: 'manual' | 'player';
  contextSourceLabel: string;
  previewStatusLabel: string;
  activeCorrectionCount: number;
  lastImportMessage: string;
}>();

const emit = defineEmits<{
  backToPlayer: [];
}>();
</script>

<template>
  <div class="source-context" :class="{ fromPlayer: sourceOrigin === 'player' }">
    <div class="source-context-main">
      <span>{{ contextSourceLabel }}</span>
      <strong>{{ file.name }}</strong>
    </div>
    <div class="source-context-meta">
      <span>{{ previewStatusLabel }}</span>
      <span v-if="activeCorrectionCount">{{ activeCorrectionCount }} corrections</span>
      <span v-if="lastImportMessage">{{ lastImportMessage }}</span>
    </div>
    <Button
      v-if="sourceOrigin === 'player'"
      class="back-player-btn"
      label="Back to Player"
      icon="pi pi-arrow-left"
      size="small"
      text
      @click="emit('backToPlayer')"
    />
  </div>
</template>

<style scoped>
.source-context {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 10px;
  align-items: center;
  margin-top: 10px;
  padding: 9px 10px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.source-context.fromPlayer {
  border-color: rgba(147, 197, 253, 0.22);
  background: rgba(59, 91, 219, 0.12);
}

.source-context-main {
  min-width: 0;
}

.source-context-main span,
.source-context-meta {
  color: rgba(255, 255, 255, 0.52);
  font-size: 10px;
}

.source-context-main span {
  display: block;
  margin-bottom: 3px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.source-context-main strong {
  display: block;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-context-meta {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.source-context-meta span {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 7px;
}

:deep(.back-player-btn.p-button) {
  align-self: start;
  color: #bfdbfe;
  font-size: 11px;
  font-weight: 700;
}
</style>
