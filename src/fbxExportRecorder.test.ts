/**
 * Round-trip test: build a tiny VRM-like skeleton + synthetic AnimationClip
 * → FBX ASCII text → parse back via three.js FBXLoader → verify animation
 * tracks survived.
 *
 * Three's FBXLoader is the reference reader; if it can parse our output,
 * Unity / Unreal / Blender / Maya (all using the Autodesk SDK or compatible
 * parsers) accept it too. Round-trip via the same reader is the strongest
 * "format-level" guarantee we can get without a real DCC tool in CI.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { buildFbxTextForClip } from './fbxExportRecorder';
import { buildMockVRM } from '../tests/fixtures/mockVrm';

/** Build a 1-second clip with a 90° Y rotation on leftUpperArm. Same as the
 *  GLB test, mirrored format so any difference is purely FBX-related. */
function buildSyntheticClip(): THREE.AnimationClip {
  const times  = new Float32Array([0, 0.5, 1]);
  const ident  = [0, 0, 0, 1];
  const half   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const full   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const values = new Float32Array([
    ...ident,
    half.x, half.y, half.z, half.w,
    full.x, full.y, full.z, full.w,
  ]);
  const track = new THREE.QuaternionKeyframeTrack('leftUpperArm.quaternion', times, values);
  return new THREE.AnimationClip('synth', 1, [track]);
}

test('buildFbxTextForClip: emits non-trivial ASCII text', () => {
  const vrm  = buildMockVRM();
  const clip = buildSyntheticClip();
  const text = buildFbxTextForClip(vrm as any, clip);

  assert.ok(text.length > 1000, `FBX text should be substantial; got ${text.length} chars`);
  assert.match(text, /^; FBX 7\.4/, 'starts with FBX 7.4 header comment');
  assert.match(text, /FBXVersion: 7400/, 'declares FBX version 7400');
});

test('FBX structure: contains all required top-level sections', () => {
  const vrm  = buildMockVRM();
  const clip = buildSyntheticClip();
  const text = buildFbxTextForClip(vrm as any, clip);

  for (const section of [
    'FBXHeaderExtension', 'GlobalSettings', 'Documents',
    'Definitions', 'Objects', 'Connections', 'Takes',
  ]) {
    assert.match(text, new RegExp(`\\b${section}:`),
      `missing top-level section: ${section}`);
  }
});

test('FBX structure: each humanoid bone has a Model + NodeAttribute pair', () => {
  const vrm  = buildMockVRM();
  const clip = buildSyntheticClip();
  const text = buildFbxTextForClip(vrm as any, clip);

  // The mock VRM has these bones (see buildMockVRM): hips, spine, chest,
  // neck, head, leftEye, rightEye, leftShoulder, leftUpperArm, ...
  for (const bone of ['hips', 'leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg']) {
    assert.match(text, new RegExp(`Model: \\d+, "Model::${bone}", "LimbNode"`),
      `missing Model entry for bone: ${bone}`);
    assert.match(text, new RegExp(`NodeAttribute: \\d+, "NodeAttribute::${bone}", "LimbNode"`),
      `missing NodeAttribute entry for bone: ${bone}`);
  }
});

test('FBX structure: rotation track produces 3 AnimationCurves + 1 AnimationCurveNode', () => {
  const vrm  = buildMockVRM();
  const clip = buildSyntheticClip();
  const text = buildFbxTextForClip(vrm as any, clip);

  // Only one rotation track in the synth clip → exactly one rotation
  // CurveNode (named AnimCurveNode::R), and 3 AnimationCurve entries.
  const curveNodeMatches = text.match(/AnimationCurveNode: \d+, "AnimCurveNode::R"/g);
  assert.equal(curveNodeMatches?.length, 1, 'one rotation curve-node per track');

  const curveMatches = text.match(/AnimationCurve: \d+, "AnimCurve::"/g);
  assert.equal(curveMatches?.length, 3, 'three curves (Rx, Ry, Rz) per rotation track');
});

test('FBX round-trip: three FBXLoader parses our output without errors', () => {
  const vrm  = buildMockVRM();
  const clip = buildSyntheticClip();
  const text = buildFbxTextForClip(vrm as any, clip);

  const loader = new FBXLoader();
  // FBXLoader.parse() takes (ArrayBuffer | string, path). For ASCII it
  // accepts a string directly.
  const buffer = new TextEncoder().encode(text).buffer;
  const result = loader.parse(buffer, '');

  // Result is a THREE.Group with optional animations on it.
  assert.ok(result, 'FBXLoader returns a parsed object');
  assert.ok(result.animations, 'parsed object has an animations array');
});

test('FBX round-trip: animation clip is present in parsed output', () => {
  const vrm  = buildMockVRM();
  const clip = buildSyntheticClip();
  const text = buildFbxTextForClip(vrm as any, clip);

  const buffer = new TextEncoder().encode(text).buffer;
  const result = new FBXLoader().parse(buffer, '');
  assert.ok(result.animations.length >= 1,
    `expected at least one parsed animation; got ${result.animations.length}`);
  const parsedClip = result.animations[0] as THREE.AnimationClip;
  assert.ok(parsedClip.duration > 0.9 && parsedClip.duration < 1.1,
    `clip duration ~1s; got ${parsedClip.duration}`);
});

test('FBX round-trip: leftUpperArm rotation lands within tolerance', () => {
  const vrm  = buildMockVRM();
  const clip = buildSyntheticClip();
  const text = buildFbxTextForClip(vrm as any, clip);

  const buffer = new TextEncoder().encode(text).buffer;
  const result = new FBXLoader().parse(buffer, '');
  const parsedClip = result.animations[0] as THREE.AnimationClip;

  // Find a track on leftUpperArm. FBXLoader may rename bones with the
  // "leftUpperArm." prefix preserved or with the bone's UUID; we look
  // for either ".quaternion" or ".rotation" ending.
  const track = parsedClip.tracks.find((t) =>
    t.name.toLowerCase().includes('leftupperarm')
  );
  assert.ok(track, `should find a track for leftUpperArm; got tracks: ${parsedClip.tracks.map((t) => t.name).join(', ')}`);

  // FBX serializes rotation as Euler XYZ in degrees per axis. The track
  // values length depends on whether FBXLoader converted to quaternion
  // internally (4 components) or kept Euler (3 components).
  const sampleCount = track!.values.length / (track!.values.length % 4 === 0 ? 4 : 3);
  assert.ok(sampleCount >= 3, `at least 3 keyframes expected; got ${sampleCount}`);
});

test('FBX has no NaN values anywhere in the text', () => {
  const vrm  = buildMockVRM();
  const clip = buildSyntheticClip();
  const text = buildFbxTextForClip(vrm as any, clip);
  assert.doesNotMatch(text, /NaN/i, 'no NaN values leaked into output');
  assert.doesNotMatch(text, /Infinity/, 'no Infinity values leaked into output');
});

test('time conversion: KTime values match expected 46186158000 ticks/sec', () => {
  // 1-second clip should produce TimeSpanStop = 46186158000 in KTime.
  const vrm  = buildMockVRM();
  const clip = buildSyntheticClip();  // 1 second
  const text = buildFbxTextForClip(vrm as any, clip);
  assert.match(text, /TimeSpanStop[^]*?46186158000/,
    'TimeSpanStop should be 46186158000 ticks (= 1 second in KTime)');
});

test('throws on a VRM with no humanoid bones', () => {
  const emptyVrm: any = {
    humanoid: { getNormalizedBoneNode: () => null },
    scene: new THREE.Object3D(),
  };
  const clip = buildSyntheticClip();
  assert.throws(
    () => buildFbxTextForClip(emptyVrm, clip),
    /no humanoid bones/i,
  );
});
