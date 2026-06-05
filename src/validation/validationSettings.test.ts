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
      playbackClampMode: 'sideways',
      recordingClampMode: 'full',
      importClampMode: 'clamp',
    })).toEqual({
      ...DEFAULT_VALIDATION_SETTINGS,
      recordingClampMode: 'full',
      importClampMode: 'clamp',
    });
  });

  test('serializes only the persisted validation settings fields', () => {
    expect(JSON.parse(serializeValidationSettings({
      playbackClampMode: 'off',
      recordingClampMode: 'safe',
      importClampMode: 'validate',
    }))).toEqual({
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
