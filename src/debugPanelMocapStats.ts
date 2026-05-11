import type { MocapController } from './mocap/pipeline/mocapController';
import type { MocapDebugViz } from './mocap/diagnostics/mocapDebugViz';
import { STAT_LANDMARKS } from './mocap/diagnostics/mocapDebugViz';

export interface DebugPanelMocapStatsDeps {
  root: HTMLElement;
  getMocap: () => MocapController | null;
  mocapDebugViz: MocapDebugViz;
  rememberInterval: (fn: () => void, ms: number) => number;
}

/**
 * Wire the "Debug skeleton + visibility stats" section: the on/off toggle
 * for the mocap debug-skeleton overlay, the per-landmark visibility badges
 * grid, and the live scalar-stats block (calibration scales, target-reach %,
 * proportions, detector fps, frame counts).
 *
 * State that lives here:
 *   - dbgSkelOn (mirrors mocapDebugViz.visible),
 *   - fps + sliding-window counters for detector fps approximation,
 *   - visBadges map (DOM-element-per-landmark for the visibility grid).
 *
 * Two `rememberInterval`s: a 100 ms fps counter that runs unconditionally
 * (so toggling the skeleton on doesn't make us wait for a fresh sample),
 * and a 200 ms heavy stats updater that no-ops when the toggle is off.
 */
export function wireDebugPanelMocapStats(deps: DebugPanelMocapStatsDeps): void {
  const { root, getMocap, mocapDebugViz, rememberInterval } = deps;

  const dbgSkelBtn  = root.querySelector<HTMLButtonElement>('#mocap-dbgskel-btn')!;
  const visStatsEl  = root.querySelector<HTMLElement>('#mocap-vis-stats')!;
  const scalarStatsEl = root.querySelector<HTMLElement>('#mocap-scalar-stats')!;

  // Build the per-landmark visibility badges grid.
  visStatsEl.style.cssText =
    'display:none;font-size:10px;font-family:ui-monospace,monospace;' +
    'display:grid;grid-template-columns:1fr 1fr;gap:2px 6px;margin-top:4px';
  const visBadges = new Map<number, HTMLElement>();
  for (const { idx, label } of STAT_LANDMARKS) {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;justify-content:space-between;gap:4px';
    el.innerHTML = `<span style="opacity:.45">${label}</span><span id="vis-${idx}">—</span>`;
    visStatsEl.appendChild(el);
    visBadges.set(idx, el.querySelector(`#vis-${idx}`)!);
  }

  let dbgSkelOn = false;
  dbgSkelBtn.addEventListener('click', () => {
    dbgSkelOn = !dbgSkelOn;
    mocapDebugViz.setVisible(dbgSkelOn);
    dbgSkelBtn.textContent = dbgSkelOn ? 'ON' : 'OFF';
    dbgSkelBtn.classList.toggle('off', !dbgSkelOn);
    visStatsEl.style.display = dbgSkelOn ? 'grid' : 'none';
    scalarStatsEl.style.display = dbgSkelOn ? 'block' : 'none';
  });

  // Detector fps approximation — count latestFrame identity changes over
  // a 500 ms sliding window. Pure poll (no event hook on the detector).
  let fps = 0;
  let prevFrameRef: unknown = null;
  let fpsFrames = 0;
  let fpsWindowStart = performance.now();
  rememberInterval(() => {
    const m = getMocap();
    const frame = m?.latestFrame;
    if (frame && frame !== prevFrameRef) {
      fpsFrames++;
      prevFrameRef = frame;
    }
    const now = performance.now();
    const dt = now - fpsWindowStart;
    if (dt >= 500) {
      fps = (fpsFrames * 1000) / dt;
      fpsFrames = 0;
      fpsWindowStart = now;
    }
  }, 100);

  // Heavy stats updater — only runs when the debug-skeleton toggle is on.
  rememberInterval(() => {
    if (!dbgSkelOn) return;
    const m     = getMocap();
    const frame = m?.latestFrame;
    if (!frame) return;

    // Per-landmark visibility badges with traffic-light colouring.
    let visSum = 0, visCount = 0;
    for (const { idx } of STAT_LANDMARKS) {
      const lm  = frame.landmarks[idx];
      const vis = lm?.visibility ?? null;
      const el  = visBadges.get(idx)!;
      if (vis === null) { el.textContent = '—'; el.style.color = ''; continue; }
      visSum += vis; visCount++;
      const pct = Math.round(vis * 100);
      el.textContent = `${pct}%`;
      el.style.color = vis >= 0.6 ? '#4ade80' : vis >= 0.3 ? '#fbbf24' : '#f87171';
    }
    const avgVis = visCount ? (visSum / visCount) : 0;

    if (!m) { scalarStatsEl.textContent = ''; return; }
    const cal = m.calibration;
    const st  = cal.status();
    const handsDetected = frame.hands.map((h) => h.side).sort().join('+') || '—';
    const face = frame.faceLandmarks?.length ?? 0;
    const hasFace = face > 0 ? `${face}` : '—';

    const row = (label: string, value: string): string =>
      `<div style="display:flex;justify-content:space-between;gap:6px"><span style="opacity:.5">${label}</span><span>${value}</span></div>`;

    const armL = (st.leftArmScale * 100).toFixed(0);
    const armR = (st.rightArmScale * 100).toFixed(0);
    const body = (st.bodyScale * 100).toFixed(0);
    const legScale = (cal.legScale() * 100).toFixed(0);
    const shoulder = (st.shoulderWidthScale * 100).toFixed(0);

    // ── Skeleton-fit metrics ────────────────────────────────────────────
    // Target-reach % = distance(target, shoulder/hip anchor) / avatarLimbLength.
    //   <90%   green  — comfortable reach, IK bends freely.
    //   90–100% amber — near max extension (nearly straight limb).
    //   >100%  red    — target beyond avatar's reach; limb locks straight.
    // More useful than distance(target, actual bone), which is ~0 by
    // construction (targets get scaled to fit avatar length).
    const dt    = m.debugTargets;
    const reach = m.getReachPercent();
    const fitColor = (pct: number): string =>
      pct < 90 ? '#4ade80' : pct <= 100 ? '#fbbf24' : '#f87171';
    const fitRow = (label: string, have: boolean, pct: number): string =>
      have
        ? row(label, `<span style="color:${fitColor(pct)}">${pct.toFixed(0)}%</span>`)
        : row(label, '—');

    // Proportions: performer / avatar, as fraction (100% = same length).
    // armScale = avatar / performer → inverse = performer / avatar proportion.
    const propL = st.leftArmScale  > 0 ? (1 / st.leftArmScale)  * 100 : 0;
    const propR = st.rightArmScale > 0 ? (1 / st.rightArmScale) * 100 : 0;
    const propBody = st.bodyScale  > 0 ? (1 / st.bodyScale)  * 100 : 0;

    // ── Tracking health (D1-lite): per-chain visibility-loss state ──────────
    // Shows the current phase of the per-bone visibility state machine.
    //   live       — actively tracked
    //   recovering — visibility just returned, blending back to live
    //   fresh      — lost <200 ms ago, holding last-good pose
    //   decaying   — lost 200-800 ms ago, fading toward rest
    //   rested     — lost >800 ms ago, at rest pose
    // Mirrors the fade behaviour the user sees on the avatar.
    const trackHealth = m.getTrackingHealth();
    const phaseColor = (phase: string): string => {
      if (phase === 'live')       return '#4ade80';
      if (phase === 'recovering') return '#86efac';
      if (phase === 'fresh')      return '#fbbf24';
      if (phase === 'decaying')   return '#fb923c';
      return '#f87171';  // rested
    };
    const formatPhase = (chain: { phase: string; msSinceLoss: number }): string => {
      const c = phaseColor(chain.phase);
      const suffix = chain.phase === 'live' || chain.phase === 'recovering'
        ? ''
        : ` (${(chain.msSinceLoss / 1000).toFixed(1)}s)`;
      return `<span style="color:${c}">${chain.phase}${suffix}</span>`;
    };

    scalarStatsEl.innerHTML = [
      row('🧭 Calibrated',    st.calibrated ? '<span style="color:#4ade80">yes</span>' : '<span style="color:#f87171">no</span>'),
      row('📏 Body scale',    `${body}%`),
      row('📐 Shoulder scl',  `${shoulder}%`),
      row('🦾 Arm L / R',     `${armL}% / ${armR}%`),
      row('🦵 Leg scale',     `${legScale}%`),
      '<div style="margin-top:6px;opacity:.5;font-size:9px">— proportions (perf/avatar) —</div>',
      row('🧍 Body',          `${propBody.toFixed(0)}%`),
      row('🦾 Arm L / R',     `${propL.toFixed(0)}% / ${propR.toFixed(0)}%`),
      '<div style="margin-top:6px;opacity:.5;font-size:9px">— target reach (% of limb) —</div>',
      fitRow('✋ L arm',       dt.hasArm, reach.armL),
      fitRow('✋ R arm',       dt.hasArm, reach.armR),
      fitRow('🦶 L leg',       dt.hasLeg, reach.legL),
      fitRow('🦶 R leg',       dt.hasLeg, reach.legR),
      '<div style="margin-top:6px;opacity:.5;font-size:9px">— tracking health —</div>',
      row('🦾 L arm',          formatPhase(trackHealth.leftArm)),
      row('🦾 R arm',          formatPhase(trackHealth.rightArm)),
      row('🦵 L leg',          formatPhase(trackHealth.leftLeg)),
      row('🦵 R leg',          formatPhase(trackHealth.rightLeg)),
      row('🧍 Hips',           formatPhase(trackHealth.hips)),
      row('〰 Spine',           formatPhase(trackHealth.spine)),
      '<div style="margin-top:6px;opacity:.5;font-size:9px">— input —</div>',
      row('✋ Hands',         handsDetected),
      row('😶 Face pts',      hasFace),
      row('👁 Avg vis',       `${Math.round(avgVis * 100)}%`),
      row('⏱ Detector fps',  fps.toFixed(1)),
      row('📼 BVH rec/grab', `${m.recordingFrameCount}/${m.grabbedFrameCount}`),
      row('▶ State',          m.state),
    ].join('');
  }, 200);
}
