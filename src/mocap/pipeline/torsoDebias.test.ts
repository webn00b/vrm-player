/**
 * Tests for torsoDebias — per-sequence median torso-lean removal.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { medianTorsoLean, debiasTorsoLean, medianLegLean, debiasLegLean } from './torsoDebias';
import type { Landmark3D, PoseFrame } from './poseDetector';

// Build a frame with a given torso lean (rad) in the y-z plane. MediaPipe
// world: y down, z forward. midHip at origin, shoulders one unit "up".
function frameWithLean(leanRad: number): PoseFrame {
  const w: Landmark3D[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  // Hips at y=0.
  w[23] = { x: -0.1, y: 0, z: 0, visibility: 1 };
  w[24] = { x: 0.1, y: 0, z: 0, visibility: 1 };
  // Shoulders: up = -y, forward = z. lean = atan2(z, -y).
  const up = 0.5;
  const sy = -up * Math.cos(leanRad);
  const sz = up * Math.sin(leanRad);
  w[11] = { x: -0.1, y: sy, z: sz, visibility: 1 };
  w[12] = { x: 0.1, y: sy, z: sz, visibility: 1 };
  // A wrist out to the side at shoulder height (rides along on rotation).
  w[16] = { x: 0.4, y: sy, z: sz, visibility: 1 };
  return { landmarks: w, worldLandmarks: w, faceLandmarks: [], hands: [] };
}

const D = (deg: number) => (deg * Math.PI) / 180;
const leanOf = (f: PoseFrame): number => {
  const w = f.worldLandmarks;
  const sy = (w[11].y + w[12].y) / 2, sz = (w[11].z + w[12].z) / 2;
  const hy = (w[23].y + w[24].y) / 2, hz = (w[23].z + w[24].z) / 2;
  return Math.atan2(sz - hz, -(sy - hy));
};

test('medianTorsoLean: returns the median over frames', () => {
  const frames = [frameWithLean(D(10)), frameWithLean(D(12)), frameWithLean(D(14))];
  assert.ok(Math.abs(medianTorsoLean(frames)! - D(12)) < 1e-9);
});

test('debias: a constant biased-but-straight sequence becomes vertical', () => {
  // Person "straight" but a constant -12 deg depth bias on every frame.
  const frames = Array.from({ length: 20 }, () => frameWithLean(D(-12)));
  const applied = debiasTorsoLean(frames);
  assert.ok(Math.abs(applied - D(-12)) < 1e-9, `applied bias ${applied}`);
  for (const f of frames) {
    assert.ok(Math.abs(leanOf(f)) < 1e-6, `frame lean after debias: ${leanOf(f)}`);
  }
});

test('debias: real per-frame lean is preserved relative to the median', () => {
  // Median lean -12 deg (bias); one frame genuinely bows 18 deg further fwd.
  const frames = [
    ...Array.from({ length: 10 }, () => frameWithLean(D(-12))),
    frameWithLean(D(6)), // 18 deg forward of the -12 median
  ];
  debiasTorsoLean(frames);
  // The bowing frame should end ~+18 deg forward of vertical.
  assert.ok(Math.abs(leanOf(frames[10]) - D(18)) < 1e-6,
    `bow frame lean after debias: ${(leanOf(frames[10]) * 180 / Math.PI).toFixed(1)} deg`);
  // The neutral frames sit at ~0.
  assert.ok(Math.abs(leanOf(frames[0])) < 1e-6);
});

test('debias: skips when median lean is negligible', () => {
  const frames = Array.from({ length: 10 }, () => frameWithLean(D(1)));
  assert.equal(debiasTorsoLean(frames), 0, 'sub-3deg bias is left alone');
  assert.ok(Math.abs(leanOf(frames[0]) - D(1)) < 1e-9, 'frames untouched');
});

test('debias: a side wrist rides along with the torso rotation', () => {
  const frames = Array.from({ length: 10 }, () => frameWithLean(D(-15)));
  debiasTorsoLean(frames);
  // Wrist shared shoulder height; after debias its z should match shoulder z.
  const w = frames[0].worldLandmarks;
  assert.ok(Math.abs(w[16].z - w[12].z) < 1e-6, 'wrist stays rigid with shoulders');
});

test('debias: null frames tolerated', () => {
  const frames = [null, frameWithLean(D(-10)), null, frameWithLean(D(-10))];
  const applied = debiasTorsoLean(frames);
  assert.ok(Math.abs(applied - D(-10)) < 1e-9);
});

// ── leg de-bias ──────────────────────────────────────────────────────────────

// Build a frame with a given leg lean (rad). MediaPipe world: y down (so the
// ankle is at +y below the hip), z forward. lean = atan2(dz, dy).
function frameWithLegLean(leanRad: number): PoseFrame {
  const w: Landmark3D[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  w[23] = { x: -0.1, y: 0, z: 0, visibility: 1 }; // hips at y=0
  w[24] = { x: 0.1, y: 0, z: 0, visibility: 1 };
  const len = 1.0; // hip→ankle
  const ay = len * Math.cos(leanRad); // down
  const az = len * Math.sin(leanRad); // forward
  w[27] = { x: -0.1, y: ay, z: az, visibility: 1 };       // left ankle
  w[28] = { x: 0.1, y: ay, z: az, visibility: 1 };        // right ankle
  w[25] = { x: -0.1, y: ay / 2, z: az / 2, visibility: 1 }; // left knee (mid-chain)
  w[26] = { x: 0.1, y: ay / 2, z: az / 2, visibility: 1 };  // right knee
  return { landmarks: w, worldLandmarks: w, faceLandmarks: [], hands: [] };
}

const legLeanOf = (f: PoseFrame): number => {
  const w = f.worldLandmarks;
  const ay = (w[27].y + w[28].y) / 2, az = (w[27].z + w[28].z) / 2;
  const hy = (w[23].y + w[24].y) / 2, hz = (w[23].z + w[24].z) / 2;
  return Math.atan2(az - hz, ay - hy);
};

test('medianLegLean: returns the median over frames', () => {
  const frames = [frameWithLegLean(D(-8)), frameWithLegLean(D(-10)), frameWithLegLean(D(-12))];
  assert.ok(Math.abs(medianLegLean(frames)! - D(-10)) < 1e-9);
});

test('leg debias: a constant backward-biased stance becomes vertical', () => {
  // Legs sit a constant -15 deg behind the hips every frame (lifter bias).
  const frames = Array.from({ length: 20 }, () => frameWithLegLean(D(-15)));
  const applied = debiasLegLean(frames);
  assert.ok(Math.abs(applied - D(-15)) < 1e-9, `applied ${applied}`);
  for (const f of frames) {
    assert.ok(Math.abs(legLeanOf(f)) < 1e-6, `leg lean after debias: ${legLeanOf(f)}`);
  }
});

test('leg debias: a genuine step is preserved relative to the median', () => {
  // Median -15 deg bias; one frame the foot genuinely swings 20 deg forward.
  const frames = [
    ...Array.from({ length: 10 }, () => frameWithLegLean(D(-15))),
    frameWithLegLean(D(5)), // 20 deg forward of the -15 median
  ];
  debiasLegLean(frames);
  assert.ok(Math.abs(legLeanOf(frames[10]) - D(20)) < 1e-6,
    `step frame after debias: ${(legLeanOf(frames[10]) * 180 / Math.PI).toFixed(1)} deg`);
});

test('leg debias: knee rides rigidly with the ankle (bend preserved)', () => {
  const frames = [frameWithLegLean(D(-15))];
  debiasLegLean(frames);
  const w = frames[0].worldLandmarks;
  // Knee stays at the chain midpoint after the rigid rotation.
  assert.ok(Math.abs(w[25].y - w[27].y / 2) < 1e-6 && Math.abs(w[25].z - w[27].z / 2) < 1e-6,
    'knee stays mid-chain');
});

test('leg debias: null frames tolerated', () => {
  const frames = [null, frameWithLegLean(D(-10)), null, frameWithLegLean(D(-10))];
  assert.ok(Math.abs(debiasLegLean(frames) - D(-10)) < 1e-9);
});
