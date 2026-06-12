/**
 * Pure math for adapting a source skeleton's hips translation to a target
 * avatar's proportions.
 *
 * Both clip importers (BVH and FBX) reduce "the source body is a different
 * size than the avatar" to one number: the ratio of rest hips heights.
 * Scaling every hips translation keyframe by that ratio maps the source's
 * vertical bob, squat depth, jump height AND horizontal stride into the
 * avatar's space — a uniform similarity transform of the root motion.
 *
 * The ratio is unit-agnostic: as long as `sourceHipsY` is measured in the
 * same space as the keyframe values being scaled (e.g. centimeter-based FBX
 * tracks vs a meter-based avatar), the scaled values land in avatar units.
 */
export interface HipsAdaptation {
  /** Multiplier for hips translation keyframes (avatar / source). */
  scale: number;
  sourceHipsY: number;
  avatarHipsY: number;
  /**
   * False when the source rest height is unmeasurable or the ratio is
   * implausible (unit mismatch) — callers must leave the track untouched.
   */
  applied: boolean;
}

/** Below this rest height the source is considered grounded/degenerate. */
export const MIN_HIPS_REST = 0.05;
/**
 * Sanity band only — wide enough for legitimate unit conversion (a cm-based
 * Mixamo FBX driving a meter-based avatar gives scale ≈ 0.009), rejecting
 * only clearly broken measurements.
 */
export const MIN_HIPS_SCALE = 1e-4;
export const MAX_HIPS_SCALE = 1e4;
/**
 * Ratios this close to 1 are measurement noise, not a body-size difference —
 * skip to keep self-recorded round-trips bit-exact. 0.1%: well above the
 * float noise of 6-decimal BVH text offsets, well below any real proportions
 * mismatch worth adapting.
 */
export const HIPS_SCALE_IDENTITY_EPS = 1e-3;

export function computeHipsAdaptation(
  sourceHipsY: number,
  avatarHipsY: number,
): HipsAdaptation {
  const invalid: HipsAdaptation = { scale: 1, sourceHipsY, avatarHipsY, applied: false };
  if (!Number.isFinite(sourceHipsY) || !Number.isFinite(avatarHipsY)) return invalid;
  if (sourceHipsY <= MIN_HIPS_REST || avatarHipsY <= MIN_HIPS_REST) return invalid;

  const scale = avatarHipsY / sourceHipsY;
  if (scale < MIN_HIPS_SCALE || scale > MAX_HIPS_SCALE) return invalid;
  if (Math.abs(scale - 1) < HIPS_SCALE_IDENTITY_EPS) {
    return { scale: 1, sourceHipsY, avatarHipsY, applied: false };
  }
  return { scale, sourceHipsY, avatarHipsY, applied: true };
}

/** Scale keyframe values in place. */
export function scaleTrackValuesInPlace(
  values: Float32Array | number[],
  scale: number,
): void {
  for (let i = 0; i < values.length; i++) values[i] *= scale;
}

interface BoneLike {
  position: { multiplyScalar(s: number): unknown; y: number };
  traverse(cb: (bone: BoneLike) => void): void;
  updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void;
}

interface HipsBoneLike {
  getWorldPosition(target: { y: number }): { y: number };
}

/**
 * Adapt a source skeleton (and its hips/spine translation tracks) to the
 * avatar's rest hips height, in place. Used by the BVH→VRMA converter.
 *
 * Two steps:
 *  1. Uniform similarity transform: every bone offset and every translation
 *     keyframe × `avatarHipsY / sourceHipsY`. Maps vertical bob, squat depth
 *     and horizontal stride into the avatar's proportions. Skipped when the
 *     ratio is 1 (self-recorded BVH: recorder writes the avatar's real
 *     offsets) or the measurement is degenerate.
 *  2. Exact pin: shift the root so hips world Y equals `avatarHipsY`
 *     bit-exactly. Kills residual float error from step 1 (or the whole
 *     offset when step 1 was skipped) so the downstream VRMA loader computes
 *     `scale = humanoidY / animationY` = exactly 1 and translation keyframes
 *     round-trip untouched.
 *
 * @param worldY scratch vector receiving getWorldPosition results
 */
export function adaptSkeletonToHipsHeightInPlace(
  rootBone: BoneLike,
  hipsBone: HipsBoneLike,
  translationTracks: Array<{ values: Float32Array | number[] } | null>,
  avatarHipsY: number,
  worldY: { y: number },
): HipsAdaptation {
  rootBone.updateWorldMatrix(false, true);
  const sourceHipsY = hipsBone.getWorldPosition(worldY).y;
  const adaptation = computeHipsAdaptation(sourceHipsY, avatarHipsY);
  if (adaptation.applied) {
    rootBone.traverse((bone) => {
      bone.position.multiplyScalar(adaptation.scale);
    });
    for (const track of translationTracks) {
      if (track != null) scaleTrackValuesInPlace(track.values, adaptation.scale);
    }
  }
  rootBone.updateWorldMatrix(false, true);
  rootBone.position.y += avatarHipsY - hipsBone.getWorldPosition(worldY).y;
  rootBone.updateWorldMatrix(false, true);
  return adaptation;
}
