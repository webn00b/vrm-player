/**
 * Anatomical-constraint depth recovery for the wrist (and analogously the
 * ankle) when MediaPipe's per-landmark Z is unreliable — primarily under
 * foreshortening, when the limb points along the camera axis.
 *
 * The setup:
 *   - shoulder 3D position is trusted (large, well-detected landmark, both
 *     XY and Z come from MediaPipe's hip-centric metric world frame)
 *   - wrist XY is trusted (image-plane detection is accurate)
 *   - wrist Z is the unreliable signal we want to replace
 *   - performer's anatomical arm length is observed by the calibration
 *     subsystem (shoulder-to-wrist max distance, decaying over the session)
 *
 * Math: place the wrist on a sphere of radius L (performer arm length)
 * centred at the shoulder. Project to known XY → leaves a quadratic for Z:
 *
 *       (Xw − Xs)² + (Yw − Ys)² + (Zw − Zs)² = L²
 *   ⇒   (Zw − Zs)² = L² − (Xw − Xs)² − (Yw − Ys)²
 *   ⇒   Zw = Zs ± √(L² − dx² − dy²)
 *
 * Two roots: wrist in front of or behind the shoulder along Z. We pick the
 * sign that matches MediaPipe's reported Z direction (its sign is noisy in
 * magnitude but typically right in direction).
 *
 * When the 2D distance |(dx, dy)| already meets or exceeds L the limb is NOT
 * foreshortened (no useful Z information from the sphere intersection),
 * and we leave MediaPipe's Z untouched. Sphere "saturated".
 *
 * Module is pure — passes in/out plain objects with x/y/z fields so it's
 * trivially unit-testable without importing THREE.
 */

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface RecoverWristZInput {
  shoulder:           Point3D;
  /** MediaPipe wrist worldLandmark; X & Y trusted, Z is the hint we may overwrite. */
  wrist:              Point3D;
  /** Anatomical arm length (metres). Performer-specific from MocapCalibration. */
  armLength:          number;
  /** Engage recovery only when the 2D limb shows as shorter than this fraction
   *  of the anatomical length — i.e. confidently foreshortened. Default 0.7. */
  foreshorteningGate?: number;
}

export interface RecoverWristZResult {
  /** Recovered wrist 3D position. May equal the input wrist if recovery did
   *  not engage (no foreshortening detected, or 2D length exceeds armLength). */
  wrist:    Point3D;
  /** True if the Z component was replaced. Useful for diagnostics / debug. */
  recovered: boolean;
}

const DEFAULT_FORESHORTENING_GATE = 0.7;
// Trust MediaPipe's Z sign only when its magnitude is at least this fraction
// of the recovered depth; below that the sign is effectively a coin flip.
const HINT_TRUST_RATIO = 0.35;

export function recoverWristZ(input: RecoverWristZInput): RecoverWristZResult {
  const { shoulder, wrist, armLength } = input;
  const gate = input.foreshorteningGate ?? DEFAULT_FORESHORTENING_GATE;

  if (armLength <= 1e-3) {
    return { wrist, recovered: false };
  }

  const dx = wrist.x - shoulder.x;
  const dy = wrist.y - shoulder.y;
  const dist2D = Math.hypot(dx, dy);

  // No foreshortening — MediaPipe's Z is fine.
  if (dist2D >= gate * armLength) {
    return { wrist, recovered: false };
  }

  // 2D limb projects shorter than anatomical length → solve for Z magnitude.
  const disc = armLength * armLength - dist2D * dist2D;
  if (disc <= 0) {
    // Impossible to satisfy the constraint given 2D positions (would require
    // armLength shorter than the 2D projection). Bail.
    return { wrist, recovered: false };
  }

  const dzMag = Math.sqrt(disc);
  // Disambiguate the root's sign. MediaPipe's own Z is exactly what's
  // unreliable under heavy foreshortening — when its magnitude is small its
  // sign is a coin flip, and a wrong flip throws the wrist a full arm's
  // length the wrong way (pointing-at-camera gestures collapse into the
  // torso). Anatomical prior: a limb foreshortened this much points TOWARD
  // the camera far more often than behind the back (a behind-the-back wrist
  // is rarely detected at all). Respect the hint only when its magnitude is
  // a substantial fraction of the recovered depth.
  const hintDz = wrist.z - shoulder.z;
  const sign = Math.abs(hintDz) > dzMag * HINT_TRUST_RATIO
    ? Math.sign(hintDz)
    : -1; // MediaPipe z decreases toward the camera
  const recoveredZ = shoulder.z + sign * dzMag;

  return {
    wrist: { x: wrist.x, y: wrist.y, z: recoveredZ },
    recovered: true,
  };
}
