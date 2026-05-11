/**
 * @vitest-environment happy-dom
 *
 * Round-trip test: build a tiny VRM-like skeleton + synthetic AnimationClip
 * → glTF binary (GLB) → parse back via three.js GLTFLoader → verify the
 * animation tracks survived.
 *
 * GLTFExporter needs FileReader (DOM) for blob encoding, so this file
 * opts into happy-dom. The pure-math tests stay on the lighter `node`
 * environment configured in vitest.config.ts.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildGlbBlobForClip } from './gltfExportRecorder';
import { buildMockVRM } from '../tests/fixtures/mockVrm';

/** Build a 1-second clip with a 90° Y rotation on leftUpperArm and identity
 *  on everything else — the simplest non-trivial animation. */
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

test('buildGlbBlobForClip: emits a binary blob with model/gltf-binary MIME', async () => {
  const vrm = buildMockVRM();
  const clip = buildSyntheticClip();
  const blob = await buildGlbBlobForClip(vrm as any, clip);
  assert.equal(blob.type, 'model/gltf-binary');
  assert.ok(blob.size > 1000, `GLB should be more than a few bytes; got ${blob.size}`);
});

test('GLB round-trip: GLTFLoader parses the output and finds the clip', async () => {
  const vrm = buildMockVRM();
  const clip = buildSyntheticClip();
  const blob = await buildGlbBlobForClip(vrm as any, clip);
  const buffer = await blob.arrayBuffer();

  const loader = new GLTFLoader();
  const result = await new Promise<any>((resolve, reject) => {
    loader.parse(buffer, '', (gltf) => resolve(gltf), reject);
  });

  // Animation array carries our clip.
  assert.ok(Array.isArray(result.animations), 'GLB has animations array');
  assert.equal(result.animations.length, 1, 'exactly one clip');
  const roundTripped = result.animations[0] as THREE.AnimationClip;
  assert.ok(roundTripped.tracks.length >= 1, 'has at least one track');
});

test('GLB round-trip: leftUpperArm.quaternion track values survive within float tolerance', async () => {
  const vrm = buildMockVRM();
  const clip = buildSyntheticClip();
  const blob = await buildGlbBlobForClip(vrm as any, clip);
  const buffer = await blob.arrayBuffer();

  const loaded = await new Promise<any>((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf), reject);
  });

  const clipBack = loaded.animations[0] as THREE.AnimationClip;
  // Find the leftUpperArm rotation track. GLTFLoader may rename to use a
  // node uuid prefix; we just look for any track ending in '.quaternion'
  // with values in the same length as our input (12 floats = 3 frames × 4).
  const track = clipBack.tracks.find((t: any) =>
    t.name.endsWith('.quaternion') && t.values.length === 12);
  assert.ok(track, 'found a quaternion track with 3 keyframes');

  // Frame-1 (mid) values should equal half ≈ (0, sin(π/8), 0, cos(π/8)).
  const v = track!.values;
  const half = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  // GLTFExporter may pack values in different order across versions, so use
  // |dot| as a rotation-equivalence check instead of strict per-component.
  const back = new THREE.Quaternion(v[4], v[5], v[6], v[7]);
  const dot = Math.abs(back.dot(half));
  const angleErrorDeg = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, dot)));
  assert.ok(angleErrorDeg < 1,
    `mid-frame rotation round-trips within 1°; got ${angleErrorDeg.toFixed(3)}°`);
});

test('buildGlbBlobForClip: skips missing VRM bones gracefully', async () => {
  const vrm = buildMockVRM();
  // Pretend a bone is missing — should not throw.
  (vrm as any).humanoid.getNormalizedBoneNode = (name: string) => {
    if (name === 'jaw') return null;
    return vrm.bones.get(name) ?? null;
  };
  const clip = buildSyntheticClip();
  const blob = await buildGlbBlobForClip(vrm as any, clip);
  assert.ok(blob.size > 0);
});
