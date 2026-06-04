<script setup lang="ts">
import Button from 'primevue/button';
import type { RetargetLabAnalysis } from '../../retargetLabModel';
import MappingPresetsPanel from './MappingPresetsPanel.vue';
import RetargetSourceContextCard from './RetargetSourceContextCard.vue';
import RetargetSourceDropZone from './RetargetSourceDropZone.vue';
import RetargetSourceMessages from './RetargetSourceMessages.vue';
import RetargetSourceSummaryGrid from './RetargetSourceSummaryGrid.vue';
import type { RetargetPreset } from './retargetPresetStore';

defineProps<{
  currentFile: File | null;
  analysis: RetargetLabAnalysis | null;
  sourceOrigin: 'manual' | 'player';
  contextSourceLabel: string;
  previewStatusLabel: string;
  activeCorrectionCount: number;
  lastImportMessage: string;
  mappedCount: number;
  slotCount: number;
  error: string;
  presets: RetargetPreset[];
  selectedPreset: RetargetPreset | null;
}>();

const presetName = defineModel<string>('presetName', { required: true });
const selectedPresetId = defineModel<string>('selectedPresetId', { required: true });

const emit = defineEmits<{
  openInfo: [];
  analyzeFile: [file: File];
  backToPlayer: [];
  savePreset: [];
  loadPreset: [];
  deletePreset: [];
  exportPreset: [];
  importPresetFile: [event: Event];
}>();
</script>

<template>
  <section class="lab-pane lab-source">
    <div class="lab-heading">
      <h1>Retarget Lab</h1>
      <p>Inspect a source animation, tune its humanoid mapping, then add the retargeted clip to the player queue.</p>
    </div>
    <Button
      class="info-btn"
      label="Retarget info"
      icon="pi pi-info-circle"
      size="small"
      severity="secondary"
      outlined
      @click="emit('openInfo')"
    />

    <RetargetSourceContextCard
      v-if="currentFile"
      :file="currentFile"
      :source-origin="sourceOrigin"
      :context-source-label="contextSourceLabel"
      :preview-status-label="previewStatusLabel"
      :active-correction-count="activeCorrectionCount"
      :last-import-message="lastImportMessage"
      @back-to-player="emit('backToPlayer')"
    />

    <RetargetSourceDropZone
      :current-file-name="currentFile?.name ?? null"
      @analyze-file="emit('analyzeFile', $event)"
    />

    <RetargetSourceSummaryGrid
      v-if="analysis"
      :analysis="analysis"
      :mapped-count="mappedCount"
      :slot-count="slotCount"
    />

    <RetargetSourceMessages :warnings="analysis?.warnings ?? []" :error="error" />

    <MappingPresetsPanel
      v-model:preset-name="presetName"
      v-model:selected-preset-id="selectedPresetId"
      :presets="presets"
      :selected-preset="selectedPreset"
      :mapped-count="mappedCount"
      :slot-count="slotCount"
      @save="emit('savePreset')"
      @load="emit('loadPreset')"
      @delete="emit('deletePreset')"
      @export="emit('exportPreset')"
      @import-file="emit('importPresetFile', $event)"
    />
  </section>
</template>

<style scoped>
.lab-pane {
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(16, 16, 16, 0.92);
  padding: 14px;
}

.lab-source {
  grid-column: 1;
}

.lab-heading h1 {
  margin: 0 0 4px;
  font-size: 16px;
  letter-spacing: 0;
}

.lab-heading p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.58);
}

.info-btn {
  width: 100%;
  margin-top: 12px;
}

@media (max-width: 1080px) {
  .lab-source {
    grid-column: auto;
    grid-row: auto;
  }
}
</style>
