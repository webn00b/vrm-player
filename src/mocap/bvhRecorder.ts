import * as THREE from 'three';

// ── BVH joint hierarchy ───────────────────────────────────────────────────────

interface BvhJoint {
  name:    string;        // VRM humanoid bone name
  parent:  string | null;
  isRoot?: boolean;
}

export const BVH_JOINTS: BvhJoint[] = [
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

export const BVH_FRAME_RATE = FRAME_RATE;
export const BVH_FRAME_TIME = FRAME_TIME;

interface Frame {
  time:    number;
  bones:   Record<string, [number, number, number, number]>; // quat [x,y,z,w]
  hipsPos?: [number, number, number];
}

interface BvhRecorderOptions {
  getJointOffset?: (name: string) => [number, number, number] | null;
  /**
   * Inverse of the A-pose→T-pose correction quaternion for a bone. When
   * provided, each recorded quaternion `q_norm` (rawAxis-convention from the
   * applier) is **post**-multiplied: `q_bvh = q_norm × corrInv`. That places
   * T-pose at identity in the BVH file (so Blender / external players show
   * the right rest pose) **and** remains an exact algebraic inverse of the
   * loader's post-multiply by `correction`:
   *
   *   q_track = q_bvh × correction = q_norm × corrInv × correction = q_norm ✓
   *
   * Pre-multiply was tried first but it doesn't satisfy
   *   q_bvh × normalizedAxis = d
   * outside T-pose, and the resulting quaternions land in ZYX Euler
   * gimbal-zones for typical arm poses, producing ~40° round-trip drift.
   */
  getRestCorrectionInv?: (name: string) => [number, number, number, number] | null;
  /**
   * If true, every quaternion's x/z components and every position's x/z
   * components are negated before being written to the BVH. Set this when
   * sourcing the recording from a VRM 0.x avatar (`vrm.meta.metaVersion === '0'`).
   *
   * Why: `@pixiv/three-vrm-animation/createVRMAnimationClip` automatically
   * negates x/z of every loaded VRMA track when the **target** avatar is 0.x
   * (to convert from VRMA's canonical 1.0-convention to 0.x's left-handed
   * convention). Our recorder reads quaternions directly from 0.x normalized
   * bones, so without this pre-flip the loader's flip on round-trip leaves the
   * values doubly-flipped and produces ~150° drift on bones with non-trivial
   * Z rotation. Pre-flipping here normalises BVH content to 1.0-convention,
   * so the loader's flip cancels exactly.
   */
  flipForVrm0?: boolean;
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
  private readonly _flipForVrm0: boolean;

  constructor(options: BvhRecorderOptions = {}) {
    this._getJointOffset = options.getJointOffset ?? null;
    this._getRestCorrectionInv = options.getRestCorrectionInv ?? null;
    this._flipForVrm0 = options.flipForVrm0 ?? false;
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
    for (const j of BVH_JOINTS) {
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
    for (const j of BVH_JOINTS) {
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
    const joint    = BVH_JOINTS.find((j) => j.name === name)!;
    const indent   = '  '.repeat(depth);
    const children = BVH_JOINTS.filter((j) => j.parent === name);

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

    // Root position. For VRM 0.x sources, negate x and z so the on-load flip
    // performed by `@pixiv/three-vrm-animation/createVRMAnimationClip` cancels.
    const p = frame.hipsPos ?? [0, 0.9, 0];
    if (this._flipForVrm0) {
      parts.push(-p[0], p[1], -p[2]);
    } else {
      parts.push(p[0], p[1], p[2]);
    }

    for (const j of BVH_JOINTS) {
      let q = frame.bones[j.name] ?? [0, 0, 0, 1];
      // Remap rawAxis-convention q_norm to T-pose-relative q_bvh by POST-
      // multiplying by corrInv: q_bvh = q_norm × corrInv. See note in
      // BvhRecorderOptions.getRestCorrectionInv for the algebra.
      if (this._getRestCorrectionInv) {
        const ci = this._getRestCorrectionInv(j.name);
        if (ci) q = applyPostQuat(q, ci);
      }
      // VRM 0.x → 1.0-convention flip (see flipForVrm0 docstring).
      if (this._flipForVrm0) {
        q = [-q[0], q[1], -q[2], q[3]];
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

/** Returns q × corrInv (post-multiply) as a plain array. */
function applyPostQuat(
  q: [number, number, number, number],
  corrInv: [number, number, number, number],
): [number, number, number, number] {
  _q.set(q[0], q[1], q[2], q[3]);
  _qi.set(corrInv[0], corrInv[1], corrInv[2], corrInv[3]);
  _q.multiply(_qi); // _q = q * corrInv
  return [_q.x, _q.y, _q.z, _q.w];
}

// ── Download ──────────────────────────────────────────────────────────────────

export function downloadBvh(text: string, filename = 'mocap.bvh'): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
