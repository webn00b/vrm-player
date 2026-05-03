import { VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * Body-segment mass fractions for the upper half of the body.
 *
 * Source: Winter, "Biomechanics and Motor Control of Human Movement",
 * Table 4.1 (segment mass as fraction of total body mass). We collapse a few
 * VRM-humanoid splits (head+neck → head; chest carries upperChest mass when
 * the rig has no separate UpperChest) to keep the table robust across rigs
 * that don't expose every humanoid bone.
 *
 * Hips intentionally not included — it is the reference frame for the force
 * sum, and the legs are below the hip joint so their gravity short-circuits
 * through ground reaction rather than loading the lumbar/hip junction we
 * care about.
 *
 * Sum ≈ 0.536 (≈ upper-body fraction of total mass).
 */
export const SEGMENT_MASS_FRACTION: Partial<Record<VRMHumanBoneName, number>> = {
  spine:         0.139,
  chest:         0.216,
  upperChest:    0,        // collapsed onto chest when rig has no UpperChest
  head:          0.081,    // head + neck
  leftUpperArm:  0.028, rightUpperArm: 0.028,
  leftLowerArm:  0.016, rightLowerArm: 0.016,
  leftHand:      0.006, rightHand:     0.006,
};

/** Default total body mass (kg). Overridable via HipForceTracker options. */
export const DEFAULT_BODY_MASS_KG = 70;
