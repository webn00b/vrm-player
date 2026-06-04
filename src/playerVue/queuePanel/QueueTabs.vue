<script setup lang="ts">
import Button from 'primevue/button';
import type { QueuePanelTab } from './queuePanelTypes';

const activeTab = defineModel<QueuePanelTab>('activeTab', { required: true });
</script>

<template>
  <div class="dbg-tabs">
    <Button
      class="dbg-tab"
      label="Queue"
      text
      :class="{ active: activeTab === 'queue' }"
      @click="activeTab = 'queue'"
    />
    <Button
      class="dbg-tab"
      label="Exports"
      text
      :class="{ active: activeTab === 'exports' }"
      @click="activeTab = 'exports'"
    />
  </div>
</template>

<style scoped>
.dbg-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.dbg-tab {
  flex: 1;
  background: transparent;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 5px 8px;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  opacity: 0.4;
  transition: opacity 120ms, border-color 120ms;
  font-family: inherit;
}

:deep(.dbg-tab.p-button) {
  justify-content: center;
  border-radius: 0;
}

.dbg-tab:hover {
  opacity: 0.7;
}

.dbg-tab.active {
  opacity: 1;
  border-bottom-color: #3b5bdb;
}
</style>
