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
 *   Normalized bones have identity rest rotation with world-aligned axes
 *   (+X avatar left, +Y up, +Z forward). A pose mirrored across the sagittal
 *   plane negates the Y and Z Euler components, so left/right ranges are NOT
 *   identical: constraint values below are authored for the LEFT side and
 *   right-side entries are derived with mirror().
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

/** Shallow clone — used for left-side and central entries. */
function sym(c: RotationConstraint): RotationConstraint {
  return { order: c.order, min: [...c.min], max: [...c.max] };
}

/**
 * Sagittal-plane mirror for right-side bones. A mirrored rotation negates the
 * Y and Z Euler components (M·R·M with M = diag(-1,1,1)), so the right-side
 * range is the left range with the Y/Z bounds negated and swapped; X is
 * unchanged. Symmetric-about-zero ranges are unaffected.
 */
function mirror(c: RotationConstraint): RotationConstraint {
  return {
    order: c.order,
    min: [c.min[0], -c.max[1], -c.max[2]],
    max: [c.max[0], -c.min[1], -c.min[2]],
  };
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
// Left arm rests along +X (T-pose). X = axial twist; Y = horizontal swing
// (forward reach = −Y, cross-chest ≈ −130°, behind back = +Y); Z = vertical
// swing (hanging at side = −90°, raised overhead = +90°, adduction past the
// body ≈ −110°). Values deliberately broad because different VRM rigs
// distribute shoulder motion differently between shoulder and upperArm joints.
const upperArm: RotationConstraint = {
  order: 'YXZ',
  min: [d(-95), d(-135), d(-115)],
  max: [d(+95), d(+60), d(+100)],
};

// ── Elbow (lowerArm) ─────────────────────────────────────────────────────────
// AAOS: flexion 0–150°, hyperextension 0–10° (rare), pronation/supination ±90°.
// Forearm rests along +X (left). X = pronation/supination twist; flexion lives
// on Y (palm-down hinge: forward bend = −Y) or Z (palm-forward hinge: upward
// bend = +Z) depending on where the rig puts the twist. Backward (+Y) and
// downward (−Z) bends are hyperextension and stay clamped near zero.
// Order YZX keeps Y as the outer axis: Euler decomposition limits the middle
// axis to ±90°, and flexion (Y) must reach 150°. Known trade-off: a pure
// upward bend (Z) past 90° with zero twist decomposes into the alternative
// Euler branch and gets mangled — rigs/solvers here put flexion on Y, so the
// Z budget only needs to cover the sub-90° range.
const lowerArm: RotationConstraint = {
  order: 'YZX',
  min: [d(-95), d(-150), d(-10)],
  max: [d(+95), d(+10), d(+150)],
};

// ── Wrist (hand) ─────────────────────────────────────────────────────────────
// AAOS: flexion 0–80°, extension 0–70°, radial dev 0–20°, ulnar dev 0–30°.
// Hand rests along +X (left), palm down. X = leaked forearm twist; Y = radial/
// ulnar deviation (yaw); Z = flexion (−Z, palm toward floor) / extension (+Z).
const hand: RotationConstraint = {
  order: 'XYZ',
  min: [d(-45), d(-35), d(-85)],
  max: [d(+45), d(+35), d(+75)],
};

// ── Hip (upperLeg) ───────────────────────────────────────────────────────────
// AAOS: flexion 0–120°, extension 0–30°, abduction 0–45°, adduction 0–30°,
//       rotation ±45°.
// Thigh rests along −Y. X = pitch (raise forward = −X, extend back = +X);
// Y = axial twist; Z = roll (left leg outward = +Z, inward = −Z).
// Order XYZ keeps X as the outer axis: Euler decomposition limits the middle
// axis to ±90°, and hip flexion (X) must reach 125° for deep squats.
const upperLeg: RotationConstraint = {
  order: 'XYZ',
  min: [d(-125), d(-50), d(-35)],
  max: [d(+35), d(+50), d(+55)],
};

// ── Knee (lowerLeg) ──────────────────────────────────────────────────────────
// AAOS: flexion 0–135°, hyperextension <5°. Almost no lateral/rotation motion.
// Shin rests along −Y; knee bend (heel toward buttock) = +X.
const lowerLeg: RotationConstraint = {
  order: 'XYZ',
  min: [d(-5), d(-10), d(-5)],
  max: [d(+140), d(+10), d(+5)],
};

// ── Ankle (foot) ─────────────────────────────────────────────────────────────
// AAOS: dorsiflexion 0–20°, plantarflexion 0–50°, inversion 0–35°, eversion 0–15°.
// Toes point +Z. X = pitch (toes down / plantarflexion = +X, toes up = −X);
// Y = heel yaw; Z = roll (left-foot inversion, sole inward = +Z).
const foot: RotationConstraint = {
  order: 'XYZ',
  min: [d(-35), d(-30), d(-20)],
  max: [d(+55), d(+30), d(+40)],
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
// Deliberately unconstrained: hips carry the avatar's GLOBAL orientation
// (turning around, lying down, dance turns), not an anatomical joint angle.
// Clamping it mangles legitimate root motion — e.g. import-time clamping has
// no exclusion mask, so a clip that turns >90° would snap at the yaw bound.

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
// Left-hand fingers rest along +X, palm down: curl toward the palm = −Z,
// hyperextension = +Z, spread (abduction) = Y, X = leaked twist.
const fingerProximal: RotationConstraint = {   // MCP of index/middle/ring/little
  order: 'XYZ',
  min: [d(-10), d(-30), d(-105)],
  max: [d(+10), d(+30), d(+20)],
};
const fingerIntermediate: RotationConstraint = { // PIP
  order: 'XYZ',
  min: [d(-5), d(-5), d(-115)],
  max: [d(+5), d(+5), d(+10)],
};
const fingerDistal: RotationConstraint = {       // DIP
  order: 'XYZ',
  min: [d(-5), d(-5), d(-95)],
  max: [d(+5), d(+5), d(+10)],
};

// ── Thumb ────────────────────────────────────────────────────────────────────
// Thumb has a distinct kinematic chain: CMC (metacarpal) has saddle joint,
// MCP (proximal) and IP (distal) are hinges. The chain sits ~45° off the palm
// plane, so its hinge axis mixes Y and Z — ranges stay deliberately loose.
const thumbMetacarpal: RotationConstraint = {
  order: 'XYZ',
  min: [d(-60), d(-60), d(-60)],
  max: [d(+60), d(+60), d(+60)],
};
const thumbProximal: RotationConstraint = {
  order: 'XYZ',
  min: [d(-15), d(-95), d(-95)],
  max: [d(+15), d(+20), d(+20)],
};
const thumbDistal: RotationConstraint = {
  order: 'XYZ',
  min: [d(-5), d(-95), d(-95)],
  max: [d(+5), d(+10), d(+10)],
};

// ── Mixamo Live profile ─────────────────────────────────────────────────────
// Data-driven: bounds are the per-axis envelope of a 16-clip Mixamo corpus
// (idles, walks, dances incl. Samba and breakdance Flair, swimming, jumps,
// situps, squat stretches — ~2700 frames, both sides folded into the left
// frame) plus ~10° margin, unioned with the natural-pose floors pinned by
// boneConstraints.test.ts. Derived with tools/analyze-fbx-rom.mjs.
// Hinge edges the corpus confirms as hard zeros (knee forward bend, elbow
// backward/downward bend) keep their tight bounds — they are the garbage
// detectors. Hips stay unconstrained — see the pelvis note above.
const mixamoLiveSpine: RotationConstraint = {
  order: 'YXZ',
  min: [d(-30), d(-50), d(-45)],
  max: [d(+70), d(+45), d(+40)],
};

const mixamoLiveChestSegment: RotationConstraint = {
  order: 'YXZ',
  min: [d(-30), d(-30), d(-25)],
  max: [d(+45), d(+30), d(+25)],
};

const mixamoLiveHead: RotationConstraint = {
  order: 'YXZ',
  min: [d(-60), d(-80), d(-35)],
  max: [d(+45), d(+60), d(+70)],
};

const mixamoLiveShoulder: RotationConstraint = {
  order: 'YXZ',
  min: [d(-40), d(-75), d(-50)],
  max: [d(+65), d(+55), d(+55)],
};

// Dance/swim content sweeps full arm circles: Y/Z stay near-unconstrained and
// only the axial twist (X) bound carries signal.
const mixamoLiveUpperArm: RotationConstraint = {
  order: 'YXZ',
  min: [d(-90), d(-155), d(-175)],
  max: [d(+90), d(+180), d(+160)],
};

const mixamoLiveLowerArm: RotationConstraint = {
  order: 'YZX',
  min: [d(-80), d(-160), d(-6)],
  max: [d(+80), d(+6), d(+150)],
};

const mixamoLiveHand: RotationConstraint = {
  order: 'XYZ',
  min: [d(-125), d(-55), d(-75)],
  max: [d(+80), d(+65), d(+105)],
};

const mixamoLiveUpperLeg: RotationConstraint = {
  order: 'XYZ',
  min: [d(-160), d(-45), d(-40)],
  max: [d(+45), d(+65), d(+70)],
};

// Knee: corpus never bends forward (min exactly 0) — keep the hard zero.
// Bent-knee tibial twist (Y) reaches ±55° in dance content.
const mixamoLiveLowerLeg: RotationConstraint = {
  order: 'XYZ',
  min: [d(0), d(-65), d(-25)],
  max: [d(+150), d(+25), d(+25)],
};

const mixamoLiveFoot: RotationConstraint = {
  order: 'XYZ',
  min: [d(-55), d(-40), d(-50)],
  max: [d(+70), d(+55), d(+35)],
};

const mixamoLiveToes: RotationConstraint = {
  order: 'XYZ',
  min: [d(-70), d(-15), d(-25)],
  max: [d(+60), d(+35), d(+40)],
};

const mixamoLiveThumbProximal: RotationConstraint = {
  order: 'XYZ',
  min: [d(-15), d(-95), d(-95)],
  max: [d(+30), d(+65), d(+50)],
};
const mixamoLiveThumbDistal: RotationConstraint = {
  order: 'XYZ',
  min: [d(-30), d(-95), d(-95)],
  max: [d(+60), d(+80), d(+75)],
};
const mixamoLiveFingerProximal: RotationConstraint = {
  order: 'XYZ',
  min: [d(-25), d(-35), d(-105)],
  max: [d(+35), d(+35), d(+50)],
};
const mixamoLiveFingerIntermediate: RotationConstraint = {
  order: 'XYZ',
  min: [d(-25), d(-20), d(-120)],
  max: [d(+20), d(+15), d(+10)],
};
const mixamoLiveFingerDistal: RotationConstraint = {
  order: 'XYZ',
  min: [d(-10), d(-10), d(-95)],
  max: [d(+15), d(+15), d(+20)],
};

// ── Assembled config ─────────────────────────────────────────────────────────

export const DEFAULT_BONE_CONSTRAINTS: Partial<Record<VRMHumanBoneName, RotationConstraint>> = {
  [VRMHumanBoneName.Spine]:      sym(spineSegment),
  [VRMHumanBoneName.Chest]:      sym(spineSegment),
  [VRMHumanBoneName.UpperChest]: sym(spineSegment),
  [VRMHumanBoneName.Neck]:       sym(neck),
  [VRMHumanBoneName.Head]:       sym(head),
  [VRMHumanBoneName.LeftEye]:    sym(eye),
  [VRMHumanBoneName.RightEye]:   mirror(eye),
  [VRMHumanBoneName.Jaw]:        sym(jaw),

  // Arms
  [VRMHumanBoneName.LeftShoulder]:  sym(shoulder),
  [VRMHumanBoneName.LeftUpperArm]:  sym(upperArm),
  [VRMHumanBoneName.LeftLowerArm]:  sym(lowerArm),
  [VRMHumanBoneName.LeftHand]:      sym(hand),
  [VRMHumanBoneName.RightShoulder]: mirror(shoulder),
  [VRMHumanBoneName.RightUpperArm]: mirror(upperArm),
  [VRMHumanBoneName.RightLowerArm]: mirror(lowerArm),
  [VRMHumanBoneName.RightHand]:     mirror(hand),

  // Legs
  [VRMHumanBoneName.LeftUpperLeg]:  sym(upperLeg),
  [VRMHumanBoneName.LeftLowerLeg]:  sym(lowerLeg),
  [VRMHumanBoneName.LeftFoot]:      sym(foot),
  [VRMHumanBoneName.LeftToes]:      sym(toes),
  [VRMHumanBoneName.RightUpperLeg]: mirror(upperLeg),
  [VRMHumanBoneName.RightLowerLeg]: mirror(lowerLeg),
  [VRMHumanBoneName.RightFoot]:     mirror(foot),
  [VRMHumanBoneName.RightToes]:     mirror(toes),

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
  [VRMHumanBoneName.RightThumbMetacarpal]:    mirror(thumbMetacarpal),
  [VRMHumanBoneName.RightThumbProximal]:      mirror(thumbProximal),
  [VRMHumanBoneName.RightThumbDistal]:        mirror(thumbDistal),
  [VRMHumanBoneName.RightIndexProximal]:      mirror(fingerProximal),
  [VRMHumanBoneName.RightIndexIntermediate]:  mirror(fingerIntermediate),
  [VRMHumanBoneName.RightIndexDistal]:        mirror(fingerDistal),
  [VRMHumanBoneName.RightMiddleProximal]:     mirror(fingerProximal),
  [VRMHumanBoneName.RightMiddleIntermediate]: mirror(fingerIntermediate),
  [VRMHumanBoneName.RightMiddleDistal]:       mirror(fingerDistal),
  [VRMHumanBoneName.RightRingProximal]:       mirror(fingerProximal),
  [VRMHumanBoneName.RightRingIntermediate]:   mirror(fingerIntermediate),
  [VRMHumanBoneName.RightRingDistal]:         mirror(fingerDistal),
  [VRMHumanBoneName.RightLittleProximal]:     mirror(fingerProximal),
  [VRMHumanBoneName.RightLittleIntermediate]: mirror(fingerIntermediate),
  [VRMHumanBoneName.RightLittleDistal]:       mirror(fingerDistal),
};

export const MIXAMO_LIVE_BONE_CONSTRAINTS: Partial<Record<VRMHumanBoneName, RotationConstraint>> = {
  ...DEFAULT_BONE_CONSTRAINTS,
  [VRMHumanBoneName.Spine]:      sym(mixamoLiveSpine),
  [VRMHumanBoneName.Chest]:      sym(mixamoLiveChestSegment),
  [VRMHumanBoneName.UpperChest]: sym(mixamoLiveChestSegment),
  [VRMHumanBoneName.Head]:       sym(mixamoLiveHead),

  [VRMHumanBoneName.LeftShoulder]:  sym(mixamoLiveShoulder),
  [VRMHumanBoneName.LeftUpperArm]:  sym(mixamoLiveUpperArm),
  [VRMHumanBoneName.LeftLowerArm]:  sym(mixamoLiveLowerArm),
  [VRMHumanBoneName.LeftHand]:      sym(mixamoLiveHand),
  [VRMHumanBoneName.RightShoulder]: mirror(mixamoLiveShoulder),
  [VRMHumanBoneName.RightUpperArm]: mirror(mixamoLiveUpperArm),
  [VRMHumanBoneName.RightLowerArm]: mirror(mixamoLiveLowerArm),
  [VRMHumanBoneName.RightHand]:     mirror(mixamoLiveHand),

  [VRMHumanBoneName.LeftUpperLeg]:  sym(mixamoLiveUpperLeg),
  [VRMHumanBoneName.LeftLowerLeg]:  sym(mixamoLiveLowerLeg),
  [VRMHumanBoneName.LeftFoot]:      sym(mixamoLiveFoot),
  [VRMHumanBoneName.LeftToes]:      sym(mixamoLiveToes),
  [VRMHumanBoneName.RightUpperLeg]: mirror(mixamoLiveUpperLeg),
  [VRMHumanBoneName.RightLowerLeg]: mirror(mixamoLiveLowerLeg),
  [VRMHumanBoneName.RightFoot]:     mirror(mixamoLiveFoot),
  [VRMHumanBoneName.RightToes]:     mirror(mixamoLiveToes),

  // Left fingers
  [VRMHumanBoneName.LeftThumbProximal]:      sym(mixamoLiveThumbProximal),
  [VRMHumanBoneName.LeftThumbDistal]:        sym(mixamoLiveThumbDistal),
  [VRMHumanBoneName.LeftIndexProximal]:      sym(mixamoLiveFingerProximal),
  [VRMHumanBoneName.LeftIndexIntermediate]:  sym(mixamoLiveFingerIntermediate),
  [VRMHumanBoneName.LeftIndexDistal]:        sym(mixamoLiveFingerDistal),
  [VRMHumanBoneName.LeftMiddleProximal]:     sym(mixamoLiveFingerProximal),
  [VRMHumanBoneName.LeftMiddleIntermediate]: sym(mixamoLiveFingerIntermediate),
  [VRMHumanBoneName.LeftMiddleDistal]:       sym(mixamoLiveFingerDistal),
  [VRMHumanBoneName.LeftRingProximal]:       sym(mixamoLiveFingerProximal),
  [VRMHumanBoneName.LeftRingIntermediate]:   sym(mixamoLiveFingerIntermediate),
  [VRMHumanBoneName.LeftRingDistal]:         sym(mixamoLiveFingerDistal),
  [VRMHumanBoneName.LeftLittleProximal]:     sym(mixamoLiveFingerProximal),
  [VRMHumanBoneName.LeftLittleIntermediate]: sym(mixamoLiveFingerIntermediate),
  [VRMHumanBoneName.LeftLittleDistal]:       sym(mixamoLiveFingerDistal),

  // Right fingers
  [VRMHumanBoneName.RightThumbProximal]:      mirror(mixamoLiveThumbProximal),
  [VRMHumanBoneName.RightThumbDistal]:        mirror(mixamoLiveThumbDistal),
  [VRMHumanBoneName.RightIndexProximal]:      mirror(mixamoLiveFingerProximal),
  [VRMHumanBoneName.RightIndexIntermediate]:  mirror(mixamoLiveFingerIntermediate),
  [VRMHumanBoneName.RightIndexDistal]:        mirror(mixamoLiveFingerDistal),
  [VRMHumanBoneName.RightMiddleProximal]:     mirror(mixamoLiveFingerProximal),
  [VRMHumanBoneName.RightMiddleIntermediate]: mirror(mixamoLiveFingerIntermediate),
  [VRMHumanBoneName.RightMiddleDistal]:       mirror(mixamoLiveFingerDistal),
  [VRMHumanBoneName.RightRingProximal]:       mirror(mixamoLiveFingerProximal),
  [VRMHumanBoneName.RightRingIntermediate]:   mirror(mixamoLiveFingerIntermediate),
  [VRMHumanBoneName.RightRingDistal]:         mirror(mixamoLiveFingerDistal),
  [VRMHumanBoneName.RightLittleProximal]:     mirror(mixamoLiveFingerProximal),
  [VRMHumanBoneName.RightLittleIntermediate]: mirror(mixamoLiveFingerIntermediate),
  [VRMHumanBoneName.RightLittleDistal]:       mirror(mixamoLiveFingerDistal),
};

export type BoneConstraintProfileId = 'default' | 'mixamoLive';

export const BONE_CONSTRAINT_PROFILES: Record<
  BoneConstraintProfileId,
  Partial<Record<VRMHumanBoneName, RotationConstraint>>
> = {
  default: DEFAULT_BONE_CONSTRAINTS,
  mixamoLive: MIXAMO_LIVE_BONE_CONSTRAINTS,
};

/** Merge an optional per-avatar override on top of a named profile. */
export function mergeConstraints(
  overrides?: Partial<Record<VRMHumanBoneName, RotationConstraint>>,
  profileId: BoneConstraintProfileId = 'default',
): Partial<Record<VRMHumanBoneName, RotationConstraint>> {
  const base = BONE_CONSTRAINT_PROFILES[profileId];
  if (!overrides) return base;
  const out: Partial<Record<VRMHumanBoneName, RotationConstraint>> = {};
  for (const k of Object.keys(base) as VRMHumanBoneName[]) {
    out[k] = base[k];
  }
  for (const k of Object.keys(overrides) as VRMHumanBoneName[]) {
    const o = overrides[k];
    if (o) out[k] = o;
  }
  return out;
}
