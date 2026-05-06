import type { VRM } from '@pixiv/three-vrm';
import type { MocapController, MocapState } from './mocap/mocapController';
import type { AnimationController } from './animationController';
import type { MocapDebugRecorder } from './mocap/mocapDebugRecorder';
import { exportClipAsBvh, type BvhExportHandle } from './bvhExportRecorder';

export interface DebugPanelMocapControlsDeps {
  mocap: MocapController;
  mocapVrm: VRM;
  getMocap: () => MocapController | null;
  getController: () => AnimationController | null;
  dbgRecorder: MocapDebugRecorder;
  rememberInterval: (fn: () => void, ms: number) => number;
  rememberTimeout: (fn: () => void, ms: number) => number;
  /** Wired in main.ts. When user picks a .bvh/.vrma/.fbx via the anim-file
   *  input, this loads + retargets it onto the queue. */
  onAnimFile?: (file: File) => Promise<void> | void;
}

export interface DebugPanelMocapControlsHandles {
  /** Called by mocap.onStateChange (registered by mountDebugPanel after
   *  this module returns, since onStateChange is single-slot). */
  updateMocapUI: (state: MocapState) => void;
  /** Status label written by mocap.onError handler in the parent. */
  statusLbl: HTMLElement;
}

/**
 * Wire the mocap-controls / capture-source state machine: primary CTA
 * (Start camera / Record / Choose video / Choose animation), source
 * segmented control (camera / video / animfile) with localStorage
 * persistence, file inputs (.mp4 → mocap from file, .bvh/.vrma/.fbx → queue),
 * and the anim-file BVH-recording sub-state machine layered on top.
 *
 * State lives entirely in this module; the parent only re-enters via
 * `updateMocapUI(state)` from the mocap state-change callback. Things this
 * module owns:
 *   - currentSource (localStorage-persisted)
 *   - animExportHandle + animProgressTimer (anim-file BVH recording)
 *   - framesTimer (per-frame label updater while recording)
 *   - All DOM elements in #capture-* and #mocap-* (queried by id, not via
 *     the panel root, because they live in the right-side tuning panel
 *     rather than #debug-panel itself).
 */
export function wireMocapControls(
  deps: DebugPanelMocapControlsDeps,
): DebugPanelMocapControlsHandles {
  const { mocap, mocapVrm, getMocap, getController, dbgRecorder,
          rememberInterval, rememberTimeout, onAnimFile } = deps;

  // ── DOM ──────────────────────────────────────────────────────────────────
  const primaryBtn  = document.querySelector<HTMLButtonElement>('#capture-primary-btn')!;
  const stopCamBtn  = document.querySelector<HTMLButtonElement>('#capture-stop-cam-btn')!;
  const playRow     = document.querySelector<HTMLElement>('#mocap-playback-row')!;
  const statusLbl   = document.querySelector<HTMLElement>('#mocap-status-label')!;
  const framesLbl   = document.querySelector<HTMLElement>('#mocap-frames')!;
  const sourceInfo  = document.querySelector<HTMLElement>('#mocap-source-info')!;
  const previewPanel = document.getElementById('mocap-preview-panel')!;
  const previewCvs   = document.getElementById('mocap-canvas') as HTMLCanvasElement;
  const fileInput     = document.querySelector<HTMLInputElement>('#mocap-file-input')!;
  const animFileInput = document.querySelector<HTMLInputElement>('#anim-file-input')!;
  const sourceBtns    = Array.from(document.querySelectorAll<HTMLButtonElement>('.capture-src-btn'));

  // 4:3 at 2× panel width for sharpness — matches CSS sizing of the canvas host.
  previewCvs.width  = 440;
  previewCvs.height = 330;

  // ── Source info (shown in the status row) ────────────────────────────────
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const formatSourceInfo = (w: number, h: number): string => {
    if (!w || !h) return '';
    const d = gcd(w, h);
    const aw = w / d, ah = h / d;
    const ratio = aw <= 32 && ah <= 32 ? `${aw}:${ah}` : (w / h).toFixed(2) + ':1';
    return `📐 ${w}×${h} (${ratio})`;
  };
  const refreshSourceInfo = (): void => {
    const m = getMocap();
    if (!m) { sourceInfo.textContent = ''; return; }
    sourceInfo.textContent = formatSourceInfo(m.videoElement.videoWidth, m.videoElement.videoHeight);
  };
  // Video element only knows its dimensions after metadata is loaded — a
  // fresh getUserMedia stream / file load won't have width/height ready when
  // we get the state-change event. Listen once and refresh from there.
  mocap.videoElement.addEventListener('loadedmetadata', refreshSourceInfo);

  // ── Source state (persisted across reloads) ──────────────────────────────
  type CaptureSource = 'camera' | 'video' | 'animfile';
  const SOURCE_KEY = 'vrm-player.capture-source';
  const validSource = (s: string | null): CaptureSource =>
    s === 'video' || s === 'animfile' ? s : 'camera';
  let currentSource: CaptureSource = validSource(localStorage.getItem(SOURCE_KEY));

  const paintSourceBtns = (): void => {
    for (const b of sourceBtns) {
      const active = b.dataset.source === currentSource;
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };
  paintSourceBtns();

  // ── Anim-file Record/Stop state ──────────────────────────────────────────
  // Independent of MocapState — anim-file source doesn't touch the mocap
  // pipeline. Active during a queue-clip BVH-export started from the Capture
  // panel. Source-switch cancels (saves partial). updateAnimUI() repaints
  // primary CTA + status during recording / when queue changes.
  let animExportHandle: BvhExportHandle | null = null;
  let animProgressTimer = 0;
  let framesTimer = 0;

  const updateAnimUI = (): void => {
    if (currentSource !== 'animfile') return;
    const ctrl = getController();
    const queueLen = ctrl?.queueLength ?? 0;
    const recording = animExportHandle !== null;

    primaryBtn.classList.toggle('recording', recording);
    primaryBtn.disabled = false;

    if (recording) {
      primaryBtn.textContent = '⏹ Stop';
      // Status / progress filled by animProgressTimer.
    } else if (queueLen === 0) {
      primaryBtn.textContent = 'Choose animation…';
      statusLbl.textContent = '🎬 Pick a .bvh / .vrma / .fbx';
      framesLbl.textContent = '';
    } else {
      primaryBtn.textContent = '⏺ Record BVH';
      const name = ctrl?.currentName || '';
      const dur  = ctrl?.currentDuration ?? 0;
      statusLbl.textContent = name
        ? `🎬 ready · ${name} (${dur.toFixed(1)}s)`
        : '🎬 ready';
      framesLbl.textContent = '';
    }
  };

  const startAnimProgressTimer = (): void => {
    clearInterval(animProgressTimer);
    animProgressTimer = rememberInterval(() => {
      if (!animExportHandle) return;
      const ctrl = getController();
      const dur = ctrl?.currentDuration ?? 0;
      const elapsed = animExportHandle.elapsed();
      const pct = dur > 0 ? Math.min(100, Math.round((elapsed / dur) * 100)) : 0;
      statusLbl.textContent = `⏺ recording ${pct}%`;
      framesLbl.textContent = `${animExportHandle.frameCount()} frames`;
    }, 200);
  };

  const startAnimRecord = (): void => {
    const ctrl = getController();
    if (!ctrl || ctrl.queueLength === 0) return;
    if (animExportHandle) return; // already recording
    const qi = ctrl.currentQueuePos >= 0 ? ctrl.currentQueuePos : 0;
    try {
      const handle = exportClipAsBvh(qi, ctrl, mocapVrm);
      animExportHandle = handle;
      updateAnimUI();
      startAnimProgressTimer();
      handle.promise
        .then((filename) => {
          statusLbl.textContent = `✓ saved ${filename}`;
          framesLbl.textContent = '';
        })
        .catch((e) => {
          statusLbl.textContent = `❌ ${(e as Error).message.slice(0, 60)}`;
        })
        .finally(() => {
          animExportHandle = null;
          clearInterval(animProgressTimer);
          updateAnimUI();
        });
    } catch (e) {
      statusLbl.textContent = `❌ ${(e as Error).message.slice(0, 60)}`;
      animExportHandle = null;
    }
  };

  const cancelAnimRecord = (): void => {
    animExportHandle?.cancel();
    // The Promise's .finally clears the handle + repaints UI.
  };

  // Note: controller.onChange already has a single listener wired up by
  // main.ts (queue.setActive + setStatus). It's a single-slot API, not
  // multi-listener, so we deliberately don't add ourselves there. Instead
  // we call updateAnimUI() at the three explicit moments where state shifts:
  //   - source switch INTO animfile
  //   - after a file finishes loading (anim-file-input change handler)
  //   - on record start / stop transitions inside this module

  // ── Mocap-state-driven UI updater (called by parent's onStateChange) ─────
  const updateMocapUI = (state: MocapState): void => {
    clearInterval(framesTimer);
    const m = getMocap();
    framesLbl.textContent = '';
    primaryBtn.classList.remove('recording');
    primaryBtn.disabled = false;
    if (state === 'off') sourceInfo.textContent = '';
    else refreshSourceInfo();

    // Anim-file source has its own state machine — defer to updateAnimUI
    // and skip the mocap-state branches below.
    if (currentSource === 'animfile') {
      stopCamBtn.style.display   = 'none';
      playRow.style.display      = 'none';
      previewPanel.style.display = 'none';
      m?.setCanvas(null);
      updateAnimUI();
      return;
    }

    if (state === 'off') {
      const hasFrozenFrame = !!m?.latestFrame;
      if (currentSource === 'camera') {
        statusLbl.textContent  = hasFrozenFrame ? '📷 Camera off (last frame)' : '📷 Camera off';
        primaryBtn.textContent = 'Start camera';
      } else if (currentSource === 'video') {
        statusLbl.textContent  = '📁 Pick a video to process';
        primaryBtn.textContent = 'Choose video…';
      } else {
        statusLbl.textContent  = '🎬 Pick a .bvh / .vrma / .fbx';
        primaryBtn.textContent = 'Choose animation…';
      }
      stopCamBtn.style.display   = 'none';
      playRow.style.display      = 'none';
      previewPanel.style.display = hasFrozenFrame ? 'block' : 'none';
      m?.setCanvas(null);
      // Auto-stop debug recorder when file processing completes.
      if (dbgRecorder.active) dbgRecorder.stop();
    } else if (state === 'live') {
      statusLbl.textContent      = '📷 Live preview';
      primaryBtn.textContent     = '⏺ Record';
      stopCamBtn.style.display   = 'block';
      playRow.style.display      = 'flex';
      previewPanel.style.display = 'block';
      m?.setCanvas(previewCvs);
    } else if (state === 'recording') {
      const isFile = (m?.duration ?? 0) > 0;
      statusLbl.textContent      = isFile ? '🎬 Processing video…' : '📷 Recording…';
      primaryBtn.textContent     = isFile ? '⏹ Cancel' : '⏹ Stop';
      primaryBtn.classList.add('recording');
      stopCamBtn.style.display   = 'none';
      playRow.style.display      = 'flex';
      previewPanel.style.display = 'block';
      m?.setCanvas(previewCvs);
      framesTimer = rememberInterval(() => {
        const mm = getMocap();
        if (!mm) return;
        const dur = mm.duration;
        framesLbl.textContent = dur > 0
          ? `${mm.currentTime.toFixed(1)}s / ${dur.toFixed(1)}s`
          : `${mm.recordingFrameCount} frames`;
      }, 200);
    }
  };

  // ── Primary CTA / Stop camera ────────────────────────────────────────────
  const handlePrimaryClick = async (): Promise<void> => {
    const m = getMocap();
    if (!m) return;

    if (m.state === 'recording') {
      // Both camera-recording and file-processing exit through this branch.
      const isFile = m.duration > 0;
      if (isFile) m.stop();
      else        m.stopRecording();
      return;
    }

    if (currentSource === 'camera') {
      if (m.state === 'off') {
        primaryBtn.textContent = '…';
        primaryBtn.disabled = true;
        try { await m.startLive(); }
        catch { statusLbl.textContent = '❌ Camera error'; }
        finally { primaryBtn.disabled = false; }
      } else if (m.state === 'live') {
        m.startRecording();
      }
    } else if (currentSource === 'video') {
      if (m.state === 'off') fileInput.click();
    } else {
      // Anim file source — three states (see updateAnimUI):
      //   recording → cancel (saves partial)
      //   queue empty → open file picker
      //   queue ready → start recording current item
      if (animExportHandle) {
        cancelAnimRecord();
      } else if ((getController()?.queueLength ?? 0) === 0) {
        animFileInput.click();
      } else {
        startAnimRecord();
      }
    }
  };

  primaryBtn.addEventListener('click', () => { void handlePrimaryClick(); });

  stopCamBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    if (m.state === 'recording') m.stopRecording();
    m.stop();
  });

  // ── Source segmented control ─────────────────────────────────────────────
  for (const b of sourceBtns) {
    b.addEventListener('click', () => {
      const next = b.dataset.source as CaptureSource | undefined;
      if (next !== 'camera' && next !== 'video' && next !== 'animfile') return;
      if (next === currentSource) return;
      // Cancel anim-file BVH export if leaving animfile mid-recording — the
      // partial BVH is still saved (BvhExportHandle.cancel() finishes the
      // recorder and downloads what's been captured).
      if (currentSource === 'animfile' && animExportHandle) {
        cancelAnimRecord();
      }
      const m = getMocap();
      // Stop any active mocap session before switching — anim-file source
      // doesn't run mocap, so leaving it active would be misleading.
      if (m && m.state !== 'off') {
        if (m.state === 'recording') m.stopRecording();
        m.stop();
      }
      currentSource = next;
      try { localStorage.setItem(SOURCE_KEY, currentSource); } catch { /* quota */ }
      paintSourceBtns();
      updateMocapUI(getMocap()?.state ?? 'off');
    });
  }

  // ── Anim file input (.bvh / .vrma / .fbx) ────────────────────────────────
  animFileInput.addEventListener('change', async () => {
    const file = animFileInput.files?.[0];
    animFileInput.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!onAnimFile) {
      statusLbl.textContent = '❌ animation import not wired';
      return;
    }
    statusLbl.textContent = `🎬 loading ${file.name}…`;
    try {
      await onAnimFile(file);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)) || 'unknown error';
      statusLbl.textContent = `❌ ${msg.slice(0, 60)}`;
    }
    // Clip is in the queue and playing now; flip primary CTA from
    // "Choose animation…" to "⏺ Record BVH".
    updateAnimUI();
  });

  // ── File video input (.mp4 → mocap pipeline) ─────────────────────────────
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // reset so same file can be re-selected
    if (!file) return;
    const m = getMocap();
    if (!m || m.state !== 'off') return;
    // Auto-start debug recorder for full file capture (no frame cap).
    dbgRecorder.start(Infinity);
    try {
      await m.startFromFile(file);
    } catch (e) {
      dbgRecorder.stop(); // cleanup if file failed to load
      const msg = (e instanceof Error ? e.message : String(e)) || 'unknown error';
      statusLbl.textContent = `❌ ${msg.slice(0, 28)}`;
    }
  });

  // ── Playback controls (pause / step / grab / flush / export pose) ───────
  // Lives in the same #mocap-playback-row as primary CTA, so wire it here
  // rather than splitting into yet another module.
  const pauseBtn      = document.querySelector<HTMLButtonElement>('#mocap-pause-btn')!;
  const stepBackBtn   = document.querySelector<HTMLButtonElement>('#mocap-step-back-btn')!;
  const stepFwdBtn    = document.querySelector<HTMLButtonElement>('#mocap-step-fwd-btn')!;
  const grabBtn       = document.querySelector<HTMLButtonElement>('#mocap-grab-btn')!;
  const flushBtn      = document.querySelector<HTMLButtonElement>('#mocap-flush-btn')!;
  const exportPoseBtn = document.querySelector<HTMLButtonElement>('#mocap-export-pose-btn')!;

  const syncPauseBtn = (): void => {
    const m = getMocap();
    const paused = m?.isPaused ?? false;
    pauseBtn.textContent = paused ? '▶' : '⏸';
    pauseBtn.classList.toggle('off', paused);
  };
  pauseBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    if (m.isPaused) m.resume(); else m.pause();
    syncPauseBtn();
  });

  stepBackBtn.addEventListener('click', async () => {
    const m = getMocap();
    if (!m || !m.isPaused) return;
    await m.stepFrame(-1 / 30);
  });
  stepFwdBtn.addEventListener('click', async () => {
    const m = getMocap();
    if (!m || !m.isPaused) return;
    await m.stepFrame(1 / 30);
  });

  grabBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    m.grabFrame();
    framesLbl.textContent = `${m.grabbedFrameCount} frames`;
  });
  flushBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    m.flushGrabbed();
    framesLbl.textContent = `${m.grabbedFrameCount} frames`;
  });

  exportPoseBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    const prevText = exportPoseBtn.textContent || 'Export .bvh';
    exportPoseBtn.textContent = '…';
    exportPoseBtn.disabled = true;
    try {
      const name = m.exportCurrentPoseBvh();
      exportPoseBtn.textContent = 'Saved';
      exportPoseBtn.title = `Downloaded ${name}.bvh`;
    } finally {
      rememberTimeout(() => {
        exportPoseBtn.textContent = prevText;
        exportPoseBtn.title = 'Download current avatar pose as a 1-frame BVH';
        exportPoseBtn.disabled = false;
      }, 900);
    }
  });

  return { updateMocapUI, statusLbl };
}
