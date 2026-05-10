import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { PoseFrame } from './poseDetector';
import type { MocapCalibration } from './mocapCalibration';
import { getCachedHumanoidRestAxes, HUMANOID_DIRECTION_CHILD } from '../humanoidRestPose';
import {
  FACE,
  FINGER_VRM_NAMES,
  LIMB_BONES,
  LM,
  PALM_ROOT_SUFFIXES,
  PROCESS_ORDER,
} from './directPoseConfig';
import { solveArmTarget } from './armTargetSolver';
import { applyWorldDirectionToBone } from './boneDirectionRetarget';
import { applyKalidoHandRetarget, applyTrackedPalmRetarget } from './handRetarget';
import { mpDeltaToVrm, mpDirToVrm, mpDirToVrmTorso } from './motionSpace';
import { solveShoulderTarget } from './shoulderRetarget';
import {
  solveHipPositionTarget,
  solveHipsOrientationTarget,
  solveSpineTarget,
} from './torsoTargetSolver';
import { applyTwoBoneChain } from './twoBoneChainApplication';
import { BoneTracker, trackPhase, msSinceLoss, type TrackPhase } from './boneTrackState';
import { recoverWristZ } from './anatomicalDepth';
import { QuaternionOneEuro } from './oneEuroFilter';
import {
  capArmScaleByCurrentSegments,
} from './solverHeuristics';
import { solveLegTarget } from './legTargetSolver';
import {
  createMocapDebugTargets,
  getAnkleTarget,
  getArmPoleRaw,
  getArmPoleSmoothed,
  getArmSolverDiagnostics,
  getElbowTarget,
  getWristTarget,
  resetMocapDebugTargets,
  type MocapDebugTargets,
} from './mocapDiagnostics';

// ── Public types ──────────────────────────────────────────────────────────────

export interface BoneChainHealth {
  phase: TrackPhase;
  /** Milliseconds since the bone's last visible frame. 0 when currently live. */
  msSinceLoss: number;
}

export interface TrackingHealth {
  leftArm:  BoneChainHealth;
  rightArm: BoneChainHealth;
  leftLeg:  BoneChainHealth;
  rightLeg: BoneChainHealth;
  hips:     BoneChainHealth;
  spine:    BoneChainHealth;
}

// ── DirectPoseApplier ─────────────────────────────────────────────────────────

/**
 * Direct landmark → bone-rotation math, no KalidoKit for body pose.
 *
 * Per-bone pipeline (inspired by sysAnimOnline's positions_to_vmd.py):
 *   1. rest_axis (local) — direction from bone origin to its VRM child bone,
 *      in bone-local frame. Computed once at init.
 *   2. current_dir (world) — parent→child landmark vector from MediaPipe,
 *      converted from MediaPipe coord system to VRM world coord system
 *      (flip Y, flip Z, optionally mirror X).
 *   3. Transform current_dir into the bone's parent's local frame
 *      (using the parent's current world rotation).
 *   4. local_rotation = setFromUnitVectors(rest_axis, current_dir_parent_local).
 *   5. slerp toward target (or snap in HQ mode).
 *
 * Fingers are still handled by KalidoHand.solve because MediaPipe's body
 * detector only gives wrist-level granularity for the hands.
 */
export class DirectPoseApplier {
  private vrm: VRM;
  private calibration: MocapCalibration | null = null;
  private nodeCache     = new Map<string, THREE.Object3D>();
  private restLocalAxis = new Map<string, THREE.Vector3>();
  private handRestBasis = new Map<string, THREE.Quaternion>();

  // sysAnimOnline uses separate filters per body region:
  //   head_chest_rot: minCutoff=0.25 → very heavy torso smoothing (stable trunk)
  //   arm_rot/IK:     minCutoff=0.5, beta=0.5 → responsive arms
  // We mirror this with separate lerp values: low for spine (stable), high for limbs.
  private _spineLerp    = 0.25;  // hips + spine/chest twist — heavily smoothed
  private _bodyLerp     = 0.7;   // arms + legs IK
  private _handLerp     = 0.7;
  private _handTrackingPriorityEnabled = true;
  private _mirrorX      = true;  // mirror landmarks left↔right (selfie view)
  private _depthScale   = 1;     // Default to full 3D depth; the panel can still reduce it if Z gets noisy
  private _visThreshold = 0.3;   // MediaPipe visibility score below this = skip bone

  // Shoulder spread: Z-axis rotation applied to leftShoulder / rightShoulder every
  // frame. Positive = shoulders droop outward (broader silhouette). Range ±20°.
  private _shoulderSpreadDeg = 0;
  private _legSpreadX = 1.0;

  // Default hips world-rotation at load time. The VRM often ships with a
  // non-identity hips orientation (e.g. 180° around Y) to face the camera.
  // We preserve it as a baseline so that at T-pose our code produces the
  // character's natural facing direction instead of forcibly re-facing to +Z.
  private _hipsBaseWorld = new THREE.Quaternion();

  // Avatar's shoulder-line direction in hips-local frame, projected to XZ.
  // Used as the reference "zero-twist" vector in _applySpine when hips
  // landmarks aren't visible enough to give a live hip axis (e.g. upper-body-
  // only recordings where only shoulders/head are in frame).
  private _avatarShoulderRestLocal = new THREE.Vector3(1, 0, 0);

  // Hip position tracking: performer hip centre delta → avatar hips.position.
  private _hipPositionEnabled   = true;
  private _hipPerfBaseline:     THREE.Vector3 | null = null;
  private _hipAvatarBaseline:   THREE.Vector3 = new THREE.Vector3();
  private _torsoForwardBaseline: number | null = null;

  // Scratch allocations — reused each frame to avoid GC pressure
  private _v1 = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  private _v3 = new THREE.Vector3();
  private _v4 = new THREE.Vector3();
  private _v5 = new THREE.Vector3();
  private _v6 = new THREE.Vector3();
  private _q1 = new THREE.Quaternion();
  private _q2 = new THREE.Quaternion();
  private _m2 = new THREE.Matrix4();
  // IK debug targets — updated each frame, read by MocapDebugViz
  readonly debugTargets: MocapDebugTargets = createMocapDebugTargets();

  // Smoothed pole vectors per limb (world-frame). MediaPipe sometimes flips
  // the mid-joint (elbow/knee) when the limb is near-straight — smoothing
  // keeps the pole direction stable so the IK solver doesn't flip the joint.
  private _polesArm: Record<'left' | 'right', THREE.Vector3> = {
    left:  new THREE.Vector3(),
    right: new THREE.Vector3(),
  };
  private _polesLeg: Record<'left' | 'right', THREE.Vector3> = {
    left:  new THREE.Vector3(),
    right: new THREE.Vector3(),
  };
  // Depth (Z) is MediaPipe's least reliable axis. For narrow joints like
  // elbows this jitter is visible — we attenuate it further inside arm IK.
  // Legs' Z is less problematic (big, well-separated joints) so we leave it.
  // Default to full arm depth. The debug panel can still dial this back if
  // MediaPipe Z gets too noisy for a specific camera setup.
  private _armZAttenuation = 1;
  // EMA alpha on pole smoothing. 1 = no smoothing (use current frame).
  private _poleAlpha = 0.6;
  // Z-axis weight applied to the arm pole vector (shoulder→elbow direction).
  // Separate from the target Z attenuation: the pole only hints at the bulge
  // direction, so more damping here helps stability without shortening reach.
  private _armPoleZ = 0.5;

  // Fraction of residual torso midpoint lean applied to spine/chest as a
  // side-bend after hips orientation has already been solved.
  private _lateralBendScale = 0.35;
  // Larger side leans are currently underrepresented because the residual
  // torso midpoint angle is already conservative and then gets split across
  // spine+chest. For pronounced bends we boost the gain adaptively, while
  // keeping small/noisy leans on the original lower gain.
  private _lateralBendScaleMax = 0.7;
  // Residual torso forward bend applied to spine/chest after hips orientation.
  // Uses full torso Z (no /3 damping) so pronounced bows / forward leans still
  // read correctly even though the hips basis stays conservative.
  private _forwardBendScale = 1;
  // Hips landmarks are the noisiest torso anchors when one leg is lifted: the
  // pelvis line gets "dragged" by the active leg and the body appears to lean
  // the wrong way. We cap how far the pelvis cross-axis may diverge from the
  // shoulder line and progressively trust shoulders more beyond that point.
  private _torsoAxisMaxDivergenceDeg = 20;

  // World Y of the avatar's ankle bones at rest pose (≈ floor level for ankles).
  // Clamping IK targets to >= _groundY prevents feet from sinking into the floor.
  private _groundY = 0;

  // Foot locking: freezes the ankle IK target when the performer stands still,
  // removing the foot-sliding artefact caused by MediaPipe landmark jitter.
  private _footLockEnabled                                            = true;
  private _footLocked:      Record<'left' | 'right', boolean>        = { left: false, right: false };
  private _footLockedPos:   Record<'left' | 'right', THREE.Vector3>  = {
    left: new THREE.Vector3(), right: new THREE.Vector3(),
  };
  private _prevAnkleTarget: Record<'left' | 'right', THREE.Vector3>  = {
    left:  new THREE.Vector3(Infinity, Infinity, Infinity),
    right: new THREE.Vector3(Infinity, Infinity, Infinity),
  };
  private _footVelocityLockThreshold   = 0.007;  // m/frame — below this = lock candidate
  private _footVelocityUnlockThreshold = 0.018;  // m/frame — above this = force unlock
  private _footLiftThreshold           = 0.05;   // m above groundY — foot is being lifted

  // Extra scratch quaternion for spine lateral bend (keeps _q1/_q2 semantics unchanged).
  private _q3 = new THREE.Quaternion();

  // Per-bone visibility-loss state machine (A1+A2). Resolves the "snap-freeze
  // when visibility drops" symptom by holding last-good for HOLD_MS, fading
  // toward identity over RELAX_MS, and blending back on visibility return.
  // Used at each _visible()-gate callsite (limb, arm IK, leg IK, hips, spine,
  // shoulders). For IK chains where applyTwoBoneChain writes nodes directly,
  // we call markObserved() on visible frames and fade() on invisible ones.
  private _boneTracker = new BoneTracker();
  // Timestamp captured once per apply() call so all bone updates within a
  // frame see the same time (otherwise FRESH/DECAYING thresholds would drift
  // across the per-bone iteration).
  private _now = 0;
  // Scratch quaternion reserved for the state machine — avoids stepping on
  // _q1/_q2/_q3 which are heavily reused by torso/IK solvers.
  private _qFade = new THREE.Quaternion();

  // A3: opt-in symmetry fallback. When one side of an IK chain (arm or leg)
  // becomes invisible while the other side is live, we can copy the other
  // side's local-frame quaternion to keep the missing limb animated. Works
  // best for bilaterally-symmetric poses (claps, dance moves with mirror
  // motion) and produces incorrect-but-not-broken poses for asymmetric
  // input. Off by default — user toggles it on for specific use-cases.
  private _symmetryFallback = false;

  // B4: post-IK quaternion smoothing for arm bones. IK's two-stage solver
  // amplifies landmark jitter into visible tremor on the bone output;
  // QuaternionOneEuro damps it without blurring fast motion. Per-bone
  // instances (4 total: L/R × upper/lower arm) so they don't interfere.
  private _armQuatFilters: Record<string, QuaternionOneEuro> = {
    leftUpperArm:  new QuaternionOneEuro(1.0, 0.05),
    leftLowerArm:  new QuaternionOneEuro(1.0, 0.05),
    rightUpperArm: new QuaternionOneEuro(1.0, 0.05),
    rightLowerArm: new QuaternionOneEuro(1.0, 0.05),
  };
  private _qFiltered = new THREE.Quaternion();
  constructor(vrm: VRM, calibration?: MocapCalibration) {
    this.vrm = vrm;
    this.calibration = calibration ?? null;
    this._buildCache();
    this._computeRestAxes();
    this._captureHipsBaseline();
    this._captureGroundY();
  }

  /** Late-binding hook if calibration is constructed after the applier. */
  setCalibration(c: MocapCalibration): void { this.calibration = c; }

  private _captureHipsBaseline(): void {
    const hipsNode = this.nodeCache.get('hips');
    if (!hipsNode) return;
    // Make sure the whole VRM world matrix chain is fresh before reading
    this.vrm.scene.updateMatrixWorld(true);
    hipsNode.getWorldQuaternion(this._hipsBaseWorld);

    // Capture the avatar's shoulder line in hips-local (XZ projected). Used
    // as a twist reference when performer hips aren't visible.
    const lShoulder = this.nodeCache.get('leftShoulder')
                   ?? this.nodeCache.get('leftUpperArm');
    const rShoulder = this.nodeCache.get('rightShoulder')
                   ?? this.nodeCache.get('rightUpperArm');
    if (lShoulder && rShoulder) {
      const lPos = new THREE.Vector3();
      const rPos = new THREE.Vector3();
      lShoulder.getWorldPosition(lPos);
      rShoulder.getWorldPosition(rPos);
      const dir = new THREE.Vector3().subVectors(rPos, lPos);
      dir.applyQuaternion(this._q1.copy(this._hipsBaseWorld).invert());
      dir.y = 0;
      if (dir.lengthSq() > 1e-6) this._avatarShoulderRestLocal.copy(dir.normalize());
    }
  }

  /** The avatar's hips world quaternion at rest (before any mocap). */
  get hipsBaseWorld(): THREE.Quaternion { return this._hipsBaseWorld; }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Shoulder spread in degrees. Positive = shoulders droop outward (wider silhouette). */
  setShoulderSpread(deg: number): void { this._shoulderSpreadDeg = Math.max(-20, Math.min(20, deg)); }
  get shoulderSpread(): number { return this._shoulderSpreadDeg; }

  /** Multiplier on the X-component of the foot IK target offset from hip.
   *  1.0 = no change. >1 fans feet outward, <1 pulls them inward. */
  setLegSpreadX(v: number): void { this._legSpreadX = Math.max(0.5, Math.min(2.0, v)); }
  get legSpreadX(): number { return this._legSpreadX; }

  /** Limb (arm/leg) smoothing lerp factor (0 = frozen, 1 = instant). */
  setBodySmoothing(v: number): void { this._bodyLerp = Math.max(0.01, Math.min(1, v)); }
  get bodySmoothing(): number { return this._bodyLerp; }

  /** Spine/hips smoothing lerp factor — kept lower than limbs for stable torso. */
  setSpineSmoothing(v: number): void { this._spineLerp = Math.max(0.01, Math.min(1, v)); }
  get spineSmoothing(): number { return this._spineLerp; }

  /** How much MediaPipe Z depth affects arm IK target (0 = flat 2D, 1 = full 3D). */
  setArmZAttenuation(v: number): void { this._armZAttenuation = Math.max(0, Math.min(1, v)); }
  get armZAttenuation(): number { return this._armZAttenuation; }

  /** Pole vector EMA alpha for arm/leg IK (0 = frozen, 1 = instant, no smoothing). */
  setPoleSmoothing(v: number): void { this._poleAlpha = Math.max(0.01, Math.min(1, v)); }
  get poleSmoothing(): number { return this._poleAlpha; }

  /** Weight of the Z component in the arm pole vector (0 = flat, 1 = full 3D). */
  setArmPoleZ(v: number): void { this._armPoleZ = Math.max(0, Math.min(1, v)); }
  get armPoleZ(): number { return this._armPoleZ; }

  /** Enable/disable hip world-position tracking (performer moves → avatar moves). */
  setHipPositionEnabled(v: boolean): void { this._hipPositionEnabled = v; }
  get hipPositionEnabled(): boolean { return this._hipPositionEnabled; }

  /** Reset hip position baseline — next frame re-anchors to current performer position. */
  resetHipBaseline(): void {
    this._hipPerfBaseline = null;
    this._torsoForwardBaseline = null;
  }

  /** Release any locked feet and reset velocity history. Call on recalibrate / stop. */
  resetFootLock(): void {
    this._footLocked.left  = false;
    this._footLocked.right = false;
    this._prevAnkleTarget.left.set(Infinity, Infinity, Infinity);
    this._prevAnkleTarget.right.set(Infinity, Infinity, Infinity);
  }

  /** Enable/disable foot locking. Disabling also releases any active lock. */
  setFootLockEnabled(v: boolean): void {
    this._footLockEnabled = v;
    if (!v) this.resetFootLock();
  }
  get footLockEnabled(): boolean { return this._footLockEnabled; }

  /** Fraction of shoulder lateral tilt applied as spine side-lean (0–1). */
  setLateralBendScale(v: number): void { this._lateralBendScale = Math.max(0, Math.min(1, v)); }
  get lateralBendScale(): number { return this._lateralBendScale; }

  /** Avatar's rest-pose ankle height above the scene floor (metres). Read-only debug info. */
  get groundY(): number { return this._groundY; }

  /** HQ mode: snap to target (no slerp), full amplitude — for BVH recording. */
  setHighQualityMode(enabled: boolean): void {
    this._spineLerp = enabled ? 1 : 0.25;
    this._bodyLerp  = enabled ? 1 : 0.7;
    this._handLerp  = enabled ? 1 : 0.7;
  }

  /** When enabled, wrist + fingers from hand tracking are treated as a top layer. */
  setHandTrackingPriorityEnabled(v: boolean): void { this._handTrackingPriorityEnabled = v; }
  get handTrackingPriorityEnabled(): boolean { return this._handTrackingPriorityEnabled; }

  /** Mirror landmarks left↔right so the model reflects the user. */
  setMirrorX(enabled: boolean): void { this._mirrorX = enabled; }
  get mirrorX(): boolean { return this._mirrorX; }

  /** Scale MediaPipe Z (depth). 0 = planar (no depth), 1 = full 3D.
   *  Lower values help when depth estimation is jittery and arms "pass through"
   *  each other or the torso. Sweet spot is usually 0.3–0.6. */
  setDepthScale(v: number): void {
    this._depthScale = Math.max(0, Math.min(1, v));
  }
  get depthScale(): number { return this._depthScale; }

  /** Landmarks whose visibility score is below this threshold are considered
   *  untracked — their bones are left at their previous value, preserving
   *  idle / animation output on body parts that aren't in the video frame. */
  setVisibilityThreshold(v: number): void {
    this._visThreshold = Math.max(0, Math.min(1, v));
  }
  get visibilityThreshold(): number { return this._visThreshold; }

  private _visible(lm?: { visibility?: number }): boolean {
    // Missing visibility (e.g. HandLandmarker outputs) treated as visible.
    return (lm?.visibility ?? 1) >= this._visThreshold;
  }

  apply(frame: PoseFrame): void {
    // Cache `now` for the state machine — all bone updates within a single
    // apply() must use the same timestamp so phase boundaries (FRESH→DECAYING
    // etc.) don't drift across the loop.
    this._now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    // Debug target flags are frame-local; reset them before solving this frame
    // so stale arm/leg IK markers do not survive when tracking drops out.
    resetMocapDebugTargets(this.debugTargets);

    // Torso first — its rotations propagate to limbs via parent world matrices.
    this._applyHips(frame);
    this._applySpine(frame);
    this._applyShoulders(frame);

    // Arms + legs: two-bone IK (hand/ankle target scaled to avatar space)
    // once calibration is ready; otherwise fall back to angle-based so
    // tracking is not blocked by an un-calibrated performer.
    const ikReady = this.calibration?.calibrated === true;
    const legsReady = (this.calibration?.readiness().legs ?? 0) >= 1;
    for (const bone of PROCESS_ORDER) {
      const isArmUpper = bone === 'leftUpperArm' || bone === 'rightUpperArm';
      const isArmLower = bone === 'leftLowerArm' || bone === 'rightLowerArm';
      const isLegUpper = bone === 'leftUpperLeg' || bone === 'rightUpperLeg';
      const isLegLower = bone === 'leftLowerLeg' || bone === 'rightLowerLeg';
      if (ikReady && isArmUpper) {
        this._applyArmIK(frame, bone.startsWith('left') ? 'left' : 'right');
        continue;
      }
      if (ikReady && isLegUpper) {
        if (legsReady) this._applyLegIK(frame, bone.startsWith('left') ? 'left' : 'right');
        else this._relaxLegToRest(bone.startsWith('left') ? 'left' : 'right');
        continue;
      }
      if (ikReady && (isArmLower || isLegLower)) continue; // handled in the upper pass
      const [pIdx, cIdx] = LIMB_BONES[bone];
      this._applyLimb(bone, frame, pIdx, cIdx);
    }

    this.applyTrackedHands(frame, this._handTrackingPriorityEnabled);
  }

  /**
   * Apply tracked hand pose on top of the current arm chain.
   * When `prioritized` is true we also rotate the wrist/hand bone and snap to
   * the tracked result so a later overlay pass can reassert the exact pose.
   */
  applyTrackedHands(frame: PoseFrame, prioritized = false): void {
    for (const hand of frame.hands) {
      if (prioritized) {
        applyTrackedPalmRetarget({
          nodeCache: this.nodeCache,
          handRestBasis: this.handRestBasis,
          mirrorX: this._mirrorX,
          handLerp: this._handLerp,
        }, hand, true);
      }
      applyKalidoHandRetarget({
        nodeCache: this.nodeCache,
        handRestBasis: this.handRestBasis,
        mirrorX: this._mirrorX,
        handLerp: this._handLerp,
      }, hand.landmarks, hand.side, false, prioritized);
    }
  }

  /** Enable / disable the bilateral-symmetry IK fallback (A3). When ON, an
   *  invisible arm or leg chain copies its mirror partner's local quaternions
   *  if the partner is currently live. Off by default. */
  setSymmetryFallback(v: boolean): void { this._symmetryFallback = v; }
  get symmetryFallback(): boolean { return this._symmetryFallback; }

  /** Per-chain tracking-health readout for the D1-lite debug panel.
   *  Each entry reports the current state-machine phase for a representative
   *  bone of the chain (upper arm / upper leg / hips / spine) plus how many
   *  milliseconds since the bone's last visible frame. Returns 0 when live. */
  getTrackingHealth(): TrackingHealth {
    const now = this._now > 0 ? this._now :
      (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const get = (name: string): BoneChainHealth => {
      const s = this._boneTracker.state(name);
      return {
        phase:       trackPhase(s, now),
        msSinceLoss: Math.round(msSinceLoss(s, now)),
      };
    };
    return {
      leftArm:  get('leftUpperArm'),
      rightArm: get('rightUpperArm'),
      leftLeg:  get('leftUpperLeg'),
      rightLeg: get('rightUpperLeg'),
      hips:     get('hips'),
      spine:    get('spine'),
    };
  }

  /** Local normalized-bone quaternion as [x,y,z,w] — for BVH recording. */
  getQuaternion(boneName: string): [number, number, number, number] | null {
    const n = this.nodeCache.get(boneName);
    if (!n) return null;
    const q = n.quaternion;
    return [q.x, q.y, q.z, q.w];
  }

  /** Rest axis used for direction retargeting — should equal normalizedAxis after the fix. */
  getRestAxis(boneName: string): THREE.Vector3 | null {
    return this.restLocalAxis.get(boneName) ?? null;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _captureGroundY(): void {
    this.vrm.scene.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    let minY = Infinity;
    for (const boneName of ['leftFoot', 'rightFoot'] as const) {
      const node = this.nodeCache.get(boneName);
      if (node) { node.getWorldPosition(pos); if (pos.y < minY) minY = pos.y; }
    }
    this._groundY = minY < Infinity ? minY : 0;
  }

  private _buildCache(): void {
    const names = new Set<string>([
      ...Object.keys(LIMB_BONES),
      ...Object.values(HUMANOID_DIRECTION_CHILD), // leftHand, leftFoot, …
      ...FINGER_VRM_NAMES,
      'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftShoulder', 'rightShoulder',
    ]);
    for (const name of names) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(name as any);
      if (node) this.nodeCache.set(name, node);
    }
  }

  private _computeRestAxes(): void {
    const restAxes = getCachedHumanoidRestAxes(this.vrm);
    for (const [bone, info] of restAxes) {
      this.restLocalAxis.set(bone, info.rawAxis.clone());
    }

    // Palm basis in hand-local space. We use it to align the wrist from palm
    // landmarks directly, which is much more robust than assuming KalidoKit's
    // generic wrist Euler basis matches this avatar.
    for (const side of ['left', 'right'] as const) {
      const handName = `${side}Hand`;
      const indexRoot = this.nodeCache.get(`${side}IndexProximal`);
      const littleRoot = this.nodeCache.get(`${side}LittleProximal`);
      const roots = PALM_ROOT_SUFFIXES
        .map((suffix) => this.nodeCache.get(`${side}${suffix}`))
        .filter((node): node is THREE.Object3D => !!node);
      if (!indexRoot || !littleRoot || roots.length < 4) continue;

      this._v1.copy(indexRoot.position).sub(littleRoot.position);
      this._v2.set(0, 0, 0);
      for (const root of roots) this._v2.add(root.position);
      this._v2.multiplyScalar(1 / roots.length);
      if (this._v1.lengthSq() < 1e-6 || this._v2.lengthSq() < 1e-6) continue;

      this._v1.normalize();
      this._v2.normalize();
      this._v3.crossVectors(this._v1, this._v2);
      if (this._v3.lengthSq() < 1e-6) continue;
      this._v3.normalize();
      this._v1.crossVectors(this._v2, this._v3).normalize();

      this._m2.makeBasis(this._v1, this._v2, this._v3);
      this.handRestBasis.set(handName, this._q1.setFromRotationMatrix(this._m2).clone());
    }
  }

  /**
   * Convert a MediaPipe world-space DELTA to VRM world-space, with depth scale.
   * Use for IK *position* targets — depth scale reduces noisy Z in hand/foot placement.
   */
  private _mpDeltaToVrm(dx: number, dy: number, dz: number, out: THREE.Vector3): void {
    // B2: adaptive Z attenuation. When the 2D projection (|Δxy|) is much
    // shorter than the Z magnitude, the limb is foreshortened along the
    // camera axis and MediaPipe's Z carries most of the (noisy) signal.
    // Damp Z further in that regime so the resulting bone direction bends
    // toward the image plane rather than violently along Z.
    //
    // Safety net for `_applyLimb` (pre-calibration / non-IK bones). When
    // arm IK kicks in, B1's sphere-intersection on the wrist replaces this
    // with a stricter anatomical recovery.
    let effectiveDepthScale = this._depthScale;
    const dxy = Math.hypot(dx, dy);
    const dzAbs = Math.abs(dz);
    if (dxy < 1e-4) {
      // Almost-pure-Z delta — almost certainly noisy regression. Clamp hard.
      effectiveDepthScale *= 0.3;
    } else if (dzAbs > dxy * 1.5) {
      // |Δz| > 1.5 × |Δxy| → suspect foreshortening.
      // Smoothly ramp damping from 1.0 at ratio 1.5 down to 0.4 at ratio ≥ 3.
      const r = dzAbs / dxy;
      const t = Math.min(1, (r - 1.5) / 1.5);
      effectiveDepthScale *= (1 - 0.6 * t);
    }
    mpDeltaToVrm(this._mirrorX, dx, dy, dz, out, effectiveDepthScale);
  }

  /**
   * Convert a MediaPipe world-space DIRECTION to VRM world-space, without depth scale.
   * Use for *orientation* vectors (torso basis, spine twist) so body rotation isn't
   * halved by the depth scale setting.
   */
  private _mpDirToVrm(dx: number, dy: number, dz: number, out: THREE.Vector3): void {
    mpDirToVrm(this._mirrorX, dx, dy, dz, out);
  }

  /**
   * Same as `_mpDirToVrm` but with Z damped 3× — for torso basis vectors
   * (hip axis, shoulder axis, spine up). MediaPipe's Z on these wide-body
   * measurements is very noisy (small torso rotations toward the camera
   * dominate), and without damping the torso tends to tilt forward/backward.
   * Matches sysAnimOnline's `arm_diff[2] /= 3` trick for shoulder width.
   */
  private _mpDirToVrmTorso(dx: number, dy: number, dz: number, out: THREE.Vector3): void {
    mpDirToVrmTorso(this._mirrorX, dx, dy, dz, out);
  }

  private _applyShoulders(frame: PoseFrame): void {
    const rad = this._shoulderSpreadDeg * (Math.PI / 180);
    const ls = frame.worldLandmarks[LM.LEFT_SHOULDER];
    const rs = frame.worldLandmarks[LM.RIGHT_SHOULDER];
    const shouldersVisible = !!ls && !!rs && this._visible(ls) && this._visible(rs);

    const applySide = (
      nodeName: 'leftShoulder' | 'rightShoulder',
      performerShoulder: { x: number; y: number; z: number } | undefined,
      spreadSign: number,
    ): void => {
      const node = this.nodeCache.get(nodeName);
      const restAxis = this.restLocalAxis.get(nodeName);
      if (!node || !restAxis || !node.parent) return;
      if (!shouldersVisible) {
        // A1: fade clavicle toward rest. Shoulder bones had no slerp pre-fade
        // (direct copy of solver output), so we copy fade target directly.
        const fade = this._boneTracker.fade(nodeName, this._now, this._qFade);
        node.quaternion.copy(fade);
        node.updateWorldMatrix(false, true);
        return;
      }
      node.parent.updateWorldMatrix(true, false);
      node.parent.getWorldQuaternion(this._q1);
      const target = solveShoulderTarget({
        mirrorX: this._mirrorX,
        restAxis,
        parentWorldQuaternion: this._q1,
        leftShoulder: ls!,
        rightShoulder: rs!,
        performerShoulder,
        spreadRadians: rad,
        spreadSign,
      });
      node.quaternion.copy(target);
      node.updateWorldMatrix(false, true);
      this._boneTracker.markObserved(nodeName, node.quaternion, this._now);
    };

    // Mirror: avatar LEFT clavicle follows performer's RIGHT shoulder, and vice versa.
    applySide('leftShoulder', rs, -1);
    applySide('rightShoulder', ls, 1);
  }

  /**
   * Compute hips world orientation from the torso quadrilateral (shoulder + hip lines).
   *   X (right→left in character frame) = direction across hips
   *   Y (up along spine)                 = midHip → midShoulder
   *   Z (forward from character)         = cross(X, Y)
   *
   * After mirror-swap: person's RIGHT hip maps to character's LEFT hip, so the
   * character-space "right→left" direction = (personRightHip - personLeftHip)
   * fed through _mpDeltaToVrm (which applies the mirror flip).
   */
  private _applyHips(frame: PoseFrame): void {
    const hipsNode = this.nodeCache.get('hips');
    if (!hipsNode || !hipsNode.parent) return;

    const lms = frame.worldLandmarks;
    const lh = lms[LM.LEFT_HIP], rh = lms[LM.RIGHT_HIP];
    const ls = lms[LM.LEFT_SHOULDER], rs = lms[LM.RIGHT_SHOULDER];
    // Need all four torso landmarks to be visible for a reliable basis.
    // A1: previously early-returned (hips frozen indefinitely); now fade to rest.
    const torsoVisible =
      !!lh && !!rh && !!ls && !!rs &&
      this._visible(lh) && this._visible(rh) &&
      this._visible(ls) && this._visible(rs);
    if (!torsoVisible) {
      const fadeTarget = this._boneTracker.fade('hips', this._now, this._qFade);
      if (this._spineLerp >= 1) hipsNode.quaternion.copy(fadeTarget);
      else                      hipsNode.quaternion.slerp(fadeTarget, this._spineLerp);
      hipsNode.updateWorldMatrix(false, true);
      return;
    }
    hipsNode.parent.updateWorldMatrix(true, false);
    hipsNode.parent.getWorldQuaternion(this._q2);
    const hipsTarget = solveHipsOrientationTarget({
      mirrorX: this._mirrorX,
      leftHip: lh,
      rightHip: rh,
      leftShoulder: ls,
      rightShoulder: rs,
      hipsBaseWorld: this._hipsBaseWorld,
      hipsParentWorldQuaternion: this._q2,
      torsoAxisMaxDivergenceDeg: this._torsoAxisMaxDivergenceDeg,
    });
    if (!hipsTarget) return;

    if (this._spineLerp >= 1) hipsNode.quaternion.copy(hipsTarget);
    else                      hipsNode.quaternion.slerp(hipsTarget, this._spineLerp);
    hipsNode.updateWorldMatrix(false, true);
    this._boneTracker.markObserved('hips', hipsNode.quaternion, this._now);

    // ── Hip world position ──────────────────────────────────────────────────
    if (this._hipPositionEnabled) {
      const cx = (lh.x + rh.x) * 0.5;
      const cy = (lh.y + rh.y) * 0.5;
      const cz = (lh.z + rh.z) * 0.5;

      if (!this._hipPerfBaseline) {
        this._hipPerfBaseline = new THREE.Vector3(cx, cy, cz);
        hipsNode.getWorldPosition(this._hipAvatarBaseline);
      }

      // Hip centre translation should follow whole-body/leg scale, not torso
      // width scale. In full-body shots the avatar can have much shorter
      // shoulders/hips but near-1:1 leg length; using bodyScale here makes the
      // pelvis move too little and forces leg IK to over-stretch.
      const scale = this.calibration?.legScale() ?? 1;
      hipsNode.parent!.getWorldPosition(this._v3);
      hipsNode.parent!.getWorldQuaternion(this._q1);
      const positionTarget = solveHipPositionTarget({
        mirrorX: this._mirrorX,
        depthScale: this._depthScale,
        perfCenterX: cx,
        perfCenterY: cy,
        perfCenterZ: cz,
        perfBaseline: this._hipPerfBaseline,
        avatarBaselineWorld: this._hipAvatarBaseline,
        hipsParentWorldPosition: this._v3,
        hipsParentWorldQuaternion: this._q1,
        scale,
      });

      if (this._spineLerp >= 1) hipsNode.position.copy(positionTarget);
      else                      hipsNode.position.lerp(positionTarget, this._spineLerp);
      hipsNode.updateWorldMatrix(false, true);
    }
  }

  /**
   * Spine / chest twist — the yaw between shoulder line and hip line,
   * computed in HIPS LOCAL frame. Both axes are transformed via the
   * current hips world-quaternion-inverse so the twist is independent
   * of the VRM's default facing baseline (e.g. 180° around Y).
   */
  private _applySpine(frame: PoseFrame): void {
    const spineNode = this.nodeCache.get('spine');
    const chestNode = this.nodeCache.get('chest') ?? this.nodeCache.get('upperChest');
    const hipsNode  = this.nodeCache.get('hips');
    if (!hipsNode || (!spineNode && !chestNode)) return;

    const lms = frame.worldLandmarks;
    const lh = lms[LM.LEFT_HIP], rh = lms[LM.RIGHT_HIP];
    const ls = lms[LM.LEFT_SHOULDER], rs = lms[LM.RIGHT_SHOULDER];
    const shouldersVisible = !!ls && !!rs && this._visible(ls) && this._visible(rs);
    if (!shouldersVisible) {
      // A1: fade spine + chest toward rest instead of leaving them frozen.
      if (spineNode) {
        const fade = this._boneTracker.fade('spine', this._now, this._qFade);
        if (this._spineLerp >= 1) spineNode.quaternion.copy(fade);
        else                      spineNode.quaternion.slerp(fade, this._spineLerp);
        spineNode.updateWorldMatrix(false, true);
      }
      if (chestNode) {
        const fade = this._boneTracker.fade('chest', this._now, this._qFade);
        if (this._spineLerp >= 1) chestNode.quaternion.copy(fade);
        else                      chestNode.quaternion.slerp(fade, this._spineLerp);
        chestNode.updateWorldMatrix(false, true);
      }
      return;
    }

    const hipsVisible = !!lh && !!rh && this._visible(lh) && this._visible(rh);
    hipsNode.updateWorldMatrix(true, false);
    const count = (spineNode ? 1 : 0) + (chestNode ? 1 : 0);
    hipsNode.getWorldQuaternion(this._q2);
    const spineTarget = solveSpineTarget({
      mirrorX: this._mirrorX,
      leftShoulder: ls,
      rightShoulder: rs,
      leftHip: hipsVisible ? lh! : null,
      rightHip: hipsVisible ? rh! : null,
      hipsWorldQuaternion: this._q2,
      avatarShoulderRestLocal: this._avatarShoulderRestLocal,
      torsoAxisMaxDivergenceDeg: this._torsoAxisMaxDivergenceDeg,
      torsoForwardBaseline: this._torsoForwardBaseline,
      forwardBendScale: this._forwardBendScale,
      lateralBendScale: this._lateralBendScale,
      lateralBendScaleMax: this._lateralBendScaleMax,
      spineNodeCount: count,
    });
    if (!spineTarget) return;

    this._torsoForwardBaseline = spineTarget.nextForwardBaseline;
    Object.assign(this.debugTargets.torsoSolver, spineTarget.diagnostics);
    const halfTwist = spineTarget.halfTwist;

    const applyTwist = (node: THREE.Object3D, trackName: string): void => {
      if (this._spineLerp >= 1) node.quaternion.copy(halfTwist);
      else                      node.quaternion.slerp(halfTwist, this._spineLerp);
      node.updateWorldMatrix(false, true);
      this._boneTracker.markObserved(trackName, node.quaternion, this._now);
    };
    if (spineNode) applyTwist(spineNode, 'spine');
    if (chestNode) applyTwist(chestNode, 'chest');
  }

  private _applyLimb(
    boneName: string,
    frame: PoseFrame,
    parentIdx: number,
    childIdx: number,
  ): void {
    const node     = this.nodeCache.get(boneName);
    const restAxis = this.restLocalAxis.get(boneName);
    if (!node || !restAxis || !node.parent) return;

    const p = frame.worldLandmarks[parentIdx];
    const c = frame.worldLandmarks[childIdx];
    if (!p || !c) {
      // Missing landmark data entirely — fade toward rest via state machine.
      const fadeTarget = this._boneTracker.fade(boneName, this._now, this._qFade);
      node.quaternion.slerp(fadeTarget, this._bodyLerp);
      return;
    }
    const visible = this._visible(p) && this._visible(c);

    if (visible) {
      this._mpDeltaToVrm(c.x - p.x, c.y - p.y, c.z - p.z, this._v1);
      if (this._v1.lengthSq() < 1e-6) return;
      applyWorldDirectionToBone({
        node,
        restAxis,
        worldDirection: this._v1,
        lerp: this._bodyLerp,
      });
      // Capture the resulting local quaternion as last-good for the tracker.
      this._boneTracker.markObserved(boneName, node.quaternion, this._now);
    } else {
      // A1: instead of snap-freezing, fade toward rest via state machine.
      const fadeTarget = this._boneTracker.fade(boneName, this._now, this._qFade);
      node.quaternion.slerp(fadeTarget, this._bodyLerp);
    }
  }

  /**
   * IK variant of the shoulder+elbow chain.
   *
   * Anchor: avatar shoulder midpoint.
   * Target = avatarMidShoulder + scaled(performerWrist − performerMidShoulder)
   *
   * X uses shoulder-width scale, Y/Z use arm-length scale. This keeps folded /
   * crossed-arm poses near the torso centerline even when the avatar has much
   * narrower shoulders than the performer.
   */
  private _applyArmIK(frame: PoseFrame, side: 'left' | 'right'): void {
    const calib = this.calibration;
    if (!calib || !calib.calibrated) return;

    const upperName = side + 'UpperArm';
    const lowerName = side + 'LowerArm';
    const upperNode = this.nodeCache.get(upperName);
    const lowerNode = this.nodeCache.get(lowerName);
    const upperRest = this.restLocalAxis.get(upperName);
    const lowerRest = this.restLocalAxis.get(lowerName);
    if (!upperNode || !lowerNode || !upperRest || !lowerRest || !upperNode.parent) return;

    // Mirror: character's LEFT arm ← performer's RIGHT landmarks (12/14/16).
    const lms = frame.worldLandmarks;
    const perfLs = lms[11];
    const perfRs = lms[12];
    const sIdx = side === 'left' ? 12 : 11;
    const eIdx = side === 'left' ? 14 : 13;
    const wIdx = side === 'left' ? 16 : 15;
    const ps = lms[sIdx], pe = lms[eIdx], pw = lms[wIdx];
    const chainVisible =
      !!perfLs && !!perfRs && !!ps && !!pe && !!pw &&
      this._visible(perfLs) && this._visible(perfRs) &&
      this._visible(ps) && this._visible(pe) && this._visible(pw);
    if (!chainVisible) {
      // A3: opt-in symmetry fallback — copy the OTHER arm's local quaternions
      // if it's currently live. Works for bilaterally-symmetric poses (mirror
      // dance, claps); produces wrong-but-not-broken poses for asymmetric
      // motion. Relies on the assumption that VRM rigs have mirror-symmetric
      // local bone frames so the same local rotation produces mirrored world
      // motion on the other side.
      if (this._symmetryFallback) {
        const otherSide = side === 'left' ? 'right' : 'left';
        const otherUpperName = otherSide + 'UpperArm';
        const otherLowerName = otherSide + 'LowerArm';
        const otherUpperPhase = trackPhase(this._boneTracker.state(otherUpperName), this._now);
        if (otherUpperPhase === 'live' || otherUpperPhase === 'recovering') {
          const otherUpper = this.nodeCache.get(otherUpperName);
          const otherLower = this.nodeCache.get(otherLowerName);
          if (otherUpper && otherLower) {
            upperNode.quaternion.copy(otherUpper.quaternion);
            upperNode.updateWorldMatrix(false, true);
            lowerNode.quaternion.copy(otherLower.quaternion);
            lowerNode.updateWorldMatrix(false, true);
            this._boneTracker.markObserved(upperName, upperNode.quaternion, this._now);
            this._boneTracker.markObserved(lowerName, lowerNode.quaternion, this._now);
            return;
          }
        }
      }
      // A1 fallback: chain landmarks unreliable → fade upper+lower toward
      // rest via state machine instead of leaving the bones at their previous
      // IK pose.
      const upperFade = this._boneTracker.fade(upperName, this._now, this._qFade);
      if (this._bodyLerp >= 1) upperNode.quaternion.copy(upperFade);
      else                     upperNode.quaternion.slerp(upperFade, this._bodyLerp);
      upperNode.updateWorldMatrix(false, true);

      const lowerFade = this._boneTracker.fade(lowerName, this._now, this._qFade);
      if (this._bodyLerp >= 1) lowerNode.quaternion.copy(lowerFade);
      else                     lowerNode.quaternion.slerp(lowerFade, this._bodyLerp);
      lowerNode.updateWorldMatrix(false, true);
      return;
    }

    // Avatar same-side shoulder = IK root. Target anchor is the midpoint of both shoulders.
    upperNode.parent!.updateWorldMatrix(true, false);
    upperNode.updateWorldMatrix(false, false);
    const shoulderWorld = upperNode.getWorldPosition(this._v5);
    const otherUpperNode = this.nodeCache.get((side === 'left' ? 'right' : 'left') + 'UpperArm');
    if (!otherUpperNode) return;
    otherUpperNode.updateWorldMatrix(false, false);
    const midAvatarShoulder = this._v6.copy(shoulderWorld).add(otherUpperNode.getWorldPosition(this._v4)).multiplyScalar(0.5);

    // B1: anatomical Z recovery for the wrist when foreshortening is detected.
    // MediaPipe's Z component on `pw` is the noisiest signal of the chain;
    // when the arm points along the camera axis the 2D shoulder→wrist length
    // is short relative to the performer's known arm length, and the model's
    // reported Z is often far from truth. We replace it with a sphere-
    // intersection solution constrained by performer arm length.
    //
    // Mirror mapping: side='left' uses performer's RIGHT arm length
    //                 (see MocapCalibration.armScale() for the same swap).
    const perfMeasurements = calib.performerMeasurements();
    const perfArmLen = side === 'left'
      ? perfMeasurements.rightArmMax
      : perfMeasurements.leftArmMax;
    let effectivePw = pw;
    if (perfArmLen > 0.05) {
      const recovered = recoverWristZ({
        shoulder: { x: ps.x, y: ps.y, z: ps.z },
        wrist:    { x: pw.x, y: pw.y, z: pw.z },
        armLength: perfArmLen,
      });
      if (recovered.recovered) {
        // Preserve visibility / other fields, only overwrite Z.
        effectivePw = { ...pw, z: recovered.wrist.z };
      }
    }

    const rawArmScale = calib.armScale(side);
    let armScale = rawArmScale;
    const shoulderScale = calib.shoulderWidthRatio();
    const avatarArmLen = calib.upperArmLength(side) + calib.lowerArmLength(side);
    const perfUpperLen = Math.hypot(pe.x - ps.x, pe.y - ps.y, pe.z - ps.z);
    const perfLowerLen = Math.hypot(effectivePw.x - pe.x, effectivePw.y - pe.y, effectivePw.z - pe.z);
    const perfSegmentLen = perfUpperLen + perfLowerLen;
    let segmentScaleCap = Number.NaN;
    const armScaleCap = capArmScaleByCurrentSegments(rawArmScale, avatarArmLen, perfSegmentLen);
    armScale = armScaleCap.effectiveScale;
    if (armScaleCap.cap != null) segmentScaleCap = armScaleCap.cap;
    const lh = lms[LM.LEFT_HIP], rh = lms[LM.RIGHT_HIP];
    const chestNode =
      this.nodeCache.get('upperChest') ??
      this.nodeCache.get('chest') ??
      this.nodeCache.get('spine');
    const neckNode = this.nodeCache.get('neck');
    const headNode = this.nodeCache.get('head');
    chestNode?.updateWorldMatrix(true, false);
    neckNode?.updateWorldMatrix(true, false);
    headNode?.updateWorldMatrix(true, false);
    const chestWorld = chestNode ? chestNode.getWorldPosition(new THREE.Vector3()) : null;
    const neckWorld = neckNode ? neckNode.getWorldPosition(new THREE.Vector3()) : null;
    const headWorld = headNode ? headNode.getWorldPosition(new THREE.Vector3()) : null;
    const hasLeftHandDetected = frame.hands.some((hand) => hand.side === 'Left');
    const hasRightHandDetected = frame.hands.some((hand) => hand.side === 'Right');
    const targetSolve = solveArmTarget({
      side,
      mirrorX: this._mirrorX,
      perfLeftShoulder: perfLs,
      perfRightShoulder: perfRs,
      perfShoulder: ps,
      perfElbow: pe,
      perfWrist: effectivePw,
      otherWrist: lms[side === 'left' ? 15 : 16] ?? null,
      perfLeftHip: lh ?? null,
      perfRightHip: rh ?? null,
      bodyLandmarks: frame.landmarks,
      faceLandmarks: frame.faceLandmarks,
      hand: frame.hands.find((h) => h.side === (side === 'left' ? 'Left' : 'Right')),
      hasBothHandsDetected: hasLeftHandDetected && hasRightHandDetected,
      shoulderWorld,
      midAvatarShoulder,
      chestWorld,
      neckWorld,
      headWorld,
      rawArmScale,
      armScale,
      shoulderScale,
      bodyScale: calib.bodyScale(),
      avatarArmLen,
      avatarShoulderWidth: calib.avatarShoulderWidth,
      armZAttenuation: this._armZAttenuation,
      armPoleZ: this._armPoleZ,
    });
    const target = targetSolve.target;

    const armDiag = getArmSolverDiagnostics(this.debugTargets, side);
    Object.assign(armDiag, targetSolve.diagnostics);
    armDiag.segmentScaleCap = segmentScaleCap;

    getWristTarget(this.debugTargets, side).copy(target);
    this.debugTargets.hasArm = true;

    // Pole vector: keep the wrist target midpoint-based, but drive the elbow
    // bend from the performer's same-side shoulder→elbow direction. This is a
    // much stabler bend hint than a midpoint-anchored elbow point when the hand
    // is close to the chest and the wrist target lies almost on the shoulder→hand
    // line.
    const elbowTarget = targetSolve.elbowTarget;
    getElbowTarget(this.debugTargets, side).copy(elbowTarget);
    this._v2.copy(targetSolve.rawPoleDirection);
    getArmPoleRaw(this.debugTargets, side).copy(this._v2);
    const smoothed = this._polesArm[side];
    if (smoothed.lengthSq() < 1e-6) smoothed.copy(this._v2);
    else smoothed.lerp(this._v2, this._poleAlpha);
    getArmPoleSmoothed(this.debugTargets, side).copy(smoothed);

    applyTwoBoneChain({
      rootWorld: shoulderWorld,
      targetWorld: target,
      poleDirection: smoothed,
      upperLength: calib.upperArmLength(side),
      lowerLength: calib.lowerArmLength(side),
      upperNode,
      lowerNode,
      upperRestAxis: upperRest,
      lowerRestAxis: lowerRest,
      lerp: this._bodyLerp,
    });
    // B4: damp residual IK jitter via QuaternionOneEuro on the post-slerp
    // bone quaternion. Adaptive: heavy smoothing at rest, light during fast
    // motion. Time in seconds for the filter's frequency math.
    const tSec = this._now * 0.001;
    const upperFilter = this._armQuatFilters[upperName];
    const lowerFilter = this._armQuatFilters[lowerName];
    if (upperFilter) {
      upperFilter.filter(upperNode.quaternion, tSec, this._qFiltered);
      upperNode.quaternion.copy(this._qFiltered);
      upperNode.updateWorldMatrix(false, true);
    }
    if (lowerFilter) {
      lowerFilter.filter(lowerNode.quaternion, tSec, this._qFiltered);
      lowerNode.quaternion.copy(this._qFiltered);
      lowerNode.updateWorldMatrix(false, true);
    }
    // State machine: record the (filtered) local quaternions so a subsequent
    // visibility-loss frame holds the smoothed pose instead of identity.
    this._boneTracker.markObserved(upperName, upperNode.quaternion, this._now);
    this._boneTracker.markObserved(lowerName, lowerNode.quaternion, this._now);
  }

  /**
   * IK variant of the hip+knee chain. Targets the performer's ankle landmark
   * scaled to avatar space via the hip-width body scale. Pole = hip→knee
   * direction (smoothed). Foot rotation is not addressed here — the foot
   * bone stays at rest orientation (angle-driven foot-IK is out of scope).
   */
  private _applyLegIK(frame: PoseFrame, side: 'left' | 'right'): void {
    const calib = this.calibration;
    if (!calib || !calib.calibrated) return;

    const upperName = side + 'UpperLeg';
    const lowerName = side + 'LowerLeg';
    const upperNode = this.nodeCache.get(upperName);
    const lowerNode = this.nodeCache.get(lowerName);
    const upperRest = this.restLocalAxis.get(upperName);
    const lowerRest = this.restLocalAxis.get(lowerName);
    if (!upperNode || !lowerNode || !upperRest || !lowerRest || !upperNode.parent) return;

    // Mirror: character's LEFT leg ← performer's RIGHT side (24/26/28).
    const lms = frame.worldLandmarks;
    const hIdx = side === 'left' ? 24 : 23;  // same-side performer hip
    const kIdx = side === 'left' ? 26 : 25;
    const aIdx = side === 'left' ? 28 : 27;
    const ph = lms[hIdx], pk = lms[kIdx], pa = lms[aIdx];
    const chainVisible =
      !!ph && !!pk && !!pa && this._visible(ph) && this._visible(pk) && this._visible(pa);
    if (!chainVisible) {
      // A3: same symmetry-fallback path as arm IK. See _applyArmIK for
      // rationale on the local-quaternion-copy approach.
      if (this._symmetryFallback) {
        const otherSide = side === 'left' ? 'right' : 'left';
        const otherUpperName = otherSide + 'UpperLeg';
        const otherLowerName = otherSide + 'LowerLeg';
        const otherUpperPhase = trackPhase(this._boneTracker.state(otherUpperName), this._now);
        if (otherUpperPhase === 'live' || otherUpperPhase === 'recovering') {
          const otherUpper = this.nodeCache.get(otherUpperName);
          const otherLower = this.nodeCache.get(otherLowerName);
          if (otherUpper && otherLower) {
            upperNode.quaternion.copy(otherUpper.quaternion);
            upperNode.updateWorldMatrix(false, true);
            lowerNode.quaternion.copy(otherLower.quaternion);
            lowerNode.updateWorldMatrix(false, true);
            this._boneTracker.markObserved(upperName, upperNode.quaternion, this._now);
            this._boneTracker.markObserved(lowerName, lowerNode.quaternion, this._now);
            return;
          }
        }
      }
      // A1: leg landmarks unreliable → fade upper+lower toward rest via state
      // machine. Distinguishes "occluded for 1 frame" (hold last good IK) from
      // "occluded for >800ms" (slide back to rest pose). The previous early-
      // return left the bones frozen at the last IK output indefinitely.
      const upperFade = this._boneTracker.fade(upperName, this._now, this._qFade);
      if (this._bodyLerp >= 1) upperNode.quaternion.copy(upperFade);
      else                     upperNode.quaternion.slerp(upperFade, this._bodyLerp);
      upperNode.updateWorldMatrix(false, true);

      const lowerFade = this._boneTracker.fade(lowerName, this._now, this._qFade);
      if (this._bodyLerp >= 1) lowerNode.quaternion.copy(lowerFade);
      else                     lowerNode.quaternion.slerp(lowerFade, this._bodyLerp);
      lowerNode.updateWorldMatrix(false, true);
      return;
    }

    // Avatar same-side hip = IK root and target anchor.
    upperNode.parent!.updateWorldMatrix(true, false);
    upperNode.updateWorldMatrix(false, false);
    const hipWorld = upperNode.getWorldPosition(this._v5);

    const legSolve = solveLegTarget({
      mirrorX: this._mirrorX,
      hip: ph,
      knee: pk,
      ankle: pa,
      hipWorld,
      legScale: calib.legScale(),
      legSpreadX: this._legSpreadX,
      groundY: this._groundY,
      poleAlpha: this._poleAlpha,
      footLockEnabled: this._footLockEnabled,
      footVelocityLockThreshold: this._footVelocityLockThreshold,
      footVelocityUnlockThreshold: this._footVelocityUnlockThreshold,
      footLiftThreshold: this._footLiftThreshold,
      state: {
        locked: this._footLocked[side],
        lockedPosition: this._footLockedPos[side],
        prevTarget: this._prevAnkleTarget[side],
        smoothedPole: this._polesLeg[side],
      },
    });
    const target = legSolve.target;
    this._footLocked[side] = legSolve.locked;

    getAnkleTarget(this.debugTargets, side).copy(target);
    this.debugTargets[side === 'left' ? 'leftFootLocked'   : 'rightFootLocked'] = this._footLocked[side];
    this.debugTargets.hasLeg = true;

    const smoothed = legSolve.poleDirection;

    applyTwoBoneChain({
      rootWorld: hipWorld,
      targetWorld: target,
      poleDirection: smoothed,
      upperLength: calib.upperLegLength(side),
      lowerLength: calib.lowerLegLength(side),
      upperNode,
      lowerNode,
      upperRestAxis: upperRest,
      lowerRestAxis: lowerRest,
      lerp: this._bodyLerp,
    });
    this._boneTracker.markObserved(upperName, upperNode.quaternion, this._now);
    this._boneTracker.markObserved(lowerName, lowerNode.quaternion, this._now);
  }

  private _relaxLegToRest(side: 'left' | 'right'): void {
    const upperNode = this.nodeCache.get(`${side}UpperLeg`);
    const lowerNode = this.nodeCache.get(`${side}LowerLeg`);
    if (!upperNode || !lowerNode) return;

    this._q3.identity();
    if (this._bodyLerp >= 1) upperNode.quaternion.copy(this._q3);
    else                     upperNode.quaternion.slerp(this._q3, this._bodyLerp);
    upperNode.updateWorldMatrix(false, true);

    this._q3.identity();
    if (this._bodyLerp >= 1) lowerNode.quaternion.copy(this._q3);
    else                     lowerNode.quaternion.slerp(this._q3, this._bodyLerp);
    lowerNode.updateWorldMatrix(false, true);

    this._footLocked[side] = false;
    this._polesLeg[side].set(0, 0, 0);
  }

}
