import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { buildMockVRM } from '../../tests/fixtures/mockVrm';
import { BoneValidator } from './boneValidator';

describe('BoneValidator constraint profiles', () => {
  test('switches to the Mixamo Live profile and applies its stricter elbow hinge limit', () => {
    const vrm = buildMockVRM();
    const validator = new BoneValidator(vrm);
    const elbow = vrm.bones.get('leftLowerArm');
    expect(elbow).toBeTruthy();

    validator.setProfile('mixamoLive');
    elbow!.quaternion.setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(-12),
      0,
      0,
      'XYZ',
    ));

    const stats = validator.clampAll();
    const clampedEuler = new THREE.Euler().setFromQuaternion(elbow!.quaternion, 'XYZ');

    expect(validator.profileId).toBe('mixamoLive');
    expect(stats.worstBone).toBe(VRMHumanBoneName.LeftLowerArm);
    expect(THREE.MathUtils.radToDeg(clampedEuler.x)).toBeCloseTo(0, 4);
  });
});
