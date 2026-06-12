<script setup lang="ts">
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { QuaternionCorrectionMode } from '../../retargetCorrections';
import type { MappingView } from './retargetMappingModel';
import type { QuaternionEditorMode } from './retargetQuaternionTypes';
import type { RetargetLabDashboardEmits, RetargetLabDashboardProps } from './retargetLabDashboardTypes';
import RetargetSourcePanel from './RetargetSourcePanel.vue';
import RetargetSkeletonPreviewPanel from './RetargetSkeletonPreviewPanel.vue';
import BoneMappingPanel from './BoneMappingPanel.vue';
import RetargetTargetPanel from './RetargetTargetPanel.vue';
import RetargetReportDialog from './RetargetReportDialog.vue';

defineProps<RetargetLabDashboardProps>();

const infoModalOpen = defineModel<boolean>('infoModalOpen', { required: true });
const presetName = defineModel<string>('presetName', { required: true });
const selectedPresetId = defineModel<string>('selectedPresetId', { required: true });
const mappingView = defineModel<MappingView>('mappingView', { required: true });
const selectedBone = defineModel<VRMHumanBoneName>('selectedBone', { required: true });
const quaternionMode = defineModel<QuaternionEditorMode>('quaternionMode', { required: true });
const correctionMode = defineModel<QuaternionCorrectionMode>('correctionMode', { required: true });
const previewTime = defineModel<number>('previewTime', { required: true });
const quatPresetName = defineModel<string>('quatPresetName', { required: true });
const selectedQuatPresetId = defineModel<string>('selectedQuatPresetId', { required: true });

defineEmits<RetargetLabDashboardEmits>();
</script>

<template>
  <div class="retarget-lab">
    <RetargetSourcePanel
      v-model:preset-name="presetName"
      v-model:selected-preset-id="selectedPresetId"
      :current-file="currentFile"
      :analysis="analysis"
      :source-origin="sourceOrigin"
      :context-source-label="contextSourceLabel"
      :preview-status-label="previewStatusLabel"
      :active-correction-count="activeCorrectionCount"
      :last-import-message="lastImportMessage"
      :mapped-count="mappedCount"
      :slot-count="slotCount"
      :error="error"
      :presets="presets"
      :selected-preset="selectedPreset"
      @open-info="infoModalOpen = true"
      @analyze-file="$emit('analyzeFile', $event)"
      @back-to-player="$emit('backToPlayer')"
      @save-preset="$emit('savePreset')"
      @load-preset="$emit('loadPreset')"
      @delete-preset="$emit('deletePreset')"
      @export-preset="$emit('exportPreset')"
      @import-preset-file="$emit('importPresetFile', $event)"
    />

    <RetargetSkeletonPreviewPanel
      :source-preview="sourcePreview"
      :target-preview="targetPreview"
      :original-compare-preview="originalComparePreview"
      :corrected-compare-preview="correctedComparePreview"
      :active-correction-count="activeCorrectionCount"
    />

    <BoneMappingPanel
      v-model:mapping-view="mappingView"
      :mapping-view-options="mappingViewOptions"
      :visible-slots="visibleSlots"
      :source-options="sourceOptions"
      :mapping="mapping"
      :analysis="analysis"
      :loading="loading"
      :importing="importing"
      :required-missing-count="requiredMissingCount"
      :mapped-count="mappedCount"
      :slot-count="slotCount"
      @auto="$emit('autoMapping')"
      @clear="$emit('clearMapping')"
      @mapping-change="(slot, value) => $emit('mappingChange', slot, value)"
    />

    <RetargetTargetPanel
      v-model:selected-bone="selectedBone"
      v-model:quaternion-mode="quaternionMode"
      v-model:correction-mode="correctionMode"
      v-model:preview-time="previewTime"
      v-model:quat-preset-name="quatPresetName"
      v-model:selected-quat-preset-id="selectedQuatPresetId"
      :target-joints="targetJoints"
      :current-file="currentFile"
      :importing="importing"
      :can-import="canImport"
      :selected-quat-preset="selectedQuatPreset"
      :quat-presets="quatPresets"
      :quaternion-mode-options="quaternionModeOptions"
      :correction-mode-options="correctionModeOptions"
      :quat="quat"
      :euler-deg="eulerDeg"
      :axis-angle="axisAngle"
      :corrections="corrections"
      :active-correction-count="activeCorrectionCount"
      :preview-mode="previewMode"
      :previewing="previewing"
      :can-preview="canPreview"
      :preview-name="previewName"
      :preview-duration="previewDuration"
      @bone-change="$emit('boneChange')"
      @quat-field-change="(field, value) => $emit('quatFieldChange', field, value)"
      @euler-field-change="(field, value) => $emit('eulerFieldChange', field, value)"
      @axis-angle-field-change="(field, value) => $emit('axisAngleFieldChange', field, value)"
      @read="$emit('readQuaternion')"
      @apply="$emit('applyQuaternion')"
      @normalize="$emit('normalizeQuaternion')"
      @identity="$emit('identityQuaternion')"
      @invert="$emit('invertQuaternion')"
      @copy-json="$emit('copyQuaternionJson')"
      @paste-json="$emit('pasteQuaternionJson')"
      @add-correction="$emit('addCorrection')"
      @clear-corrections="$emit('clearCorrections')"
      @toggle-correction="$emit('toggleCorrection', $event)"
      @remove-correction="$emit('removeCorrection', $event)"
      @preview="$emit('preview', $event)"
      @seek-preview="$emit('seekPreview')"
      @stop-preview="$emit('stopPreview')"
      @save-quat-preset="$emit('saveQuatPreset')"
      @load-quat-preset="$emit('loadQuatPreset')"
      @delete-quat-preset="$emit('deleteQuatPreset')"
      @import-current="$emit('importCurrent')"
    />
  </div>

  <RetargetReportDialog
    v-model:visible="infoModalOpen"
    :summary-rows="summaryRows"
    :quaternion-rows="quaternionRows"
    :corrections="corrections"
    :active-correction-count="activeCorrectionCount"
    :mapping-rows="mappingRows"
    :mapped-count="mappedCount"
    :slot-count="slotCount"
    :analysis="analysis"
    :target-joints="targetJoints"
    @copy="$emit('copyReport')"
  />
</template>

<style scoped>
.retarget-lab {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(500px, 1.25fr) minmax(300px, 0.85fr);
  gap: 14px;
  width: min(1680px, 100%);
  margin: 0 auto;
  align-items: start;
}

@media (max-width: 1080px) {
  .retarget-lab {
    grid-template-columns: 1fr;
  }

  /* Single-column order follows the workflow: load source, map bones, tune
     and import. Skeleton previews are reference material and go last. */
  .retarget-lab :deep(.lab-source)  { order: 1; }
  .retarget-lab :deep(.lab-mapping) { order: 2; }
  .retarget-lab :deep(.lab-target)  { order: 3; }
  .retarget-lab :deep(.lab-preview) { order: 4; }
}
</style>
