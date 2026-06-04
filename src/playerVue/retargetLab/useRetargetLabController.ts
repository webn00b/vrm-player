import { reactive, ref } from 'vue';
import { useToast } from 'primevue/usetoast';
import { RETARGET_BONE_SLOTS } from '../../retargetLabModel';
import { useRetargetQuaternionEditor } from './useRetargetQuaternionEditor';
import { useRetargetClipWorkflow } from './useRetargetClipWorkflow';
import { useRetargetPresets } from './useRetargetPresets';
import { useRetargetQuaternionPresets } from './useRetargetQuaternionPresets';
import { useRetargetCorrections } from './useRetargetCorrections';
import { useRetargetReport } from './useRetargetReport';
import { useRetargetMappingView } from './useRetargetMappingView';
import { useRetargetSkeletonPreviews } from './useRetargetSkeletonPreviews';
import { useRetargetQuaternionClipboard } from './useRetargetQuaternionClipboard';
import { useRetargetNavigationEvents } from './useRetargetNavigationEvents';
import type { RetargetLabProps } from './retargetLabProps';

export type RetargetLabControllerOptions = RetargetLabProps;

export function useRetargetLabController(options: RetargetLabControllerOptions) {
  const infoModalOpen = ref(false);
  const toast = useToast();

  const quaternionEditor = useRetargetQuaternionEditor(options.vrm);
  const corrections = useRetargetCorrections({
    selectedBone: quaternionEditor.selectedQuatBone,
    quaternionFromEditor: quaternionEditor.quaternionFromEditor,
    toast,
  });
  const clipWorkflow = useRetargetClipWorkflow({
    vrm: options.vrm,
    activeCorrections: corrections.activeCorrections,
    onImport: options.onImport,
    onPreview: options.onPreview,
    onPreviewSeek: options.onPreviewSeek,
    onPreviewStop: options.onPreviewStop,
  });
  const quaternionPresets = useRetargetQuaternionPresets({
    selectedBone: quaternionEditor.selectedQuatBone,
    quat: quaternionEditor.quat,
    setQuaternionFields: quaternionEditor.setQuaternionFields,
    toast,
  });
  const quaternionClipboard = useRetargetQuaternionClipboard({
    selectedBone: quaternionEditor.selectedQuatBone,
    quat: quaternionEditor.quat,
    eulerDeg: quaternionEditor.eulerDeg,
    setQuaternionFields: quaternionEditor.setQuaternionFields,
    toast,
  });
  const mappingViewState = useRetargetMappingView({
    slots: RETARGET_BONE_SLOTS,
    mapping: clipWorkflow.mapping,
  });
  const presets = useRetargetPresets({
    currentFile: clipWorkflow.currentFile,
    analysis: clipWorkflow.analysis,
    mapping: clipWorkflow.mapping,
    mappedCount: mappingViewState.mappedCount,
    slotCount: RETARGET_BONE_SLOTS.length,
    toast,
  });
  const skeletonPreviews = useRetargetSkeletonPreviews({
    analysis: clipWorkflow.analysis,
    targetJoints: clipWorkflow.targetJoints,
    mappedSourceNames: mappingViewState.mappedSourceNames,
    mappedTargetNames: mappingViewState.mappedTargetNames,
    missingTargetNames: mappingViewState.missingTargetNames,
    activeCorrectionBones: corrections.activeCorrectionBones,
    quaternionCorrections: corrections.quaternionCorrections,
  });
  const report = useRetargetReport({
    currentFile: clipWorkflow.currentFile,
    analysis: clipWorkflow.analysis,
    slots: RETARGET_BONE_SLOTS,
    mapping: clipWorkflow.mapping,
    targetJoints: clipWorkflow.targetJoints,
    mappedCount: mappingViewState.mappedCount,
    extraMappedEntries: mappingViewState.extraMappedEntries,
    missingRequiredLabels: mappingViewState.missingRequiredLabels,
    activeCorrectionCount: corrections.activeCorrectionCount,
    quaternionCorrections: corrections.quaternionCorrections,
    selectedQuatBone: quaternionEditor.selectedQuatBone,
    quaternionMode: quaternionEditor.quaternionMode,
    quat: quaternionEditor.quat,
    eulerDeg: quaternionEditor.eulerDeg,
    axisAngle: quaternionEditor.axisAngle,
    quatPresets: quaternionPresets.quatPresets,
    toast,
  });
  const navigation = useRetargetNavigationEvents({
    analyze: clipWorkflow.analyze,
    toast,
  });

  return reactive({
    slotCount: RETARGET_BONE_SLOTS.length,
    infoModalOpen,
    ...quaternionEditor,
    ...corrections,
    ...clipWorkflow,
    ...quaternionPresets,
    ...quaternionClipboard,
    ...mappingViewState,
    ...presets,
    ...skeletonPreviews,
    ...report,
    ...navigation,
  });
}
