<script setup lang="ts">
import type { MappingReportRow } from './retargetReportModel';
import RetargetReportSection from './RetargetReportSection.vue';

defineProps<{
  rows: MappingReportRow[];
  mappedCount: number;
  slotCount: number;
}>();
</script>

<template>
  <RetargetReportSection title="Mapping" :meta="`${mappedCount}/${slotCount}`">
    <table class="report-table">
      <thead>
        <tr>
          <th>Kind</th>
          <th>VRM Slot</th>
          <th>Source Bone</th>
          <th>Req</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.slot" :class="{ unmapped: !row.mapped && row.required }">
          <td>{{ row.kind }}</td>
          <td>{{ row.label }}</td>
          <td><code>{{ row.source || 'Unassigned' }}</code></td>
          <td>{{ row.required ? 'yes' : 'no' }}</td>
        </tr>
      </tbody>
    </table>
  </RetargetReportSection>
</template>

<style scoped>
.report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.report-table th,
.report-table td {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 7px 8px;
  text-align: left;
  vertical-align: top;
}

.report-table th {
  border-top: 0;
  color: rgba(255, 255, 255, 0.52);
  font-size: 10px;
  text-transform: uppercase;
}

.report-table code {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px;
  color: #dce7ff;
  white-space: normal;
  word-break: break-word;
}

.report-table tr.unmapped td {
  background: rgba(245, 158, 11, 0.08);
}
</style>
