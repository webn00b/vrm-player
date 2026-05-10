import { buildMainPanelHtml, buildTuningPanelHtml } from './debugPanelHtml';
import { mountSkelModal } from './debugPanelSkelModal';
import { mountBvhModal } from './debugPanelBvhModal';
import { mountBvhVerifyModal } from './debugPanelBvhVerifyModal';
import { wireDebugPanelTools } from './debugPanelTools';
import { wireDebugPanelStats } from './debugPanelStats';
import { wireDebugPanelCalibration } from './debugPanelCalibration';
import { wireMocapControls } from './debugPanelMocapControls';
import { wireDebugPanelMocapParams } from './debugPanelMocapParams';
import { wireDebugPanelMocapStats } from './debugPanelMocapStats';
import { wireHipsEqualsAndDiagModal } from './debugPanelHipsModal';
import type { PlaybackSystems, MocapSystems, ToolingSystems } from './playerSystems';

export function mountDebugPanel(
  playback: PlaybackSystems,
  mocapSys: MocapSystems,
  tooling: ToolingSystems,
  setModelVisible: (v: boolean) => void,
  onAnimFile?: (file: File) => Promise<void> | void,
): () => void {
  const { pa, micro, idle, controller } = playback;
  const { mocap, debugViz: mocapDebugViz, dbgRecorder } = mocapSys;
  const { skelViz, validator, boneDrag, hipForce, hipBalance, skeletonLogger } = tooling;
  const getController = () => controller;
  const getMocap = () => mocap;
  const root = document.getElementById('debug-panel');
  if (!root) return () => {};

  const listenerAbort = new AbortController();
  const intervalIds: number[] = [];
  const timeoutIds: number[] = [];
  const rememberInterval = (fn: () => void, ms: number): number => {
    const id = window.setInterval(fn, ms);
    intervalIds.push(id);
    return id;
  };
  const rememberTimeout = (fn: () => void, ms: number): number => {
    const id = window.setTimeout(fn, ms);
    timeoutIds.push(id);
    return id;
  };

  root.innerHTML = buildMainPanelHtml(idle);

  // ── Right-side mocap tuning panel ────────────────────────────────────────
  const tuningRoot = document.getElementById('mocap-tuning-panel');
  if (tuningRoot) {
    tuningRoot.innerHTML = buildTuningPanelHtml();
  }

  // ── Persist <details class="dbg-fold"> open/closed state ─────────────────
  // Same pattern as the panel-title collapse mechanism in index.html, but per
  // foldable subgroup. Hidden by default — only opens if the user previously
  // expanded that group.
  {
    const FOLD_KEY = 'vrm-player.dbg-fold';
    let foldState: Record<string, boolean> = {};
    try { foldState = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch { /* ignore */ }
    const saveFolds = (): void => {
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(foldState)); } catch { /* ignore */ }
    };
    const folds = [
      ...root.querySelectorAll<HTMLDetailsElement>('details.dbg-fold[id]'),
      ...(tuningRoot?.querySelectorAll<HTMLDetailsElement>('details.dbg-fold[id]') ?? []),
    ];
    for (const d of folds) {
      if (foldState[d.id]) d.open = true;
      d.addEventListener('toggle', () => {
        foldState[d.id] = d.open;
        saveFolds();
      });
    }
  }

  // ── Tab switcher ─────────────────────────────────────────────────────────
  root.querySelectorAll<HTMLButtonElement>('.dbg-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.tab!;
      root.querySelectorAll<HTMLElement>('.dbg-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === name);
      });
      root.querySelectorAll<HTMLElement>('.dbg-tab-panel').forEach((p) => {
        p.classList.toggle('active', p.dataset.panel === name);
      });
    });
  });

  // ── Demo mode ─────────────────────────────────────────────────────────────

  let demoMode = false;
  const demoBtn = root.querySelector<HTMLButtonElement>('#dbg-demo')!;
  const hint    = root.querySelector<HTMLElement>('#dbg-hint')!;

  demoBtn.addEventListener('click', () => {
    demoMode = !demoMode;
    demoBtn.textContent = demoMode ? 'ON' : 'OFF';
    demoBtn.classList.toggle('off', !demoMode);
    const ctrl = getController();
    if (ctrl) ctrl.setMuted(demoMode);
    if (!demoMode) pa.reset();
    hint.style.opacity = demoMode ? '0' : '0.5';
  });

  // ── Layer toggles ─────────────────────────────────────────────────────────

  const states: Record<string, boolean> = {
    idle: false, breathing: false, headSway: false,
    eyeSaccades: false, blink: false, weightShift: false,
  };

  root.querySelectorAll<HTMLButtonElement>('.dbg-toggle[data-key]').forEach((btn) => {
    const key = btn.dataset.key!;
    btn.addEventListener('click', () => {
      states[key] = !states[key];
      btn.textContent = states[key] ? 'ON' : 'OFF';
      btn.classList.toggle('off', !states[key]);
      if (key === 'idle') { idle.enabled = states[key]; if (!states[key]) pa.reset(); }
      else (micro as any)[key] = states[key];
    });
  });

  // ── Per-frame readouts (priority bars + hip force). Pure poll-and-update,
  //    no event handlers — see debugPanelStats.ts.
  wireDebugPanelStats({ pa, hipForce, hipBalance, rememberInterval });

  // ── Mocap controls + capture-source state machine ────────────────────────
  // All record/stop, source switching, and file-input handling lives in
  // debugPanelMocapControls. Returns updateMocapUI + statusLbl that the
  // tuning section below threads into mocap.onStateChange / .onError.
  const { updateMocapUI, statusLbl } = wireMocapControls({
    mocap, mocapVrm: mocap.vrm, getMocap, getController, dbgRecorder,
    rememberInterval, rememberTimeout, onAnimFile,
  });

  // ── Mocap parameter toggles + sliders (quality, mirror, face, hip,
  //    handprio, spread, filter, depth). See debugPanelMocapParams.ts.
  wireDebugPanelMocapParams({ root, getMocap });

  // ── Debug skeleton overlay toggle + visibility/scalar stats grid.
  //    See debugPanelMocapStats.ts.
  wireDebugPanelMocapStats({ root, getMocap, mocapDebugViz, rememberInterval });

  // ── Tuning-panel wiring (all elements live in #mocap-tuning-panel) ───────
  const { calibStat } = wireDebugPanelCalibration({ getMocap, rememberInterval });
  wireHipsEqualsAndDiagModal({ getMocap, rememberTimeout });

  // Wire state-change callback
  const originalMocap = getMocap();
  if (originalMocap) {
    originalMocap.onStateChange = updateMocapUI;
    originalMocap.onError = (err) => {
      statusLbl.textContent = `❌ ${err.message.slice(0, 30)}`;
    };
    originalMocap.onCalibrationChange = (s) => {
      if (s.calibrated) {
        const body = (s.bodyScale * 100).toFixed(0);
        const l = (s.leftArmScale * 100).toFixed(0);
        const r = (s.rightArmScale * 100).toFixed(0);
        calibStat.textContent = `✓ body ${body}%  L ${l}%  R ${r}%`;
      } else {
        calibStat.textContent = 'waiting for hip landmarks…';
      }
    };
  }

  // ── Bottom-of-panel tooling rows (validation, skel-logger, skel toggles,
  //    bone-drag, debug recorder). See debugPanelTools.ts for details.
  wireDebugPanelTools({
    root, validator, skelViz, boneDrag, skeletonLogger, dbgRecorder, mocap,
    getController, setModelVisible, rememberInterval,
  });

  // ── BVH-export options: SystemAnimator-compat toggle ───────────────────
  // Drives MocapController.setSystemAnimatorCompat which (a) updates the
  // shared bvhExportConfig flag read by createBvhRecorderForVrm (queue's
  // ⬇ BVH button) and (b) rebuilds the live/grab recorders so the next
  // mocap session uses the new format.
  const saCompatBtn = root.querySelector<HTMLButtonElement>('#bvh-sa-compat-btn');
  saCompatBtn?.addEventListener('click', () => {
    const next = saCompatBtn.classList.contains('off');
    mocap.setSystemAnimatorCompat(next);
    saCompatBtn.textContent = next ? 'ON' : 'OFF';
    saCompatBtn.classList.toggle('off', !next);
  });

  // ── Skeleton info modal ───────────────────────────────────────────────────

  const cleanupSkelModal = mountSkelModal({
    getMocap,
    validator,
    signal: listenerAbort.signal,
    rememberInterval,
    rememberTimeout,
  });

  // ── BVH diagnostic modal ──────────────────────────────────────────────────

  const cleanupBvhModal = mountBvhModal({
    getMocap,
    signal: listenerAbort.signal,
    rememberTimeout,
  });

  const cleanupBvhVerifyModal = mountBvhVerifyModal({
    getMocap,
    signal: listenerAbort.signal,
    rememberTimeout,
  });

  return () => {
    cleanupSkelModal();
    cleanupBvhModal();
    cleanupBvhVerifyModal();
    for (const id of intervalIds) clearInterval(id);
    for (const id of timeoutIds) clearTimeout(id);
    listenerAbort.abort();
    if ((window as any).dumpSkeleton) delete (window as any).dumpSkeleton;
    root.innerHTML = '';
  };
}
