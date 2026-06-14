import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { PoseFrame } from '../pipeline/poseDetector';
import type { MocapCalibration } from '../trackers/mocapCalibration';
import { getCachedHumanoidRestAxes, HUMANOID_DIRECTION_CHILD } from '../../humanoidRestPose';
import {
  FINGER_VRM_NAMES,
  LIMB_BONES,
  LM,
  PALM_ROOT_SUFFIXES,
  PROCESS_ORDER,
} from './directPoseConfig';
import { applyWorldDirectionToBone } from './boneDirectionRetarget';
import { applyKalidoHandRetarget, applyTrackedPalmRetarget } from './handRetarget';
import { mpDeltaToVrm } from '../solvers/motionSpace';
import { BoneTracker, trackPhase, msSinceLoss, type TrackPhase } from '../trackers/boneTrackState';
import {
  createMocapDebugTargets,
  resetMocapDebugTargets,
  type MocapDebugTargets,
} from '../diagnostics/mocapDiagnostics';
import { DirectPoseSettings } from './directPoseSettings';
import type { DirectPoseRig } from './directPoseRig';
import { TorsoApplier } from './torsoApplier';
import { ArmIKApplier } from './armIKApplier';
import { LegIKApplier } from './legIKApplier';

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
 *
 * This class is a thin facade: shared state lives in the DirectPoseRig, all
 * tunables in DirectPoseSettings, and the heavy per-region math in
 * TorsoApplier / ArmIKApplier / LegIKApplier.
 */
export class DirectPoseApplier {
  private rig: DirectPoseRig;
  private settings: DirectPoseSettings;
  private torso: TorsoApplier;
  private armIK: ArmIKApplier;
  private legIK: LegIKApplier;

  private nodeCache     = new Map<string, THREE.Object3D>();
  private restLocalAxis = new Map<string, THREE.Vector3>();
  private handRestBasis = new Map<string, THREE.Quaternion>();

  // Scratch allocations — reused each frame to avoid GC pressure
  private _v1 = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  private _v3 = new THREE.Vector3();
  private _q1 = new THREE.Quaternion();
  private _qFade = new THREE.Quaternion();
  private _qBack = new THREE.Quaternion();
  private _qLeg = new THREE.Quaternion();
  private _vFwd = new THREE.Vector3();
  // Forearm de-penetration scratch (elbow/wrist world points + separation dir).
  private _pLE = new THREE.Vector3();
  private _pLW = new THREE.Vector3();
  private _pRE = new THREE.Vector3();
  private _pRW = new THREE.Vector3();
  private _depAxis = new THREE.Vector3();
  private _depDir  = new THREE.Vector3();
  private _m2 = new THREE.Matrix4();
  /** Previous-frame world quaternion per leg bone, for the guarded-mode
   *  per-frame step limit. Cleared at each session boundary. */
  private _legPrev = new Map<string, THREE.Quaternion>();

  // IK debug targets — updated each frame, read by MocapDebugViz
  readonly debugTargets: MocapDebugTargets = createMocapDebugTargets();

  constructor(vrm: VRM, calibration?: MocapCalibration) {
    this.settings = new DirectPoseSettings();
    this.rig = {
      vrm,
      nodeCache: this.nodeCache,
      restLocalAxis: this.restLocalAxis,
      boneTracker: new BoneTracker(),
      debugTargets: this.debugTargets,
      settings: this.settings,
      calibration: calibration ?? null,
      now: 0,
    };
    this._buildCache();
    this._computeRestAxes();
    this.torso = new TorsoApplier(this.rig);
    this.armIK = new ArmIKApplier(this.rig);
    this.legIK = new LegIKApplier(this.rig);
  }

  /** Late-binding hook if calibration is constructed after the applier. */
  setCalibration(c: MocapCalibration): void { this.rig.calibration = c; }

  /** The avatar's hips world quaternion at rest (before any mocap). */
  get hipsBaseWorld(): THREE.Quaternion { return this.torso.hipsBaseWorld; }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Shoulder spread in degrees. Positive = shoulders droop outward (wider silhouette). */
  setShoulderSpread(deg: number): void { this.settings.setShoulderSpread(deg); }
  get shoulderSpread(): number { return this.settings.shoulderSpreadDeg; }

  /** Multiplier on the X-component of the foot IK target offset from hip.
   *  1.0 = no change. >1 fans feet outward, <1 pulls them inward. */
  setLegSpreadX(v: number): void { this.settings.setLegSpreadX(v); }
  get legSpreadX(): number { return this.settings.legSpreadX; }

  /** Limb (arm/leg) smoothing lerp factor (0 = frozen, 1 = instant). */
  setBodySmoothing(v: number): void { this.settings.setBodySmoothing(v); }
  get bodySmoothing(): number { return this.settings.bodyLerp; }

  /** Spine/hips smoothing lerp factor — kept lower than limbs for stable torso. */
  setSpineSmoothing(v: number): void { this.settings.setSpineSmoothing(v); }
  get spineSmoothing(): number { return this.settings.spineLerp; }

  /** How much MediaPipe Z depth affects arm IK target (0 = flat 2D, 1 = full 3D). */
  setArmZAttenuation(v: number): void { this.settings.setArmZAttenuation(v); }
  get armZAttenuation(): number { return this.settings.armZAttenuation; }

  setArmBackLimitDeg(v: number): void { this.settings.setArmBackLimitDeg(v); }
  get armBackLimitDeg(): number { return this.settings.armBackLimitDeg; }

  /** Pole vector EMA alpha for arm/leg IK (0 = frozen, 1 = instant, no smoothing). */
  setPoleSmoothing(v: number): void { this.settings.setPoleSmoothing(v); }
  get poleSmoothing(): number { return this.settings.poleAlpha; }

  /** Weight of the Z component in the arm pole vector (0 = flat, 1 = full 3D). */
  setArmPoleZ(v: number): void { this.settings.setArmPoleZ(v); }
  get armPoleZ(): number { return this.settings.armPoleZ; }

  /** Enable/disable hip world-position tracking (performer moves → avatar moves). */
  setHipPositionEnabled(v: boolean): void { this.settings.hipPositionEnabled = v; }
  get hipPositionEnabled(): boolean { return this.settings.hipPositionEnabled; }

  /** Reset hip position baseline — next frame re-anchors to current performer position. */
  resetHipBaseline(): void { this.torso.resetBaselines(); }

  /** Release any locked feet and reset velocity history. Call on recalibrate / stop. */
  resetFootLock(): void { this.legIK.resetFootLock(); }

  /** Enable/disable foot locking. Disabling also releases any active lock. */
  setFootLockEnabled(v: boolean): void {
    this.settings.footLockEnabled = v;
    if (!v) this.legIK.resetFootLock();
  }
  get footLockEnabled(): boolean { return this.settings.footLockEnabled; }

  /** Fraction of shoulder lateral tilt applied as spine side-lean (0–1). */
  setLateralBendScale(v: number): void { this.settings.setLateralBendScale(v); }
  get lateralBendScale(): number { return this.settings.lateralBendScale; }

  /** Avatar's rest-pose ankle height above the scene floor (metres). Read-only debug info. */
  get groundY(): number { return this.legIK.groundY; }

  /** HQ mode: snap to target (no slerp), full amplitude — for BVH recording. */
  setHighQualityMode(enabled: boolean): void {
    this.settings.setHighQualityMode(enabled);
    if (enabled) this.legIK.resetFootLock();
  }

  /** Trusted-geometry retarget — gate on full-body coverage, see settings. */
  setTrustedInputMode(enabled: boolean): void {
    this.settings.setTrustedInputMode(enabled);
    this._legPrev.clear(); // new run — drop stale per-bone step history
  }

  /** Honest torso depth — gate on a successful 3D lift, see settings. */
  setTorsoDepthTrusted(enabled: boolean): void {
    this.settings.setTorsoDepthTrusted(enabled);
  }

  /** When enabled, wrist + fingers from hand tracking are treated as a top layer. */
  setHandTrackingPriorityEnabled(v: boolean): void { this.settings.handTrackingPriorityEnabled = v; }
  get handTrackingPriorityEnabled(): boolean { return this.settings.handTrackingPriorityEnabled; }

  /** Mirror landmarks left↔right so the model reflects the user. */
  setMirrorX(enabled: boolean): void { this.settings.mirrorX = enabled; }
  get mirrorX(): boolean { return this.settings.mirrorX; }

  /** Scale MediaPipe Z (depth). 0 = planar (no depth), 1 = full 3D.
   *  Lower values help when depth estimation is jittery and arms "pass through"
   *  each other or the torso. Sweet spot is usually 0.3–0.6. */
  setDepthScale(v: number): void { this.settings.setDepthScale(v); }
  get depthScale(): number { return this.settings.depthScale; }

  /** Landmarks whose visibility score is below this threshold are considered
   *  untracked — their bones are left at their previous value, preserving
   *  idle / animation output on body parts that aren't in the video frame. */
  setVisibilityThreshold(v: number): void { this.settings.setVisibilityThreshold(v); }
  get visibilityThreshold(): number { return this.settings.visibilityThreshold; }

  /** Enable / disable the bilateral-symmetry IK fallback (A3). When ON, an
   *  invisible arm or leg chain copies its mirror partner's local quaternions
   *  if the partner is currently live. Off by default. */
  setSymmetryFallback(v: boolean): void { this.settings.symmetryFallback = v; }
  get symmetryFallback(): boolean { return this.settings.symmetryFallback; }

  apply(frame: PoseFrame): void {
    // Cache `now` for the state machine — all bone updates within a single
    // apply() must use the same timestamp so phase boundaries (FRESH→DECAYING
    // etc.) don't drift across the loop.
    this.rig.now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    // Debug target flags are frame-local; reset them before solving this frame
    // so stale arm/leg IK markers do not survive when tracking drops out.
    resetMocapDebugTargets(this.debugTargets);

    // Torso first — its rotations propagate to limbs via parent world matrices.
    this.torso.applyHips(frame);
    this.torso.applySpine(frame);
    this.torso.applyHead(frame);
    this.torso.applyShoulders(frame);

    // Arms + legs: two-bone IK (hand/ankle target scaled to avatar space)
    // once calibration is ready; otherwise fall back to angle-based so
    // tracking is not blocked by an un-calibrated performer.
    const calibration = this.rig.calibration;
    const ikReady = calibration?.calibrated === true;
    const legsReady = (calibration?.readiness().legs ?? 0) >= 1;
    // Limbs default to direction retargeting (length-invariant joint angle);
    // only use scaled position-IK when explicitly disabled.
    const armIKMode = !this.settings.armDirectionRetarget;
    const legIKMode = !this.settings.legDirectionRetarget;
    // Contact fixup (доводка): when the performer's wrists are close (hands
    // together) the direction pose leaves a gap between the avatar's hands —
    // fall back to position-IK for THIS frame so the wrists meet exactly.
    const armContact = ikReady && !armIKMode && this.settings.armContactFixup
      && this._wristsClose(frame);
    const useArmIK = armIKMode || armContact;
    for (const bone of PROCESS_ORDER) {
      const isArmUpper = bone === 'leftUpperArm' || bone === 'rightUpperArm';
      const isArmLower = bone === 'leftLowerArm' || bone === 'rightLowerArm';
      const isLegUpper = bone === 'leftUpperLeg' || bone === 'rightUpperLeg';
      const isLegLower = bone === 'leftLowerLeg' || bone === 'rightLowerLeg';
      if (ikReady && isArmUpper && useArmIK) {
        this.armIK.apply(frame, bone.startsWith('left') ? 'left' : 'right');
        continue;
      }
      if (ikReady && isLegUpper && legIKMode) {
        if (legsReady) this.legIK.apply(frame, bone.startsWith('left') ? 'left' : 'right');
        else this.legIK.relaxToRest(bone.startsWith('left') ? 'left' : 'right');
        continue;
      }
      // Skip lower bones handled by an upper IK pass; a limb in direction mode
      // falls through to _applyLimb (its own landmark direction).
      if (ikReady && ((isArmLower && useArmIK) || (isLegLower && legIKMode))) continue;
      const [pIdx, cIdx] = LIMB_BONES[bone];
      this._applyLimb(bone, frame, pIdx, cIdx);
    }

    if (this.settings.forearmClearance > 0) this._resolveForearmContact();

    this.applyTrackedHands(frame, this.settings.handTrackingPriorityEnabled);
  }

  /**
   * Resolve forearm contact. Two regimes:
   *
   *  - Hands together (wrists within `handMergeThreshold`): a prayer/clasp. The
   *    independent direction retarget over-rotates each forearm past centre, so
   *    the wrists CROSS into an X and the hands interpenetrate. Pull both wrists
   *    to their shared midpoint, split by a small gap along the elbow-to-elbow
   *    axis — left stays left, right stays right — so the forearms make a clean
   *    V and the palms meet without crossing.
   *
   *  - Forearms folded but hands apart (segments closer than `forearmClearance`,
   *    wrists not together): one forearm should pass in front of the other.
   *    Separate them in depth so the meshes don't pass through.
   */
  private _resolveForearmContact(): void {
    const lE = this.nodeCache.get('leftLowerArm');
    const lW = this.nodeCache.get('leftHand');
    const rE = this.nodeCache.get('rightLowerArm');
    const rW = this.nodeCache.get('rightHand');
    if (!lE || !lW || !rE || !rW) return;
    // Elbows are fixed by the upper-arm pose; only the wrists move as we re-aim.
    lE.getWorldPosition(this._pLE);
    rE.getWorldPosition(this._pRE);
    lW.getWorldPosition(this._pLW);
    rW.getWorldPosition(this._pRW);

    if (this._pLW.distanceTo(this._pRW) < this.settings.handMergeThreshold) {
      this._mergeWristsToMidpoint(lE, rE);
    } else {
      this._depthSeparateForearms(lE, rE, lW, rW);
    }
  }

  /** Prayer/clasp: aim both forearms at the shared wrist midpoint, split by a
   *  small gap along the elbow-to-elbow axis so the hands meet without crossing. */
  private _mergeWristsToMidpoint(lE: THREE.Object3D, rE: THREE.Object3D): void {
    // Elbow-to-elbow axis (right→left): keeps the left hand on the left side.
    this._depAxis.copy(this._pLE).sub(this._pRE);
    if (this._depAxis.lengthSq() < 1e-8) this._depAxis.set(1, 0, 0);
    else this._depAxis.normalize();
    const half = this.settings.handContactGap * 0.5;
    // Midpoint of the two wrists.
    this._depDir.copy(this._pLW).add(this._pRW).multiplyScalar(0.5);
    this._pLW.copy(this._depDir).addScaledVector(this._depAxis,  half); // left target
    this._pRW.copy(this._depDir).addScaledVector(this._depAxis, -half); // right target
    this._reaimLowerArm('leftLowerArm', lE, this._pLE, this._pLW);
    this._reaimLowerArm('rightLowerArm', rE, this._pRE, this._pRW);
  }

  /** Folded arms: push the forearms apart in depth until they clear. */
  private _depthSeparateForearms(
    lE: THREE.Object3D, rE: THREE.Object3D, lW: THREE.Object3D, rW: THREE.Object3D,
  ): void {
    const clearance = this.settings.forearmClearance;
    // Separate ONLY in depth (world Z) so the hands keep meeting in the image
    // plane — one forearm passes in front of the other, like the video, instead
    // of spreading sideways. Left to the front (VRM faces -Z), right to the back.
    this._depAxis.set(0, 0, -1);
    for (let iter = 0; iter < 4; iter++) {
      lW.getWorldPosition(this._pLW);
      rW.getWorldPosition(this._pRW);
      const dist = this._segNearest(this._pLE, this._pLW, this._pRE, this._pRW, this._depDir);
      if (dist >= clearance) break;
      const push = (clearance - dist) * 0.5;
      this._pLW.addScaledVector(this._depAxis,  push);
      this._pRW.addScaledVector(this._depAxis, -push);
      this._reaimLowerArm('leftLowerArm', lE, this._pLE, this._pLW);
      this._reaimLowerArm('rightLowerArm', rE, this._pRE, this._pRW);
    }
  }

  /** Re-aim a lower-arm bone so it points from its elbow at a new wrist target. */
  private _reaimLowerArm(
    bone: string,
    node: THREE.Object3D,
    elbowWorld: THREE.Vector3,
    wristTarget: THREE.Vector3,
  ): void {
    const restAxis = this.restLocalAxis.get(bone);
    if (!restAxis) return;
    this._depDir.copy(wristTarget).sub(elbowWorld);
    if (this._depDir.lengthSq() < 1e-8) return;
    applyWorldDirectionToBone({ node, restAxis, worldDirection: this._depDir, lerp: 1 });
  }

  /** Closest distance between segments [a1,a2] and [b1,b2]; writes the
   *  (segA-point − segB-point) vector into `outAxis`. */
  private _segNearest(
    a1: THREE.Vector3, a2: THREE.Vector3,
    b1: THREE.Vector3, b2: THREE.Vector3,
    outAxis: THREE.Vector3,
  ): number {
    const d1 = this._v1.copy(a2).sub(a1);
    const d2 = this._v2.copy(b2).sub(b1);
    const r  = this._v3.copy(a1).sub(b1);
    const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2);
    const den = a * e - b * b;
    let s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
    let t = (b * s + f) / (e || 1);
    if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / (a || 1), 0, 1); }
    else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / (a || 1), 0, 1); }
    // closest points: a1 + d1*s , b1 + d2*t
    outAxis.copy(a1).addScaledVector(d1, s).sub(b1).addScaledVector(d2, -t);
    return outAxis.length();
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
          mirrorX: this.settings.mirrorX,
          handLerp: this.settings.handLerp,
        }, hand, true);
      }
      applyKalidoHandRetarget({
        nodeCache: this.nodeCache,
        handRestBasis: this.handRestBasis,
        mirrorX: this.settings.mirrorX,
        handLerp: this.settings.handLerp,
      }, hand.landmarks, hand.side, false, prioritized);
    }
  }

  /** Per-chain tracking-health readout for the D1-lite debug panel.
   *  Each entry reports the current state-machine phase for a representative
   *  bone of the chain (upper arm / upper leg / hips / spine) plus how many
   *  milliseconds since the bone's last visible frame. Returns 0 when live. */
  getTrackingHealth(): TrackingHealth {
    const now = this.rig.now > 0 ? this.rig.now :
      (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const get = (name: string): BoneChainHealth => {
      const s = this.rig.boneTracker.state(name);
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

  private _buildCache(): void {
    const names = new Set<string>([
      ...Object.keys(LIMB_BONES),
      ...Object.values(HUMANOID_DIRECTION_CHILD), // leftHand, leftFoot, …
      ...FINGER_VRM_NAMES,
      'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftShoulder', 'rightShoulder',
    ]);
    for (const name of names) {
      const node = this.rig.vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
      if (node) this.nodeCache.set(name, node);
    }
  }

  private _computeRestAxes(): void {
    const restAxes = getCachedHumanoidRestAxes(this.rig.vrm);
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
    let effectiveDepthScale = this.settings.depthScale;
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
    mpDeltaToVrm(this.settings.mirrorX, dx, dy, dz, out, effectiveDepthScale);
  }

  /**
   * Contact detector for the arm fixup: are the performer's wrists close enough
   * (relative to shoulder width) to count as "hands together"? Scale-relative so
   * it works at any camera distance.
   */
  private _wristsClose(frame: PoseFrame): boolean {
    const w = frame.worldLandmarks;
    const lw = w[LM.LEFT_WRIST], rw = w[LM.RIGHT_WRIST];
    const ls = w[LM.LEFT_SHOULDER], rs = w[LM.RIGHT_SHOULDER];
    if (!lw || !rw || !ls || !rs) return false;
    if (!this.settings.isVisible(lw) || !this.settings.isVisible(rw)) return false;
    const shoulderSpan = Math.hypot(ls.x - rs.x, ls.y - rs.y, ls.z - rs.z);
    if (shoulderSpan < 1e-3) return false;
    const wristGap = Math.hypot(lw.x - rw.x, lw.y - rw.y, lw.z - rw.z);
    // Within ~0.6 shoulder-widths → hands meeting / clasped / one-on-other.
    return wristGap < shoulderSpan * 0.6;
  }

  /** Pull a world-space bone direction forward so it sits no more than
   *  `armBackLimitDeg` behind the hips' coronal plane (VRM faces -Z).
   *  Mutates `dir` in place; magnitude is preserved by the consumer's
   *  re-normalize, so we only adjust the backward component. */
  private _clampDirectionBack(dir: THREE.Vector3): void {
    const hips = this.nodeCache.get('hips');
    if (!hips) return;
    hips.getWorldQuaternion(this._qBack);
    this._vFwd.set(0, 0, -1).applyQuaternion(this._qBack); // hips forward
    this._vFwd.y = 0;
    if (this._vFwd.lengthSq() < 1e-6) return;
    this._vFwd.normalize();
    const len = dir.length();
    if (len < 1e-6) return;
    const back = -dir.dot(this._vFwd); // >0 = behind the coronal plane
    if (back <= 0) return;
    const maxBack = Math.sin((this.settings.armBackLimitDeg * Math.PI) / 180) * len;
    if (back <= maxBack) return;
    dir.addScaledVector(this._vFwd, back - maxBack); // remove excess backward
  }

  /** Pre-calibration / non-IK bones: angle-based direction retargeting. */
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
      const fadeTarget = this.rig.boneTracker.fade(boneName, this.rig.now, this._qFade);
      node.quaternion.slerp(fadeTarget, this.settings.bodyLerp);
      return;
    }
    const visible = this.settings.isVisible(p) && this.settings.isVisible(c);

    if (visible) {
      this._mpDeltaToVrm(c.x - p.x, c.y - p.y, c.z - p.z, this._v1);
      if (this._v1.lengthSq() < 1e-6) return;
      // Depth/foreshortening ambiguity can fling an arm segment behind the
      // body. Clamp the backward reach of arm bone directions to the user
      // limit (90 = off). Legs/spine are unaffected.
      if (this.settings.armBackLimitDeg < 90
        && (boneName === 'leftUpperArm' || boneName === 'rightUpperArm'
          || boneName === 'leftLowerArm' || boneName === 'rightLowerArm')) {
        this._clampDirectionBack(this._v1);
      }
      applyWorldDirectionToBone({
        node,
        restAxis,
        worldDirection: this._v1,
        lerp: this.settings.bodyLerp,
      });
      this._rateLimitLeg(boneName, node);
      // Capture the resulting local quaternion as last-good for the tracker.
      this.rig.boneTracker.markObserved(boneName, node.quaternion, this.rig.now);
    } else {
      // A1: instead of snap-freezing, fade toward rest via state machine.
      const fadeTarget = this.rig.boneTracker.fade(boneName, this.rig.now, this._qFade);
      node.quaternion.slerp(fadeTarget, this.settings.bodyLerp);
      this._rateLimitLeg(boneName, node);
    }
  }

  /** Guarded-mode per-frame step limit for the four leg bones: clamp this
   *  frame's WORLD rotation to within `legStepMaxDeg` of the previous frame's,
   *  killing single-frame hallucination teleports on half-body footage.
   *  No-op for non-leg bones or when the limit is off (trusted mode). */
  private _rateLimitLeg(boneName: string, node: THREE.Object3D): void {
    if (this.settings.legStepMaxDeg >= 180) return;
    if (boneName !== 'leftUpperLeg' && boneName !== 'rightUpperLeg'
      && boneName !== 'leftLowerLeg' && boneName !== 'rightLowerLeg') return;
    let prev = this._legPrev.get(boneName);
    if (prev) {
      const maxRad = (this.settings.legStepMaxDeg * Math.PI) / 180;
      if (prev.angleTo(node.quaternion) > maxRad) {
        this._qLeg.copy(prev).rotateTowards(node.quaternion, maxRad);
        node.quaternion.copy(this._qLeg);
        node.updateWorldMatrix(false, true); // propagate to child leg bone
      }
    } else {
      prev = new THREE.Quaternion();
      this._legPrev.set(boneName, prev);
    }
    prev.copy(node.quaternion);
  }
}
