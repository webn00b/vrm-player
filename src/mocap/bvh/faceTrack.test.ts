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
