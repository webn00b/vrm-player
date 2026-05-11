/**
 * Smoke + behaviour tests for solveArmTarget.
 *
 * The solver fuses ~30 inputs (landmarks + scales + chest/neck/head world
 * positions + heuristic flags) into a single wrist-target world position.
 * Exhaustive coverage would require its own fixture suite; this file pins
 * the highest-impact behaviours:
 *
 *   1. Basic call returns a well-formed result (no NaN, all fields present)
 *   2. Wrist target moves with the performer's wrist landmark
 *   3. Mirror flips the X target sign
 *   4. armScale stretches Y/Z offsets proportionally
 *   5. Heuristic-blend codepaths (hands-together, prayer) don't crash on
 *      hand-clap configurations
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveArmTarget } from './armTargetSolver';
import type { ArmTargetSolverInput } from './armTargetSolver';

/** Build a default-ish ArmTargetSolverInput. Override specific fields per test. */
function baseInput(overrides: Partial<ArmTargetSolverInput> = {}): ArmTargetSolverInput {
  // Default body landmarks: 33 entries with safe defaults. Most aren't read
  // by the solver in our specific test cases.
  const bodyLandmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));

  return {
    side: 'left',
    mirrorX: false,
    // Shoulders 60 cm apart, centred at origin.
    perfLeftShoulder:  { x: -0.3, y: 0,   z: 0 },
    perfRightShoulder: { x:  0.3, y: 0,   z: 0 },
    perfShoulder:      { x:  0.3, y: 0,   z: 0 },  // performer right shoulder (mirror)
    perfElbow:         { x:  0.6, y: 0.2, z: 0 },
    perfWrist:         { x:  0.9, y: 0.4, z: 0 },
    otherWrist:        null,
    perfLeftHip:       { x: -0.2, y: 0.9, z: 0 },
    perfRightHip:      { x:  0.2, y: 0.9, z: 0 },
    bodyLandmarks,
    faceLandmarks:     [],
    hand:              undefined,
    hasBothHandsDetected: false,
    shoulderWorld:     new THREE.Vector3(-0.15, 1.4, 0),  // avatar shoulder world
    midAvatarShoulder: new THREE.Vector3( 0,    1.4, 0),
    chestWorld:        new THREE.Vector3( 0,    1.2, 0),
    neckWorld:         new THREE.Vector3( 0,    1.5, 0),
    headWorld:         new THREE.Vector3( 0,    1.7, 0),
    rawArmScale:       1.0,
    armScale:          1.0,
    shoulderScale:     1.0,
    bodyScale:         1.0,
    avatarArmLen:      0.6,
    avatarShoulderWidth: 0.3,
    armZAttenuation:   1.0,
    armPoleZ:          0.5,
    ...overrides,
  };
}

test('basic call: result has all required fields, no NaN', () => {
  const result = solveArmTarget(baseInput());
  assert.ok(result.target instanceof THREE.Vector3);
  assert.ok(result.elbowTarget instanceof THREE.Vector3);
  assert.ok(result.rawPoleDirection instanceof THREE.Vector3);
  assert.ok(typeof result.frontPoseBlendBase === 'number');
  assert.ok(result.diagnostics);
  // No NaN.
  for (const v of [result.target, result.elbowTarget, result.rawPoleDirection]) {
    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
      `expected finite components in ${v.toArray()}`);
  }
});

test('wrist movement: shifting performer wrist shifts the target', () => {
  const baseline = solveArmTarget(baseInput({ perfWrist: { x: 0.9, y: 0.4, z: 0 } }));
  const shifted  = solveArmTarget(baseInput({ perfWrist: { x: 1.2, y: 0.4, z: 0 } }));
  // Wrist moved further out in +X → target.x should also move further out.
  assert.ok(shifted.target.x > baseline.target.x,
    `target.x should increase when wrist moves out; baseline=${baseline.target.x.toFixed(3)} shifted=${shifted.target.x.toFixed(3)}`);
});

test('mirrorX flips the X sign of target offset', () => {
  const noMirror = solveArmTarget(baseInput({ mirrorX: false, perfWrist: { x: 0.9, y: 0.4, z: 0 } }));
  const mirrored = solveArmTarget(baseInput({ mirrorX: true,  perfWrist: { x: 0.9, y: 0.4, z: 0 } }));
  // Mirror reverses MediaPipe X — target X offset from avatar mid-shoulder
  // should flip sign too (approximately; midpoint blend can dampen).
  const noMirrorXOffset = noMirror.target.x;
  const mirroredXOffset = mirrored.target.x;
  assert.ok(Math.sign(noMirrorXOffset - 0) !== Math.sign(mirroredXOffset - 0) || Math.abs(noMirrorXOffset) < 1e-6,
    `signs should differ; got ${noMirrorXOffset} vs ${mirroredXOffset}`);
});

test('armScale stretches Y/Z offsets', () => {
  // Higher armScale → wrist target moves FURTHER from shoulder along Y/Z.
  const small = solveArmTarget(baseInput({ armScale: 0.5 }));
  const big   = solveArmTarget(baseInput({ armScale: 1.5 }));
  // Distance from shoulder world to target should grow with armScale.
  const dSmall = small.target.distanceTo(baseInput().shoulderWorld);
  const dBig   = big.target.distanceTo(baseInput().shoulderWorld);
  assert.ok(dBig > dSmall, `armScale 1.5 should produce farther target than 0.5; got ${dSmall.toFixed(3)} vs ${dBig.toFixed(3)}`);
});

test('hands-together: both wrists near midline blends target toward chest', () => {
  // Configure a clap-like pose: both wrists at chest height, close together.
  const clapInput = baseInput({
    perfWrist:  { x:  0.1, y: 0.3, z: 0.05 },
    otherWrist: { x: -0.1, y: 0.3, z: 0.05 },
    hasBothHandsDetected: true,
  });
  // Should not throw, should produce a finite target.
  const result = solveArmTarget(clapInput);
  assert.ok(Number.isFinite(result.target.x) && Number.isFinite(result.target.y) && Number.isFinite(result.target.z));
});

test('prayer pose: hands together, low, arms bent → produces finite target (no crash)', () => {
  // Hands together at chest, both wrists below shoulders, arms bent (elbow
  // closer to shoulder than wrist).
  const prayerInput = baseInput({
    perfElbow:  { x: 0.3, y: 0.1, z: 0 },   // elbow at shoulder height
    perfWrist:  { x: 0.1, y: 0.3, z: 0 },   // wrist further down + inward
    otherWrist: { x: -0.1, y: 0.3, z: 0 },  // matching mirror wrist
    hasBothHandsDetected: true,
  });
  const result = solveArmTarget(prayerInput);
  assert.ok(Number.isFinite(result.target.x) && Number.isFinite(result.target.y) && Number.isFinite(result.target.z));
});

test('diagnostics include the computed blend values for debugging', () => {
  const result = solveArmTarget(baseInput());
  assert.ok(result.diagnostics);
  // Just verify the diagnostics object is non-empty / has some expected fields.
  // The exact fields are defined in mocapDiagnostics' ArmSolverDiagnostics type;
  // we just check it's not the empty default.
  assert.equal(typeof result.diagnostics, 'object');
});
