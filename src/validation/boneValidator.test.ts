import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { buildMockVRM } from '../../tests/fixtures/mockVrm';
import { BoneValidator } from './boneValidator';
import { PoseValidator } from './poseValidator';

describe('BoneValidator constraint profiles', () => {
  test('switches to the Mixamo Live profile and applies its stricter elbow hinge limit', () => {
    const vrm = buildMockVRM();
    const validator = new BoneValidator(vrm);
    const elbow = vrm.bones.get('leftLowerArm');
    expect(elbow).toBeTruthy();

    // Backward elbow bend (+Y for the left forearm): default allows ≤10°,
    // Mixamo Live tightens the hinge to ≤6°.
    validator.setProfile('mixamoLive');
    elbow!.quaternion.setFromEuler(new THREE.Euler(
      0,
      THREE.MathUtils.degToRad(12),
      0,
      'YZX',
    ));

    const stats = validator.clampAll();
    const clampedEuler = new THREE.Euler().setFromQuaternion(elbow!.quaternion, 'YZX');

    expect(validator.profileId).toBe('mixamoLive');
    expect(stats.worstBone).toBe(VRMHumanBoneName.LeftLowerArm);
    expect(THREE.MathUtils.radToDeg(clampedEuler.y)).toBeCloseTo(6, 4);
  });

  test('Mixamo Live profile clamps excessive upper-arm axial twist', () => {
    const vrm = buildMockVRM();
    const validator = new BoneValidator(vrm);
    const upperArm = vrm.bones.get('leftUpperArm');
    expect(upperArm).toBeTruthy();

    validator.setProfile('mixamoLive');
    upperArm!.quaternion.setFromEuler(new THREE.Euler(
      0,
      THREE.MathUtils.degToRad(80),
      0,
      'YXZ',
    ));

    const stats = validator.clampAll();
    const clampedEuler = new THREE.Euler().setFromQuaternion(upperArm!.quaternion, 'YXZ');

    expect(stats.worstBone).toBe(VRMHumanBoneName.LeftUpperArm);
    expect(THREE.MathUtils.radToDeg(clampedEuler.y)).toBeLessThanOrEqual(65.01);
  });

  test('reports world-space arm direction after local ROM clamp', () => {
    const vrm = buildMockVRM();
    const validator = new BoneValidator(vrm);
    const upperArm = vrm.bones.get('leftUpperArm');
    expect(upperArm).toBeTruthy();

    validator.setProfile('mixamoLive');
    upperArm!.quaternion.setFromEuler(new THREE.Euler(
      0,
      THREE.MathUtils.degToRad(20),
      0,
      'YXZ',
    ));

    const clampStats = validator.clampAll();
    // Arm posture is computed lazily on getStats() — the per-frame clamp path
    // must not pay for the forced world-matrix update it needs.
    const stats = validator.getStats();

    expect(clampStats.clampedThisFrame).toBe(0);
    expect(stats.armPosture.left.available).toBe(true);
    expect(stats.armPosture.left.upperArmForwardDeg).toBeGreaterThan(100);
  });

  test('Mixamo Live ROM clamp + pose guardrail recover dumped backward-arm posture', () => {
    const vrm = buildMockVRM();
    const validator = new BoneValidator(vrm);
    const poseValidator = new PoseValidator(vrm, { profileId: 'mixamoLive' });
    const leftUpperArm = vrm.bones.get('leftUpperArm');
    const rightUpperArm = vrm.bones.get('rightUpperArm');
    expect(leftUpperArm).toBeTruthy();
    expect(rightUpperArm).toBeTruthy();

    validator.setProfile('mixamoLive');
    leftUpperArm!.quaternion.setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(17.343728791417004),
      THREE.MathUtils.degToRad(42.350678057468286),
      THREE.MathUtils.degToRad(-47.30201530824238),
      'YXZ',
    ));
    rightUpperArm!.quaternion.setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(38.88549593486809),
      THREE.MathUtils.degToRad(-64.93106939034894),
      THREE.MathUtils.degToRad(61.06655999486631),
      'YXZ',
    ));

    // Runtime ordering (renderLoop): per-bone ROM clamp first, then the
    // world-space pose guardrail that IK-corrects backward-pointing chains.
    // The ROM box is deliberately loose here — recovering this posture is the
    // pose guardrail's job, so only the final world-space direction matters.
    validator.clampAll();
    const poseStats = poseValidator.validateAndClamp();

    expect(poseStats.arms.left.upperArmForwardDeg).toBeLessThanOrEqual(120);
    expect(poseStats.arms.right.upperArmForwardDeg).toBeLessThanOrEqual(120);
  });
});
