import type { PoseFrame } from './poseDetector';

/**
 * Auto-trim idle/empty head and tail of a captured sequence.
 *
 * Clips usually open and close with dead air: the performer not yet in frame,
 * walking in, settling into a rest/T-pose, then holding still at the end. None
 * of that is wanted in the recorded animation. We trim the leading and
 * trailing frames whose motion energy is below a fraction of the clip's own
 * median — so a genuinely active clip keeps everything, while static bookends
 * are dropped. Only the ENDS are trimmed; a mid-clip pause is preserved.
 */

const MOTION_LANDMARKS = [
  11, 12, 13, 14, 15, 16, // shoulders, elbows, wrists
  23, 24, 25, 26, 27, 28, // hips, knees, ankles
  0,                       // nose (head motion)
];

export interface TrimRange {
  start: number;
  end: number; // exclusive
}

/** Per-frame motion energy = mean landmark displacement from the previous
 *  detected frame (normalized image units). 0 for the first/undetected. */
export function motionEnergy(frames: (PoseFrame | null)[]): number[] {
  const energy = new Array(frames.length).fill(0);
  let prev: PoseFrame | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f) { prev = null; continue; }
    if (prev) {
      let sum = 0, count = 0;
      for (const idx of MOTION_LANDMARKS) {
        const a = f.landmarks[idx], b = prev.landmarks[idx];
        if (!a || !b) continue;
        sum += Math.hypot(a.x - b.x, a.y - b.y);
        count++;
      }
      energy[i] = count ? sum / count : 0;
    }
    prev = f;
  }
  return energy;
}

export interface AutoTrimOptions {
  /** Active-frame threshold as a fraction of the clip's median motion. */
  activeFraction?: number;
  /** Never trim if it would leave fewer than this many frames. */
  minKeepFrames?: number;
  /** Keep this many frames of lead-in/out around the active span (context). */
  padFrames?: number;
}

/**
 * Find the [start, end) range to keep: from the first to the last frame whose
 * motion energy exceeds activeFraction × median(non-zero energy), padded.
 * Returns the full range when the clip is too short or uniformly active.
 */
export function autoTrimRange(
  frames: (PoseFrame | null)[],
  options: AutoTrimOptions = {},
): TrimRange {
  const activeFraction = options.activeFraction ?? 0.15;
  const minKeep = options.minKeepFrames ?? 30;
  const pad = options.padFrames ?? 6;
  const n = frames.length;
  if (n <= minKeep) return { start: 0, end: n };

  const energy = motionEnergy(frames);
  const nonzero = energy.filter((e) => e > 0).sort((a, b) => a - b);
  if (nonzero.length < minKeep) return { start: 0, end: n };
  const median = nonzero[nonzero.length >> 1];
  const threshold = median * activeFraction;

  let first = energy.findIndex((e) => e > threshold);
  let last = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (energy[i] > threshold) { last = i; break; }
  }
  if (first < 0 || last < 0 || last < first) return { start: 0, end: n };

  const start = Math.max(0, first - pad);
  const end = Math.min(n, last + 1 + pad);
  if (end - start < minKeep) return { start: 0, end: n };
  return { start, end };
}
