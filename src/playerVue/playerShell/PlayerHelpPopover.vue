<script setup lang="ts">
import Button from 'primevue/button';

defineEmits<{
  close: [];
}>();
</script>

<template>
  <aside id="help-popover" aria-label="Shortcuts help">
    <div class="help-head">
      <span>Quick Help</span>
      <Button
        class="help-close"
        icon="pi pi-times"
        text
        rounded
        size="small"
        aria-label="Close help"
        @click="$emit('close')"
      />
    </div>
    <div class="help-section">
      <h2>Workflow</h2>
      <div class="help-row"><kbd>1</kbd><span>Show avatar</span></div>
      <div class="help-row"><kbd>2</kbd><span>Add animation or start capture</span></div>
      <div class="help-row"><kbd>3</kbd><span>Play, export, or open in Retarget Lab</span></div>
    </div>
    <div class="help-section">
      <h2>Shortcuts</h2>
      <div class="help-grid">
        <kbd>Space</kbd><span>Play / pause</span>
        <kbd>M</kbd><span>Model</span>
        <kbd>S</kbd><span>Skeleton</span>
        <kbd>D</kbd><span>Drag bones</span>
        <kbd>R</kbd><span>Reset drag</span>
        <kbd>Z</kbd><span>Zen view</span>
        <kbd>?</kbd><span>This panel</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
#help-popover {
  position: fixed;
  top: 54px;
  right: 16px;
  z-index: 35;
  width: 310px;
  padding: 12px;
  border-radius: 8px;
  pointer-events: auto;
  background: rgba(16, 16, 16, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.09);
  backdrop-filter: blur(10px);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.36);
}

.help-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.help-head span,
.help-section h2 {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.68);
}

:deep(.help-close.p-button) {
  width: 26px;
  height: 26px;
  color: rgba(255, 255, 255, 0.54);
}

.help-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.help-section + .help-section {
  margin-top: 12px;
}

.help-row,
.help-grid {
  color: rgba(255, 255, 255, 0.74);
  font-size: 12px;
  line-height: 1.35;
}

.help-row {
  display: grid;
  grid-template-columns: 28px 1fr;
  align-items: center;
  gap: 8px;
}

.help-grid {
  display: grid;
  grid-template-columns: 62px 1fr;
  align-items: center;
  gap: 6px 9px;
}

kbd {
  display: inline-flex;
  justify-content: center;
  min-width: 24px;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.78);
  font-family: var(--font-mono);
  font-size: 10px;
}
</style>
