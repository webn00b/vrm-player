/**
 * Unit tests for the two-bone IK solver (shoulder→elbow→hand or hip→knee→ankle).
 *
 * Verifies the four shapes the solver must handle:
 *   - reachable target → chain bends naturally with elbow on the pole side
 *   - unreachable target → fully extended toward target, reachable=false
 *   - degenerate target (collocated with root) → falls back to pole direction
 *   - pole-parallel-to-chain (singular) → graceful fallback
 *
 * Also pins the chain-length invariant: ‖upperDir·L1‖ + ‖lowerDir·L2‖ = L1+L2
 * when reachable, target lies on root + upperDir·L1 + lowerDir·L2.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveTwoBoneIK } from './twoBoneIK';

function near(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

test('reachable target: chain bends with elbow on pole side', () => {
  // Root at origin, target 0.5 along +X, both bones length 0.3.
  // Total reach = 0.6, target dist = 0.5 → reachable.
  // Pole +Y → elbow bulges upward.
  const root   = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(0.5, 0, 0);
  const pole   = new THREE.Vector3(0, 1, 0);

  const result = solveTwoBoneIK(root, target, pole, 0.3, 0.3);

  assert.equal(result.reachable, true);
  // Reconstruct target from the IK output and verify it matches.
  const elbow = root.clone().addScaledVector(result.upperDir, 0.3);
  const tip   = elbow.clone().addScaledVector(result.lowerDir, 0.3);
  assert.ok(near(tip.distanceTo(target), 0, 1e-3),
    `tip should land on target; got dist ${tip.distanceTo(target).toFixed(6)}`);
  // Elbow has positive Y (above the chord) because pole pointed +Y.
  assert.ok(elbow.y > 0, `elbow should bulge toward pole; got y=${elbow.y}`);
});

test('unreachable target: chain extends fully toward target, reachable=false', () => {
  // Total reach = 0.4, target dist = 1.0 → unreachable.
  const root   = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(1, 0, 0);
  const pole   = new THREE.Vector3(0, 1, 0);

  const result = solveTwoBoneIK(root, target, pole, 0.2, 0.2);

  assert.equal(result.reachable, false);
  // Both bones point straight at target — upperDir == lowerDir.
  assert.ok(near(result.upperDir.x, 1) && near(result.upperDir.y, 0) && near(result.upperDir.z, 0));
  assert.ok(near(result.lowerDir.x, 1) && near(result.lowerDir.y, 0) && near(result.lowerDir.z, 0));
});

test('reachable at exact-max: marked unreachable, fully extended', () => {
  // Distance exactly equals L1 + L2 — solver treats as unreachable per the
  // implementation's `abLen >= maxReach - 1e-6` guard.
  const root   = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(0.6, 0, 0);
  const pole   = new THREE.Vector3(0, 1, 0);

  const result = solveTwoBoneIK(root, target, pole, 0.3, 0.3);
  assert.equal(result.reachable, false);
});

test('degenerate target (collocated with root): falls back to pole direction', () => {
  const root   = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(0, 0, 0);  // exactly at root
  const pole   = new THREE.Vector3(0, -1, 0);  // hang elbow downward

  const result = solveTwoBoneIK(root, target, pole, 0.3, 0.3);

  assert.equal(result.reachable, true);
  // Upper bone direction follows pole (normalized).
  assert.ok(near(result.upperDir.y, -1), 'upperDir matches pole');
  // Elbow ends up at L1 along pole.
  assert.ok(near(result.elbowPos.y, -0.3));
});

test('pole parallel to chain axis: graceful fallback (no NaN)', () => {
  // Target along +X, pole also along +X → pole has no perpendicular component
  // relative to chain axis. Solver falls back to gravity (Y) then to forward.
  const root   = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(0.5, 0, 0);
  const pole   = new THREE.Vector3(1, 0, 0);  // parallel to chain

  const result = solveTwoBoneIK(root, target, pole, 0.3, 0.3);

  assert.equal(result.reachable, true);
  // No NaNs in result vectors.
  assert.ok(Number.isFinite(result.upperDir.x) && Number.isFinite(result.upperDir.y) && Number.isFinite(result.upperDir.z));
  assert.ok(Number.isFinite(result.elbowPos.x) && Number.isFinite(result.elbowPos.y) && Number.isFinite(result.elbowPos.z));

  // Elbow should still reach target eventually through the lower bone.
  const tip = result.elbowPos.clone().addScaledVector(result.lowerDir, 0.3);
  assert.ok(near(tip.distanceTo(target), 0, 1e-3));
});

test('asymmetric bone lengths: solution still satisfies chain constraint', () => {
  // Upper much longer than lower — common for real arms (upper > forearm).
  const root   = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(0.3, 0.1, 0);
  const pole   = new THREE.Vector3(0, 0, 1);

  const result = solveTwoBoneIK(root, target, pole, 0.4, 0.2);

  assert.equal(result.reachable, true);
  const elbow = root.clone().addScaledVector(result.upperDir, 0.4);
  const tip   = elbow.clone().addScaledVector(result.lowerDir, 0.2);
  assert.ok(near(tip.distanceTo(target), 0, 1e-3));
  // Upper bone is at the law-of-cosines angle.
  // Length from root to elbow = 0.4 (the upper bone length).
  assert.ok(near(elbow.distanceTo(root), 0.4, 1e-4));
});

test('reusable result object: passing `out` does not allocate', () => {
  const root   = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(0.5, 0, 0);
  const pole   = new THREE.Vector3(0, 1, 0);

  const out = {
    upperDir: new THREE.Vector3(),
    elbowPos: new THREE.Vector3(),
    lowerDir: new THREE.Vector3(),
    reachable: true,
  };
  const upperRef = out.upperDir;
  const elbowRef = out.elbowPos;
  const lowerRef = out.lowerDir;

  const result = solveTwoBoneIK(root, target, pole, 0.3, 0.3, out);

  // Same instances written-into, not replaced.
  assert.equal(result, out);
  assert.equal(result.upperDir, upperRef);
  assert.equal(result.elbowPos, elbowRef);
  assert.equal(result.lowerDir, lowerRef);
});
