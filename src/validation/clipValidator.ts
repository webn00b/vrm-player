/**
 * Offline animation-clip validator.
 *
 * Walks each QuaternionKeyframeTrack in a THREE.AnimationClip, maps its UUID
 * back to a VRM humanoid bone name (via the VRM passed in), and reports or
 * clamps keyframes that violate the rotation constraint for that bone.
 *
 * Used at BVH → VRMA retarget time so bad source data is flagged (and
 * optionally fixed) once at import rather than per-frame at playback.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  DEFAULT_BONE_CONSTRAINTS,
  mergeConstraints,
  type RotationConstraint,
} from './boneConstraints';

export interface ClipViolation {
  bone: VRMHumanBoneName;
  time: number;
  axis: 'x' | 'y' | 'z';
  value: number;       // offending Euler value in radians
  limit: number;       // violated bound
  overBy: number;      // |value − limit|
}

export interface ClipReport {
  clipName: string;
  trackCount: number;
  trackedBones: number;          // how many tracks we could map to a bone
  violationCount: number;
  worstBone: VRMHumanBoneName | null;
  worstOverBy: number;
  /** Top-N offenders by overBy, capped to MAX_REPORTED. */
  violations: ClipViolation[];
}

const MAX_REPORTED = 30;

const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();

/**
 * Build a map from normalized-bone-node UUID to VRM bone name.
 * The VRM animation clip's track names are of the form `<uuid>.quaternion`,
 * using the UUID of the normalized bone node on the target VRM.
 */
function buildUuidToBone(vrm: VRM): Map<string, VRMHumanBoneName> {
  const map = new Map<string, VRMHumanBoneName>();
  const names = Object.keys(vrm.humanoid.humanBones) as VRMHumanBoneName[];
  for (const name of names) {
    const node = vrm.humanoid.getNormalizedBoneNode(name);
    if (node) map.set(node.uuid, name);
  }
  return map;
}

/** Extract the UUID portion of a track name "<uuid>.<property>". */
function parseTrackUuid(trackName: string): string | null {
  const dot = trackName.lastIndexOf('.');
  if (dot <= 0) return null;
  return trackName.substring(0, dot);
}

interface ValidateOptions {
  clamp: boolean;
  overrides?: Partial<Record<VRMHumanBoneName, RotationConstraint>>;
}

function validateOrClamp(
  clip: THREE.AnimationClip,
  vrm: VRM,
  opts: ValidateOptions,
): ClipReport {
  const constraints = opts.overrides ? mergeConstraints(opts.overrides) : DEFAULT_BONE_CONSTRAINTS;
  const uuidToBone = buildUuidToBone(vrm);

  const report: ClipReport = {
    clipName: clip.name,
    trackCount: clip.tracks.length,
    trackedBones: 0,
    violationCount: 0,
    worstBone: null,
    worstOverBy: 0,
    violations: [],
  };

  for (const track of clip.tracks) {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;

    const uuid = parseTrackUuid(track.name);
    if (!uuid) continue;
    const bone = uuidToBone.get(uuid);
    if (!bone) continue;
    const c = constraints[bone];
    if (!c) continue;

    report.trackedBones++;

    const values = track.values as Float32Array;
    const times = track.times as Float32Array;
    const keyCount = times.length;

    for (let k = 0; k < keyCount; k++) {
      const i = k * 4;
      _quat.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
      _euler.setFromQuaternion(_quat, c.order);

      let ex = _euler.x, ey = _euler.y, ez = _euler.z;
      const [minX, minY, minZ] = c.min;
      const [maxX, maxY, maxZ] = c.max;

      const out: { axis: 'x' | 'y' | 'z'; value: number; limit: number; overBy: number } | null =
        checkAxis('x', ex, minX, maxX) ??
        checkAxis('y', ey, minY, maxY) ??
        checkAxis('z', ez, minZ, maxZ);

      if (!out) continue;

      report.violationCount++;
      if (out.overBy > report.worstOverBy) {
        report.worstOverBy = out.overBy;
        report.worstBone = bone;
      }

      if (report.violations.length < MAX_REPORTED) {
        report.violations.push({
          bone,
          time: times[k],
          axis: out.axis,
          value: out.value,
          limit: out.limit,
          overBy: out.overBy,
        });
      }

      if (opts.clamp) {
        ex = Math.min(Math.max(ex, minX), maxX);
        ey = Math.min(Math.max(ey, minY), maxY);
        ez = Math.min(Math.max(ez, minZ), maxZ);
        _euler.set(ex, ey, ez, c.order);
        _quat.setFromEuler(_euler);
        values[i]     = _quat.x;
        values[i + 1] = _quat.y;
        values[i + 2] = _quat.z;
        values[i + 3] = _quat.w;
      }
    }
  }

  return report;
}

function checkAxis(
  axis: 'x' | 'y' | 'z',
  v: number,
  lo: number,
  hi: number,
): { axis: 'x' | 'y' | 'z'; value: number; limit: number; overBy: number } | null {
  if (v < lo) return { axis, value: v, limit: lo, overBy: lo - v };
  if (v > hi) return { axis, value: v, limit: hi, overBy: v - hi };
  return null;
}

/** Report violations without modifying the clip. */
export function validateClip(
  clip: THREE.AnimationClip,
  vrm: VRM,
  overrides?: Partial<Record<VRMHumanBoneName, RotationConstraint>>,
): ClipReport {
  return validateOrClamp(clip, vrm, { clamp: false, overrides });
}

/** Clamp all keyframes in-place. Returns the pre-clamp violation report. */
export function clampClip(
  clip: THREE.AnimationClip,
  vrm: VRM,
  overrides?: Partial<Record<VRMHumanBoneName, RotationConstraint>>,
): ClipReport {
  return validateOrClamp(clip, vrm, { clamp: true, overrides });
}
