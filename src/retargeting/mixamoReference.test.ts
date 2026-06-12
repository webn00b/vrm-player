import { describe, expect, test } from 'vitest';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { mixamoBoneToHumanoid, normalizeMixamoBoneName } from './mixamoReference';

describe('Mixamo reference mapping', () => {
  test('normalizes common Mixamo prefixes and punctuation', () => {
    expect(normalizeMixamoBoneName('mixamorig:LeftArm')).toBe('leftarm');
    expect(normalizeMixamoBoneName('mixamorigLeftForeArm')).toBe('leftforearm');
    expect(normalizeMixamoBoneName('MixamoRig_RightHandIndex1')).toBe('righthandindex1');
  });

  test('maps core Mixamo arm bones to VRM humanoid bones', () => {
    expect(mixamoBoneToHumanoid('mixamorigLeftArm')).toBe(VRMHumanBoneName.LeftUpperArm);
    expect(mixamoBoneToHumanoid('mixamorig:LeftForeArm')).toBe(VRMHumanBoneName.LeftLowerArm);
    expect(mixamoBoneToHumanoid('mixamorigRightHand')).toBe(VRMHumanBoneName.RightHand);
  });

  test('maps Mixamo fingers used by FBX imports', () => {
    expect(mixamoBoneToHumanoid('mixamorigLeftHandIndex1')).toBe(VRMHumanBoneName.LeftIndexProximal);
    expect(mixamoBoneToHumanoid('mixamorigRightHandThumb3')).toBe(VRMHumanBoneName.RightThumbDistal);
  });
});
