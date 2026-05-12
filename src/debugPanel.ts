import { createApp, type App } from 'vue';
import DebugPanelRoot from './playerVue/DebugPanelRoot.vue';
import TuningPanel from './playerVue/TuningPanel.vue';
import { installPrimeVueOn } from './playerVue/plugin';
import { mountSkelModal } from './debugPanelSkelModal';
import { mountBvhModal } from './debugPanelBvhModal';
import { mountBvhVerifyModal } from './debugPanelBvhVerifyModal';
import { wireDebugPanelTools } from './debugPanelTools';
import { wireDebugPanelCalibration } from './debugPanelCalibration';
import { wireMocapControls } from './debugPanelMocapControls';
import { wireDebugPanelMocapParams } from './debugPanelMocapParams';
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

  // ── Mount Vue islands for the panel STRUCTURE ────────────────────────────
  // The 11 wireXxx() calls below find their elements via getElementById on
  // the DOM Vue renders. We use v-show for tabs + native <details> for folds
  // so the id'd elements never unmount between rerenders.
  //
  // Genuinely reactive parts inside the Vue components: tab switching,
  // fold open-state + localStorage persistence, demo mode toggle,
  // layer toggles (idle / breathing / etc.). Everything else stays
  // imperatively wired post-mount.
  const debugApp: App = createApp(DebugPanelRoot, {
    pa, micro, idle, controller,
    // Live readouts: priority bars (StatsPanel), hip force (HipForcePanel),
    // mocap stats (MocapStatsPanel) all live inside this Vue tree and own
    // their own polling timers. Replaces the old `wireDebugPanelStats` +
    // `wireDebugPanelMocapStats` imperative pipelines.
    hipForce, hipBalance,
    getMocap, mocapDebugViz,
  });
  installPrimeVueOn(debugApp);
  debugApp.mount(root);

  let tuningApp: App | null = null;
  const tuningRoot = document.getElementById('mocap-tuning-panel');
  if (tuningRoot) {
    tuningApp = createApp(TuningPanel);
    installPrimeVueOn(tuningApp);
    tuningApp.mount(tuningRoot);
  }

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
    // Unmounting the Vue apps tears down their event listeners + reactive
    // effects. The previous `root.innerHTML = ''` did the same for vanilla.
    debugApp.unmount();
    tuningApp?.unmount();
  };
}
