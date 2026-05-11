/**
 * Tests for torsoMath: cross-axis stabilization, forward-lean computation,
 * and lateral-lean gain math.
 *
 * Cross-axis: hip-line versus shoulder-line. When the performer lifts a leg,
 * the hip line gets dragged off-axis; we clamp how much the pelvis basis is
 * allowed to diverge from the shoulder line.
 *
 * Forward lean: torso midpoint angle in hip-local frame, with a session
 * baseline subtraction so resting forward-lean doesn't accumulate.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  stabilizeTorsoCrossAxis,
  computeTorsoLean,
  computeAppliedLateralLean,
} from './torsoMath';

test('stabilizeTorsoCrossAxis: within tolerance → hip axis unchanged', () => {
  const hip      = new THREE.Vector3(1, 0, 0);          // along X
  const shoulder = new THREE.Vector3(1, 0, 0.1).normalize();  // slight tilt
  const out = new THREE.Vector3();
  stabilizeTorsoCrossAxis(hip, shoulder, 20, out);
  // Angle between them is small (<20°) → out = hip unmodified.
  assert.ok(Math.abs(out.x - 1) < 1e-6 && Math.abs(out.y) < 1e-6, 'hip preserved');
});

test('stabilizeTorsoCrossAxis: beyond tolerance → blends toward shoulder axis', () => {
  const hip      = new THREE.Vector3(1, 0, 0);
  const shoulder = new THREE.Vector3(0, 0, 1);  // 90° divergence
  const out = new THREE.Vector3();
  stabilizeTorsoCrossAxis(hip, shoulder, 20, out);
  // Output should have rotated significantly toward shoulder axis.
  // At 90° divergence and 25° blend ramp, blend factor maxes out at 1 → out ≈ shoulder.
  assert.ok(out.angleTo(shoulder) < THREE.MathUtils.degToRad(5),
    `should pull most of the way toward shoulder axis; angle=${out.angleTo(shoulder)}`);
});

test('stabilizeTorsoCrossAxis: handles opposite-sign shoulder axis (mirror)', () => {
  // Shoulder axis is the negated direction — code should flip sign before angle test.
  const hip      = new THREE.Vector3(1, 0, 0);
  const shoulder = new THREE.Vector3(-1, 0, 0);  // exact opposite
  const out = new THREE.Vector3();
  stabilizeTorsoCrossAxis(hip, shoulder, 20, out);
  // After sign-flip the axes align → no rotation required → out matches hip.
  assert.ok(Math.abs(out.x - 1) < 1e-6);
});

test('stabilizeTorsoCrossAxis: degenerate inputs (zero-length) → out = hip copy', () => {
  const hip = new THREE.Vector3(0, 0, 0);
  const shoulder = new THREE.Vector3(1, 0, 0);
  const out = new THREE.Vector3(7, 8, 9);  // garbage starting value
  stabilizeTorsoCrossAxis(hip, shoulder, 20, out);
  // out gets copied from zero-length hip, returns early — no NaN.
  assert.equal(out.x, 0); assert.equal(out.y, 0); assert.equal(out.z, 0);
});

test('computeTorsoLean: vertical torso → zero lean', () => {
  const torsoUp = new THREE.Vector3(0, 1, 0);  // straight up
  const result = computeTorsoLean(torsoUp, null);
  // forwardLeanRaw = atan2(0, 1) = 0; lateralLean = atan2(0, 1) = 0.
  assert.equal(result.forwardLean, 0);
  assert.equal(result.lateralLean, 0);
});

test('computeTorsoLean: zero-length midpoint → all zero, baseline preserved', () => {
  const result = computeTorsoLean(new THREE.Vector3(0, 0, 0), 0.5);
  assert.equal(result.forwardLeanRaw, 0);
  assert.equal(result.forwardLean, 0);
  assert.equal(result.lateralLean, 0);
  assert.equal(result.nextForwardBaseline, 0.5, 'baseline kept across no-data frame');
});

test('computeTorsoLean: forward lean baseline is captured on first call', () => {
  // Performer starts with a constant 30° forward tilt — the baseline absorbs it.
  const tilted = new THREE.Vector3(0, 1, Math.tan(THREE.MathUtils.degToRad(30)));
  const first = computeTorsoLean(tilted, null);
  assert.ok(Math.abs(first.forwardLeanRaw - THREE.MathUtils.degToRad(30)) < 0.01);
  assert.ok(first.nextForwardBaseline !== null);

  // Re-using the captured baseline on a same-tilt frame: net forward should be
  // close to 0 + the 25% absolute-retention term that keeps real leans visible.
  const second = computeTorsoLean(tilted, first.nextForwardBaseline);
  // Net = (raw - baseline) + raw*0.25 = 0 + 30° * 0.25 = 7.5°
  assert.ok(Math.abs(second.forwardLean - THREE.MathUtils.degToRad(7.5)) < 0.01,
    `expected ~7.5° retained; got ${THREE.MathUtils.radToDeg(second.forwardLean).toFixed(2)}°`);
});

test('computeTorsoLean: lateral lean uses X component', () => {
  // Tilt to the +X side, no forward.
  const sideways = new THREE.Vector3(Math.tan(THREE.MathUtils.degToRad(20)), 1, 0);
  const result = computeTorsoLean(sideways, null);
  assert.ok(Math.abs(result.lateralLean - THREE.MathUtils.degToRad(20)) < 0.01);
});

test('computeAppliedLateralLean: small lean → small gain, low application', () => {
  // baseScale=0.35, maxScale=0.7 — common app defaults.
  const small = computeAppliedLateralLean(THREE.MathUtils.degToRad(5), 0.35, 0.7);
  // 5° lean → applied < 5° (gain<1 for small leans).
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(small.applied)) < 5);
});

test('computeAppliedLateralLean: large lean clamps to ±28°', () => {
  const huge = computeAppliedLateralLean(THREE.MathUtils.degToRad(90), 0.35, 0.7);
  // Output should be clamped to ±28° (in radians).
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(huge.applied)) <= 28 + 1e-6);
});

test('computeAppliedLateralLean: sign is inverted from input (spine bends opposite to torso)', () => {
  const positive = computeAppliedLateralLean(THREE.MathUtils.degToRad(15), 0.35, 0.7);
  assert.ok(positive.applied < 0, 'positive input → negative output (sign-flip)');
});
