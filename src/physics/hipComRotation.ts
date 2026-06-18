import * as THREE from 'three';
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { SEGMENT_MASS_FRACTION } from './boneMasses';
import type { MassPoint } from './hipCompensation';

/**
 * Centre-of-mass ROTATION balance for the hips — the rotation counterpart of
 * HipCompensator (which translates). Implements the model:
 *
 *   1. Take the upper-body bones (everything ABOVE the hip joint — legs/feet
 *      excluded), expressed RELATIVE to the hips pivot.
 *   2. Compute their weighted centre of mass (relative to hips).
 *   3. Rotate the hips bone so that CoM lines up with the bone's reference
 *      "up" axis — i.e. the upper-body mass ends up balanced directly over
 *      the hip pivot. The hips bone's rest direction is vertical up (+Y).
 *
 * Contrast with the two existing hip systems:
 *   - HipCompensator        — TRANSLATES hips so the whole-body CoM sits over
 *                             the feet (support base). Uses leg/foot mass too.
 *   - HipBalanceCorrector   — ROTATES hips to undo a lean measured from the
 *                             hip's own world orientation vs gravity. Does NOT
 *                             look at where the mass actually is.
 *   - HipComRotator (this)  — ROTATES hips so the UPPER-BODY CoM (relative to
 *                             the hip) points straight up. Driven by the actual
 *                             mass distribution, not the hip's orientation.
 *
 * Split for testability:
 *   computeHipComRotation(input) — pure: relative mass points → rotation.
 *   HipComRotator                — wires it to a live VRM.
 */

export interface HipComRotationInput {
  /**
   * Mass points with positions RELATIVE to the hips pivot (hips at origin).
   * Excludes anything below the hip joint — pass upper-body bones only.
   */
  segments: MassPoint[];
  /**
   * Axis the CoM direction should align to (the hips bone's rest "up").
   * Default +Y. Need not be normalized.
   */
  up?: THREE.Vector3;
  /**
   * Fraction of the full alignment rotation to apply, [0..1]. 1 = snap CoM
   * onto `up` this call; <1 = ease in. Default 1.
   */
  gain?: number;
  /** Hard clamp on the correction angle [rad]. 0 = uncapped. Default 0. */
  maxAngle?: number;
}

export interface HipComRotationResult {
  /**
   * Rotation that aligns the current CoM direction to `up`. Expressed in the
   * SAME frame as the input positions. Identity when already aligned / no mass.
   */
  rotation: THREE.Quaternion;
  /** Weighted CoM, relative to hips, same frame as input. */
  com: THREE.Vector3;
  /** Applied correction angle [rad] (after gain + clamp). */
  angle: number;
  /** Σ of segment masses used. 0 ⇒ result is identity. */
  totalMass: number;
}

const _IDENTITY = new THREE.Quaternion();

/**
 * Pure CoM→up alignment solver. Frame-agnostic: returns the rotation that
 * brings the weighted-CoM direction onto `up`. Allocates only the output
 * objects.
 */
export function computeHipComRotation(
  input: HipComRotationInput,
): HipComRotationResult {
  const gain = input.gain ?? 1;
  const maxAngle = input.maxAngle ?? 0;
  const up = (input.up ?? new THREE.Vector3(0, 1, 0)).clone();
  if (up.lengthSq() < 1e-12) up.set(0, 1, 0);
  up.normalize();

  const com = new THREE.Vector3();
  const rotation = new THREE.Quaternion(); // identity

  let totalMass = 0;
  for (const s of input.segments) {
    if (!(s.mass > 0)) continue;
    com.addScaledVector(s.position, s.mass);
    totalMass += s.mass;
  }
  if (totalMass <= 0) return { rotation, com, angle: 0, totalMass: 0 };
  com.divideScalar(totalMass);

  // CoM coincides with the pivot → no defined direction → no rotation.
  if (com.lengthSq() < 1e-12) return { rotation, com, angle: 0, totalMass };

  const dir = com.clone().normalize();

  // Full rotation aligning CoM direction onto `up`.
  const full = new THREE.Quaternion().setFromUnitVectors(dir, up);
  const fullAngle = 2 * Math.acos(Math.min(1, Math.abs(full.w)));

  // Apply gain, then clamp the resulting angle, via slerp from identity.
  let t = THREE.MathUtils.clamp(gain, 0, 1);
  if (maxAngle > 0 && fullAngle > 1e-9) {
    t = Math.min(t, maxAngle / fullAngle);
  }
  t = THREE.MathUtils.clamp(t, 0, 1);
  rotation.slerpQuaternions(_IDENTITY, full, t);

  return { rotation, com, angle: fullAngle * t, totalMass };
}

export interface HipComRotatorOptions {
  gain?: number;
  maxAngle?: number;
  /** Default OFF — opt-in via debug toggle. */
  enabled?: boolean;
  /** Override the bone→mass table. Defaults to SEGMENT_MASS_FRACTION (upper). */
  massFractions?: Partial<Record<VRMHumanBoneName, number>>;
}

interface MassBone {
  node: THREE.Object3D;
  mass: number;
}

export class HipComRotator {
  private readonly hipNode: THREE.Object3D | null;
  private readonly massBones: MassBone[] = [];

  private gainV: number;
  private maxAngleV: number;
  private enabledV: boolean;

  private _latest: HipComRotationResult | null = null;

  // Scratch — reused every apply().
  private readonly _segments: MassPoint[] = [];
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private readonly _hipWorld = new THREE.Vector3();
  private readonly _hipWorldQuat = new THREE.Quaternion();
  private readonly _parentWorldQuat = new THREE.Quaternion();
  private readonly _tmp = new THREE.Vector3();
  private readonly _newWorldQuat = new THREE.Quaternion();

  constructor(vrm: VRM, opts: HipComRotatorOptions = {}) {
    this.gainV = opts.gain ?? 1;
    this.maxAngleV = opts.maxAngle ?? (60 * Math.PI / 180);
    this.enabledV = opts.enabled ?? false;

    this.hipNode = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);

    const table = opts.massFractions ?? SEGMENT_MASS_FRACTION;
    for (const [name, fraction] of Object.entries(table) as Array<
      [VRMHumanBoneName, number]
    >) {
      if (!fraction) continue;
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      this.massBones.push({ node, mass: fraction });
      this._segments.push({ position: new THREE.Vector3(), mass: fraction });
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

  set maxAngle(v: number) { this.maxAngleV = Math.max(0, v); }
  get maxAngle(): number { return this.maxAngleV; }

  /** Latest result for the debug panel. Null until first apply / after reset. */
  get latest(): HipComRotationResult | null { return this._latest; }

  /**
   * Read upper-body world positions relative to the hips, solve for the CoM→up
   * rotation, and rotate the hips bone by it (in world frame, converted to the
   * bone's local quaternion). Call BEFORE vrm.update. Reads the live hip world
   * quaternion each frame, so it converges instead of accumulating. No-op when
   * disabled or the rig lacks hips.
   */
  apply(): void {
    if (!this.enabledV || !this.hipNode) return;
    if (this.massBones.length === 0) return;

    // Positions relative to the hips pivot, world-axis-aligned.
    this.hipNode.getWorldPosition(this._hipWorld);
    for (let i = 0; i < this.massBones.length; i++) {
      this.massBones[i].node.getWorldPosition(this._tmp);
      this._segments[i].position.subVectors(this._tmp, this._hipWorld);
    }

    const result = computeHipComRotation({
      segments: this._segments,
      up: HipComRotator.UP,
      gain: this.gainV,
      maxAngle: this.maxAngleV,
    });
    this._latest = result;
    if (result.totalMass <= 0 || result.angle < 1e-6) return;

    // result.rotation is a world-frame rotation about the hip pivot. Compose
    // onto the hip's current world orientation, then express in parent-local
    // space to write back to the bone's local quaternion.
    this.hipNode.getWorldQuaternion(this._hipWorldQuat);
    this._newWorldQuat.copy(result.rotation).multiply(this._hipWorldQuat);

    const parent = this.hipNode.parent;
    if (parent) {
      parent.getWorldQuaternion(this._parentWorldQuat).invert();
      this.hipNode.quaternion.copy(this._parentWorldQuat).multiply(this._newWorldQuat);
    } else {
      this.hipNode.quaternion.copy(this._newWorldQuat);
    }
  }
}
