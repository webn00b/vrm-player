<script setup lang="ts">
import type { SkeletonJointMeta } from '../../retargetLabModel';

defineProps<{
  targetJoints: SkeletonJointMeta[];
}>();
</script>

<template>
  <div>
    <div class="section-title">
      <div>
        <h2>Current Target VRM</h2>
        <p>{{ targetJoints.length }} humanoid bones available</p>
      </div>
    </div>

    <div class="target-list">
      <div v-for="joint in targetJoints" :key="joint.id">
        <span>{{ joint.name }}</span>
        <small>{{ joint.parentId || 'root' }}</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.section-title h2 {
  margin: 0 0 4px;
  font-size: 16px;
  letter-spacing: 0;
}

.section-title p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.58);
}

.target-list {
  max-height: 420px;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

.target-list div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.target-list div:first-child {
  border-top: 0;
}

.target-list small {
  display: block;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.48);
  white-space: nowrap;
}
</style>
