/**
 * Tests for OneEuroFilter (scalar), LandmarkFilter (per-axis batch), and
 * QuaternionOneEuro (slerp variant for rotation streams).
 *
 * The filter is speed-adaptive: heavy smoothing at rest, light during fast
 * motion. We verify that property by feeding a step-input (fast) and a
 * constant-noisy input (slow) and checking the response characteristics.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  OneEuroFilter,
  LandmarkFilter,
  QuaternionOneEuro,
} from './oneEuroFilter';

test('OneEuroFilter: first sample is returned as-is (no warmup lag)', () => {
  const f = new OneEuroFilter();
  const out = f.filter(42, 0);
  assert.equal(out, 42);
});

test('OneEuroFilter: at-rest noisy input is smoothed (output variance < input variance)', () => {
  const f = new OneEuroFilter(0.5, 0.001);  // very low cutoff = heavy smoothing
  let t = 0;
  const dt = 1 / 60;
  let prev = 100;
  let inSumSq = 0, outSumSq = 0;
  for (let i = 0; i < 200; i++) {
    t += dt;
    const noise = (Math.random() - 0.5) * 2;     // ±1
    const x = 100 + noise;
    const y = f.filter(x, t);
    inSumSq  += (x - 100) ** 2;
    outSumSq += (y - 100) ** 2;
    prev = y;
  }
  // Heavy smoothing should suppress at least 5× of the variance.
  assert.ok(outSumSq * 5 < inSumSq,
    `smoothed variance ${outSumSq.toFixed(3)} should be << raw ${inSumSq.toFixed(3)}`);
});

test('OneEuroFilter: tracks a step change (responsive during fast motion)', () => {
  // Step from 0 to 1 at t=0.5. With beta>0, the filter should reach near 1 within
  // a few frames (the adaptive cutoff opens up under fast motion).
  const f = new OneEuroFilter(1.5, 0.5);
  let t = 0;
  const dt = 1 / 60;
  let y = 0;
  for (let i = 0; i < 30; i++) {
    t += dt;
    const x = t < 0.25 ? 0 : 1;  // step at t = 0.25
    y = f.filter(x, t);
  }
  // After 30 frames (~0.5 s) the output should have converged within 10% of target.
  assert.ok(Math.abs(y - 1) < 0.1, `should track step; got ${y.toFixed(4)}`);
});

test('OneEuroFilter: reset() returns to cold-start behaviour', () => {
  const f = new OneEuroFilter();
  f.filter(50, 0);
  f.filter(50, 1 / 60);
  f.reset();
  // Next filter call after reset acts as the first sample again.
  assert.equal(f.filter(999, 0), 999);
});

test('LandmarkFilter: per-axis smoothing on landmark arrays', () => {
  const f = new LandmarkFilter(2, 0.5, 0.001);
  const lms = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 1, z: 1 },
  ];
  // Warm up.
  f.filter(lms, 0);
  // Step on lm[0].x: 0 → 5. Heavy smoothing should NOT reach 5 in one frame.
  const stepped = f.filter([{ x: 5, y: 0, z: 0 }, lms[1]], 1 / 60);
  assert.ok(stepped[0].x < 5, `heavily smoothed first frame should lag step`);
  assert.ok(stepped[0].x > 0, `but should at least move some toward step`);
  // lm[1] untouched (its filter stayed at 1).
  assert.equal(stepped[1].x, 1);
});

test('QuaternionOneEuro: first sample returns unchanged', () => {
  const f = new QuaternionOneEuro();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
  const out = new THREE.Quaternion();
  f.filter(q.clone(), 0, out);
  assert.ok(Math.abs(out.dot(q) - 1) < 1e-6, 'cold-start passthrough');
});

test('QuaternionOneEuro: smoothly interpolates toward target', () => {
  const f = new QuaternionOneEuro(0.5, 0.001);  // heavy smoothing
  const q0 = new THREE.Quaternion();             // identity
  const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.0);  // 1 rad Y
  const out = new THREE.Quaternion();

  let t = 0;
  const dt = 1 / 60;
  f.filter(q0.clone(), t, out);
  // Step input: every frame is q1. Output should approach q1 monotonically.
  const distances: number[] = [];
  for (let i = 0; i < 60; i++) {
    t += dt;
    f.filter(q1.clone(), t, out);
    distances.push(1 - Math.abs(out.dot(q1)));  // 0 = identical, larger = farther
  }
  // Each frame should bring us CLOSER (or at worst equal — float noise).
  for (let i = 1; i < distances.length; i++) {
    assert.ok(distances[i] <= distances[i - 1] + 1e-9,
      `slerp output should not move AWAY from target between frames`);
  }
  // After ~1 s the heavy filter still won't reach q1, but should be < 0.5 away.
  assert.ok(distances[distances.length - 1] < 0.5);
});

test('QuaternionOneEuro: handles hemisphere-flipped input (sign-continuity)', () => {
  const f = new QuaternionOneEuro();
  const q  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
  const qNeg = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w);  // same rotation, opposite hemisphere
  const out = new THREE.Quaternion();

  f.filter(q.clone(), 0, out);
  // Feed the hemisphere-flipped same rotation — the filter must NOT slerp the
  // long way around (which would be ~2π); should treat it as the same rotation.
  f.filter(qNeg.clone(), 1 / 60, out);
  // |dot(out, q)| should still be ~1 (they're the same rotation).
  assert.ok(Math.abs(out.dot(q)) > 0.99,
    `output should match the rotation; |dot|=${Math.abs(out.dot(q)).toFixed(6)}`);
});

test('QuaternionOneEuro: reset() returns to cold-start behaviour', () => {
  const f = new QuaternionOneEuro();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
  const out = new THREE.Quaternion();
  f.filter(q.clone(), 0, out);
  f.filter(q.clone(), 1 / 60, out);
  f.reset();
  const fresh = new THREE.Quaternion(0.1, 0.2, 0.3, 0.9).normalize();
  f.filter(fresh.clone(), 0, out);
  assert.ok(Math.abs(out.dot(fresh) - 1) < 1e-6, 'cold-start passthrough after reset');
});
