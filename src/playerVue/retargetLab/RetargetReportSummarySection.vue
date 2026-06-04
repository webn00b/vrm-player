<script setup lang="ts">
import type { SummaryRow } from './retargetReportModel';
import RetargetReportSection from './RetargetReportSection.vue';

defineProps<{
  rows: SummaryRow[];
}>();
</script>

<template>
  <RetargetReportSection title="Summary">
    <div class="report-summary-grid">
      <div v-for="item in rows" :key="item.label" class="report-card">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </div>
    </div>
  </RetargetReportSection>
</template>

<style scoped>
.report-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.report-card {
  min-width: 0;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.22);
  padding: 8px;
}

.report-card span {
  display: block;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.48);
}

.report-card strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 3px;
  font-size: 12px;
}

@media (max-width: 1080px) {
  .report-summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
