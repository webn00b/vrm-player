/**
 * Tests for bvhQualityMetrics — the post-recording jitter/roughness report.
 *
 * Coverage:
 *   - parseBvhMotion: joint order + motion rows from recorder output
 *   - roughness: ~0 for smooth constant-velocity motion (even fast)
 *   - roughness: high for alternating frame jitter
 *   - hips position roughness
 *   - formatBvhQualitySummary smoke
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BvhRecorder, BVH_JOINTS } from './bvhRecorder';
import {
  parseBvhMotion,
  computeBvhQuality,
  formatBvhQualitySummary,
} from './bvhQualityMetrics';

const IDENT: [number, number, number, number] = [0, 0, 0, 1];

function quatArr(axis: THREE.Vector3, deg: number): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg));
  return [q.x, q.y, q.z, q.w];
}

function recordBvh(
  frames: number,
  getQuat: (frame: number, name: string) => [number, number, number, number],
  getHips?: (frame: number) => [number, number, number],
): string {
  const r = new BvhRecorder();
  r.start();
  for (let i = 0; i < frames; i++) {
    r.captureFrame((name) => getQuat(i, name), getHips ? () => getHips(i) : undefined);
  }
  return r.stop();
}

const Y = new THREE.Vector3(0, 1, 0);

test('parseBvhMotion: recovers joint order and rows from recorder output', () => {
  const text = recordBvh(4, () => IDENT);
  const parsed = parseBvhMotion(text)!;
  assert.ok(parsed, 'parse must succeed');
  assert.equal(parsed.jointNames.length, BVH_JOINTS.length);
  assert.equal(parsed.jointNames[0], 'hips');
  assert.equal(parsed.rows.length, 4);
  assert.equal(parsed.rows[0].length, 3 + BVH_JOINTS.length * 3);
});

test('roughness ~0 for smooth constant-velocity sweep, even a fast one', () => {
  // chest sweeps 6°/frame — fast motion but perfectly smooth.
  const text = recordBvh(30, (i, name) => name === 'chest' ? quatArr(Y, i * 6) : IDENT);
  const report = computeBvhQuality(text)!;
  const chest = report.perJoint.find((q) => q.name === 'chest')!;
  assert.ok(chest.roughnessDeg < 0.05,
    `smooth sweep must have ~0 roughness; got ${chest.roughnessDeg}`);
  assert.ok(chest.meanVelDegPerSec > 100,
    `velocity must reflect the sweep (6°/frame @30fps = 180°/s); got ${chest.meanVelDegPerSec}`);
});

test('roughness high for alternating frame jitter', () => {
  // chest alternates ±3° around 0 — classic detection jitter.
  const text = recordBvh(30, (i, name) =>
    name === 'chest' ? quatArr(Y, i % 2 === 0 ? 3 : -3) : IDENT);
  const report = computeBvhQuality(text)!;
  const chest = report.perJoint.find((q) => q.name === 'chest')!;
  assert.ok(chest.roughnessDeg > 4,
    `±3° alternation = 6° midpoint deviation; got ${chest.roughnessDeg}`);
  // Jittery chest must rank first.
  assert.equal(report.perJoint[0].name, 'chest');
});

test('overall roughness separates noisy take from clean take', () => {
  const clean = computeBvhQuality(
    recordBvh(30, (i, name) => name === 'chest' ? quatArr(Y, i) : IDENT))!;
  const noisy = computeBvhQuality(
    recordBvh(30, (i, name) => name === 'chest' ? quatArr(Y, i + (i % 2 ? 2 : -2)) : IDENT))!;
  assert.ok(noisy.overallRoughnessDeg > clean.overallRoughnessDeg * 5,
    `noisy=${noisy.overallRoughnessDeg} should dwarf clean=${clean.overallRoughnessDeg}`);
});

test('hips position roughness: smooth glide ~0, jitter high', () => {
  const smooth = computeBvhQuality(
    recordBvh(30, () => IDENT, (i) => [i * 0.01, 0.9, 0]))!;
  assert.ok(smooth.hipsPositionRoughnessMm < 0.01,
    `linear glide must have ~0 position roughness; got ${smooth.hipsPositionRoughnessMm}`);

  const jitter = computeBvhQuality(
    recordBvh(30, () => IDENT, (i) => [i % 2 ? 0.005 : -0.005, 0.9, 0]))!;
  assert.ok(jitter.hipsPositionRoughnessMm > 5,
    `±5mm alternation must show ~10mm roughness; got ${jitter.hipsPositionRoughnessMm}`);
});

test('computeBvhQuality: null for <3 frames', () => {
  assert.equal(computeBvhQuality(recordBvh(2, () => IDENT)), null);
});

test('formatBvhQualitySummary: mentions overall score and worst joint', () => {
  const text = recordBvh(30, (i, name) =>
    name === 'leftHand' ? quatArr(Y, i % 2 ? 4 : -4) : IDENT);
  const summary = formatBvhQualitySummary(computeBvhQuality(text)!);
  assert.match(summary, /roughness=/);
  assert.match(summary, /leftHand/);
});
