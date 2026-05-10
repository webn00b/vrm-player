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
  /**
   * If true, write BVH in the format SystemAnimatorOnline / XR Animator's
   * BVH file-writer produces, so the resulting file plays back correctly
   * on those third-party VRM players. Differences from our default mode:
   *   - channel order:  Yrotation Xrotation Zrotation  (vs ZYX)
   *   - euler order:    'YXZ' extracted as [y, x, z]   (vs 'ZYX' as [z, y, x])
   *   - OFFSET scale:   ×10 (decimeters)              (vs raw meters)
   *   - OFFSETs canonicalised onto a single axis per bone family:
   *       arms / hands / fingers→Distal/Intermediate → along ±X
   *       legs / chest / neck / head                 → along ±Y
   *       spine / upperLeg / shoulder                → in XY plane (z=0)
   *   - foot/toes End Site OFFSET pulls the leaf to ground level.
   *
   * Disables `getRestCorrectionInv` and `flipForVrm0` — SystemAnimator
   * doesn't apply those post-corrections so we shouldn't pre-bake them.
   */
  systemAnimatorCompat?: boolean;
  /**
   * Pre-multiply the hips quaternion by a 180° rotation around the world-Y
   * axis at write time. Useful when the target VRM player (SystemAnimator,
   * MMD-style players) has its bind-pose facing the opposite direction from
   * our VRM — without this, our identity-rotation avatar appears facing
   * AWAY from the camera in the target player.
   *
   * Only applied to the `hips` root bone (its 180° propagates to every
   * child through normal forward kinematics), and only when
   * `systemAnimatorCompat` is also true.
   */
  flipBody180Y?: boolean;
  /**
   * Roll-and-mirror transform on `rightUpperLeg`: q ↦ q · R_Y(180°)⁻¹.
   * In YXZ Euler this is (αY + 180°, −αX, −αZ) — i.e. the bone is rolled
   * 180° around its long axis (fixes "right leg points backwards" for
   * targets whose right-leg has a flipped bind) AND the X/Z animation
   * components are sign-inverted. The sign-flip is necessary because a
   * naïve pre-multiplication R · q rolls the bone but leaves the local
   * X/Z axes pointing the wrong way, so the unchanged BVH numbers play
   * back as a mirror-image of the intended motion.
   *
   * The transform flows down to rightLowerLeg / rightFoot / rightToes
   * via forward kinematics, so we only touch the root of the right-leg
   * chain. Independent toggle from `flipBody180Y` — conventions differ
   * per target rig: SA-MMD's body is one way, its right-leg chain is
   * another.
   */
  flipRightLeg180Y?: boolean;
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
  private readonly _systemAnimatorCompat: boolean;
  private readonly _flipBody180Y: boolean;
  private readonly _flipRightLeg180Y: boolean;

  constructor(options: BvhRecorderOptions = {}) {
    this._getJointOffset = options.getJointOffset ?? null;
    this._getRestCorrectionInv = options.getRestCorrectionInv ?? null;
    this._flipForVrm0 = options.flipForVrm0 ?? false;
    this._systemAnimatorCompat = options.systemAnimatorCompat ?? false;
    this._flipBody180Y = options.flipBody180Y ?? false;
    this._flipRightLeg180Y = options.flipRightLeg180Y ?? false;
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
   * Append a fully-formed `Frame` object directly, bypassing the live mocap
   * pipeline. Internal test hook — regression tests need to feed known
   * quaternions to the writer without standing up a real VRM. NOT meant for
   * runtime use; live capture goes through `addFrame` / `captureFrame`.
   * @internal
   */
  pushFrame(frame: Frame): void {
    if (!this._recording) this._recording = true;
    this.frames.push(frame);
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
    const rawOffset = this._getJointOffset?.(name) ?? [0, 0, 0];
    const offset = this._systemAnimatorCompat
      ? canonicalizeOffsetSA(name, rawOffset)
      : rawOffset;
    lines.push(
      `${indent}  OFFSET ${offset[0].toFixed(2)} ${offset[1].toFixed(2)} ${offset[2].toFixed(2)}`,
    );

    // SystemAnimator uses YXZ channel order so the loader's per-channel
    // multiply produces Q = R_Y · R_X · R_Z (matches Three.js Euler 'YXZ').
    const rotChannels = this._systemAnimatorCompat
      ? 'Yrotation Xrotation Zrotation'
      : 'Zrotation Yrotation Xrotation';
    if (joint.isRoot) {
      lines.push(`${indent}  CHANNELS 6 Xposition Yposition Zposition ${rotChannels}`);
    } else {
      lines.push(`${indent}  CHANNELS 3 ${rotChannels}`);
    }

    if (children.length === 0) {
      // Leaf — add End Site. SystemAnimator pulls foot/toes leaves down to
      // ground level via a special offset; we mirror that exactly.
      lines.push(`${indent}  End Site`);
      lines.push(`${indent}  {`);
      const leafOffset = this._systemAnimatorCompat
        ? endSiteOffsetSA(name, rawOffset)
        : [0, 0, 0];
      lines.push(`${indent}    OFFSET ${leafOffset[0].toFixed(2)} ${leafOffset[1].toFixed(2)} ${leafOffset[2].toFixed(2)}`);
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
    // SystemAnimator scales positions by ×10 (decimeters) to match its
    // canonicalized offsets — without this the avatar appears 10× too small.
    const p = frame.hipsPos ?? [0, 0.9, 0];
    const posScale = this._systemAnimatorCompat ? 10 : 1;
    if (this._flipForVrm0 && !this._systemAnimatorCompat) {
      parts.push(-p[0] * posScale, p[1] * posScale, -p[2] * posScale);
    } else {
      parts.push(p[0] * posScale, p[1] * posScale, p[2] * posScale);
    }

    for (const j of BVH_JOINTS) {
      let q = frame.bones[j.name] ?? [0, 0, 0, 1];
      if (this._systemAnimatorCompat) {
        // SA-compat skips rest-correction and VRM-0 flip — its loader
        // doesn't apply those, so we shouldn't pre-bake them.
        // Optional 180° Y flip on hips: target player's avatar may have
        // its bind-pose facing the opposite direction; pre-multiplying
        // the root by R_Y(180°) flips our content to match. Children
        // inherit via forward kinematics, no other bones need touching.
        if (this._flipBody180Y && j.isRoot) {
          q = flipQuat180Y(q);
        }
        // Right-leg root only — children inherit via FK in the receiving
        // skeleton so we don't double-flip. Uses post-multiply q·R⁻¹
        // (NOT pre-multiply): pre-mul R·q would roll the bone 180° around
        // its long axis but leave local X/Z axes "visually mirrored",
        // making the unchanged X/Z Euler animation play back reversed.
        // Post-mul yields Euler (αY+180°, −αX, −αZ) — static roll plus
        // sign-flipped animation X/Z, which compensates the mirror.
        if (this._flipRightLeg180Y && j.name === 'rightUpperLeg') {
          q = rollMirrorQuat180Y(q);
        }
        const [ry, rx, rz] = quatToYXZ(q);
        parts.push(ry * RAD2DEG, rx * RAD2DEG, rz * RAD2DEG);
      } else {
        // Default: T-pose-relative remap + optional VRM 0.x flip + ZYX Euler.
        if (this._getRestCorrectionInv) {
          const ci = this._getRestCorrectionInv(j.name);
          if (ci) q = applyPostQuat(q, ci);
        }
        if (this._flipForVrm0) {
          q = [-q[0], q[1], -q[2], q[3]];
        }
        const [rz, ry, rx] = quatToZYX(q);
        parts.push(rz * RAD2DEG, ry * RAD2DEG, rx * RAD2DEG);
      }
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

/** YXZ-extracted Euler used by SystemAnimator's BVH writer. Returns
 *  [αY, αX, αZ] so that loader's `multiply(quat_Y) × multiply(quat_X) ×
 *  multiply(quat_Z)` reconstructs the same Q. */
function quatToYXZ(arr: [number, number, number, number]): [number, number, number] {
  _q.fromArray(arr);
  _e.setFromQuaternion(_q, 'YXZ');
  return [_e.y, _e.x, _e.z];
}

/** Pre-multiply a quaternion by R_Y(180°). q_out = R_Y(180°) · q.
 *  R_Y(180°) = (0, 1, 0, 0). Hamilton product expanded for the case
 *  q1 = (0, 1, 0, 0) is cheap, no setup. */
function flipQuat180Y(
  q: [number, number, number, number],
): [number, number, number, number] {
  // (q1 · q2) for q1=(0,1,0,0), q2=(x,y,z,w):
  //   x' =  q1w*x + q1x*w + q1y*z - q1z*y = 0 + 0 + z - 0 = z
  //   y' =  q1w*y - q1x*z + q1y*w + q1z*x = 0 + 0 + w + 0 = w
  //   z' =  q1w*z + q1x*y - q1y*x + q1z*w = 0 + 0 - x + 0 = -x
  //   w' =  q1w*w - q1x*x - q1y*y - q1z*z = 0 - 0 - y - 0 = -y
  return [q[2], q[3], -q[0], -q[1]];
}

/** Post-multiply a quaternion by R_Y(180°)⁻¹ = R_Y(−180°).
 *  q_out = q · R_Y(180°)⁻¹. Decomposing q as YXZ Euler (αY, αX, αZ),
 *  q_out's Euler is (αY + 180°, −αX, −αZ): the long-axis roll fixes the
 *  static "leg backwards" mismatch, and the X/Z sign-flip compensates
 *  the visual mirror that a plain R·q pre-multiply would produce.
 *
 *  Hamilton product q · q2 with q2 = R_Y(−180°) = (0, 0, −1, 0) in
 *  (w,x,y,z) — i.e. (x2,y2,z2,w2) = (0,−1,0,0):
 *     x' =  w·x2 + x·w2 + y·z2 − z·y2 = 0 + 0 + 0 − z·(−1) = z
 *     y' =  w·y2 − x·z2 + y·w2 + z·x2 = w·(−1) − 0 + 0 + 0 = −w
 *     z' =  w·z2 + x·y2 − y·x2 + z·w2 = 0 + x·(−1) − 0 + 0 = −x
 *     w' =  w·w2 − x·x2 − y·y2 − z·z2 = 0 − 0 − y·(−1) − 0 = y
 */
function rollMirrorQuat180Y(
  q: [number, number, number, number],
): [number, number, number, number] {
  return [q[2], -q[3], -q[0], q[1]];
}

/** SystemAnimator canonicalises bone OFFSETs onto a canonical axis per bone
 *  family + scales by 10. Mirrors the per-bone-name regex branches in their
 *  BVH_filewriter.js. Inputs/outputs are in metres (we apply ×10 here). */
function canonicalizeOffsetSA(
  name: string,
  raw: [number, number, number],
): [number, number, number] {
  const SCALE = 10;
  let [x, y, z] = [raw[0] * SCALE, raw[1] * SCALE, raw[2] * SCALE];
  const len = Math.sqrt(x * x + y * y + z * z);
  if (/spine|upperLeg|shoulder/i.test(name)) {
    return [x, y, 0];
  }
  if (/arm|hand|intermediate|distal/i.test(name)) {
    // Project onto ±X with the bone's full length preserved.
    return [Math.sign(x || 1) * len, 0, 0];
  }
  if (/leg|chest|neck|head/i.test(name)) {
    return [0, Math.sign(y || 1) * len, 0];
  }
  return [x, y, z];
}

/** End Site offset for SA-compat. Foot/toes leaves get y = -bone.y * 10
 *  to bring the toe to ground level; all other leaves stay at zero. */
function endSiteOffsetSA(
  name: string,
  rawBoneOffset: [number, number, number],
): [number, number, number] {
  if (/foot|toes/i.test(name)) {
    return [0, -rawBoneOffset[1] * 10, 0];
  }
  return [0, 0, 0];
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
