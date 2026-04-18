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
  LEFT_HIP:       23, RIGHT_HIP:      24,
} as const;

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

  /** Reset the running hip-width estimate; it'll refill on next good frame. */
  recalibrate(): void {
    this.performerHipWidth = 0;
    this._calibrated = false;
    this._emit();
  }

  /**
   * Called every mocap frame. Updates the running EMA of the performer's hip
   * width whenever both hip landmarks are sufficiently visible.
   */
  feed(frame: PoseFrame): void {
    const lms = frame.worldLandmarks;
    const lh = lms[LM.LEFT_HIP], rh = lms[LM.RIGHT_HIP];
    if (!lh || !rh) return;
    if ((lh.visibility ?? 0) < VIS_GATE) return;
    if ((rh.visibility ?? 0) < VIS_GATE) return;

    const raw = distance(lh, rh);
    if (raw < 1e-3) return;   // degenerate, ignore

    if (this.performerHipWidth <= 0) {
      this.performerHipWidth = raw;   // seed
      this._calibrated = true;
    } else {
      this.performerHipWidth = this.performerHipWidth * (1 - EMA_ALPHA) + raw * EMA_ALPHA;
    }
    this._emit();
  }

  /** Core scale: avatar hips / performer hips. 1 if not calibrated. */
  bodyScale(): number {
    if (!this._calibrated || this.performerHipWidth < 1e-4) return 1;
    return this.avatarHipWidth / this.performerHipWidth;
  }

  /** Per-side arm scale for IK target. Multiplies body scale by user override. */
  armScale(side: 'left' | 'right'): number {
    const override = side === 'left' ? this._overrideLeftArm : this._overrideRightArm;
    return this.bodyScale() * override;
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
      calibrated:        this._calibrated,
      bodyScale:         this.bodyScale(),
      leftArmScale:      this.armScale('left'),
      rightArmScale:     this.armScale('right'),
      shoulderWidthScale: this.shoulderWidthRatio(),
    };
  }

  private _emit(): void {
    this.onStatusChange?.(this.status());
  }
}
