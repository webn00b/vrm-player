<script setup lang="ts">
import Checkbox from 'primevue/checkbox';

defineProps<{
  canExportAgentOgi: boolean;
}>();

const agentOgiExportEnabled = defineModel<boolean>('agentOgiExportEnabled', { required: true });
</script>

<template>
  <div class="exports-tools">
    <div class="exports-tools-row">
      <a
        href="/exports.html"
        target="_blank"
        rel="noopener"
        class="converter-link"
        title="Standalone converter page — no avatar, lightweight. Converts .fbx / .bvh / .glb / .gltf / .vrma to JSON."
      >
        Converter window
        <i class="pi pi-external-link" />
      </a>
      <label
        v-if="canExportAgentOgi"
        class="agent-export-toggle"
        title="Enable to create JSON files for agent_ogi_front"
      >
        <Checkbox
          v-model="agentOgiExportEnabled"
          binary
          input-id="agent-ogi-export-toggle"
          data-testid="agent-ogi-export-toggle"
        />
        <span>Agent OGI</span>
      </label>
    </div>
    <div class="hint">Hover a clip below for BVH / GLB / VRMA downloads.</div>
  </div>
</template>

<style scoped>
.exports-tools {
  font-size: 11px;
  margin-bottom: 8px;
}

.exports-tools-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.hint {
  opacity: .5;
  font-size: 10px;
  margin-top: 4px;
}

.agent-export-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  color: rgba(255, 255, 255, 0.86);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.converter-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 7px;
  color: #b9fbff;
  background: rgba(30, 188, 196, 0.16);
  border: 1px solid rgba(123, 225, 232, 0.28);
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
  font-size: 10px;
  white-space: nowrap;
}

.converter-link:hover {
  background: rgba(30, 188, 196, 0.32);
}

.converter-link .pi {
  font-size: 9px;
  opacity: 0.7;
}
</style>
