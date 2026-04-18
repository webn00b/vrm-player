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
  leftUpperArm:  'leftLowerArm',
  leftLowerArm:  'leftHand',
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

  private _bodyLerp     = 0.3;
  private _handLerp     = 0.4;
  private _mirrorX      = true;  // mirror landmarks left↔right (selfie view)
  private _depthScale   = 0.5;   // MediaPipe Z is noisy — reduce its influence
  private _visThreshold = 0.5;   // MediaPipe visibility score below this = skip bone

  // Default hips world-rotation at load time. The VRM often ships with a
  // non-identity hips orientation (e.g. 180° around Y) to face the camera.
  // We preserve it as a baseline so that at T-pose our code produces the
  // character's natural facing direction instead of forcibly re-facing to +Z.
  private _hipsBaseWorld = new THREE.Quaternion();

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
  private _armZAttenuation = 0.33;
  // EMA alpha on pole smoothing. 1 = no smoothing (use current frame).
  private _poleAlpha = 0.35;

  constructor(vrm: VRM, calibration?: MocapCalibration) {
    this.vrm = vrm;
    this.calibration = calibration ?? null;
    this._buildCache();
    this._computeRestAxes();
    this._captureHipsBaseline();
  }

  /** Late-binding hook if calibration is constructed after the applier. */
  setCalibration(c: MocapCalibration): void { this.calibration = c; }

  private _captureHipsBaseline(): void {
    const hipsNode = this.nodeCache.get('hips');
    if (!hipsNode) return;
    // Make sure the whole VRM world matrix chain is fresh before reading
    this.vrm.scene.updateMatrixWorld(true);
    hipsNode.getWorldQuaternion(this._hipsBaseWorld);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** HQ mode: snap to target (no slerp), full amplitude — for BVH recording. */
  setHighQualityMode(enabled: boolean): void {
    this._bodyLerp = enabled ? 1 : 0.3;
    this._handLerp = enabled ? 1 : 0.4;
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
   * Convert a MediaPipe world-space DELTA vector to VRM world-space.
   *   MediaPipe: +X = person's left, +Y = down, +Z = away from camera
   *   VRM (character facing −Z): +X = character's left, +Y = up, +Z = toward viewer
   * So: flip Y and Z. _mirrorX toggles X-negation for selfie mirror view.
   */
  private _mpDeltaToVrm(dx: number, dy: number, dz: number, out: THREE.Vector3): void {
    out.set(this._mirrorX ? -dx : dx, -dy, -dz * this._depthScale);
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

    // Spine up direction (midHip → midShoulder)
    const spineDir = this._v1;
    this._mpDeltaToVrm(
      (ls.x + rs.x) / 2 - (lh.x + rh.x) / 2,
      (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2,
      (ls.z + rs.z) / 2 - (lh.z + rh.z) / 2,
      spineDir,
    );
    if (spineDir.lengthSq() < 1e-6) return;
    spineDir.normalize();

    // Hip axis: person's right hip → left hip. Mirror-flip inside _mpDeltaToVrm
    // turns this into "character's right → left" = VRM +X at rest.
    const hipAxis = this._v2;
    this._mpDeltaToVrm(rh.x - lh.x, rh.y - lh.y, rh.z - lh.z, hipAxis);
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

    if (this._bodyLerp >= 1) hipsNode.quaternion.copy(this._q1);
    else                     hipsNode.quaternion.slerp(this._q1, this._bodyLerp);
    hipsNode.updateWorldMatrix(false, true);
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
    if (!lh || !rh || !ls || !rs) return;
    if (!this._visible(lh) || !this._visible(rh) ||
        !this._visible(ls) || !this._visible(rs)) return;

    // Both hip + shoulder lines in VRM world coords
    const hipAxis      = this._v1;
    const shoulderAxis = this._v2;
    this._mpDeltaToVrm(rh.x - lh.x, rh.y - lh.y, rh.z - lh.z, hipAxis);
    this._mpDeltaToVrm(rs.x - ls.x, rs.y - ls.y, rs.z - ls.z, shoulderAxis);
    if (hipAxis.lengthSq() < 1e-6 || shoulderAxis.lengthSq() < 1e-6) return;

    // Transform both into hips local frame
    hipsNode.updateWorldMatrix(true, false);
    hipsNode.getWorldQuaternion(this._q1).invert();
    hipAxis.applyQuaternion(this._q1);
    shoulderAxis.applyQuaternion(this._q1);

    // Project onto hips-local horizontal plane (XZ) to isolate Y-axis twist
    hipAxis.y = 0; shoulderAxis.y = 0;
    if (hipAxis.lengthSq() < 1e-6 || shoulderAxis.lengthSq() < 1e-6) return;
    hipAxis.normalize();
    shoulderAxis.normalize();

    // Twist = rotation from hipAxis (projected) to shoulderAxis (projected).
    // At T-pose both project to the same direction → identity. No baseline bias.
    const fullTwist = this._q1.setFromUnitVectors(hipAxis, shoulderAxis);

    // Split evenly: halfTwist² = fullTwist for single-axis rotations.
    const count = (spineNode ? 1 : 0) + (chestNode ? 1 : 0);
    const halfTwist = this._q2.identity().slerp(fullTwist, 1 / count);

    const applyTwist = (node: THREE.Object3D): void => {
      if (this._bodyLerp >= 1) node.quaternion.copy(halfTwist);
      else                     node.quaternion.slerp(halfTwist, this._bodyLerp);
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
   * IK variant of the shoulder+elbow chain. Consumes the performer's wrist
   * landmark position (scaled by calibration armScale) as the hand target,
   * then solves the upperArm+lowerArm rotations so the avatar's hand lands
   * at the same proportion-adjusted spot. Hand/wrist rotation is left to
   * the existing angle-based _applyHand pass — we only place the endpoint.
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

    // Mirror: character's LEFT arm is driven by performer's RIGHT landmarks,
    // and the opposite shoulder is needed to anchor the target to the mid-
    // shoulder point (so wrist = midline performer → wrist = midline avatar,
    // not crossing into the opposite side of the body).
    const lms = frame.worldLandmarks;
    const sIdx   = side === 'left' ? 12 : 11;  // same-side shoulder (mirrored)
    const sIdxOp = side === 'left' ? 11 : 12;  // opposite-side shoulder
    const eIdx   = side === 'left' ? 14 : 13;
    const wIdx   = side === 'left' ? 16 : 15;
    const ps = lms[sIdx], psOp = lms[sIdxOp], pe = lms[eIdx], pw = lms[wIdx];
    if (!ps || !psOp || !pe || !pw) return;
    if (!this._visible(ps) || !this._visible(psOp)) return;
    if (!this._visible(pe) || !this._visible(pw)) return;

    // Avatar mid-shoulder world pos = midpoint of left+right upperArm origins.
    const leftUpper  = this.nodeCache.get('leftUpperArm');
    const rightUpper = this.nodeCache.get('rightUpperArm');
    if (!leftUpper || !rightUpper) return;
    leftUpper.parent?.updateWorldMatrix(true, false);
    rightUpper.parent?.updateWorldMatrix(true, false);
    const leftShoulderWorld  = leftUpper.getWorldPosition(this._v5);
    const rightShoulderWorld = rightUpper.getWorldPosition(this._v6);
    const midShoulderWorld = this._v3
      .copy(leftShoulderWorld).add(rightShoulderWorld).multiplyScalar(0.5);

    // The actual shoulder we IK from stays the same-side upperArm.
    upperNode.parent!.updateWorldMatrix(true, false);
    upperNode.updateWorldMatrix(false, false);
    const shoulderWorld = upperNode.getWorldPosition(this._v5);

    // Performer's wrist offset from their mid-shoulder, in VRM frame.
    const midPerfX = (ps.x + psOp.x) * 0.5;
    const midPerfY = (ps.y + psOp.y) * 0.5;
    const midPerfZ = (ps.z + psOp.z) * 0.5;
    this._mpDeltaToVrm(pw.x - midPerfX, pw.y - midPerfY, pw.z - midPerfZ, this._v1);

    // Per-axis scale: X (across shoulders) → shoulder-width ratio,
    // Y (vertical) & Z (depth) → arm-length ratio. Z is additionally
    // attenuated (MediaPipe depth is noisy at elbow-scale).
    const armScale = calib.armScale(side);
    const widthScale = calib.shoulderWidthRatio();
    this._v1.x *= widthScale;
    this._v1.y *= armScale;
    this._v1.z *= armScale * this._armZAttenuation;
    const target = this._v4.copy(midShoulderWorld).add(this._v1);

    // Pole vector: performer's shoulder→elbow direction, VRM frame, with the
    // same Z attenuation so a noisy elbow depth doesn't flip the pole. Then
    // EMA-smooth in world space across frames to ride through brief MP
    // mis-detections of the elbow side.
    this._mpDeltaToVrm(pe.x - ps.x, pe.y - ps.y, pe.z - ps.z, this._v2);
    this._v2.z *= this._armZAttenuation;
    if (this._v2.lengthSq() < 1e-6) this._v2.set(0, -1, 0);
    const smoothed = this._polesArm[side];
    if (smoothed.lengthSq() < 1e-6) smoothed.copy(this._v2);
    else smoothed.lerp(this._v2, this._poleAlpha);

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

    // Mirror: character's LEFT leg ← performer's right hip/knee/ankle.
    const lms = frame.worldLandmarks;
    const hIdx   = side === 'left' ? 24 : 23;  // same-side hip (mirrored)
    const hIdxOp = side === 'left' ? 23 : 24;  // opposite hip
    const kIdx   = side === 'left' ? 26 : 25;
    const aIdx   = side === 'left' ? 28 : 27;
    const ph = lms[hIdx], phOp = lms[hIdxOp], pk = lms[kIdx], pa = lms[aIdx];
    if (!ph || !phOp || !pk || !pa) return;
    if (!this._visible(ph) || !this._visible(phOp)) return;
    if (!this._visible(pk) || !this._visible(pa)) return;

    // Avatar mid-hip world pos = midpoint of left+right upperLeg origins.
    const leftUp  = this.nodeCache.get('leftUpperLeg');
    const rightUp = this.nodeCache.get('rightUpperLeg');
    if (!leftUp || !rightUp) return;
    leftUp.parent?.updateWorldMatrix(true, false);
    rightUp.parent?.updateWorldMatrix(true, false);
    const leftHipWorld  = leftUp.getWorldPosition(this._v5);
    const rightHipWorld = rightUp.getWorldPosition(this._v6);
    const midHipWorld = this._v3.copy(leftHipWorld).add(rightHipWorld).multiplyScalar(0.5);

    // Same-side hip world = upperLeg world pos.
    upperNode.parent!.updateWorldMatrix(true, false);
    upperNode.updateWorldMatrix(false, false);
    const hipWorld = upperNode.getWorldPosition(this._v5);

    // Performer ankle offset from their mid-hip, in VRM frame.
    const midPerfX = (ph.x + phOp.x) * 0.5;
    const midPerfY = (ph.y + phOp.y) * 0.5;
    const midPerfZ = (ph.z + phOp.z) * 0.5;
    this._mpDeltaToVrm(pa.x - midPerfX, pa.y - midPerfY, pa.z - midPerfZ, this._v1);

    // Uniform body scale for legs (no separate leg slider override).
    this._v1.multiplyScalar(calib.bodyScale());
    const target = this._v4.copy(midHipWorld).add(this._v1);

    // Pole: hip→knee direction, VRM frame, smoothed.
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
    const rig = KalidoHand.solve(landmarks as any, side);
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
