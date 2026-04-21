import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { Hand as KalidoHand } from 'kalidokit';
import type { PoseFrame } from './poseDetector';
import type { MocapCalibration } from './mocapCalibration';
import { solveTwoBoneIK, type TwoBoneIKResult } from './twoBoneIK';

// ── MediaPipe BlazePose landmark indices ──────────────────────────────────────

const LM = {
  LEFT_SHOULDER:  11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW:     13, RIGHT_ELBOW:    14,
  LEFT_WRIST:     15, RIGHT_WRIST:    16,
  LEFT_HIP:       23, RIGHT_HIP:      24,
  LEFT_KNEE:      25, RIGHT_KNEE:     26,
  LEFT_ANKLE:     27, RIGHT_ANKLE:    28,
} as const;

// VRM bone → [parent-landmark index, child-landmark index].
// Swapped sides for mirror effect: person's right hand drives character's LEFT
// bones (which in VRM T-pose appear on viewer's right side when character
// faces the camera). Combined with _mirrorX=true, this gives correct identity
// rotation in T-pose and natural mirror behaviour during motion.
const LIMB_BONES: Record<string, [number, number]> = {
  leftUpperArm:  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  leftLowerArm:  [LM.RIGHT_ELBOW,    LM.RIGHT_WRIST],
  rightUpperArm: [LM.LEFT_SHOULDER,  LM.LEFT_ELBOW],
  rightLowerArm: [LM.LEFT_ELBOW,     LM.LEFT_WRIST],
  leftUpperLeg:  [LM.RIGHT_HIP,      LM.RIGHT_KNEE],
  leftLowerLeg:  [LM.RIGHT_KNEE,     LM.RIGHT_ANKLE],
  rightUpperLeg: [LM.LEFT_HIP,       LM.LEFT_KNEE],
  rightLowerLeg: [LM.LEFT_KNEE,      LM.LEFT_ANKLE],
};

// Which VRM bone is the "child" used to compute the rest axis of this bone.
const BONE_CHILD: Record<string, string> = {
  leftShoulder:  'leftUpperArm',
  leftUpperArm:  'leftLowerArm',
  leftLowerArm:  'leftHand',
  rightShoulder: 'rightUpperArm',
  rightUpperArm: 'rightLowerArm',
  rightLowerArm: 'rightHand',
  leftUpperLeg:  'leftLowerLeg',
  leftLowerLeg:  'leftFoot',
  rightUpperLeg: 'rightLowerLeg',
  rightLowerLeg: 'rightFoot',
};

// BFS order — parent bones processed before children so their world matrices
// are up-to-date when we compute the child's parent-local target direction.
const PROCESS_ORDER: string[] = [
  'leftUpperArm', 'leftLowerArm',
  'rightUpperArm', 'rightLowerArm',
  'leftUpperLeg', 'leftLowerLeg',
  'rightUpperLeg', 'rightLowerLeg',
];

// ── Finger bone names (KalidoKit-driven, unchanged from KalidoKit-based applier) ──

const FINGER_VRM_NAMES = (() => {
  const names: string[] = [];
  for (const side of ['left', 'right'] as const) {
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const) {
      for (const seg of ['Metacarpal', 'Proximal', 'Intermediate', 'Distal'] as const) {
        if (finger === 'Thumb' && seg === 'Intermediate') continue;
        names.push(`${side}${finger}${seg}`);
      }
    }
  }
  return names;
})();

function kalidoHandBoneToVrm(kalidoName: string): string {
  const side    = kalidoName.startsWith('Right') ? 'right' : 'left';
  const without = kalidoName.replace(/^(Left|Right)/, '');
  // KalidoKit's "Wrist" is VRM's hand bone (the wrist/palm joint).
  if (without === 'Wrist') return side + 'Hand';
  const suffix  = without === 'ThumbProximal'     ? 'ThumbMetacarpal'
                : without === 'ThumbIntermediate' ? 'ThumbProximal'
                : without;
  return side + suffix;
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

  // sysAnimOnline uses separate filters per body region:
  //   head_chest_rot: minCutoff=0.25 → very heavy torso smoothing (stable trunk)
  //   arm_rot/IK:     minCutoff=0.5, beta=0.5 → responsive arms
  // We mirror this with separate lerp values: low for spine (stable), high for limbs.
  private _spineLerp    = 0.25;  // hips + spine/chest twist — heavily smoothed
  private _bodyLerp     = 0.7;   // arms + legs IK
  private _handLerp     = 0.7;
  private _mirrorX      = true;  // mirror landmarks left↔right (selfie view)
  private _depthScale   = 1;     // Default to full 3D depth; the panel can still reduce it if Z gets noisy
  private _visThreshold = 0.3;   // MediaPipe visibility score below this = skip bone

  // Shoulder spread: Z-axis rotation applied to leftShoulder / rightShoulder every
  // frame. Positive = shoulders droop outward (broader silhouette). Range ±20°.
  private _shoulderSpreadDeg = 0;

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

  // Scratch allocations — reused each frame to avoid GC pressure
  private _v1 = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  private _v3 = new THREE.Vector3();
  private _v4 = new THREE.Vector3();
  private _v5 = new THREE.Vector3();
  private _v6 = new THREE.Vector3();
  private _q1 = new THREE.Quaternion();
  private _q2 = new THREE.Quaternion();
  private _m1 = new THREE.Matrix4();
  private _ikResult: TwoBoneIKResult = {
    upperDir: new THREE.Vector3(),
    elbowPos: new THREE.Vector3(),
    lowerDir: new THREE.Vector3(),
    reachable: true,
  };

  // IK debug targets — updated each frame, read by MocapDebugViz
  readonly debugTargets = {
    leftWristTarget:  new THREE.Vector3(),
    rightWristTarget: new THREE.Vector3(),
    leftElbowTarget:  new THREE.Vector3(),
    rightElbowTarget: new THREE.Vector3(),
    leftArmPoleRaw:   new THREE.Vector3(),
    rightArmPoleRaw:  new THREE.Vector3(),
    leftArmPoleSmoothed:  new THREE.Vector3(),
    rightArmPoleSmoothed: new THREE.Vector3(),
    leftAnkleTarget:  new THREE.Vector3(),
    rightAnkleTarget: new THREE.Vector3(),
    hasArm:         false,
    hasLeg:         false,
    leftFootLocked:  false,
    rightFootLocked: false,
  };

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

  // Fraction of shoulder lateral tilt applied to spine/chest as a side-lean.
  // 0 = yaw-only (original behaviour), ~0.3–0.5 = natural-looking lateral bend.
  private _lateralBendScale = 0.35;

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
  resetHipBaseline(): void { this._hipPerfBaseline = null; }

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
    // Torso first — its rotations propagate to limbs via parent world matrices.
    this._applyHips(frame);
    this._applySpine(frame);
    this._applyShoulders(frame);

    // Arms + legs: two-bone IK (hand/ankle target scaled to avatar space)
    // once calibration is ready; otherwise fall back to angle-based so
    // tracking is not blocked by an un-calibrated performer.
    const ikReady = this.calibration?.calibrated === true;
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
        this._applyLegIK(frame, bone.startsWith('left') ? 'left' : 'right');
        continue;
      }
      if (ikReady && (isArmLower || isLegLower)) continue; // handled in the upper pass
      const [pIdx, cIdx] = LIMB_BONES[bone];
      this._applyLimb(bone, frame, pIdx, cIdx);
    }

    for (const hand of frame.hands) {
      this._applyHand(hand.landmarks, hand.side);
    }
  }

  /** Local normalized-bone quaternion as [x,y,z,w] — for BVH recording. */
  getQuaternion(boneName: string): [number, number, number, number] | null {
    const n = this.nodeCache.get(boneName);
    if (!n) return null;
    const q = n.quaternion;
    return [q.x, q.y, q.z, q.w];
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
      ...Object.values(BONE_CHILD), // leftHand, leftFoot, …
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
    for (const [bone, childName] of Object.entries(BONE_CHILD)) {
      const boneNode  = this.nodeCache.get(bone);
      const childNode = this.nodeCache.get(childName);
      if (!boneNode || !childNode) continue;
      // In the normalized (T-pose) skeleton, childNode.position is the local
      // offset from bone origin to child origin — which IS the bone's local
      // primary axis (modulo sign).
      const axis = childNode.position.clone();
      if (axis.lengthSq() < 1e-6) continue;
      axis.normalize();
      this.restLocalAxis.set(bone, axis);
    }
  }

  /**
   * Convert a MediaPipe world-space DELTA to VRM world-space, with depth scale.
   * Use for IK *position* targets — depth scale reduces noisy Z in hand/foot placement.
   */
  private _mpDeltaToVrm(dx: number, dy: number, dz: number, out: THREE.Vector3): void {
    out.set(this._mirrorX ? -dx : dx, -dy, -dz * this._depthScale);
  }

  /**
   * Convert a MediaPipe world-space DIRECTION to VRM world-space, without depth scale.
   * Use for *orientation* vectors (torso basis, spine twist) so body rotation isn't
   * halved by the depth scale setting.
   */
  private _mpDirToVrm(dx: number, dy: number, dz: number, out: THREE.Vector3): void {
    out.set(this._mirrorX ? -dx : dx, -dy, -dz);
  }

  /**
   * Same as `_mpDirToVrm` but with Z damped 3× — for torso basis vectors
   * (hip axis, shoulder axis, spine up). MediaPipe's Z on these wide-body
   * measurements is very noisy (small torso rotations toward the camera
   * dominate), and without damping the torso tends to tilt forward/backward.
   * Matches sysAnimOnline's `arm_diff[2] /= 3` trick for shoulder width.
   */
  private _mpDirToVrmTorso(dx: number, dy: number, dz: number, out: THREE.Vector3): void {
    out.set(this._mirrorX ? -dx : dx, -dy, -dz / 3);
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

      let hasAuto = false;
      if (shouldersVisible && performerShoulder && ls && rs) {
        const midX = (ls.x + rs.x) * 0.5;
        const midY = (ls.y + rs.y) * 0.5;
        const midZ = (ls.z + rs.z) * 0.5;
        this._mpDirToVrmTorso(
          performerShoulder.x - midX,
          performerShoulder.y - midY,
          performerShoulder.z - midZ,
          this._v1,
        );
        if (this._v1.lengthSq() > 1e-6) {
          this._v1.normalize();
          node.parent.updateWorldMatrix(true, false);
          node.parent.getWorldQuaternion(this._q1).invert();
          this._v1.applyQuaternion(this._q1);
          this._q2.setFromUnitVectors(restAxis, this._v1);
          hasAuto = true;
        }
      }

      this._q3.setFromAxisAngle(this._v2.set(0, 0, 1), spreadSign * rad);
      if (hasAuto) node.quaternion.copy(this._q2).multiply(this._q3);
      else         node.quaternion.copy(this._q3);
      node.updateWorldMatrix(false, true);
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
    if (!lh || !rh || !ls || !rs) return;
    // Need all four torso landmarks to be visible for a reliable basis
    if (!this._visible(lh) || !this._visible(rh) ||
        !this._visible(ls) || !this._visible(rs)) return;

    // Spine up direction (midHip → midShoulder) — torso Z is MP's noisiest axis
    // and easily tilts the character forward/backward; damp it 3×.
    const spineDir = this._v1;
    this._mpDirToVrmTorso(
      (ls.x + rs.x) / 2 - (lh.x + rh.x) / 2,
      (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2,
      (ls.z + rs.z) / 2 - (lh.z + rh.z) / 2,
      spineDir,
    );
    if (spineDir.lengthSq() < 1e-6) return;
    spineDir.normalize();

    // Hip axis — damp Z 3× (same reason as spine). Sideways body turns still
    // work because they're captured by X/Y changes of the hip vector.
    const hipAxis = this._v2;
    this._mpDirToVrmTorso(rh.x - lh.x, rh.y - lh.y, rh.z - lh.z, hipAxis);
    if (hipAxis.lengthSq() < 1e-6) return;
    hipAxis.normalize();

    // Build orthonormal basis: Z = X × Y, then re-orthogonalise X = Y × Z.
    const zAxis = this._v3.crossVectors(hipAxis, spineDir);
    if (zAxis.lengthSq() < 1e-6) return;
    zAxis.normalize();
    const xAxis = this._v4.crossVectors(spineDir, zAxis).normalize();

    this._m1.makeBasis(xAxis, spineDir, zAxis);
    this._q1.setFromRotationMatrix(this._m1);   // M = body pose delta from T-pose

    // Compose with the VRM's default hips facing so the character preserves
    // its natural orientation at T-pose (M=identity → result = baseline).
    this._q1.premultiply(this._hipsBaseWorld);  // target world = baseline * M

    // Convert to hips.parent local frame
    hipsNode.parent.updateWorldMatrix(true, false);
    hipsNode.parent.getWorldQuaternion(this._q2).invert();
    this._q1.premultiply(this._q2);             // parentInv * worldTarget = local

    if (this._spineLerp >= 1) hipsNode.quaternion.copy(this._q1);
    else                      hipsNode.quaternion.slerp(this._q1, this._spineLerp);
    hipsNode.updateWorldMatrix(false, true);

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
      this._mpDeltaToVrm(
        cx - this._hipPerfBaseline.x,
        cy - this._hipPerfBaseline.y,
        cz - this._hipPerfBaseline.z,
        this._v1,
      );
      this._v1.multiplyScalar(scale);

      // Target in world space, convert to hips-parent local
      this._v2.copy(this._hipAvatarBaseline).add(this._v1);
      hipsNode.parent!.getWorldPosition(this._v3);
      hipsNode.parent!.getWorldQuaternion(this._q1).invert();
      this._v4.subVectors(this._v2, this._v3).applyQuaternion(this._q1);

      if (this._spineLerp >= 1) hipsNode.position.copy(this._v4);
      else                      hipsNode.position.lerp(this._v4, this._spineLerp);
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
    if (!ls || !rs) return;
    if (!this._visible(ls) || !this._visible(rs)) return;

    const hipsVisible = !!lh && !!rh && this._visible(lh) && this._visible(rh);

    // Shoulder line in VRM world — Z-damped (torso basis).
    const shoulderAxis = this._v2;
    this._mpDirToVrmTorso(rs.x - ls.x, rs.y - ls.y, rs.z - ls.z, shoulderAxis);
    if (shoulderAxis.lengthSq() < 1e-6) return;

    // Hip line — either live from landmarks, or the avatar's rest reference
    // (upper-body-only shots: hips not in frame). The reference vector is
    // already in hips-local + XZ-projected, so we just skip the transform for it.
    const hipAxis = this._v1;
    if (hipsVisible) {
      this._mpDirToVrmTorso(rh!.x - lh!.x, rh!.y - lh!.y, rh!.z - lh!.z, hipAxis);
      if (hipAxis.lengthSq() < 1e-6) return;
    }

    // Transform shoulder axis into hips local frame
    hipsNode.updateWorldMatrix(true, false);
    hipsNode.getWorldQuaternion(this._q1).invert();
    shoulderAxis.applyQuaternion(this._q1);

    // Capture lateral tilt BEFORE XZ projection.
    // shoulderAxis.y / |shoulderAxis| ≈ sin(tilt angle): negative when the right
    // shoulder is lower (character tilts right), positive when leaning left.
    const axisLen = shoulderAxis.length();
    const lateralTilt = axisLen > 1e-6 ? shoulderAxis.y / axisLen : 0;

    shoulderAxis.y = 0;
    if (shoulderAxis.lengthSq() < 1e-6) return;
    shoulderAxis.normalize();

    if (hipsVisible) {
      hipAxis.applyQuaternion(this._q1);
      hipAxis.y = 0;
      if (hipAxis.lengthSq() < 1e-6) return;
      hipAxis.normalize();
    } else {
      hipAxis.copy(this._avatarShoulderRestLocal);
    }

    // Yaw twist: rotation from hip axis to shoulder axis in hips-local XZ.
    // At T-pose both project to the same direction → identity (no baseline bias).
    const fullTwist = this._q1.setFromUnitVectors(hipAxis, shoulderAxis);

    // Lateral bend: apply a fraction of the shoulder tilt as a side-lean rotation
    // around the spine's local +Z axis. Rotation around +Z by a negative angle
    // tilts +Y toward +X (lean right), matching lateralTilt < 0 when right-low.
    if (Math.abs(lateralTilt) > 1e-4 && this._lateralBendScale > 1e-4) {
      this._q3.setFromAxisAngle(this._v3.set(0, 0, 1), lateralTilt * this._lateralBendScale);
      fullTwist.multiply(this._q3);
    }

    // Split evenly across available spine nodes.
    const count = (spineNode ? 1 : 0) + (chestNode ? 1 : 0);
    const halfTwist = this._q2.identity().slerp(fullTwist, 1 / count);

    const applyTwist = (node: THREE.Object3D): void => {
      if (this._spineLerp >= 1) node.quaternion.copy(halfTwist);
      else                      node.quaternion.slerp(halfTwist, this._spineLerp);
      node.updateWorldMatrix(false, true);
    };
    if (spineNode) applyTwist(spineNode);
    if (chestNode) applyTwist(chestNode);
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
    if (!p || !c) return;
    // Skip this limb if either endpoint is poorly tracked — leave the bone
    // at its previous rotation so idle / animation layers can retain control.
    if (!this._visible(p) || !this._visible(c)) return;

    // 1. Target world direction in VRM coords
    this._mpDeltaToVrm(c.x - p.x, c.y - p.y, c.z - p.z, this._v1);
    if (this._v1.lengthSq() < 1e-6) return;
    this._v1.normalize();

    // 2. Convert to bone's parent local frame
    node.parent.updateWorldMatrix(true, false);
    node.parent.getWorldQuaternion(this._q1).invert();
    this._v1.applyQuaternion(this._q1);

    // 3. Local rotation: rest axis → target direction
    this._q2.setFromUnitVectors(restAxis, this._v1);

    // 4. Smooth or snap
    if (this._bodyLerp >= 1) node.quaternion.copy(this._q2);
    else                     node.quaternion.slerp(this._q2, this._bodyLerp);

    // 5. Refresh so the child bone sees the updated parent world rotation
    node.updateWorldMatrix(false, true);
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
    if (!perfLs || !perfRs || !ps || !pe || !pw) return;
    if (!this._visible(perfLs) || !this._visible(perfRs) || !this._visible(ps) || !this._visible(pe) || !this._visible(pw)) return;

    // Avatar same-side shoulder = IK root. Target anchor is the midpoint of both shoulders.
    upperNode.parent!.updateWorldMatrix(true, false);
    upperNode.updateWorldMatrix(false, false);
    const shoulderWorld = upperNode.getWorldPosition(this._v5);
    const otherUpperNode = this.nodeCache.get((side === 'left' ? 'right' : 'left') + 'UpperArm');
    if (!otherUpperNode) return;
    otherUpperNode.updateWorldMatrix(false, false);
    const midAvatarShoulder = this._v6.copy(shoulderWorld).add(otherUpperNode.getWorldPosition(this._v4)).multiplyScalar(0.5);

    const armScale = calib.armScale(side);
    const shoulderScale = calib.shoulderWidthRatio();
    // Same-side shoulder anchor is better when the wrist is still on its own
    // side of the torso; midpoint anchoring is only needed once the arm folds
    // inward toward / across the centerline. As the wrist approaches the
    // centerline we also reduce reach scaling from armScale toward torso scale,
    // otherwise long-armed avatars tend to fully extend when hands should fold
    // together near the chest.
    const perfMidX = (perfLs.x + perfRs.x) * 0.5;
    const perfMidY = (perfLs.y + perfRs.y) * 0.5;
    const perfMidZ = (perfLs.z + perfRs.z) * 0.5;
    const shoulderCenterOffset = ps.x - perfMidX;
    const wristCenterOffset = pw.x - perfMidX;
    let midpointBlend = 0;
    if (Math.abs(shoulderCenterOffset) > 1e-4) {
      if (shoulderCenterOffset * wristCenterOffset <= 0) {
        midpointBlend = 1;
      } else {
        const centerRatio = Math.abs(wristCenterOffset) / Math.abs(shoulderCenterOffset);
        midpointBlend = THREE.MathUtils.clamp((0.35 - centerRatio) / 0.35, 0, 1);
      }
    }

    const foldReachScale = THREE.MathUtils.lerp(armScale, shoulderScale, midpointBlend);

    // Performer wrist offset from shoulder midpoint → VRM world.
    this._mpDeltaToVrm(pw.x - perfMidX, pw.y - perfMidY, pw.z - perfMidZ, this._v1);
    this._v1.x *= shoulderScale;
    this._v1.y *= foldReachScale;
    this._v1.z *= foldReachScale * this._armZAttenuation;
    const midpointTarget = this._v4.copy(midAvatarShoulder).add(this._v1);

    this._mpDeltaToVrm(pw.x - ps.x, pw.y - ps.y, pw.z - ps.z, this._v2);
    this._v2.multiplyScalar(foldReachScale);
    this._v2.z *= this._armZAttenuation;
    const target = this._v3.copy(shoulderWorld).add(this._v2);
    target.lerp(midpointTarget, midpointBlend);

    // Symmetric folded-hands poses (prayer / palms together) often come in
    // with slightly asymmetric wrist X values, so one arm gets recognized as
    // "folded" while the other still aims close to full reach. If both wrists
    // are already close to each other relative to shoulder width, pull both
    // targets toward the shared wrist midpoint so the hands can meet.
    const hasLeftHandDetected = frame.hands.some((hand) => hand.side === 'Left');
    const hasRightHandDetected = frame.hands.some((hand) => hand.side === 'Right');
    const hasBothHandsDetected = hasLeftHandDetected && hasRightHandDetected;
    const otherWrist = lms[side === 'left' ? 15 : 16];
    if (hasBothHandsDetected && otherWrist && this._visible(otherWrist)) {
      const shoulderDx = perfRs.x - perfLs.x;
      const shoulderDy = perfRs.y - perfLs.y;
      const shoulderDz = perfRs.z - perfLs.z;
      const shoulderSpan = Math.hypot(shoulderDx, shoulderDy, shoulderDz);

      const wristDx = pw.x - otherWrist.x;
      const wristDy = pw.y - otherWrist.y;
      const wristDz = pw.z - otherWrist.z;
      const wristGap = Math.hypot(wristDx, wristDy, wristDz);

      if (shoulderSpan > 1e-4) {
        const gapRatio = wristGap / shoulderSpan;
        const wristLevelRatio = Math.abs(pw.y - otherWrist.y) / shoulderSpan;
        const handsTogetherBlend = wristLevelRatio <= 0.25
          ? THREE.MathUtils.clamp((0.55 - gapRatio) / 0.30, 0, 1)
          : 0;
        if (handsTogetherBlend > 1e-4) {
          const wristMidX = (pw.x + otherWrist.x) * 0.5;
          const wristMidY = (pw.y + otherWrist.y) * 0.5;
          const wristMidZ = (pw.z + otherWrist.z) * 0.5;
          const centerReachScale = THREE.MathUtils.lerp(foldReachScale, shoulderScale, handsTogetherBlend);
          this._mpDeltaToVrm(wristMidX - perfMidX, wristMidY - perfMidY, wristMidZ - perfMidZ, this._v1);
          this._v1.x *= shoulderScale;
          this._v1.y *= centerReachScale;
          this._v1.z *= centerReachScale * this._armZAttenuation;
          this._v2.copy(midAvatarShoulder).add(this._v1);
          target.lerp(this._v2, handsTogetherBlend);

          // Do not collapse both wrists to the exact same point: palms can meet
          // while the wrist joints stay slightly apart. Keep a small symmetric
          // gap along the avatar shoulder axis to avoid self-intersection.
          this._v4.copy(shoulderWorld).sub(midAvatarShoulder);
          if (this._v4.lengthSq() > 1e-6) this._v4.normalize();
          else this._v4.set(side === 'left' ? -1 : 1, 0, 0);
          const desiredWristGap = THREE.MathUtils.clamp(
            wristGap * centerReachScale,
            calib.avatarShoulderWidth * 0.12,
            calib.avatarShoulderWidth * 0.22,
          );
          target.addScaledVector(this._v4, desiredWristGap * 0.5 * handsTogetherBlend);
        }
      }
    }

    this.debugTargets[side === 'left' ? 'leftWristTarget' : 'rightWristTarget'].copy(target);
    this.debugTargets.hasArm = true;

    // Pole vector: keep the wrist target midpoint-based, but drive the elbow
    // bend from the performer's same-side shoulder→elbow direction. This is a
    // much stabler bend hint than a midpoint-anchored elbow point when the hand
    // is close to the chest and the wrist target lies almost on the shoulder→hand
    // line.
    this._mpDeltaToVrm(pe.x - ps.x, pe.y - ps.y, pe.z - ps.z, this._v2);
    this._v2.multiplyScalar(foldReachScale);
    this._v2.z *= this._armPoleZ;
    const elbowTarget = this._v6.copy(shoulderWorld).add(this._v2);
    this.debugTargets[side === 'left' ? 'leftElbowTarget' : 'rightElbowTarget'].copy(elbowTarget);

    this._mpDirToVrm(pe.x - ps.x, pe.y - ps.y, pe.z - ps.z, this._v2);
    this._v2.z *= this._armPoleZ;
    if (this._v2.lengthSq() < 1e-6) this._v2.set(0, -1, 0);
    this.debugTargets[side === 'left' ? 'leftArmPoleRaw' : 'rightArmPoleRaw'].copy(this._v2);
    const smoothed = this._polesArm[side];
    if (smoothed.lengthSq() < 1e-6) smoothed.copy(this._v2);
    else smoothed.lerp(this._v2, this._poleAlpha);
    this.debugTargets[side === 'left' ? 'leftArmPoleSmoothed' : 'rightArmPoleSmoothed'].copy(smoothed);

    // Solve the chain in world space.
    const upperLen = calib.upperArmLength(side);
    const lowerLen = calib.lowerArmLength(side);
    const ik = solveTwoBoneIK(shoulderWorld, target, smoothed, upperLen, lowerLen, this._ikResult);

    // --- upper bone: world direction → upperArm parent-local rotation
    upperNode.parent.getWorldQuaternion(this._q1).invert();
    this._v3.copy(ik.upperDir).applyQuaternion(this._q1);   // into parent local
    this._q2.setFromUnitVectors(upperRest, this._v3);
    if (this._bodyLerp >= 1) upperNode.quaternion.copy(this._q2);
    else                     upperNode.quaternion.slerp(this._q2, this._bodyLerp);
    upperNode.updateWorldMatrix(false, true);

    // --- lower bone: world direction → lowerArm parent-local (parent = upperArm)
    upperNode.getWorldQuaternion(this._q1).invert();
    this._v3.copy(ik.lowerDir).applyQuaternion(this._q1);
    this._q2.setFromUnitVectors(lowerRest, this._v3);
    if (this._bodyLerp >= 1) lowerNode.quaternion.copy(this._q2);
    else                     lowerNode.quaternion.slerp(this._q2, this._bodyLerp);
    lowerNode.updateWorldMatrix(false, true);
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
    if (!ph || !pk || !pa) return;
    if (!this._visible(ph) || !this._visible(pk) || !this._visible(pa)) return;

    // Avatar same-side hip = IK root and target anchor.
    upperNode.parent!.updateWorldMatrix(true, false);
    upperNode.updateWorldMatrix(false, false);
    const hipWorld = upperNode.getWorldPosition(this._v5);

    // Performer ankle offset from same-side hip → VRM world, scaled by legScale.
    this._mpDeltaToVrm(pa.x - ph.x, pa.y - ph.y, pa.z - ph.z, this._v1);
    this._v1.multiplyScalar(calib.legScale());
    const target = this._v4.copy(hipWorld).add(this._v1);

    // ── Ground constraint ─────────────────────────────────────────────────────
    // Prevent the ankle target from going below the avatar's rest-pose ankle
    // height. MediaPipe depth noise can push landmarks below the actual floor.
    if (target.y < this._groundY) target.y = this._groundY;

    // ── Foot locking ──────────────────────────────────────────────────────────
    // When the performer stands still (velocity < lockThreshold and foot is near
    // the ground), freeze the IK target so MediaPipe jitter doesn't slide the foot.
    const prevTarget = this._prevAnkleTarget[side];
    const velocity = prevTarget.distanceTo(target);
    prevTarget.copy(target); // always track raw target for velocity, not locked pos

    if (this._footLockEnabled) {
      if (this._footLocked[side]) {
        const shouldUnlock =
          velocity > this._footVelocityUnlockThreshold ||
          target.y > this._groundY + this._footLiftThreshold;
        if (!shouldUnlock) {
          target.copy(this._footLockedPos[side]); // hold locked position
        } else {
          this._footLocked[side] = false;
        }
      }
      if (!this._footLocked[side]) {
        const nearGround = target.y <= this._groundY + this._footLiftThreshold * 0.4;
        if (velocity < this._footVelocityLockThreshold && nearGround) {
          this._footLocked[side] = true;
          this._footLockedPos[side].copy(target);
        }
      }
    }

    this.debugTargets[side === 'left' ? 'leftAnkleTarget'  : 'rightAnkleTarget'].copy(target);
    this.debugTargets[side === 'left' ? 'leftFootLocked'   : 'rightFootLocked'] = this._footLocked[side];
    this.debugTargets.hasLeg = true;

    // Pole: same-side hip→knee direction, VRM frame, smoothed.
    this._mpDeltaToVrm(pk.x - ph.x, pk.y - ph.y, pk.z - ph.z, this._v2);
    if (this._v2.lengthSq() < 1e-6) this._v2.set(0, -1, 0);
    const smoothed = this._polesLeg[side];
    if (smoothed.lengthSq() < 1e-6) smoothed.copy(this._v2);
    else smoothed.lerp(this._v2, this._poleAlpha);

    // Solve the chain.
    const upperLen = calib.upperLegLength(side);
    const lowerLen = calib.lowerLegLength(side);
    const ik = solveTwoBoneIK(hipWorld, target, smoothed, upperLen, lowerLen, this._ikResult);

    // --- upperLeg: world dir → parent-local
    upperNode.parent.getWorldQuaternion(this._q1).invert();
    this._v3.copy(ik.upperDir).applyQuaternion(this._q1);
    this._q2.setFromUnitVectors(upperRest, this._v3);
    if (this._bodyLerp >= 1) upperNode.quaternion.copy(this._q2);
    else                     upperNode.quaternion.slerp(this._q2, this._bodyLerp);
    upperNode.updateWorldMatrix(false, true);

    // --- lowerLeg: world dir → parent-local (parent = upperLeg)
    upperNode.getWorldQuaternion(this._q1).invert();
    this._v3.copy(ik.lowerDir).applyQuaternion(this._q1);
    this._q2.setFromUnitVectors(lowerRest, this._v3);
    if (this._bodyLerp >= 1) lowerNode.quaternion.copy(this._q2);
    else                     lowerNode.quaternion.slerp(this._q2, this._bodyLerp);
    lowerNode.updateWorldMatrix(false, true);
  }

  private _applyHand(landmarks: any[], side: 'Left' | 'Right'): void {
    const solvedSide: 'Left' | 'Right' = this._mirrorX
      ? (side === 'Left' ? 'Right' : 'Left')
      : side;
    const rig = KalidoHand.solve(landmarks as any, solvedSide);
    if (!rig) return;
    for (const [kalidoKey, rot] of Object.entries(rig)) {
      if (kalidoKey.endsWith('Wrist')) continue;
      const vrmName = kalidoHandBoneToVrm(kalidoKey);
      const n = this.nodeCache.get(vrmName);
      if (!n) continue;
      const r = rot as any;
      this._q1.setFromEuler(
        new THREE.Euler(r.x, r.y, r.z, (r.rotationOrder ?? 'XYZ') as THREE.EulerOrder),
      );
      if (this._handLerp >= 1) n.quaternion.copy(this._q1);
      else                     n.quaternion.slerp(this._q1, this._handLerp);
    }
  }
}
