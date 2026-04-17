import type { VRM } from '@pixiv/three-vrm';

/**
 * Procedural micro-animations — breathing, head sway, eye saccades,
 * realistic blink, weight shift.
 *
 * All use a DELTA pattern: each frame subtracts the previous offset and
 * adds the new one. This means they compose additively on top of whatever
 * the AnimationMixer or PriorityAnimator has set — no conflict.
 */
export class MicroAnimations {
  // Toggles (all on by default)
  breathing = true;
  headSway = true;
  eyeSaccades = true;
  blink = true;
  weightShift = true;

  // ── Breathing ──────────────────────────────────────────────────────────────
  private _prevBreath = 0;
  private _prevBreathSpine = 0;
  private _prevBreathUpper = 0;

  // ── Head sway ──────────────────────────────────────────────────────────────
  private _prevSwayX = 0;
  private _prevSwayY = 0;
  private _prevSwayZ = 0;

  // ── Eye saccades ───────────────────────────────────────────────────────────
  private _nextSaccade = 0;
  private _saccTargetX = 0;
  private _saccTargetY = 0;
  private _saccCurX = 0;
  private _saccCurY = 0;
  private _prevSaccX = 0;
  private _prevSaccY = 0;

  // ── Blink ──────────────────────────────────────────────────────────────────
  private _blinkPhase: 'idle' | 'closing' | 'opening' = 'idle';
  private _blinkValue = 0;
  private _nextBlink = 0;
  private _doubleBlink = false;

  // ── Weight shift ───────────────────────────────────────────────────────────
  private _prevShift = 0;
  private _prevShiftSpine = 0;

  // ── Helpers ────────────────────────────────────────────────────────────────

  private rawBone(vrm: VRM, name: string) {
    try { return vrm.humanoid.getRawBoneNode(name as any); } catch { return null; }
  }

  private normBone(vrm: VRM, name: string) {
    try { return vrm.humanoid.getNormalizedBoneNode(name as any); } catch { return null; }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Run all enabled micro-animations for this frame. */
  update(vrm: VRM): void {
    if (this.breathing)   this._animateBreathing(vrm);
    if (this.headSway)    this._animateHeadSway(vrm);
    if (this.eyeSaccades) this._animateEyeSaccades(vrm);
    if (this.blink)       this._animateBlink(vrm);
    if (this.weightShift) this._animateWeightShift(vrm);
  }

  // ── Breathing (~15 breaths / min) ──────────────────────────────────────────

  private _animateBreathing(vrm: VRM): void {
    const t = performance.now();
    const breath = Math.sin(t * 0.002) * 0.012;
    const spine  = breath * 0.5;
    const upper  = breath * 0.3;

    const chest      = this.normBone(vrm, 'chest');
    const spineNode  = this.normBone(vrm, 'spine');
    const upperChest = this.normBone(vrm, 'upperChest');

    if (chest)      chest.rotation.x      += breath - this._prevBreath;
    if (spineNode)  spineNode.rotation.x  += spine  - this._prevBreathSpine;
    if (upperChest) upperChest.rotation.x += upper  - this._prevBreathUpper;

    this._prevBreath      = breath;
    this._prevBreathSpine = spine;
    this._prevBreathUpper = upper;
  }

  // ── Head sway (irrational frequencies → never repeats) ────────────────────

  private _animateHeadSway(vrm: VRM): void {
    const t = performance.now() * 0.001;
    const sx = Math.sin(t * 0.71) * 0.003 + Math.sin(t * 1.37) * 0.002;
    const sy = Math.sin(t * 0.53) * 0.002 + Math.sin(t * 1.13) * 0.0015;
    const sz = Math.sin(t * 0.31) * 0.001;

    const head = this.normBone(vrm, 'head');
    if (head) {
      head.rotation.x += sx - this._prevSwayX;
      head.rotation.y += sy - this._prevSwayY;
      head.rotation.z += sz - this._prevSwayZ;
    }

    this._prevSwayX = sx;
    this._prevSwayY = sy;
    this._prevSwayZ = sz;
  }

  // ── Eye saccades (fast micro-movements every 300–800 ms) ──────────────────

  private _animateEyeSaccades(vrm: VRM): void {
    const now = performance.now();
    if (now > this._nextSaccade) {
      this._nextSaccade  = now + 300 + Math.random() * 500;
      this._saccTargetX  = (Math.random() - 0.5) * 0.04;
      this._saccTargetY  = (Math.random() - 0.5) * 0.02;
    }

    this._saccCurX += (this._saccTargetX - this._saccCurX) * 0.3;
    this._saccCurY += (this._saccTargetY - this._saccCurY) * 0.3;

    const dx = this._saccCurX - this._prevSaccX;
    const dy = this._saccCurY - this._prevSaccY;

    const lEye = this.rawBone(vrm, 'leftEye');
    const rEye = this.rawBone(vrm, 'rightEye');
    if (lEye) { lEye.rotation.y += dx; lEye.rotation.x += dy; }
    if (rEye) { rEye.rotation.y += dx; rEye.rotation.x += dy; }

    this._prevSaccX = this._saccCurX;
    this._prevSaccY = this._saccCurY;
  }

  // ── Blink state machine: idle → closing → opening ─────────────────────────

  private _animateBlink(vrm: VRM): void {
    const now = performance.now();

    if (this._blinkPhase === 'idle') {
      if (now > this._nextBlink) this._blinkPhase = 'closing';
      return;
    }

    if (this._blinkPhase === 'closing') {
      this._blinkValue += 0.3;          // ~60 ms to close
      if (this._blinkValue >= 1) { this._blinkValue = 1; this._blinkPhase = 'opening'; }
    } else {
      this._blinkValue -= 0.18;         // ~100 ms to open (slower = natural)
      if (this._blinkValue <= 0) {
        this._blinkValue = 0;
        this._blinkPhase = 'idle';
        if (!this._doubleBlink && Math.random() < 0.2) {
          this._doubleBlink = true;
          this._nextBlink = now + 80;   // double-blink: fast second blink
        } else {
          this._doubleBlink = false;
          this._nextBlink = now + 2000 + Math.random() * 4000;
        }
      }
    }

    try {
      vrm.expressionManager?.setValue('blinkLeft',  this._blinkValue);
      vrm.expressionManager?.setValue('blinkRight', this._blinkValue);
    } catch { /* model may not have blink expressions */ }
  }

  // ── Weight shift (slow hip sway, ~8–12 sec period) ────────────────────────

  private _animateWeightShift(vrm: VRM): void {
    const t = performance.now() * 0.001;
    const shift      = Math.sin(t * 0.08) * 0.015 + Math.sin(t * 0.13) * 0.008;
    const spineShift = shift * 0.4;

    const hips      = this.normBone(vrm, 'hips');
    const spineNode = this.normBone(vrm, 'spine');

    if (hips)      hips.position.x      += shift      - this._prevShift;
    if (spineNode) spineNode.rotation.z -= spineShift  - this._prevShiftSpine;

    this._prevShift      = shift;
    this._prevShiftSpine = spineShift;
  }
}
