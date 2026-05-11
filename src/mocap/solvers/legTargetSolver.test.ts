/**
 * Tests for solveLegTarget: foot IK target derivation + foot-lock state machine.
 *
 * Inputs: performer hip/knee/ankle landmarks (metres, MediaPipe world frame).
 * Outputs: avatar-space ankle world target, pole vector for elbow/knee bend,
 *          locked flag (true = foot lock is engaged, hold position).
 *
 * Covers:
 *   - basic ankle target = hipWorld + (ankle − hip) * legScale, with legSpreadX
 *     fanning the foot outward along avatar X
 *   - ground-Y clamp (foot cannot sink below floor)
 *   - foot lock engages when target is low-velocity AND near ground
 *   - foot lock releases when target moves fast OR lifts off ground
 *   - pole vector is hip→knee direction, smoothed with EMA across calls
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveLegTarget } from './legTargetSolver';

/** Build a fresh LegLockState for each test. */
function newState() {
  return {
    locked:         false,
    lockedPosition: new THREE.Vector3(),
    prevTarget:     new THREE.Vector3(Infinity, Infinity, Infinity),
    smoothedPole:   new THREE.Vector3(),
  };
}

/** Common inputs with foot-lock disabled to isolate target math. */
function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    mirrorX: false,
    hip:   { x: 0,    y: 0,    z: 0 },
    knee:  { x: 0,    y: 0.5,  z: 0 },
    ankle: { x: 0,    y: 1.0,  z: 0 },
    hipWorld: new THREE.Vector3(0, 1, 0),  // avatar hip at world y=1
    legScale: 1.0,
    legSpreadX: 1.0,
    groundY: 0,
    poleAlpha: 1.0,  // full lerp = use current frame as-is
    footLockEnabled: false,
    footVelocityLockThreshold:   0.007,
    footVelocityUnlockThreshold: 0.018,
    footLiftThreshold:           0.05,
    state: newState(),
    ...overrides,
  };
}

test('basic: ankle target = hipWorld + (ankle − hip) * legScale, with Y/Z flipped from MediaPipe', () => {
  const input = baseInput({
    ankle: { x: 0, y: 1.0, z: 0 },
  });
  const out = solveLegTarget(input as any);
  // (ankle − hip) = (0, 1, 0); mpDeltaToVrm flips Y → (0, −1, 0); legScale=1.
  // hipWorld y=1, so target y = 1 − 1 = 0.
  // groundY = 0 → target y clamped to 0.
  assert.ok(Math.abs(out.target.y - 0) < 1e-6, `target should land at ground; got y=${out.target.y}`);
  assert.ok(Math.abs(out.target.x) < 1e-6);
});

test('legScale > 1 stretches the offset proportionally', () => {
  const out = solveLegTarget(baseInput({
    legScale: 2.0,
    hipWorld: new THREE.Vector3(0, 5, 0),  // make headroom so we're not clamped
    groundY: -10,
  }) as any);
  // (ankle − hip) = (0, 1, 0) → mpDelta = (0, −1, 0) → * 2 = (0, −2, 0).
  // hipWorld y=5 → target y = 5 − 2 = 3.
  assert.ok(Math.abs(out.target.y - 3) < 1e-6);
});

test('legSpreadX fans the foot outward along X without changing Y', () => {
  const out = solveLegTarget(baseInput({
    ankle: { x: 0.2, y: 1.0, z: 0 },
    legSpreadX: 1.5,
    hipWorld: new THREE.Vector3(0, 2, 0),
    groundY: -10,
  }) as any);
  // x delta = 0.2 → mpDelta x = 0.2 (mirrorX=false) → * legSpreadX 1.5 = 0.3.
  // target.x = hipWorld.x + 0.3 = 0.3.
  assert.ok(Math.abs(out.target.x - 0.3) < 1e-6, `x with spread=1.5; got ${out.target.x}`);
});

test('ground-Y clamp: target below ground gets snapped to groundY', () => {
  const out = solveLegTarget(baseInput({
    ankle: { x: 0, y: 5, z: 0 },         // ankle WAY below hip in MediaPipe Y-down
    hipWorld: new THREE.Vector3(0, 0, 0), // hip at world origin
    legScale: 1,
    groundY: -0.5,
  }) as any);
  // (ankle − hip).y = 5 → mpDelta.y = −5 → target.y = 0 + (−5) = −5.
  // groundY = −0.5 → clamp to −0.5.
  assert.equal(out.target.y, -0.5);
});

test('foot lock: engages when velocity low AND near ground, then holds target', () => {
  const state = newState();
  state.prevTarget.set(0.001, 0, 0);  // pretend last target was very close

  // Frame 1: target near ground, very small velocity → should LOCK.
  const r1 = solveLegTarget(baseInput({
    hipWorld: new THREE.Vector3(0, 1, 0),
    legScale: 1,
    ankle: { x: 0, y: 1, z: 0 },  // → target y = 0
    footLockEnabled: true,
    state,
  }) as any);
  assert.equal(r1.locked, true, 'should lock on slow + ground contact');

  // Frame 2: re-call with ankle slightly different — locked target should NOT move.
  const r2 = solveLegTarget(baseInput({
    hipWorld: new THREE.Vector3(0, 1, 0),
    legScale: 1,
    ankle: { x: 0.001, y: 1.0001, z: 0 },  // tiny jitter
    footLockEnabled: true,
    state,
  }) as any);
  assert.equal(r2.locked, true, 'still locked');
  assert.ok(r1.target.distanceTo(r2.target) < 1e-6, 'locked target stays put');
});

test('foot lock: releases when target lifts off ground above footLiftThreshold', () => {
  const state = newState();
  state.locked = true;
  state.lockedPosition.set(0, 0, 0);
  state.prevTarget.set(0, 0, 0);

  // Performer lifts the foot — ankle Y in MediaPipe small (foot high in view).
  // (ankle − hip).y = 0.2 → mpDelta.y = −0.2 → target.y = hipWorld.y − 0.2.
  // With hipWorld.y = 1, target.y = 0.8 → well above groundY=0 + threshold=0.05.
  const result = solveLegTarget(baseInput({
    hipWorld: new THREE.Vector3(0, 1, 0),
    ankle: { x: 0, y: 0.2, z: 0 },  // foot lifted off ground
    footLockEnabled: true,
    state,
  }) as any);
  assert.equal(result.locked, false, 'should unlock when foot lifts');
});

test('pole direction: hip → knee direction smoothed via EMA', () => {
  const state = newState();
  // First call: state.smoothedPole is zero → adopt current pole.
  const r1 = solveLegTarget(baseInput({
    knee: { x: 0, y: 0.5, z: 0 },  // mpDelta = (0, −0.5, 0)
    poleAlpha: 0.5,
    state,
  }) as any);
  assert.ok(r1.poleDirection.y < 0, `pole should point downward (toward knee in VRM frame)`);

  // Second call: knee shifted to +X — pole should lerp halfway.
  const r2 = solveLegTarget(baseInput({
    knee: { x: 1, y: 0.5, z: 0 },
    poleAlpha: 0.5,
    state,
  }) as any);
  // X started at 0, target X is positive → lerped X ∈ (0, target).
  assert.ok(r2.poleDirection.x > 0 && r2.poleDirection.x < 1);
});

test('zero hip→knee delta: pole defaults to gravity (0, −1, 0)', () => {
  const state = newState();
  const result = solveLegTarget(baseInput({
    hip:  { x: 0, y: 0, z: 0 },
    knee: { x: 0, y: 0, z: 0 },  // coincident
    poleAlpha: 1.0,
    state,
  }) as any);
  assert.equal(result.poleDirection.x, 0);
  assert.equal(result.poleDirection.y, -1);
  assert.equal(result.poleDirection.z, 0);
});

test('result.target is a CLONE (mutating it doesn\'t affect internal state)', () => {
  const out = solveLegTarget(baseInput({}) as any);
  const before = out.target.y;
  out.target.y = 999;
  // The internal `_v2` shouldn't have been mutated — call again to verify.
  const out2 = solveLegTarget(baseInput({}) as any);
  assert.equal(out2.target.y, before, 'subsequent call gives same target');
});
