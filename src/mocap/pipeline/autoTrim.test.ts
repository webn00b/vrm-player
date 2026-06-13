/**
 * Tests for autoTrim — idle head/tail removal by motion energy.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { autoTrimRange, motionEnergy } from './autoTrim';
import type { Landmark3D, PoseFrame } from './poseDetector';

// Frame with all motion landmarks at a common (x, y) so frame-to-frame
// displacement equals the offset between consecutive frames.
function frameAt(x: number, y: number): PoseFrame {
  const lms: Landmark3D[] = Array.from({ length: 33 }, () => ({ x, y, z: 0, visibility: 1 }));
  return { landmarks: lms, worldLandmarks: lms, faceLandmarks: [], hands: [] };
}

// Build: `head` static frames, `active` moving frames, `tail` static frames.
function clip(head: number, active: number, tail: number): PoseFrame[] {
  const out: PoseFrame[] = [];
  for (let i = 0; i < head; i++) out.push(frameAt(0.5, 0.5));
  for (let i = 0; i < active; i++) out.push(frameAt(0.5 + (i % 2) * 0.08, 0.5));
  for (let i = 0; i < tail; i++) out.push(frameAt(0.66, 0.5));
  return out;
}

test('motionEnergy: zero for static, positive for moving', () => {
  const e = motionEnergy(clip(5, 6, 5));
  assert.equal(e[2], 0, 'static head has no motion');
  assert.ok(e[7] > 0, 'active section moves');
});

test('autoTrimRange: trims static head and tail around the active span', () => {
  const frames = clip(40, 40, 40); // 120 frames
  const r = autoTrimRange(frames, { padFrames: 3, minKeepFrames: 10 });
  assert.ok(r.start > 5 && r.start < 40, `start drops into head; got ${r.start}`);
  assert.ok(r.end > 80 && r.end <= 120, `end keeps active, drops tail; got ${r.end}`);
});

test('autoTrimRange: uniformly active clip is kept whole', () => {
  const frames: PoseFrame[] = [];
  for (let i = 0; i < 90; i++) frames.push(frameAt(0.5 + (i % 2) * 0.08, 0.5));
  const r = autoTrimRange(frames);
  assert.deepEqual(r, { start: 0, end: 90 });
});

test('autoTrimRange: short clip is never trimmed', () => {
  const r = autoTrimRange(clip(5, 5, 5), { minKeepFrames: 30 });
  assert.deepEqual(r, { start: 0, end: 15 });
});

test('autoTrimRange: a mid-clip pause is preserved (only ends trimmed)', () => {
  // active, static pause, active — the pause is interior, must survive.
  const frames: PoseFrame[] = [];
  for (let i = 0; i < 30; i++) frames.push(frameAt(0.5, 0.5));      // head static
  for (let i = 0; i < 30; i++) frames.push(frameAt(0.5 + (i % 2) * 0.08, 0.5)); // active
  for (let i = 0; i < 20; i++) frames.push(frameAt(0.66, 0.5));     // mid pause
  for (let i = 0; i < 30; i++) frames.push(frameAt(0.66 + (i % 2) * 0.08, 0.5)); // active
  for (let i = 0; i < 30; i++) frames.push(frameAt(0.82, 0.5));     // tail static
  const r = autoTrimRange(frames, { padFrames: 3 });
  // start past the head, end before the tail, interior pause inside the range.
  assert.ok(r.start > 5 && r.start < 35, `start ${r.start}`);
  assert.ok(r.end > 90 && r.end < 135, `end ${r.end}`);
  assert.ok(r.end - r.start > 70, 'interior pause kept inside the range');
});
