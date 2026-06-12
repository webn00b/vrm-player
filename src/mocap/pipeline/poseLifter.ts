import type { Landmark3D, PoseFrame } from './poseDetector';
import {
  H36M_JOINT_COUNT,
  MP,
  h36mHipWidth,
  mpFrameToH36m2D,
  patchWorldFromH36m,
  type SquareCrop,
} from './h36mMapping';

/**
 * MotionBERT temporal 3D lifting for the two-pass video pipeline.
 *
 * MediaPipe estimates each frame independently, so its depth is noisy and
 * often wrong — single-image depth is ill-posed. MotionBERT lifts the 2D
 * keypoint TRAJECTORY (243-frame windows) to 3D: bone-length constancy and
 * motion dynamics across the window make depth well-posed. We keep
 * MediaPipe's 2D (it's accurate) and replace the limb joints' WORLD
 * positions with the lifter's output. Hands, face, head orientation and
 * feet extras stay MediaPipe-driven.
 *
 * The ONNX session lazy-loads on first use; when the model file is missing
 * the lifter reports unavailable and the pipeline silently continues with
 * plain MediaPipe world landmarks.
 */

export const LIFTER_MODEL_URL = '/models/motionbert_3d_243.onnx';
const WINDOW = 243;
const STRIDE = Math.floor(WINDOW / 2); // 50% overlap, linearly cross-faded

// localStorage override: 'off' disables lifting even when the model exists.
const LIFTING_STORAGE_KEY = 'vrm-player.mocap.lifting';

export function readLiftingEnabled(): boolean {
  try {
    return localStorage.getItem(LIFTING_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

interface OrtLike {
  InferenceSession: {
    create(url: string, opts?: unknown): Promise<{
      run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
      inputNames: readonly string[];
      outputNames: readonly string[];
    }>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  env: { wasm: { numThreads?: number; wasmPaths?: string | { wasm?: string; mjs?: string } } };
}

// The default 'onnxruntime-web' import resolves to the BUNDLED build (loader
// inlined), so only the .wasm binary is fetched at runtime. It is copied to
// public/ by tools/setup-lifter.mjs — vite can't serve it from node_modules.
// Point wasmPaths at the file directly; a '/ort/' PREFIX would switch ORT
// back to external-loader mode and try to import an .mjs from /public,
// which vite dev rejects with a 500.
const ORT_WASM_URL = '/ort/ort-wasm-simd-threaded.jsep.wasm';

export class MotionBertLifter {
  private _session: Awaited<ReturnType<OrtLike['InferenceSession']['create']>> | null = null;
  private _ort: OrtLike | null = null;
  private _loadFailed = false;

  /** Loads ORT + the model. False (no throw) when the model isn't deployed. */
  async init(modelUrl: string = LIFTER_MODEL_URL): Promise<boolean> {
    if (this._session) return true;
    if (this._loadFailed) return false;
    try {
      // Probe before pulling the ORT runtime: the model is an optional
      // 170 MB deployment artifact, absence is a supported configuration.
      const head = await fetch(modelUrl, { method: 'HEAD' });
      if (!head.ok) throw new Error(`model not deployed (HTTP ${head.status})`);

      const ort = (await import('onnxruntime-web')) as unknown as OrtLike;
      ort.env.wasm.wasmPaths = { wasm: ORT_WASM_URL };
      ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
      this._ort = ort;
      this._session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['webgpu', 'wasm'],
      });
      console.info('[mocap:lifter] MotionBERT session ready');
      return true;
    } catch (e) {
      this._loadFailed = true;
      console.warn(`[mocap:lifter] disabled: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  get available(): boolean { return this._session !== null; }

  /**
   * Lift a fixed-FPS frame sequence in place: every non-null frame's world
   * landmarks get their 12 limb joints replaced by temporally-lifted 3D.
   * `aspect` = videoHeight / videoWidth.
   */
  async liftSequence(frames: (PoseFrame | null)[], aspect: number): Promise<boolean> {
    if (!this._session || !this._ort) return false;
    const n = frames.length;
    if (n === 0) return false;

    // Per-frame square person crop — matches MotionBERT's training pipeline
    // (detector bbox per frame). Cancelling the global translation is fine:
    // only the root-RELATIVE output is consumed; the root trajectory comes
    // from the normalized landmarks elsewhere.
    // Build per-frame H36M 2D input. Missing frames borrow the nearest valid
    // neighbour's pose with confidence 0 — the window must be dense, and the
    // transformer downweights zero-confidence joints.
    const input2d: (Float32Array | null)[] = frames.map((f) => {
      if (!f) return null;
      const crop = computeFrameCrop(f, aspect);
      return crop ? mpFrameToH36m2D(f.landmarks, aspect, crop) : null;
    });
    let lastValid: Float32Array | null = null;
    const dense: Float32Array[] = new Array(n);
    const borrowed: boolean[] = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (input2d[i]) {
        lastValid = input2d[i]!;
        dense[i] = input2d[i]!;
      } else {
        borrowed[i] = true;
        dense[i] = new Float32Array(H36M_JOINT_COUNT * 3); // filled below
      }
    }
    if (!lastValid) return false; // no usable frame at all
    let nextValid: Float32Array | null = null;
    for (let i = n - 1; i >= 0; i--) {
      if (!borrowed[i]) { nextValid = dense[i]; continue; }
      const src = nextValid ?? lastValid;
      dense[i].set(src);
      for (let j = 2; j < dense[i].length; j += 3) dense[i][j] = 0; // conf 0
    }

    // Run overlapping windows; accumulate weighted output.
    const out = new Float32Array(n * H36M_JOINT_COUNT * 3);
    const weight = new Float32Array(n);
    const starts: number[] = [];
    for (let s = 0; s < n; s += STRIDE) {
      starts.push(Math.max(0, Math.min(s, n - WINDOW)));
      if (s + WINDOW >= n) break;
    }
    for (const start of [...new Set(starts)]) {
      const windowOut = await this._runWindow(dense, start, n);
      for (let i = 0; i < WINDOW; i++) {
        const fi = start + i;
        if (fi >= n) break;
        // Triangular weight: centre of the window dominates in overlaps.
        const w = 1 + Math.min(i, WINDOW - 1 - i);
        weight[fi] += w;
        for (let k = 0; k < H36M_JOINT_COUNT * 3; k++) {
          out[fi * H36M_JOINT_COUNT * 3 + k] += windowOut[i * H36M_JOINT_COUNT * 3 + k] * w;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (weight[i] === 0) continue;
      for (let k = 0; k < H36M_JOINT_COUNT * 3; k++) out[i * H36M_JOINT_COUNT * 3 + k] /= weight[i];
    }

    // Scale lifter units → metres by matching mean hip width against the
    // MediaPipe world landmarks over the valid frames.
    let mpHip = 0, liftHip = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const f = frames[i];
      if (!f || borrowed[i]) continue;
      const lh = f.worldLandmarks[MP.LEFT_HIP], rh = f.worldLandmarks[MP.RIGHT_HIP];
      if (!lh || !rh) continue;
      const row = out.subarray(i * H36M_JOINT_COUNT * 3, (i + 1) * H36M_JOINT_COUNT * 3);
      const lw = h36mHipWidth(row);
      if (lw < 1e-6) continue;
      mpHip += Math.hypot(lh.x - rh.x, lh.y - rh.y, lh.z - rh.z);
      liftHip += lw;
      count++;
    }
    if (count === 0 || liftHip < 1e-6) return false;
    const scale = mpHip / liftHip;

    // The lifter's z-axis orientation is a model-export convention we can't
    // assume. MediaPipe's per-frame z is noisy but its SIGN is right far more
    // often than not, so the correlation between the two depth signals over
    // the whole sequence reliably picks the lifter's sign.
    const zSign = detectZSign(frames, out, borrowed);

    for (let i = 0; i < n; i++) {
      const f = frames[i];
      if (!f || weight[i] === 0) continue;
      const row = out.subarray(i * H36M_JOINT_COUNT * 3, (i + 1) * H36M_JOINT_COUNT * 3);
      patchWorldFromH36m(f.worldLandmarks, row, scale, zSign);
      markLifted(f.worldLandmarks);
    }
    console.info(`[mocap:lifter] lifted ${n} frames (scale=${scale.toFixed(4)}, zSign=${zSign})`);

    // Diagnostic dump for tools/landmarks-vs-gt.mjs: lets headless runs
    // compare the lifted world landmarks against ground truth directly,
    // isolating lifter quality from the retarget layer.
    (window as unknown as Record<string, unknown>).__mocapLiftedDump = {
      fps: 30,
      aspect,
      frames: frames.map((f) =>
        f ? f.worldLandmarks.map((lm) => [lm.x, lm.y, lm.z]) : null,
      ),
      // Raw normalized 2D (x, y, visibility) — lets offline tooling re-run
      // the lifter with different normalization/joint-order hypotheses
      // without another browser pass.
      rawNorm: frames.map((f) =>
        f ? f.landmarks.map((lm) => [lm.x, lm.y, lm.visibility ?? 1]) : null,
      ),
    };
    return true;
  }

  private async _runWindow(
    dense: Float32Array[],
    start: number,
    n: number,
  ): Promise<Float32Array> {
    const data = new Float32Array(WINDOW * H36M_JOINT_COUNT * 3);
    for (let i = 0; i < WINDOW; i++) {
      // Past-the-end frames repeat the last real frame (clamp padding).
      const src = dense[Math.min(start + i, n - 1)];
      data.set(src, i * H36M_JOINT_COUNT * 3);
    }
    const ort = this._ort!;
    const tensor = new ort.Tensor('float32', data, [1, WINDOW, H36M_JOINT_COUNT, 3]);
    const session = this._session!;
    const result = await session.run({ [session.inputNames[0]]: tensor });
    return result[session.outputNames[0]].data;
  }
}

// Landmarks defining the person bbox (body extremes, no face/finger detail).
const CROP_MP_INDICES = [
  MP.NOSE, MP.LEFT_SHOULDER, MP.RIGHT_SHOULDER, MP.LEFT_ELBOW, MP.RIGHT_ELBOW,
  MP.LEFT_WRIST, MP.RIGHT_WRIST, MP.LEFT_HIP, MP.RIGHT_HIP,
  MP.LEFT_KNEE, MP.RIGHT_KNEE, MP.LEFT_ANKLE, MP.RIGHT_ANKLE,
] as const;

/**
 * Square bbox (width-units; y pre-multiplied by aspect) covering the
 * performer in ONE frame, padded 25% — the same person-sized crop the
 * model sees in its training pipeline.
 */
function computeFrameCrop(frame: PoseFrame, aspect: number): SquareCrop | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const idx of CROP_MP_INDICES) {
    const lm = frame.landmarks[idx];
    if (!lm || (lm.visibility ?? 1) < 0.3) continue;
    const px = lm.x, py = lm.y * aspect;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (minX > maxX || minY > maxY) return null;
  const half = (Math.max(maxX - minX, maxY - minY) / 2) * 1.25;
  if (half < 1e-4) return null;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, half };
}

const Z_PROBE_MP = [
  MP.LEFT_WRIST, MP.RIGHT_WRIST, MP.LEFT_ELBOW, MP.RIGHT_ELBOW,
  MP.LEFT_ANKLE, MP.RIGHT_ANKLE, MP.LEFT_KNEE, MP.RIGHT_KNEE,
] as const;
const Z_PROBE_H36M = [13, 16, 12, 15, 6, 3, 5, 2] as const; // same joints, H36M order

/** Correlate lifter depth with MediaPipe depth (root-relative both) → ±1. */
function detectZSign(
  frames: (PoseFrame | null)[],
  out: Float32Array,
  borrowed: boolean[],
): 1 | -1 {
  let dot = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f || borrowed[i]) continue;
    const row = out.subarray(i * H36M_JOINT_COUNT * 3, (i + 1) * H36M_JOINT_COUNT * 3);
    const rootZ = row[2];
    for (let k = 0; k < Z_PROBE_MP.length; k++) {
      const lm = f.worldLandmarks[Z_PROBE_MP[k]];
      if (!lm) continue;
      // MediaPipe world is already hip-centred, so lm.z is root-relative.
      dot += lm.z * (row[Z_PROBE_H36M[k] * 3 + 2] - rootZ);
    }
  }
  return dot >= 0 ? 1 : -1;
}

/** Lifted joints get full confidence — the lifter always outputs a value. */
function markLifted(world: Landmark3D[]): void {
  for (const idx of [
    MP.LEFT_SHOULDER, MP.RIGHT_SHOULDER, MP.LEFT_ELBOW, MP.RIGHT_ELBOW,
    MP.LEFT_WRIST, MP.RIGHT_WRIST, MP.LEFT_HIP, MP.RIGHT_HIP,
    MP.LEFT_KNEE, MP.RIGHT_KNEE, MP.LEFT_ANKLE, MP.RIGHT_ANKLE,
  ]) {
    const lm = world[idx];
    if (lm && lm.visibility !== undefined) lm.visibility = Math.max(lm.visibility, 0.9);
  }
}
