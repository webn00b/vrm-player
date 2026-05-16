import * as THREE from 'three';
import type { CanonicalMotionClip, CanonicalJointName, Vec3Tuple, QuatTuple } from './canonicalMotion';

const _prev = new THREE.Quaternion();
const _cur = new THREE.Quaternion();

function cloneVec(v?: Vec3Tuple): Vec3Tuple | undefined {
  return v ? [v[0], v[1], v[2]] : undefined;
}

function cloneQuat(q?: QuatTuple): QuatTuple | undefined {
  return q ? [q[0], q[1], q[2], q[3]] : undefined;
}

export function cloneMotionClip(clip: CanonicalMotionClip): CanonicalMotionClip {
  return {
    ...clip,
    frames: clip.frames.map((frame) => {
      const joints: CanonicalMotionClip['frames'][number]['joints'] = {};
      for (const [name, pose] of Object.entries(frame.joints)) {
        joints[name as CanonicalJointName] = {
          position: cloneVec(pose?.position),
          rotation: cloneQuat(pose?.rotation),
          confidence: pose?.confidence,
        };
      }
      return {
        time: frame.time,
        root: frame.root
          ? {
              position: cloneVec(frame.root.position),
              rotation: cloneQuat(frame.root.rotation),
            }
          : undefined,
        joints,
        contacts: frame.contacts ? { ...frame.contacts } : undefined,
      };
    }),
  };
}

export function normalizeQuaternionContinuity(clip: CanonicalMotionClip): CanonicalMotionClip {
  const out = cloneMotionClip(clip);
  const lastByJoint = new Map<string, QuatTuple>();

  for (const frame of out.frames) {
    for (const [jointName, pose] of Object.entries(frame.joints)) {
      if (!pose?.rotation) continue;
      const last = lastByJoint.get(jointName);
      if (last) {
        _prev.fromArray(last);
        _cur.fromArray(pose.rotation);
        if (_prev.dot(_cur) < 0) {
          pose.rotation = [-pose.rotation[0], -pose.rotation[1], -pose.rotation[2], -pose.rotation[3]];
        }
      }
      lastByJoint.set(jointName, pose.rotation);
    }
  }

  return out;
}

export function normalizeRootToFirstFrame(clip: CanonicalMotionClip): CanonicalMotionClip {
  const out = cloneMotionClip(clip);
  const firstRoot = out.frames.find((f) => f.root?.position || f.joints.hips?.position);
  const origin = firstRoot?.root?.position ?? firstRoot?.joints.hips?.position;
  if (!origin) return out;

  for (const frame of out.frames) {
    const rootPos = frame.root?.position;
    if (rootPos) {
      rootPos[0] -= origin[0];
      rootPos[1] -= origin[1];
      rootPos[2] -= origin[2];
    }
  }
  return out;
}

export function cleanupCanonicalMotionClip(clip: CanonicalMotionClip): CanonicalMotionClip {
  return normalizeQuaternionContinuity(normalizeRootToFirstFrame(clip));
}

