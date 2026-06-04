import { computed, ref, type Ref } from 'vue';
import * as THREE from 'three';
import type { ToastServiceMethods } from 'primevue/toastservice';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  QUATERNION_PRESET_STORAGE_KEY,
  createQuaternionPreset,
  loadQuaternionPresets,
  persistPresetList,
  type QuaternionPreset,
} from './retargetPresetStore';
import type { QuaternionFields } from './retargetQuaternionTypes';

interface UseRetargetQuaternionPresetsOptions {
  selectedBone: Ref<VRMHumanBoneName>;
  quat: QuaternionFields;
  setQuaternionFields: (q: THREE.Quaternion) => void;
  toast: ToastServiceMethods;
}

export function useRetargetQuaternionPresets(options: UseRetargetQuaternionPresetsOptions) {
  const quatPresetName = ref('');
  const selectedQuatPresetId = ref('');
  const quatPresets = ref<QuaternionPreset[]>(loadQuaternionPresets());
  const selectedQuatPreset = computed(() => (
    quatPresets.value.find((preset) => preset.id === selectedQuatPresetId.value) ?? null
  ));

  function persistQuatPresets(): void {
    try {
      persistPresetList(QUATERNION_PRESET_STORAGE_KEY, quatPresets.value);
    } catch (e) {
      options.toast.add({
        severity: 'error',
        summary: 'Save failed',
        detail: (e as Error).message,
        life: 3000,
      });
    }
  }

  function saveQuatPreset(): void {
    const preset = createQuaternionPreset({
      requestedName: quatPresetName.value,
      bone: options.selectedBone.value,
      q: [options.quat.x, options.quat.y, options.quat.z, options.quat.w],
    });
    quatPresets.value = [preset, ...quatPresets.value];
    selectedQuatPresetId.value = preset.id;
    quatPresetName.value = preset.name;
    persistQuatPresets();
    options.toast.add({
      severity: 'success',
      summary: 'Quaternion preset saved',
      detail: preset.name,
      life: 2200,
    });
  }

  function loadQuatPreset(): void {
    const preset = selectedQuatPreset.value;
    if (!preset) return;
    options.selectedBone.value = preset.bone;
    options.setQuaternionFields(new THREE.Quaternion(...preset.q).normalize());
    quatPresetName.value = preset.name;
    options.toast.add({
      severity: 'success',
      summary: 'Quaternion preset loaded',
      detail: preset.name,
      life: 2000,
    });
  }

  function deleteQuatPreset(): void {
    const preset = selectedQuatPreset.value;
    if (!preset) return;
    quatPresets.value = quatPresets.value.filter((item) => item.id !== preset.id);
    selectedQuatPresetId.value = quatPresets.value[0]?.id ?? '';
    persistQuatPresets();
    options.toast.add({
      severity: 'success',
      summary: 'Quaternion preset deleted',
      detail: preset.name,
      life: 2000,
    });
  }

  return {
    quatPresetName,
    selectedQuatPresetId,
    quatPresets,
    selectedQuatPreset,
    saveQuatPreset,
    loadQuatPreset,
    deleteQuatPreset,
  };
}
