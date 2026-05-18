import {
  FilesetResolver,
  HolisticLandmarker,
  type HolisticLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { CanonicalJointName } from './canonicalMotion';

type Landmark3D = { x: number; y: number; z: number; visibility?: number };
type Vec3 = [number, number, number];

interface JointPose {
  position: Vec3;
  confidence: number;
}

interface ExtractedFrame {
  time: number;
  root: { position: Vec3 };
  joints: Partial<Record<CanonicalJointName, JointPose>>;
}

interface ExtractedView {
  file: File;
  framesRead: number;
  framesDetected: number;
  frames: ExtractedFrame[];
  mirrorX: boolean;
}

export interface BrowserMultiviewOptions {
  front: File;
  side: File;
  fps: number;
  sideOffsetFrames: number;
  frontMirrorX: boolean;
  sideMirrorX: boolean;
  sideDepthAxis: 'x' | 'z' | '-x' | '-z';
  depthScale: number;
  depthOffset: number;
  smoothingAlpha: number;
  visibility: number;
  maxFrames?: number;
  onProgress?: (message: string, done: number, total: number) => void;
}

export interface BrowserMultiviewResult {
  motion: Record<string, unknown>;
  report: Record<string, unknown>;
}

const WASM_URL = '/mediapipe/wasm';
const HOLISTIC_MODEL_URL = '/mediapipe/holistic_landmarker.task';

const LM = {
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

const CANONICAL_JOINTS: CanonicalJointName[] = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
];

function convertPoint(point: Landmark3D, mirrorX: boolean): Vec3 {
  return [mirrorX ? -point.x : point.x, -point.y, -point.z];
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
}

function confidence(point: Landmark3D | undefined): number {
  return point?.visibility ?? 1;
}

function combinedLandmarkConfidence(...points: Array<Landmark3D | undefined>): number {
  return Math.min(...points.map(confidence));
}

function visible(point: Landmark3D | undefined, threshold: number): point is Landmark3D {
  return !!point && confidence(point) >= threshold;
}

function sideIndices(mirrorX: boolean): Record<'left' | 'right', Record<string, number>> {
  return {
    left: {
      shoulder: mirrorX ? LM.RIGHT_SHOULDER : LM.LEFT_SHOULDER,
      elbow: mirrorX ? LM.RIGHT_ELBOW : LM.LEFT_ELBOW,
      wrist: mirrorX ? LM.RIGHT_WRIST : LM.LEFT_WRIST,
      hip: mirrorX ? LM.RIGHT_HIP : LM.LEFT_HIP,
      knee: mirrorX ? LM.RIGHT_KNEE : LM.LEFT_KNEE,
      ankle: mirrorX ? LM.RIGHT_ANKLE : LM.LEFT_ANKLE,
      toe: mirrorX ? LM.RIGHT_FOOT_INDEX : LM.LEFT_FOOT_INDEX,
    },
    right: {
      shoulder: mirrorX ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER,
      elbow: mirrorX ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW,
      wrist: mirrorX ? LM.LEFT_WRIST : LM.RIGHT_WRIST,
      hip: mirrorX ? LM.LEFT_HIP : LM.RIGHT_HIP,
      knee: mirrorX ? LM.LEFT_KNEE : LM.RIGHT_KNEE,
      ankle: mirrorX ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE,
      toe: mirrorX ? LM.LEFT_FOOT_INDEX : LM.RIGHT_FOOT_INDEX,
    },
  };
}

function addJoint(
  joints: Partial<Record<CanonicalJointName, JointPose>>,
  name: CanonicalJointName,
  point: Landmark3D | undefined,
  mirrorX: boolean,
  threshold: number,
): void {
  if (!visible(point, threshold)) return;
  joints[name] = { position: convertPoint(point, mirrorX), confidence: confidence(point) };
}

function buildCanonicalJoints(
  world: Landmark3D[],
  norm: Landmark3D[],
  mirrorX: boolean,
  visibility: number,
): Partial<Record<CanonicalJointName, JointPose>> {
  for (let i = 0; i < world.length; i++) {
    if (world[i] && norm[i]?.visibility !== undefined) world[i].visibility = norm[i].visibility;
  }

  const { left, right } = sideIndices(mirrorX);
  const joints: Partial<Record<CanonicalJointName, JointPose>> = {};
  const leftHip = world[left.hip];
  const rightHip = world[right.hip];
  const leftShoulder = world[left.shoulder];
  const rightShoulder = world[right.shoulder];
  if (!leftHip || !rightHip || !leftShoulder || !rightShoulder) return joints;

  const hips = midpoint(convertPoint(leftHip, mirrorX), convertPoint(rightHip, mirrorX));
  const chest = midpoint(convertPoint(leftShoulder, mirrorX), convertPoint(rightShoulder, mirrorX));
  const spine = midpoint(hips, chest);
  const torsoConfidence = combinedLandmarkConfidence(leftHip, rightHip, leftShoulder, rightShoulder);

  joints.hips = { position: hips, confidence: combinedLandmarkConfidence(leftHip, rightHip) };
  joints.spine = { position: spine, confidence: torsoConfidence };
  joints.chest = { position: chest, confidence: combinedLandmarkConfidence(leftShoulder, rightShoulder) };
  joints.upperChest = joints.chest;

  const leftEar = world[LM.LEFT_EAR];
  const rightEar = world[LM.RIGHT_EAR];
  if (leftEar && rightEar) {
    const head = midpoint(convertPoint(leftEar, mirrorX), convertPoint(rightEar, mirrorX));
    joints.neck = { position: midpoint(chest, head), confidence: combinedLandmarkConfidence(leftShoulder, rightShoulder, leftEar, rightEar) };
    joints.head = { position: head, confidence: combinedLandmarkConfidence(leftEar, rightEar) };
  }

  addJoint(joints, 'leftUpperArm', world[left.shoulder], mirrorX, visibility);
  addJoint(joints, 'leftLowerArm', world[left.elbow], mirrorX, visibility);
  addJoint(joints, 'leftHand', world[left.wrist], mirrorX, visibility);
  addJoint(joints, 'rightUpperArm', world[right.shoulder], mirrorX, visibility);
  addJoint(joints, 'rightLowerArm', world[right.elbow], mirrorX, visibility);
  addJoint(joints, 'rightHand', world[right.wrist], mirrorX, visibility);
  addJoint(joints, 'leftUpperLeg', world[left.hip], mirrorX, visibility);
  addJoint(joints, 'leftLowerLeg', world[left.knee], mirrorX, visibility);
  addJoint(joints, 'leftFoot', world[left.ankle], mirrorX, visibility);
  addJoint(joints, 'leftToes', world[left.toe], mirrorX, visibility);
  addJoint(joints, 'rightUpperLeg', world[right.hip], mirrorX, visibility);
  addJoint(joints, 'rightLowerLeg', world[right.knee], mirrorX, visibility);
  addJoint(joints, 'rightFoot', world[right.ankle], mirrorX, visibility);
  addJoint(joints, 'rightToes', world[right.toe], mirrorX, visibility);

  return joints;
}

async function createLandmarker(): Promise<HolisticLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return HolisticLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HOLISTIC_MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
  });
}

async function loadVideo(file: File): Promise<{ video: HTMLVideoElement; url: string }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.display = 'none';
  document.body.appendChild(video);
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      video.onloadedmetadata = null;
      video.onerror = null;
    };
    video.onerror = () => {
      const err = video.error;
      const detail = err
        ? `media error ${err.code}${err.message ? `: ${err.message}` : ''}`
        : 'unknown media error';
      cleanup();
      reject(new Error(`Failed to load ${file.name} (${detail}). Try an H.264/AAC .mp4; some MPEG-4 Part 2 files are not browser-decodable.`));
    };
    video.onloadedmetadata = () => {
      cleanup();
      resolve();
    };
    video.src = url;
    video.load();
  });
  return { video, url };
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, Math.min(video.duration || 0, time));
  if (Math.abs(video.currentTime - target) < 0.002 && video.readyState >= 2) return;
  await new Promise<void>((resolve) => {
    const onSeeked = (): void => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = target;
  });
}

async function extractView(
  file: File,
  fps: number,
  mirrorX: boolean,
  visibility: number,
  maxFrames: number | undefined,
  label: string,
  onProgress?: BrowserMultiviewOptions['onProgress'],
): Promise<ExtractedView> {
  const { video, url } = await loadVideo(file);
  const landmarker = await createLandmarker();
  const frameCount = Math.max(0, Math.floor((video.duration || 0) * fps));
  const limit = maxFrames ? Math.min(frameCount, maxFrames) : frameCount;
  const frames: ExtractedFrame[] = [];

  try {
    for (let i = 0; i < limit; i++) {
      const time = i / fps;
      await seekVideo(video, time);
      const result: HolisticLandmarkerResult = landmarker.detectForVideo(video, Math.round(time * 1000));
      const norm = (result.poseLandmarks[0] ?? []) as Landmark3D[];
      const world = (result.poseWorldLandmarks[0] ?? []) as Landmark3D[];
      if (world.length) {
        const joints = buildCanonicalJoints(world, norm, mirrorX, visibility);
        const hips = joints.hips;
        if (hips) frames.push({ time: frames.length / fps, root: { position: hips.position }, joints });
      }
      onProgress?.(`${label} ${i + 1}/${limit}`, i + 1, limit * 2);
    }
  } finally {
    landmarker.close();
    video.remove();
    URL.revokeObjectURL(url);
  }

  return { file, framesRead: limit, framesDetected: frames.length, frames, mirrorX };
}

function depthFromSide(position: Vec3, axis: BrowserMultiviewOptions['sideDepthAxis'], scale: number, offset: number): number {
  const sign = axis.startsWith('-') ? -1 : 1;
  const value = axis.endsWith('x') ? position[0] : position[2];
  return sign * value * scale + offset;
}

function combineConfidence(front: number, side: number): number {
  return 1 - (1 - front) * (1 - side);
}

function weightedAverage(a: number, b: number, wa: number, wb: number): number {
  const total = wa + wb;
  return total <= 1e-6 ? (a + b) * 0.5 : (a * wa + b * wb) / total;
}

function fuseJoint(
  name: CanonicalJointName,
  front: JointPose | undefined,
  side: JointPose | undefined,
  previous: Map<CanonicalJointName, Vec3>,
  opts: BrowserMultiviewOptions,
): [JointPose | undefined, 'fused' | 'frontOnly' | 'sideOnly' | 'missing'] {
  if (front && side) {
    const position: Vec3 = [
      front.position[0],
      weightedAverage(front.position[1], side.position[1], front.confidence, side.confidence),
      depthFromSide(side.position, opts.sideDepthAxis, opts.depthScale, opts.depthOffset),
    ];
    previous.set(name, position);
    return [{ position, confidence: combineConfidence(front.confidence, side.confidence) }, 'fused'];
  }
  if (front) {
    const prev = previous.get(name);
    const position: Vec3 = [front.position[0], front.position[1], prev ? prev[2] : front.position[2] * 0.25];
    previous.set(name, position);
    return [{ position, confidence: front.confidence * 0.5 }, 'frontOnly'];
  }
  if (side) {
    const prev = previous.get(name);
    const position: Vec3 = [
      prev ? prev[0] : 0,
      side.position[1],
      depthFromSide(side.position, opts.sideDepthAxis, opts.depthScale, opts.depthOffset),
    ];
    previous.set(name, position);
    return [{ position, confidence: side.confidence * 0.5 }, 'sideOnly'];
  }
  return [undefined, 'missing'];
}

function smoothPositions(frames: Array<Record<string, any>>, alpha: number): void {
  if (alpha >= 1) return;
  const t = Math.max(0.05, Math.min(1, alpha));
  const lastByJoint = new Map<string, Vec3>();
  let lastRoot: Vec3 | null = null;
  for (const frame of frames) {
    const root = frame.root?.position as Vec3 | undefined;
    if (root && lastRoot) {
      root[0] = lastRoot[0] + (root[0] - lastRoot[0]) * t;
      root[1] = lastRoot[1] + (root[1] - lastRoot[1]) * t;
      root[2] = lastRoot[2] + (root[2] - lastRoot[2]) * t;
    }
    if (root) lastRoot = [...root] as Vec3;

    for (const [jointName, joint] of Object.entries(frame.joints as Record<string, JointPose>)) {
      const pos = joint.position;
      const last = lastByJoint.get(jointName);
      if (last) {
        pos[0] = last[0] + (pos[0] - last[0]) * t;
        pos[1] = last[1] + (pos[1] - last[1]) * t;
        pos[2] = last[2] + (pos[2] - last[2]) * t;
      }
      lastByJoint.set(jointName, [...pos] as Vec3);
    }
  }
}

function addFootContacts(frames: Array<Record<string, any>>): void {
  for (const foot of ['leftFoot', 'rightFoot'] as const) {
    const ys = frames
      .map((f) => f.joints[foot]?.position?.[1])
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    if (!ys.length) continue;
    const floor = Math.min(...ys);
    for (const frame of frames) {
      const y = frame.joints[foot]?.position?.[1];
      if (typeof y !== 'number') continue;
      frame.contacts ??= {};
      frame.contacts[foot] = Math.abs(y - floor) < 0.04;
    }
  }
}

function fuseViews(front: ExtractedView, side: ExtractedView, opts: BrowserMultiviewOptions): { frames: Array<Record<string, any>>; jointStats: Record<string, unknown> } {
  const frames: Array<Record<string, any>> = [];
  const previous = new Map<CanonicalJointName, Vec3>();
  const stats = new Map<CanonicalJointName, Record<string, number>>();
  const getStats = (joint: CanonicalJointName): Record<string, number> => {
    let s = stats.get(joint);
    if (!s) {
      s = { fused: 0, frontOnly: 0, sideOnly: 0, missing: 0, confidenceSum: 0 };
      stats.set(joint, s);
    }
    return s;
  };

  for (let frontIndex = 0; frontIndex < front.frames.length; frontIndex++) {
    const sideIndex = frontIndex + opts.sideOffsetFrames;
    if (sideIndex < 0 || sideIndex >= side.frames.length) continue;
    const frontFrame = front.frames[frontIndex];
    const sideFrame = side.frames[sideIndex];
    const joints: Partial<Record<CanonicalJointName, JointPose>> = {};

    for (const jointName of CANONICAL_JOINTS) {
      const [joint, state] = fuseJoint(jointName, frontFrame.joints[jointName], sideFrame.joints[jointName], previous, opts);
      const s = getStats(jointName);
      s[state] += 1;
      if (joint) {
        s.confidenceSum += joint.confidence;
        joints[jointName] = joint;
      }
    }

    if (!joints.hips) continue;
    frames.push({ time: frames.length / opts.fps, root: { position: joints.hips.position }, joints });
  }

  smoothPositions(frames, opts.smoothingAlpha);
  addFootContacts(frames);

  const jointStats: Record<string, unknown> = {};
  for (const [joint, s] of stats.entries()) {
    const present = s.fused + s.frontOnly + s.sideOnly;
    const total = present + s.missing;
    jointStats[joint] = {
      fusedFrames: s.fused,
      frontOnlyFrames: s.frontOnly,
      sideOnlyFrames: s.sideOnly,
      missingFrames: s.missing,
      meanConfidence: present ? s.confidenceSum / present : 0,
      coverage: total ? present / total : 0,
    };
  }

  return { frames, jointStats };
}

export async function generateBrowserMultiviewMotion(opts: BrowserMultiviewOptions): Promise<BrowserMultiviewResult> {
  const front = await extractView(opts.front, opts.fps, opts.frontMirrorX, opts.visibility, opts.maxFrames, 'Front', opts.onProgress);
  const side = await extractView(opts.side, opts.fps, opts.sideMirrorX, opts.visibility, opts.maxFrames ? opts.maxFrames + Math.max(0, opts.sideOffsetFrames) : undefined, 'Side', opts.onProgress);
  const { frames, jointStats } = fuseViews(front, side, opts);
  const name = `${opts.front.name.replace(/\.[^.]+$/, '')}_${opts.side.name.replace(/\.[^.]+$/, '')}.browser-multiview`;

  const motion = {
    version: 1,
    name,
    source: 'multiview',
    fps: opts.fps,
    coordinateSpace: 'vrm',
    adapter: {
      runtime: 'browser-mediapipe',
      views: ['front', 'side'],
      inputs: { front: opts.front.name, side: opts.side.name },
      sync: { sideFrameOffset: opts.sideOffsetFrames },
      calibration: {
        mode: 'rough-orthogonal',
        sideDepthAxis: opts.sideDepthAxis,
        depthScale: opts.depthScale,
        depthOffset: opts.depthOffset,
      },
      frontMirrorX: opts.frontMirrorX,
      sideMirrorX: opts.sideMirrorX,
      visibility: opts.visibility,
    },
    frames,
  };

  const report = {
    framesRead: { front: front.framesRead, side: side.framesRead },
    framesDetected: { front: front.framesDetected, side: side.framesDetected },
    framesWritten: frames.length,
    fps: opts.fps,
    sync: { sideOffsetFrames: opts.sideOffsetFrames },
    calibration: {
      mode: 'rough-orthogonal',
      sideDepthAxis: opts.sideDepthAxis,
      depthScale: opts.depthScale,
      depthOffset: opts.depthOffset,
    },
    jointStats,
  };

  return { motion, report };
}
