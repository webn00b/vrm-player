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
