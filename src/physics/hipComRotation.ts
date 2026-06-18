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
  /**
   * Where the correction is applied:
   *   'spine' — distributed across the spine chain (spine/chest/upperChest).
   *             Hips and legs stay put, the torso bends. Default.
   *   'hips'  — rotates the hips bone. Rotates the WHOLE model, legs included.
   */
  target?: 'spine' | 'hips';
  /** Spine bones used when target='spine'. Default spine/chest/upperChest. */
  spineBones?: VRMHumanBoneName[];
}

interface MassBone {
  node: THREE.Object3D;
  mass: number;
}

/** Per-spine-bone idempotency bookkeeping for the distributed apply path. */
interface SpineBoneState {
  node: THREE.Object3D;
  /** Local-space delta we post-multiplied last frame (for stripping). */
  lastDelta: THREE.Quaternion;
  /** Local quaternion we left the bone at, to detect upstream refresh. */
  lastWritten: THREE.Quaternion;
  hasWritten: boolean;
}

const DEFAULT_SPINE_BONES: VRMHumanBoneName[] = [
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
];

export class HipComRotator {
  private readonly hipNode: THREE.Object3D | null;
  private readonly massBones: MassBone[] = [];
  private readonly target: 'spine' | 'hips';
  private readonly spineBones: SpineBoneState[] = [];

  private gainV: number;
  private maxAngleV: number;
  private enabledV: boolean;

  private _latest: HipComRotationResult | null = null;

  // Scratch — reused every apply().
  private readonly _segments: MassPoint[] = [];
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private static readonly IDENTITY = new THREE.Quaternion();
  private readonly _hipWorld = new THREE.Vector3();
  private readonly _hipWorldQuat = new THREE.Quaternion();
  private readonly _parentWorldQuat = new THREE.Quaternion();
  private readonly _tmp = new THREE.Vector3();
  private readonly _newWorldQuat = new THREE.Quaternion();
  private readonly _frac = new THREE.Quaternion();
  private readonly _boneWorldQuat = new THREE.Quaternion();
  private readonly _boneWorldInv = new THREE.Quaternion();
  private readonly _localDelta = new THREE.Quaternion();
  private readonly _deltaInv = new THREE.Quaternion();

  constructor(vrm: VRM, opts: HipComRotatorOptions = {}) {
    this.gainV = opts.gain ?? 1;
    this.maxAngleV = opts.maxAngle ?? (60 * Math.PI / 180);
    this.enabledV = opts.enabled ?? false;
    this.target = opts.target ?? 'spine';

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

    for (const name of (opts.spineBones ?? DEFAULT_SPINE_BONES)) {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      this.spineBones.push({
        node,
        lastDelta: new THREE.Quaternion(),
        lastWritten: new THREE.Quaternion(),
        hasWritten: false,
      });
    }
  }

  reset(): void {
    // Clear bookkeeping only — don't touch bone rotations. reset() fires on
    // clip change, when upstream is writing a fresh pose; stripping here would
    // corrupt it.
    for (const s of this.spineBones) {
      s.hasWritten = false;
      s.lastDelta.identity();
    }
    this._latest = null;
  }

  /** Strip our last applied deltas to recover the base pose (idle/static). */
  private restoreSpineBase(): void {
    for (const s of this.spineBones) {
      if (s.hasWritten && quatApproxEqual(s.node.quaternion, s.lastWritten)) {
        this._deltaInv.copy(s.lastDelta).invert();
        s.node.quaternion.multiply(this._deltaInv);
      }
      s.hasWritten = false;
      s.lastDelta.identity();
    }
  }

  set enabled(v: boolean) {
    if (v === this.enabledV) return;
    this.enabledV = v;
    if (!v) {
      // Turning off: restore the base so a static pose snaps back.
      if (this.target === 'spine') this.restoreSpineBase();
      this.reset();
    }
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
   * rotation, and apply it. With target='spine' the rotation is distributed
   * across the spine chain (legs/hips stay put, torso bends); with target='hips'
   * it rotates the hips bone (rotates the whole model). Call BEFORE vrm.update.
   * No-op when disabled or the rig lacks hips.
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
    if (result.totalMass <= 0) return;

    if (this.target === 'spine') this.applyToSpine(result.rotation);
    else this.applyToHips(result.rotation);
  }

  /**
   * Rotate the hips bone by the (world-frame) correction. Sets the local quat
   * absolutely from the live world quat each frame → converges, no accumulation.
   */
  private applyToHips(rotationWorld: THREE.Quaternion): void {
    if (!this.hipNode) return;
    this.hipNode.getWorldQuaternion(this._hipWorldQuat);
    this._newWorldQuat.copy(rotationWorld).multiply(this._hipWorldQuat);

    const parent = this.hipNode.parent;
    if (parent) {
      parent.getWorldQuaternion(this._parentWorldQuat).invert();
      this.hipNode.quaternion.copy(this._parentWorldQuat).multiply(this._newWorldQuat);
    } else {
      this.hipNode.quaternion.copy(this._newWorldQuat);
    }
  }

  /**
   * Distribute the correction across the spine chain. Each bone gets 1/N of the
   * (world) rotation; because each bone's rotation propagates to its children,
   * the N contributions compound to ≈ the full correction at the top — but the
   * pivots are up the spine, so hips and legs don't move and the torso curves.
   *
   * Post-multiplying the bone's local quat accumulates if nothing upstream
   * rewrites it, so we use the same idempotency trick as HipCompensator: strip
   * last frame's delta when the bone is untouched, keep it when upstream wrote
   * a fresh pose.
   */
  private applyToSpine(rotationWorld: THREE.Quaternion): void {
    const n = this.spineBones.length;
    if (n === 0) return;

    // Per-bone share of the world rotation.
    this._frac.slerpQuaternions(HipComRotator.IDENTITY, rotationWorld, 1 / n);

    for (const s of this.spineBones) {
      // Recover the base: if the bone still matches what we left it at, upstream
      // didn't refresh it → undo our delta. Otherwise keep the fresh pose.
      if (s.hasWritten && quatApproxEqual(s.node.quaternion, s.lastWritten)) {
        this._deltaInv.copy(s.lastDelta).invert();
        s.node.quaternion.multiply(this._deltaInv);
      }

      // Express the world-frame `_frac` as a local post-multiply on this bone:
      //   localDelta = W⁻¹ · frac · W   (W = bone world quat)
      // then bone.local · localDelta gives the bone a world rotation of `frac`.
      s.node.getWorldQuaternion(this._boneWorldQuat);
      this._boneWorldInv.copy(this._boneWorldQuat).invert();
      this._localDelta.copy(this._boneWorldInv)
        .multiply(this._frac)
        .multiply(this._boneWorldQuat);
      s.node.quaternion.multiply(this._localDelta);

      s.lastDelta.copy(this._localDelta);
      s.lastWritten.copy(s.node.quaternion);
      s.hasWritten = true;
    }
  }
}

/** Quaternions equal within a tight tolerance (handle double-cover via |dot|). */
function quatApproxEqual(a: THREE.Quaternion, b: THREE.Quaternion): boolean {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  return Math.abs(dot) > 1 - 1e-10;
}
