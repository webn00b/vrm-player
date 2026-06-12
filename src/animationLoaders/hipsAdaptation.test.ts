import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  computeHipsAdaptation,
  scaleTrackValuesInPlace,
  adaptSkeletonToHipsHeightInPlace,
  MIN_HIPS_REST,
} from './hipsAdaptation';

// ── computeHipsAdaptation ──────────────────────────────────────────────────

test('tall source → short avatar: scale < 1, applied', () => {
  const a = computeHipsAdaptation(0.95, 0.86);
  assert.ok(a.applied);
  assert.ok(Math.abs(a.scale - 0.86 / 0.95) < 1e-12);
});

test('short source → tall avatar: scale > 1, applied', () => {
  const a = computeHipsAdaptation(0.6, 0.9);
  assert.ok(a.applied);
  assert.ok(Math.abs(a.scale - 1.5) < 1e-12);
});

test('centimeter-based source (Mixamo FBX): tiny scale still applied', () => {
  const a = computeHipsAdaptation(96, 0.86);
  assert.ok(a.applied, 'cm→m unit conversion is a legitimate adaptation');
  assert.ok(Math.abs(a.scale - 0.86 / 96) < 1e-12);
});

test('identical heights: not applied, scale exactly 1 (bit-exact round-trip)', () => {
  const a = computeHipsAdaptation(0.86, 0.86);
  assert.equal(a.applied, false);
  assert.equal(a.scale, 1);
});

test('grounded source (hips ≈ 0): invalid', () => {
  const a = computeHipsAdaptation(0.0, 0.86);
  assert.equal(a.applied, false);
  assert.equal(a.scale, 1);
});

test('source exactly at MIN_HIPS_REST: invalid (boundary excluded)', () => {
  const a = computeHipsAdaptation(MIN_HIPS_REST, 0.86);
  assert.equal(a.applied, false);
});

test('degenerate avatar: invalid', () => {
  const a = computeHipsAdaptation(0.95, 0);
  assert.equal(a.applied, false);
});

test('non-finite inputs: invalid', () => {
  assert.equal(computeHipsAdaptation(NaN, 0.86).applied, false);
  assert.equal(computeHipsAdaptation(0.95, Infinity).applied, false);
});

test('absurd ratio (broken measurement): invalid', () => {
  const a = computeHipsAdaptation(1e7, 0.86);
  assert.equal(a.applied, false);
});

// ── scaleTrackValuesInPlace ────────────────────────────────────────────────

test('scaleTrackValuesInPlace scales every component', () => {
  const v = new Float32Array([1, 2, 3, -4, 0, 8]);
  scaleTrackValuesInPlace(v, 0.5);
  assert.deepEqual(Array.from(v), [0.5, 1, 1.5, -2, 0, 4]);
});

// ── adaptSkeletonToHipsHeightInPlace (BVH converter core) ─────────────────

/** Skeleton: hips(root) at y=2 with a leg child hanging 1 m down. */
function makeSkeleton(hipsY: number) {
  const hips = new THREE.Bone();
  hips.position.set(0, hipsY, 0);
  const leg = new THREE.Bone();
  leg.position.set(0.1, -1, 0);
  hips.add(leg);
  hips.updateWorldMatrix(false, true);
  return { hips, leg };
}

const _scratch = new THREE.Vector3();

test('tall source skeleton: offsets and translation deltas scaled uniformly, hips pinned exactly', () => {
  const { hips, leg } = makeSkeleton(2);
  const track = { values: new Float32Array([0.2, 0.4, -0.6]) };
  const a = adaptSkeletonToHipsHeightInPlace(hips, hips, [track, null], 1.0, _scratch);

  assert.ok(a.applied);
  assert.ok(Math.abs(a.scale - 0.5) < 1e-12);
  assert.ok(Math.abs(leg.position.y - -0.5) < 1e-9, 'child bone offset halved');
  assert.ok(Math.abs(leg.position.x - 0.05) < 1e-9, 'horizontal offsets halved too');
  assert.ok(Math.abs(track.values[0] - 0.1) < 1e-6, 'keyframe deltas halved');
  assert.equal(hips.getWorldPosition(new THREE.Vector3()).y, 1.0,
    'hips world Y pinned bit-exactly to the avatar bind height');
});

test('self-recorded source (heights already match): bit-exact no-op', () => {
  const { hips, leg } = makeSkeleton(1.0);
  const track = { values: new Float32Array([0.25, -0.125, 0.5]) };
  const a = adaptSkeletonToHipsHeightInPlace(hips, hips, [track], 1.0, _scratch);

  assert.equal(a.applied, false);
  assert.equal(hips.position.y, 1.0, 'root untouched');
  assert.equal(leg.position.y, -1, 'child untouched');
  assert.deepEqual(Array.from(track.values), [0.25, -0.125, 0.5], 'keyframes untouched');
});

test('degenerate grounded source: no scaling, but hips still pinned to avatar height', () => {
  const { hips } = makeSkeleton(0);
  const track = { values: new Float32Array([0.3, 0.3, 0.3]) };
  const a = adaptSkeletonToHipsHeightInPlace(hips, hips, [track], 0.86, _scratch);

  assert.equal(a.applied, false);
  assert.deepEqual(Array.from(track.values).map((x) => Math.round(x * 100) / 100),
    [0.3, 0.3, 0.3], 'keyframes untouched');
  assert.ok(Math.abs(hips.getWorldPosition(new THREE.Vector3()).y - 0.86) < 1e-9,
    'legacy behavior: rest pinned to avatar bind height');
});
