<script setup lang="ts">
import type { SummaryRow } from './retargetReportModel';
import RetargetReportSection from './RetargetReportSection.vue';

defineProps<{
  title: string;
  rows: SummaryRow[];
}>();
</script>

<template>
  <RetargetReportSection :title="title">
    <div class="report-kv-table">
      <div v-for="row in rows" :key="row.label">
        <span>{{ row.label }}</span>
        <code>{{ row.value }}</code>
      </div>
    </div>
  </RetargetReportSection>
</template>

<style scoped>
.report-kv-table {
  margin-top: 10px;
  display: grid;
  gap: 6px;
}

.report-kv-table div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  font-size: 11px;
}

.report-kv-table span {
  color: rgba(255, 255, 255, 0.52);
}

.report-kv-table code {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px;
  color: #dce7ff;
  white-space: normal;
  word-break: break-word;
}
</style>
