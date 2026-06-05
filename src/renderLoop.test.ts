import { describe, expect, test } from 'vitest';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { selectValidationClampPlan } from './renderLoop';
import {
  CLIP_VALIDATION_EXCLUDED_BONES,
  MOCAP_VALIDATION_EXCLUDED_BONES,
} from './mocap/diagnostics/mocapValidationBones';
import { DEFAULT_VALIDATION_SETTINGS } from './validation/validationSettings';

describe('selectValidationClampPlan', () => {
  test('keeps current live mocap exclusions for safe recording validation', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: false,
      mocapState: 'live',
      validatorEnabled: true,
      settings: DEFAULT_VALIDATION_SETTINGS,
    })).toEqual({
      shouldClamp: true,
      excludedBones: MOCAP_VALIDATION_EXCLUDED_BONES,
    });
  });

  test('does not exclude live mocap limbs for full recording validation', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: false,
      mocapState: 'recording',
      validatorEnabled: true,
      settings: {
        ...DEFAULT_VALIDATION_SETTINGS,
        recordingClampMode: 'full',
      },
    })).toEqual({
      shouldClamp: true,
      excludedBones: undefined,
    });
  });

  test('can disable recording validation while leaving runtime validation enabled elsewhere', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: false,
      mocapState: 'recording',
      validatorEnabled: true,
      settings: {
        ...DEFAULT_VALIDATION_SETTINGS,
        recordingClampMode: 'off',
      },
    })).toEqual({
      shouldClamp: false,
      excludedBones: undefined,
    });
  });

  test('preserves clip playback exclusions for safe playback validation', () => {
    const plan = selectValidationClampPlan({
      hasBvhActive: true,
      mocapState: 'live',
      validatorEnabled: true,
      settings: DEFAULT_VALIDATION_SETTINGS,
    });

    expect(plan.shouldClamp).toBe(true);
    expect(plan.excludedBones).toBe(CLIP_VALIDATION_EXCLUDED_BONES);
    expect(plan.excludedBones?.has(VRMHumanBoneName.Hips)).toBe(true);
  });

  test('can fully clamp or disable playback validation', () => {
    expect(selectValidationClampPlan({
      hasBvhActive: true,
      mocapState: 'off',
      validatorEnabled: true,
      settings: {
        ...DEFAULT_VALIDATION_SETTINGS,
        playbackClampMode: 'full',
      },
    })).toEqual({
      shouldClamp: true,
      excludedBones: undefined,
    });

    expect(selectValidationClampPlan({
      hasBvhActive: true,
      mocapState: 'off',
      validatorEnabled: true,
      settings: {
        ...DEFAULT_VALIDATION_SETTINGS,
        playbackClampMode: 'off',
      },
    })).toEqual({
      shouldClamp: false,
      excludedBones: undefined,
    });
  });
});
