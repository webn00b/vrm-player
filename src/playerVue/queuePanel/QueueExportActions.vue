<script setup lang="ts">
import Button from 'primevue/button';
import type { ExportCallback, ExportKind, RowExportState } from './queuePanelTypes';

const props = defineProps<{
  queueIndex: number;
  rowExportState: RowExportState | null;
  agentOgiExportEnabled: boolean;
  onExportVrma?: ExportCallback;
  onExportBvh?: ExportCallback;
  onExportGlb?: ExportCallback;
  onExportAgentOgi?: ExportCallback;
}>();

const emit = defineEmits<{
  export: [queueIndex: number, kind: ExportKind, callback?: ExportCallback];
}>();

function isExporting(kind?: ExportKind): boolean {
  return props.rowExportState?.phase === 'loading' && (!kind || props.rowExportState.kind === kind);
}

function exportButtonClass(kind: ExportKind): Record<string, boolean> {
  const state = props.rowExportState;
  return {
    'export-loading': state?.phase === 'loading' && state.kind === kind,
    'export-done': state?.phase === 'done' && state.kind === kind,
    'export-error': state?.phase === 'error' && state.kind === kind,
  };
}

function exportKindLabel(kind: ExportKind): string {
  if (kind === 'agent') return 'AGENT';
  return kind === 'vrma' ? 'VRMA' : kind.toUpperCase();
}

function exportStatusText(): string {
  const state = props.rowExportState;
  if (!state) return '';
  const label = exportKindLabel(state.kind);
  if (state.phase === 'loading') return `Saving ${label}`;
  if (state.phase === 'done') return `Saved ${label}`;
  return `Failed ${label}`;
}

function exportStatusClass(): string {
  const state = props.rowExportState;
  return state ? `export-status-${state.phase}` : '';
}
</script>

<template>
  <Button
    v-if="onExportBvh"
    class="q-action q-export-bvh"
    :class="exportButtonClass('bvh')"
    label="BVH"
    text
    size="small"
    :disabled="isExporting()"
    :loading="isExporting('bvh')"
    aria-label="Record this clip as BVH"
    title="Export this clip as BVH"
    @click.stop="emit('export', queueIndex, 'bvh', onExportBvh)"
  />
  <Button
    v-if="onExportGlb"
    class="q-action q-export-glb"
    :class="exportButtonClass('glb')"
    label="GLB"
    text
    size="small"
    :disabled="isExporting()"
    :loading="isExporting('glb')"
    aria-label="Download as glTF/GLB"
    title="Export this clip as GLB"
    @click.stop="emit('export', queueIndex, 'glb', onExportGlb)"
  />
  <Button
    v-if="onExportVrma"
    class="q-action q-export"
    :class="exportButtonClass('vrma')"
    label="VRMA"
    text
    size="small"
    :disabled="isExporting()"
    :loading="isExporting('vrma')"
    aria-label="Download as VRMA"
    title="Export this clip as VRMA"
    @click.stop="emit('export', queueIndex, 'vrma', onExportVrma)"
  />
  <Button
    v-if="onExportAgentOgi && agentOgiExportEnabled"
    class="q-action q-export-agent"
    :class="exportButtonClass('agent')"
    label="AGENT"
    text
    size="small"
    :disabled="isExporting()"
    :loading="isExporting('agent')"
    aria-label="Download agent_ogi_front JSON"
    title="Export this clip as agent_ogi_front JSON"
    data-testid="agent-ogi-export-button"
    @click.stop="emit('export', queueIndex, 'agent', onExportAgentOgi)"
  />
  <span
    v-if="exportStatusText()"
    class="q-export-status"
    :class="exportStatusClass()"
  >{{ exportStatusText() }}</span>
</template>

<style scoped>
.q-export-status {
  flex-shrink: 0;
  min-width: 62px;
  color: rgba(255, 255, 255, 0.48);
  font-size: 10px;
  font-family: var(--font-mono);
  white-space: nowrap;
}

.q-export-status.export-status-loading {
  color: #bfdbfe;
}

.q-export-status.export-status-done {
  color: #86efac;
}

.q-export-status.export-status-error {
  color: #fca5a5;
}

.q-action {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid #444;
  color: #aaa;
  border-radius: 3px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  font-family: inherit;
}

:deep(.q-action.p-button) {
  min-width: 0;
  height: 18px;
}

.q-action:hover {
  background: #2a3550;
  color: #fff;
  border-color: #3b5bdb;
}

.q-export-bvh,
.q-export-glb,
.q-export-agent,
.q-export {
  font-size: 9px;
  padding: 0 5px;
  letter-spacing: 0.05em;
}

.q-action.export-loading {
  color: #b9fbff;
  border-color: rgba(123, 225, 232, 0.42);
  background: rgba(30, 188, 196, 0.14);
}

.q-action.export-done {
  color: #86efac;
  border-color: rgba(134, 239, 172, 0.36);
  background: rgba(34, 197, 94, 0.12);
}

.q-action.export-error {
  color: #fca5a5;
  border-color: rgba(252, 165, 165, 0.4);
  background: rgba(248, 113, 113, 0.12);
}
</style>
