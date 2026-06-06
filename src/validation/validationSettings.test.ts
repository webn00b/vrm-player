import { describe, expect, test } from 'vitest';
import {
  DEFAULT_VALIDATION_SETTINGS,
  normalizeValidationSettings,
  serializeValidationSettings,
  shouldClampImportedAnimations,
} from './validationSettings';

describe('validationSettings', () => {
  test('normalizes unknown stored values back to safe defaults', () => {
    expect(normalizeValidationSettings({
      profileId: 'unknown',
      playbackClampMode: 'sideways',
      recordingClampMode: 'full',
      importClampMode: 'clamp',
    })).toEqual({
      ...DEFAULT_VALIDATION_SETTINGS,
      recordingClampMode: 'full',
      importClampMode: 'clamp',
    });
  });

  test('normalizes and persists the selected constraint profile', () => {
    expect(normalizeValidationSettings({
      profileId: 'mixamoLive',
      playbackClampMode: 'full',
      recordingClampMode: 'safe',
      importClampMode: 'clamp',
    })).toEqual({
      profileId: 'mixamoLive',
      playbackClampMode: 'full',
      recordingClampMode: 'safe',
      importClampMode: 'clamp',
    });
  });

  test('serializes only the persisted validation settings fields', () => {
    expect(JSON.parse(serializeValidationSettings({
      profileId: 'mixamoLive',
      playbackClampMode: 'off',
      recordingClampMode: 'safe',
      importClampMode: 'validate',
    }))).toEqual({
      profileId: 'mixamoLive',
      playbackClampMode: 'off',
      recordingClampMode: 'safe',
      importClampMode: 'validate',
    });
  });

  test('maps the import mode to retarget clamp behavior', () => {
    expect(shouldClampImportedAnimations({
      ...DEFAULT_VALIDATION_SETTINGS,
      importClampMode: 'validate',
    })).toBe(false);
    expect(shouldClampImportedAnimations({
      ...DEFAULT_VALIDATION_SETTINGS,
      importClampMode: 'clamp',
    })).toBe(true);
  });
});
