import type { VRM } from '@pixiv/three-vrm';
import type { Landmark3D } from '../pipeline/poseDetector';

// ── Eye landmarks for EAR (Eye Aspect Ratio) blink detection ─────────────────
// Indices into the 478-point MediaPipe face mesh.
// Format: [outer, upper-outer, upper-inner, inner, lower-inner, lower-outer]

// Person's right eye (camera-left)
const R_EYE = [33, 160, 158, 133, 153, 144] as const;
// Person's left eye (camera-right)
const L_EYE = [362, 385, 387, 263, 373, 380] as const;

// Mouth open: inner upper/lower lips, corners
const MOUTH_TOP    = 13;
const MOUTH_BOTTOM = 14;
const MOUTH_LEFT   = 61;
const MOUTH_RIGHT  = 291;

// EAR open/close thresholds — typical values for MediaPipe face mesh.
// open ≈ 0.35, partially closed ≈ 0.22, fully closed ≈ 0.15.
const EAR_OPEN  = 0.30;
const EAR_CLOSE = 0.14;

function dist2D(a: Landmark3D, b: Landmark3D): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function earValue(lms: Landmark3D[], idx: readonly [number, number, number, number, number, number]): number {
  const p1 = lms[idx[0]], p2 = lms[idx[1]], p3 = lms[idx[2]];
  const p4 = lms[idx[3]], p5 = lms[idx[4]], p6 = lms[idx[5]];
  if (!p1 || !p4) return 0.3;
  const denom = 2 * dist2D(p1, p4);
  if (denom < 1e-6) return 0.3;
  return ((p2 && p6 ? dist2D(p2, p6) : 0) + (p3 && p5 ? dist2D(p3, p5) : 0)) / denom;
}

/**
 * Converts MediaPipe 478-point face landmarks to VRM expression values.
 * Drives: blinkLeft, blinkRight, and mouth-open (aa phoneme).
 *
 * Mirror convention matches DirectPoseApplier: person's RIGHT eye →
 * avatar's LEFT eye (selfie/mirror view).
 */
export class FaceApplier {
  private vrm: VRM;
  private _enabled = true;
  private _alpha   = 0.35; // EMA smoothing for expressions

  private _blinkL = 0; // smoothed blink value for avatar LEFT eye
  private _blinkR = 0; // smoothed blink value for avatar RIGHT eye
  private _mouth  = 0; // smoothed mouth-open value

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  get enabled(): boolean { return this._enabled; }
  setEnabled(v: boolean): void { this._enabled = v; }

  apply(faceLandmarks: Landmark3D[]): void {
    if (!this._enabled || faceLandmarks.length < 478) return;
    const em = this.vrm.expressionManager;
    if (!em) return;

    const lms = faceLandmarks;

    // ── Blink ─────────────────────────────────────────────────────────────────
    // EAR → [0..1] where 0=open, 1=closed
    const earR = earValue(lms, R_EYE);
    const earL = earValue(lms, L_EYE);
    const blinkR = 1 - Math.min(1, Math.max(0, (earR - EAR_CLOSE) / (EAR_OPEN - EAR_CLOSE)));
    const blinkL = 1 - Math.min(1, Math.max(0, (earL - EAR_CLOSE) / (EAR_OPEN - EAR_CLOSE)));

    // Person's right eye → avatar's LEFT (mirror)
    this._blinkL += (blinkR - this._blinkL) * this._alpha;
    this._blinkR += (blinkL - this._blinkR) * this._alpha;

    // ── Mouth open ───────────────────────────────────────────────────────────
    const mT = lms[MOUTH_TOP], mB = lms[MOUTH_BOTTOM];
    const mL = lms[MOUTH_LEFT], mR = lms[MOUTH_RIGHT];
    let mouth = 0;
    if (mT && mB && mL && mR) {
      const h = dist2D(mT, mB);
      const w = dist2D(mL, mR);
      // Normalize by mouth width, scale so ~0.3 ratio = fully open
      mouth = w > 1e-4 ? Math.min(1, (h / w) / 0.3) : 0;
    }
    this._mouth += (mouth - this._mouth) * this._alpha;

    // ── Apply to VRM expressions ──────────────────────────────────────────────
    em.setValue('blinkLeft',  this._blinkL);
    em.setValue('blinkRight', this._blinkR);
    // VRM 1.0 phoneme 'aa' = open mouth. Some models also export 'mouthOpen'.
    em.setValue('aa', this._mouth);
  }

  reset(): void {
    this._blinkL = 0;
    this._blinkR = 0;
    this._mouth  = 0;
    const em = this.vrm.expressionManager;
    if (!em) return;
    em.setValue('blinkLeft',  0);
    em.setValue('blinkRight', 0);
    em.setValue('aa', 0);
  }
}
