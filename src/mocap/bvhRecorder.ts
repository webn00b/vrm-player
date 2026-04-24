import * as THREE from 'three';

// ── BVH joint hierarchy ───────────────────────────────────────────────────────

interface BvhJoint {
  name:    string;        // VRM humanoid bone name
  parent:  string | null;
  isRoot?: boolean;
}

const JOINTS: BvhJoint[] = [
  // ── Spine chain ────────────────────────────────────────────────────────────
  { name: 'hips',              parent: null,              isRoot: true },
  { name: 'spine',             parent: 'hips' },
  { name: 'chest',             parent: 'spine' },
  { name: 'neck',              parent: 'chest' },
  { name: 'head',              parent: 'neck' },

  // ── Left arm ───────────────────────────────────────────────────────────────
  { name: 'leftShoulder',      parent: 'chest' },
  { name: 'leftUpperArm',      parent: 'leftShoulder' },
  { name: 'leftLowerArm',      parent: 'leftUpperArm' },
  { name: 'leftHand',          parent: 'leftLowerArm' },

  // Left fingers
  { name: 'leftThumbMetacarpal',       parent: 'leftHand' },
  { name: 'leftThumbProximal',         parent: 'leftThumbMetacarpal' },
  { name: 'leftThumbDistal',           parent: 'leftThumbProximal' },
  { name: 'leftIndexProximal',         parent: 'leftHand' },
  { name: 'leftIndexIntermediate',     parent: 'leftIndexProximal' },
  { name: 'leftIndexDistal',           parent: 'leftIndexIntermediate' },
  { name: 'leftMiddleProximal',        parent: 'leftHand' },
  { name: 'leftMiddleIntermediate',    parent: 'leftMiddleProximal' },
  { name: 'leftMiddleDistal',          parent: 'leftMiddleIntermediate' },
  { name: 'leftRingProximal',          parent: 'leftHand' },
  { name: 'leftRingIntermediate',      parent: 'leftRingProximal' },
  { name: 'leftRingDistal',            parent: 'leftRingIntermediate' },
  { name: 'leftLittleProximal',        parent: 'leftHand' },
  { name: 'leftLittleIntermediate',    parent: 'leftLittleProximal' },
  { name: 'leftLittleDistal',          parent: 'leftLittleIntermediate' },

  // ── Right arm ──────────────────────────────────────────────────────────────
  { name: 'rightShoulder',     parent: 'chest' },
  { name: 'rightUpperArm',     parent: 'rightShoulder' },
  { name: 'rightLowerArm',     parent: 'rightUpperArm' },
  { name: 'rightHand',         parent: 'rightLowerArm' },

  // Right fingers
  { name: 'rightThumbMetacarpal',      parent: 'rightHand' },
  { name: 'rightThumbProximal',        parent: 'rightThumbMetacarpal' },
  { name: 'rightThumbDistal',          parent: 'rightThumbProximal' },
  { name: 'rightIndexProximal',        parent: 'rightHand' },
  { name: 'rightIndexIntermediate',    parent: 'rightIndexProximal' },
  { name: 'rightIndexDistal',          parent: 'rightIndexIntermediate' },
  { name: 'rightMiddleProximal',       parent: 'rightHand' },
  { name: 'rightMiddleIntermediate',   parent: 'rightMiddleProximal' },
  { name: 'rightMiddleDistal',         parent: 'rightMiddleIntermediate' },
  { name: 'rightRingProximal',         parent: 'rightHand' },
  { name: 'rightRingIntermediate',     parent: 'rightRingProximal' },
  { name: 'rightRingDistal',           parent: 'rightRingIntermediate' },
  { name: 'rightLittleProximal',       parent: 'rightHand' },
  { name: 'rightLittleIntermediate',   parent: 'rightLittleProximal' },
  { name: 'rightLittleDistal',         parent: 'rightLittleIntermediate' },

  // ── Legs ───────────────────────────────────────────────────────────────────
  { name: 'leftUpperLeg',      parent: 'hips' },
  { name: 'leftLowerLeg',      parent: 'leftUpperLeg' },
  { name: 'leftFoot',          parent: 'leftLowerLeg' },
  { name: 'rightUpperLeg',     parent: 'hips' },
  { name: 'rightLowerLeg',     parent: 'rightUpperLeg' },
  { name: 'rightFoot',         parent: 'rightLowerLeg' },
];

const FRAME_RATE = 30;
const FRAME_TIME = 1 / FRAME_RATE;

interface Frame {
  time:    number;
  bones:   Record<string, [number, number, number, number]>; // quat [x,y,z,w]
  hipsPos?: [number, number, number];
}

interface BvhRecorderOptions {
  getJointOffset?: (name: string) => [number, number, number] | null;
  /**
   * Returns the inverse of the A-pose→T-pose correction quaternion for a bone.
   * When provided, each recorded quaternion q (rawAxis-convention) is remapped
   * to q_bvh = corrInv × q so that T-pose = identity in the exported file.
   * This makes the BVH compatible with external players (Blender, etc.).
   */
  getRestCorrectionInv?: (name: string) => [number, number, number, number] | null;
}

// ── BvhRecorder ───────────────────────────────────────────────────────────────

/**
 * Records normalised-bone quaternions each frame and exports a .bvh string.
 *
 * The hierarchy now includes fingers: thumb (metacarpal → proximal → distal)
 * and index/middle/ring/little (proximal → intermediate → distal).
 */
export class BvhRecorder {
  private frames:    Frame[] = [];
  private startTime  = 0;
  private _recording = false;
  private _lastFrameTime = -1;
  private readonly _getJointOffset: ((name: string) => [number, number, number] | null) | null;
  private readonly _getRestCorrectionInv: ((name: string) => [number, number, number, number] | null) | null;

  constructor(options: BvhRecorderOptions = {}) {
    this._getJointOffset = options.getJointOffset ?? null;
    this._getRestCorrectionInv = options.getRestCorrectionInv ?? null;
  }

  get recording():  boolean { return this._recording; }
  get frameCount(): number  { return this.frames.length; }

  start(): void {
    this.frames    = [];
    this.startTime = performance.now();
    this._lastFrameTime = -Infinity;
    this._recording = true;
  }

  /**
   * Snapshot current bone state. Rate-limited to FRAME_RATE so the BVH's declared
   * Frame Time matches actual playback speed regardless of RAF rate.
   */
  addFrame(
    getQuaternion: (name: string) => [number, number, number, number] | null,
    getHipsPosition?: () => [number, number, number] | null,
  ): void {
    if (!this._recording) return;
    const time = (performance.now() - this.startTime) / 1000;
    if (time - this._lastFrameTime < FRAME_TIME - 0.001) return;
    this._lastFrameTime = time;

    const bones: Record<string, [number, number, number, number]> = {};
    for (const j of JOINTS) {
      bones[j.name] = getQuaternion(j.name) ?? [0, 0, 0, 1];
    }
    this.frames.push({ time, bones, hipsPos: getHipsPosition?.() ?? undefined });
  }

  /**
   * Append one frame at a synthetic time (frames.length * FRAME_TIME), bypassing
   * the wall-clock rate limiter. Used for manual frame-by-frame capture: each
   * call adds exactly one frame regardless of how fast the user clicks.
   * Auto-starts the recording buffer if not already recording.
   */
  captureFrame(
    getQuaternion: (name: string) => [number, number, number, number] | null,
    getHipsPosition?: () => [number, number, number] | null,
  ): void {
    if (!this._recording) {
      this.frames    = [];
      this.startTime = performance.now();
      this._lastFrameTime = -Infinity;
      this._recording = true;
    }
    const time = this.frames.length * FRAME_TIME;
    const bones: Record<string, [number, number, number, number]> = {};
    for (const j of JOINTS) {
      bones[j.name] = getQuaternion(j.name) ?? [0, 0, 0, 1];
    }
    this.frames.push({ time, bones, hipsPos: getHipsPosition?.() ?? undefined });
  }

  /** Stop and return the BVH text. */
  stop(): string {
    this._recording = false;
    const text = this._generate();
    this.frames = [];
    this._lastFrameTime = -1;
    return text;
  }

  // ── BVH generation ───────────────────────────────────────────────────────────

  private _generate(): string {
    const lines: string[] = ['HIERARCHY'];
    this._writeJoint(lines, 'hips', 0);
    lines.push('', 'MOTION');
    lines.push(`Frames: ${this.frames.length}`);
    lines.push(`Frame Time: ${FRAME_TIME.toFixed(6)}`);
    for (const f of this.frames) lines.push(this._frameRow(f));
    return lines.join('\n');
  }

  private _writeJoint(lines: string[], name: string, depth: number): void {
    const joint    = JOINTS.find((j) => j.name === name)!;
    const indent   = '  '.repeat(depth);
    const children = JOINTS.filter((j) => j.parent === name);

    const tag = joint.isRoot ? 'ROOT' : 'JOINT';
    lines.push(`${indent}${tag} ${name}`);
    lines.push(`${indent}{`);
    const offset = this._getJointOffset?.(name) ?? [0, 0, 0];
    lines.push(
      `${indent}  OFFSET ${offset[0].toFixed(2)} ${offset[1].toFixed(2)} ${offset[2].toFixed(2)}`,
    );

    if (joint.isRoot) {
      lines.push(`${indent}  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation`);
    } else {
      lines.push(`${indent}  CHANNELS 3 Zrotation Yrotation Xrotation`);
    }

    if (children.length === 0) {
      // Leaf — add End Site
      lines.push(`${indent}  End Site`);
      lines.push(`${indent}  {`);
      lines.push(`${indent}    OFFSET 0.00 0.00 0.00`);
      lines.push(`${indent}  }`);
    } else {
      for (const child of children) this._writeJoint(lines, child.name, depth + 1);
    }

    lines.push(`${indent}}`);
  }

  private _frameRow(frame: Frame): string {
    const parts: number[] = [];

    // Root position
    const p = frame.hipsPos ?? [0, 0.9, 0];
    parts.push(p[0], p[1], p[2]);

    for (const j of JOINTS) {
      let q = frame.bones[j.name] ?? [0, 0, 0, 1];
      // Remap from rawAxis-convention (A-pose=identity) to T-pose-relative
      // (T-pose=identity) so external players (Blender, etc.) get correct T-pose.
      if (this._getRestCorrectionInv) {
        const ci = this._getRestCorrectionInv(j.name);
        if (ci) q = applyPreQuat(ci, q);
      }
      const [rz, ry, rx] = quatToZYX(q);
      parts.push(rz * RAD2DEG, ry * RAD2DEG, rx * RAD2DEG);
    }

    return parts.map((v) => v.toFixed(4)).join(' ');
  }
}

// ── Math helpers ──────────────────────────────────────────────────────────────

const RAD2DEG = 180 / Math.PI;
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

function quatToZYX(arr: [number, number, number, number]): [number, number, number] {
  _q.fromArray(arr);
  _e.setFromQuaternion(_q, 'ZYX');
  return [_e.z, _e.y, _e.x];
}

/** Returns corrInv × q (pre-multiply) as a plain array. */
function applyPreQuat(
  corrInv: [number, number, number, number],
  q: [number, number, number, number],
): [number, number, number, number] {
  _qi.set(corrInv[0], corrInv[1], corrInv[2], corrInv[3]);
  _q.set(q[0], q[1], q[2], q[3]);
  _qi.multiply(_q); // _qi = corrInv * q
  return [_qi.x, _qi.y, _qi.z, _qi.w];
}

// ── Download ──────────────────────────────────────────────────────────────────

export function downloadBvh(text: string, filename = 'mocap.bvh'): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
