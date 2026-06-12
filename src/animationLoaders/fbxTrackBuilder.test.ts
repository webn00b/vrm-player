import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTracksFromSamples } from './fbxTrackBuilder';
import { buildMockVRM } from '../../tests/fixtures/mockVrm';

/** Minimal FBX clip containing only a hips position track. */
function makeFbxClip(times: number[], values: number[]): THREE.AnimationClip {
  const track = new THREE.VectorKeyframeTrack('mixamorigHips.position', times, values);
  return new THREE.AnimationClip('test', times[times.length - 1] ?? 0, [track]);
}

function build(clip: THREE.AnimationClip, sourceHipsRestY?: number) {
  const vrm = buildMockVRM(); // mock hips world Y = 1.0 → avatarHipY = 1.0
  return buildTracksFromSamples([], new Map(), clip, vrm as never, sourceHipsRestY);
}

test('hips track rescaled by rest-pose ratio, not first keyframe', () => {
  // Clip starts mid-crouch (y=2) but the bind-pose hips sit at y=4.
  const clip = makeFbxClip([0, 1], [0, 2, 0, 1, 2, 1]);
  const built = build(clip, 4.0);
  assert.ok(built.hipsAdaptation?.applied);
  assert.ok(Math.abs(built.hipsAdaptation!.scale - 0.25) < 1e-9,
    `scale from rest pose (1.0/4.0), got ${built.hipsAdaptation!.scale}`);
  const posTrack = built.tracks.find((t) => t.name === 'hips.position')!;
  assert.ok(posTrack, 'hips position track appended');
  assert.ok(Math.abs(posTrack.values[1] - 0.5) < 1e-6, 'y keyframes scaled');
  assert.ok(Math.abs(posTrack.values[4] - 0.5) < 1e-6, 'x/z keyframes scaled too');
});

test('falls back to first keyframe when rest height unavailable', () => {
  const clip = makeFbxClip([0, 1], [0, 2, 0, 0, 2, 0]);
  const built = build(clip, undefined);
  assert.ok(built.hipsAdaptation?.applied);
  assert.ok(Math.abs(built.hipsAdaptation!.scale - 0.5) < 1e-9, '1.0 / firstHipY(2.0)');
});

test('grounded source: hips track dropped, avatar keeps rest hips', () => {
  const clip = makeFbxClip([0, 1], [0, 0.01, 0, 0, 0.02, 0]);
  const built = build(clip, undefined);
  assert.equal(built.hipsAdaptation, null);
  assert.equal(built.tracks.find((t) => /position$/.test(t.name)), undefined);
});

test('matching heights: track kept verbatim, adaptation not applied', () => {
  const clip = makeFbxClip([0, 1], [0.1, 1.0, 0, 0.2, 1.1, 0]);
  const built = build(clip, 1.0);
  assert.equal(built.hipsAdaptation?.applied, false);
  const posTrack = built.tracks.find((t) => t.name === 'hips.position')!;
  assert.ok(Math.abs(posTrack.values[0] - 0.1) < 1e-6, 'values untouched');
  assert.ok(Math.abs(posTrack.values[4] - 1.1) < 1e-6, 'values untouched');
});

test('no hips position track in source: nothing appended', () => {
  const clip = new THREE.AnimationClip('empty', 1, []);
  const built = build(clip);
  assert.equal(built.hipsAdaptation, null);
  assert.equal(built.tracks.length, 0);
});
