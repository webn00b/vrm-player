import * as THREE from 'three';

/**
 * Quaternion sign-continuity normalisation for animation tracks.
 *
 * Why this exists: any pipeline that stores per-frame quaternions computed
 * independently (Euler→quat in `THREE.BVHLoader`, matrix→quat decomposition
 * in `getWorldQuaternion`, slerpFlat at intermediate sample points, etc.)
 * can produce adjacent samples that represent the same orientation but live
 * in opposite hemispheres of the 4-sphere. THREE's `QuaternionLinearInterpolant`
 * handles this pairwise during slerp, but every downstream consumer that
 * reads raw `track.values` — validators, recorders, exporters, debug loggers,
 * the rest-pose corrector — sees the discontinuity as a real 180° flip on
 * every hemisphere crossing. Especially visible on Mixamo dance BVHs where
 * the hip Y rotation hovers around ±90° (gimbal lock pole) and the recorder
 * writes wildly different (Z, X) pairs of the same physical orientation.
 *
 * One pass per clip collapses the discontinuity for everyone downstream.
 */

type QuaternionValues = { length: number; [i: number]: number };

/**
 * Force consecutive-frame sign continuity on a flat quaternion array
 * `[x0,y0,z0,w0, x1,y1,z1,w1, ...]`: negate `q_i` when `dot(q_{i-1}, q_i) < 0`.
 * Mutates in place; returns the number of flips applied.
 *
 * Accepts both `Float32Array` (THREE.KeyframeTrack.values) and plain
 * `number[]` (per-bone scratch arrays in the FBX retargeter), so callers in
 * either flow can use the same primitive.
 */
export function normalizeQuaternionSignsInPlace(values: QuaternionValues): number {
  let flips = 0;
  for (let i = 4; i < values.length; i += 4) {
    const dot = values[i - 4] * values[i] + values[i - 3] * values[i + 1]
              + values[i - 2] * values[i + 2] + values[i - 1] * values[i + 3];
    if (dot < 0) {
      values[i]     = -values[i];
      values[i + 1] = -values[i + 1];
      values[i + 2] = -values[i + 2];
      values[i + 3] = -values[i + 3];
      flips++;
    }
  }
  return flips;
}

export interface SignFlipReport {
  totalFlips: number;
  tracksAffected: number;
  worstTrack: string;
  worstFlips: number;
}

/**
 * Apply `normalizeQuaternionSignsInPlace` to every `QuaternionKeyframeTrack`
 * on a clip. Use this AFTER any other quaternion-mutating step (rest-pose
 * correction, retargeter rewrites) so the produced clip is continuous for
 * every subsequent reader.
 */
export function normalizeQuaternionSignsAcrossClip(clip: THREE.AnimationClip): SignFlipReport {
  let totalFlips = 0;
  let tracksAffected = 0;
  let worstTrack = '';
  let worstFlips = 0;
  for (const track of clip.tracks) {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;
    const flips = normalizeQuaternionSignsInPlace(track.values);
    if (flips > 0) {
      tracksAffected++;
      totalFlips += flips;
      if (flips > worstFlips) {
        worstFlips = flips;
        worstTrack = track.name;
      }
    }
  }
  return { totalFlips, tracksAffected, worstTrack, worstFlips };
}
