/**
 * Per-frame hip-anchored body scale for mocap IK.
 *
 * Philosophy: the avatar and the performer almost always have different body
 * proportions. To make the avatar's hand land where the performer's hand lands
 * we need to scale the performer's landmark positions to avatar-space. The
 * most stable anchor for that scale is the HIP WIDTH — hips are large, always
 * visible when the body is in frame, don't bend, and MediaPipe's world-
 * landmarks deliver them in real metres.
 *
 *   scale = avatarHipWidth / performerHipWidth      (per-frame)
 *
 * This is what SystemAnimator / sysAnimOnline does, and it's the reason their
 * output is stable without a T-pose calibration step. Performer distance from
 * camera, arm bend, per-session body differences — all handled automatically
 * because the scale is re-derived each frame from a stable reference.
 *
 * Previous version required 30 T-pose samples and measured arm length — that
 * was noisy along MediaPipe's Z axis and blew up when the arms were bent.
 *
 * User-facing slider overrides (shoulder / leftArm / rightArm) are kept and
 * now layer on top of the per-frame hip scale, so a stylised avatar with
 * unusual proportions can be tuned manually.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { PoseFrame, Landmark3D } from './poseDetector';

const LM = {
  LEFT_SHOULDER:  11, RIGHT_SHOULDER: 12,
  LEFT_WRIST:     15, RIGHT_WRIST:    16,
  LEFT_HIP:       23, RIGHT_HIP:      24,
  LEFT_ANKLE:     27, RIGHT_ANKLE:    28,
} as const;

// Relaxed gate for wrist landmarks (often partially occluded)
const WRIST_VIS_GATE = 0.4;

const VIS_GATE = 0.7;
const EMA_ALPHA = 0.15;  // smoothing of hip-width measurement — enough to kill
                         // jitter, light enough to follow if the performer
                         // steps toward/away from the camera.

export interface CalibrationStatus {
  calibrated: boolean;
  /** avatarHipWidth / performerHipWidth — the core scale factor. 1 when uncal. */
  bodyScale: number;
  leftArmScale: number;   // bodyScale * leftArm override
  rightArmScale: number;  // bodyScale * rightArm override
  shoulderWidthScale: number; // bodyScale * shoulder override
}

function distance(a: Landmark3D, b: Landmark3D): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class MocapCalibration {
  /** Avatar hip width (distance between leftUpperLeg and rightUpperLeg world
   *  positions in rest pose), read once at construction. */
  readonly avatarHipWidth: number;

  /** Avatar limb bone lengths — still needed by the IK solver. */
  readonly avatarLeftUpperArm:  number;
  readonly avatarLeftLowerArm:  number;
  readonly avatarRightUpperArm: number;
  readonly avatarRightLowerArm: number;
  readonly avatarLeftUpperLeg:  number;
  readonly avatarLeftLowerLeg:  number;
  readonly avatarRightUpperLeg: number;
  readonly avatarRightLowerLeg: number;

  /** Live EMA of performer hip width in metres. 0 until first valid frame. */
  private performerHipWidth = 0;
  /** Live EMA of performer hip-to-ankle length (max of both sides). 0 until first valid frame. */
  private performerLegLen = 0;
  /**
   * Decaying maximum of performer shoulder-to-wrist distance, per side.
   * Mirror mapping: character LEFT arm ← performer RIGHT (index 12/16).
   *                 character RIGHT arm ← performer LEFT (index 11/15).
   *
   * WHY MAX not EMA-mean: EMA tracks the average arm extension (~80% of max),
   * making armScale = avatarArm/mean ~1.0. When the performer fully extends their
   * arm the IK target exceeds avatar arm length → arm always fully extended, can't
   * bend. With max-based scale = avatarArm/max the arm correctly bends when bent
   * and only fully extends when performer extends fully.
   *
   * Slow decay (×0.9997/frame) lets the reference re-calibrate over ~10 min if the
   * performer never extends their arm fully in a new session.
   */
  private performerRightArmMax = 0;  // drives character LEFT arm
  private performerLeftArmMax  = 0;  // drives character RIGHT arm
  private _calibrated = false;

  // User slider multipliers — 1 = neutral.
  private _overrideShoulder = 1;
  private _overrideLeftArm  = 1;
  private _overrideRightArm = 1;

  onStatusChange: ((s: CalibrationStatus) => void) | null = null;

  constructor(vrm: VRM) {
    const humanoid = vrm.humanoid;
    vrm.scene.updateMatrixWorld(true);

    const boneLen = (childName: string): number => {
      const node = humanoid.getNormalizedBoneNode(childName as any);
      return node ? node.position.length() : 0;
    };

    // Hip width = world distance between leftUpperLeg and rightUpperLeg origins.
    const lHipNode = humanoid.getNormalizedBoneNode('leftUpperLeg'  as any);
    const rHipNode = humanoid.getNormalizedBoneNode('rightUpperLeg' as any);
    const lPos = new THREE.Vector3(), rPos = new THREE.Vector3();
    lHipNode?.getWorldPosition(lPos);
    rHipNode?.getWorldPosition(rPos);
    this.avatarHipWidth = lPos.distanceTo(rPos);

    // Arm bone lengths (child bone's local position length = bone length).
    this.avatarLeftUpperArm  = boneLen('leftLowerArm');
    this.avatarLeftLowerArm  = boneLen('leftHand');
    this.avatarRightUpperArm = boneLen('rightLowerArm');
    this.avatarRightLowerArm = boneLen('rightHand');

    // Leg bone lengths (upperLeg = distance to lowerLeg, lowerLeg = to foot).
    this.avatarLeftUpperLeg  = boneLen('leftLowerLeg');
    this.avatarLeftLowerLeg  = boneLen('leftFoot');
    this.avatarRightUpperLeg = boneLen('rightLowerLeg');
    this.avatarRightLowerLeg = boneLen('rightFoot');
  }

  get calibrated(): boolean { return this._calibrated; }

  /** Reset the running measurements; they'll refill on next good frames. */
  recalibrate(): void {
    this.performerHipWidth    = 0;
    this.performerLegLen      = 0;
    this.performerRightArmMax = 0;
    this.performerLeftArmMax  = 0;
    this._calibrated = false;
    this._emit();
  }

  /**
   * Called every mocap frame. Updates the running EMA of the performer's hip
   * width whenever both hip landmarks are sufficiently visible.
   */
  feed(frame: PoseFrame): void {
    const lms = frame.worldLandmarks;
    const lh = lms[LM.LEFT_HIP],  rh = lms[LM.RIGHT_HIP];
    const la = lms[LM.LEFT_ANKLE], ra = lms[LM.RIGHT_ANKLE];
    if (!lh || !rh) return;
    if ((lh.visibility ?? 1) < VIS_GATE) return;
    if ((rh.visibility ?? 1) < VIS_GATE) return;

    const rawHip = distance(lh, rh);
    if (rawHip < 1e-3) return;

    if (this.performerHipWidth <= 0) {
      this.performerHipWidth = rawHip;
      this._calibrated = true;
    } else {
      this.performerHipWidth = this.performerHipWidth * (1 - EMA_ALPHA) + rawHip * EMA_ALPHA;
    }

    // Track performer leg length (hip-to-ankle) for leg IK scaling.
    let rawLeg = 0;
    if (la && (la.visibility ?? 1) >= VIS_GATE) rawLeg = Math.max(rawLeg, distance(lh, la));
    if (ra && (ra.visibility ?? 1) >= VIS_GATE) rawLeg = Math.max(rawLeg, distance(rh, ra));
    if (rawLeg > 1e-3) {
      if (this.performerLegLen <= 0) this.performerLegLen = rawLeg;
      else this.performerLegLen = this.performerLegLen * (1 - EMA_ALPHA) + rawLeg * EMA_ALPHA;
    }

    // Track performer arm lengths (shoulder-to-wrist) for arm IK scaling.
    // Mirror mapping: character LEFT arm ← performer RIGHT (12→16); RIGHT ← LEFT (11→15).
    const lms2 = frame.worldLandmarks;
    const ls = lms2[LM.LEFT_SHOULDER], rs = lms2[LM.RIGHT_SHOULDER];
    const lw = lms2[LM.LEFT_WRIST],   rw = lms2[LM.RIGHT_WRIST];
    const ARM_MAX_DECAY = 0.9999;
    if (rs && rw && (rs.visibility ?? 1) >= WRIST_VIS_GATE && (rw.visibility ?? 1) >= WRIST_VIS_GATE) {
      const raw = distance(rs, rw);
      if (raw > 1e-3) {
        this.performerRightArmMax = Math.max(raw, this.performerRightArmMax * ARM_MAX_DECAY);
      }
    }
    if (ls && lw && (ls.visibility ?? 1) >= WRIST_VIS_GATE && (lw.visibility ?? 1) >= WRIST_VIS_GATE) {
      const raw = distance(ls, lw);
      if (raw > 1e-3) {
        this.performerLeftArmMax = Math.max(raw, this.performerLeftArmMax * ARM_MAX_DECAY);
      }
    }

    this._emit();
  }

  /** Core scale: avatar hips / performer hips. 1 if not calibrated. */
  bodyScale(): number {
    if (!this._calibrated || this.performerHipWidth < 1e-4) return 1;
    return this.avatarHipWidth / this.performerHipWidth;
  }

  /**
   * Leg scale: avatarLegLength / performerLegLength.
   * Falls back to bodyScale() when leg length hasn't been observed yet
   * (e.g. video shows only the upper body).
   */
  legScale(): number {
    if (this.performerLegLen < 1e-3) return this.bodyScale();
    const avatarLegLen = (this.avatarLeftUpperLeg + this.avatarLeftLowerLeg +
                          this.avatarRightUpperLeg + this.avatarRightLowerLeg) * 0.5;
    return avatarLegLen / this.performerLegLen;
  }

  /**
   * Per-side arm scale for IK target.
   * Uses avatarArmLength / performerArmLength when the EMA has converged;
   * falls back to bodyScale() until enough arm observations are collected.
   * Mirror mapping: side='left' uses performer's RIGHT arm (12/16).
   */
  armScale(side: 'left' | 'right'): number {
    const override = side === 'left' ? this._overrideLeftArm : this._overrideRightArm;
    if (side === 'left') {
      const perfLen = this.performerRightArmMax;
      const avatarLen = this.avatarLeftUpperArm + this.avatarLeftLowerArm;
      if (perfLen < 1e-3) return this.bodyScale() * override;
      return (avatarLen / perfLen) * override;
    } else {
      const perfLen = this.performerLeftArmMax;
      const avatarLen = this.avatarRightUpperArm + this.avatarRightLowerArm;
      if (perfLen < 1e-3) return this.bodyScale() * override;
      return (avatarLen / perfLen) * override;
    }
  }

  /** Cross-body (shoulder-axis) scale factor. Multiplies body scale by override. */
  shoulderWidthRatio(): number {
    return this.bodyScale() * this._overrideShoulder;
  }

  /** Avatar upperArm length for the given side (metres). Used by IK solver. */
  upperArmLength(side: 'left' | 'right'): number {
    return side === 'left' ? this.avatarLeftUpperArm : this.avatarRightUpperArm;
  }
  /** Avatar lowerArm length for the given side (metres). Used by IK solver. */
  lowerArmLength(side: 'left' | 'right'): number {
    return side === 'left' ? this.avatarLeftLowerArm : this.avatarRightLowerArm;
  }

  /** Avatar upperLeg length for the given side (metres). Used by leg IK. */
  upperLegLength(side: 'left' | 'right'): number {
    return side === 'left' ? this.avatarLeftUpperLeg : this.avatarRightUpperLeg;
  }
  /** Avatar lowerLeg length for the given side (metres). Used by leg IK. */
  lowerLegLength(side: 'left' | 'right'): number {
    return side === 'left' ? this.avatarLeftLowerLeg : this.avatarRightLowerLeg;
  }

  setOverride(kind: 'shoulder' | 'leftArm' | 'rightArm', v: number): void {
    const clamped = Math.max(0.1, Math.min(3, v));
    if (kind === 'shoulder') this._overrideShoulder = clamped;
    if (kind === 'leftArm')  this._overrideLeftArm  = clamped;
    if (kind === 'rightArm') this._overrideRightArm = clamped;
    this._emit();
  }

  getOverrides(): { shoulder: number; leftArm: number; rightArm: number } {
    return {
      shoulder: this._overrideShoulder,
      leftArm:  this._overrideLeftArm,
      rightArm: this._overrideRightArm,
    };
  }

  status(): CalibrationStatus {
    return {
      calibrated:         this._calibrated,
      bodyScale:          this.bodyScale(),
      leftArmScale:       this.armScale('left'),
      rightArmScale:      this.armScale('right'),
      shoulderWidthScale: this.shoulderWidthRatio(),
    };
  }

  private _emit(): void {
    this.onStatusChange?.(this.status());
  }
}
