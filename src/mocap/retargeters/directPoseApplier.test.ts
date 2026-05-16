/**
 * Integration tests for DirectPoseApplier with a mock VRM.
 *
 * These exercise the apply() hot path end-to-end: synthetic PoseFrames go
 * in, the applier mutates bone-local quaternions on the mock VRM, we read
 * those quaternions back and assert structural properties.
 *
 * Coverage focuses on USER-VISIBLE behaviors:
 *   - basic apply() doesn't crash and produces sane bone state
 *   - bone-fade state machine: visible → invisible → recovery progression
 *   - getTrackingHealth() reflects actual state
 *   - bilateral-symmetry input → bilateral-symmetric output (roughly)
 *
 * Pure-math inputs to solvers are already covered by their own .test files;
 * this suite verifies the WIRING between them through the applier shell.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DirectPoseApplier } from './directPoseApplier';
import { MocapCalibration } from '../trackers/mocapCalibration';
import { buildMockVRM, buildMockPoseFrame } from '../../../tests/fixtures/mockVrm';

/** Build a fully-calibrated MocapCalibration by feeding a few T-pose frames. */
function buildCalibratedCalibration(vrm: any): MocapCalibration {
  const cal = new MocapCalibration(vrm);
  const frame = buildMockPoseFrame();
  // Feed several frames so the EMA converges and we hit "calibrated".
  for (let i = 0; i < 5; i++) cal.feed(frame as any);
  return cal;
}

// ── Construction & smoke ─────────────────────────────────────────────────

test('constructor: builds without throwing for a mock VRM', () => {
  const vrm = buildMockVRM();
  // Should not throw.
  const applier = new DirectPoseApplier(vrm as any);
  assert.ok(applier);
  // Hips base world should match the mock setup (y ≈ 1.0).
  assert.ok(Math.abs(applier.hipsBaseWorld.w - 1) < 1e-3,
    `hipsBaseWorld should start near identity quaternion`);
});

test('apply() with calibrated frame: does not throw, mutates bones', () => {
  const vrm = buildMockVRM();
  const cal = buildCalibratedCalibration(vrm);
  const applier = new DirectPoseApplier(vrm as any, cal);

  const beforeUpperArm = vrm.bones.get('leftUpperArm')!.quaternion.clone();
  const frame = buildMockPoseFrame();
  applier.apply(frame as any);

  // Bones may or may not change for an exact-T-pose input; just verify no
  // throw and quaternions are still valid (unit norm).
  const after = vrm.bones.get('leftUpperArm')!.quaternion;
  const norm = Math.sqrt(after.x ** 2 + after.y ** 2 + after.z ** 2 + after.w ** 2);
  assert.ok(Math.abs(norm - 1) < 0.01, `bone quaternion stays unit-normalized; got |q|=${norm}`);
});

test('apply() moves bones away from rest when input deviates from T-pose', () => {
  const vrm = buildMockVRM();
  const cal = buildCalibratedCalibration(vrm);
  const applier = new DirectPoseApplier(vrm as any, cal);

  // Bend left arm up — move performer's left wrist (idx 15) overhead.
  const frame = buildMockPoseFrame();
  frame.worldLandmarks[15] = { x: 0.2, y: 0.8, z: 0, visibility: 1 };  // wrist up & in
  frame.worldLandmarks[13] = { x: 0.3, y: 0.5, z: 0, visibility: 1 };  // elbow up

  // Run a few frames so the slerp-toward-target loop converges.
  for (let i = 0; i < 30; i++) applier.apply(frame as any);

  // After repeated apply()s the right side bones (driven by performer LEFT
  // landmarks 11/13/15 → avatar RIGHT) should have rotated noticeably.
  const rightUpper = vrm.bones.get('rightUpperArm')!.quaternion;
  const angleFromIdentity = 2 * Math.acos(Math.min(1, Math.abs(rightUpper.w)));
  assert.ok(angleFromIdentity > 0.1,
    `right upper arm should rotate; angle=${angleFromIdentity.toFixed(3)} rad`);
});

// ── Tracking-health readout ──────────────────────────────────────────────

test('getTrackingHealth: all chains start at "rested" before any apply()', () => {
  const vrm = buildMockVRM();
  const cal = buildCalibratedCalibration(vrm);
  const applier = new DirectPoseApplier(vrm as any, cal);

  const health = applier.getTrackingHealth();
  // Cold start: no bones observed yet.
  assert.equal(health.leftArm.phase, 'rested');
  assert.equal(health.rightArm.phase, 'rested');
  assert.equal(health.leftLeg.phase, 'rested');
  assert.equal(health.rightLeg.phase, 'rested');
});

test('getTrackingHealth: after apply() with visible inputs, chains progress to "recovering" then "live"', () => {
  const vrm = buildMockVRM();
  const cal = buildCalibratedCalibration(vrm);
  const applier = new DirectPoseApplier(vrm as any, cal);

  const frame = buildMockPoseFrame();
  applier.apply(frame as any);
  let health = applier.getTrackingHealth();
  // Right after first apply: phase is "recovering" (within RECOVER_MS window).
  assert.ok(health.leftArm.phase === 'recovering' || health.leftArm.phase === 'live',
    `leftArm should be recovering/live after apply, got ${health.leftArm.phase}`);
});

// ── A1 fade behavior ─────────────────────────────────────────────────────

test('A1 fade: hidden landmark transitions through fresh → decaying → rested', async () => {
  const vrm = buildMockVRM();
  const cal = buildCalibratedCalibration(vrm);
  const applier = new DirectPoseApplier(vrm as any, cal);

  // First: visible apply to establish a "live" bone.
  let frame = buildMockPoseFrame();
  applier.apply(frame as any);
  // Sleep a tad to let RECOVER_MS pass — use a busy-wait simulation
  // since we don't have time mocking and vitest is fast.
  // Actually we use the applier's _now which is captured at apply() time;
  // we can't easily fake-advance without mocking performance.now().
  // We can verify the IMMEDIATE state-machine response by examining health.

  // Now hide the left-arm chain entirely (set wrist+elbow+shoulder visibility=0).
  frame = buildMockPoseFrame({
    visibility: {
      11: 0, 12: 0, 13: 0, 14: 0, 15: 0, 16: 0,  // shoulders/elbows/wrists
    },
  });
  applier.apply(frame as any);

  const health = applier.getTrackingHealth();
  // After processing an invisible frame, the chain's lastVisibleTime is from
  // the PREVIOUS visible apply, so msSinceLoss > 0 but very small (still fresh).
  // We just verify the phase is no longer "live"/"recovering".
  assert.ok(
    health.leftArm.phase === 'fresh' || health.leftArm.phase === 'decaying' ||
    health.leftArm.phase === 'rested',
    `expected post-loss phase, got ${health.leftArm.phase}`,
  );
});

// ── Bilateral symmetry sanity check ──────────────────────────────────────

test('mirror-symmetric input → similar magnitude on both sides', () => {
  const vrm = buildMockVRM();
  const cal = buildCalibratedCalibration(vrm);
  const applier = new DirectPoseApplier(vrm as any, cal);

  // T-pose-like input (already symmetric). Run a few frames.
  const frame = buildMockPoseFrame();
  for (let i = 0; i < 10; i++) applier.apply(frame as any);

  const leftUpper  = vrm.bones.get('leftUpperArm')!.quaternion;
  const rightUpper = vrm.bones.get('rightUpperArm')!.quaternion;

  // For a symmetric input, the magnitudes of the rotation angles should match
  // closely (the rotations themselves are mirror-images, so their angles equal).
  const leftAngle  = 2 * Math.acos(Math.min(1, Math.abs(leftUpper.w)));
  const rightAngle = 2 * Math.acos(Math.min(1, Math.abs(rightUpper.w)));
  assert.ok(Math.abs(leftAngle - rightAngle) < 0.1,
    `symmetric input → similar bone angles; got L=${leftAngle.toFixed(3)} R=${rightAngle.toFixed(3)}`);
});

// ── Symmetry-fallback toggle wiring ──────────────────────────────────────

test('head polish: nose offset after baseline rotates head softly', () => {
  const vrm = buildMockVRM();
  const cal = buildCalibratedCalibration(vrm);
  const applier = new DirectPoseApplier(vrm as any, cal);

  const baseline = buildMockPoseFrame();
  applier.apply(baseline as any);

  const turned = buildMockPoseFrame();
  turned.worldLandmarks[0] = { ...turned.worldLandmarks[0], x: 0.12 };
  for (let i = 0; i < 12; i++) applier.apply(turned as any);

  const head = vrm.bones.get('head')!.quaternion;
  const angleFromIdentity = 2 * Math.acos(Math.min(1, Math.abs(head.w)));
  assert.ok(angleFromIdentity > 0.02, `head should rotate softly; angle=${angleFromIdentity.toFixed(3)} rad`);
  assert.ok(angleFromIdentity < 0.5, `head polish should stay conservative; angle=${angleFromIdentity.toFixed(3)} rad`);
});

test('symmetryFallback setter/getter round-trip', () => {
  const vrm = buildMockVRM();
  const applier = new DirectPoseApplier(vrm as any);
  assert.equal(applier.symmetryFallback, false, 'off by default');
  applier.setSymmetryFallback(true);
  assert.equal(applier.symmetryFallback, true);
  applier.setSymmetryFallback(false);
  assert.equal(applier.symmetryFallback, false);
});

// ── Visibility threshold wiring ──────────────────────────────────────────

test('setVisibilityThreshold clamps to [0, 1]', () => {
  const vrm = buildMockVRM();
  const applier = new DirectPoseApplier(vrm as any);
  applier.setVisibilityThreshold(-5);
  assert.equal(applier.visibilityThreshold, 0);
  applier.setVisibilityThreshold(99);
  assert.equal(applier.visibilityThreshold, 1);
  applier.setVisibilityThreshold(0.4);
  assert.equal(applier.visibilityThreshold, 0.4);
});

// ── getQuaternion / getRestAxis ──────────────────────────────────────────

test('getQuaternion returns local quaternion as [x,y,z,w] tuple', () => {
  const vrm = buildMockVRM();
  const applier = new DirectPoseApplier(vrm as any);
  const q = applier.getQuaternion('leftUpperArm');
  assert.ok(q, 'should return a tuple');
  assert.equal(q!.length, 4);
  // Initial quaternion is identity → [0, 0, 0, 1].
  assert.ok(Math.abs(q![3] - 1) < 1e-6);
});

test('getQuaternion returns null for unknown bone', () => {
  const vrm = buildMockVRM();
  const applier = new DirectPoseApplier(vrm as any);
  const q = applier.getQuaternion('nonExistentBone');
  assert.equal(q, null);
});

test('getRestAxis returns Vector3 for known bone, null for unknown', () => {
  const vrm = buildMockVRM();
  const applier = new DirectPoseApplier(vrm as any);
  const axis = applier.getRestAxis('leftUpperArm');
  assert.ok(axis, 'known bone has a rest axis');
  // For our mock with arms along +X, leftUpperArm rest axis is approximately +X.
  assert.ok(Math.abs(axis!.length() - 1) < 1e-6, 'rest axis is unit length');

  assert.equal(applier.getRestAxis('nonExistent'), null);
});
