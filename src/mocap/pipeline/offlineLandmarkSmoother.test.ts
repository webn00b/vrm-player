/**
 * Tests for offlineLandmarkSmoother — the zero-phase smoothing pass used by
 * two-pass video-file mocap.
 *
 * Coverage:
 *   - filtfilt: noise attenuation, zero phase lag, DC preservation
 *   - median3InPlace: single-frame spike removal
 *   - smoothSeries: gap fill (short gaps bridged, long gaps left missing)
 *   - smoothMocapFrames: frame reconstruction (body/face/hands presence)
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  filtfilt,
  median3InPlace,
  smoothSeries,
  smoothMocapFrames,
} from './offlineLandmarkSmoother';
import type { Landmark3D, PoseFrame } from './poseDetector';

const FPS = 30;

function lm(x: number, y = 0, z = 0, visibility = 1): Landmark3D {
  return { x, y, z, visibility };
}

function bodyFrame(x: number, hands: PoseFrame['hands'] = []): PoseFrame {
  return {
    landmarks:      Array.from({ length: 33 }, () => lm(x)),
    worldLandmarks: Array.from({ length: 33 }, () => lm(x)),
    faceLandmarks:  [],
    hands,
  };
}

// ── filtfilt ────────────────────────────────────────────────────────────

test('filtfilt: preserves a constant signal', () => {
  const xs = new Array(60).fill(0.5);
  const ys = filtfilt(xs, FPS, 6);
  for (const y of ys) assert.ok(Math.abs(y - 0.5) < 1e-9, `constant must pass through; got ${y}`);
});

test('filtfilt: attenuates high-frequency noise on a slow sine', () => {
  const n = 120;
  const clean: number[] = [];
  const noisy: number[] = [];
  // Deterministic pseudo-noise at Nyquist-ish frequency.
  for (let i = 0; i < n; i++) {
    const c = Math.sin((2 * Math.PI * 1 * i) / FPS); // 1 Hz motion
    clean.push(c);
    noisy.push(c + 0.05 * (i % 2 === 0 ? 1 : -1));   // 15 Hz square noise
  }
  const ys = filtfilt(noisy, FPS, 6);
  let errNoisy = 0;
  let errSmooth = 0;
  for (let i = 0; i < n; i++) {
    errNoisy += (noisy[i] - clean[i]) ** 2;
    errSmooth += (ys[i] - clean[i]) ** 2;
  }
  assert.ok(errSmooth < errNoisy / 10,
    `smoothing should cut noise energy >10×; noisy=${errNoisy.toFixed(4)} smooth=${errSmooth.toFixed(4)}`);
});

test('filtfilt: zero phase lag — pulse peak stays in place', () => {
  // Single Gaussian bump at i=45: a causal filter would shift it right,
  // a zero-phase filter must keep the peak centred.
  const n = 90;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(Math.exp(-((i - 45) ** 2) / (2 * 6 ** 2)));
  const ys = filtfilt(xs, FPS, 6);
  const argmax = (arr: number[], lo: number, hi: number): number => {
    let best = lo;
    for (let i = lo; i < hi; i++) if (arr[i] > arr[best]) best = i;
    return best;
  };
  const peakIn  = argmax(xs, 10, n - 10);
  const peakOut = argmax(ys, 10, n - 10);
  assert.ok(Math.abs(peakIn - peakOut) <= 1,
    `zero-phase filter must not shift the peak; in=${peakIn} out=${peakOut}`);
});

test('filtfilt: short segments returned unchanged', () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = filtfilt(xs, FPS, 6);
  assert.deepEqual(ys, xs, 'segments below minimum length pass through');
});

// ── median3InPlace ──────────────────────────────────────────────────────

test('median3InPlace: removes a single-frame spike', () => {
  const xs = [0, 0, 0, 10, 0, 0, 0];
  median3InPlace(xs);
  assert.equal(xs[3], 0, 'spike must be removed');
  assert.deepEqual(xs, [0, 0, 0, 0, 0, 0, 0]);
});

test('median3InPlace: preserves a step edge', () => {
  const xs = [0, 0, 0, 1, 1, 1];
  median3InPlace(xs);
  assert.deepEqual(xs, [0, 0, 0, 1, 1, 1], 'monotone step must survive');
});

// ── smoothSeries: gap fill ──────────────────────────────────────────────

test('smoothSeries: short gaps are linearly interpolated', () => {
  const series: (Landmark3D[] | null)[] = [];
  for (let i = 0; i < 30; i++) series.push([lm(i)]);
  series[10] = null;
  series[11] = null;
  const out = smoothSeries(series, FPS, 6, 10);
  assert.ok(out[10] && out[11], 'gap frames must be filled');
  assert.ok(Math.abs(out[10]![0].x - 10) < 0.5, `interp ≈10; got ${out[10]![0].x}`);
  assert.ok(Math.abs(out[11]![0].x - 11) < 0.5, `interp ≈11; got ${out[11]![0].x}`);
});

test('smoothSeries: gaps longer than maxGapFrames stay missing', () => {
  const series: (Landmark3D[] | null)[] = [];
  for (let i = 0; i < 40; i++) series.push(i >= 10 && i < 25 ? null : [lm(i)]);
  const out = smoothSeries(series, FPS, 6, 10);
  for (let i = 10; i < 25; i++) assert.equal(out[i], null, `frame ${i} must stay missing`);
});

test('smoothSeries: leading/trailing missing frames stay missing', () => {
  const series: (Landmark3D[] | null)[] = [null, null, [lm(1)], [lm(2)], [lm(3)], null];
  const out = smoothSeries(series, FPS, 6, 10);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[5], null);
  assert.ok(out[2] && out[3] && out[4], 'valid frames preserved');
});

test('smoothSeries: does not mutate input landmarks', () => {
  const series: (Landmark3D[] | null)[] = [];
  for (let i = 0; i < 30; i++) series.push([lm(i % 2 === 0 ? 0 : 0.1)]);
  const before = series[5]![0].x;
  smoothSeries(series, FPS, 6, 10);
  assert.equal(series[5]![0].x, before, 'input must stay untouched');
});

// ── smoothMocapFrames ───────────────────────────────────────────────────

test('smoothMocapFrames: null body frames beyond gap limit stay null', () => {
  const frames: (PoseFrame | null)[] = [];
  for (let i = 0; i < 60; i++) frames.push(i >= 20 && i < 45 ? null : bodyFrame(0.5));
  const out = smoothMocapFrames(frames, { fps: FPS });
  assert.equal(out[30], null, 'long dropout must remain null');
  assert.ok(out[10], 'valid frame survives');
});

test('smoothMocapFrames: hands are carried per side', () => {
  const frames: (PoseFrame | null)[] = [];
  for (let i = 0; i < 30; i++) {
    frames.push(bodyFrame(0.5, [
      { side: 'Left', landmarks: Array.from({ length: 21 }, () => lm(0.3)), worldLandmarks: [] },
    ]));
  }
  const out = smoothMocapFrames(frames, { fps: FPS });
  const f = out[15]!;
  assert.equal(f.hands.length, 1, 'one hand expected');
  assert.equal(f.hands[0].side, 'Left');
  assert.ok(Math.abs(f.hands[0].landmarks[0].x - 0.3) < 1e-6);
});

test('smoothMocapFrames: smooths jittery body landmarks', () => {
  const frames: (PoseFrame | null)[] = [];
  for (let i = 0; i < 90; i++) {
    const jitter = 0.02 * (i % 2 === 0 ? 1 : -1);
    frames.push(bodyFrame(0.5 + jitter));
  }
  const out = smoothMocapFrames(frames, { fps: FPS });
  // Interior frames should sit near 0.5 with jitter heavily attenuated.
  for (let i = 20; i < 70; i++) {
    const x = out[i]!.worldLandmarks[0].x;
    assert.ok(Math.abs(x - 0.5) < 0.005, `frame ${i}: jitter must be attenuated; got ${x}`);
  }
});

test('confidence repair: sustained low-visibility run interpolated from confident neighbours', () => {
  const mk = (x: number, vis: number): Landmark3D[] => [{ x, y: 0, z: 0, visibility: vis }];
  // 2-frame low-vis deviation (median-of-3 can't clean a 2-wide block, so this
  // isolates the confidence-repair path). 4 frames < filter minimum, no filtfilt.
  const series: (Landmark3D[] | null)[] = [
    mk(0.50, 1), mk(0.90, 0.2), mk(0.90, 0.2), mk(0.50, 1),
  ];
  const out = smoothSeries(series, FPS, 6, 10, 0.5);
  assert.ok(Math.abs(out[1]![0].x - 0.5) < 0.05, `low-vis run repaired to ~0.5; got ${out[1]![0].x}`);
  assert.ok(Math.abs(out[2]![0].x - 0.5) < 0.05, `low-vis run repaired to ~0.5; got ${out[2]![0].x}`);
});

test('confidence repair: gate 0 leaves a low-vis run untouched', () => {
  const mk = (x: number, vis: number): Landmark3D[] => [{ x, y: 0, z: 0, visibility: vis }];
  const series: (Landmark3D[] | null)[] = [
    mk(0.50, 1), mk(0.90, 0.2), mk(0.90, 0.2), mk(0.50, 1),
  ];
  const out = smoothSeries(series, FPS, 6, 10, 0);
  assert.ok(Math.abs(out[1]![0].x - 0.9) < 1e-9, 'gate 0 keeps the raw low-vis sample');
});
