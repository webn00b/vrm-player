/**
 * Tests for the FBX → JSON converter.
 *
 * Strategy: we trust three.js's FBXLoader to parse FBX correctly (it has
 * its own test suite upstream). What we test here is OUR shape conversion
 * from THREE.AnimationClip → FbxJsonOutput. Direct-clip-in tests don't
 * need an actual .fbx fixture file.
 *
 * Integration verification — that FBXLoader output is correctly threaded
 * through `clipToFbxJson` — happens organically through manual testing
 * in the UI; baking a binary fixture into the test suite isn't worth the
 * disk footprint.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipToFbxJson, fbxBufferToJson } from './fbxToJsonConverter';

/** Build a synthetic clip with a rotation track on one bone + position
 *  track on another, at 30 fps for 1 second. */
function buildSyntheticClip(): THREE.AnimationClip {
  const times = new Float32Array([0, 1 / 30, 2 / 30, 3 / 30]);
  const quat0 = new THREE.Quaternion();
  const quat1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const rotValues = new Float32Array([
    quat0.x, quat0.y, quat0.z, quat0.w,
    quat0.x, quat0.y, quat0.z, quat0.w,
    quat1.x, quat1.y, quat1.z, quat1.w,
    quat1.x, quat1.y, quat1.z, quat1.w,
  ]);
  const rotTrack = new THREE.QuaternionKeyframeTrack(
    'mixamorigLeftArm.quaternion', times, rotValues,
  );

  const posValues = new Float32Array([
    0, 0.9, 0,
    0.01, 0.9, 0,
    0.02, 0.9, 0,
    0.03, 0.9, 0,
  ]);
  const posTrack = new THREE.VectorKeyframeTrack(
    'mixamorigHips.position', times, posValues,
  );

  return new THREE.AnimationClip('Take 001', 4 / 30, [rotTrack, posTrack]);
}

test('clipToFbxJson: basic shape — duration, name, tracks length, fps', () => {
  const clip = buildSyntheticClip();
  const json = clipToFbxJson(clip);

  assert.equal(json.name, 'Take 001');
  assert.equal(json.duration, 0.133333);  // 4/30 rounded to 6dp
  assert.equal(json.tracks.length, 2);
  assert.equal(json.fps, 30);
});

test('clipToFbxJson: quaternion track has stride 4', () => {
  const clip = buildSyntheticClip();
  const json = clipToFbxJson(clip);
  const rotTrack = json.tracks.find((t) => t.property === 'quaternion');
  assert.ok(rotTrack, 'quaternion track present');
  assert.equal(rotTrack!.values.length, 4, '4 keyframes');
  for (const row of rotTrack!.values) {
    assert.equal(row.length, 4, 'each quaternion value is [x,y,z,w]');
  }
});

test('clipToFbxJson: position track has stride 3', () => {
  const clip = buildSyntheticClip();
  const json = clipToFbxJson(clip);
  const posTrack = json.tracks.find((t) => t.property === 'position');
  assert.ok(posTrack, 'position track present');
  for (const row of posTrack!.values) {
    assert.equal(row.length, 3, 'each position value is [x,y,z]');
  }
});

test('clipToFbxJson: bone names preserved verbatim (no retargeting)', () => {
  const clip = buildSyntheticClip();
  const json = clipToFbxJson(clip);
  const bones = new Set(json.tracks.map((t) => t.bone));
  assert.ok(bones.has('mixamorigLeftArm'), 'mixamorig bone name preserved');
  assert.ok(bones.has('mixamorigHips'), 'mixamorig hips preserved');
});

test('clipToFbxJson: float precision rounded to 6 decimals', () => {
  const times = new Float32Array([0, 0.123456789, 1]);
  const values = new Float32Array([
    0, 0, 0, 1,
    0.123456789, 0.123456789, 0, 0.987654321,
    0, 0, 0, 1,
  ]);
  const track = new THREE.QuaternionKeyframeTrack('test.quaternion', times, values);
  const clip = new THREE.AnimationClip('precision', 1, [track]);

  const json = clipToFbxJson(clip);
  const t = json.tracks[0];
  // Each rounded to ≤ 6 decimal places. (Parens around the ?? coalesce so it
  // doesn't merge into the comparison operand precedence.)
  const timeDecimals = t.times[1].toString().split('.')[1]?.length ?? 0;
  assert.ok(timeDecimals <= 6, `time decimals ${timeDecimals} should be ≤ 6`);
  for (const row of t.values) {
    for (const v of row) {
      const decimals = v.toString().split('.')[1]?.length ?? 0;
      assert.ok(decimals <= 6, `value ${v} should be ≤ 6dp; got ${decimals}`);
    }
  }
});

test('clipToFbxJson: fps inference is null for single-keyframe track', () => {
  const times = new Float32Array([0]);
  const values = new Float32Array([0, 0, 0, 1]);
  const track = new THREE.QuaternionKeyframeTrack('bone.quaternion', times, values);
  const clip = new THREE.AnimationClip('single', 0, [track]);

  const json = clipToFbxJson(clip);
  assert.equal(json.fps, null, 'cannot infer fps from one keyframe');
});

test('clipToFbxJson: fps inference picks the modal/median time-step', () => {
  // Irregular spacing with most steps = 1/24 → should infer 24 fps.
  const times = new Float32Array([0, 1/24, 2/24, 3/24, 3/24 + 0.5, 3/24 + 0.5 + 1/24]);
  const values = new Float32Array(times.length * 4);
  for (let i = 0; i < times.length; i++) { values[i * 4 + 3] = 1; }  // identity quats
  const track = new THREE.QuaternionKeyframeTrack('bone.quaternion', times, values);
  const clip = new THREE.AnimationClip('irreg', times[times.length - 1], [track]);

  const json = clipToFbxJson(clip);
  assert.equal(json.fps, 24, '24-fps majority detected via median');
});

test('fbxBufferToJson: throws on a buffer with no FBX content', () => {
  // Empty buffer — FBXLoader will throw "Cannot find the version number".
  const empty = new ArrayBuffer(8);
  assert.throws(
    () => fbxBufferToJson(empty, 'empty.fbx'),
    /version|FBX|format/i,
  );
});

test('JSON output: stringify round-trip preserves shape', () => {
  const clip = buildSyntheticClip();
  const animation = clipToFbxJson(clip);
  const output = {
    source: 'test.fbx',
    exportedAt: '2026-01-01T00:00:00.000Z',
    animations: [animation],
    bones: ['mixamorigHips', 'mixamorigLeftArm'],
  };

  const text = JSON.stringify(output);
  const parsed = JSON.parse(text);

  assert.equal(parsed.animations[0].duration, animation.duration);
  assert.equal(parsed.animations[0].tracks.length, animation.tracks.length);
  // Spot-check one keyframe value pair.
  assert.deepEqual(
    parsed.animations[0].tracks[0].values[0],
    animation.tracks[0].values[0],
  );
});
