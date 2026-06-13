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
    torsoTwistMaxDeg:           60,
    torsoTwistMaxStepDeg:       18,
    torsoTwistDeadbandDeg:      0,
    prevTwistYaw:               null,
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
    torsoTwistMaxDeg:           60,
    torsoTwistMaxStepDeg:       18,
    torsoTwistDeadbandDeg:      0,
    prevTwistYaw:               null,
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
    torsoTwistMaxDeg:           60,
    torsoTwistMaxStepDeg:       18,
    torsoTwistDeadbandDeg:      0,
    prevTwistYaw:               null as number | null,
  };
  const first = solveSpineTarget(input);
  assert.ok(first);
  // Feed the captured baseline back in — same pose should yield the same twist.
  input.torsoForwardBaseline = first!.nextForwardBaseline;
  input.prevTwistYaw = first!.nextTwistYaw;
  const second = solveSpineTarget(input);
  assert.ok(second);
  // Quaternions should match (same pose → same twist).
  assert.ok(Math.abs(first!.halfTwist.dot(second!.halfTwist)) > 0.999);
});

// ── P1 (clamp + rate-limit) and P3 (anti-parallel) ───────────────────────────

test('spine: hard cap bounds the yaw on an extreme shoulder/hip divergence', () => {
  // Shoulders rotated ~135° in azimuth vs hips (deep depth disagreement).
  // Raw atan2 yaw would exceed the 60° cap; result must be bounded.
  const result = solveSpineTarget({
    mirrorX: false,
    // shoulders mostly along ±Z (turned to profile), hips along ±X (frontal)
    leftShoulder:  { x: -0.05, y: 0.2, z: -0.2 },
    rightShoulder: { x:  0.05, y: 0.2, z:  0.2 },
    leftHip:       { x: -0.1,  y: 0.9, z: 0 },
    rightHip:      { x:  0.1,  y: 0.9, z: 0 },
    hipsWorldQuaternion:        IDENT.clone(),
    avatarShoulderRestLocal:    new THREE.Vector3(1, 0, 0),
    torsoAxisMaxDivergenceDeg:  20,
    torsoForwardBaseline:       0,
    forwardBendScale:           0,
    lateralBendScale:           0,
    lateralBendScaleMax:        0,
    spineNodeCount:             2,
    torsoTwistMaxDeg:           60,
    torsoTwistMaxStepDeg:       180, // disable rate limit for this test
    torsoTwistDeadbandDeg:      0,
    prevTwistYaw:               null,
  });
  assert.ok(result);
  // nextTwistYaw must respect the hard cap.
  assert.ok(
    Math.abs(result!.nextTwistYaw) <= THREE.MathUtils.degToRad(60) + 1e-6,
    `yaw ${result!.nextTwistYaw} exceeds 60° cap`,
  );
});

test('spine: rate limiter blocks a single-frame yaw teleport', () => {
  const base = {
    mirrorX: false,
    leftShoulder:  { x: -0.05, y: 0.2, z: -0.2 },
    rightShoulder: { x:  0.05, y: 0.2, z:  0.2 },
    leftHip:       { x: -0.1,  y: 0.9, z: 0 },
    rightHip:      { x:  0.1,  y: 0.9, z: 0 },
    hipsWorldQuaternion:        IDENT.clone(),
    avatarShoulderRestLocal:    new THREE.Vector3(1, 0, 0),
    torsoAxisMaxDivergenceDeg:  20,
    torsoForwardBaseline:       0,
    forwardBendScale:           0,
    lateralBendScale:           0,
    lateralBendScaleMax:        0,
    spineNodeCount:             2,
    torsoTwistMaxDeg:           60,
    torsoTwistMaxStepDeg:       18,
    torsoTwistDeadbandDeg:      0,
    prevTwistYaw:               0, // previous frame had zero twist
  };
  const result = solveSpineTarget(base);
  assert.ok(result);
  // Single-frame change cannot exceed the per-frame step.
  assert.ok(
    Math.abs(result!.nextTwistYaw) <= THREE.MathUtils.degToRad(18) + 1e-6,
    `yaw step ${result!.nextTwistYaw} exceeds 18°/frame`,
  );
});

test('spine: soft-deadband suppresses small near-frontal yaw but keeps large twists', () => {
  // Near-frontal: shoulders along ±X with a tiny depth asymmetry → small yaw.
  const frontalish = {
    mirrorX: false,
    leftShoulder:  { x: -0.2, y: 0.2, z: -0.015 },
    rightShoulder: { x:  0.2, y: 0.2, z:  0.015 },
    leftHip:       { x: -0.1, y: 0.9, z: 0 },
    rightHip:      { x:  0.1, y: 0.9, z: 0 },
    hipsWorldQuaternion:        IDENT.clone(),
    avatarShoulderRestLocal:    new THREE.Vector3(1, 0, 0),
    torsoAxisMaxDivergenceDeg:  90, // don't let stabilizer eat the divergence
    torsoForwardBaseline:       0,
    forwardBendScale:           0,
    lateralBendScale:           0,
    lateralBendScaleMax:        0,
    spineNodeCount:             2,
    torsoTwistMaxDeg:           60,
    torsoTwistMaxStepDeg:       180,
    torsoTwistDeadbandDeg:      0,
    prevTwistYaw:               null as number | null,
  };
  const raw = solveSpineTarget({ ...frontalish, torsoTwistDeadbandDeg: 0 });
  const dead = solveSpineTarget({ ...frontalish, torsoTwistDeadbandDeg: 10 });
  assert.ok(raw && dead);
  // The raw yaw must actually be inside the deadband region for this to test it.
  assert.ok(Math.abs(raw!.nextTwistYaw) < THREE.MathUtils.degToRad(10),
    `precondition: raw yaw ${raw!.nextTwistYaw} should be small`);
  // Deadband strictly shrinks it toward zero.
  assert.ok(Math.abs(dead!.nextTwistYaw) < Math.abs(raw!.nextTwistYaw),
    `deadband should suppress small yaw (${dead!.nextTwistYaw} vs ${raw!.nextTwistYaw})`);

  // A clearly-large twist (profile shoulders vs frontal hips) passes through.
  const profile = {
    ...frontalish,
    leftShoulder:  { x: -0.05, y: 0.2, z: -0.2 },
    rightShoulder: { x:  0.05, y: 0.2, z:  0.2 },
  };
  const bigRaw = solveSpineTarget({ ...profile, torsoTwistDeadbandDeg: 0 });
  const bigDead = solveSpineTarget({ ...profile, torsoTwistDeadbandDeg: 10 });
  assert.ok(bigRaw && bigDead);
  assert.ok(
    Math.abs(bigDead!.nextTwistYaw - bigRaw!.nextTwistYaw) < THREE.MathUtils.degToRad(0.5),
    `large twist must pass through (${bigDead!.nextTwistYaw} vs ${bigRaw!.nextTwistYaw})`,
  );
});
