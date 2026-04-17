import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { Hand as KalidoHand } from 'kalidokit';
import type { PoseFrame } from './poseDetector';

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
  private nodeCache     = new Map<string, THREE.Object3D>();
  private restLocalAxis = new Map<string, THREE.Vector3>();

  private _bodyLerp = 0.3;
  private _handLerp = 0.4;
  private _mirrorX  = true;   // mirror landmarks left↔right (selfie view)

  // Scratch allocations — reused each frame to avoid GC pressure
  private _v1 = new THREE.Vector3();
  private _q1 = new THREE.Quaternion();
  private _q2 = new THREE.Quaternion();

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this._buildCache();
    this._computeRestAxes();
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

  apply(frame: PoseFrame): void {
    for (const bone of PROCESS_ORDER) {
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
    out.set(this._mirrorX ? -dx : dx, -dy, -dz);
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
