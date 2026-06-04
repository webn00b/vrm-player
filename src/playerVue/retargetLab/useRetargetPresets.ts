import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { ToastServiceMethods } from 'primevue/toastservice';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import type { RetargetLabAnalysis } from '../../retargetLabModel';
import {
  RETARGET_PRESET_STORAGE_KEY,
  createImportedRetargetPreset,
  createRetargetPreset,
  loadRetargetPresets,
  persistPresetList,
  type RetargetPreset,
} from './retargetPresetStore';

interface UseRetargetPresetsOptions {
  currentFile: Ref<File | null>;
  analysis: Ref<RetargetLabAnalysis | null>;
  mapping: Ref<ManualFbxBoneMapping>;
  mappedCount: ComputedRef<number>;
  slotCount: number;
  toast: ToastServiceMethods;
}

export function useRetargetPresets(options: UseRetargetPresetsOptions) {
  const presetName = ref('');
  const selectedPresetId = ref('');
  const presets = ref<RetargetPreset[]>(loadRetargetPresets());
  const selectedPreset = computed(() => (
    presets.value.find((preset) => preset.id === selectedPresetId.value) ?? null
  ));

  function persistPresets(): void {
    try {
      persistPresetList(RETARGET_PRESET_STORAGE_KEY, presets.value);
    } catch (e) {
      options.toast.add({
        severity: 'error',
        summary: 'Save failed',
        detail: (e as Error).message,
        life: 3000,
      });
    }
  }

  function savePreset(): void {
    const next = createRetargetPreset({
      requestedName: presetName.value,
      fileName: options.currentFile.value?.name ?? null,
      analysis: options.analysis.value,
      mapping: options.mapping.value,
      mappedCount: options.mappedCount.value,
    });
    presets.value = [next, ...presets.value];
    selectedPresetId.value = next.id;
    presetName.value = next.name;
    persistPresets();
    options.toast.add({
      severity: 'success',
      summary: 'Preset saved',
      detail: `${next.name} · ${next.mappedCount}/${options.slotCount}`,
      life: 2200,
    });
  }

  function loadSelectedPreset(): void {
    if (!selectedPreset.value) return;
    options.mapping.value = { ...selectedPreset.value.mapping };
    presetName.value = selectedPreset.value.name;
    options.toast.add({
      severity: 'success',
      summary: 'Preset loaded',
      detail: selectedPreset.value.name,
      life: 2000,
    });
  }

  function deleteSelectedPreset(): void {
    if (!selectedPreset.value) return;
    const deletedName = selectedPreset.value.name;
    presets.value = presets.value.filter((preset) => preset.id !== selectedPresetId.value);
    selectedPresetId.value = presets.value[0]?.id ?? '';
    persistPresets();
    options.toast.add({
      severity: 'success',
      summary: 'Preset deleted',
      detail: deletedName,
      life: 2000,
    });
  }

  function exportSelectedPreset(): void {
    const preset = selectedPreset.value;
    if (!preset) return;
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${preset.name.replace(/[^a-z0-9_.-]+/gi, '_')}.retarget-preset.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function importPresetFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<RetargetPreset>;
      const imported = createImportedRetargetPreset({ parsed, fileName: file.name });
      presets.value = [imported, ...presets.value];
      selectedPresetId.value = imported.id;
      persistPresets();
      options.toast.add({
        severity: 'success',
        summary: 'Preset imported',
        detail: imported.name,
        life: 2200,
      });
    } catch (e) {
      options.toast.add({
        severity: 'error',
        summary: 'Import failed',
        detail: (e as Error).message,
        life: 3000,
      });
    }
  }

  return {
    presetName,
    selectedPresetId,
    presets,
    selectedPreset,
    savePreset,
    loadSelectedPreset,
    deleteSelectedPreset,
    exportSelectedPreset,
    importPresetFile,
  };
}
