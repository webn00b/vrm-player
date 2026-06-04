<script setup lang="ts">
import Checkbox from 'primevue/checkbox';

defineProps<{
  canExportAgentOgi: boolean;
}>();

const agentOgiExportEnabled = defineModel<boolean>('agentOgiExportEnabled', { required: true });
</script>

<template>
  <div class="exports-tools">
    <div class="title">File-to-file converters</div>
    <a href="/exports.html" target="_blank" rel="noopener" class="converter-link">
      Open converter window
    </a>
    <div class="hint">
      Standalone page - no avatar, lightweight. Supports
      <code>.fbx</code> / <code>.bvh</code> / <code>.glb</code> /
      <code>.gltf</code> / <code>.vrma</code> -> JSON.
    </div>
    <div class="title spaced">Per-clip downloads</div>
    <label v-if="canExportAgentOgi" class="agent-export-toggle">
      <Checkbox
        v-model="agentOgiExportEnabled"
        binary
        input-id="agent-ogi-export-toggle"
        data-testid="agent-ogi-export-toggle"
      />
      <span>Agent OGI JSON</span>
    </label>
    <div class="hint">
      Use BVH, GLB, or VRMA next to each item below.
      <span v-if="canExportAgentOgi">Enable Agent OGI JSON to create files for agent_ogi_front.</span>
    </div>
  </div>
</template>

<style scoped>
.exports-tools {
  font-size: 11px;
  margin-bottom: 8px;
  padding: 8px 10px;
  background: rgba(30, 188, 196, 0.07);
  border: 1px solid rgba(123, 225, 232, 0.12);
  border-radius: 6px;
}

.title {
  font-weight: 600;
  opacity: .7;
  margin-bottom: 4px;
}

.title.spaced {
  margin-top: 10px;
}

.hint {
  opacity: .55;
  font-size: 10px;
}

.agent-export-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  margin: 3px 0 5px;
  color: rgba(255, 255, 255, 0.86);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.converter-link {
  display: inline-block;
  padding: 6px 10px;
  margin: 4px 0;
  color: #fff;
  background: rgba(30, 188, 196, 0.72);
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
  font-size: 11px;
}

.converter-link:hover {
  background: #1ebcc4;
}

code {
  background: rgba(255, 255, 255, 0.07);
  padding: 0 4px;
  border-radius: 2px;
}
</style>
