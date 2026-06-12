<script setup lang="ts">
import type { SkeletonJointMeta } from '../../retargetLabModel';

defineProps<{
  targetJoints: SkeletonJointMeta[];
}>();
</script>

<template>
  <details class="joints-fold">
    <summary>
      <span>Current Target VRM</span>
      <small>{{ targetJoints.length }} humanoid bones</small>
    </summary>

    <div class="target-list">
      <div v-for="joint in targetJoints" :key="joint.id">
        <span>{{ joint.name }}</span>
        <small>{{ joint.parentId || 'root' }}</small>
      </div>
    </div>
  </details>
</template>

<style scoped>
.joints-fold {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
}

.joints-fold > summary {
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  font-weight: 700;
}

.joints-fold > summary::-webkit-details-marker {
  display: none;
}

.joints-fold > summary::after {
  content: '▾';
  font-size: 10px;
  opacity: 0.55;
  transform: rotate(-90deg);
  transition: transform 160ms ease;
}

.joints-fold[open] > summary::after {
  transform: rotate(0deg);
}

.joints-fold > summary small {
  flex: 1;
  text-align: right;
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.48);
}

.target-list {
  max-height: 320px;
  overflow: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.target-list div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
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
