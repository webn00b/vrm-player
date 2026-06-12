import { reactive, watch } from 'vue';
import type { BoneConstraintProfileId } from './boneConstraints';

export type ValidationClampMode = 'safe' | 'full' | 'off';
export type ImportClampMode = 'validate' | 'clamp';

export interface ValidationSettings {
  profileId: BoneConstraintProfileId;
  playbackClampMode: ValidationClampMode;
  recordingClampMode: ValidationClampMode;
  importClampMode: ImportClampMode;
}

export const VALIDATION_SETTINGS_STORAGE_KEY = 'vrm-player.validation-settings';

// Validators ship disabled: clamping is an opt-in guardrail, not a default
// transform — recordings and playback should match the source motion exactly
// unless the user explicitly asks for ROM limiting. ('validate' for import is
// warn-only — it never mutates the clip.)
export const DEFAULT_VALIDATION_SETTINGS: ValidationSettings = {
  profileId: 'default',
  playbackClampMode: 'off',
  recordingClampMode: 'off',
  importClampMode: 'validate',
};

function isProfileId(value: unknown): value is BoneConstraintProfileId {
  return value === 'default' || value === 'mixamoLive';
}

function isClampMode(value: unknown): value is ValidationClampMode {
  return value === 'safe' || value === 'full' || value === 'off';
}

function isImportClampMode(value: unknown): value is ImportClampMode {
  return value === 'validate' || value === 'clamp';
}

export function normalizeValidationSettings(value: unknown): ValidationSettings {
  const input = value && typeof value === 'object'
    ? value as Partial<Record<keyof ValidationSettings, unknown>>
    : {};
  return {
    profileId: isProfileId(input.profileId)
      ? input.profileId
      : DEFAULT_VALIDATION_SETTINGS.profileId,
    playbackClampMode: isClampMode(input.playbackClampMode)
      ? input.playbackClampMode
      : DEFAULT_VALIDATION_SETTINGS.playbackClampMode,
    recordingClampMode: isClampMode(input.recordingClampMode)
      ? input.recordingClampMode
      : DEFAULT_VALIDATION_SETTINGS.recordingClampMode,
    importClampMode: isImportClampMode(input.importClampMode)
      ? input.importClampMode
      : DEFAULT_VALIDATION_SETTINGS.importClampMode,
  };
}

export function serializeValidationSettings(settings: ValidationSettings): string {
  return JSON.stringify({
    profileId: settings.profileId,
    playbackClampMode: settings.playbackClampMode,
    recordingClampMode: settings.recordingClampMode,
    importClampMode: settings.importClampMode,
  });
}

export function shouldClampImportedAnimations(settings: ValidationSettings): boolean {
  return settings.importClampMode === 'clamp';
}

function readStoredSettings(): ValidationSettings {
  try {
    const raw = globalThis.localStorage?.getItem(VALIDATION_SETTINGS_STORAGE_KEY);
    return normalizeValidationSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_VALIDATION_SETTINGS };
  }
}

export const validationSettings = reactive<ValidationSettings>(readStoredSettings());

if (typeof window !== 'undefined') {
  watch(validationSettings, (next) => {
    try {
      localStorage.setItem(VALIDATION_SETTINGS_STORAGE_KEY, serializeValidationSettings(next));
    } catch {
      // Ignore storage failures in private mode / tests.
    }
  }, { deep: true });
}
