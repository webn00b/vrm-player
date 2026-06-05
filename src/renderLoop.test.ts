import { describe, expect, test } from 'vitest';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { selectValidationExcludedBones } from './renderLoop';
import {
  CLIP_VALIDATION_EXCLUDED_BONES,
  MOCAP_VALIDATION_EXCLUDED_BONES,
} from './mocap/diagnostics/mocapValidationBones';

describe('selectValidationExcludedBones', () => {
  test('keeps current live mocap exclusions for the default validator profile', () => {
    expect(selectValidationExcludedBones({
      hasBvhActive: false,
      mocapState: 'live',
      validatorProfileId: 'default',
    })).toBe(MOCAP_VALIDATION_EXCLUDED_BONES);
  });

  test('does not exclude live mocap limbs for the Mixamo Live validator profile', () => {
    expect(selectValidationExcludedBones({
      hasBvhActive: false,
      mocapState: 'live',
      validatorProfileId: 'mixamoLive',
    })).toBeUndefined();
  });

  test('preserves clip playback exclusions even when the Mixamo Live profile is selected', () => {
    const excluded = selectValidationExcludedBones({
      hasBvhActive: true,
      mocapState: 'live',
      validatorProfileId: 'mixamoLive',
    });

    expect(excluded).toBe(CLIP_VALIDATION_EXCLUDED_BONES);
    expect(excluded?.has(VRMHumanBoneName.Hips)).toBe(true);
  });
});
