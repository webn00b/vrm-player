/**
 * Tests for personCropPlanner — crop planning + coordinate remap for the
 * detect-crop-redetect pass.
 *
 * Coverage:
 *   - bbox → padded square crop, clamped to frame
 *   - gap fill from neighbours
 *   - smoothing kills single-frame bbox jitter
 *   - remap: crop-space → full-frame normalized coords, z scaling, world untouched
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { planPersonCrops, remapCroppedPoseFrame } from './personCropPlanner';
import type { Landmark3D, PoseFrame } from './poseDetector';

const W = 1920, H = 1080;

function frameAt(cx: number, cy: number, halfW = 0.05, halfH = 0.15): PoseFrame {
  const lms: Landmark3D[] = Array.from({ length: 33 }, () => ({ x: cx, y: cy, z: 0, visibility: 1 }));
  lms[11] = { x: cx - halfW, y: cy - halfH, z: 0, visibility: 1 }; // left shoulder
  lms[12] = { x: cx + halfW, y: cy - halfH, z: 0, visibility: 1 };
  lms[27] = { x: cx - halfW, y: cy + halfH, z: 0, visibility: 1 }; // ankles
  lms[28] = { x: cx + halfW, y: cy + halfH, z: 0, visibility: 1 };
  return { landmarks: lms, worldLandmarks: lms.map((l) => ({ ...l })), faceLandmarks: [], hands: [] };
}

test('planPersonCrops: square crop covers the padded person bbox', () => {
  const frames = Array.from({ length: 30 }, () => frameAt(0.5, 0.5));
  const crops = planPersonCrops(frames, W, H)!;
  assert.ok(crops, 'plan must succeed');
  const c = crops[15];
  // Person bbox: 0.1·W x 0.3·H = 192×324 px → side = 324·1.7 ≈ 551
  assert.ok(Math.abs(c.size - 324 * 1.7) < 2, `padded size; got ${c.size}`);
  // Crop centred on the person
  assert.ok(Math.abs(c.sx + c.size / 2 - 0.5 * W) < 2, `centre x; got ${c.sx + c.size / 2}`);
  assert.ok(Math.abs(c.sy + c.size / 2 - 0.5 * H) < 2, `centre y; got ${c.sy + c.size / 2}`);
});

test('planPersonCrops: crop clamps to frame bounds', () => {
  // Person at the left edge.
  const frames = Array.from({ length: 20 }, () => frameAt(0.02, 0.5));
  const crops = planPersonCrops(frames, W, H)!;
  for (const c of crops) {
    assert.ok(c.sx >= 0 && c.sy >= 0, 'origin inside frame');
    assert.ok(c.sx + c.size <= W + 1e-6 && c.sy + c.size <= H + 1e-6, 'crop inside frame');
  }
});

test('planPersonCrops: missing frames borrow neighbouring crops', () => {
  const frames: (PoseFrame | null)[] = Array.from({ length: 30 }, () => frameAt(0.5, 0.5));
  frames[10] = null;
  frames[11] = null;
  const crops = planPersonCrops(frames, W, H)!;
  assert.ok(crops[10] && crops[11], 'gap frames get crops');
  assert.ok(Math.abs(crops[10].sx - crops[9].sx) < 5, 'borrowed from neighbours');
});

test('planPersonCrops: null when no frame has a pose', () => {
  assert.equal(planPersonCrops([null, null, null], W, H), null);
});

test('planPersonCrops: smoothing suppresses single-frame bbox jitter', () => {
  const frames = Array.from({ length: 40 }, () => frameAt(0.5, 0.5));
  frames[20] = frameAt(0.6, 0.5); // one-frame jump of 0.1·W = 192 px
  const crops = planPersonCrops(frames, W, H)!;
  const jump = Math.abs(crops[20].sx - crops[19].sx);
  assert.ok(jump < 30, `crop jump must be smoothed; got ${jump}px`);
});

test('remapCroppedPoseFrame: maps crop-space back to full-frame coords', () => {
  const frame = frameAt(0.5, 0.5);
  frame.landmarks[15] = { x: 0.25, y: 0.75, z: 0.1, visibility: 1 };
  const worldBefore = { ...frame.worldLandmarks[15] };
  const crop = { sx: 960, sy: 270, size: 540 };
  remapCroppedPoseFrame(frame, crop, W, H);
  const lm = frame.landmarks[15];
  assert.ok(Math.abs(lm.x - (960 + 0.25 * 540) / W) < 1e-9, `x; got ${lm.x}`);
  assert.ok(Math.abs(lm.y - (270 + 0.75 * 540) / H) < 1e-9, `y; got ${lm.y}`);
  assert.ok(Math.abs(lm.z - 0.1 * (540 / W)) < 1e-9, `z scaled by crop ratio; got ${lm.z}`);
  assert.deepEqual(frame.worldLandmarks[15], worldBefore, 'world landmarks untouched');
});

test('remapCroppedPoseFrame: hands and face remapped too', () => {
  const frame = frameAt(0.5, 0.5);
  frame.hands = [{
    side: 'Left',
    landmarks: [{ x: 0.5, y: 0.5, z: 0, visibility: 1 }],
    worldLandmarks: [{ x: 9, y: 9, z: 9 }],
  }];
  frame.faceLandmarks = [{ x: 0.5, y: 0.5, z: 0 }];
  const crop = { sx: 0, sy: 0, size: 960 };
  remapCroppedPoseFrame(frame, crop, W, H);
  assert.ok(Math.abs(frame.hands[0].landmarks[0].x - 0.25) < 1e-9, 'hand norm remapped');
  assert.equal(frame.hands[0].worldLandmarks[0].x, 9, 'hand world untouched');
  assert.ok(Math.abs(frame.faceLandmarks[0].y - (0.5 * 960) / H) < 1e-9, 'face remapped');
});
