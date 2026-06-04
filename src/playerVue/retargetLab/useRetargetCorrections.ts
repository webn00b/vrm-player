import { computed, ref, type Ref } from 'vue';
import type * as THREE from 'three';
import type { ToastServiceMethods } from 'primevue/toastservice';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { QuaternionCorrectionMode } from '../../retargetCorrections';
import {
  activeCorrectionBones as buildActiveCorrectionBones,
  activeQuaternionCorrections,
  createQuaternionCorrection,
  removeQuaternionCorrection as removeCorrectionById,
  toggleQuaternionCorrection as toggleCorrectionById,
} from './retargetCorrectionModel';
import { quaternionTuple } from './retargetQuaternionModel';

type CorrectionModeOption = QuaternionCorrectionMode;

interface UseRetargetCorrectionsOptions {
  selectedBone: Ref<VRMHumanBoneName>;
  quaternionFromEditor: () => THREE.Quaternion;
  toast: ToastServiceMethods;
}

export function useRetargetCorrections(options: UseRetargetCorrectionsOptions) {
  const correctionMode = ref<CorrectionModeOption>('post');
  const correctionModeOptions: Array<{ label: string; value: CorrectionModeOption }> = [
    { label: 'Post', value: 'post' },
    { label: 'Pre', value: 'pre' },
    { label: 'Absolute', value: 'absolute' },
  ];
  const quaternionCorrections = ref<ReturnType<typeof createQuaternionCorrection>[]>([]);
  const activeCorrections = computed(() => activeQuaternionCorrections(quaternionCorrections.value));
  const activeCorrectionCount = computed(() => activeCorrections.value.length);
  const activeCorrectionBones = computed(() => buildActiveCorrectionBones(quaternionCorrections.value));

  function addQuaternionCorrection(): void {
    const q = options.quaternionFromEditor();
    const correction = createQuaternionCorrection({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      bone: options.selectedBone.value,
      mode: correctionMode.value,
      q: quaternionTuple(q),
    });
    quaternionCorrections.value = [correction, ...quaternionCorrections.value];
    options.toast.add({
      severity: 'success',
      summary: 'Correction added',
      detail: `${correction.bone} · ${correction.mode}`,
      life: 2000,
    });
  }

  function removeQuaternionCorrection(id: string): void {
    quaternionCorrections.value = removeCorrectionById(quaternionCorrections.value, id);
  }

  function toggleQuaternionCorrection(id: string): void {
    quaternionCorrections.value = toggleCorrectionById(quaternionCorrections.value, id);
  }

  function clearQuaternionCorrections(): void {
    quaternionCorrections.value = [];
  }

  return {
    correctionMode,
    correctionModeOptions,
    quaternionCorrections,
    activeCorrections,
    activeCorrectionCount,
    activeCorrectionBones,
    addQuaternionCorrection,
    removeQuaternionCorrection,
    toggleQuaternionCorrection,
    clearQuaternionCorrections,
  };
}
