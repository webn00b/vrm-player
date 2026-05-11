/**
 * Tests for applyTwoBoneChain — the function that takes IK math output and
 * writes bone-local quaternions into upper/lower Object3D nodes. Verifies:
 *
 *   1. C2 target pullback: targets beyond max-reach get clamped to 98% of
 *      anatomical reach BEFORE the solver runs, so the bones bend instead
 *      of fully straightening.
 *   2. End-effector position: after solving, the wrist position (root +
 *      upperDir·L1 + lowerDir·L2) lands at the clamped target.
 *   3. lerp=1 → exact assignment (no slerp); lerp<1 → smoothed.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyTwoBoneChain } from './twoBoneChainApplication';

/** Build a parent Object3D with two child bones in a zero-rotation hierarchy
 *  whose rest axes both point along +X (typical for arm chains). */
function buildChainNodes(): {
  parent: THREE.Object3D;
  upper:  THREE.Object3D;
  lower:  THREE.Object3D;
} {
  const parent = new THREE.Object3D();
  const upper  = new THREE.Object3D();
  const lower  = new THREE.Object3D();
  parent.add(upper);
  upper.add(lower);
  parent.updateMatrixWorld(true);
  return { parent, upper, lower };
}

test('reachable target: upper+lower bones reconstruct to the target position', () => {
  const { upper, lower } = buildChainNodes();
  const restAxis = new THREE.Vector3(1, 0, 0);

  const root   = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(0.5, 0, 0);
  const pole   = new THREE.Vector3(0, 1, 0);

  applyTwoBoneChain({
    rootWorld: root,
    targetWorld: target,
    poleDirection: pole,
    upperLength: 0.3,
    lowerLength: 0.3,
    upperNode: upper,
    lowerNode: lower,
    upperRestAxis: restAxis,
    lowerRestAxis: restAxis,
    lerp: 1,
  });

  // upper.quaternion rotates restAxis (parent-local) toward IK upperDir
  // (parent-world). Walk forward by L1 in upper's world direction, then by L2
  // in lower's world direction — should land at target.
  upper.updateMatrixWorld(true);
  const upperWorldDir = restAxis.clone().applyQuaternion(upper.quaternion);  // parent identity
  const elbow = root.clone().addScaledVector(upperWorldDir, 0.3);

  // Lower bone's local rotation is in upper's frame; compose to world.
  lower.updateMatrixWorld(true);
  const upperWorldQuat = upper.quaternion;  // since parent is identity
  const lowerWorldQuat = upperWorldQuat.clone().multiply(lower.quaternion);
  const lowerWorldDir = restAxis.clone().applyQuaternion(lowerWorldQuat);
  const tip = elbow.clone().addScaledVector(lowerWorldDir, 0.3);

  assert.ok(tip.distanceTo(target) < 1e-3,
    `tip should land on target; got dist ${tip.distanceTo(target).toFixed(6)}`);
});

test('C2 pullback: target beyond max-reach is clamped to 98% before solving', () => {
  const { upper, lower } = buildChainNodes();
  const restAxis = new THREE.Vector3(1, 0, 0);

  // L1 + L2 = 0.6. Target 1.0 along +X is way beyond reach.
  // C2 clamps to 0.6 * 0.98 = 0.588.
  applyTwoBoneChain({
    rootWorld: new THREE.Vector3(0, 0, 0),
    targetWorld: new THREE.Vector3(1.0, 0, 0),
    poleDirection: new THREE.Vector3(0, 1, 0),
    upperLength: 0.3,
    lowerLength: 0.3,
    upperNode: upper,
    lowerNode: lower,
    upperRestAxis: restAxis,
    lowerRestAxis: restAxis,
    lerp: 1,
  });

  // Reconstruct tip in world from the bones.
  const upperWorldDir = restAxis.clone().applyQuaternion(upper.quaternion);
  const elbow = new THREE.Vector3().addScaledVector(upperWorldDir, 0.3);
  const lowerWorldQuat = upper.quaternion.clone().multiply(lower.quaternion);
  const lowerWorldDir = restAxis.clone().applyQuaternion(lowerWorldQuat);
  const tip = elbow.clone().addScaledVector(lowerWorldDir, 0.3);

  // tip should land at ~0.588 (98% of 0.6), NOT at the full reach 0.6.
  assert.ok(Math.abs(tip.x - 0.6 * 0.98) < 0.01,
    `tip x should be near 0.588 (clamped target); got ${tip.x.toFixed(4)}`);
  // And NOT at the original requested 1.0.
  assert.ok(tip.x < 0.65, `tip should not extend to original requested 1.0`);
});

test('no parent → no-op (does not throw)', () => {
  const upper = new THREE.Object3D();  // orphan
  const lower = new THREE.Object3D();
  upper.add(lower);
  // Don't set a parent on `upper` — applyTwoBoneChain should bail.

  // Should not throw.
  applyTwoBoneChain({
    rootWorld: new THREE.Vector3(),
    targetWorld: new THREE.Vector3(0.5, 0, 0),
    poleDirection: new THREE.Vector3(0, 1, 0),
    upperLength: 0.3,
    lowerLength: 0.3,
    upperNode: upper,
    lowerNode: lower,
    upperRestAxis: new THREE.Vector3(1, 0, 0),
    lowerRestAxis: new THREE.Vector3(1, 0, 0),
    lerp: 1,
  });
  // upper.quaternion stays at identity since the function bailed.
  assert.ok(upper.quaternion.equals(new THREE.Quaternion()));
});

test('lerp<1: bone slerps rather than copying', () => {
  const { upper, lower } = buildChainNodes();
  const restAxis = new THREE.Vector3(1, 0, 0);

  // Pre-rotate upper to identity (it already is) and target a 90° turn.
  // With lerp=0.5 the bone should move toward but not all the way to target.
  applyTwoBoneChain({
    rootWorld: new THREE.Vector3(0, 0, 0),
    targetWorld: new THREE.Vector3(0, 0.5, 0),  // 90° rotation needed
    poleDirection: new THREE.Vector3(0, 0, 1),
    upperLength: 0.3,
    lowerLength: 0.3,
    upperNode: upper,
    lowerNode: lower,
    upperRestAxis: restAxis,
    lowerRestAxis: restAxis,
    lerp: 0.5,
  });

  // Angle between upper.quaternion and identity should be NON-zero (it moved)
  // but LESS than 90° (it didn't fully arrive).
  const angle = 2 * Math.acos(Math.abs(upper.quaternion.w));
  assert.ok(angle > 0.01, `bone should rotate at lerp=0.5`);
  assert.ok(angle < Math.PI / 2 + 0.01, `should not exceed full target angle`);
});
