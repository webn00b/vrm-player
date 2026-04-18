/**
 * Per-bone rotation constraints for VRM humanoid skeletons.
 *
 * Values approximate anatomical ranges of motion from:
 *   - AAOS, "Joint Motion: Method of Measuring and Recording" (standard ROM tables)
 *   - ISB (International Society of Biomechanics) joint coordinate system recommendations
 *
 * Stored as Euler min/max (radians) with an explicit Euler order per bone.
 * The min/max are widened ~10–20% beyond clinical ROM so the validator doesn't
 * cut into stylised animation but still catches clearly impossible poses
 * (e.g. elbow bent backwards, neck twisted 270°).
 *
 * Axis convention (three-vrm normalized humanoid):
 *   Every humanoid bone is re-oriented so its rest Y-axis points along the bone.
 *   Left/right limbs share the same local-frame orientation after normalization,
 *   so constraints are symmetric between sides.
 *
 * To edit: values are in RADIANS. Use THREE.MathUtils.degToRad(deg) in-line and
 * keep the degrees in a trailing comment for human review.
 */

import { MathUtils } from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';

export type EulerAxisOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'XZY' | 'YZX' | 'ZYX';

export interface RotationConstraint {
  order: EulerAxisOrder;
  min: [number, number, number];
  max: [number, number, number];
}

const d = MathUtils.degToRad;

/** Shallow clone — used for left/right symmetric entries. */
function sym(c: RotationConstraint): RotationConstraint {
  return { order: c.order, min: [...c.min], max: [...c.max] };
}

// ── Shoulder girdle (clavicle) ───────────────────────────────────────────────
// AAOS: scapulothoracic motion is small — ~20° elevation, protraction/retraction ~20°
const shoulder: RotationConstraint = {
  order: 'YXZ',
  min: [d(-20), d(-20), d(-20)], // elevation / rotation / protraction
  max: [d(+30), d(+20), d(+30)],
};

// ── Glenohumeral (upperArm) ──────────────────────────────────────────────────
// AAOS: flexion 0–180°, extension 0–60°, abduction 0–180°, adduction 0–50°,
//       internal rotation 0–70°, external rotation 0–90°.
// Values deliberately broad because different VRM rigs distribute shoulder motion
// differently between shoulder and upperArm joints.
const upperArm: RotationConstraint = {
  order: 'YXZ',
  min: [d(-80), d(-110), d(-60)],   // flexion(−ext) / twist / abduction(−add)
  max: [d(+110), d(+110), d(+180)],
};

// ── Elbow (lowerArm) ─────────────────────────────────────────────────────────
// AAOS: flexion 0–150°, hyperextension 0–10° (rare), pronation/supination ±90°.
// Elbow effectively has 1 DOF for flexion; Y carries forearm twist.
const lowerArm: RotationConstraint = {
  order: 'XYZ',
  min: [d(-10), d(-90), d(-10)],
  max: [d(+150), d(+90), d(+10)],
};

// ── Wrist (hand) ─────────────────────────────────────────────────────────────
// AAOS: flexion 0–80°, extension 0–70°, radial dev 0–20°, ulnar dev 0–30°.
const hand: RotationConstraint = {
  order: 'XYZ',
  min: [d(-80), d(-30), d(-80)],
  max: [d(+70), d(+20), d(+80)],
};

// ── Hip (upperLeg) ───────────────────────────────────────────────────────────
// AAOS: flexion 0–120°, extension 0–30°, abduction 0–45°, adduction 0–30°,
//       rotation ±45°.
const upperLeg: RotationConstraint = {
  order: 'YXZ',
  min: [d(-30), d(-45), d(-30)],
  max: [d(+125), d(+45), d(+45)],
};

// ── Knee (lowerLeg) ──────────────────────────────────────────────────────────
// AAOS: flexion 0–135°, hyperextension <5°. Almost no lateral/rotation motion.
const lowerLeg: RotationConstraint = {
  order: 'XYZ',
  min: [d(-5), d(-10), d(-5)],
  max: [d(+140), d(+10), d(+5)],
};

// ── Ankle (foot) ─────────────────────────────────────────────────────────────
// AAOS: dorsiflexion 0–20°, plantarflexion 0–50°, inversion 0–35°, eversion 0–15°.
const foot: RotationConstraint = {
  order: 'XYZ',
  min: [d(-50), d(-30), d(-35)],
  max: [d(+30), d(+30), d(+15)],
};

// ── Toes ─────────────────────────────────────────────────────────────────────
// Approximate combined MTP ROM.
const toes: RotationConstraint = {
  order: 'XYZ',
  min: [d(-30), d(-10), d(-10)],
  max: [d(+60), d(+10), d(+10)],
};

// ── Spine chain ──────────────────────────────────────────────────────────────
// AAOS total trunk: flexion 0–80°, extension 0–25°, lateral bend ±35°, rotation ±45°.
// Distributed over spine / chest / upperChest — each gets ~1/3 of the total,
// widened a bit for safety.
const spineSegment: RotationConstraint = {
  order: 'YXZ',
  min: [d(-25), d(-20), d(-20)],
  max: [d(+35), d(+20), d(+20)],
};

// ── Hips (pelvis) ────────────────────────────────────────────────────────────
// Pelvic tilt/rotation is mostly bounded by the gameplay (not anatomy); kept loose.
const hipsConstraint: RotationConstraint = {
  order: 'YXZ',
  min: [d(-30), d(-90), d(-30)],
  max: [d(+30), d(+90), d(+30)],
};

// ── Neck ─────────────────────────────────────────────────────────────────────
// AAOS: flexion 0–50°, extension 0–60°, lateral ±45°, rotation ±80°.
const neck: RotationConstraint = {
  order: 'YXZ',
  min: [d(-45), d(-70), d(-40)],
  max: [d(+60), d(+70), d(+40)],
};

// ── Head (occipital on top of neck) ──────────────────────────────────────────
// Additional motion above neck, smaller ranges so the combined neck+head stays
// within total cervical ROM.
const head: RotationConstraint = {
  order: 'YXZ',
  min: [d(-30), d(-40), d(-30)],
  max: [d(+40), d(+40), d(+30)],
};

// ── Eyes ─────────────────────────────────────────────────────────────────────
// Ocular ROM: gaze ±30° vertical, ±40° horizontal; no roll.
const eye: RotationConstraint = {
  order: 'YXZ',
  min: [d(-30), d(-40), d(-5)],
  max: [d(+30), d(+40), d(+5)],
};

// ── Jaw ──────────────────────────────────────────────────────────────────────
// Mouth opening ~35°, side-to-side ±5°.
const jaw: RotationConstraint = {
  order: 'XYZ',
  min: [d(-5), d(-5), d(-5)],
  max: [d(+35), d(+5), d(+5)],
};

// ── Fingers ──────────────────────────────────────────────────────────────────
// AAOS: MCP flexion 0–90°, PIP 0–100°, DIP 0–80°, MCP abduction ±25°.
const fingerProximal: RotationConstraint = {   // MCP of index/middle/ring/little
  order: 'XYZ',
  min: [d(-15), d(-30), d(-10)],
  max: [d(+100), d(+30), d(+10)],
};
const fingerIntermediate: RotationConstraint = { // PIP
  order: 'XYZ',
  min: [d(-10), d(-5), d(-5)],
  max: [d(+110), d(+5), d(+5)],
};
const fingerDistal: RotationConstraint = {       // DIP
  order: 'XYZ',
  min: [d(-10), d(-5), d(-5)],
  max: [d(+90), d(+5), d(+5)],
};

// ── Thumb ────────────────────────────────────────────────────────────────────
// Thumb has a distinct kinematic chain: CMC (metacarpal) has saddle joint,
// MCP (proximal) and IP (distal) are hinges.
const thumbMetacarpal: RotationConstraint = {
  order: 'XYZ',
  min: [d(-20), d(-45), d(-10)],
  max: [d(+60), d(+45), d(+20)],
};
const thumbProximal: RotationConstraint = {
  order: 'XYZ',
  min: [d(-10), d(-20), d(-10)],
  max: [d(+90), d(+20), d(+10)],
};
const thumbDistal: RotationConstraint = {
  order: 'XYZ',
  min: [d(-10), d(-5), d(-5)],
  max: [d(+90), d(+5), d(+5)],
};

// ── Assembled config ─────────────────────────────────────────────────────────

export const DEFAULT_BONE_CONSTRAINTS: Partial<Record<VRMHumanBoneName, RotationConstraint>> = {
  [VRMHumanBoneName.Hips]:       sym(hipsConstraint),
  [VRMHumanBoneName.Spine]:      sym(spineSegment),
  [VRMHumanBoneName.Chest]:      sym(spineSegment),
  [VRMHumanBoneName.UpperChest]: sym(spineSegment),
  [VRMHumanBoneName.Neck]:       sym(neck),
  [VRMHumanBoneName.Head]:       sym(head),
  [VRMHumanBoneName.LeftEye]:    sym(eye),
  [VRMHumanBoneName.RightEye]:   sym(eye),
  [VRMHumanBoneName.Jaw]:        sym(jaw),

  // Arms
  [VRMHumanBoneName.LeftShoulder]:  sym(shoulder),
  [VRMHumanBoneName.LeftUpperArm]:  sym(upperArm),
  [VRMHumanBoneName.LeftLowerArm]:  sym(lowerArm),
  [VRMHumanBoneName.LeftHand]:      sym(hand),
  [VRMHumanBoneName.RightShoulder]: sym(shoulder),
  [VRMHumanBoneName.RightUpperArm]: sym(upperArm),
  [VRMHumanBoneName.RightLowerArm]: sym(lowerArm),
  [VRMHumanBoneName.RightHand]:     sym(hand),

  // Legs
  [VRMHumanBoneName.LeftUpperLeg]:  sym(upperLeg),
  [VRMHumanBoneName.LeftLowerLeg]:  sym(lowerLeg),
  [VRMHumanBoneName.LeftFoot]:      sym(foot),
  [VRMHumanBoneName.LeftToes]:      sym(toes),
  [VRMHumanBoneName.RightUpperLeg]: sym(upperLeg),
  [VRMHumanBoneName.RightLowerLeg]: sym(lowerLeg),
  [VRMHumanBoneName.RightFoot]:     sym(foot),
  [VRMHumanBoneName.RightToes]:     sym(toes),

  // Left fingers
  [VRMHumanBoneName.LeftThumbMetacarpal]:    sym(thumbMetacarpal),
  [VRMHumanBoneName.LeftThumbProximal]:      sym(thumbProximal),
  [VRMHumanBoneName.LeftThumbDistal]:        sym(thumbDistal),
  [VRMHumanBoneName.LeftIndexProximal]:      sym(fingerProximal),
  [VRMHumanBoneName.LeftIndexIntermediate]:  sym(fingerIntermediate),
  [VRMHumanBoneName.LeftIndexDistal]:        sym(fingerDistal),
  [VRMHumanBoneName.LeftMiddleProximal]:     sym(fingerProximal),
  [VRMHumanBoneName.LeftMiddleIntermediate]: sym(fingerIntermediate),
  [VRMHumanBoneName.LeftMiddleDistal]:       sym(fingerDistal),
  [VRMHumanBoneName.LeftRingProximal]:       sym(fingerProximal),
  [VRMHumanBoneName.LeftRingIntermediate]:   sym(fingerIntermediate),
  [VRMHumanBoneName.LeftRingDistal]:         sym(fingerDistal),
  [VRMHumanBoneName.LeftLittleProximal]:     sym(fingerProximal),
  [VRMHumanBoneName.LeftLittleIntermediate]: sym(fingerIntermediate),
  [VRMHumanBoneName.LeftLittleDistal]:       sym(fingerDistal),

  // Right fingers
  [VRMHumanBoneName.RightThumbMetacarpal]:    sym(thumbMetacarpal),
  [VRMHumanBoneName.RightThumbProximal]:      sym(thumbProximal),
  [VRMHumanBoneName.RightThumbDistal]:        sym(thumbDistal),
  [VRMHumanBoneName.RightIndexProximal]:      sym(fingerProximal),
  [VRMHumanBoneName.RightIndexIntermediate]:  sym(fingerIntermediate),
  [VRMHumanBoneName.RightIndexDistal]:        sym(fingerDistal),
  [VRMHumanBoneName.RightMiddleProximal]:     sym(fingerProximal),
  [VRMHumanBoneName.RightMiddleIntermediate]: sym(fingerIntermediate),
  [VRMHumanBoneName.RightMiddleDistal]:       sym(fingerDistal),
  [VRMHumanBoneName.RightRingProximal]:       sym(fingerProximal),
  [VRMHumanBoneName.RightRingIntermediate]:   sym(fingerIntermediate),
  [VRMHumanBoneName.RightRingDistal]:         sym(fingerDistal),
  [VRMHumanBoneName.RightLittleProximal]:     sym(fingerProximal),
  [VRMHumanBoneName.RightLittleIntermediate]: sym(fingerIntermediate),
  [VRMHumanBoneName.RightLittleDistal]:       sym(fingerDistal),
};

/** Merge an optional per-avatar override on top of defaults. */
export function mergeConstraints(
  overrides?: Partial<Record<VRMHumanBoneName, RotationConstraint>>,
): Partial<Record<VRMHumanBoneName, RotationConstraint>> {
  if (!overrides) return DEFAULT_BONE_CONSTRAINTS;
  const out: Partial<Record<VRMHumanBoneName, RotationConstraint>> = {};
  for (const k of Object.keys(DEFAULT_BONE_CONSTRAINTS) as VRMHumanBoneName[]) {
    out[k] = DEFAULT_BONE_CONSTRAINTS[k];
  }
  for (const k of Object.keys(overrides) as VRMHumanBoneName[]) {
    const o = overrides[k];
    if (o) out[k] = o;
  }
  return out;
}
