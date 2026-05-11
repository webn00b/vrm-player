/**
 * OneEuroFilter — adaptive low-pass filter for noisy signals.
 *
 * Key property: smooths hard at rest (removes detection jitter) but barely
 * filters during fast motion (preserves responsiveness). Adapts cutoff to
 * the signal's current derivative.
 *
 * Reference: Casiez, Roussel, Vogel — "1€ Filter: A Simple Speed-based Low-pass
 * Filter for Noisy Input in Interactive Systems" (CHI 2012).
 * https://cristal.univ-lille.fr/~casiez/1euro/
 */
export class OneEuroFilter {
  private _x    = 0;
  private _dx   = 0;
  private _t    = -1;
  private _init = false;

  constructor(
    private minCutoff = 1.5,   // Hz — higher = less smoothing at rest
    private beta      = 0.01,  // speed coefficient — higher = more responsive to fast moves
    private dCutoff   = 1.0,   // derivative lowpass cutoff
  ) {}

  /** @param t time in seconds */
  filter(x: number, t: number): number {
    if (!this._init) {
      this._init = true;
      this._x = x; this._dx = 0; this._t = t;
      return x;
    }
    const dt  = Math.max(1e-3, t - this._t);
    const dx  = (x - this._x) / dt;
    const aD  = OneEuroFilter._alpha(dt, this.dCutoff);
    const dxH = aD * dx + (1 - aD) * this._dx;
    const cut = this.minCutoff + this.beta * Math.abs(dxH);
    const a   = OneEuroFilter._alpha(dt, cut);
    const xH  = a * x + (1 - a) * this._x;
    this._x = xH; this._dx = dxH; this._t = t;
    return xH;
  }

  reset(): void { this._init = false; }

  private static _alpha(dt: number, cutoff: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
}

// ── Batched filter for landmark arrays ────────────────────────────────────────

/**
 * Applies a OneEuroFilter per (landmark, axis). Preserves state across calls
 * for a consistent landmark count. Use one instance per logical stream
 * (e.g. separate ones for body normalised vs world vs each hand side).
 */
export class LandmarkFilter {
  private _filters: OneEuroFilter[];

  constructor(
    count: number,
    minCutoff = 1.5,
    beta      = 0.01,
  ) {
    this._filters = [];
    for (let i = 0; i < count * 3; i++) {
      this._filters.push(new OneEuroFilter(minCutoff, beta));
    }
  }

  filter<T extends { x: number; y: number; z: number }>(lms: T[], t: number): T[] {
    const out = new Array(lms.length);
    for (let i = 0; i < lms.length; i++) {
      const lm = lms[i];
      out[i] = {
        ...lm,
        x: this._filters[i * 3    ].filter(lm.x, t),
        y: this._filters[i * 3 + 1].filter(lm.y, t),
        z: this._filters[i * 3 + 2].filter(lm.z, t),
      };
    }
    return out;
  }

  reset(): void { for (const f of this._filters) f.reset(); }
}

// ── Quaternion variant ───────────────────────────────────────────────────────

import * as THREE from 'three';

/**
 * OneEuroFilter variant for unit quaternions, smoothed via slerp rather than
 * per-component lerp (which would denormalize the quaternion). The "signal"
 * is the angular displacement from the previous filtered quaternion; the
 * speed-adaptive cutoff applies to that angular velocity.
 *
 * Sign-continuity is handled internally: if dot(prev, cur) < 0 we flip the
 * sign of `cur` before slerping, preventing the long-way-around rotation
 * that would otherwise produce a visible flick.
 *
 * Intended for the IK chain output (post-application, pre-slerp into bone)
 * — the IK solver's two-stage decomposition amplifies landmark jitter into
 * visible bone tremor, and a quaternion-level filter damps it without
 * blurring real motion (One-Euro adapts to fast moves).
 */
export class QuaternionOneEuro {
  private readonly _prev = new THREE.Quaternion();
  private readonly _prevRaw = new THREE.Quaternion();
  private _angSpeed = 0;    // |Δθ| / Δt smoothed
  private _t        = -1;
  private _init     = false;

  constructor(
    private minCutoff = 1.0,
    private beta      = 0.05,
    private dCutoff   = 1.0,
  ) {}

  /**
   * Update the filter with a new raw quaternion and timestamp.
   * Writes the filtered result into `out` (caller-owned to avoid allocation).
   */
  filter(cur: THREE.Quaternion, t: number, out: THREE.Quaternion): THREE.Quaternion {
    if (!this._init) {
      this._init = true;
      this._prev.copy(cur);
      this._prevRaw.copy(cur);
      this._t = t;
      this._angSpeed = 0;
      out.copy(cur);
      return out;
    }
    const dt = Math.max(1e-3, t - this._t);

    // Sign-flip raw input if it sits in the opposite hemisphere from previous.
    if (this._prev.dot(cur) < 0) {
      cur.set(-cur.x, -cur.y, -cur.z, -cur.w);
    }

    // Instantaneous angular speed (rad/s).
    const dot = Math.min(1, Math.max(-1, this._prev.dot(cur)));
    const angle = 2 * Math.acos(Math.abs(dot));
    const rawSpeed = angle / dt;

    // Lowpass the angular speed itself before using it to adapt the cutoff.
    const aD = QuaternionOneEuro._alpha(dt, this.dCutoff);
    this._angSpeed = aD * rawSpeed + (1 - aD) * this._angSpeed;

    const cutoff = this.minCutoff + this.beta * this._angSpeed;
    const a = QuaternionOneEuro._alpha(dt, cutoff);

    // Slerp prev → cur by alpha (low alpha = heavy smoothing).
    out.copy(this._prev).slerp(cur, a);
    this._prev.copy(out);
    this._prevRaw.copy(cur);
    this._t = t;
    return out;
  }

  reset(): void { this._init = false; this._angSpeed = 0; }

  private static _alpha(dt: number, cutoff: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
}
