import type { Landmark3D, PoseFrame } from './poseDetector';

/**
 * Crop planning for the detect-crop-redetect pass.
 *
 * MediaPipe Holistic resizes the input to ~256×256 internally; a performer
 * far from the camera ends up tens of pixels tall and the 2D keypoints come
 * back with errors of ~20% of body height (measured 82 px at 410 px body
 * height on AIST). The fix is a second detection pass over a square crop
 * around the person, where they fill the inference input.
 *
 * This module is the pure part: per-frame square crop rects from the rough
 * pass's landmarks — padded, gap-filled, zero-phase smoothed (crop jitter
 * would feed straight back into the keypoints), and clamped to the frame.
 */

export interface CropRect {
  /** Top-left corner in source pixels. */
  sx: number;
  sy: number;
  /** Square side length in source pixels. */
  size: number;
}

export interface CropPlanOptions {
  /** Bbox→crop padding factor. Default 1.7 — limbs the rough pass missed
   *  must still land inside the crop. */
  padFactor?: number;
  /** Smoothing half-window in frames (zero-phase box). Default 7. */
  smoothRadius?: number;
  /** Minimum crop side in px. Default 192 — below that the crop is pointless. */
  minSize?: number;
}

// Body extremes that define the person bbox (no face/finger detail needed).
const BBOX_LANDMARKS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const BBOX_VIS_GATE = 0.3;

/**
 * Plan one square crop per frame. Returns null when no frame has a usable
 * pose (caller should skip the refine pass).
 */
export function planPersonCrops(
  frames: (PoseFrame | null)[],
  videoWidth: number,
  videoHeight: number,
  options: CropPlanOptions = {},
): CropRect[] | null {
  const pad = options.padFactor ?? 1.7;
  const radius = options.smoothRadius ?? 7;
  const minSize = options.minSize ?? 192;
  const n = frames.length;
  if (n === 0 || videoWidth <= 0 || videoHeight <= 0) return null;

  // Raw per-frame bbox centres/sizes in px (null where pose missing).
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const size = new Float64Array(n);
  const valid: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const box = frameBboxPx(frames[i], videoWidth, videoHeight);
    if (!box) continue;
    cx[i] = (box.minX + box.maxX) / 2;
    cy[i] = (box.minY + box.maxY) / 2;
    size[i] = Math.max(box.maxX - box.minX, box.maxY - box.minY) * pad;
    valid[i] = true;
  }
  if (!valid.some(Boolean)) return null;

  fillGaps(cx, valid);
  fillGaps(cy, valid);
  fillGaps(size, valid);

  // Zero-phase smoothing: forward+backward box filter.
  boxSmoothInPlace(cx, radius);
  boxSmoothInPlace(cy, radius);
  boxSmoothInPlace(size, radius);

  const maxSize = Math.min(videoWidth, videoHeight);
  const crops: CropRect[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.max(minSize, Math.min(maxSize, size[i]));
    const sx = Math.max(0, Math.min(videoWidth - s, cx[i] - s / 2));
    const sy = Math.max(0, Math.min(videoHeight - s, cy[i] - s / 2));
    crops[i] = { sx, sy, size: s };
  }
  return crops;
}

function frameBboxPx(
  frame: PoseFrame | null,
  w: number,
  h: number,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (!frame) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const idx of BBOX_LANDMARKS) {
    const lm = frame.landmarks[idx];
    if (!lm || (lm.visibility ?? 1) < BBOX_VIS_GATE) continue;
    const px = lm.x * w, py = lm.y * h;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (minX > maxX || minY > maxY) return null;
  return { minX, maxX, minY, maxY };
}

/** Fill invalid entries: forward-fill from the last valid, leading gap from
 *  the first valid. Caller guarantees at least one valid entry. */
function fillGaps(values: Float64Array, valid: boolean[]): void {
  const n = values.length;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (valid[i]) last = i;
    else if (last >= 0) values[i] = values[last];
  }
  const first = valid.indexOf(true);
  for (let i = 0; i < first; i++) values[i] = values[first];
}

/** Centred moving average — symmetric window, so zero phase by construction. */
function boxSmoothInPlace(values: Float64Array, radius: number): void {
  const n = values.length;
  if (radius <= 0 || n < 3) return;
  const src = values.slice();
  for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(n - 1, i + radius); k++) {
      sum += src[k]; count++;
    }
    values[i] = sum / count;
  }
}

/**
 * Remap a PoseFrame detected on a square crop back to full-frame normalized
 * coordinates. Mutates the frame in place. World landmarks are left alone —
 * they are metric and hip-centred, independent of the crop. Normalized z is
 * scaled by the crop ratio to stay consistent with the full-frame x scale.
 */
export function remapCroppedPoseFrame(
  frame: PoseFrame,
  crop: CropRect,
  videoWidth: number,
  videoHeight: number,
): void {
  const zScale = crop.size / videoWidth;
  const remap = (lms: Landmark3D[]): void => {
    for (const lm of lms) {
      lm.x = (crop.sx + lm.x * crop.size) / videoWidth;
      lm.y = (crop.sy + lm.y * crop.size) / videoHeight;
      lm.z *= zScale;
    }
  };
  remap(frame.landmarks);
  remap(frame.faceLandmarks);
  for (const hand of frame.hands) remap(hand.landmarks);
}
