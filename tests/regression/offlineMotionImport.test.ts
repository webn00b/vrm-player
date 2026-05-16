import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseCanonicalMotionJson } from '../../src/mocap/offline/canonicalMotion';
import { retargetCanonicalMotionToVrm } from '../../src/mocap/offline/motionRetargeter';
import { buildMockVRM } from '../fixtures/mockVrm';

function smplRestFrame() {
  return [
    [0, 1.0, 0],     // pelvis
    [0.1, 1.0, 0],   // left hip
    [-0.1, 1.0, 0],  // right hip
    [0, 1.2, 0],     // spine1
    [0.1, 0.6, 0],   // left knee
    [-0.1, 0.6, 0],  // right knee
    [0, 1.4, 0],     // spine2
    [0.1, 0.2, 0],   // left ankle
    [-0.1, 0.2, 0],  // right ankle
    [0, 1.55, 0],    // spine3
    [0.1, 0.15, 0.1],
    [-0.1, 0.15, 0.1],
    [0, 1.65, 0],
    [0.08, 1.55, 0],
    [-0.08, 1.55, 0],
    [0, 1.8, 0],
    [0.2, 1.55, 0],
    [-0.2, 1.55, 0],
    [0.45, 1.55, 0],
    [-0.45, 1.55, 0],
    [0.7, 1.55, 0],
    [-0.7, 1.55, 0],
    [0.72, 1.55, 0],
    [-0.72, 1.55, 0],
  ];
}

test('offline parser accepts dense SMPL-style WHAM/GVHMR joints', () => {
  const motion = parseCanonicalMotionJson(JSON.stringify({
    name: 'walk',
    source: 'wham',
    fps: 30,
    joints3d: [smplRestFrame(), smplRestFrame()],
  }), 'fallback');

  assert.equal(motion.name, 'walk');
  assert.equal(motion.source, 'wham');
  assert.equal(motion.frames.length, 2);
  assert.deepEqual(motion.frames[0].joints.hips?.position, [0, 1, 0]);
  assert.deepEqual(motion.frames[0].joints.leftUpperArm?.position, [0.2, 1.55, 0]);
});

test('offline retarget builds playable AnimationClip tracks', () => {
  const vrm = buildMockVRM();
  const second = smplRestFrame();
  second[20] = [0.7, 1.7, 0];
  const motion = parseCanonicalMotionJson(JSON.stringify({
    name: 'raise-hand',
    source: 'gvhmr',
    fps: 30,
    joints3d: [smplRestFrame(), second],
  }), 'fallback');

  const clip = retargetCanonicalMotionToVrm(vrm, motion, { clampOutOfRange: true });
  assert.equal(clip.name, 'raise-hand');
  assert.ok(clip.duration > 0);
  assert.ok(clip.tracks.some((track) => track.name === 'hips.position'));
  assert.ok(clip.tracks.some((track) => track.name === 'leftUpperArm.quaternion'));
  for (const track of clip.tracks) {
    for (const value of track.values as ArrayLike<number>) {
      assert.ok(Number.isFinite(value), `${track.name} contains non-finite value`);
    }
  }
});

