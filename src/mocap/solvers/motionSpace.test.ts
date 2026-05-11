/**
 * Unit tests for MediaPipe → VRM coordinate-space conversions.
 *
 * The conversions are tiny but used pervasively — getting their sign or
 * scale wrong would manifest as "the avatar moves the wrong direction"
 * across the entire pipeline. We pin the contract explicitly here.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mpDeltaToVrm, mpDirToVrm, mpDirToVrmTorso } from './motionSpace';

test('mpDeltaToVrm: identity (no-mirror) flips Y and Z, keeps X', () => {
  const out = new THREE.Vector3();
  mpDeltaToVrm(false, 1, 2, 3, out);
  // VRM: Y up, MediaPipe: Y down → −Y. Z forward in VRM equals camera-back
  // in MediaPipe → −Z. X is left-right in BOTH, mirrored only if requested.
  assert.deepEqual([out.x, out.y, out.z], [1, -2, -3]);
});

test('mpDeltaToVrm: mirrorX flips X', () => {
  const out = new THREE.Vector3();
  mpDeltaToVrm(true, 1, 2, 3, out);
  assert.deepEqual([out.x, out.y, out.z], [-1, -2, -3]);
});

test('mpDeltaToVrm: depthScale damps Z component only', () => {
  const out = new THREE.Vector3();
  mpDeltaToVrm(false, 1, 2, 3, out, 0.5);
  assert.deepEqual([out.x, out.y, out.z], [1, -2, -1.5]);
  mpDeltaToVrm(false, 1, 2, 3, out, 0);
  // Note: -3 * 0 = -0 in IEEE 754; treat ±0 as equal here.
  assert.equal(out.x, 1);
  assert.equal(out.y, -2);
  assert.equal(Math.abs(out.z), 0, '2D-only when depthScale=0');
});

test('mpDirToVrm: same as mpDeltaToVrm with depthScale=1, no scale param', () => {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  mpDirToVrm(false, 1, 2, 3, a);
  mpDeltaToVrm(false, 1, 2, 3, b, 1);
  assert.deepEqual([a.x, a.y, a.z], [b.x, b.y, b.z]);
});

test('mpDirToVrmTorso: divides Z by torsoDepthDamping (default 3)', () => {
  const out = new THREE.Vector3();
  mpDirToVrmTorso(false, 1, 2, 6, out);
  // Default damping = 3 → −6 / 3 = −2.
  assert.deepEqual([out.x, out.y, out.z], [1, -2, -2]);

  mpDirToVrmTorso(false, 1, 2, 6, out, 6);
  assert.deepEqual([out.x, out.y, out.z], [1, -2, -1], 'custom damping factor');
});

test('mpDeltaToVrm: out is written in place (no allocation, reusable)', () => {
  const out = new THREE.Vector3(99, 99, 99);
  mpDeltaToVrm(false, 1, 2, 3, out);
  assert.equal(out.x, 1, 'out mutated in place');
  // Same instance still:
  mpDeltaToVrm(true, 4, 5, 6, out);
  assert.deepEqual([out.x, out.y, out.z], [-4, -5, -6]);
});
