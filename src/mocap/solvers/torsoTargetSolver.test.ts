/**
 * Smoke + contract tests for the three torso-target solvers:
 *   - solveHipsOrientationTarget (returns hip world quaternion or null)
 *   - solveHipPositionTarget     (returns hip world position Vector3)
 *   - solveSpineTarget           (returns spine half-twist quaternion + baseline)
 *
 * These compose torsoMath (already covered separately) + coordinate transforms.
 * We pin: degenerate-input null returns, basic-case finite output, contract
 * shapes. Behaviour deep-dives live in torsoMath.test.ts.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  solveHipsOrientationTarget,
  solveHipPositionTarget,
  solveSpineTarget,
} from './torsoTargetSolver';

const IDENT = new THREE.Quaternion();

// ── solveHipsOrientationTarget ───────────────────────────────────────────────

test('hips orientation: standing T-pose → returns a finite quaternion', () => {
  const result = solveHipsOrientationTarget({
    mirrorX: false,
    leftHip:        { x: -0.1, y: 0.9, z: 0 },
    rightHip:       { x:  0.1, y: 0.9, z: 0 },
    leftShoulder:   { x: -0.2, y: 0.2, z: 0 },
    rightShoulder:  { x:  0.2, y: 0.2, z: 0 },
    hipsBaseWorld:           IDENT.clone(),
    hipsParentWorldQuaternion: IDENT.clone(),
    torsoAxisMaxDivergenceDeg: 20,
  });
  assert.ok(result, 'should produce a quaternion for valid input');
  assert.ok(Number.isFinite(result!.x) && Number.isFinite(result!.y) &&
            Number.isFinite(result!.z) && Number.isFinite(result!.w));
});

test('hips orientation: hips & shoulders collinear → returns null (no usable basis)', () => {
  // Both hip pairs identical → hipAxis has zero length → bail.
  const result = solveHipsOrientationTarget({
    mirrorX: false,
    leftHip:  { x: 0, y: 0.9, z: 0 },
    rightHip: { x: 0, y: 0.9, z: 0 },
    leftShoulder:  { x: -0.2, y: 0.2, z: 0 },
    rightShoulder: { x:  0.2, y: 0.2, z: 0 },
    hipsBaseWorld:             IDENT.clone(),
    hipsParentWorldQuaternion: IDENT.clone(),
    torsoAxisMaxDivergenceDeg: 20,
  });
  assert.equal(result, null);
});

test('hips orientation: degenerate spine (shoulders == hips) → returns null', () => {
  const result = solveHipsOrientationTarget({
    mirrorX: false,
    leftHip:        { x: -0.1, y: 0.5, z: 0 },
    rightHip:       { x:  0.1, y: 0.5, z: 0 },
    leftShoulder:   { x: -0.1, y: 0.5, z: 0 },  // same Y as hips
    rightShoulder:  { x:  0.1, y: 0.5, z: 0 },
    hipsBaseWorld:             IDENT.clone(),
    hipsParentWorldQuaternion: IDENT.clone(),
    torsoAxisMaxDivergenceDeg: 20,
  });
  assert.equal(result, null);
});

// ── solveHipPositionTarget ───────────────────────────────────────────────────

test('hip position: returns finite Vector3 for sensible inputs', () => {
  const result = solveHipPositionTarget({
    mirrorX: false,
    depthScale: 1.0,
    perfCenterX: 0,
    perfCenterY: 0.9,
    perfCenterZ: 0,
    perfBaseline:        new THREE.Vector3(0, 0.9, 0),
    avatarBaselineWorld: new THREE.Vector3(0, 1.0, 0),
    hipsParentWorldPosition:   new THREE.Vector3(0, 0, 0),
    hipsParentWorldQuaternion: IDENT.clone(),
    scale: 1.0,
  });
  assert.ok(result instanceof THREE.Vector3);
  assert.ok(Number.isFinite(result.x) && Number.isFinite(result.y) && Number.isFinite(result.z));
});

test('hip position: zero performer-shift → result equals avatar baseline', () => {
  const result = solveHipPositionTarget({
    mirrorX: false,
    depthScale: 1.0,
    perfCenterX: 0.5,    // same as baseline X
    perfCenterY: 0.9,
    perfCenterZ: 0,
    perfBaseline:        new THREE.Vector3(0.5, 0.9, 0),  // exactly equals current
    avatarBaselineWorld: new THREE.Vector3(0, 1.0, 0),
    hipsParentWorldPosition:   new THREE.Vector3(0, 0, 0),
    hipsParentWorldQuaternion: IDENT.clone(),
    scale: 1.0,
  });
  // Delta is zero → position is just avatar baseline transformed to parent-local.
  // Since parent is identity rotation at origin, parent-local == world.
  assert.ok(Math.abs(result.x - 0) < 1e-6);
  assert.ok(Math.abs(result.y - 1.0) < 1e-6);
});

// ── solveSpineTarget ─────────────────────────────────────────────────────────

test('spine: T-pose with all four landmarks → returns finite halfTwist', () => {
  const result = solveSpineTarget({
    mirrorX: false,
    leftShoulder:  { x: -0.2, y: 0.2, z: 0 },
    rightShoulder: { x:  0.2, y: 0.2, z: 0 },
    leftHip:       { x: -0.1, y: 0.9, z: 0 },
    rightHip:      { x:  0.1, y: 0.9, z: 0 },
    hipsWorldQuaternion:        IDENT.clone(),
    avatarShoulderRestLocal:    new THREE.Vector3(1, 0, 0),
    torsoAxisMaxDivergenceDeg:  20,
    torsoForwardBaseline:       null,
    forwardBendScale:           1.0,
    lateralBendScale:           0.35,
    lateralBendScaleMax:        0.7,
    spineNodeCount:             2,
  });
  assert.ok(result, 'should produce a spine result for valid input');
  // halfTwist is a quaternion.
  assert.ok(Number.isFinite(result!.halfTwist.x) && Number.isFinite(result!.halfTwist.w));
  // baseline gets seeded.
  assert.ok(result!.nextForwardBaseline !== null);
});

test('spine: hips=null (upper body only) → still produces a result via shoulder-rest fallback', () => {
  const result = solveSpineTarget({
    mirrorX: false,
    leftShoulder:  { x: -0.2, y: 0.2, z: 0 },
    rightShoulder: { x:  0.2, y: 0.2, z: 0 },
    leftHip:       null,
    rightHip:      null,
    hipsWorldQuaternion:        IDENT.clone(),
    avatarShoulderRestLocal:    new THREE.Vector3(1, 0, 0),
    torsoAxisMaxDivergenceDeg:  20,
    torsoForwardBaseline:       0,
    forwardBendScale:           1.0,
    lateralBendScale:           0.35,
    lateralBendScaleMax:        0.7,
    spineNodeCount:             2,
  });
  assert.ok(result, 'should fall through to shoulder-rest reference');
});

test('spine: baseline is captured then re-used (consistent twist across frames)', () => {
  const input = {
    mirrorX: false,
    leftShoulder:  { x: -0.2, y: 0.2, z: 0 },
    rightShoulder: { x:  0.2, y: 0.2, z: 0 },
    leftHip:       { x: -0.1, y: 0.9, z: 0 },
    rightHip:      { x:  0.1, y: 0.9, z: 0 },
    hipsWorldQuaternion:        IDENT.clone(),
    avatarShoulderRestLocal:    new THREE.Vector3(1, 0, 0),
    torsoAxisMaxDivergenceDeg:  20,
    torsoForwardBaseline:       null as number | null,
    forwardBendScale:           1.0,
    lateralBendScale:           0.35,
    lateralBendScaleMax:        0.7,
    spineNodeCount:             2,
  };
  const first = solveSpineTarget(input);
  assert.ok(first);
  // Feed the captured baseline back in — same pose should yield the same twist.
  input.torsoForwardBaseline = first!.nextForwardBaseline;
  const second = solveSpineTarget(input);
  assert.ok(second);
  // Quaternions should match (same pose → same twist).
  assert.ok(Math.abs(first!.halfTwist.dot(second!.halfTwist)) > 0.999);
});
