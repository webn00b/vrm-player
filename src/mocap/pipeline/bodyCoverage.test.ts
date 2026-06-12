/**
 * Tests for fullBodyCoverage — the gate that keeps the trusted-geometry
 * retarget away from half-body footage with hallucinated legs.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fullBodyCoverage, FULL_BODY_COVERAGE_MIN } from './bodyCoverage';
import type { Landmark3D, PoseFrame } from './poseDetector';

function frameWith(vis: { hips: number; ankles: number }): PoseFrame {
  const lms: Landmark3D[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  lms[23] = { x: 0.45, y: 0.6, z: 0, visibility: vis.hips };
  lms[24] = { x: 0.55, y: 0.6, z: 0, visibility: vis.hips };
  lms[27] = { x: 0.45, y: 0.95, z: 0, visibility: vis.ankles };
  lms[28] = { x: 0.55, y: 0.95, z: 0, visibility: vis.ankles };
  return { landmarks: lms, worldLandmarks: lms, faceLandmarks: [], hands: [] };
}

test('full-body sequence → coverage 1', () => {
  const frames = Array.from({ length: 20 }, () => frameWith({ hips: 0.9, ankles: 0.9 }));
  assert.equal(fullBodyCoverage(frames), 1);
});

test('half-body (low ankle visibility) → coverage 0, below the gate', () => {
  const frames = Array.from({ length: 20 }, () => frameWith({ hips: 0.9, ankles: 0.3 }));
  const c = fullBodyCoverage(frames);
  assert.equal(c, 0);
  assert.ok(c < FULL_BODY_COVERAGE_MIN);
});

test('mixed sequence → fraction of covered DETECTED frames; nulls ignored', () => {
  const frames: (PoseFrame | null)[] = [
    null,
    frameWith({ hips: 0.9, ankles: 0.9 }),
    frameWith({ hips: 0.9, ankles: 0.9 }),
    frameWith({ hips: 0.9, ankles: 0.2 }),
    frameWith({ hips: 0.9, ankles: 0.9 }),
  ];
  assert.ok(Math.abs(fullBodyCoverage(frames) - 0.75) < 1e-9);
});

test('empty / all-null → 0', () => {
  assert.equal(fullBodyCoverage([]), 0);
  assert.equal(fullBodyCoverage([null, null]), 0);
});
