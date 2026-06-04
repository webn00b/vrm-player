<script setup lang="ts">
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import type { AppPage, UiMode } from './playerShellTypes';
import { modeOptions, pageOptions } from './playerShellTypes';

defineProps<{
  activePage: AppPage;
  uiMode: UiMode;
  zenMode: boolean;
  viewportCompact: boolean;
  helpOpen: boolean;
}>();

const emit = defineEmits<{
  setPage: [value: AppPage | null];
  setMode: [value: UiMode | null];
  toggleZen: [];
  toggleViewportCompact: [];
  toggleHelp: [];
}>();

function onPageUpdate(value: AppPage | null): void {
  emit('setPage', value);
}

function onModeUpdate(value: UiMode | null): void {
  emit('setMode', value);
}
</script>

<template>
  <div id="app-page-tabs">
    <SelectButton
      class="app-page-select"
      :modelValue="activePage"
      :options="pageOptions"
      optionLabel="label"
      optionValue="value"
      :allowEmpty="false"
      @update:modelValue="onPageUpdate"
    />
    <div class="shell-actions" v-show="activePage === 'player'">
      <SelectButton
        class="ui-mode-select"
        :modelValue="uiMode"
        :options="modeOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        aria-label="Player work mode"
        @update:modelValue="onModeUpdate"
      />
      <Button
        class="shell-action"
        :icon="zenMode ? 'pi pi-window-maximize' : 'pi pi-expand'"
        text
        rounded
        size="small"
        :aria-pressed="zenMode"
        title="Hide panels for scene preview"
        aria-label="Toggle zen preview"
        @click="emit('toggleZen')"
      />
      <Button
        class="shell-action viewport-compact-action"
        :icon="viewportCompact ? 'pi pi-window-maximize' : 'pi pi-window-minimize'"
        text
        rounded
        size="small"
        :aria-pressed="viewportCompact"
        :title="viewportCompact ? 'Restore viewport' : 'Shrink viewport to 256 x 256'"
        :aria-label="viewportCompact ? 'Restore viewport' : 'Shrink viewport'"
        @click="emit('toggleViewportCompact')"
      />
      <Button
        class="shell-action"
        icon="pi pi-question-circle"
        text
        rounded
        size="small"
        :aria-pressed="helpOpen"
        title="Shortcuts and workflow"
        aria-label="Open shortcuts help"
        @click="emit('toggleHelp')"
      />
    </div>
  </div>
</template>

<style scoped>
#app-page-tabs {
  position: fixed;
  top: 10px;
  left: 12px;
  z-index: 30;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.app-page-select {
  display: flex;
  padding: 3px;
  border-radius: 9px;
  background: rgba(16, 16, 16, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}

:deep(.app-page-select .p-togglebutton),
:deep(.ui-mode-select .p-togglebutton) {
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
  padding: 6px 12px;
}

:deep(.app-page-select .p-togglebutton-content),
:deep(.ui-mode-select .p-togglebutton-content) {
  background: transparent;
}

:deep(.app-page-select .p-togglebutton[data-p-checked="true"]),
:deep(.ui-mode-select .p-togglebutton[data-p-checked="true"]) {
  background: rgba(30, 188, 196, 0.18);
  color: #fff;
}

:deep(.app-page-select .p-togglebutton .p-togglebutton-content),
:deep(.ui-mode-select .p-togglebutton .p-togglebutton-content) {
  background: transparent !important;
}

:deep(.app-page-select .p-togglebutton),
:deep(.ui-mode-select .p-togglebutton) {
  background: transparent !important;
  color: rgba(255, 255, 255, 0.6) !important;
}

:deep(.app-page-select .p-togglebutton[data-p-checked="true"]),
:deep(.ui-mode-select .p-togglebutton[data-p-checked="true"]) {
  background: rgba(30, 188, 196, 0.18) !important;
  color: #fff !important;
}

:deep(.app-page-select .p-togglebutton[data-p-checked="true"] .p-togglebutton-label),
:deep(.ui-mode-select .p-togglebutton[data-p-checked="true"] .p-togglebutton-label) {
  color: #fff !important;
}

.shell-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 9px;
  background: rgba(16, 16, 16, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}

.ui-mode-select {
  display: flex;
}

:deep(.shell-action.p-button) {
  height: 30px;
  min-width: 30px;
  padding: 0 10px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.66);
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
}

:deep(.shell-action.p-button:hover) {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

:deep(.shell-action.p-button[aria-pressed="true"]) {
  background: #2a3550;
  color: #fff;
}

@media (max-width: 860px) {
  #app-page-tabs {
    left: 8px;
    right: 8px;
    transform: none;
    flex-direction: column;
    align-items: stretch;
  }

  .app-page-select {
    flex: 1;
    min-width: 0;
  }

  .shell-actions {
    flex-shrink: 0;
    width: 100%;
  }

  .ui-mode-select,
  :deep(.ui-mode-select .p-togglebutton) {
    flex: 1;
  }

  :deep(.app-page-select .p-togglebutton) {
    flex: 1;
    padding-inline: 8px;
  }

  :deep(.shell-action.p-button) {
    padding-inline: 8px;
  }
}

@media (max-width: 520px) {
  #app-page-tabs {
    gap: 5px;
  }

  :deep(.app-page-select .p-togglebutton) {
    font-size: 10px;
    padding-inline: 6px;
  }

  :deep(.shell-action.p-button) {
    min-width: 28px;
    font-size: 10px;
  }

  :deep(.ui-mode-select .p-togglebutton) {
    padding-inline: 7px;
    font-size: 10px;
  }

  :deep(.shell-action.p-button .p-button-label) {
    display: none;
  }
}
</style>
