<script setup lang="ts">
import Button from 'primevue/button';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { QuaternionCorrectionMode } from '../../retargetCorrections';
import { baseAnimationName } from '../../retargetLabModel';
import TargetJointsList from './TargetJointsList.vue';
import QuaternionEditorFields from './QuaternionEditorFields.vue';
import ClipCorrectionsPanel from './ClipCorrectionsPanel.vue';
import QuaternionPresetsPanel from './QuaternionPresetsPanel.vue';
import type { QuaternionEditorMode } from './retargetQuaternionTypes';
import type { RetargetTargetPanelEmits, RetargetTargetPanelProps } from './retargetTargetPanelTypes';

defineProps<RetargetTargetPanelProps>();

const selectedBone = defineModel<VRMHumanBoneName>('selectedBone', { required: true });
const quaternionMode = defineModel<QuaternionEditorMode>('quaternionMode', { required: true });
const correctionMode = defineModel<QuaternionCorrectionMode>('correctionMode', { required: true });
const previewTime = defineModel<number>('previewTime', { required: true });
const quatPresetName = defineModel<string>('quatPresetName', { required: true });
const selectedQuatPresetId = defineModel<string>('selectedQuatPresetId', { required: true });

defineEmits<RetargetTargetPanelEmits>();
</script>

<template>
  <section class="lab-pane lab-target">
    <TargetJointsList :target-joints="targetJoints" />

    <div class="quat-editor">
      <QuaternionEditorFields
        v-model:selected-bone="selectedBone"
        v-model:mode="quaternionMode"
        :target-joints="targetJoints"
        :mode-options="quaternionModeOptions"
        :quat="quat"
        :euler-deg="eulerDeg"
        :axis-angle="axisAngle"
        @bone-change="$emit('boneChange')"
        @quat-field-change="(field, value) => $emit('quatFieldChange', field, value)"
        @euler-field-change="(field, value) => $emit('eulerFieldChange', field, value)"
        @axis-angle-field-change="(field, value) => $emit('axisAngleFieldChange', field, value)"
        @read="$emit('read')"
        @apply="$emit('apply')"
        @normalize="$emit('normalize')"
        @identity="$emit('identity')"
        @invert="$emit('invert')"
        @copy-json="$emit('copyJson')"
        @paste-json="$emit('pasteJson')"
      />

      <ClipCorrectionsPanel
        v-model:correction-mode="correctionMode"
        v-model:preview-time="previewTime"
        :correction-mode-options="correctionModeOptions"
        :corrections="corrections"
        :active-correction-count="activeCorrectionCount"
        :preview-mode="previewMode"
        :previewing="previewing"
        :can-preview="canPreview"
        :preview-name="previewName"
        :preview-duration="previewDuration"
        @add-correction="$emit('addCorrection')"
        @clear-corrections="$emit('clearCorrections')"
        @toggle-correction="$emit('toggleCorrection', $event)"
        @remove-correction="$emit('removeCorrection', $event)"
        @preview="$emit('preview', $event)"
        @seek-preview="$emit('seekPreview')"
        @stop-preview="$emit('stopPreview')"
      />

      <QuaternionPresetsPanel
        v-model:preset-name="quatPresetName"
        v-model:selected-preset-id="selectedQuatPresetId"
        :presets="quatPresets"
        :selected-preset="selectedQuatPreset"
        @save="$emit('saveQuatPreset')"
        @load="$emit('loadQuatPreset')"
        @delete="$emit('deleteQuatPreset')"
      />
    </div>

    <Button
      class="import-btn"
      :label="importing ? 'Retargeting…' : `Add ${currentFile ? baseAnimationName(currentFile.name) : 'clip'} to queue`"
      icon="pi pi-plus"
      :loading="importing"
      :disabled="!canImport"
      @click="$emit('importCurrent')"
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

.lab-target {
  grid-column: 3;
  grid-row: 1 / span 2;
}

.quat-editor {
  margin-top: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  padding: 10px;
}

.import-btn {
  width: 100%;
  margin-top: 12px;
}

@media (max-width: 1080px) {
  .lab-target {
    grid-column: auto;
    grid-row: auto;
  }
}
</style>
