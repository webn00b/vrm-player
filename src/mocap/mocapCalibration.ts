/**
 * Per-performer body-proportion calibration.
 *
 * Motivation: pure angle-driven retargeting (see DirectPoseApplier) sets each
 * bone's rotation from landmark directions. When the performer's proportions
 * differ from the avatar's — wider shoulders, longer forearms — the avatar's
 * hand ends up in a different world-space position than the performer's hand,
 * so the two hands don't "meet" in shots where they should.
 *
 * Fix: measure the performer's limb lengths from MediaPipe world-landmarks,
 * compare against the avatar's rest-pose bone lengths, and expose per-chain
 * scale ratios that a two-bone-IK solver can use to translate a performer
 * landmark position into an avatar-space target.
 *
 * Calibration is automatic: we accumulate samples from frames where all four
 * torso landmarks plus the arm landmarks have visibility ≥ 0.9, and finalise
 * after SAMPLE_TARGET accepted samples using the median to shrug off jitter
 * and occasional landmark mis-detections. A manual recalibrate() resets the
 * accumulator — use it after the performer swaps or changes camera distance.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { PoseFrame, Landmark3D } from './poseDetector';

// MediaPipe landmark indices (duplicated from directPoseApplier to avoid a cycle).
const LM = {
  LEFT_SHOULDER:  11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW:     13, RIGHT_ELBOW:    14,
  LEFT_WRIST:     15, RIGHT_WRIST:    16,
  LEFT_HIP:       23, RIGHT_HIP:      24,
} as const;

const SAMPLE_TARGET = 30;
const VIS_GATE = 0.9;
// Samples are only accepted when both arms are substantially straight — a bent
// arm's shoulder→wrist distance in MediaPipe world-landmarks is noisy along Z,
// and a bent-arm segment sum underestimates the real anatomy, inflating
// armScale and pushing the IK target out of reach. dist(s,w) ≥ STRAIGHT_GATE ×
// (dist(s,e)+dist(e,w)) ≈ 0.9 accepts near-T-pose frames where the length
// measurement actually matches the performer's arm.
const STRAIGHT_GATE = 0.88;

export interface CalibrationStatus {
  calibrated: boolean;
  sampleCount: number;
  sampleTarget: number;
  leftArmScale: number;   // avatarArm / performerArm — 1 when not calibrated
  rightArmScale: number;
  shoulderWidthScale: number;
}

interface Sample {
  shoulderWidth: number;
  leftUpperArm: number;
  leftLowerArm: number;
  rightUpperArm: number;
  rightLowerArm: number;
}

const _v = new THREE.Vector3();

function distance(a: Landmark3D, b: Landmark3D): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class MocapCalibration {
  // Avatar bone lengths — read once at construction from VRM rest pose.
  readonly avatarShoulderWidth: number;
  readonly avatarLeftUpperArm:  number;
  readonly avatarLeftLowerArm:  number;
  readonly avatarRightUpperArm: number;
  readonly avatarRightLowerArm: number;

  // Accumulating samples until we have enough.
  private samples: Sample[] = [];

  // Performer lengths (medianed across all samples). 0 until calibrated.
  private performerShoulderWidth = 0;
  private performerLeftUpperArm  = 0;
  private performerLeftLowerArm  = 0;
  private performerRightUpperArm = 0;
  private performerRightLowerArm = 0;

  private _calibrated = false;

  // User-facing slider multipliers — applied on top of auto-calibration so the
  // user can nudge the fit without re-running the sample buffer. Default 1.
  private _overrideShoulder = 1;
  private _overrideLeftArm  = 1;
  private _overrideRightArm = 1;

  /** Called when calibration state or sample count changes. */
  onStatusChange: ((s: CalibrationStatus) => void) | null = null;

  constructor(vrm: VRM) {
    // Normalized humanoid: each child bone's local .position is the rest-pose
    // offset from its parent in the parent's local frame. Its length is the
    // bone length (since normalization aligns the bone along its local Y).
    const humanoid = vrm.humanoid;
    const boneLen = (childName: string): number => {
      const node = humanoid.getNormalizedBoneNode(childName as any);
      return node ? node.position.length() : 0;
    };

    const lShoulderNode = humanoid.getNormalizedBoneNode('leftShoulder' as any)
      ?? humanoid.getNormalizedBoneNode('leftUpperArm' as any);
    const rShoulderNode = humanoid.getNormalizedBoneNode('rightShoulder' as any)
      ?? humanoid.getNormalizedBoneNode('rightUpperArm' as any);
    // Shoulder width = distance between left and right upperArm origins in world.
    vrm.scene.updateMatrixWorld(true);
    const lPos = new THREE.Vector3(), rPos = new THREE.Vector3();
    if (lShoulderNode && rShoulderNode) {
      humanoid.getNormalizedBoneNode('leftUpperArm'  as any)?.getWorldPosition(lPos);
      humanoid.getNormalizedBoneNode('rightUpperArm' as any)?.getWorldPosition(rPos);
    }
    this.avatarShoulderWidth = lPos.distanceTo(rPos);

    this.avatarLeftUpperArm  = boneLen('leftLowerArm');   // upperArm length = distance to child (lowerArm)
    this.avatarLeftLowerArm  = boneLen('leftHand');       // lowerArm length = distance to child (hand)
    this.avatarRightUpperArm = boneLen('rightLowerArm');
    this.avatarRightLowerArm = boneLen('rightHand');
  }

  get calibrated(): boolean { return this._calibrated; }
  get sampleCount(): number { return this.samples.length; }

  /** Reset accumulator — calibration will re-run on next high-visibility frames. */
  recalibrate(): void {
    this.samples = [];
    this._calibrated = false;
    this.performerShoulderWidth = 0;
    this.performerLeftUpperArm  = 0;
    this.performerLeftLowerArm  = 0;
    this.performerRightUpperArm = 0;
    this.performerRightLowerArm = 0;
    this._emit();
  }

  /** Feed every mocap frame. Silently no-ops once calibrated. */
  feed(frame: PoseFrame): void {
    if (this._calibrated) return;

    const lms = frame.worldLandmarks;
    const ls = lms[LM.LEFT_SHOULDER], rs = lms[LM.RIGHT_SHOULDER];
    const le = lms[LM.LEFT_ELBOW],    re = lms[LM.RIGHT_ELBOW];
    const lw = lms[LM.LEFT_WRIST],    rw = lms[LM.RIGHT_WRIST];
    if (!ls || !rs || !le || !re || !lw || !rw) return;

    const v = (lm: Landmark3D): number => lm.visibility ?? 0;
    if (v(ls) < VIS_GATE || v(rs) < VIS_GATE) return;
    if (v(le) < VIS_GATE || v(re) < VIS_GATE) return;
    if (v(lw) < VIS_GATE || v(rw) < VIS_GATE) return;

    // Reject bent arms. A bent arm underestimates true arm length and inflates
    // armScale. Measure straightness as directness = |s→w| / (|s→e|+|e→w|).
    const leftUpper  = distance(ls, le);
    const leftLower  = distance(le, lw);
    const rightUpper = distance(rs, re);
    const rightLower = distance(re, rw);
    const leftSpan   = distance(ls, lw);
    const rightSpan  = distance(rs, rw);
    const leftStraight  = leftSpan  / Math.max(1e-6, leftUpper  + leftLower);
    const rightStraight = rightSpan / Math.max(1e-6, rightUpper + rightLower);
    if (leftStraight < STRAIGHT_GATE || rightStraight < STRAIGHT_GATE) return;

    this.samples.push({
      shoulderWidth: distance(ls, rs),
      leftUpperArm:  leftUpper,
      leftLowerArm:  leftLower,
      rightUpperArm: rightUpper,
      rightLowerArm: rightLower,
    });

    if (this.samples.length >= SAMPLE_TARGET) {
      this._finalise();
    } else {
      this._emit();
    }
  }

  private _finalise(): void {
    this.performerShoulderWidth = median(this.samples.map(s => s.shoulderWidth));
    this.performerLeftUpperArm  = median(this.samples.map(s => s.leftUpperArm));
    this.performerLeftLowerArm  = median(this.samples.map(s => s.leftLowerArm));
    this.performerRightUpperArm = median(this.samples.map(s => s.rightUpperArm));
    this.performerRightLowerArm = median(this.samples.map(s => s.rightLowerArm));
    this._calibrated = true;
    this._emit();
  }

  /**
   * Per-side arm scale: avatar whole-arm length / performer whole-arm length,
   * multiplied by the user-slider override (default 1). Returns 1 until
   * calibration completes (effectively disabling IK scaling).
   */
  armScale(side: 'left' | 'right'): number {
    const override = side === 'left' ? this._overrideLeftArm : this._overrideRightArm;
    if (!this._calibrated) return override;
    const avatar = side === 'left'
      ? this.avatarLeftUpperArm  + this.avatarLeftLowerArm
      : this.avatarRightUpperArm + this.avatarRightLowerArm;
    const performer = side === 'left'
      ? this.performerLeftUpperArm  + this.performerLeftLowerArm
      : this.performerRightUpperArm + this.performerRightLowerArm;
    if (performer < 1e-4) return override;
    return (avatar / performer) * override;
  }

  /** Avatar's upperArm length for the given side (metres). */
  upperArmLength(side: 'left' | 'right'): number {
    return side === 'left' ? this.avatarLeftUpperArm : this.avatarRightUpperArm;
  }
  /** Avatar's lowerArm length for the given side (metres). */
  lowerArmLength(side: 'left' | 'right'): number {
    return side === 'left' ? this.avatarLeftLowerArm : this.avatarRightLowerArm;
  }

  /**
   * Ratio avatar shoulder width / performer shoulder width. Used to scale
   * the cross-body (shoulder-axis) component of landmark offsets so the
   * avatar's hands meet at its midline when the performer's hands meet at
   * theirs — even when the two have different shoulder widths. Returns 1
   * until calibration completes.
   */
  shoulderWidthRatio(): number {
    if (!this._calibrated || this.performerShoulderWidth < 1e-4) return this._overrideShoulder;
    return (this.avatarShoulderWidth / this.performerShoulderWidth) * this._overrideShoulder;
  }

  /** User slider multipliers on top of auto-calibration. 1 = neutral. */
  setOverride(kind: 'shoulder' | 'leftArm' | 'rightArm', v: number): void {
    const clamped = Math.max(0.1, Math.min(3, v));
    if (kind === 'shoulder')   this._overrideShoulder = clamped;
    if (kind === 'leftArm')    this._overrideLeftArm  = clamped;
    if (kind === 'rightArm')   this._overrideRightArm = clamped;
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
      calibrated: this._calibrated,
      sampleCount: this.samples.length,
      sampleTarget: SAMPLE_TARGET,
      leftArmScale:  this.armScale('left'),
      rightArmScale: this.armScale('right'),
      shoulderWidthScale: this._calibrated && this.performerShoulderWidth > 1e-4
        ? this.avatarShoulderWidth / this.performerShoulderWidth
        : 1,
    };
  }

  private _emit(): void {
    this.onStatusChange?.(this.status());
  }
}
