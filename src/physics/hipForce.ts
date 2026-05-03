import * as THREE from 'three';
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { DEFAULT_BODY_MASS_KG, SEGMENT_MASS_FRACTION } from './boneMasses';

/**
 * Per-frame estimate of the net force acting on the avatar's hip joint from
 * the upper half of the body — gravity (constant per segment mass) + inertia
 * (finite-difference acceleration of each segment's world position).
 *
 * v1 use case: read-out in debug panel to sanity-check the math against real
 * motion. Once numbers look plausible, the same vector can feed into the
 * direct-pose solver for balance / leg weight redistribution.
 *
 * Why a class with private state instead of a pure function: inertia is a
 * second derivative of position, so we need the previous frame's smoothed
 * velocity to compute acceleration. Stashing that per-bone state in
 * `bone.userData` would conflict with retarget code that already mutates VRM
 * bones (see fbxRetargetWorld rest-snapshot fix). Module-private maps keyed
 * by VRMHumanBoneName keep the state isolated and easy to clear on clip
 * change / pause without coordinating with anyone else.
 */
export interface HipForceResult {
  /** Sum of segment masses participating in the calculation (kg). */
  totalMass: number;
  /** Gravity force on the upper body, world frame (Newtons, +Y up). */
  gravityWorld: THREE.Vector3;
  /** Inertia force `Σ(-m·a)` on the upper body, world frame. */
  inertiaWorld: THREE.Vector3;
  /** Gravity + inertia, world frame. */
  totalWorld: THREE.Vector3;
  /**
   * Total force expressed in the hip's local frame: roughly, +Y_hip points up
   * the spine. Useful for "tilt vs spine" diagnostics — a healthy stance has
   * the gravity pull along +Y_hip; large lateral components indicate the
   * upper body is leaning.
   */
  totalInHipSpace: THREE.Vector3;
  /** False on the first 1–2 frames after reset(): velocity not yet available. */
  ready: boolean;
}

export interface HipForceOptions {
  /** Total body mass (kg). Segment masses = bodyMassKg × SEGMENT_MASS_FRACTION. */
  bodyMassKg?: number;
  /** Gravity acceleration magnitude (m/s²). */
  gravity?: number;
  /** EMA smoothing on velocity. 0 = no smoothing (very noisy), 1 = freeze. */
  velEmaAlpha?: number;
  /** Lower clamp on dt (seconds) — prevents Δv/dt blowup at huge FPS. */
  dtMin?: number;
  /** Upper clamp on dt (seconds) — prevents pause/tab-switch outliers. */
  dtMax?: number;
  /** Max plausible acceleration magnitude (m/s²); larger = treated as teleport. */
  accMaxMag?: number;
  /** Pause-state probe; on transition paused→running we auto-reset(). */
  isPaused?: () => boolean;
}

interface BoneSlot {
  boneName: VRMHumanBoneName;
  node: THREE.Object3D;
  mass: number;
  prevPos: THREE.Vector3;
  prevVel: THREE.Vector3;
  hasPrev: boolean;
}

const ZERO_RESULT: HipForceResult = {
  totalMass: 0,
  gravityWorld: new THREE.Vector3(),
  inertiaWorld: new THREE.Vector3(),
  totalWorld: new THREE.Vector3(),
  totalInHipSpace: new THREE.Vector3(),
  ready: false,
};

export class HipForceTracker {
  private readonly vrm: VRM;
  private readonly bodyMassKg: number;
  private readonly gravity: number;
  private readonly velEmaAlpha: number;
  private readonly dtMin: number;
  private readonly dtMax: number;
  private readonly accMaxMag: number;
  private readonly isPausedFn?: () => boolean;
  private wasPaused = false;

  private readonly hipNode: THREE.Object3D | null;
  private readonly slots: BoneSlot[] = [];
  private warmupFrames = 0;

  // Scratch — preallocated, never `new`'d in update().
  private readonly _scratchPos = new THREE.Vector3();
  private readonly _scratchVel = new THREE.Vector3();
  private readonly _scratchAcc = new THREE.Vector3();
  private readonly _scratchInertia = new THREE.Vector3();
  private readonly _scratchHipQuat = new THREE.Quaternion();

  // Output buffers — reused frame-to-frame, mutated in place. Caller must not
  // retain the references across frames if it wants stable values.
  private readonly _outGravity = new THREE.Vector3();
  private readonly _outInertia = new THREE.Vector3();
  private readonly _outTotal = new THREE.Vector3();
  private readonly _outTotalHipSpace = new THREE.Vector3();
  private _latest: HipForceResult | null = null;

  constructor(vrm: VRM, opts: HipForceOptions = {}) {
    this.vrm = vrm;
    this.bodyMassKg = opts.bodyMassKg ?? DEFAULT_BODY_MASS_KG;
    this.gravity = opts.gravity ?? 9.81;
    this.velEmaAlpha = opts.velEmaAlpha ?? 0.3;
    this.dtMin = opts.dtMin ?? 1e-3;
    this.dtMax = opts.dtMax ?? 1 / 15;
    this.accMaxMag = opts.accMaxMag ?? 200;
    this.isPausedFn = opts.isPaused;

    this.hipNode = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);

    let totalMass = 0;
    for (const [name, fraction] of Object.entries(SEGMENT_MASS_FRACTION) as Array<
      [VRMHumanBoneName, number]
    >) {
      if (!fraction) continue;
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      const mass = this.bodyMassKg * fraction;
      totalMass += mass;
      this.slots.push({
        boneName: name,
        node,
        mass,
        prevPos: new THREE.Vector3(),
        prevVel: new THREE.Vector3(),
        hasPrev: false,
      });
    }

    // Move chest's mass over to spine if no chest bone exists in the rig —
    // common on minimal humanoids that only expose hips/spine/head.
    if (totalMass < this.bodyMassKg * 0.3 && this.slots.length > 0) {
      console.warn(
        `[hipForce] only ${this.slots.length} upper-body bones found on rig; ` +
        `total tracked mass = ${totalMass.toFixed(1)} kg of ${this.bodyMassKg}.`,
      );
    }

    this._latest = { ...ZERO_RESULT };
  }

  /** Drop accumulated state. Call on clip change / pause→resume / teleport. */
  reset(): void {
    for (const slot of this.slots) {
      slot.hasPrev = false;
      slot.prevPos.set(0, 0, 0);
      slot.prevVel.set(0, 0, 0);
    }
    this.warmupFrames = 0;
    this._latest = { ...ZERO_RESULT };
  }

  /** Most recent computed result (for read-only consumers like debug panel). */
  get latest(): HipForceResult | null {
    return this._latest;
  }

  /** Per-frame tick. Returns the freshly computed result. */
  update(dt: number): HipForceResult {
    // Auto-reset on pause→resume transition. While paused, return the last
    // known result without recomputing — bones aren't moving anyway.
    const paused = this.isPausedFn?.() ?? false;
    if (paused) {
      this.wasPaused = true;
      return this._latest ?? ZERO_RESULT;
    }
    if (this.wasPaused && !paused) {
      this.reset();
      this.wasPaused = false;
    }

    if (!this.hipNode || this.slots.length === 0) {
      return this._latest ?? ZERO_RESULT;
    }

    const dtClamped = Math.max(this.dtMin, Math.min(dt, this.dtMax));

    this._outGravity.set(0, 0, 0);
    this._outInertia.set(0, 0, 0);
    let totalMassAccum = 0;
    let anyAcc = false;

    for (const slot of this.slots) {
      slot.node.getWorldPosition(this._scratchPos);
      totalMassAccum += slot.mass;

      // Gravity is constant — accumulate every frame regardless of warmup.
      this._outGravity.y -= slot.mass * this.gravity;

      if (!slot.hasPrev) {
        // First sample: stash position, no velocity yet.
        slot.prevPos.copy(this._scratchPos);
        slot.prevVel.set(0, 0, 0);
        slot.hasPrev = true;
        continue;
      }

      // velRaw = (pos - prevPos) / dt
      this._scratchVel.subVectors(this._scratchPos, slot.prevPos)
                      .divideScalar(dtClamped);

      // EMA on velocity, not on acceleration — smoothing acceleration would
      // phase-shift gravity, but we only want gravity to come through pure.
      this._scratchVel.lerpVectors(slot.prevVel, this._scratchVel, this.velEmaAlpha);

      // acc = (velSmoothed - prevVel) / dt
      this._scratchAcc.subVectors(this._scratchVel, slot.prevVel)
                      .divideScalar(dtClamped);

      // Clip teleport-style accelerations (clip change without reset, drag
      // tool snapping a bone, etc.) so a single bad frame doesn't pollute
      // hours of legitimate motion.
      if (this._scratchAcc.length() > this.accMaxMag) {
        this._scratchAcc.set(0, 0, 0);
      } else {
        anyAcc = true;
      }

      // F_inertia += -m * a   (d'Alembert)
      this._scratchInertia.copy(this._scratchAcc).multiplyScalar(-slot.mass);
      this._outInertia.add(this._scratchInertia);

      slot.prevPos.copy(this._scratchPos);
      slot.prevVel.copy(this._scratchVel);
    }

    if (this.warmupFrames < 2) this.warmupFrames++;

    this._outTotal.copy(this._outGravity).add(this._outInertia);

    // Express F_total in hip-local frame: F_local = q_hip⁻¹ × F_world.
    this.hipNode.getWorldQuaternion(this._scratchHipQuat).invert();
    this._outTotalHipSpace.copy(this._outTotal).applyQuaternion(this._scratchHipQuat);

    // Build the result. Reuse the same buffers — caller is expected to either
    // consume immediately or .clone() the vectors it cares about.
    const result: HipForceResult = {
      totalMass: totalMassAccum,
      gravityWorld: this._outGravity,
      inertiaWorld: this._outInertia,
      totalWorld: this._outTotal,
      totalInHipSpace: this._outTotalHipSpace,
      ready: this.warmupFrames >= 2 && anyAcc,
    };
    this._latest = result;
    return result;
  }
}
