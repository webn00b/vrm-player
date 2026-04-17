import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { Pose as KalidoPose, Hand as KalidoHand } from 'kalidokit';
import type { PoseFrame } from './poseDetector';

// ── Bone name mappings ────────────────────────────────────────────────────────

/** KalidoKit Pose bone name → VRM humanoid bone name */
const POSE_BONE_MAP: Record<string, string> = {
  Hips:          'hips',
  Spine:         'spine',
  RightUpperArm: 'rightUpperArm',
  RightLowerArm: 'rightLowerArm',
  RightHand:     'rightHand',
  LeftUpperArm:  'leftUpperArm',
  LeftLowerArm:  'leftLowerArm',
  LeftHand:      'leftHand',
  RightUpperLeg: 'rightUpperLeg',
  RightLowerLeg: 'rightLowerLeg',
  LeftUpperLeg:  'leftUpperLeg',
  LeftLowerLeg:  'leftLowerLeg',
};

/**
 * KalidoKit Hand key → VRM humanoid bone name.
 *
 * KalidoKit uses {Side}{Finger}{Segment}: LeftThumbProximal, RightIndexDistal …
 * VRM uses camelCase:                     leftThumbProximal, rightIndexDistal …
 *
 * Special case: KalidoKit "Proximal" maps to VRM "Metacarpal" for the thumb
 * because KalidoKit skips the metacarpal joint entirely.
 */
function kalidoHandBoneToVrm(kalidoName: string): string {
  // e.g. "LeftThumbProximal" → side="Left", rest="ThumbProximal"
  const side    = kalidoName.startsWith('Right') ? 'right' : 'left';
  const without = kalidoName.replace(/^(Left|Right)/, '');   // "ThumbProximal"

  // KalidoKit's ThumbProximal is actually the metacarpal in VRM
  const vrmSuffix = without === 'ThumbProximal'
    ? 'ThumbMetacarpal'
    : without === 'ThumbIntermediate'
    ? 'ThumbProximal'
    : without;                                                // all others match

  return side + vrmSuffix;   // "leftThumbMetacarpal", "rightIndexDistal", etc.
}

// All finger bones that should be in the node cache
const FINGER_VRM_NAMES: string[] = (() => {
  const sides   = ['left', 'right'] as const;
  const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;
  const segs    = ['Metacarpal', 'Proximal', 'Intermediate', 'Distal'] as const;
  const names: string[] = [];
  for (const s of sides)
    for (const f of fingers)
      for (const seg of segs) {
        if (f === 'Thumb' && seg === 'Intermediate') continue; // thumb has no intermediate
        names.push(`${s}${f}${seg}`);
      }
  return names;
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

const _euler  = new THREE.Euler();
const _target = new THREE.Quaternion();

function applyEuler(
  node: THREE.Object3D,
  rot: { x: number; y: number; z: number; rotationOrder?: string },
  dampener = 1,
  lerp     = 0.5,
): void {
  _euler.set(
    rot.x * dampener,
    rot.y * dampener,
    rot.z * dampener,
    (rot.rotationOrder as THREE.EulerOrder | undefined) ?? 'XYZ',
  );
  _target.setFromEuler(_euler);
  node.quaternion.slerp(_target, lerp);
}

// ── VrmPoseApplier ────────────────────────────────────────────────────────────

/**
 * Applies KalidoKit-solved body + finger pose to a VRM model's normalised bones.
 */
export class VrmPoseApplier {
  private vrm: VRM;
  private nodeCache = new Map<string, THREE.Object3D>();

  // Smoothing / dampening. Defaults are tuned for live preview (hides jitter).
  // For BVH recording call setHighQualityMode(true) to capture full amplitude
  // without the lerp tail that would otherwise make the output laggy.
  private _bodyLerp  = 0.3;
  private _handLerp  = 0.4;
  private _hipsDamp  = 0.7;
  private _spineDamp = 0.45;
  private _chestDamp = 0.25;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this._buildCache();
  }

  /**
   * Recording mode: snap bones directly to detected pose (lerp = 1) and remove
   * torso dampeners. Produces a BVH that faithfully matches the source video.
   * Turn off to return to smoothed live-preview behaviour.
   */
  setHighQualityMode(enabled: boolean): void {
    if (enabled) {
      this._bodyLerp = 1; this._handLerp = 1;
      this._hipsDamp = 1; this._spineDamp = 1; this._chestDamp = 1;
    } else {
      this._bodyLerp = 0.3; this._handLerp = 0.4;
      this._hipsDamp = 0.7; this._spineDamp = 0.45; this._chestDamp = 0.25;
    }
  }

  private _buildCache(): void {
    const humanoid = this.vrm.humanoid;
    const allNames = [
      ...Object.values(POSE_BONE_MAP),
      ...FINGER_VRM_NAMES,
      'chest', 'upperChest',
    ];
    for (const name of allNames) {
      const node = humanoid.getNormalizedBoneNode(name as any);
      if (node) this.nodeCache.set(name, node);
    }
  }

  private node(name: string): THREE.Object3D | null {
    return this.nodeCache.get(name) ?? null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Apply body + hands pose to the VRM model. */
  apply(frame: PoseFrame): void {
    this._applyBody(frame);
    for (const hand of frame.hands) {
      this._applyHand(hand.landmarks, hand.side);
    }
  }

  /** Return the current normalised-bone quaternion as [x,y,z,w]. */
  getQuaternion(vrmBoneName: string): [number, number, number, number] | null {
    const n = this.node(vrmBoneName);
    if (!n) return null;
    const q = n.quaternion;
    return [q.x, q.y, q.z, q.w];
  }

  // ── Body ────────────────────────────────────────────────────────────────────

  private _applyBody(frame: PoseFrame): void {
    const rig = KalidoPose.solve(
      frame.worldLandmarks as any,
      frame.landmarks      as any,
      { runtime: 'mediapipe', video: null, imageSize: null },
    );
    if (!rig) return;

    const hipsNode  = this.node('hips');
    const spineNode = this.node('spine');
    const chestNode = this.node('chest') ?? this.node('upperChest');

    if (hipsNode && rig.Hips.rotation)
      applyEuler(hipsNode,  rig.Hips.rotation, this._hipsDamp,  this._bodyLerp);
    if (spineNode) applyEuler(spineNode, rig.Spine as any, this._spineDamp, this._bodyLerp);
    if (chestNode) applyEuler(chestNode, rig.Spine as any, this._chestDamp, this._bodyLerp);

    // Front camera is NOT auto-mirrored → KalidoKit's "Right" = person's left.
    // Swap L/R targets.
    //
    // Arms: leftUpperArm primary axis = +X, rightUpperArm = −X (opposite).
    // A Z rotation that pulls rightArm DOWN pulls leftArm UP → must negate Y & Z.
    // Legs: both point in −Y → same rotation semantics → no negation needed.
    const mirArm = (rot: any) => ({ ...rot, y: -(rot.y ?? 0), z: -(rot.z ?? 0) });

    this._limb('leftUpperArm',  mirArm(rig.RightUpperArm));
    this._limb('leftLowerArm',  mirArm(rig.RightLowerArm));
    this._limb('rightUpperArm', mirArm(rig.LeftUpperArm));
    this._limb('rightLowerArm', mirArm(rig.LeftLowerArm));
    // Hand/wrist orientation is handled exclusively by _applyHand (KalidoHand.solve).
    // Applying body-solve wrist rotations here would move finger bones on BOTH hands
    // every frame regardless of which hand is actually detected.

    this._limb('leftUpperLeg',  rig.RightUpperLeg as any);
    this._limb('leftLowerLeg',  rig.RightLowerLeg as any);
    this._limb('rightUpperLeg', rig.LeftUpperLeg  as any);
    this._limb('rightLowerLeg', rig.LeftLowerLeg  as any);
  }

  private _limb(vrmName: string, rot: { x: number; y: number; z: number; rotationOrder?: string }): void {
    const n = this.node(vrmName);
    if (n) applyEuler(n, rot, 1, this._bodyLerp);
  }

  // ── Fingers ─────────────────────────────────────────────────────────────────

  private _applyHand(
    landmarks: Array<{ x: number; y: number; z: number }>,
    side: 'Left' | 'Right',
  ): void {
    const rig = KalidoHand.solve(landmarks as any, side);
    if (!rig) return;

    for (const [kalidoKey, rot] of Object.entries(rig)) {
      if (kalidoKey.endsWith('Wrist')) continue;
      const vrmName = kalidoHandBoneToVrm(kalidoKey);
      const n = this.node(vrmName);
      if (n) applyEuler(n, rot as any, 1, this._handLerp);
    }
  }
}
