<script setup lang="ts">
defineProps<{
  statusText: string;
  framesText: string;
  sourceInfo: string;
}>();
</script>

<template>
  <div class="capture-status">
    <span data-testid="mocap-status">{{ statusText }}</span>
    <span class="capture-frames" data-testid="mocap-frames">{{ framesText }}</span>
  </div>
  <div class="capture-status capture-source-info-row">
    <span class="capture-source-info">{{ sourceInfo }}</span>
  </div>
</template>

<style scoped>
.capture-status {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.capture-source-info-row {
  margin-top: -2px;
}

.capture-frames {
  opacity: .55;
}

.capture-source-info {
  opacity: .45;
  font-size: 10px;
}
</style>
