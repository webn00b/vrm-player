import { computed, ref, type ComputedRef } from 'vue';
import type { VRM } from '@pixiv/three-vrm';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import type { QuaternionCorrection } from '../../retargetCorrections';
import {
  analyzeRetargetLabFile,
  getRetargetTargetJoints,
  isRetargetLabFile,
  type RetargetLabAnalysis,
} from '../../retargetLabModel';
import {
  buildContextSourceLabel,
  buildPreviewStatusLabel,
  canImportClip,
  canPreviewClip,
  startedPreviewState,
  stoppedPreviewState,
  type SourceOrigin,
} from './retargetClipWorkflowModel';

interface UseRetargetClipWorkflowOptions {
  vrm: VRM;
  activeCorrections: ComputedRef<QuaternionCorrection[]>;
  onImport: (
    file: File,
    manualMapping: ManualFbxBoneMapping,
    quaternionCorrections?: QuaternionCorrection[],
  ) => Promise<void>;
  onPreview?: (
    file: File,
    manualMapping: ManualFbxBoneMapping,
    quaternionCorrections: QuaternionCorrection[],
    corrected: boolean,
  ) => Promise<{ name: string; duration: number }>;
  onPreviewSeek?: (seconds: number) => void;
  onPreviewStop?: () => void;
}

export function useRetargetClipWorkflow(options: UseRetargetClipWorkflowOptions) {
  const currentFile = ref<File | null>(null);
  const analysis = ref<RetargetLabAnalysis | null>(null);
  const mapping = ref<ManualFbxBoneMapping>({});
  const loading = ref(false);
  const importing = ref(false);
  const previewing = ref(false);
  const error = ref('');
  const currentTargetJoints = ref(getRetargetTargetJoints(options.vrm));
  const previewName = ref('');
  const previewDuration = ref(0);
  const previewTime = ref(0);
  const previewMode = ref<'original' | 'corrected' | ''>('');
  const sourceOrigin = ref<SourceOrigin>('manual');
  const lastImportMessage = ref('');

  const sourceOptions = computed(() => analysis.value?.sourceJoints ?? []);
  const targetJoints = computed(() => analysis.value?.targetJoints ?? currentTargetJoints.value);
  const canImport = computed(() => canImportClip({
    hasFile: !!currentFile.value,
    loading: loading.value,
    importing: importing.value,
  }));
  const canPreview = computed(() => canPreviewClip({
    hasFile: !!currentFile.value,
    hasPreviewHandler: !!options.onPreview,
    loading: loading.value,
    previewing: previewing.value,
  }));
  const contextSourceLabel = computed(() => buildContextSourceLabel(sourceOrigin.value));
  const previewStatusLabel = computed(() => buildPreviewStatusLabel(previewing.value, previewMode.value));

  function applyPreviewState(state: ReturnType<typeof stoppedPreviewState>): void {
    previewName.value = state.name;
    previewDuration.value = state.duration;
    previewTime.value = state.time;
    previewMode.value = state.mode;
  }

  async function analyze(file: File, origin: SourceOrigin = 'manual'): Promise<void> {
    if (!isRetargetLabFile(file)) {
      error.value = 'Unsupported file. Use .bvh, .fbx, or .vrma.';
      return;
    }
    loading.value = true;
    error.value = '';
    sourceOrigin.value = origin;
    lastImportMessage.value = '';
    if (previewName.value) stopPreview();
    currentFile.value = file;
    try {
      const next = await analyzeRetargetLabFile(file, options.vrm);
      analysis.value = next;
      mapping.value = { ...next.mapping };
    } catch (e) {
      analysis.value = null;
      mapping.value = {};
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  function updateMapping(slot: VRMHumanBoneName, value: string): void {
    mapping.value = { ...mapping.value, [slot]: value || undefined };
  }

  function clearMapping(): void {
    mapping.value = {};
  }

  function restoreAutoMapping(): void {
    if (!analysis.value) return;
    mapping.value = { ...analysis.value.mapping };
  }

  async function importCurrent(): Promise<void> {
    if (!currentFile.value) return;
    importing.value = true;
    error.value = '';
    lastImportMessage.value = '';
    try {
      await options.onImport(
        currentFile.value,
        mapping.value,
        options.activeCorrections.value,
      );
      lastImportMessage.value = 'Added to Player queue';
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      importing.value = false;
    }
  }

  async function previewCurrent(corrected: boolean): Promise<void> {
    if (!currentFile.value || !options.onPreview) return;
    previewing.value = true;
    error.value = '';
    try {
      const result = await options.onPreview(
        currentFile.value,
        mapping.value,
        corrected ? options.activeCorrections.value : [],
        corrected,
      );
      applyPreviewState(startedPreviewState(result, corrected));
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      previewing.value = false;
    }
  }

  function seekPreview(): void {
    options.onPreviewSeek?.(previewTime.value);
  }

  function stopPreview(): void {
    options.onPreviewStop?.();
    applyPreviewState(stoppedPreviewState());
  }

  return {
    currentFile,
    analysis,
    mapping,
    loading,
    importing,
    previewing,
    error,
    previewName,
    previewDuration,
    previewTime,
    previewMode,
    sourceOrigin,
    lastImportMessage,
    sourceOptions,
    targetJoints,
    canImport,
    canPreview,
    contextSourceLabel,
    previewStatusLabel,
    analyze,
    updateMapping,
    clearMapping,
    restoreAutoMapping,
    importCurrent,
    previewCurrent,
    seekPreview,
    stopPreview,
  };
}
