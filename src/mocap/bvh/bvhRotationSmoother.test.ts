/**
 * Tests for bvhRotationSmoother — quaternion-space cleanup of recorded frames.
 *
 * Coverage:
 *   - jitter attenuation (measured via computeBvhQuality roughness)
 *   - constant-velocity motion is a fixed point (smooth sweeps untouched)
 *   - endpoints never move
 *   - hips position smoothing
 *   - profile routing (hands smoothed harder than body)
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BvhRecorder } from './bvhRecorder';
import { computeBvhQuality } from './bvhQualityMetrics';
import {
  smoothRecordedFrames,
  DEFAULT_JOINT_SMOOTHING_PROFILE,
  type JointSmoothingProfile,
} from './bvhRotationSmoother';

const IDENT: [number, number, number, number] = [0, 0, 0, 1];
const Y = new THREE.Vector3(0, 1, 0);

function quatArr(deg: number): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(deg));
  return [q.x, q.y, q.z, q.w];
}

function record(
  frames: number,
  getQuat: (frame: number, name: string) => [number, number, number, number],
  profile?: JointSmoothingProfile,
  getHips?: (frame: number) => [number, number, number],
): string {
  const r = new BvhRecorder();
  r.start();
  for (let i = 0; i < frames; i++) {
    r.captureFrame((name) => getQuat(i, name), getHips ? () => getHips(i) : undefined);
  }
  r.applyFrameTransform((fs) => smoothRecordedFrames(fs, profile));
  return r.stop();
}

test('jitter on a wrist is strongly attenuated', () => {
  const jitterQuat = (i: number, name: string) =>
    name === 'leftHand' ? quatArr(i % 2 === 0 ? 3 : -3) : IDENT;

  const raw = new BvhRecorder();
  raw.start();
  for (let i = 0; i < 30; i++) raw.captureFrame((n) => jitterQuat(i, n));
  const rawRough = computeBvhQuality(raw.stop())!
    .perJoint.find((q) => q.name === 'leftHand')!.roughnessDeg;

  const smoothedRough = computeBvhQuality(record(30, jitterQuat))!
    .perJoint.find((q) => q.name === 'leftHand')!.roughnessDeg;

  assert.ok(smoothedRough < rawRough / 5,
    `wrist jitter must drop >5×; raw=${rawRough.toFixed(2)} smoothed=${smoothedRough.toFixed(2)}`);
});

test('constant-velocity sweep passes through unchanged', () => {
  const sweep = (i: number, name: string) => name === 'chest' ? quatArr(i * 6) : IDENT;
  const text = record(30, sweep);
  const parsedRough = computeBvhQuality(text)!;
  const chest = parsedRough.perJoint.find((q) => q.name === 'chest')!;
  // Roughness was ~0 before smoothing and must stay ~0; more importantly the
  // sweep's velocity must be preserved (no amplitude loss).
  assert.ok(chest.roughnessDeg < 0.05, `sweep stays smooth; got ${chest.roughnessDeg}`);
  assert.ok(chest.meanVelDegPerSec > 170,
    `6°/frame sweep must keep ~180°/s velocity; got ${chest.meanVelDegPerSec}`);
});

test('endpoints never move', () => {
  const r = new BvhRecorder();
  r.start();
  for (let i = 0; i < 10; i++) {
    r.captureFrame((name) => name === 'leftHand' ? quatArr(i % 2 ? 10 : -10) : IDENT);
  }
  let first: [number, number, number, number] = IDENT;
  let last: [number, number, number, number] = IDENT;
  r.applyFrameTransform((frames) => {
    first = [...frames[0].bones.leftHand];
    last = [...frames[frames.length - 1].bones.leftHand];
    smoothRecordedFrames(frames);
    assert.deepEqual(frames[0].bones.leftHand, first, 'first frame untouched');
    assert.deepEqual(frames[frames.length - 1].bones.leftHand, last, 'last frame untouched');
  });
  r.stop();
});

test('hips position jitter attenuated', () => {
  const jitterPos = (i: number): [number, number, number] =>
    [i % 2 ? 0.004 : -0.004, 0.9, 0];

  const raw = new BvhRecorder();
  raw.start();
  for (let i = 0; i < 30; i++) raw.captureFrame(() => IDENT, () => jitterPos(i));
  const rawMm = computeBvhQuality(raw.stop())!.hipsPositionRoughnessMm;

  const text = record(30, () => IDENT, undefined, jitterPos);
  const smoothedMm = computeBvhQuality(text)!.hipsPositionRoughnessMm;

  assert.ok(smoothedMm < rawMm / 2,
    `hips position jitter must drop >2×; raw=${rawMm.toFixed(1)} smoothed=${smoothedMm.toFixed(1)}`);
});

test('default profile smooths hands harder than body', () => {
  const jitter = (i: number, name: string) =>
    (name === 'leftHand' || name === 'chest') ? quatArr(i % 2 ? 3 : -3) : IDENT;
  const report = computeBvhQuality(record(40, jitter, DEFAULT_JOINT_SMOOTHING_PROFILE))!;
  const hand = report.perJoint.find((q) => q.name === 'leftHand')!;
  const chest = report.perJoint.find((q) => q.name === 'chest')!;
  assert.ok(hand.roughnessDeg < chest.roughnessDeg,
    `hand (strong profile) must end up smoother than chest (light profile); ` +
    `hand=${hand.roughnessDeg.toFixed(3)} chest=${chest.roughnessDeg.toFixed(3)}`);
});

test('profile returning null leaves a joint untouched', () => {
  const jitter = (i: number, name: string) => name === 'head' ? quatArr(i % 2 ? 5 : -5) : IDENT;
  const noTouch: JointSmoothingProfile = () => null;
  const text = record(20, jitter, noTouch);
  const head = computeBvhQuality(text)!.perJoint.find((q) => q.name === 'head')!;
  assert.ok(head.roughnessDeg > 8, `null profile must skip smoothing; got ${head.roughnessDeg}`);
});
