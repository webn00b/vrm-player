import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// Bone chain used by our direction-based retargeting / IK code.
// Each entry says "this bone aims toward that child".
export const HUMANOID_DIRECTION_CHILD: Record<string, string> = {
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

export interface HumanoidRestAxisInfo {
  // Axis implied by the normalized humanoid chain itself.
  normalizedAxis: THREE.Vector3;
  // Axis derived from the avatar's visible raw skeleton, expressed in the
  // normalized bone's parent-local frame. This compensates A-pose / bind-pose
  // drift without requiring Blender-side fixes.
  rawAxis: THREE.Vector3;
  // Quaternion that converts a clip authored for rawAxis to the normalized-axis
  // convention used by createVRMAnimationClip tracks.
  correction: THREE.Quaternion;
  rawDerived: boolean;
}

const _worldA = new THREE.Vector3();
const _worldB = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _parentInv = new THREE.Quaternion();
const _trackQ = new THREE.Quaternion();

function buildTrackTargetMap(vrm: VRM): Map<string, string> {
  const map = new Map<string, string>();
  const names = Object.keys(vrm.humanoid.humanBones) as string[];
  for (const bone of names) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone as any);
    if (!node) continue;
    map.set(node.uuid, bone);
    map.set(node.name, bone);
  }
  return map;
}

function parseTrackTarget(trackName: string): string | null {
  const dot = trackName.lastIndexOf('.');
  if (dot <= 0) return null;
  return trackName.substring(0, dot);
}

export function buildHumanoidRestAxes(vrm: VRM): Map<string, HumanoidRestAxisInfo> {
  const result = new Map<string, HumanoidRestAxisInfo>();

  vrm.scene.updateMatrixWorld(true);

  for (const [bone, childBone] of Object.entries(HUMANOID_DIRECTION_CHILD)) {
    const boneNode = vrm.humanoid.getNormalizedBoneNode(bone as any);
    const childNode = vrm.humanoid.getNormalizedBoneNode(childBone as any);
    if (!boneNode || !childNode) continue;

    const normalizedAxis = childNode.position.clone();
    if (normalizedAxis.lengthSq() < 1e-6) continue;
    normalizedAxis.normalize();

    const rawAxis = normalizedAxis.clone();
    let rawDerived = false;

    const rawBone = vrm.humanoid.getRawBoneNode(bone as any);
    const rawChild = vrm.humanoid.getRawBoneNode(childBone as any);
    if (rawBone && rawChild && boneNode.parent) {
      rawBone.getWorldPosition(_worldA);
      rawChild.getWorldPosition(_worldB);
      _dir.subVectors(_worldB, _worldA);
      if (_dir.lengthSq() > 1e-6) {
        boneNode.parent.updateWorldMatrix(true, false);
        boneNode.parent.getWorldQuaternion(_parentInv).invert();
        _dir.normalize().applyQuaternion(_parentInv);
        if (_dir.lengthSq() > 1e-6) {
          rawAxis.copy(_dir).normalize();
          rawDerived = true;
        }
      }
    }

    result.set(bone, {
      normalizedAxis,
      rawAxis,
      correction: new THREE.Quaternion().setFromUnitVectors(rawAxis, normalizedAxis),
      rawDerived,
    });
  }

  return result;
}

export function applyHumanoidRestCorrectionsToClip(clip: THREE.AnimationClip, vrm: VRM): number {
  const restAxes = buildHumanoidRestAxes(vrm);
  const trackTargets = buildTrackTargetMap(vrm);
  let correctedTracks = 0;

  for (const track of clip.tracks) {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;

    const trackTarget = parseTrackTarget(track.name);
    if (!trackTarget) continue;

    const bone = trackTargets.get(trackTarget);
    if (!bone) continue;

    const info = restAxes.get(bone);
    if (!info || !info.rawDerived) continue;

    const corr = info.correction;
    const corrDot = Math.abs(corr.w);
    if (corrDot > 0.999999) continue;

    const values = track.values as Float32Array;
    for (let i = 0; i < values.length; i += 4) {
      _trackQ.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
      _trackQ.multiply(corr).normalize();
      values[i] = _trackQ.x;
      values[i + 1] = _trackQ.y;
      values[i + 2] = _trackQ.z;
      values[i + 3] = _trackQ.w;
    }

    correctedTracks++;
  }

  return correctedTracks;
}
