<script setup lang="ts">
import type { QuaternionCorrection } from '../../retargetCorrections';
import RetargetReportSection from './RetargetReportSection.vue';

defineProps<{
  corrections: QuaternionCorrection[];
  activeCorrectionCount: number;
}>();
</script>

<template>
  <RetargetReportSection
    title="Quaternion Corrections"
    :meta="`${activeCorrectionCount}/${corrections.length} active`"
  >
    <table class="report-table">
      <thead>
        <tr>
          <th>State</th>
          <th>Bone</th>
          <th>Mode</th>
          <th>Quaternion</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="corrections.length === 0">
          <td colspan="4" class="empty-cell">No corrections</td>
        </tr>
        <tr v-for="correction in corrections" :key="correction.id">
          <td>
            <span class="status-pill" :class="{ off: !correction.enabled }">
              {{ correction.enabled ? 'ON' : 'OFF' }}
            </span>
          </td>
          <td>{{ correction.bone }}</td>
          <td>{{ correction.mode }}</td>
          <td><code>[{{ correction.q.map((n) => n.toFixed(5)).join(', ') }}]</code></td>
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

.status-pill {
  display: inline-flex;
  border-radius: 999px;
  padding: 2px 6px;
  background: rgba(34, 197, 94, 0.16);
  color: #86efac;
  font-size: 10px;
  font-weight: 700;
}

.status-pill.off {
  background: rgba(148, 163, 184, 0.12);
  color: rgba(255, 255, 255, 0.52);
}

.empty-cell {
  color: rgba(255, 255, 255, 0.48);
}
</style>
