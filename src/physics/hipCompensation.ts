import * as THREE from 'three';
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { BODY_COM_MASS_FRACTION } from './boneMasses';

/**
 * Weight (centre-of-mass) compensation through the hips.
 *
 * The mocap retargeter sets the hip POSITION straight from the performer's
 * pelvis. When the avatar's proportions differ from the performer, or when an
 * arm/torso swings out, the avatar's centre of mass drifts off the support
 * base (the feet) and the pose reads as "about to topple" even though every
 * joint angle is correct. This module computes the horizontal hip offset that
 * pulls the body CoM back over the feet, so the stance looks weighted.
 *
 * It is deliberately split into:
 *   1. `computeHipCompensationOffset(input)` — a PURE function. Given mass
 *      points (bone world positions + mass) and support points (feet), it
 *      returns the offset vector plus the diagnostics (CoM, support centre).
 *      No VRM, no three-vrm, no state — trivially unit-testable and callable
 *      from a script / the preview console with hand-made input.
 *   2. `HipCompensator` — a thin class that wires the pure function to a live
 *      VRM: gathers bone world positions + masses from BODY_COM_MASS_FRACTION,
 *      reads the feet for the support base, and applies the offset to the hip
 *      node. Holds only tuning params + the last result for the debug readout.
 *
 * Contrast with HipBalanceCorrector: that one rotates the hip BONE to undo a
 * lean. This one TRANSLATES the hip to rebalance mass. They are orthogonal and
 * can run together.
 */

export interface MassPoint {
  /** Segment CoM in world space (we approximate with the bone's joint pos). */
  position: THREE.Vector3;
  /** Segment mass (any consistent unit; only ratios matter for the CoM). */
  mass: number;
}

export interface HipCompensationInput {
  /** Mass points making up the body whose CoM we balance. */
  segments: MassPoint[];
  /**
   * Support-base anchor points (foot joints). Their centroid is the target the
   * CoM should sit over. Empty ⇒ no support ⇒ zero offset.
   */
  support: THREE.Vector3[];
  /**
   * Fraction of the CoM→support error corrected per call, [0..1]. 1 = snap CoM
   * fully over the support centre this frame; <1 = ease in. Default 0.5.
   */
  gain?: number;
  /** Correct only the horizontal (XZ) plane, leave Y. Default true. */
  horizontalOnly?: boolean;
  /**
   * Optional cap on |offset| (same units as positions, i.e. metres). Stops a
   * wild pose from teleporting the hips. Default 0 = uncapped.
   */
  maxOffset?: number;
}

export interface HipCompensationResult {
  /** Hip position delta, world frame. Add this to the hip's world position. */
  offset: THREE.Vector3;
  /** Body centre of mass, world frame. */
  com: THREE.Vector3;
  /** Support-base centroid (feet midpoint), world frame. */
  supportCenter: THREE.Vector3;
  /** Σ of segment masses used. 0 ⇒ result is a no-op. */
  totalMass: number;
}

/**
 * Pure CoM-over-support solver. No allocation in hot paths beyond the four
 * output vectors (caller may reuse via the class wrapper). Returns a NEW
 * result object — fine for a per-frame call at 60 fps, and keeps the function
 * honestly side-effect-free for tests.
 */
export function computeHipCompensationOffset(
  input: HipCompensationInput,
): HipCompensationResult {
  const gain = input.gain ?? 0.5;
  const horizontalOnly = input.horizontalOnly ?? true;
  const maxOffset = input.maxOffset ?? 0;

  const com = new THREE.Vector3();
  const supportCenter = new THREE.Vector3();
  const offset = new THREE.Vector3();

  // Weighted CoM = Σ(mᵢ·posᵢ) / Σmᵢ.
  let totalMass = 0;
  for (const seg of input.segments) {
    if (!(seg.mass > 0)) continue;
    com.addScaledVector(seg.position, seg.mass);
    totalMass += seg.mass;
  }
  if (totalMass <= 0 || input.support.length === 0) {
    return { offset, com, supportCenter, totalMass: 0 };
  }
  com.divideScalar(totalMass);

  // Support centroid = unweighted mean of foot anchors.
  for (const p of input.support) supportCenter.add(p);
  supportCenter.divideScalar(input.support.length);

  // Error = where the CoM should go (over support) minus where it is. Moving
  // the hips by +error shifts the whole body, dragging the CoM toward support.
  offset.subVectors(supportCenter, com);
  if (horizontalOnly) offset.y = 0;
  offset.multiplyScalar(gain);

  if (maxOffset > 0 && offset.length() > maxOffset) {
    offset.setLength(maxOffset);
  }

  return { offset, com, supportCenter, totalMass };
}

export interface HipCompensatorOptions {
  gain?: number;
  horizontalOnly?: boolean;
  maxOffset?: number;
  /** Default OFF — opt-in via debug toggle. */
  enabled?: boolean;
  /** Override the bone→mass table. Defaults to BODY_COM_MASS_FRACTION. */
  massFractions?: Partial<Record<VRMHumanBoneName, number>>;
  /** Foot bones forming the support base. Default left/right foot. */
  supportBones?: VRMHumanBoneName[];
}

interface MassBone {
  node: THREE.Object3D;
  mass: number;
}

const DEFAULT_SUPPORT_BONES: VRMHumanBoneName[] = [
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightFoot,
];

export class HipCompensator {
  private readonly hipNode: THREE.Object3D | null;
  private readonly massBones: MassBone[] = [];
  private readonly supportNodes: THREE.Object3D[] = [];

  private gainV: number;
  private horizontalOnlyV: boolean;
  private maxOffsetV: number;
  private enabledV: boolean;

  private _latest: HipCompensationResult | null = null;

  // Scratch — reused every apply().
  private readonly _segments: MassPoint[] = [];
  private readonly _support: THREE.Vector3[] = [];
  private readonly _hipParentQuat = new THREE.Quaternion();
  private readonly _hipParentScale = new THREE.Vector3(1, 1, 1);
  private readonly _hipParentPos = new THREE.Vector3();
  private readonly _localOffset = new THREE.Vector3();

  constructor(vrm: VRM, opts: HipCompensatorOptions = {}) {
    this.gainV = opts.gain ?? 0.5;
    this.horizontalOnlyV = opts.horizontalOnly ?? true;
    this.maxOffsetV = opts.maxOffset ?? 0.15;
    this.enabledV = opts.enabled ?? false;

    this.hipNode = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);

    const table = opts.massFractions ?? BODY_COM_MASS_FRACTION;
    for (const [name, fraction] of Object.entries(table) as Array<
      [VRMHumanBoneName, number]
    >) {
      if (!fraction) continue;
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      this.massBones.push({ node, mass: fraction });
      // Pre-size the scratch arrays with stable Vector3 slots so apply() never
      // allocates: we overwrite positions in place each frame.
      this._segments.push({ position: new THREE.Vector3(), mass: fraction });
    }

    const supportBones = opts.supportBones ?? DEFAULT_SUPPORT_BONES;
    for (const name of supportBones) {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      this.supportNodes.push(node);
      this._support.push(new THREE.Vector3());
    }
  }

  reset(): void {
    this._latest = null;
  }

  set enabled(v: boolean) {
    if (v === this.enabledV) return;
    this.enabledV = v;
    if (!v) this.reset();
  }
  get enabled(): boolean { return this.enabledV; }

  set gain(v: number) { this.gainV = THREE.MathUtils.clamp(v, 0, 1); }
  get gain(): number { return this.gainV; }

  set maxOffset(v: number) { this.maxOffsetV = Math.max(0, v); }
  get maxOffset(): number { return this.maxOffsetV; }

  /** Latest result for the debug panel (world frame). Null until first apply. */
  get latest(): HipCompensationResult | null { return this._latest; }

  /**
   * Read current bone world positions, solve for the hip offset, and translate
   * the hip node. Call BEFORE vrm.update so springs/secondary motion respond to
   * the shifted hip. World positions are from the previous frame's matrices
   * (one-frame lag — acceptable for a sub-1.0 gain corrector, same tradeoff as
   * HipForceTracker). No-op when disabled or the rig lacks hips/feet.
   */
  apply(): void {
    if (!this.enabledV || !this.hipNode) return;
    if (this.massBones.length === 0 || this.supportNodes.length === 0) return;

    for (let i = 0; i < this.massBones.length; i++) {
      this.massBones[i].node.getWorldPosition(this._segments[i].position);
    }
    for (let i = 0; i < this.supportNodes.length; i++) {
      this.supportNodes[i].getWorldPosition(this._support[i]);
    }

    const result = computeHipCompensationOffset({
      segments: this._segments,
      support: this._support,
      gain: this.gainV,
      horizontalOnly: this.horizontalOnlyV,
      maxOffset: this.maxOffsetV,
    });
    this._latest = result;
    if (result.totalMass <= 0) return;

    // result.offset is a WORLD-space delta. The hip node's .position lives in
    // its parent's local frame, so rotate/scale the delta into that frame
    // before adding (parent translation is irrelevant for a delta).
    const parent = this.hipNode.parent;
    if (parent) {
      parent.matrixWorld.decompose(
        this._hipParentPos, this._hipParentQuat, this._hipParentScale,
      );
      this._localOffset.copy(result.offset)
        .applyQuaternion(this._hipParentQuat.invert());
      if (this._hipParentScale.x) this._localOffset.x /= this._hipParentScale.x;
      if (this._hipParentScale.y) this._localOffset.y /= this._hipParentScale.y;
      if (this._hipParentScale.z) this._localOffset.z /= this._hipParentScale.z;
    } else {
      this._localOffset.copy(result.offset);
    }
    this.hipNode.position.add(this._localOffset);
  }
}
