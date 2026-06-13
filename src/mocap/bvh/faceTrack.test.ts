/**
 * Tests for faceTrack — the expression sidecar serializer.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { faceTrackHasMotion, serializeFaceTrack, type FaceTrack } from './faceTrack';

const f = (blinkLeft: number, blinkRight: number, aa: number) => ({ blinkLeft, blinkRight, aa });

test('faceTrackHasMotion: all-zero track has no motion', () => {
  const track: FaceTrack = { fps: 30, frames: [f(0, 0, 0), f(0, 0, 0)] };
  assert.equal(faceTrackHasMotion(track), false);
});

test('faceTrackHasMotion: any non-zero expression counts as motion', () => {
  assert.equal(faceTrackHasMotion({ fps: 30, frames: [f(0, 0, 0), f(0, 0, 0.5)] }), true);
  assert.equal(faceTrackHasMotion({ fps: 30, frames: [f(0.8, 0, 0)] }), true);
});

test('serializeFaceTrack: round-trips fps, frames, rounded to 4dp', () => {
  const track: FaceTrack = { fps: 30, frames: [f(0.123456, 0.5, 0), f(1, 0, 0.999949)] };
  const parsed = JSON.parse(serializeFaceTrack(track));
  assert.equal(parsed.format, 'vrm-player.face-track');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.fps, 30);
  assert.equal(parsed.frames.length, 2);
  assert.equal(parsed.frames[0].blinkLeft, 0.1235, 'rounded to 4 dp');
  assert.equal(parsed.frames[1].aa, 0.9999);
});

import { FaceTrackPlayer, parseFaceTrack } from './faceTrack';

function mockVrm() {
  const vals = {};
  return { vals, expressionManager: { setValue: (n, v) => { vals[n] = v; } } };
}

test('parseFaceTrack: round-trips a serialized track; rejects junk', () => {
  const t = { fps: 30, frames: [f(0.2, 0.1, 0.5)] };
  const parsed = parseFaceTrack(serializeFaceTrack(t));
  assert.equal(parsed?.fps, 30);
  assert.equal(parsed?.frames.length, 1);
  assert.equal(parseFaceTrack('{}'), null);
  assert.equal(parseFaceTrack('not json'), null);
});

test('FaceTrackPlayer: samples the frame at the clip time and sets expressions', () => {
  const vrm = mockVrm();
  const p = new FaceTrackPlayer(vrm);
  p.setTrack({ fps: 30, frames: [f(0, 0, 0), f(0.5, 0.4, 0.9)] });
  p.applyAt(1 / 30); // → frame 1
  assert.equal(vrm.vals.blinkLeft, 0.5);
  assert.equal(vrm.vals.blinkRight, 0.4);
  assert.equal(vrm.vals.aa, 0.9);
});

test('FaceTrackPlayer: holds the last frame past the end', () => {
  const vrm = mockVrm();
  const p = new FaceTrackPlayer(vrm);
  p.setTrack({ fps: 30, frames: [f(0, 0, 0), f(1, 1, 1)] });
  p.applyAt(99); // far past end → clamp to last
  assert.equal(vrm.vals.aa, 1);
});

test('FaceTrackPlayer: null track clears expressions once then no-ops', () => {
  const vrm = mockVrm();
  const p = new FaceTrackPlayer(vrm);
  p.setTrack({ fps: 30, frames: [f(0.5, 0.5, 0.5)] });
  p.applyAt(0);
  p.setTrack(null);
  p.applyAt(0);
  assert.equal(vrm.vals.aa, 0, 'expressions cleared when track removed');
  assert.equal(p.hasTrack, false);
});
