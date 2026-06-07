import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { buildMockVRM } from '../../tests/fixtures/mockVrm';
import { PoseValidator } from './poseValidator';
import { MIXAMO_LIVE_POSE_CONSTRAINTS, getPoseConstraints } from './poseConstraints';

function setEuler(
  node: THREE.Object3D | undefined,
  xDeg: number,
  yDeg: number,
  zDeg: number,
): void {
  if (!node) throw new Error('missing mock bone');
  node.quaternion.setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(xDeg),
    THREE.MathUtils.degToRad(yDeg),
    THREE.MathUtils.degToRad(zDeg),
    'YXZ',
  ));
}

function setEulerOrder(
  node: THREE.Object3D | undefined,
  order: THREE.EulerOrder,
  xDeg: number,
  yDeg: number,
  zDeg: number,
): void {
  if (!node) throw new Error('missing mock bone');
  node.quaternion.setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(xDeg),
    THREE.MathUtils.degToRad(yDeg),
    THREE.MathUtils.degToRad(zDeg),
    order,
  ));
}

function setLeftArmRestAxisY(vrm: ReturnType<typeof buildMockVRM>): void {
  const lower = vrm.bones.get('leftLowerArm');
  const hand = vrm.bones.get('leftHand');
  if (!lower || !hand) throw new Error('missing mock arm chain');
  lower.position.set(0, 0.25, 0);
  hand.position.set(0, 0.25, 0);
  vrm.scene.updateMatrixWorld(true);
}

function getWorldPosition(node: THREE.Object3D | undefined): THREE.Vector3 {
  if (!node) throw new Error('missing mock bone');
  const out = new THREE.Vector3();
  node.getWorldPosition(out);
  return out;
}

describe('PoseValidator arm guardrails', () => {
  test('Mixamo Live pose profile exposes arm chain thresholds', () => {
    const constraints = getPoseConstraints('mixamoLive');

    expect(constraints).toBe(MIXAMO_LIVE_POSE_CONSTRAINTS);
    expect(constraints.arms.backward.upperArmMaxDeg).toBe(120);
    expect(constraints.arms.backward.forearmMaxDeg).toBe(120);
    expect(constraints.arms.allowedPoseClasses).toContain('overhead');
    expect(constraints.arms.allowedPoseClasses).toContain('crossBody');
    expect(constraints.arms.ik.maxReachFraction).toBeCloseTo(0.98);
  });

  test('leaves a normal side-reach arm pose unchanged', () => {
    const vrm = buildMockVRM();
    const validator = new PoseValidator(vrm);

    const stats = validator.validateAndClamp();

    expect(stats.clampedThisFrame).toBe(0);
    expect(stats.arms.left.poseClass).toBe('sideReach');
    expect(stats.arms.right.poseClass).toBe('sideReach');
    expect(stats.violations).toHaveLength(0);
  });

  test('classifies overhead arms without clamping them as backward violations', () => {
    const vrm = buildMockVRM();
    const validator = new PoseValidator(vrm);
    setEuler(vrm.bones.get('leftUpperArm'), 0, 0, 85);
    setEuler(vrm.bones.get('rightUpperArm'), 0, 0, -85);

    const stats = validator.validateAndClamp();

    expect(stats.clampedThisFrame).toBe(0);
    expect(stats.arms.left.poseClass).toBe('overhead');
    expect(stats.arms.right.poseClass).toBe('overhead');
    expect(stats.violations).toHaveLength(0);
  });

  test('classifies cross-body reach without clamping it as backward', () => {
    const vrm = buildMockVRM();
    const validator = new PoseValidator(vrm);
    setEuler(vrm.bones.get('leftUpperArm'), 0, 0, 170);
    setEuler(vrm.bones.get('rightUpperArm'), 0, 0, -170);

    const stats = validator.validateAndClamp();

    expect(stats.clampedThisFrame).toBe(0);
    expect(stats.arms.left.poseClass).toBe('crossBody');
    expect(stats.arms.right.poseClass).toBe('crossBody');
    expect(stats.violations).toHaveLength(0);
  });

  test('clamps the dumped backward-arm posture with side-aware arm guardrails', () => {
    const vrm = buildMockVRM();
    const validator = new PoseValidator(vrm);
    setEuler(vrm.bones.get('leftUpperArm'), 17.343728791417004, 42.350678057468286, -47.30201530824238);
    setEuler(vrm.bones.get('rightUpperArm'), 38.88549593486809, -64.93106939034894, 61.06655999486631);

    const stats = validator.validateAndClamp();

    expect(stats.clampedThisFrame).toBe(2);
    expect(stats.violations).toContain('leftUpperArm.backwardChain');
    expect(stats.violations).toContain('rightUpperArm.backwardChain');
    expect(stats.arms.left.upperArmForwardDeg).toBeLessThanOrEqual(120);
    expect(stats.arms.right.upperArmForwardDeg).toBeLessThanOrEqual(120);
  });

  test('clamps post-ROM dump where upper arm is at local limit but still points backward', () => {
    const vrm = buildMockVRM();
    const validator = new PoseValidator(vrm);
    setEuler(vrm.bones.get('leftUpperArm'), 22.873734256102377, 23.999999077874545, -29.999999999999996);
    setEuler(vrm.bones.get('leftLowerArm'), 38.87501093621991, 74.99999999999984, -6.000000000000001);
    setEuler(vrm.bones.get('rightUpperArm'), 31.534855987754675, 7.662148652643806e-7, 50);
    setEuler(vrm.bones.get('rightLowerArm'), 1.525472584744723e-8, -45.40185762610094, -6.000000000000001);

    const stats = validator.validateAndClamp();

    expect(stats.clampedThisFrame).toBeGreaterThanOrEqual(2);
    expect(stats.violations).toContain('leftUpperArm.backwardChain');
    expect(stats.violations).toContain('rightLowerArm.backwardChain');
    expect(stats.arms.left.upperArmForwardDeg).toBeLessThanOrEqual(120);
    expect(stats.arms.right.forearmForwardDeg).toBeLessThanOrEqual(120);
  });

  test('IK guardrail preserves upper and lower arm segment lengths while correcting backward pose', () => {
    const vrm = buildMockVRM();
    const validator = new PoseValidator(vrm, { profileId: 'mixamoLive' });
    setEuler(vrm.bones.get('leftUpperArm'), 22.873734256102377, 23.999999077874545, -29.999999999999996);
    setEuler(vrm.bones.get('leftLowerArm'), 38.87501093621991, 74.99999999999984, -6.000000000000001);
    vrm.scene.updateMatrixWorld(true);

    const before = validator.getArmWorldSnapshot('left');
    const stats = validator.validateAndClamp();
    const after = validator.getArmWorldSnapshot('left');

    expect(stats.violations).toContain('leftUpperArm.backwardChain');
    expect(stats.clampedThisFrame).toBeGreaterThan(0);
    expect(after.upperLength).toBeCloseTo(before.upperLength, 5);
    expect(after.lowerLength).toBeCloseTo(before.lowerLength, 5);
    expect(after.upperArmForwardDeg).toBeLessThanOrEqual(120);
  });

  test('reports mild upper-arm overshoot without replacing the whole arm chain', () => {
    const vrm = buildMockVRM();
    const validator = new PoseValidator(vrm, { profileId: 'mixamoLive' });
    setEulerOrder(vrm.bones.get('leftUpperArm'), 'YXZ', -90, -55, 90);
    setEulerOrder(vrm.bones.get('leftLowerArm'), 'XYZ', 0, -40, -10);
    vrm.scene.updateMatrixWorld(true);

    const before = validator.getArmWorldSnapshot('left');
    const stats = validator.validateAndClamp();
    const after = validator.getArmWorldSnapshot('left');

    expect(before.upperArmForwardDeg).toBeGreaterThan(120);
    expect(before.forearmForwardDeg).toBeLessThanOrEqual(120);
    expect(stats.violations).toContain('leftUpperArm.backwardChain');
    expect(stats.clampedThisFrame).toBe(0);
    expect(after.upperArmForwardDeg).toBeCloseTo(before.upperArmForwardDeg!, 5);
    expect(after.forearmForwardDeg).toBeCloseTo(before.forearmForwardDeg!, 5);
  });

  test('IK guardrail uses actual arm rest axes when writing corrected quaternions', () => {
    const vrm = buildMockVRM();
    setLeftArmRestAxisY(vrm);
    const validator = new PoseValidator(vrm, { profileId: 'mixamoLive' });
    setEulerOrder(vrm.bones.get('leftUpperArm'), 'YXZ', -120, -120, 70);
    setEulerOrder(vrm.bones.get('leftLowerArm'), 'XYZ', -60, -100, -60);
    vrm.scene.updateMatrixWorld(true);

    const shoulder = getWorldPosition(vrm.bones.get('leftUpperArm'));
    const chainLength =
      getWorldPosition(vrm.bones.get('leftLowerArm')).distanceTo(shoulder)
      + getWorldPosition(vrm.bones.get('leftHand')).distanceTo(getWorldPosition(vrm.bones.get('leftLowerArm')));
    const expectedTarget = shoulder.clone()
      .add(new THREE.Vector3(chainLength * 0.5, 0, chainLength * 0.28));

    const stats = validator.validateAndClamp();
    vrm.scene.updateMatrixWorld(true);
    const hand = getWorldPosition(vrm.bones.get('leftHand'));

    expect(stats.clampedThisFrame).toBeGreaterThan(0);
    expect(hand.distanceTo(expectedTarget)).toBeLessThan(0.01);
  });
});
