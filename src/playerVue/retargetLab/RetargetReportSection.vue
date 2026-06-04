<script setup lang="ts">
defineProps<{
  title?: string;
  meta?: string;
}>();
</script>

<template>
  <section class="report-section">
    <div v-if="title && meta" class="report-section-head">
      <h3>{{ title }}</h3>
      <span>{{ meta }}</span>
    </div>
    <h3 v-else-if="title">{{ title }}</h3>
    <slot />
  </section>
</template>

<style scoped>
.report-section {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  padding: 12px;
}

.report-section h3,
.report-section-head h3 {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0;
}

.report-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.report-section-head span {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.52);
}
</style>
