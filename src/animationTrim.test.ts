import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as THREE from 'three';
import { trimAnimationClip } from './animationTrim';

function buildLinearClip(): THREE.AnimationClip {
  return new THREE.AnimationClip('wave', 3, [
    new THREE.VectorKeyframeTrack(
      'hips.position',
      [0, 1, 2, 3],
      [
        0, 0, 0,
        1, 0, 0,
        2, 0, 0,
        3, 0, 0,
      ],
    ),
  ]);
}

test('trimAnimationClip samples exact boundaries and shifts the segment to zero', () => {
  const source = buildLinearClip();

  const trimmed = trimAnimationClip(source, { start: 0.5, end: 2.5, name: 'wave_trim' });
  const track = trimmed.tracks[0] as THREE.VectorKeyframeTrack;

  assert.equal(trimmed.name, 'wave_trim');
  assert.equal(trimmed.duration, 2);
  assert.deepEqual(Array.from(track.times), [0, 0.5, 1.5, 2]);
  assert.deepEqual(Array.from(track.values), [
    0.5, 0, 0,
    1, 0, 0,
    2, 0, 0,
    2.5, 0, 0,
  ]);

  assert.deepEqual(Array.from(source.tracks[0].times), [0, 1, 2, 3]);
});

test('trimAnimationClip clamps requested range to source duration', () => {
  const trimmed = trimAnimationClip(buildLinearClip(), { start: -1, end: 10 });

  assert.equal(trimmed.duration, 3);
  assert.deepEqual(Array.from(trimmed.tracks[0].times), [0, 1, 2, 3]);
});

test('trimAnimationClip rejects empty or reversed ranges', () => {
  assert.throws(
    () => trimAnimationClip(buildLinearClip(), { start: 1.5, end: 1.5 }),
    /end time must be after start time/i,
  );
  assert.throws(
    () => trimAnimationClip(buildLinearClip(), { start: 2, end: 1 }),
    /end time must be after start time/i,
  );
});
