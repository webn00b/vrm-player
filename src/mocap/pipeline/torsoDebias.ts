import type { PoseFrame } from './poseDetector';

/**
 * Per-sequence torso depth de-bias for the offline two-pass pipeline.
 *
 * MediaPipe + the 3D lifter place the shoulders a systematic ~12 deg BEHIND
 * the hips in depth even when the performer stands perfectly straight (a
 * standing talker and a forward-bowing dancer both measure ~-13 deg torso
 * lean — the constant bias dwarfs the real, depth-flattened lean). Believed
 * verbatim by the trusted retarget, that bias tips the avatar backward and
 * swings the shoulder-anchored arms back with it.
 *
 * Offline we see the whole clip, so we can find the neutral: the MEDIAN torso
 * lean over the sequence is the performer's habitual upright pose. Rotating
 * the upper body about the hip centre by minus that median removes the bias
 * while preserving every per-frame deviation (a genuine bow still bows). Both
 * the hips-orientation and spine solvers read the corrected landmarks, so the
 * fix lands everywhere at once.
 */

const LEFT_SHOULDER = 11, RIGHT_SHOULDER = 12, LEFT_HIP = 23, RIGHT_HIP = 24;
// Upper-body landmarks rotated about the hip centre (arms move with the torso).
const UPPER_BODY = [
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, // shoulders, arms, hands
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,               // head / face anchors
];
// Below this median tilt there's nothing worth correcting.
const MIN_BIAS_RAD = (3 * Math.PI) / 180;

function mid(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/**
 * Forward-lean pitch of the torso (midShoulder→midHip) in the y-z plane of
 * MediaPipe world space. Positive = shoulders toward +z relative to hips.
 */
function frameTorsoLean(frame: PoseFrame): number | null {
  const w = frame.worldLandmarks;
  const ls = w[LEFT_SHOULDER], rs = w[RIGHT_SHOULDER], lh = w[LEFT_HIP], rh = w[RIGHT_HIP];
  if (!ls || !rs || !lh || !rh) return null;
  const sh = mid(ls, rs), hip = mid(lh, rh);
  const dy = sh.y - hip.y;
  const dz = sh.z - hip.z;
  // atan2(z, -y): MediaPipe y points down, so -y is "up".
  return Math.atan2(dz, -dy);
}

/** Median torso lean (rad) over valid frames, or null if none. */
export function medianTorsoLean(frames: (PoseFrame | null)[]): number | null {
  const leans: number[] = [];
  for (const f of frames) {
    if (!f) continue;
    const l = frameTorsoLean(f);
    if (l !== null) leans.push(l);
  }
  if (!leans.length) return null;
  leans.sort((a, b) => a - b);
  return leans[leans.length >> 1];
}

/**
 * Remove the per-sequence median torso lean in place. Rotates the upper-body
 * world landmarks of every frame about the hip centre by `-bias` in the y-z
 * plane. Returns the applied bias (rad; 0 when skipped).
 */
export function debiasTorsoLean(frames: (PoseFrame | null)[]): number {
  const bias = medianTorsoLean(frames);
  if (bias === null || Math.abs(bias) < MIN_BIAS_RAD) return 0;

  // Rotation about the hip centre that maps a frame whose lean equals `bias`
  // back to vertical. Derived in the (up = -y, fwd = z) plane and converted
  // to raw MediaPipe axes (y down): see torsoDebias.test for the fixed point.
  const c = Math.cos(bias);
  const s = Math.sin(bias);

  for (const f of frames) {
    if (!f) continue;
    const w = f.worldLandmarks;
    const lh = w[LEFT_HIP], rh = w[RIGHT_HIP];
    if (!lh || !rh) continue;
    const hipY = (lh.y + rh.y) / 2;
    const hipZ = (lh.z + rh.z) / 2;
    for (const idx of UPPER_BODY) {
      const lm = w[idx];
      if (!lm) continue;
      const dy = lm.y - hipY;
      const dz = lm.z - hipZ;
      lm.y = hipY + c * dy - s * dz;
      lm.z = hipZ + s * dy + c * dz;
    }
  }
  return bias;
}
