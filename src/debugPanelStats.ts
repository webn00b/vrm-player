import type { PriorityAnimator } from './priorityAnimator';
import type { HipForceTracker } from './physics/hipForce';
import type { HipBalanceCorrector } from './physics/hipBalanceCorrector';

export interface DebugPanelStatsDeps {
  pa: PriorityAnimator;
  hipForce: HipForceTracker;
  hipBalance: HipBalanceCorrector;
  rememberInterval: (fn: () => void, ms: number) => number;
}

/**
 * Wire the per-frame readout sections of the debug panel: priority-animator
 * activity bars and the hip-force diagnostic readout.
 *
 * Both are pure poll-and-update-DOM: they don't own any event handlers, just
 * a rememberInterval each that reads system state and writes textContent /
 * style.width into prebuilt HTML. Extracting them out of mountDebugPanel
 * keeps the orchestrator focused on lifecycle (mount, cleanup) and event
 * wiring rather than per-frame DOM diffing.
 */
export function wireDebugPanelStats(deps: DebugPanelStatsDeps): void {
  wirePriorityBars(deps);
  wireHipForceReadout(deps);
}

// ── Priority bars (PriorityAnimator level distribution) ───────────────────
function wirePriorityBars({ pa, rememberInterval }: DebugPanelStatsDeps): void {
  const bar1 = document.getElementById('dbg-bar-1')!;
  const bar2 = document.getElementById('dbg-bar-2')!;
  const bar5 = document.getElementById('dbg-bar-5')!;
  const statBones = document.getElementById('dbg-bones')!;
  const MAX_BONES = 15;

  rememberInterval(() => {
    let lv1 = 0, lv2 = 0, lv5 = 0;
    for (const [, level] of pa.levelSnapshot) {
      if (level >= 5) lv5++; else if (level === 2) lv2++; else if (level === 1) lv1++;
    }
    const pct = (n: number) => `${Math.min(100, (n / MAX_BONES) * 100)}%`;
    bar1.style.width = pct(lv1); bar2.style.width = pct(lv2); bar5.style.width = pct(lv5);
    bar1.style.opacity = lv1 > 0 ? '1' : '0.2';
    bar2.style.opacity = lv2 > 0 ? '1' : '0.2';
    bar5.style.opacity = lv5 > 0 ? '1' : '0.2';
    statBones.textContent = `Active bones: ${pa.activeBoneCount}`;
  }, 100);
}

// ── Hip force readout + balance-corrector toggle ──────────────────────────
// Per-frame the tracker updates `latest`; we sample at 10 Hz into the panel —
// faster cadence is unreadable to humans and just churns DOM. Lazy: only
// update when the fold-hipforce details element is open.
function wireHipForceReadout({
  hipForce, hipBalance, rememberInterval,
}: DebugPanelStatsDeps): void {
  const foldHipForce = document.getElementById('fold-hipforce') as HTMLDetailsElement | null;
  const els = {
    mass:   document.getElementById('dbg-hipforce-mass'),
    total:  document.getElementById('dbg-hipforce-total'),
    grav:   document.getElementById('dbg-hipforce-grav'),
    inert:  document.getElementById('dbg-hipforce-inert'),
    tilt:   document.getElementById('dbg-hipforce-tilt'),
    gtilt:  document.getElementById('dbg-hipforce-gtilt'),
    angles: document.getElementById('dbg-hipbal-angles'),
  };

  // Balance-corrector toggle. Reset on disable is handled inside the
  // corrector; on re-enable we start fresh with no carry-over angles.
  const hipBalBtn = document.getElementById('hipbal-btn') as HTMLButtonElement | null;
  const refreshHipBalBtn = (): void => {
    if (!hipBalBtn) return;
    hipBalBtn.textContent = hipBalance.enabled ? 'ON' : 'OFF';
    hipBalBtn.classList.toggle('off', !hipBalance.enabled);
  };
  refreshHipBalBtn();
  hipBalBtn?.addEventListener('click', () => {
    hipBalance.enabled = !hipBalance.enabled;
    refreshHipBalBtn();
  });

  rememberInterval(() => {
    if (!foldHipForce?.open) return;
    const r = hipForce.latest;
    if (!r) {
      if (els.total) els.total.textContent = '|F_total|: —';
      return;
    }
    if (els.mass) els.mass.textContent = `tracked mass: ${r.totalMass.toFixed(1)} kg`;
    const fmtN = (v: number): string => `${v.toFixed(1)} N`;
    if (!r.ready) {
      // Gravity is valid even before warmup; inertia/total need velocity history.
      if (els.total) els.total.textContent = '|F_total|: warming up…';
      if (els.grav)  els.grav.textContent  = `|F_grav|:  ${fmtN(r.gravityWorld.length())}`;
      if (els.inert) els.inert.textContent = '|F_inert|: —';
      if (els.tilt)  els.tilt.textContent  = 'tilt vs Y_hip: —';
      return;
    }
    if (els.total) els.total.textContent = `|F_total|: ${fmtN(r.totalWorld.length())}`;
    if (els.grav)  els.grav.textContent  = `|F_grav|:  ${fmtN(r.gravityWorld.length())}`;
    if (els.inert) els.inert.textContent = `|F_inert|: ${fmtN(r.inertiaWorld.length())}`;

    // tilt = angle between F_total and +Y_hip; 0° means force is perfectly
    // aligned with the spine (gravity straight down through a vertical body).
    if (els.tilt) {
      const local = r.totalInHipSpace;
      const len = local.length();
      els.tilt.textContent = len < 1e-6
        ? 'tilt vs Y_hip: —'
        : `tilt vs Y_hip: ${(Math.acos(Math.max(-1, Math.min(1, local.y / len))) * 180 / Math.PI).toFixed(1)}°`;
    }
    // Gravity-only tilt = signal the corrector actually uses. Cleaner number,
    // unaffected by motion-induced inertia. 0° = hip upright.
    if (els.gtilt) {
      const gLocal = r.gravityInHipSpace;
      const gLen = gLocal.length();
      els.gtilt.textContent = gLen < 1e-6
        ? 'gravity tilt: —'
        : `gravity tilt: ${(Math.acos(Math.max(-1, Math.min(1, -gLocal.y / gLen))) * 180 / Math.PI).toFixed(1)}°`;
    }
    // Balance-corrector applied angles (smoothed, post-clamp). When OFF the
    // values stay at their last applied (or 0 after reset) snapshot.
    if (els.angles) {
      if (hipBalance.enabled) {
        const a = hipBalance.latestAnglesDeg;
        els.angles.textContent = `corr. angles: X=${a.x.toFixed(1)}°  Z=${a.z.toFixed(1)}°`;
      } else {
        els.angles.textContent = 'corr. angles: (off)';
      }
    }
  }, 100);
}
