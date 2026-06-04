<script setup lang="ts">
defineProps<{
  warnings: string[];
  error: string;
}>();
</script>

<template>
  <div v-if="warnings.length" class="warning-list">
    <div v-for="warning in warnings" :key="warning">{{ warning }}</div>
  </div>
  <div v-if="error" class="error-box">{{ error }}</div>
</template>

<style scoped>
.warning-list,
.error-box {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  line-height: 1.35;
}

.warning-list div,
.error-box {
  border-radius: 6px;
  padding: 8px;
  background: rgba(245, 158, 11, 0.12);
  color: #ffd796;
}

.error-box {
  background: rgba(239, 68, 68, 0.14);
  color: #fecaca;
}
</style>
