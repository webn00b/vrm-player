<script setup lang="ts">
import RetargetReportSection from './RetargetReportSection.vue';

defineProps<{
  warnings: string[];
}>();
</script>

<template>
  <RetargetReportSection title="Warnings">
    <div class="report-warning-list">
      <div v-if="warnings.length === 0">No warnings</div>
      <div v-for="warning in warnings" :key="warning">{{ warning }}</div>
    </div>
  </RetargetReportSection>
</template>

<style scoped>
.report-warning-list {
  margin-top: 10px;
  display: grid;
  gap: 6px;
}

.report-warning-list div {
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.12);
  color: #ffd796;
  padding: 8px;
  font-size: 11px;
}
</style>
