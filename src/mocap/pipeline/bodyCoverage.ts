import type { PoseFrame } from './poseDetector';

/**
 * Full-body coverage estimate for a collected frame sequence.
 *
 * Half-body footage (desk shots, talking-head with gestures) makes MediaPipe
 * HALLUCINATE the hidden legs — often with visibility well above the usual
 * gates. Any pipeline stage that trusts leg geometry (MotionBERT lifting,
 * hip-height-from-ankles, undamped torso depth) turns those fake legs into a
 * dismantled pose. This measures how much of the sequence has a credibly
 * visible lower body so the controller can pick the retarget profile.
 */

const LEFT_HIP = 23, RIGHT_HIP = 24, LEFT_ANKLE = 27, RIGHT_ANKLE = 28;
const COVERAGE_VIS_GATE = 0.6;

/** Fraction of DETECTED frames whose hips and ankles are all credibly visible. */
export function fullBodyCoverage(frames: (PoseFrame | null)[]): number {
  let detected = 0;
  let covered = 0;
  for (const f of frames) {
    if (!f) continue;
    detected++;
    const lms = f.landmarks;
    const ok = [LEFT_HIP, RIGHT_HIP, LEFT_ANKLE, RIGHT_ANKLE].every((i) => {
      const lm = lms[i];
      return !!lm && (lm.visibility ?? 0) >= COVERAGE_VIS_GATE;
    });
    if (ok) covered++;
  }
  return detected === 0 ? 0 : covered / detected;
}

/** Coverage threshold above which the trusted-geometry profile engages. */
export const FULL_BODY_COVERAGE_MIN = 0.6;
