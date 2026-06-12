import type { Landmark3D } from './poseDetector';

/**
 * MediaPipe ↔ H36M-17 joint mapping for the MotionBERT 3D lifter.
 *
 * H36M-17 order (MotionBERT convention):
 *   0 Hip(root), 1 RHip, 2 RKnee, 3 RAnkle, 4 LHip, 5 LKnee, 6 LAnkle,
 *   7 Spine, 8 Thorax, 9 Neck/Nose, 10 Head,
 *   11 LShoulder, 12 LElbow, 13 LWrist, 14 RShoulder, 15 RElbow, 16 RWrist
 *
 * Sides here are the PERSON's anatomical sides in image space — no selfie
 * mirroring. The retarget layer applies its own L↔R flip downstream; this
 * module is pure geometry.
 *
 * Input normalization follows MotionBERT's in-the-wild pipeline: the person
 * is cropped to a square bounding box and coordinates are scaled to [-1, 1]
 * within it — the model is trained on person-sized inputs, and feeding
 * whole-frame coordinates for a distant performer (person covering ~15% of
 * the frame) is far outside the training distribution. Pass a `SquareCrop`
 * (computed once per sequence, in width-units) to apply this. Without a crop
 * the legacy whole-frame normalization is used:
 *   x' = 2x − 1,  y' = (2y − 1) · (h / w).
 */

/** Square person crop in width-units (y already multiplied by aspect). */
export interface SquareCrop {
  cx: number;
  cy: number;
  /** Half the side length of the square. */
  half: number;
}

// MediaPipe pose landmark indices.
export const MP = {
  NOSE: 0,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
} as const;

export const H36M_JOINT_COUNT = 17;

/** H36M index → MediaPipe landmark index for joints that map 1:1. */
const DIRECT: Array<[number, number]> = [
  [1, MP.RIGHT_HIP], [2, MP.RIGHT_KNEE], [3, MP.RIGHT_ANKLE],
  [4, MP.LEFT_HIP], [5, MP.LEFT_KNEE], [6, MP.LEFT_ANKLE],
  [9, MP.NOSE],
  [11, MP.LEFT_SHOULDER], [12, MP.LEFT_ELBOW], [13, MP.LEFT_WRIST],
  [14, MP.RIGHT_SHOULDER], [15, MP.RIGHT_ELBOW], [16, MP.RIGHT_WRIST],
];

/**
 * MediaPipe landmark indices whose world position the lifter replaces.
 * Ears/nose head pair, hands, face and feet extras stay MediaPipe-driven.
 */
export const LIFTED_MP_INDICES: number[] = DIRECT
  .filter(([h]) => h !== 9) // nose is used as lifter input but not patched back
  .map(([, mp]) => mp);

/**
 * Convert one frame of MediaPipe NORMALIZED landmarks (image space, 0..1,
 * y down) into a flat H36M-17 (x, y, conf) array for the lifter.
 * `aspect` = videoHeight / videoWidth.
 * Returns null when the torso anchors are missing.
 */
export function mpFrameToH36m2D(
  landmarks: Landmark3D[],
  aspect: number,
  crop?: SquareCrop,
): Float32Array | null {
  const lh = landmarks[MP.LEFT_HIP], rh = landmarks[MP.RIGHT_HIP];
  const ls = landmarks[MP.LEFT_SHOULDER], rs = landmarks[MP.RIGHT_SHOULDER];
  if (!lh || !rh || !ls || !rs) return null;

  const out = new Float32Array(H36M_JOINT_COUNT * 3);
  const put = (h36m: number, x: number, y: number, conf: number): void => {
    if (crop) {
      out[h36m * 3] = (x - crop.cx) / crop.half;
      out[h36m * 3 + 1] = (y * aspect - crop.cy) / crop.half;
    } else {
      out[h36m * 3] = 2 * x - 1;
      out[h36m * 3 + 1] = (2 * y - 1) * aspect;
    }
    out[h36m * 3 + 2] = conf;
  };
  const vis = (lm: Landmark3D | undefined): number =>
    lm ? Math.max(0, Math.min(1, lm.visibility ?? 1)) : 0;

  for (const [h36m, mp] of DIRECT) {
    const lm = landmarks[mp];
    if (lm) put(h36m, lm.x, lm.y, vis(lm));
    else put(h36m, 0, 0, 0);
  }

  // Synthesized joints.
  const hipX = (lh.x + rh.x) / 2, hipY = (lh.y + rh.y) / 2;
  const thorX = (ls.x + rs.x) / 2, thorY = (ls.y + rs.y) / 2;
  const torsoConf = Math.min(vis(lh), vis(rh), vis(ls), vis(rs));
  put(0, hipX, hipY, torsoConf);                                 // Hip (root)
  put(8, thorX, thorY, Math.min(vis(ls), vis(rs)));              // Thorax
  put(7, (hipX + thorX) / 2, (hipY + thorY) / 2, torsoConf);     // Spine

  // Head: ear midpoint when available, else extrapolate past the nose.
  const le = landmarks[MP.LEFT_EAR], re = landmarks[MP.RIGHT_EAR];
  const nose = landmarks[MP.NOSE];
  if (le && re && vis(le) > 0.3 && vis(re) > 0.3) {
    put(10, (le.x + re.x) / 2, (le.y + re.y) / 2, Math.min(vis(le), vis(re)));
  } else if (nose) {
    put(10, nose.x, nose.y, vis(nose) * 0.5);
  } else {
    put(10, thorX, thorY - (hipY - thorY) * 0.3, 0.1);
  }

  return out;
}

/**
 * Patch a frame's WORLD landmarks (hip-centred, metres, MediaPipe axes) with
 * the lifter's 3D output for the limb joints. Mutates `world` in place.
 *
 * @param joints3d   17×3 lifter output for this frame (root-relative).
 * @param scale      lifter-units → metres (match the hip widths).
 * @param zSign      +1 if the lifter's z axis matches MediaPipe's, −1 to flip.
 */
export function patchWorldFromH36m(
  world: Landmark3D[],
  joints3d: Float32Array | number[],
  scale: number,
  zSign: 1 | -1 = 1,
): void {
  const rootX = joints3d[0], rootY = joints3d[1], rootZ = joints3d[2];
  for (const [h36m, mp] of DIRECT) {
    if (h36m === 9) continue; // nose: keep MediaPipe (face rig reads it)
    const lm = world[mp];
    if (!lm) continue;
    lm.x = (joints3d[h36m * 3] - rootX) * scale;
    lm.y = (joints3d[h36m * 3 + 1] - rootY) * scale;
    lm.z = (joints3d[h36m * 3 + 2] - rootZ) * scale * zSign;
  }
}

/** Lifter-space hip width (RHip↔LHip distance) of one output frame. */
export function h36mHipWidth(joints3d: Float32Array | number[]): number {
  const dx = joints3d[1 * 3] - joints3d[4 * 3];
  const dy = joints3d[1 * 3 + 1] - joints3d[4 * 3 + 1];
  const dz = joints3d[1 * 3 + 2] - joints3d[4 * 3 + 2];
  return Math.hypot(dx, dy, dz);
}
