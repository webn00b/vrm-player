import * as THREE from 'three';
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';

/**
 * Closed-loop hip-angle corrector. Reads hip's CURRENT world quaternion
 * (post-animation, post-mocap, post-manual-offsets, pre-vrm-springs),
 * computes the world-down direction expressed in hip-local space, and
 * post-multiplies a counter-rotation that aligns hip-local +Y with world +Y.
 *
 * Why we read hip directly instead of via HipForceTracker:
 * Using HipForceTracker.latest introduces one frame of lag — the corrector
 * acts on the previous frame's state, the animation overwrites hip every
 * frame, and the loop settles on `tilt_visible = tilt_authored / (1 + k)`
 * where k is the loop gain. With realistic clamps and animation re-tilting
 * 17° every frame, k ≈ 1, so we float around half the original tilt and
 * see "model moves with a small lean". Reading the LIVE hip orientation
 * collapses the lag to zero and the correction becomes deterministic:
 * one step removes exactly `strength × current_tilt` of the lean.
 *
 * Math:
 *   q_hip_world = hip's current world rotation
 *   down_in_hip_local = q_hip_world.inverse() · (0, -1, 0)
 *     For hip upright: down_in_hip_local = (0, -1, 0).
 *     For hip leaning forward by α: down_in_hip_local = (0, -cos α, +sin α).
 *     For hip leaning right by β:   down_in_hip_local = (+sin β, -cos β, 0).
 *   tilt_X (pitch) = atan2(down.z, -down.y)   ← +Z means leaning forward
 *   tilt_Z (roll ) = atan2(down.x, -down.y)   ← +X means leaning right
 *   correction angles = -strength × (tilt_X, tilt_Z), clamped, EMA-smoothed
 *   q_correction = R_X(θ_X) ∘ R_Z(θ_Z)
 *   hip.quaternion = hip.quaternion × q_correction   (post-multiply)
 *
 * `strength` ∈ [0, 1] controls how much of the natural lean to remove.
 * 1.0 = full upright every frame. 0.5 = halve the lean. Useful when an
 * animation's authored lean is intentional and we only want to soften it.
 *
 * Caveat — what this CAN'T fix:
 * Only corrects the hip BONE'S orientation. If a clip leaves the hip level
 * but bends the spine forward, the avatar visually leans but `down_in_hip`
 * is still (0,-1,0) and we apply zero correction. To compensate spine
 * bending we'd need a torque-based signal (Σ r×F about hip pivot) and
 * distribute the counter-rotation across spine joints — that's v2.
 */
export interface HipBalanceCorrectorOptions {
  /**
   * Fraction of measured tilt to remove per frame. 1.0 = full compensation
   * (one-frame settling). 0.0 = no-op. Default 1.0 — the corrector is
   * already opt-in via the debug toggle, so when it's on we want it to
   * actually do something visible.
   */
  strength?: number;
  /** Hard clamp on per-axis correction angle [rad]. Default 45° = 0.785. */
  maxAngle?: number;
  /**
   * EMA blend factor on smoothed correction angle (frame to frame).
   * 0 = full smoothing (frozen), 1 = no smoothing (raw target each frame).
   * Default 0.5 — moderate smoothing kills jitter from animation chatter
   * without introducing visible lag.
   */
  smoothing?: number;
  /** Default OFF — opt-in via debug toggle so the user explicitly enables it. */
  enabled?: boolean;
}

export class HipBalanceCorrector {
  private readonly hipNode: THREE.Object3D | null;
  private strengthV: number;
  private maxAngleV: number;
  private smoothingV: number;
  private enabledV: boolean;

  /** EMA-smoothed correction angles (radians around hip-local X and Z). */
  private smoothX = 0;
  private smoothZ = 0;
  private hasState = false;

  // Scratch buffers — never `new`'d in apply().
  private static readonly X_AXIS = new THREE.Vector3(1, 0, 0);
  private static readonly Z_AXIS = new THREE.Vector3(0, 0, 1);
  private readonly _hipWorldQuat = new THREE.Quaternion();
  private readonly _down = new THREE.Vector3();
  private readonly _qx = new THREE.Quaternion();
  private readonly _qz = new THREE.Quaternion();
  private readonly _delta = new THREE.Quaternion();

  constructor(vrm: VRM, opts: HipBalanceCorrectorOptions = {}) {
    this.hipNode = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    this.strengthV = opts.strength ?? 1.0;
    this.maxAngleV = opts.maxAngle ?? (45 * Math.PI / 180);
    this.smoothingV = opts.smoothing ?? 0.5;
    this.enabledV = opts.enabled ?? false;
  }

  reset(): void {
    this.smoothX = 0;
    this.smoothZ = 0;
    this.hasState = false;
  }

  set enabled(v: boolean) {
    if (v === this.enabledV) return;
    this.enabledV = v;
    if (!v) this.reset();
  }
  get enabled(): boolean { return this.enabledV; }

  set strength(v: number) { this.strengthV = THREE.MathUtils.clamp(v, 0, 1); }
  get strength(): number { return this.strengthV; }

  /** Latest applied correction in degrees (read by debug panel). */
  get latestAnglesDeg(): { x: number; z: number } {
    return {
      x: this.smoothX * 180 / Math.PI,
      z: this.smoothZ * 180 / Math.PI,
    };
  }

  /**
   * Read hip's current world rotation, compute counter-rotation in hip-local,
   * post-multiply onto hip.quaternion. No arguments: deliberately self-
   * contained to avoid the one-frame lag of reading from HipForceTracker.
   */
  apply(): void {
    if (!this.enabledV || !this.hipNode) return;

    // Hip's current world quaternion (after all upstream layers — animation,
    // mocap, manual offsets, validator, micro). Inverting it gives the
    // mapping from world axes to hip-local axes.
    this.hipNode.getWorldQuaternion(this._hipWorldQuat).invert();
    this._down.set(0, -1, 0).applyQuaternion(this._hipWorldQuat);

    // tilt_X positive ⇒ hip leans forward ⇒ down has +Z in hip-local.
    // tilt_Z positive ⇒ hip leans right   ⇒ down has +X in hip-local.
    // Use atan2 (not small-angle) so we behave correctly past 45° too.
    const minusY = -this._down.y;
    const tiltX = Math.atan2(this._down.z, minusY);
    const tiltZ = Math.atan2(this._down.x, minusY);

    // Correction = rotate hip BACK by the measured tilt, scaled by strength.
    //
    // Sign asymmetry (X vs Z): rotation around +X by +α takes +Y to +Z (spine
    // tilts forward by α), so Q_lean_forward = R_X(+α) and the inverse needed
    // to undo it is R_X(-α) ⇒ targetX = -tiltX. But rotation around +Z by +γ
    // takes +Y to -X (spine tilts LEFT by γ), so leaning RIGHT by γ_R means
    // Q_lean_right = R_Z(-γ_R), and the inverse to undo is R_Z(+γ_R) — same
    // sign as tiltZ ⇒ targetZ = +tiltZ. Verified empirically: corrector that
    // negates both axes was doubling lateral leans into the maxAngle clamp.
    const targetX = THREE.MathUtils.clamp(
      -tiltX * this.strengthV,
      -this.maxAngleV,
       this.maxAngleV,
    );
    const targetZ = THREE.MathUtils.clamp(
      +tiltZ * this.strengthV,
      -this.maxAngleV,
       this.maxAngleV,
    );

    // EMA on the angle so frame-to-frame animation chatter doesn't visibly
    // jitter the hip. Smoothing here is purely cosmetic; the closed loop
    // doesn't NEED smoothing for stability now that the lag is gone.
    if (!this.hasState) {
      this.smoothX = targetX;
      this.smoothZ = targetZ;
      this.hasState = true;
    } else {
      this.smoothX = this.smoothX * (1 - this.smoothingV) + targetX * this.smoothingV;
      this.smoothZ = this.smoothZ * (1 - this.smoothingV) + targetZ * this.smoothingV;
    }

    // Build delta = R_X(θ_x) ∘ R_Z(θ_z), post-multiply onto hip's current
    // local quaternion. Order between the two single-axis rotations is
    // negligible for the angle ranges we hit in practice.
    this._qx.setFromAxisAngle(HipBalanceCorrector.X_AXIS, this.smoothX);
    this._qz.setFromAxisAngle(HipBalanceCorrector.Z_AXIS, this.smoothZ);
    this._delta.copy(this._qx).multiply(this._qz);
    this.hipNode.quaternion.multiply(this._delta);
  }
}
