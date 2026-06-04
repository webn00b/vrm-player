import { computed, type ComputedRef, type Ref } from 'vue';
import type { ToastServiceMethods } from 'primevue/toastservice';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import type { QuaternionCorrection } from '../../retargetCorrections';
import type { RetargetLabAnalysis, SkeletonJointMeta } from '../../retargetLabModel';
import {
  buildCurrentQuaternionRows,
  buildReportMappingRows,
  buildReportSummary,
  buildRetargetInfoText,
  type RetargetSlot,
} from './retargetReportModel';
import type { QuaternionPreset } from './retargetPresetStore';

interface UseRetargetReportOptions {
  currentFile: Ref<File | null>;
  analysis: Ref<RetargetLabAnalysis | null>;
  slots: RetargetSlot[];
  mapping: Ref<ManualFbxBoneMapping>;
  targetJoints: ComputedRef<SkeletonJointMeta[]>;
  mappedCount: ComputedRef<number>;
  extraMappedEntries: ComputedRef<Array<[VRMHumanBoneName, string]>>;
  missingRequiredLabels: ComputedRef<string[]>;
  activeCorrectionCount: ComputedRef<number>;
  quaternionCorrections: Ref<QuaternionCorrection[]>;
  selectedQuatBone: Ref<VRMHumanBoneName>;
  quaternionMode: Ref<string>;
  quat: { x: number; y: number; z: number; w: number };
  eulerDeg: { x: number; y: number; z: number };
  axisAngle: { x: number; y: number; z: number; angle: number };
  quatPresets: Ref<QuaternionPreset[]>;
  toast: ToastServiceMethods;
}

export function useRetargetReport(options: UseRetargetReportOptions) {
  const quaternionReportState = computed(() => ({
    selectedBone: options.selectedQuatBone.value,
    mode: options.quaternionMode.value,
    quat: options.quat,
    eulerDeg: options.eulerDeg,
    axisAngle: options.axisAngle,
  }));
  const reportSummary = computed(() => buildReportSummary({
    currentFileName: options.currentFile.value?.name ?? null,
    analysis: options.analysis.value,
    targetJointCount: options.targetJoints.value.length,
    mappedCount: options.mappedCount.value,
    slotCount: options.slots.length,
    missingRequiredLabels: options.missingRequiredLabels.value,
    activeCorrectionCount: options.activeCorrectionCount.value,
    correctionCount: options.quaternionCorrections.value.length,
  }));
  const reportMappingRows = computed(() => buildReportMappingRows(options.slots, options.mapping.value));
  const currentQuaternionRows = computed(() => buildCurrentQuaternionRows(quaternionReportState.value));
  const retargetInfoText = computed(() => buildRetargetInfoText({
    currentFileName: options.currentFile.value?.name ?? null,
    analysis: options.analysis.value,
    slots: options.slots,
    mapping: options.mapping.value,
    targetJoints: options.targetJoints.value,
    mappedCount: options.mappedCount.value,
    extraMappedEntries: options.extraMappedEntries.value,
    missingRequiredLabels: options.missingRequiredLabels.value,
    editor: quaternionReportState.value,
    corrections: options.quaternionCorrections.value,
    quaternionPresets: options.quatPresets.value,
  }));

  async function copyRetargetInfo(): Promise<void> {
    try {
      await navigator.clipboard.writeText(retargetInfoText.value);
      options.toast.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'Retarget report copied to clipboard',
        life: 2000,
      });
    } catch (e) {
      options.toast.add({
        severity: 'error',
        summary: 'Copy failed',
        detail: (e as Error).message,
        life: 3000,
      });
    }
  }

  return {
    reportSummary,
    reportMappingRows,
    currentQuaternionRows,
    copyRetargetInfo,
  };
}
