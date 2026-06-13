import * as THREE from 'three';
import type { RecordedFrame } from './bvhRecorder';

/**
 * Post-capture rotation smoothing in quaternion space.
 *
 * Landmark-level smoothing (offlineLandmarkSmoother) cannot fully clean the
 * wrists: the palm-orientation solve is nonlinear and amplifies residual
 * landmark noise into large rotation swings. This pass runs AFTER the solve,
 * directly on the recorded bone quaternions, where that amplified noise is
 * visible and removable.
 *
 * Algorithm: iterated slerp-laplacian. Each iteration moves every interior
 * frame toward the slerp midpoint of its neighbours:
 *
 *   q_i ← slerp(q_i, slerp(q_{i-1}, q_{i+1}, 0.5), alpha)
 *
 * Constant-angular-velocity motion is a fixed point (the midpoint equals q_i),
 * so smooth motion — however fast — passes through unchanged; only deviation
 * from local linearity (jitter) is removed. Endpoints are never moved.
 */

export interface JointSmoothingParams {
  /** Number of laplacian iterations. More = stronger low-pass. */
  iterations: number;
  /** Blend toward the neighbour midpoint per iteration, 0..1. */
  alpha: number;
}

export type JointSmoothingProfile = (jointName: string) => JointSmoothingParams | null;

/**
 * Default profile tuned from AIST A/B runs: wrists dominate the roughness
 * ranking (palm solve noise), fingers next (KalidoKit), body needs only a
 * light touch since landmark smoothing already cleaned it.
 */
export const DEFAULT_JOINT_SMOOTHING_PROFILE: JointSmoothingProfile = (name) => {
  if (name === 'leftHand' || name === 'rightHand') return { iterations: 3, alpha: 0.6 };
  if (/Thumb|Index|Middle|Ring|Little/.test(name)) return { iterations: 3, alpha: 0.5 };
  return { iterations: 1, alpha: 0.3 };
};

/** Hips position smoothing strength (same laplacian, in linear space). */
const HIPS_POSITION_PARAMS: JointSmoothingParams = { iterations: 1, alpha: 0.3 };

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qm = new THREE.Quaternion();

/**
 * Smooth recorded frames in place. `frames` is the BvhRecorder buffer;
 * every joint present in the frames is smoothed per the profile.
 */
export function smoothRecordedFrames(
  frames: RecordedFrame[],
  profile: JointSmoothingProfile = DEFAULT_JOINT_SMOOTHING_PROFILE,
): void {
  if (frames.length < 3) return;

  const jointNames = Object.keys(frames[0].bones);
  for (const name of jointNames) {
    const params = profile(name);
    if (!params || params.iterations <= 0 || params.alpha <= 0) continue;
    smoothJoint(frames, name, params);
  }
  smoothHipsPosition(frames, HIPS_POSITION_PARAMS);
}

// Isolated-flip threshold: a frame this far (deg) from BOTH neighbours while
// the neighbours agree is a detection glitch (e.g. wrist/finger 112° pop), not
// motion — replace it with the neighbour midpoint. Laplacian only blurs such
// spikes; this removes them.
const FLIP_REJECT_DEG = 45;

function angleDeg(a: THREE.Quaternion, b: THREE.Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180 / Math.PI;
}

function smoothJoint(frames: RecordedFrame[], name: string, params: JointSmoothingParams): void {
  const n = frames.length;
  // Double-buffer per iteration so each pass reads consistent neighbours.
  let curr: [number, number, number, number][] = frames.map(
    (f) => f.bones[name] ?? [0, 0, 0, 1],
  );

  // Outlier rejection first: kill isolated flips before the laplacian.
  for (let i = 1; i < n - 1; i++) {
    _qa.fromArray(curr[i - 1]);
    _qb.fromArray(curr[i]);
    _qc.fromArray(curr[i + 1]);
    if (angleDeg(_qb, _qa) > FLIP_REJECT_DEG &&
        angleDeg(_qb, _qc) > FLIP_REJECT_DEG &&
        angleDeg(_qa, _qc) < FLIP_REJECT_DEG) {
      _qa.slerp(_qc, 0.5);
      curr[i] = [_qa.x, _qa.y, _qa.z, _qa.w];
    }
  }

  for (let it = 0; it < params.iterations; it++) {
    const next = curr.slice();
    for (let i = 1; i < n - 1; i++) {
      _qa.fromArray(curr[i - 1]);
      _qb.fromArray(curr[i]);
      _qc.fromArray(curr[i + 1]);
      _qm.copy(_qa).slerp(_qc, 0.5);
      _qb.slerp(_qm, params.alpha);
      next[i] = [_qb.x, _qb.y, _qb.z, _qb.w];
    }
    curr = next;
  }

  for (let i = 0; i < n; i++) {
    if (frames[i].bones[name]) frames[i].bones[name] = curr[i];
  }
}

function smoothHipsPosition(frames: RecordedFrame[], params: JointSmoothingParams): void {
  const n = frames.length;
  if (frames.some((f) => !f.hipsPos)) return;

  let curr: [number, number, number][] = frames.map((f) => f.hipsPos!);
  for (let it = 0; it < params.iterations; it++) {
    const next = curr.slice();
    for (let i = 1; i < n - 1; i++) {
      const p = curr[i];
      const mid: [number, number, number] = [
        (curr[i - 1][0] + curr[i + 1][0]) / 2,
        (curr[i - 1][1] + curr[i + 1][1]) / 2,
        (curr[i - 1][2] + curr[i + 1][2]) / 2,
      ];
      next[i] = [
        p[0] + (mid[0] - p[0]) * params.alpha,
        p[1] + (mid[1] - p[1]) * params.alpha,
        p[2] + (mid[2] - p[2]) * params.alpha,
      ];
    }
    curr = next;
  }
  for (let i = 0; i < n; i++) frames[i].hipsPos = curr[i];
}
