import type { HandFrame, Landmark3D, PoseFrame } from './poseDetector';

/**
 * Offline (non-causal) landmark smoothing for video-file mocap.
 *
 * The live path uses causal filters (1€ + step-clamping stabilizer) because it
 * only knows the past. A video file is fully known, so we can do strictly
 * better: zero-phase filtering with no lag at all.
 *
 * Per landmark group (body norm/world, each hand norm/world, face):
 *   1. Gap fill — detection dropouts up to `maxGapFrames` are linearly
 *      interpolated between the surrounding valid frames. Longer gaps stay
 *      missing (the capture loop then repeats the last applied pose, matching
 *      live behaviour).
 *   2. Median-of-3 prefilter — kills single-frame detection spikes that a
 *      linear low-pass would smear into neighbouring frames.
 *   3. Zero-phase 2nd-order Butterworth low-pass (forward + backward pass,
 *      odd-reflection edge padding) — smooths jitter with zero phase lag.
 *
 * Filtering never crosses a missing region: each contiguous run of valid
 * frames is processed independently.
 */

export interface OfflineSmoothOptions {
  /** Capture rate of the frame sequence (Hz). */
  fps: number;
  /** Body landmark low-pass cutoff (Hz). Default 6 — keeps fast limb motion. */
  bodyCutoffHz?: number;
  /**
   * Hand landmark cutoff (Hz). Default 3 — hand landmarks are much noisier
   * than body, and the palm-orientation solve amplifies landmark noise into
   * large wrist swings. Matches the live path's near-static 1€ tuning
   * (beta=0.003) in spirit while keeping zero lag.
   */
  handCutoffHz?: number;
  /** Face landmark cutoff (Hz). Default 3.5 — micro-expressions are slow. */
  faceCutoffHz?: number;
  /** Max dropout length (frames) to bridge by interpolation. Default 10 (~0.33s @30fps). */
  maxGapFrames?: number;
  /** Body landmark visibility below which a sample is treated as a noisy guess
   *  and interpolated from confident neighbours. Default 0.5; 0 disables. */
  bodyConfidenceGate?: number;
}

const DEFAULT_BODY_CUTOFF_HZ = 6;
const DEFAULT_HAND_CUTOFF_HZ = 3;
const DEFAULT_FACE_CUTOFF_HZ = 3.5;
const DEFAULT_MAX_GAP_FRAMES = 10;
const DEFAULT_BODY_CONFIDENCE_GATE = 0.5;

/** Segments shorter than this are left unfiltered (not enough support). */
const MIN_FILTER_SEGMENT = 9;

type LandmarkSeries = (Landmark3D[] | null)[];

/**
 * Smooth a fixed-FPS sequence of raw (unfiltered) pose frames.
 * `frames[i] === null` means no pose was detected at frame i.
 * Returns a new array; input frames are not mutated.
 */
export function smoothMocapFrames(
  frames: (PoseFrame | null)[],
  options: OfflineSmoothOptions,
): (PoseFrame | null)[] {
  const fps = options.fps;
  const bodyCutoff = options.bodyCutoffHz ?? DEFAULT_BODY_CUTOFF_HZ;
  const handCutoff = options.handCutoffHz ?? DEFAULT_HAND_CUTOFF_HZ;
  const faceCutoff = options.faceCutoffHz ?? DEFAULT_FACE_CUTOFF_HZ;
  const maxGap = options.maxGapFrames ?? DEFAULT_MAX_GAP_FRAMES;
  const bodyGate = options.bodyConfidenceGate ?? DEFAULT_BODY_CONFIDENCE_GATE;

  const pick = <T>(get: (f: PoseFrame) => T[] | undefined): LandmarkSeries =>
    frames.map((f) => {
      const arr = f ? get(f) : undefined;
      return arr && arr.length ? (arr as Landmark3D[]) : null;
    });

  const bodyNorm  = smoothSeries(pick((f) => f.landmarks),      fps, bodyCutoff, maxGap, bodyGate);
  const bodyWorld = smoothSeries(pick((f) => f.worldLandmarks), fps, bodyCutoff, maxGap, bodyGate);
  const face      = smoothSeries(pick((f) => f.faceLandmarks),  fps, faceCutoff, maxGap);

  const hand = (side: 'Left' | 'Right') => ({
    norm: smoothSeries(
      pick((f) => f.hands.find((h) => h.side === side)?.landmarks),
      fps, handCutoff, maxGap,
    ),
    world: smoothSeries(
      pick((f) => f.hands.find((h) => h.side === side)?.worldLandmarks),
      fps, handCutoff, maxGap,
    ),
  });
  const left = hand('Left');
  const right = hand('Right');

  const out: (PoseFrame | null)[] = new Array(frames.length).fill(null);
  for (let i = 0; i < frames.length; i++) {
    const norm = bodyNorm[i];
    const world = bodyWorld[i];
    if (!norm || !world) continue;

    const hands: HandFrame[] = [];
    if (left.norm[i]) {
      hands.push({ side: 'Left', landmarks: left.norm[i]!, worldLandmarks: left.world[i] ?? [] });
    }
    if (right.norm[i]) {
      hands.push({ side: 'Right', landmarks: right.norm[i]!, worldLandmarks: right.world[i] ?? [] });
    }

    out[i] = {
      landmarks: norm,
      worldLandmarks: world,
      faceLandmarks: face[i] ?? [],
      hands,
    };
  }
  return out;
}

// ── Series processing ─────────────────────────────────────────────────────────

/**
 * Gap-fill + smooth one landmark group. Returns new landmark arrays; frames
 * still missing after gap fill stay null.
 */
export function smoothSeries(
  series: LandmarkSeries,
  fps: number,
  cutoffHz: number,
  maxGapFrames: number,
  confidenceGate = 0,
): LandmarkSeries {
  const n = series.length;
  if (n === 0) return [];

  // Work on copies so the caller's frames stay untouched.
  const work: LandmarkSeries = series.map(
    (lms) => lms?.map((lm) => ({ ...lm })) ?? null,
  );

  fillGaps(work, maxGapFrames);
  repairLowConfidence(work, confidenceGate, maxGapFrames);

  // Filter each contiguous valid run independently.
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const valid = i < n && work[i] !== null;
    if (valid && runStart < 0) runStart = i;
    if (!valid && runStart >= 0) {
      filterRun(work, runStart, i, fps, cutoffHz);
      runStart = -1;
    }
  }
  return work;
}

/**
 * Per-landmark confidence repair: a present-but-low-visibility sample is a
 * noisy guess, not data. For each landmark, overwrite its xyz on frames where
 * visibility < gate by linearly interpolating from the nearest CONFIDENT
 * frames (within maxGapFrames), so uncertain detections don't feed the filter.
 * Runs of low confidence longer than the gap are left as-is. gate 0 = off.
 */
function repairLowConfidence(work: LandmarkSeries, gate: number, maxGapFrames: number): void {
  if (gate <= 0) return;
  const n = work.length;
  // Landmark count from the first present frame.
  const sample = work.find((f) => f !== null);
  if (!sample) return;
  const k = sample.length;
  const confident = (lm: Landmark3D | undefined): boolean =>
    !!lm && (lm.visibility === undefined || lm.visibility >= gate);

  for (let j = 0; j < k; j++) {
    let prevConf = -1;
    for (let i = 0; i < n; i++) {
      const f = work[i];
      if (!f) { prevConf = -1; continue; } // missing frame breaks the run
      if (confident(f[j])) {
        const gap = i - prevConf - 1;
        if (prevConf >= 0 && gap > 0 && gap <= maxGapFrames) {
          const a = work[prevConf]![j], b = f[j];
          for (let g = 1; g <= gap; g++) {
            const mid = work[prevConf + g];
            if (!mid) continue;
            const t = g / (gap + 1);
            mid[j].x = a.x + (b.x - a.x) * t;
            mid[j].y = a.y + (b.y - a.y) * t;
            mid[j].z = a.z + (b.z - a.z) * t;
          }
        }
        prevConf = i;
      }
    }
  }
}

/** Linearly interpolate dropouts of ≤ maxGapFrames between valid neighbours. */
function fillGaps(work: LandmarkSeries, maxGapFrames: number): void {
  const n = work.length;
  let prevValid = -1;
  for (let i = 0; i < n; i++) {
    if (work[i] === null) continue;
    const gap = i - prevValid - 1;
    if (prevValid >= 0 && gap > 0 && gap <= maxGapFrames) {
      const a = work[prevValid]!;
      const b = work[i]!;
      if (a.length === b.length) {
        for (let g = 1; g <= gap; g++) {
          const t = g / (gap + 1);
          work[prevValid + g] = a.map((la, k) => lerpLandmark(la, b[k], t));
        }
      }
    }
    prevValid = i;
  }
}

function lerpLandmark(a: Landmark3D, b: Landmark3D, t: number): Landmark3D {
  const lm: Landmark3D = {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
  if (a.visibility !== undefined && b.visibility !== undefined) {
    lm.visibility = a.visibility + (b.visibility - a.visibility) * t;
  }
  return lm;
}

/** Median-of-3 + zero-phase Butterworth over frames [start, end) per channel. */
function filterRun(
  work: LandmarkSeries,
  start: number,
  end: number,
  fps: number,
  cutoffHz: number,
): void {
  const len = end - start;
  if (len < 3) return;
  const count = work[start]!.length;
  // Landmark count must be stable across the run (it is, per MediaPipe group).
  for (let i = start; i < end; i++) {
    if (work[i]!.length !== count) return;
  }

  const channel = new Array<number>(len);
  const axes = ['x', 'y', 'z'] as const;
  for (let k = 0; k < count; k++) {
    for (const axis of axes) {
      for (let i = 0; i < len; i++) channel[i] = work[start + i]![k][axis];
      median3InPlace(channel);
      const smoothed = len >= MIN_FILTER_SEGMENT ? filtfilt(channel, fps, cutoffHz) : channel;
      for (let i = 0; i < len; i++) work[start + i]![k][axis] = smoothed[i];
    }
  }
}

// ── Filters ───────────────────────────────────────────────────────────────────

/** In-place median-of-3 (endpoints kept). Removes single-frame spikes. */
export function median3InPlace(xs: number[]): void {
  if (xs.length < 3) return;
  let prev = xs[0];
  for (let i = 1; i < xs.length - 1; i++) {
    const a = prev;
    const b = xs[i];
    const c = xs[i + 1];
    prev = b;
    xs[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
}

interface BiquadCoeffs { b0: number; b1: number; b2: number; a1: number; a2: number }

/** 2nd-order Butterworth low-pass coefficients (bilinear transform). */
function butterworthLowpass(fs: number, fc: number): BiquadCoeffs {
  // Clamp cutoff below Nyquist to keep tan() sane.
  const f = Math.min(fc, fs * 0.45);
  const c = 1 / Math.tan((Math.PI * f) / fs);
  const c2 = c * c;
  const sqrt2c = Math.SQRT2 * c;
  const norm = 1 / (1 + sqrt2c + c2);
  return {
    b0: norm,
    b1: 2 * norm,
    b2: norm,
    a1: 2 * norm * (1 - c2),
    a2: norm * (1 - sqrt2c + c2),
  };
}

function biquadForward(xs: number[], k: BiquadCoeffs): number[] {
  const ys = new Array<number>(xs.length);
  let x1 = xs[0], x2 = xs[0];
  let y1 = xs[0], y2 = xs[0]; // steady-state init at first sample
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = k.b0 * x + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    ys[i] = y;
  }
  return ys;
}

/**
 * Zero-phase low-pass: forward + backward Butterworth pass with odd-reflection
 * edge padding. No phase lag — the smoothed curve stays centred on the motion.
 */
export function filtfilt(xs: number[], fs: number, fc: number): number[] {
  const n = xs.length;
  if (n < MIN_FILTER_SEGMENT) return xs.slice();
  const k = butterworthLowpass(fs, fc);

  const pad = Math.min(n - 1, Math.ceil((3 * fs) / fc));
  const ext = new Array<number>(n + 2 * pad);
  // Odd reflection: 2*edge − mirrored sample, preserves slope at the edges.
  for (let i = 0; i < pad; i++) ext[i] = 2 * xs[0] - xs[pad - i];
  for (let i = 0; i < n; i++) ext[pad + i] = xs[i];
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * xs[n - 1] - xs[n - 2 - i];

  const fwd = biquadForward(ext, k);
  fwd.reverse();
  const back = biquadForward(fwd, k);
  back.reverse();

  return back.slice(pad, pad + n);
}
