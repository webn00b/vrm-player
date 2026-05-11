/**
 * Unit tests for the visibility-loss state machine.
 *
 * Time is passed explicitly as `now` ms so tests don't need to mock
 * `performance.now()`. All assertions check the OUTPUT quaternion against
 * known references (live target, identity, or specific slerp blends).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createBoneTrackState,
  computeFadeTarget,
  trackPhase,
  msSinceLoss,
  HOLD_MS,
  RELAX_MS,
  RECOVER_MS,
  BoneTracker,
} from '../../.tmp-regression/trackers/boneTrackState.js';

const IDENTITY = new THREE.Quaternion();
const ROT_X_45 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 4);
const ROT_Y_90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

/** Angular distance in degrees between two quaternions. */
function quatAngleDeg(a, b) {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, d)));
}

test('visible from cold start: output equals live target', () => {
  const state = createBoneTrackState();
  const out = new THREE.Quaternion();
  computeFadeTarget(state, true, ROT_X_45, 0, out);
  // First visible frame, no recovery streak yet (sinceRecover=0) — output should
  // be slerp(recoveryFrom=identity, live, 0/RECOVER_MS) = identity. Recovery
  // engages until RECOVER_MS elapses.
  assert.ok(quatAngleDeg(out, IDENTITY) < 0.01, 'first visible frame ≈ identity (recovery start)');

  // After RECOVER_MS elapsed (still continuously visible), output should be live.
  computeFadeTarget(state, true, ROT_X_45, RECOVER_MS + 1, out);
  assert.ok(quatAngleDeg(out, ROT_X_45) < 0.01, 'after RECOVER_MS continuously visible → live');
});

test('FRESH phase: holds last good for HOLD_MS after visibility loss', () => {
  const state = createBoneTrackState();
  const out = new THREE.Quaternion();

  // Build history: visible for > RECOVER_MS so the state has converged to live.
  computeFadeTarget(state, true, ROT_X_45, 0,                 out);
  computeFadeTarget(state, true, ROT_X_45, RECOVER_MS + 50,  out);
  assert.ok(quatAngleDeg(out, ROT_X_45) < 0.01, 'sanity: converged to live');

  // Now drop visibility.
  computeFadeTarget(state, false, IDENTITY, RECOVER_MS + 50 + 50, out); // 50ms after loss
  assert.ok(quatAngleDeg(out, ROT_X_45) < 0.01, 'FRESH @ +50ms: holds live target');
  assert.equal(trackPhase(state, RECOVER_MS + 50 + 50), 'fresh');

  computeFadeTarget(state, false, IDENTITY, RECOVER_MS + 50 + HOLD_MS - 1, out); // just before fade
  assert.ok(quatAngleDeg(out, ROT_X_45) < 0.01, 'FRESH @ HOLD_MS-1: still holds');
});

test('DECAYING phase: linearly fades from last-good to identity', () => {
  const state = createBoneTrackState();
  const out = new THREE.Quaternion();

  // Converge.
  computeFadeTarget(state, true, ROT_X_45, 0, out);
  computeFadeTarget(state, true, ROT_X_45, RECOVER_MS + 50, out);
  const lossT = RECOVER_MS + 50;

  // Drop, advance into decay.
  // Half-fade point: HOLD_MS + RELAX_MS/2.
  const midDecayT = lossT + HOLD_MS + RELAX_MS / 2;
  computeFadeTarget(state, false, IDENTITY, midDecayT, out);
  assert.equal(trackPhase(state, midDecayT), 'decaying');

  // Output should be slerp(ROT_X_45, identity, 0.5) ≈ X-rotation by 22.5°
  const expectedHalf = new THREE.Quaternion().slerpQuaternions(ROT_X_45, IDENTITY, 0.5);
  assert.ok(
    quatAngleDeg(out, expectedHalf) < 0.5,
    `mid-decay should be ≈ slerp(live, identity, 0.5); got ${quatAngleDeg(out, expectedHalf).toFixed(2)}°`,
  );
});

test('RESTED phase: fully at identity after HOLD_MS + RELAX_MS', () => {
  const state = createBoneTrackState();
  const out = new THREE.Quaternion();

  computeFadeTarget(state, true, ROT_X_45, 0, out);
  computeFadeTarget(state, true, ROT_X_45, RECOVER_MS + 50, out);
  const lossT = RECOVER_MS + 50;
  computeFadeTarget(state, false, IDENTITY, lossT + HOLD_MS + RELAX_MS + 100, out);
  assert.equal(trackPhase(state, lossT + HOLD_MS + RELAX_MS + 100), 'rested');
  assert.ok(quatAngleDeg(out, IDENTITY) < 0.01, 'fully at identity');
});

test('recovery: visibility returns mid-decay, blends from where we were', () => {
  const state = createBoneTrackState();
  const out = new THREE.Quaternion();

  // Converge to live.
  computeFadeTarget(state, true, ROT_X_45, 0, out);
  computeFadeTarget(state, true, ROT_X_45, RECOVER_MS + 50, out);
  const lossT = RECOVER_MS + 50;

  // Drop into mid-decay (~halfway).
  const midDecayT = lossT + HOLD_MS + RELAX_MS / 2;
  computeFadeTarget(state, false, IDENTITY, midDecayT, out);
  const halfDecayed = out.clone();

  // Now bring visibility back with a NEW live target (ROT_Y_90).
  // At the recovery onset (sinceRecover = 0): output should equal halfDecayed.
  computeFadeTarget(state, true, ROT_Y_90, midDecayT + 1, out);
  assert.ok(
    quatAngleDeg(out, halfDecayed) < 1.0,
    `recovery onset: output should match decayed pose; got ${quatAngleDeg(out, halfDecayed).toFixed(2)}°`,
  );

  // After RECOVER_MS elapsed: output should equal new live target.
  computeFadeTarget(state, true, ROT_Y_90, midDecayT + 1 + RECOVER_MS + 50, out);
  assert.ok(
    quatAngleDeg(out, ROT_Y_90) < 0.01,
    `recovery complete: output should equal new live target; got ${quatAngleDeg(out, ROT_Y_90).toFixed(2)}°`,
  );
});

test('msSinceLoss: 0 while visible, counts from last-seen time', () => {
  const state = createBoneTrackState();
  const out = new THREE.Quaternion();

  // Note: msSinceLoss = (now - lastVisibleTime), i.e. "since last seen", not
  // "since the first non-visible frame we processed". Both interpretations are
  // reasonable; the implementation uses last-visible because HOLD_MS/RELAX_MS
  // are anchored to last-known-good observations.

  computeFadeTarget(state, true, ROT_X_45, 0, out);
  computeFadeTarget(state, true, ROT_X_45, 100, out);   // lastVisibleTime = 100
  assert.equal(msSinceLoss(state, 100), 0, 'currently visible → 0');

  computeFadeTarget(state, false, IDENTITY, 200, out);  // non-visible; lastVisibleTime stays at 100
  assert.equal(msSinceLoss(state, 250), 150, 'last seen at t=100, now=250 → 150');
  assert.equal(msSinceLoss(state, 300), 200, 'last seen at t=100, now=300 → 200');
});

test('trackPhase progression maps correctly across thresholds', () => {
  const state = createBoneTrackState();
  const out = new THREE.Quaternion();

  // Initially never observed.
  assert.equal(trackPhase(state, 0), 'rested', 'cold start → rested');

  // Visible, freshly engaged → 'recovering' until RECOVER_MS elapses.
  computeFadeTarget(state, true, ROT_X_45, 0, out);
  assert.equal(trackPhase(state, 0), 'recovering');
  assert.equal(trackPhase(state, RECOVER_MS - 1), 'recovering');

  // After RECOVER_MS, while still visible → 'live'.
  computeFadeTarget(state, true, ROT_X_45, RECOVER_MS + 10, out);
  assert.equal(trackPhase(state, RECOVER_MS + 10), 'live');

  // Drop visibility — go through fresh → decaying → rested.
  const lossT = RECOVER_MS + 10;
  computeFadeTarget(state, false, IDENTITY, lossT + 50, out);
  assert.equal(trackPhase(state, lossT + 50), 'fresh');

  computeFadeTarget(state, false, IDENTITY, lossT + HOLD_MS + 100, out);
  assert.equal(trackPhase(state, lossT + HOLD_MS + 100), 'decaying');

  computeFadeTarget(state, false, IDENTITY, lossT + HOLD_MS + RELAX_MS + 100, out);
  assert.equal(trackPhase(state, lossT + HOLD_MS + RELAX_MS + 100), 'rested');
});

test('BoneTracker: lazy allocation, independent per-bone states', () => {
  const tracker = new BoneTracker();
  const out1 = new THREE.Quaternion();
  const out2 = new THREE.Quaternion();

  // First time access creates state lazily.
  const stateA = tracker.state('leftHand');
  const stateB = tracker.state('leftHand');
  assert.equal(stateA, stateB, 'same bone → same state instance');

  // Different bones get different state.
  assert.notEqual(tracker.state('leftHand'), tracker.state('rightHand'));

  // resolve() drives them independently.
  tracker.resolve('leftHand',  true, ROT_X_45, 0,                out1);
  tracker.resolve('rightHand', true, ROT_Y_90, 0,                out2);
  tracker.resolve('leftHand',  true, ROT_X_45, RECOVER_MS + 10, out1);
  tracker.resolve('rightHand', true, ROT_Y_90, RECOVER_MS + 10, out2);
  assert.ok(quatAngleDeg(out1, ROT_X_45) < 0.01, 'leftHand converges to its own target');
  assert.ok(quatAngleDeg(out2, ROT_Y_90) < 0.01, 'rightHand converges to its own target');
});

test('reset clears all bone states', () => {
  const tracker = new BoneTracker();
  const out = new THREE.Quaternion();
  tracker.resolve('leftHand', true, ROT_X_45, 0, out);
  tracker.reset();
  // After reset, accessing the same name produces a fresh state.
  const fresh = tracker.state('leftHand');
  assert.equal(fresh.lastVisibleTime, -Infinity);
  assert.equal(fresh.wasVisible, false);
});
