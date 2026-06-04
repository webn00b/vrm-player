<script setup lang="ts">
import type { SkeletonJointMeta } from '../../retargetLabModel';
import RetargetReportSection from './RetargetReportSection.vue';

defineProps<{
  sourceJoints: SkeletonJointMeta[];
  targetJoints: SkeletonJointMeta[];
}>();
</script>

<template>
  <RetargetReportSection class="report-two-cols">
    <div>
      <h3>Source Joints</h3>
      <div class="report-list">
        <div v-if="sourceJoints.length === 0">No source loaded</div>
        <div v-for="joint in sourceJoints" :key="joint.id">
          <span>{{ joint.name }}</span>
          <small>{{ joint.trackCount }} tracks</small>
        </div>
      </div>
    </div>
    <div>
      <h3>Target Joints</h3>
      <div class="report-list">
        <div v-for="joint in targetJoints" :key="joint.id">
          <span>{{ joint.name }}</span>
          <small>{{ joint.parentId || 'root' }}</small>
        </div>
      </div>
    </div>
  </RetargetReportSection>
</template>

<style scoped>
.report-two-cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

h3 {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0;
}

.report-list {
  max-height: 260px;
  overflow: auto;
  margin-top: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
}

.report-list div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 7px 8px;
  font-size: 11px;
}

.report-list div:first-child {
  border-top: 0;
}

.report-list small {
  color: rgba(255, 255, 255, 0.48);
  white-space: nowrap;
}

@media (max-width: 1080px) {
  .report-two-cols {
    grid-template-columns: 1fr;
  }
}
</style>
