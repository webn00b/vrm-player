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
import type { PoseFrame, Landmark3D } from '../pipeline/poseDetector';

const LM = {
  LEFT_EAR:       7,  RIGHT_EAR:      8,
  LEFT_SHOULDER:  11, RIGHT_SHOULDER: 12,
  LEFT_WRIST:     15, RIGHT_WRIST:    16,
  LEFT_HIP:       23, RIGHT_HIP:      24,
  LEFT_ANKLE:     27, RIGHT_ANKLE:    28,
} as const;

// Relaxed gate for wrist landmarks (often partially occluded)
const WRIST_VIS_GATE = 0.4;

// Hip visibility gate — raised to 0.7 would reject videos where hips are
// partly cropped or occluded (50-60% is typical in half-body shots and still
// gives usable measurements). Configurable via setHipVisGate().
const DEFAULT_VIS_GATE = 0.4;
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

  /** Avatar shoulder width (leftUpperArm ↔ rightUpperArm world distance at
   *  rest). Used as a fallback body-scale reference when hips aren't reliably
   *  visible (upper-body-only videos). */
  readonly avatarShoulderWidth: number;

  /** Avatar head-bone world size (rough ear-to-ear analogue). Estimated from
   *  the distance between head-bone world position and its parent (neck), ×
   *  0.7 — empirically close to ear-to-ear width for standard VRM heads.
   *  Used as a super-stable body-scale reference (face landmarks don't move
   *  with breathing, shrugs, or torso rotation). */
  readonly avatarHeadWidth: number;

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
  /** Live EMA of performer shoulder width in metres. Used for body-scale
   *  fallback when hip visibility is too low to trust. */
  private performerShoulderWidth = 0;
  /** Live EMA of performer ear-to-ear width in metres. Most stable ref —
   *  face landmarks don't move with body movements. */
  private performerHeadWidth = 0;
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

  // When true, both arms share the max of left/right performer arm length.
  // Helps when the performer never fully extends both arms symmetrically
  // in-view — the better-observed arm drives the scale for both.
  private _unifyArmMax = false;

  // Minimum MediaPipe visibility required to trust hip / ankle landmarks for
  // calibration. Lower = more permissive (works with cropped / occluded shots),
  // higher = stricter (rejects noise). User-configurable at runtime.
  private _hipVisGate = DEFAULT_VIS_GATE;

  // Which reference to use for bodyScale.
  //   'auto'      — prefer hips > shoulders > head (legacy).
  //   'shoulders' — force shoulder-width ratio.
  //   'hips'      — force hip-width ratio.
  //   'head'      — force head-width (ear-to-ear) ratio — most stable,
  //                 great for talking-head / upper-body footage.
  //   'median'    — robust median of all available references. Recommended
  //                 default; one bad landmark source doesn't skew the result.
  private _scaleRef: 'auto' | 'shoulders' | 'hips' | 'head' | 'median' = 'auto';

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

    // Shoulder width = world distance between leftUpperArm and rightUpperArm.
    const lShoulder = humanoid.getNormalizedBoneNode('leftUpperArm'  as any);
    const rShoulder = humanoid.getNormalizedBoneNode('rightUpperArm' as any);
    if (lShoulder && rShoulder) {
      const lsPos = new THREE.Vector3(), rsPos = new THREE.Vector3();
      lShoulder.getWorldPosition(lsPos);
      rShoulder.getWorldPosition(rsPos);
      this.avatarShoulderWidth = lsPos.distanceTo(rsPos);
    } else {
      this.avatarShoulderWidth = 0;
    }

    // Head (ear-to-ear) width — prefer leftEye↔rightEye × 1.8 if VRM has
    // eye bones (they correlate much better than head-bone length with actual
    // face width). Fallback: head.position.length() × 1.5 as a rough proxy.
    // If nothing usable, set to 0 and head-based scaling is disabled.
    const lEye = humanoid.getNormalizedBoneNode('leftEye'  as any);
    const rEye = humanoid.getNormalizedBoneNode('rightEye' as any);
    if (lEye && rEye) {
      const lePos = new THREE.Vector3(), rePos = new THREE.Vector3();
      lEye.getWorldPosition(lePos);
      rEye.getWorldPosition(rePos);
      // Ear-to-ear ≈ 1.8 × inter-pupillary; cartoon VRMs with wide-set eyes
      // still land in the same ballpark once MediaPipe's ear-width ratio is
      // applied.
      this.avatarHeadWidth = lePos.distanceTo(rePos) * 1.8;
    } else {
      const head = humanoid.getNormalizedBoneNode('head' as any);
      this.avatarHeadWidth = head ? head.position.length() * 1.5 : 0;
    }

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

  // ── Public read-only accessors for the running EMA measurements ──────────
  // (Live performer-side metrics, exposed for diagnostics + tooling. The
  // backing fields stay private so external code can't mutate them.)
  get performerHipWidthMetric():      number { return this.performerHipWidth; }
  get performerShoulderWidthMetric(): number { return this.performerShoulderWidth; }
  get performerHeadWidthMetric():     number { return this.performerHeadWidth; }
  get performerLegLenMetric():        number { return this.performerLegLen; }

  /** Reset the running measurements; they'll refill on next good frames. */
  recalibrate(): void {
    this.performerHipWidth      = 0;
    this.performerShoulderWidth = 0;
    this.performerHeadWidth     = 0;
    this.performerLegLen        = 0;
    this.performerRightArmMax   = 0;
    this.performerLeftArmMax    = 0;
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
    const ls = lms[LM.LEFT_SHOULDER], rs = lms[LM.RIGHT_SHOULDER];
    const lE = lms[LM.LEFT_EAR],      rE = lms[LM.RIGHT_EAR];

    // Head (ear-to-ear) width — face landmarks usually 95-100% visibility,
    // not affected by body posture.
    if (lE && rE && (lE.visibility ?? 1) >= WRIST_VIS_GATE
                 && (rE.visibility ?? 1) >= WRIST_VIS_GATE) {
      const rawHead = distance(lE, rE);
      if (rawHead > 1e-3) {
        if (this.performerHeadWidth <= 0) {
          this.performerHeadWidth = rawHead;
          this._calibrated = true;
        } else {
          this.performerHeadWidth =
            this.performerHeadWidth * (1 - EMA_ALPHA) + rawHead * EMA_ALPHA;
        }
      }
    }

    // Shoulder width — always updated if shoulders are visible. Serves as the
    // fallback body-scale reference for upper-body-only footage.
    if (ls && rs && (ls.visibility ?? 1) >= WRIST_VIS_GATE
                 && (rs.visibility ?? 1) >= WRIST_VIS_GATE) {
      const rawShoulder = distance(ls, rs);
      if (rawShoulder > 1e-3) {
        if (this.performerShoulderWidth <= 0) {
          this.performerShoulderWidth = rawShoulder;
          this._calibrated = true; // can be based on shoulders alone
        } else {
          this.performerShoulderWidth =
            this.performerShoulderWidth * (1 - EMA_ALPHA) + rawShoulder * EMA_ALPHA;
        }
      }
    }

    // Arm lengths (shoulder-to-wrist) — must run regardless of hip visibility.
    // Mirror: character LEFT arm ← performer RIGHT (11/15 vs 12/16 indices).
    const lw = lms[LM.LEFT_WRIST], rw = lms[LM.RIGHT_WRIST];
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

    if (!lh || !rh) return;
    if ((lh.visibility ?? 1) < this._hipVisGate) return;
    if ((rh.visibility ?? 1) < this._hipVisGate) return;

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
    if (la && (la.visibility ?? 1) >= this._hipVisGate) rawLeg = Math.max(rawLeg, distance(lh, la));
    if (ra && (ra.visibility ?? 1) >= this._hipVisGate) rawLeg = Math.max(rawLeg, distance(rh, ra));
    if (rawLeg > 1e-3) {
      if (this.performerLegLen <= 0) this.performerLegLen = rawLeg;
      else this.performerLegLen = this.performerLegLen * (1 - EMA_ALPHA) + rawLeg * EMA_ALPHA;
    }

    this._emit();
  }

  /** Core scale. Reference choice follows `_scaleRef`:
   *  auto      — hip > shoulder > head (fallback).
   *  shoulders — shoulder-width ratio.
   *  hips      — hip-width ratio.
   *  head      — ear-to-ear ratio (most stable, best for talking-head).
   *  median    — median of all available refs; one bad source doesn't skew. */
  bodyScale(): number {
    if (!this._calibrated) return 1;
    const hipRatio   = (this.performerHipWidth      >= 1e-4 && this.avatarHipWidth      > 1e-4)
      ? this.avatarHipWidth      / this.performerHipWidth      : 0;
    const shRatio    = (this.performerShoulderWidth >= 1e-4 && this.avatarShoulderWidth > 1e-4)
      ? this.avatarShoulderWidth / this.performerShoulderWidth : 0;
    const headRatio  = (this.performerHeadWidth     >= 1e-4 && this.avatarHeadWidth     > 1e-4)
      ? this.avatarHeadWidth     / this.performerHeadWidth     : 0;

    switch (this._scaleRef) {
      case 'shoulders': return shRatio   || hipRatio || headRatio || 1;
      case 'hips':      return hipRatio  || shRatio  || headRatio || 1;
      case 'head':      return headRatio || shRatio  || hipRatio  || 1;
      case 'median': {
        const vals = [hipRatio, shRatio, headRatio].filter((v) => v > 0).sort((a, b) => a - b);
        if (vals.length === 0) return 1;
        if (vals.length === 1) return vals[0];
        if (vals.length === 2) return (vals[0] + vals[1]) / 2;
        return vals[1]; // median of 3
      }
      case 'auto':
      default:
        if (hipRatio)   return hipRatio;
        if (shRatio)    return shRatio;
        if (headRatio)  return headRatio;
        return 1;
    }
  }

  setScaleRef(r: 'auto' | 'shoulders' | 'hips' | 'head' | 'median'): void {
    this._scaleRef = r;
    this._emit();
  }
  get scaleRef(): 'auto' | 'shoulders' | 'hips' | 'head' | 'median' { return this._scaleRef; }

  /** Raw performer measurements in metres. Zero = not yet observed. */
  performerMeasurements(): {
    hipWidth:      number;
    shoulderWidth: number;
    headWidth:     number;
    leftArmMax:    number;   // performer left shoulder→wrist (drives avatar RIGHT arm)
    rightArmMax:   number;   // performer right shoulder→wrist (drives avatar LEFT arm)
    legLen:        number;
  } {
    return {
      hipWidth:      this.performerHipWidth,
      shoulderWidth: this.performerShoulderWidth,
      headWidth:     this.performerHeadWidth,
      leftArmMax:    this.performerLeftArmMax,
      rightArmMax:   this.performerRightArmMax,
      legLen:        this.performerLegLen,
    };
  }

  /** Raw reference ratios for UI display. Undefined entries = unobserved. */
  refRatios(): { hip?: number; shoulder?: number; head?: number } {
    return {
      hip:      this.performerHipWidth      >= 1e-4 && this.avatarHipWidth      > 1e-4
        ? this.avatarHipWidth / this.performerHipWidth : undefined,
      shoulder: this.performerShoulderWidth >= 1e-4 && this.avatarShoulderWidth > 1e-4
        ? this.avatarShoulderWidth / this.performerShoulderWidth : undefined,
      head:     this.performerHeadWidth     >= 1e-4 && this.avatarHeadWidth     > 1e-4
        ? this.avatarHeadWidth / this.performerHeadWidth : undefined,
    };
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
      const perfLen = this._unifyArmMax
        ? Math.max(this.performerRightArmMax, this.performerLeftArmMax)
        : this.performerRightArmMax;
      const avatarLen = this.avatarLeftUpperArm + this.avatarLeftLowerArm;
      if (perfLen < 1e-3) return this.bodyScale() * override;
      return (avatarLen / perfLen) * override;
    } else {
      const perfLen = this._unifyArmMax
        ? Math.max(this.performerRightArmMax, this.performerLeftArmMax)
        : this.performerLeftArmMax;
      const avatarLen = this.avatarRightUpperArm + this.avatarRightLowerArm;
      if (perfLen < 1e-3) return this.bodyScale() * override;
      return (avatarLen / perfLen) * override;
    }
  }

  /** If true, both arms share the max observed arm length (fixes asymmetric cal). */
  setUnifyArmMax(v: boolean): void { this._unifyArmMax = v; this._emit(); }
  get unifyArmMax(): boolean { return this._unifyArmMax; }

  /** Min visibility to accept a hip/ankle landmark for calibration (0..1). */
  setHipVisGate(v: number): void {
    this._hipVisGate = Math.max(0, Math.min(1, v));
    this._emit();
  }
  get hipVisGate(): number { return this._hipVisGate; }

  /**
   * Per-reference readiness for UI indicator. Each value is 0..1 progress.
   *   shoulders — 1 after the first valid shoulders-visible frame.
   *   hips      — 1 after the first valid hips-visible frame.
   *   legs      — 1 after the first valid hip-to-ankle sample.
   *   armL/armR — convergence of arm-max relative to expected reach
   *               (2.3 × shoulder width, a rough human-anatomy ratio).
   *               100% when the performer has extended the arm ~fully.
   */
  readiness(): {
    shoulders: number;
    hips:      number;
    legs:      number;
    armL:      number;
    armR:      number;
  } {
    const shoulders = this.performerShoulderWidth > 0 ? 1 : 0;
    const hips      = this.performerHipWidth      > 0 ? 1 : 0;
    const legs      = this.performerLegLen        > 0 ? 1 : 0;

    // Readiness based on armScale convergence: armScale ≤ 1 means target sits
    // within avatar reach → 100% ready. Anything above 1 means performerArmMax
    // is under-observed and target would overshoot — map linearly toward 0%
    // at armScale = 2.5 (severely under-observed).
    const scoreScale = (scale: number): number => {
      if (!Number.isFinite(scale) || scale <= 0) return 0;
      if (scale <= 1) return 1;
      return Math.max(0, 1 - (scale - 1) / 1.5);
    };
    // armScale() has observation-absent guards; treat zero-observation as 0%.
    const armL = this.performerRightArmMax > 1e-3 ? scoreScale(this.armScale('left'))  : 0;
    const armR = this.performerLeftArmMax  > 1e-3 ? scoreScale(this.armScale('right')) : 0;

    return { shoulders, hips, legs, armL, armR };
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
