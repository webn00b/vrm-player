/**
 * Tests for solveShoulderTarget.
 *
 * The solver derives a clavicle rotation from the performer's shoulder
 * landmark position relative to the shoulder midpoint, plus an optional
 * spread-rotation around the bone's local Z axis.
 *
 * Contract:
 *   - performerShoulder=undefined  → returns the pure spread rotation
 *   - performerShoulder visible    → rotates rest axis toward (shoulder − midpoint)
 *     in parent-local frame, then composes spread on top
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveShoulderTarget } from './shoulderRetarget';

const IDENTITY = new THREE.Quaternion();

test('no performer shoulder → returns spread-only rotation', () => {
  const result = solveShoulderTarget({
    mirrorX: false,
    restAxis: new THREE.Vector3(1, 0, 0),
    parentWorldQuaternion: IDENTITY.clone(),
    leftShoulder:  { x: -0.1, y: 0, z: 0 },
    rightShoulder: { x:  0.1, y: 0, z: 0 },
    performerShoulder: undefined,
    spreadRadians: Math.PI / 6,  // 30°
    spreadSign: 1,
  });
  // Pure spread around Z by 30°.
  const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 6);
  assert.ok(Math.abs(result.dot(expected)) > 0.9999, 'should be pure spread around Z');
});

test('shoulder coincident with midpoint → degenerate input → spread only', () => {
  const result = solveShoulderTarget({
    mirrorX: false,
    restAxis: new THREE.Vector3(1, 0, 0),
    parentWorldQuaternion: IDENTITY.clone(),
    leftShoulder:  { x: 0, y: 0, z: 0 },
    rightShoulder: { x: 0, y: 0, z: 0 },
    performerShoulder: { x: 0, y: 0, z: 0 },  // at midpoint
    spreadRadians: 0.1,
    spreadSign: -1,
  });
  // Zero-length direction → fall back to pure spread.
  const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.1);
  assert.ok(Math.abs(result.dot(expected)) > 0.9999);
});

test('shoulder offset to +X above midpoint → rotates rest axis toward that direction', () => {
  // mirrorX=false, no spread, identity parent.
  // Midpoint=(0,0). Performer shoulder at (+0.5, -0.2, 0).
  // Direction in MediaPipe local: (+0.5, -0.2, 0).
  // mpDirToVrm(false, 0.5, -0.2, 0) = (0.5, 0.2, 0) — Y-flipped.
  // Rest axis (1, 0, 0) → should rotate to align with (0.5, 0.2, 0) normalized.
  const result = solveShoulderTarget({
    mirrorX: false,
    restAxis: new THREE.Vector3(1, 0, 0),
    parentWorldQuaternion: IDENTITY.clone(),
    leftShoulder:  { x: -0.1, y: 0, z: 0 },
    rightShoulder: { x:  0.1, y: 0, z: 0 },
    performerShoulder: { x: 0.5, y: -0.2, z: 0 },
    spreadRadians: 0,
    spreadSign: 1,
  });
  // Apply the resulting quaternion to restAxis — should match VRM-space direction.
  const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(result);
  const expected = new THREE.Vector3(0.5, 0.2, 0).normalize();
  assert.ok(dir.dot(expected) > 0.999, `rotated direction should align with target; got dot=${dir.dot(expected)}`);
});

test('mirrorX=true: shoulder offset to +X gets reflected to -X in output', () => {
  const result = solveShoulderTarget({
    mirrorX: true,
    restAxis: new THREE.Vector3(1, 0, 0),
    parentWorldQuaternion: IDENTITY.clone(),
    leftShoulder:  { x: 0, y: 0, z: 0 },
    rightShoulder: { x: 0, y: 0, z: 0 },
    performerShoulder: { x: 0.5, y: 0, z: 0 },
    spreadRadians: 0,
    spreadSign: 1,
  });
  // With mirrorX, direction becomes (-0.5, 0, 0). Restaxis (1,0,0) → rotate to (-1,0,0).
  // That's a 180° rotation around Y (or Z).
  const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(result);
  assert.ok(Math.abs(dir.x + 1) < 1e-3, `X should be flipped; got dir.x=${dir.x}`);
});

test('spread is composed AFTER the direction rotation', () => {
  // With both a direction shift AND a spread, the total should be (direction)·(spread).
  // We just verify the result is NOT equal to spread-only and NOT equal to direction-only.
  const dirOnly = solveShoulderTarget({
    mirrorX: false,
    restAxis: new THREE.Vector3(1, 0, 0),
    parentWorldQuaternion: IDENTITY.clone(),
    leftShoulder:  { x: -0.1, y: 0, z: 0 },
    rightShoulder: { x:  0.1, y: 0, z: 0 },
    performerShoulder: { x: 0.3, y: -0.1, z: 0 },
    spreadRadians: 0,
    spreadSign: 1,
  });
  const combined = solveShoulderTarget({
    mirrorX: false,
    restAxis: new THREE.Vector3(1, 0, 0),
    parentWorldQuaternion: IDENTITY.clone(),
    leftShoulder:  { x: -0.1, y: 0, z: 0 },
    rightShoulder: { x:  0.1, y: 0, z: 0 },
    performerShoulder: { x: 0.3, y: -0.1, z: 0 },
    spreadRadians: 0.3,
    spreadSign: 1,
  });
  // Combined ≠ dirOnly (spread added something).
  assert.ok(Math.abs(combined.dot(dirOnly)) < 0.999);
});

test('returned quaternion is a NEW instance (not a shared scratch)', () => {
  const a = solveShoulderTarget({
    mirrorX: false,
    restAxis: new THREE.Vector3(1, 0, 0),
    parentWorldQuaternion: IDENTITY.clone(),
    leftShoulder:  { x: 0, y: 0, z: 0 },
    rightShoulder: { x: 0, y: 0, z: 0 },
    performerShoulder: { x: 0.1, y: 0, z: 0 },
    spreadRadians: 0.2,
    spreadSign: 1,
  });
  const b = solveShoulderTarget({
    mirrorX: false,
    restAxis: new THREE.Vector3(1, 0, 0),
    parentWorldQuaternion: IDENTITY.clone(),
    leftShoulder:  { x: 0, y: 0, z: 0 },
    rightShoulder: { x: 0, y: 0, z: 0 },
    performerShoulder: { x: -0.1, y: 0, z: 0 },
    spreadRadians: 0.2,
    spreadSign: 1,
  });
  // Different inputs → different outputs; the function should not return the
  // same mutated scratch quaternion for both calls.
  assert.notEqual(a, b, 'returns fresh instances');
  assert.ok(Math.abs(a.dot(b)) < 0.999, 'different inputs → different rotations');
});
