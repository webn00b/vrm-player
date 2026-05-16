import * as THREE from 'three';

export type CanonicalJointName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'leftHand'
  | 'rightShoulder'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'leftFoot'
  | 'leftToes'
  | 'rightUpperLeg'
  | 'rightLowerLeg'
  | 'rightFoot'
  | 'rightToes';

export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export interface CanonicalJointPose {
  position?: Vec3Tuple;
  rotation?: QuatTuple;
  confidence?: number;
}

export interface CanonicalMotionFrame {
  time: number;
  root?: {
    position?: Vec3Tuple;
    rotation?: QuatTuple;
  };
  joints: Partial<Record<CanonicalJointName, CanonicalJointPose>>;
  contacts?: {
    leftFoot?: boolean;
    rightFoot?: boolean;
  };
}

export interface CanonicalMotionClip {
  version: 1;
  name: string;
  fps: number;
  source?: 'canonical' | 'wham' | 'gvhmr' | 'smpl' | 'unknown';
  coordinateSpace?: 'vrm' | 'smpl' | 'camera' | 'unknown';
  frames: CanonicalMotionFrame[];
}

const SMPL_24_TO_CANONICAL: Array<CanonicalJointName | null> = [
  'hips',
  'leftUpperLeg',
  'rightUpperLeg',
  'spine',
  'leftLowerLeg',
  'rightLowerLeg',
  'chest',
  'leftFoot',
  'rightFoot',
  'upperChest',
  'leftToes',
  'rightToes',
  'neck',
  'leftShoulder',
  'rightShoulder',
  'head',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
  'leftHand',
  'rightHand',
];

const JOINT_ALIASES: Record<string, CanonicalJointName> = {
  pelvis: 'hips',
  root: 'hips',
  hip: 'hips',
  hips: 'hips',
  spine: 'spine',
  spine1: 'spine',
  spine2: 'chest',
  spine3: 'upperChest',
  chest: 'chest',
  upperchest: 'upperChest',
  thorax: 'upperChest',
  neck: 'neck',
  head: 'head',
  lhip: 'leftUpperLeg',
  lefthip: 'leftUpperLeg',
  leftupperleg: 'leftUpperLeg',
  lknee: 'leftLowerLeg',
  leftknee: 'leftLowerLeg',
  leftlowerleg: 'leftLowerLeg',
  lankle: 'leftFoot',
  leftankle: 'leftFoot',
  leftfoot: 'leftFoot',
  lfoot: 'leftFoot',
  ltoe: 'leftToes',
  lefttoe: 'leftToes',
  lefttoes: 'leftToes',
  rhip: 'rightUpperLeg',
  righthip: 'rightUpperLeg',
  rightupperleg: 'rightUpperLeg',
  rknee: 'rightLowerLeg',
  rightknee: 'rightLowerLeg',
  rightlowerleg: 'rightLowerLeg',
  rankle: 'rightFoot',
  rightankle: 'rightFoot',
  rightfoot: 'rightFoot',
  rfoot: 'rightFoot',
  rtoe: 'rightToes',
  righttoe: 'rightToes',
  righttoes: 'rightToes',
  lcollar: 'leftShoulder',
  leftcollar: 'leftShoulder',
  leftshoulder: 'leftUpperArm',
  lshoulder: 'leftUpperArm',
  leftupperarm: 'leftUpperArm',
  lelbow: 'leftLowerArm',
  leftelbow: 'leftLowerArm',
  leftlowerarm: 'leftLowerArm',
  lwrist: 'leftHand',
  leftwrist: 'leftHand',
  lefthand: 'leftHand',
  lhand: 'leftHand',
  rcollar: 'rightShoulder',
  rightcollar: 'rightShoulder',
  rightshoulder: 'rightUpperArm',
  rshoulder: 'rightUpperArm',
  rightupperarm: 'rightUpperArm',
  relbow: 'rightLowerArm',
  rightelbow: 'rightLowerArm',
  rightlowerarm: 'rightLowerArm',
  rwrist: 'rightHand',
  rightwrist: 'rightHand',
  righthand: 'rightHand',
  rhand: 'rightHand',
};

function normalizeJointName(name: unknown): CanonicalJointName | null {
  if (typeof name !== 'string') return null;
  const key = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return JOINT_ALIASES[key] ?? null;
}

function isVec3(v: unknown): v is Vec3Tuple {
  return Array.isArray(v) &&
    v.length >= 3 &&
    v.slice(0, 3).every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isQuat(v: unknown): v is QuatTuple {
  return Array.isArray(v) &&
    v.length >= 4 &&
    v.slice(0, 4).every((n) => typeof n === 'number' && Number.isFinite(n));
}

function asVec3(v: unknown): Vec3Tuple | undefined {
  return isVec3(v) ? [v[0], v[1], v[2]] : undefined;
}

function asQuat(v: unknown): QuatTuple | undefined {
  if (!isQuat(v)) return undefined;
  const q = new THREE.Quaternion(v[0], v[1], v[2], v[3]).normalize();
  return [q.x, q.y, q.z, q.w];
}

function inferFps(raw: Record<string, unknown>): number {
  const fps = raw.fps ?? raw.frame_rate ?? raw.frameRate;
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : 30;
}

function inferName(raw: Record<string, unknown>, fallbackName: string): string {
  return typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName;
}

function inferSource(raw: Record<string, unknown>): CanonicalMotionClip['source'] {
  const s = `${raw.source ?? raw.model ?? raw.generator ?? ''}`.toLowerCase();
  if (s.includes('wham')) return 'wham';
  if (s.includes('gvhmr') || s.includes('hmr4d')) return 'gvhmr';
  if (s.includes('smpl')) return 'smpl';
  return 'unknown';
}

function normalizeCanonicalFrames(rawFrames: unknown, fps: number): CanonicalMotionFrame[] | null {
  if (!Array.isArray(rawFrames)) return null;
  const frames: CanonicalMotionFrame[] = [];

  rawFrames.forEach((frameLike, frameIndex) => {
    if (!frameLike || typeof frameLike !== 'object') return;
    const frame = frameLike as Record<string, unknown>;
    const rawJoints = frame.joints;
    if (!rawJoints || typeof rawJoints !== 'object' || Array.isArray(rawJoints)) return;

    const joints: CanonicalMotionFrame['joints'] = {};
    for (const [rawName, rawPose] of Object.entries(rawJoints as Record<string, unknown>)) {
      const name = normalizeJointName(rawName);
      if (!name || !rawPose || typeof rawPose !== 'object') continue;
      const pose = rawPose as Record<string, unknown>;
      const position = asVec3(pose.position ?? pose.pos ?? pose.p);
      const rotation = asQuat(pose.rotation ?? pose.quaternion ?? pose.rot ?? pose.q);
      const confidence = typeof pose.confidence === 'number' ? pose.confidence : undefined;
      if (position || rotation) joints[name] = { position, rotation, confidence };
    }

    if (Object.keys(joints).length === 0) return;
    const rootLike = frame.root && typeof frame.root === 'object'
      ? frame.root as Record<string, unknown>
      : null;
    const time = typeof frame.time === 'number' && Number.isFinite(frame.time)
      ? frame.time
      : frameIndex / fps;
    frames.push({
      time,
      root: rootLike
        ? {
            position: asVec3(rootLike.position ?? rootLike.pos ?? rootLike.p),
            rotation: asQuat(rootLike.rotation ?? rootLike.quaternion ?? rootLike.rot ?? rootLike.q),
          }
        : undefined,
      joints,
      contacts: frame.contacts && typeof frame.contacts === 'object'
        ? frame.contacts as CanonicalMotionFrame['contacts']
        : undefined,
    });
  });

  return frames.length > 0 ? frames : null;
}

function normalizeDenseJointFrames(
  raw: Record<string, unknown>,
  fps: number,
): CanonicalMotionFrame[] | null {
  const frames = raw.joints3d ?? raw.joints_3d ?? raw.smpl_joints ?? raw.keypoints3d ?? raw.keypoints_3d;
  if (!Array.isArray(frames)) return null;

  const namesRaw = raw.jointNames ?? raw.joint_names ?? raw.joints_name;
  const jointNames = Array.isArray(namesRaw) ? namesRaw : null;
  const canonicalByIndex = jointNames
    ? jointNames.map((name) => normalizeJointName(name))
    : SMPL_24_TO_CANONICAL;

  const out: CanonicalMotionFrame[] = [];
  frames.forEach((jointRows, frameIndex) => {
    if (!Array.isArray(jointRows)) return;
    const joints: CanonicalMotionFrame['joints'] = {};
    jointRows.forEach((pos, jointIndex) => {
      const name = canonicalByIndex[jointIndex] ?? null;
      const position = asVec3(pos);
      if (!name || !position) return;
      joints[name] = { position };
    });
    if (Object.keys(joints).length === 0) return;
    out.push({
      time: frameIndex / fps,
      root: { position: joints.hips?.position },
      joints,
    });
  });

  return out.length > 0 ? out : null;
}

export function parseCanonicalMotionJson(
  text: string,
  fallbackName = 'offline-motion',
): CanonicalMotionClip {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') throw new Error('Motion JSON must be an object');

  const fps = inferFps(raw);
  const frames = normalizeCanonicalFrames(raw.frames, fps) ?? normalizeDenseJointFrames(raw, fps);
  if (!frames || frames.length === 0) {
    throw new Error('Motion JSON needs canonical frames[] or dense joints3d/smpl_joints data');
  }

  return {
    version: 1,
    name: inferName(raw, fallbackName),
    fps,
    source: inferSource(raw),
    coordinateSpace: raw.coordinateSpace === 'vrm' ||
      raw.coordinateSpace === 'smpl' ||
      raw.coordinateSpace === 'camera'
      ? raw.coordinateSpace
      : 'unknown',
    frames: frames.sort((a, b) => a.time - b.time),
  };
}

