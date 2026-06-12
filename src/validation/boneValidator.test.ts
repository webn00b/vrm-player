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

  test('soft clamp blends the correction in over time and settles on the bound', () => {
    const vrm = buildMockVRM();
    const validator = new BoneValidator(vrm);
    const elbow = vrm.bones.get('leftLowerArm');
    expect(elbow).toBeTruthy();

    // Backward elbow bend 40° — hard bound is +10° (default profile).
    const raw = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      0, THREE.MathUtils.degToRad(40), 0, 'YZX',
    ));
    const dt = 1 / 60;

    elbow!.quaternion.copy(raw);
    validator.clampAll(undefined, { soft: true, deltaSeconds: dt });
    const firstDrift = THREE.MathUtils.radToDeg(raw.angleTo(elbow!.quaternion));
    expect(firstDrift).toBeGreaterThan(0);
    expect(firstDrift).toBeLessThan(15); // partial correction, no snap

    // Keep feeding the same violating pose: correction must converge to the
    // hard bound within ~0.5 s.
    for (let i = 0; i < 30; i++) {
      elbow!.quaternion.copy(raw);
      validator.clampAll(undefined, { soft: true, deltaSeconds: dt });
    }
    const settled = new THREE.Euler().setFromQuaternion(elbow!.quaternion, 'YZX');
    expect(THREE.MathUtils.radToDeg(settled.y)).toBeCloseTo(10, 0);
  });

  test('soft clamp is a no-op for poses already inside the bounds', () => {
    const vrm = buildMockVRM();
    const validator = new BoneValidator(vrm);
    const elbow = vrm.bones.get('leftLowerArm');
    const raw = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      0, THREE.MathUtils.degToRad(-90), 0, 'YZX', // normal forward flexion
    ));
    elbow!.quaternion.copy(raw);

    validator.clampAll(undefined, { soft: true, deltaSeconds: 1 / 60 });

    expect(THREE.MathUtils.radToDeg(raw.angleTo(elbow!.quaternion))).toBeLessThan(1e-4);
  });

  test('soft clamp round-trip: a pose recorded at the bound replays untouched', () => {
    const vrm = buildMockVRM();
    const validator = new BoneValidator(vrm);
    const elbow = vrm.bones.get('leftLowerArm');
    const raw = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      0, THREE.MathUtils.degToRad(40), 0, 'YZX',
    ));

    // "Recording": converge onto the bound.
    let recorded = new THREE.Quaternion();
    for (let i = 0; i < 60; i++) {
      elbow!.quaternion.copy(raw);
      validator.clampAll(undefined, { soft: true, deltaSeconds: 1 / 60 });
    }
    recorded = elbow!.quaternion.clone();

    // "Playback" through a fresh validator: the recorded pose sits exactly on
    // the bound, so re-clamping must not move it.
    const playbackValidator = new BoneValidator(vrm);
    elbow!.quaternion.copy(recorded);
    playbackValidator.clampAll(undefined, { soft: true, deltaSeconds: 1 / 60 });

    expect(THREE.MathUtils.radToDeg(recorded.angleTo(elbow!.quaternion))).toBeLessThan(0.1);
  });

  test('Mixamo Live profile clamps excessive clavicle swing', () => {
    const vrm = buildMockVRM();
    const validator = new BoneValidator(vrm);
    const shoulder = vrm.bones.get('leftShoulder');
    expect(shoulder).toBeTruthy();

    // Upper-arm Y/Z are near-unconstrained in the data-driven profile (dance
    // content sweeps full circles), so the clavicle carries the swing bound.
    validator.setProfile('mixamoLive');
    shoulder!.quaternion.setFromEuler(new THREE.Euler(
      0,
      THREE.MathUtils.degToRad(80),
      0,
      'YXZ',
    ));

    const stats = validator.clampAll();
    const clampedEuler = new THREE.Euler().setFromQuaternion(shoulder!.quaternion, 'YXZ');

    expect(stats.worstBone).toBe(VRMHumanBoneName.LeftShoulder);
    expect(THREE.MathUtils.radToDeg(clampedEuler.y)).toBeLessThanOrEqual(55.01);
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
