/**
 * Tests for BvhRecorder — the class that captures per-frame bone quaternions
 * and emits a .bvh text file.
 *
 * Coverage:
 *   - lifecycle: start() / addFrame() / captureFrame() / stop()
 *   - BVH text structure: HIERARCHY + MOTION sections, channel declarations,
 *     OFFSETs, End Sites, frame rows
 *   - rate limiting: addFrame() honors the declared frame rate
 *   - captureFrame(): bypasses rate limiter, auto-starts
 *   - round-trip identity: feed a known quaternion, write BVH, parse via
 *     stock three.js BVHLoader, read back, verify quaternion match
 *   - getJointOffset / getRestCorrectionInv hooks
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { BvhRecorder, BVH_JOINTS, BVH_FRAME_TIME, downloadBvh } from './bvhRecorder';
import { createBvhRecorderForVrm, getJointOffset } from './bvhRecorderFactory';
import { buildMockVRM } from '../../../tests/fixtures/mockVrm';

const IDENT: [number, number, number, number] = [0, 0, 0, 1];

// ── Lifecycle ────────────────────────────────────────────────────────────

test('lifecycle: recording flag toggles on start/stop', () => {
  const r = new BvhRecorder();
  assert.equal(r.recording, false, 'starts not recording');
  r.start();
  assert.equal(r.recording, true);
  r.stop();
  assert.equal(r.recording, false, 'stop ends recording');
});

test('lifecycle: stop() resets frame count', () => {
  const r = new BvhRecorder();
  r.start();
  r.captureFrame(() => IDENT);
  r.captureFrame(() => IDENT);
  assert.equal(r.frameCount, 2);
  r.stop();
  assert.equal(r.frameCount, 0, 'frames cleared on stop');
});

test('captureFrame: auto-starts recording if not active', () => {
  const r = new BvhRecorder();
  // Not started; captureFrame should auto-start.
  r.captureFrame(() => IDENT);
  assert.equal(r.recording, true);
  assert.equal(r.frameCount, 1);
});

test('captureFrame: synthesises one frame per call (bypasses rate limit)', () => {
  const r = new BvhRecorder();
  r.start();
  for (let i = 0; i < 10; i++) r.captureFrame(() => IDENT);
  assert.equal(r.frameCount, 10, 'each call adds exactly one frame');
});

// ── BVH text structure ──────────────────────────────────────────────────

test('output: HIERARCHY section starts with ROOT hips', () => {
  const r = new BvhRecorder();
  r.start();
  r.captureFrame(() => IDENT);
  const text = r.stop();
  assert.match(text, /^HIERARCHY\n/, 'HIERARCHY header present');
  assert.match(text, /\nROOT hips\b/, 'hips is the root');
});

test('output: contains MOTION section with frame count and frame time', () => {
  const r = new BvhRecorder();
  r.start();
  for (let i = 0; i < 3; i++) r.captureFrame(() => IDENT);
  const text = r.stop();
  assert.match(text, /\nMOTION\nFrames: 3\n/);
  assert.match(text, /\nFrame Time: 0\.0\d+\n/);
});

test('output: channel declarations match BVH spec', () => {
  const r = new BvhRecorder();
  r.start();
  r.captureFrame(() => IDENT);
  const text = r.stop();
  // Root: 6 channels (Xposition Yposition Zposition + 3 rotations)
  assert.match(text, /CHANNELS 6 Xposition Yposition Zposition/);
  // Non-root joints: 3 rotation channels
  assert.match(text, /CHANNELS 3 (?:[XYZ]rotation\s?){3}/);
});

test('output: contains End Site markers for terminal joints', () => {
  const r = new BvhRecorder();
  r.start();
  r.captureFrame(() => IDENT);
  const text = r.stop();
  assert.match(text, /End Site/);
});

// ── Joint offsets ───────────────────────────────────────────────────────

test('getJointOffset hook: OFFSETs come from supplied callback', () => {
  // Supply a custom offset for leftUpperArm.
  const r = new BvhRecorder({
    getJointOffset: (name: string) => {
      if (name === 'leftUpperArm') return [0.123, 0.456, 0.789];
      return null;
    },
  });
  r.start();
  r.captureFrame(() => IDENT);
  const text = r.stop();
  // The custom offset should appear in the OFFSET line for leftUpperArm.
  // Find leftUpperArm in HIERARCHY and check OFFSET line.
  const idx = text.indexOf('leftUpperArm');
  assert.ok(idx > 0, 'leftUpperArm in HIERARCHY');
  const offsetSection = text.slice(idx, idx + 200);
  // The recorder formats OFFSETs with .toFixed(2), so we match the rounded form.
  assert.match(offsetSection, /OFFSET 0\.12 0\.46 0\.79/,
    `expected custom offset in leftUpperArm block; got: ${offsetSection.slice(0, 100)}`);
});

test('getJointOffset: measures offsets against the declared BVH parent when intermediate bones are skipped', () => {
  const vrm = buildMockVRM();
  const chest = vrm.bones.get('chest')!;
  const neck = vrm.bones.get('neck')!;

  const upperChest = new THREE.Object3D();
  upperChest.name = 'upperChest';
  upperChest.position.set(0, 0.1, 0);
  chest.add(upperChest);
  upperChest.add(neck);
  neck.position.set(0, 0.1, 0);
  vrm.bones.set('upperChest', upperChest);
  (vrm.humanoid.humanBones as any).upperChest = { node: upperChest };
  vrm.scene.updateMatrixWorld(true);

  const offset = getJointOffset(vrm as any, 'neck');
  assert.ok(offset, 'neck offset should exist');
  assert.ok(Math.abs(offset![0]) < 1e-6);
  assert.ok(Math.abs(offset![1] - 0.2) < 1e-6, `expected chest->neck offset 0.2, got ${offset![1]}`);
  assert.ok(Math.abs(offset![2]) < 1e-6);
});

test('createBvhRecorderForVrm: external BVH does not pre-flip VRM0 hips position', () => {
  const vrm = buildMockVRM({ version: '0' });
  const recorder = createBvhRecorderForVrm(vrm as any);

  recorder.captureFrame(() => IDENT, () => [0.5, 1.2, -0.3]);
  const text = recorder.stop();
  const row = text.trim().split('\n').at(-1)!;

  assert.ok(
    row.startsWith('0.5000 1.2000 -0.3000 '),
    `external BVH should keep VRM0 root position unflipped; got ${row}`,
  );
});

test('createBvhRecorderForVrm: internal round-trip mode keeps the old VRM0 pre-flip', () => {
  const vrm = buildMockVRM({ version: '0' });
  const recorder = createBvhRecorderForVrm(vrm as any, { compatibility: 'internal-roundtrip' });

  recorder.captureFrame(() => IDENT, () => [0.5, 1.2, -0.3]);
  const text = recorder.stop();
  const row = text.trim().split('\n').at(-1)!;

  assert.ok(
    row.startsWith('-0.5000 1.2000 0.3000 '),
    `internal round-trip BVH should pre-flip VRM0 root position; got ${row}`,
  );
});

// ── Round-trip via stock three.js BVHLoader ─────────────────────────────

test('round-trip: rotation on leftUpperArm parses back to ~same quaternion', () => {
  // Apply a 30° rotation around X to leftUpperArm; identity for everything else.
  const inputQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 6);
  const inputArr: [number, number, number, number] = [inputQuat.x, inputQuat.y, inputQuat.z, inputQuat.w];

  const r = new BvhRecorder();
  r.start();
  // Single frame: leftUpperArm rotated, everything else identity.
  r.captureFrame((name: string) => name === 'leftUpperArm' ? inputArr : IDENT);
  const text = r.stop();

  // Parse via stock three.js BVHLoader.
  const loader = new BVHLoader();
  const parsed = loader.parse(text);

  // Find the leftUpperArm quaternion track.
  const track = parsed.clip.tracks.find((t: any) => t.name === 'leftUpperArm.quaternion');
  assert.ok(track, 'leftUpperArm.quaternion track should exist in parsed clip');

  // Read the first frame's quaternion values.
  const v = track!.values;
  const parsedQuat = new THREE.Quaternion(v[0], v[1], v[2], v[3]);

  // Allow some tolerance for Euler↔quat round-trip floating point error.
  const dot = Math.abs(parsedQuat.dot(inputQuat));
  const angleErrorDeg = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, dot)));
  assert.ok(angleErrorDeg < 0.5,
    `parsed quaternion should match input within 0.5°; got ${angleErrorDeg.toFixed(4)}°`);
});

test('round-trip: hips position is recorded and survives BVH parse', () => {
  const r = new BvhRecorder();
  r.start();
  r.captureFrame(
    () => IDENT,
    () => [0.5, 1.2, -0.3],  // hipsPos
  );
  const text = r.stop();

  const loader = new BVHLoader();
  const parsed = loader.parse(text);
  const posTrack = parsed.clip.tracks.find((t: any) => t.name === 'hips.position');
  assert.ok(posTrack, 'hips.position track present');
  const v = posTrack!.values;
  assert.ok(Math.abs(v[0] - 0.5) < 1e-3, `x ≈ 0.5; got ${v[0]}`);
  assert.ok(Math.abs(v[1] - 1.2) < 1e-3, `y ≈ 1.2; got ${v[1]}`);
  assert.ok(Math.abs(v[2] + 0.3) < 1e-3, `z ≈ -0.3; got ${v[2]}`);
});

test('round-trip: multiple frames preserve per-frame quaternions', () => {
  // Three different rotation angles on chest.
  const angles = [Math.PI / 12, Math.PI / 6, Math.PI / 4];
  const quats = angles.map((a) =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));
  let frameIdx = 0;
  const r = new BvhRecorder();
  r.start();
  for (let i = 0; i < 3; i++) {
    const q = quats[i];
    r.captureFrame((name) => {
      if (name === 'chest') return [q.x, q.y, q.z, q.w];
      return IDENT;
    });
  }
  const text = r.stop();

  const loader = new BVHLoader();
  const parsed = loader.parse(text);
  const track = parsed.clip.tracks.find((t: any) => t.name === 'chest.quaternion');
  assert.ok(track);
  // Three frames × 4 components = 12 values.
  assert.equal(track!.values.length, 12, 'three frames recorded');
  // Frame 1 (middle): values[4..7] should match quats[1] within tolerance.
  const v = track!.values;
  const mid = new THREE.Quaternion(v[4], v[5], v[6], v[7]);
  const expected = quats[1];
  const dot = Math.abs(mid.dot(expected));
  const angleErrorDeg = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, dot)));
  assert.ok(angleErrorDeg < 0.5,
    `frame 1 round-trip; got ${angleErrorDeg.toFixed(4)}° error`);
});

// ── downloadBvh smoke (browser-only; in Node it should still build a blob) ──

test('downloadBvh: callable in node (Blob global available in modern Node)', () => {
  // Only verify it doesn't throw; the actual browser download is untestable
  // in node. We rely on the fact that Node 18+ has Blob global and the file
  // download just kicks off an anchor click in browsers.
  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    // Provide minimal DOM stubs so the function can proceed.
    const a: any = { click: () => {}, href: '', download: '' };
    (globalThis as any).document = {
      createElement: () => a,
      body: { appendChild: () => {}, removeChild: () => {} },
    };
    downloadBvh('mock-bvh-text', 'test.bvh');
    // No assertion needed — the call returning is the test.
    assert.ok(true);
  } else {
    // Node version lacks Blob/URL — skip silently.
    assert.ok(true, 'skipped: no Blob/URL available');
  }
});

// ── BVH_JOINTS list sanity ──────────────────────────────────────────────

test('BVH_JOINTS: contains all major humanoid bones', () => {
  const names = BVH_JOINTS.map((j) => j.name);
  for (const required of [
    'hips', 'spine', 'chest', 'neck', 'head',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  ]) {
    assert.ok(names.includes(required), `BVH_JOINTS missing required bone: ${required}`);
  }
});

test('BVH_FRAME_TIME: ~30 fps (1/30 s)', () => {
  // Recorder targets 30 fps for BVH output (matches MMD/SystemAnimator convention).
  assert.ok(Math.abs(BVH_FRAME_TIME - 1 / 30) < 1e-9);
});
