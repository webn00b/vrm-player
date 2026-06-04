<script setup lang="ts">
import type { RetargetLabAnalysis } from '../../retargetLabModel';

defineProps<{
  analysis: RetargetLabAnalysis;
  mappedCount: number;
  slotCount: number;
}>();
</script>

<template>
  <div class="summary-grid">
    <div>
      <span>Format</span>
      <strong>{{ analysis.format.toUpperCase() }}</strong>
    </div>
    <div>
      <span>Clips</span>
      <strong>{{ analysis.clipCount }}</strong>
    </div>
    <div>
      <span>Duration</span>
      <strong>{{ analysis.duration.toFixed(2) }}s</strong>
    </div>
    <div>
      <span>Mapped</span>
      <strong>{{ mappedCount }}/{{ slotCount }}</strong>
    </div>
  </div>
</template>

<style scoped>
.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.summary-grid div {
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  padding: 8px;
}

.summary-grid span {
  display: block;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.48);
}

.summary-grid strong {
  display: block;
  margin-top: 3px;
  font-size: 13px;
}
</style>
