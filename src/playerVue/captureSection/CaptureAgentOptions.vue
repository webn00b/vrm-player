<script setup lang="ts">
import Checkbox from 'primevue/checkbox';

const agentOgiEnabled = defineModel<boolean>('agentOgiEnabled', { required: true });
const validationEnabled = defineModel<boolean>('validationEnabled', { required: true });
</script>

<template>
  <div class="capture-agent-options">
    <label class="capture-agent-toggle">
      <Checkbox
        v-model="agentOgiEnabled"
        binary
        input-id="capture-video-agent-ogi"
        data-testid="capture-video-agent-ogi-toggle"
      />
      <span>agent_ogi_front JSON</span>
    </label>
    <label class="capture-agent-toggle capture-agent-validation-toggle">
      <Checkbox
        v-model="validationEnabled"
        binary
        input-id="capture-video-agent-ogi-validation"
        data-testid="capture-video-agent-ogi-validation-toggle"
      />
      <span>validation</span>
    </label>
  </div>
</template>

<style scoped>
.capture-agent-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 8px;
}

.capture-agent-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  margin: 0;
  padding: 5px 7px;
  color: rgba(255, 255, 255, 0.86);
  background: rgba(30, 188, 196, 0.12);
  border: 1px solid rgba(123, 225, 232, 0.18);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.capture-agent-validation-toggle {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.16);
}
</style>
