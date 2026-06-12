/**
 * Tests for h36mMapping — MediaPipe ↔ H36M-17 conversion for the lifter.
 *
 * Coverage:
 *   - 2D input layout: direct joints, synthesized joints, normalization
 *   - aspect-preserving coordinate scaling
 *   - confidence propagation (visibility → conf, missing → 0)
 *   - world patch: root-relative scaling, z sign, untouched joints
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MP,
  H36M_JOINT_COUNT,
  mpFrameToH36m2D,
  patchWorldFromH36m,
  h36mHipWidth,
} from './h36mMapping';
import type { Landmark3D } from './poseDetector';

function makeLandmarks(): Landmark3D[] {
  const lms: Landmark3D[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  lms[MP.LEFT_HIP] = { x: 0.55, y: 0.6, z: 0, visibility: 1 };
  lms[MP.RIGHT_HIP] = { x: 0.45, y: 0.6, z: 0, visibility: 1 };
  lms[MP.LEFT_SHOULDER] = { x: 0.58, y: 0.35, z: 0, visibility: 0.9 };
  lms[MP.RIGHT_SHOULDER] = { x: 0.42, y: 0.35, z: 0, visibility: 0.8 };
  lms[MP.LEFT_WRIST] = { x: 0.7, y: 0.5, z: 0, visibility: 0.6 };
  return lms;
}

test('mpFrameToH36m2D: hip root is the synthesized hip midpoint', () => {
  const out = mpFrameToH36m2D(makeLandmarks(), 1)!;
  assert.ok(out, 'conversion must succeed');
  // midhip = (0.5, 0.6) → normalized (2x−1, 2y−1) = (0, 0.2)
  assert.ok(Math.abs(out[0] - 0) < 1e-6, `root x; got ${out[0]}`);
  assert.ok(Math.abs(out[1] - 0.2) < 1e-6, `root y; got ${out[1]}`);
});

test('mpFrameToH36m2D: aspect scales y only', () => {
  const aspect = 9 / 16;
  const out = mpFrameToH36m2D(makeLandmarks(), aspect)!;
  assert.ok(Math.abs(out[1] - 0.2 * aspect) < 1e-6, `root y scaled by aspect; got ${out[1]}`);
  // x unchanged by aspect
  const wide = mpFrameToH36m2D(makeLandmarks(), 1)!;
  assert.equal(out[0], wide[0]);
});

test('mpFrameToH36m2D: visibility becomes confidence', () => {
  const out = mpFrameToH36m2D(makeLandmarks(), 1)!;
  // H36M 13 = LWrist ← MP LEFT_WRIST (vis 0.6)
  assert.ok(Math.abs(out[13 * 3 + 2] - 0.6) < 1e-6, `LWri conf; got ${out[13 * 3 + 2]}`);
  // Thorax conf = min(shoulder vis) = 0.8
  assert.ok(Math.abs(out[8 * 3 + 2] - 0.8) < 1e-6, `Thorax conf; got ${out[8 * 3 + 2]}`);
});

test('mpFrameToH36m2D: null when torso anchors missing', () => {
  const lms = makeLandmarks();
  delete (lms as unknown as Record<number, unknown>)[MP.LEFT_HIP];
  assert.equal(mpFrameToH36m2D(lms, 1), null);
});

test('mpFrameToH36m2D: spine sits between hip and thorax', () => {
  const out = mpFrameToH36m2D(makeLandmarks(), 1)!;
  const hipY = out[0 * 3 + 1], thorY = out[8 * 3 + 1], spineY = out[7 * 3 + 1];
  assert.ok(Math.abs(spineY - (hipY + thorY) / 2) < 1e-6);
});

test('patchWorldFromH36m: root-relative, scaled, z-sign applied', () => {
  const world = makeLandmarks();
  const joints = new Float32Array(H36M_JOINT_COUNT * 3);
  // root at (1, 2, 3); LWrist (H36M 13) at (1.5, 2, 3.25)
  joints.set([1, 2, 3], 0);
  joints.set([1.5, 2, 3.25], 13 * 3);
  patchWorldFromH36m(world, joints, 2, -1);
  const w = world[MP.LEFT_WRIST];
  assert.ok(Math.abs(w.x - 1) < 1e-6, `x = (1.5−1)·2; got ${w.x}`);
  assert.ok(Math.abs(w.y - 0) < 1e-6);
  assert.ok(Math.abs(w.z - -0.5) < 1e-6, `z = (3.25−3)·2·(−1); got ${w.z}`);
});

test('patchWorldFromH36m: nose and ears untouched', () => {
  const world = makeLandmarks();
  const before = { ...world[MP.NOSE] };
  const joints = new Float32Array(H36M_JOINT_COUNT * 3).fill(9);
  patchWorldFromH36m(world, joints, 1);
  assert.deepEqual(world[MP.NOSE], before, 'nose stays MediaPipe-driven');
});

test('mpFrameToH36m2D: square crop normalizes person to ±1 within bbox', () => {
  const lms = makeLandmarks();
  const aspect = 9 / 16;
  // Crop centred on the hips midpoint (0.5, 0.6·aspect) with half-size 0.2.
  const crop = { cx: 0.5, cy: 0.6 * aspect, half: 0.2 };
  const out = mpFrameToH36m2D(lms, aspect, crop)!;
  // Root (hip midpoint) lands at the crop centre → (0, 0).
  assert.ok(Math.abs(out[0]) < 1e-6, `root x; got ${out[0]}`);
  assert.ok(Math.abs(out[1]) < 1e-6, `root y; got ${out[1]}`);
  // LWrist (0.7, 0.5): x' = (0.7−0.5)/0.2 = 1, y' = (0.5·aspect − 0.6·aspect)/0.2
  assert.ok(Math.abs(out[13 * 3] - 1) < 1e-6, `LWri x; got ${out[13 * 3]}`);
  assert.ok(Math.abs(out[13 * 3 + 1] - (-0.1 * aspect) / 0.2) < 1e-6, `LWri y; got ${out[13 * 3 + 1]}`);
});

test('h36mHipWidth: distance between H36M hips', () => {
  const joints = new Float32Array(H36M_JOINT_COUNT * 3);
  joints.set([0.1, 0, 0], 1 * 3);  // RHip
  joints.set([-0.1, 0, 0], 4 * 3); // LHip
  assert.ok(Math.abs(h36mHipWidth(joints) - 0.2) < 1e-6);
});
