import * as THREE from 'three';
import type { MocapState } from './mocap/mocapController';
import { STAT_LANDMARKS } from './mocap/mocapDebugViz';
import { buildMainPanelHtml, buildTuningPanelHtml } from './debugPanelHtml';
import { mountSkelModal } from './debugPanelSkelModal';
import { mountBvhModal } from './debugPanelBvhModal';
import { mountBvhVerifyModal } from './debugPanelBvhVerifyModal';
import { wireDebugPanelTools } from './debugPanelTools';
import type { PlaybackSystems, MocapSystems, ToolingSystems } from './playerSystems';
import { exportClipAsBvh, type BvhExportHandle } from './bvhExportRecorder';

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

  // ── Priority bars ─────────────────────────────────────────────────────────

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

  // ── Mocap controls ────────────────────────────────────────────────────────

  // Camera/record/playback/file/export rows live in the right tuning panel now,
  // not inside #debug-panel — query from document so they resolve in either host.
  const primaryBtn  = document.querySelector<HTMLButtonElement>('#capture-primary-btn')!;
  const stopCamBtn  = document.querySelector<HTMLButtonElement>('#capture-stop-cam-btn')!;
  const playRow     = document.querySelector<HTMLElement>('#mocap-playback-row')!;
  const pauseBtn    = document.querySelector<HTMLButtonElement>('#mocap-pause-btn')!;
  const stepBackBtn = document.querySelector<HTMLButtonElement>('#mocap-step-back-btn')!;
  const stepFwdBtn  = document.querySelector<HTMLButtonElement>('#mocap-step-fwd-btn')!;
  const grabBtn     = document.querySelector<HTMLButtonElement>('#mocap-grab-btn')!;
  const flushBtn    = document.querySelector<HTMLButtonElement>('#mocap-flush-btn')!;
  const exportPoseBtn = document.querySelector<HTMLButtonElement>('#mocap-export-pose-btn')!;
  const statusLbl   = document.querySelector<HTMLElement>('#mocap-status-label')!;
  const framesLbl   = document.querySelector<HTMLElement>('#mocap-frames')!;
  const sourceInfo  = document.querySelector<HTMLElement>('#mocap-source-info')!;

  // Format video dimensions as "1920×1080 (16:9)" — readers want both raw size
  // (proxy for detail per body part) and aspect (proxy for what fits in frame).
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const formatSourceInfo = (w: number, h: number): string => {
    if (!w || !h) return '';
    const d = gcd(w, h);
    const aw = w / d, ah = h / d;
    // Common ratios get a clean label; weird ones fall back to W:H even if large.
    const ratio = aw <= 32 && ah <= 32 ? `${aw}:${ah}` : (w / h).toFixed(2) + ':1';
    return `📐 ${w}×${h} (${ratio})`;
  };
  const refreshSourceInfo = (): void => {
    const m = getMocap();
    if (!m) { sourceInfo.textContent = ''; return; }
    sourceInfo.textContent = formatSourceInfo(m.videoElement.videoWidth, m.videoElement.videoHeight);
  };
  // The video element only knows its dimensions after metadata is loaded —
  // a fresh getUserMedia stream / file load won't have width/height ready when
  // we get the state-change event. Listen once and refresh from there.
  const mocapInstance = getMocap();
  if (mocapInstance) {
    mocapInstance.videoElement.addEventListener('loadedmetadata', refreshSourceInfo);
  }
  const previewPanel = document.getElementById('mocap-preview-panel')!;
  const previewCvs   = document.getElementById('mocap-canvas') as HTMLCanvasElement;
  const fileInput    = document.querySelector<HTMLInputElement>('#mocap-file-input')!;
  const animFileInput = document.querySelector<HTMLInputElement>('#anim-file-input')!;
  const sourceBtns   = Array.from(document.querySelectorAll<HTMLButtonElement>('.capture-src-btn'));

  // Source persisted across reloads.
  const SOURCE_KEY = 'vrm-player.capture-source';
  type CaptureSource = 'camera' | 'video' | 'animfile';
  const validSource = (s: string | null): CaptureSource =>
    s === 'video' || s === 'animfile' ? s : 'camera';
  let currentSource: CaptureSource = validSource(localStorage.getItem(SOURCE_KEY));

  function paintSourceBtns(): void {
    for (const b of sourceBtns) {
      const active = b.dataset.source === currentSource;
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }
  paintSourceBtns();

  // Set canvas intrinsic resolution (4:3 at 2× panel width for sharpness)
  previewCvs.width  = 440;
  previewCvs.height = 330;

  let framesTimer = 0;

  // ── Anim-file Record/Stop state ────────────────────────────────────────
  // Independent of MocapState — anim-file source doesn't touch the mocap
  // pipeline. Active during a queue-clip BVH-export started from the Capture
  // panel. Source-switch cancels (saves partial). updateAnimUI() repaints
  // primary CTA + status during recording / when queue changes.
  let animExportHandle: BvhExportHandle | null = null;
  let animProgressTimer = 0;

  function updateAnimUI(): void {
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
  }

  function startAnimProgressTimer(): void {
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
  }

  function startAnimRecord(): void {
    const ctrl = getController();
    if (!ctrl || ctrl.queueLength === 0) return;
    if (animExportHandle) return; // already recording
    const qi = ctrl.currentQueuePos >= 0 ? ctrl.currentQueuePos : 0;
    try {
      const handle = exportClipAsBvh(qi, ctrl, mocapSys.mocap.vrm);
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
  }

  function cancelAnimRecord(): void {
    animExportHandle?.cancel();
    // The Promise's .finally clears the handle + repaints UI.
  }

  // Note: controller.onChange already has a single listener wired up by
  // main.ts (the queue.setActive + setStatus call). It's a single-slot API,
  // not multi-listener, so we deliberately don't add ourselves there. Instead
  // we call updateAnimUI() at the three explicit moments where state shifts:
  //   - source switch INTO animfile
  //   - after a file finishes loading (anim-file-input change handler)
  //   - on record start / stop transitions inside this module

  function updateMocapUI(state: MocapState): void {
    clearInterval(framesTimer);
    const mocap = getMocap();
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
      mocap?.setCanvas(null);
      updateAnimUI();
      return;
    }

    if (state === 'off') {
      const hasFrozenFrame = !!mocap?.latestFrame;
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
      mocap?.setCanvas(null);
      // Auto-stop debug recorder when file processing completes
      if (dbgRecorder.active) dbgRecorder.stop();
    } else if (state === 'live') {
      statusLbl.textContent      = '📷 Live preview';
      primaryBtn.textContent     = '⏺ Record';
      stopCamBtn.style.display   = 'block';
      playRow.style.display      = 'flex';
      previewPanel.style.display = 'block';
      mocap?.setCanvas(previewCvs);
    } else if (state === 'recording') {
      const isFile = (mocap?.duration ?? 0) > 0;
      statusLbl.textContent      = isFile ? '🎬 Processing video…' : '📷 Recording…';
      primaryBtn.textContent     = isFile ? '⏹ Cancel' : '⏹ Stop';
      primaryBtn.classList.add('recording');
      stopCamBtn.style.display   = 'none';
      playRow.style.display      = 'flex';
      previewPanel.style.display = 'block';
      mocap?.setCanvas(previewCvs);
      framesTimer = rememberInterval(() => {
        const m = getMocap();
        if (!m) return;
        const dur = m.duration;
        framesLbl.textContent = dur > 0
          ? `${m.currentTime.toFixed(1)}s / ${dur.toFixed(1)}s`
          : `${m.recordingFrameCount} frames`;
      }, 200);
    }
  }

  async function handlePrimaryClick(): Promise<void> {
    const mocap = getMocap();
    if (!mocap) return;

    if (mocap.state === 'recording') {
      // Both camera-recording and file-processing exit through this branch.
      const isFile = mocap.duration > 0;
      if (isFile) mocap.stop();
      else        mocap.stopRecording();
      return;
    }

    if (currentSource === 'camera') {
      if (mocap.state === 'off') {
        primaryBtn.textContent = '…';
        primaryBtn.disabled = true;
        try { await mocap.startLive(); }
        catch { statusLbl.textContent = '❌ Camera error'; }
        finally { primaryBtn.disabled = false; }
      } else if (mocap.state === 'live') {
        mocap.startRecording();
      }
    } else if (currentSource === 'video') {
      if (mocap.state === 'off') fileInput.click();
    } else {
      // Anim file source has three states (see updateAnimUI):
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
  }

  primaryBtn.addEventListener('click', () => { void handlePrimaryClick(); });

  stopCamBtn.addEventListener('click', () => {
    const mocap = getMocap();
    if (!mocap) return;
    if (mocap.state === 'recording') mocap.stopRecording();
    mocap.stop();
  });

  // ── Source segmented control ─────────────────────────────────────────────────

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
      const mocap = getMocap();
      // Stop any active mocap session before switching — anim-file source
      // doesn't run mocap, so leaving it active would be misleading.
      if (mocap && mocap.state !== 'off') {
        if (mocap.state === 'recording') mocap.stopRecording();
        mocap.stop();
      }
      currentSource = next;
      try { localStorage.setItem(SOURCE_KEY, currentSource); } catch { /* quota */ }
      paintSourceBtns();
      updateMocapUI(getMocap()?.state ?? 'off');
    });
  }

  // ── Anim file input (.bvh / .vrma / .fbx) ──────────────────────────────────

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

  // ── File video input ─────────────────────────────────────────────────────────

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // reset so same file can be re-selected
    if (!file) return;
    const mocap = getMocap();
    if (!mocap || mocap.state !== 'off') return;
    // Auto-start debug recorder for full file capture (no frame cap)
    dbgRecorder.start(Infinity);
    try {
      await mocap.startFromFile(file);
    } catch (e) {
      dbgRecorder.stop(); // cleanup if file failed to load
      const msg = (e instanceof Error ? e.message : String(e)) || 'unknown error';
      statusLbl.textContent = `❌ ${msg.slice(0, 28)}`;
    }
  });

  // ── Pose model quality ───────────────────────────────────────────────────────

  root.querySelectorAll<HTMLButtonElement>('.dbg-toggle[data-quality]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mocap = getMocap();
      if (!mocap || mocap.state !== 'off') return; // must be idle to switch
      const q = btn.dataset.quality as 'lite' | 'full' | 'heavy';
      btn.textContent = '…';
      btn.disabled = true;
      try {
        await mocap.setPoseQuality(q);
      } finally {
        btn.disabled = false;
      }
      // visual state
      root.querySelectorAll<HTMLButtonElement>('.dbg-toggle[data-quality]').forEach((b) => {
        const active = b.dataset.quality === q;
        b.textContent = b.dataset.quality!;
        b.classList.toggle('off', !active);
      });
    });
  });

  // ── Mirror toggle ────────────────────────────────────────────────────────────

  const mirrorBtn = root.querySelector<HTMLButtonElement>('#mocap-mirror-btn')!;
  mirrorBtn.addEventListener('click', () => {
    const mocap = getMocap();
    if (!mocap) return;
    const next = !mocap.mirrorX;
    mocap.setMirrorX(next);
    mirrorBtn.textContent = next ? 'ON' : 'OFF';
    mirrorBtn.classList.toggle('off', !next);
  });

  // ── Face tracking toggle ─────────────────────────────────────────────────────

  const faceBtn = root.querySelector<HTMLButtonElement>('#mocap-face-btn')!;
  faceBtn.addEventListener('click', () => {
    const mocap = getMocap();
    if (!mocap) return;
    const next = !mocap.faceTrackingEnabled;
    mocap.setFaceTrackingEnabled(next);
    faceBtn.textContent = next ? 'ON' : 'OFF';
    faceBtn.classList.toggle('off', !next);
  });

  // ── Hip position toggle ──────────────────────────────────────────────────────

  const hipBtn = root.querySelector<HTMLButtonElement>('#mocap-hip-btn')!;
  hipBtn.addEventListener('click', () => {
    const mocap = getMocap();
    if (!mocap) return;
    const next = !mocap.hipPositionEnabled;
    mocap.setHipPositionEnabled(next);
    hipBtn.textContent = next ? 'ON' : 'OFF';
    hipBtn.classList.toggle('off', !next);
  });

  // ── Hand priority checkbox ──────────────────────────────────────────────────

  const handPrioBox = root.querySelector<HTMLInputElement>('#mocap-handprio-box')!;
  handPrioBox.checked = getMocap()?.handTrackingPriorityEnabled ?? true;
  handPrioBox.addEventListener('change', () => {
    const mocap = getMocap();
    if (!mocap) {
      handPrioBox.checked = true;
      return;
    }
    mocap.setHandTrackingPriorityEnabled(handPrioBox.checked);
  });

  // ── Shoulder spread slider (in tuning panel) ───────────────────────────────

  const spreadSlider = document.querySelector<HTMLInputElement>('#mocap-spread-slider')!;
  const spreadVal    = document.querySelector<HTMLElement>('#mocap-spread-val')!;
  spreadSlider.addEventListener('input', () => {
    const v = parseFloat(spreadSlider.value);
    spreadVal.textContent = `${v}°`;
    getMocap()?.setShoulderSpread(v);
  });

  // ── Debug skeleton + visibility stats ───────────────────────────────────────

  const dbgSkelBtn  = root.querySelector<HTMLButtonElement>('#mocap-dbgskel-btn')!;
  const visStatsEl  = root.querySelector<HTMLElement>('#mocap-vis-stats')!;

  // Build a grid of per-landmark visibility badges
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

  const scalarStatsEl = root.querySelector<HTMLElement>('#mocap-scalar-stats')!;

  let dbgSkelOn = false;
  let fps = 0;
  dbgSkelBtn.addEventListener('click', () => {
    dbgSkelOn = !dbgSkelOn;
    mocapDebugViz.setVisible(dbgSkelOn);
    dbgSkelBtn.textContent = dbgSkelOn ? 'ON' : 'OFF';
    dbgSkelBtn.classList.toggle('off', !dbgSkelOn);
    visStatsEl.style.display = dbgSkelOn ? 'grid' : 'none';
    scalarStatsEl.style.display = dbgSkelOn ? 'block' : 'none';
  });

  // Approximate detector fps by counting latestFrame identity changes.
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

  // ── Hip force readout ─────────────────────────────────────────────────────
  // Per-frame the tracker updates `latest`; we sample it at 10 Hz into the
  // panel — a faster cadence is unreadable to humans and just churns DOM.
  // Lazy: only update when the fold is open.
  const foldHipForce = document.getElementById('fold-hipforce') as HTMLDetailsElement | null;
  const hipForceEls = {
    mass:  document.getElementById('dbg-hipforce-mass'),
    total: document.getElementById('dbg-hipforce-total'),
    grav:  document.getElementById('dbg-hipforce-grav'),
    inert: document.getElementById('dbg-hipforce-inert'),
    tilt:  document.getElementById('dbg-hipforce-tilt'),
    gtilt: document.getElementById('dbg-hipforce-gtilt'),
    angles: document.getElementById('dbg-hipbal-angles'),
  };
  // Balance-corrector toggle button. State mirrors hipBalance.enabled. Reset
  // is automatic on disable (handled inside the corrector); on re-enable we
  // start fresh with no carry-over angles.
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
      if (hipForceEls.total) hipForceEls.total.textContent = '|F_total|: —';
      return;
    }
    if (hipForceEls.mass) hipForceEls.mass.textContent = `tracked mass: ${r.totalMass.toFixed(1)} kg`;
    const fmtN = (v: number): string => `${v.toFixed(1)} N`;
    if (!r.ready) {
      // Gravity is valid even before warmup; inertia/total need velocity history.
      if (hipForceEls.total) hipForceEls.total.textContent = '|F_total|: warming up…';
      if (hipForceEls.grav)  hipForceEls.grav.textContent  = `|F_grav|:  ${fmtN(r.gravityWorld.length())}`;
      if (hipForceEls.inert) hipForceEls.inert.textContent = '|F_inert|: —';
      if (hipForceEls.tilt)  hipForceEls.tilt.textContent  = 'tilt vs Y_hip: —';
      return;
    }
    if (hipForceEls.total) hipForceEls.total.textContent = `|F_total|: ${fmtN(r.totalWorld.length())}`;
    if (hipForceEls.grav)  hipForceEls.grav.textContent  = `|F_grav|:  ${fmtN(r.gravityWorld.length())}`;
    if (hipForceEls.inert) hipForceEls.inert.textContent = `|F_inert|: ${fmtN(r.inertiaWorld.length())}`;
    // tilt = angle between F_total and +Y_hip; 0° means force is perfectly
    // aligned with the spine (gravity straight down through a vertical body).
    const local = r.totalInHipSpace;
    const len = local.length();
    if (len < 1e-6) {
      if (hipForceEls.tilt) hipForceEls.tilt.textContent = 'tilt vs Y_hip: —';
    } else {
      const tiltDeg = Math.acos(Math.max(-1, Math.min(1, local.y / len))) * 180 / Math.PI;
      if (hipForceEls.tilt) hipForceEls.tilt.textContent = `tilt vs Y_hip: ${tiltDeg.toFixed(1)}°`;
    }
    // Gravity-only tilt = signal the corrector actually uses. Cleaner number,
    // unaffected by motion-induced inertia. 0° = hip upright.
    const gLocal = r.gravityInHipSpace;
    const gLen = gLocal.length();
    if (gLen < 1e-6) {
      if (hipForceEls.gtilt) hipForceEls.gtilt.textContent = 'gravity tilt: —';
    } else {
      const gTiltDeg = Math.acos(Math.max(-1, Math.min(1, -gLocal.y / gLen))) * 180 / Math.PI;
      if (hipForceEls.gtilt) hipForceEls.gtilt.textContent = `gravity tilt: ${gTiltDeg.toFixed(1)}°`;
    }
    // Balance-corrector applied angles (smoothed, post-clamp). When OFF the
    // values stay at their last applied (or 0 after reset) snapshot.
    if (hipForceEls.angles) {
      if (hipBalance.enabled) {
        const a = hipBalance.latestAnglesDeg;
        hipForceEls.angles.textContent = `corr. angles: X=${a.x.toFixed(1)}°  Z=${a.z.toFixed(1)}°`;
      } else {
        hipForceEls.angles.textContent = 'corr. angles: (off)';
      }
    }
  }, 100);

  // Update all stats every 200ms when debug skeleton is on
  rememberInterval(() => {
    if (!dbgSkelOn) return;
    const m     = getMocap();
    const frame = m?.latestFrame;
    if (!frame) return;

    // Per-landmark visibility badges
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

    // Scalar stats block
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

    // ── Skeleton-fit metrics ──────────────────────────────────────────────
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
    const avLArm = cal.avatarLeftUpperArm  + cal.avatarLeftLowerArm;
    const avRArm = cal.avatarRightUpperArm + cal.avatarRightLowerArm;
    // armScale = avatar / performer → inverse = performer / avatar proportion
    const propL = st.leftArmScale  > 0 ? (1 / st.leftArmScale)  * 100 : 0;
    const propR = st.rightArmScale > 0 ? (1 / st.rightArmScale) * 100 : 0;
    const propBody = st.bodyScale  > 0 ? (1 / st.bodyScale)  * 100 : 0;
    void avLArm; void avRArm;

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
      '<div style="margin-top:6px;opacity:.5;font-size:9px">— input —</div>',
      row('✋ Hands',         handsDetected),
      row('😶 Face pts',      hasFace),
      row('👁 Avg vis',       `${Math.round(avgVis * 100)}%`),
      row('⏱ Detector fps',  fps.toFixed(1)),
      row('📼 BVH rec/grab', `${m.recordingFrameCount}/${m.grabbedFrameCount}`),
      row('▶ State',          m.state),
    ].join('');
  }, 200);

  // ── OneEuroFilter toggle ─────────────────────────────────────────────────────

  const filterBtn = root.querySelector<HTMLButtonElement>('#mocap-filter-btn')!;
  filterBtn.addEventListener('click', () => {
    const mocap = getMocap();
    if (!mocap) return;
    const next = !mocap.filterEnabled;
    mocap.setFilterEnabled(next);
    filterBtn.textContent = next ? 'ON' : 'OFF';
    filterBtn.classList.toggle('off', !next);
  });

  // ── Depth scale (2D / mid / 3D) ──────────────────────────────────────────────

  root.querySelectorAll<HTMLButtonElement>('.dbg-toggle[data-depth]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mocap = getMocap();
      if (!mocap) return;
      const v = parseFloat(btn.dataset.depth!);
      mocap.setDepthScale(v);
      root.querySelectorAll<HTMLButtonElement>('.dbg-toggle[data-depth]').forEach((b) => {
        b.classList.toggle('off', parseFloat(b.dataset.depth!) !== v);
      });
    });
  });

  // ── Playback controls (pause / step / grab / flush) ──────────────────────

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

  // ── Tuning-panel wiring (all elements live in #mocap-tuning-panel) ───────

  const recalBtn  = document.querySelector<HTMLButtonElement>('#mocap-recal-btn')!;
  const calibStat = document.querySelector<HTMLElement>('#mocap-calib-stat')!;
  recalBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    m.recalibrate();
  });

  // ── Hips = shoulders width override ────────────────────────────────────────
  // The straightforward approach (translating leftUpperLeg/rightUpperLeg roots
  // on the normalized rig) DOES NOT WORK on @pixiv/three-vrm: the rendered
  // mesh is skinned to the RAW bone hierarchy whose positions are fixed at
  // load time. Modifying normalized positions widens the IK pivot but the raw
  // upper-legs still pivot from their original (narrower) roots — applying
  // the same rotations from a narrower pivot lands the feet inward of where
  // IK intended, sometimes far enough to visually cross past the centerline.
  //
  // Instead this toggle now drives the same `legSpreadX` knob the slider
  // exposes, with an auto-computed ratio = avatarShoulderWidth / avatarHipWidth.
  // That fans the foot IK targets outward without touching any bone geometry,
  // so the rendered mesh stays consistent with its rest pose.
  {
    const hipEqualBtn = document.querySelector<HTMLButtonElement>('#rig-hip-equal-btn')!;
    const spreadSlider  = document.querySelector<HTMLInputElement>('#mocap-legspread-slider');
    const spreadValEl   = document.querySelector<HTMLElement>('#mocap-legspread-val');
    let active = false;
    let prevSpread: number | null = null;

    const setSpread = (v: number): void => {
      const m = getMocap();
      m?.setLegSpreadX(v);
      // Reflect into the slider/readout so the user can see what the toggle
      // applied and tweak it from there if needed.
      if (spreadSlider) spreadSlider.value = String(Math.max(0.5, Math.min(2, v)));
      if (spreadValEl)  spreadValEl.textContent = v.toFixed(2);
    };

    hipEqualBtn.addEventListener('click', () => {
      const m = getMocap();
      if (!m) return;
      const vrm = m.vrm;
      const sL = vrm.humanoid.getNormalizedBoneNode('leftUpperArm' as any);
      const sR = vrm.humanoid.getNormalizedBoneNode('rightUpperArm' as any);
      if (!sL || !sR) {
        const missing = [!sL && 'leftUpperArm', !sR && 'rightUpperArm'].filter(Boolean).join(', ');
        console.warn(`[hip-equal] missing humanoid bone(s): ${missing}`);
        hipEqualBtn.title = `Disabled — VRM missing: ${missing}`;
        hipEqualBtn.disabled = true;
        return;
      }

      active = !active;
      if (active) {
        // Compensate for performer↔avatar hip-width mismatch. The leg solver
        // computes target.x as `avatarHipRoot.x + (performerAnkle.x -
        // performerHip.x) * legScale * legSpreadX`. legScale is a *length*
        // ratio, so the X-offset is carried over in absolute MediaPipe metres.
        // If performer's hip half-width is bigger than the avatar's, even a
        // narrow performer stance overshoots the avatar's leg root past the
        // centerline → legs cross. Scaling the offset by the hip-width ratio
        // preserves "foot displacement relative to hip width" between rigs:
        // performer narrow → avatar narrow on its own scale, never crossed.
        const cal = m.calibration as any;
        const performerHipWidth = cal.performerHipWidth as number;
        const avatarHipWidth    = m.calibration.avatarHipWidth;
        if (performerHipWidth < 1e-4 || avatarHipWidth < 1e-4) {
          console.warn('[hip-equal] hip width measurement unavailable; skipping');
          active = false;
          return;
        }
        const ratio = avatarHipWidth / performerHipWidth;
        prevSpread = m.legSpreadX;
        setSpread(ratio);
      } else if (prevSpread != null) {
        setSpread(prevSpread);
        prevSpread = null;
      }

      hipEqualBtn.textContent = active ? 'ON' : 'OFF';
      hipEqualBtn.classList.toggle('off', !active);
    });

    // ── Hip / leg diagnostics modal ──────────────────────────────────────────
    const diagBtn       = document.querySelector<HTMLButtonElement>('#hip-diag-btn')!;
    const diagOverlay   = document.getElementById('hip-diag-modal-overlay')!;
    const diagBody      = document.getElementById('hip-diag-modal-body')!;
    const diagCopyBtn   = document.getElementById('hip-diag-modal-copy')!;
    const diagRefreshBtn = document.getElementById('hip-diag-modal-refresh')!;
    const diagCloseBtn  = document.getElementById('hip-diag-modal-close')!;

    const r3 = (n: number): number => Math.round(n * 1000) / 1000;
    const vec3 = (v: THREE.Vector3): { x: number; y: number; z: number } => ({ x: r3(v.x), y: r3(v.y), z: r3(v.z) });
    const lm = (l: { x: number; y: number; z: number; visibility?: number } | undefined) =>
      l ? { x: r3(l.x), y: r3(l.y), z: r3(l.z), vis: l.visibility != null ? r3(l.visibility) : undefined } : null;

    const buildDiag = (): string => {
      const m = getMocap();
      if (!m) return '(mocap not initialised)';
      const vrm = m.vrm;
      const get = (n: string) => vrm.humanoid.getNormalizedBoneNode(n as any);
      const getRaw = (n: string) => vrm.humanoid.getRawBoneNode(n as any);
      vrm.scene.updateMatrixWorld(true);

      const boneRow = (name: string) => {
        const norm = get(name);
        const raw = getRaw(name);
        if (!norm) return { name, missing: true };
        const wp = norm.getWorldPosition(new THREE.Vector3());
        return {
          name,
          parent: norm.parent?.name || '(none)',
          localPos: vec3(norm.position),
          localQuat: { x: r3(norm.quaternion.x), y: r3(norm.quaternion.y), z: r3(norm.quaternion.z), w: r3(norm.quaternion.w) },
          worldPos: vec3(wp),
          rawSameAsNorm: raw === norm,
          rawWorldPos: raw && raw !== norm ? vec3(raw.getWorldPosition(new THREE.Vector3())) : null,
        };
      };

      const cal = m.calibration as any;
      const frame = m.latestFrame;
      const dt = m.debugTargets as any;

      const data = {
        timestamp: new Date().toISOString(),
        rig: {
          leftUpperLeg:   boneRow('leftUpperLeg'),
          rightUpperLeg:  boneRow('rightUpperLeg'),
          leftLowerLeg:   boneRow('leftLowerLeg'),
          rightLowerLeg:  boneRow('rightLowerLeg'),
          leftFoot:       boneRow('leftFoot'),
          rightFoot:      boneRow('rightFoot'),
          leftUpperArm:   boneRow('leftUpperArm'),
          rightUpperArm:  boneRow('rightUpperArm'),
          hips:           boneRow('hips'),
          spine:          boneRow('spine'),
          chest:          boneRow('chest'),
          upperChest:     boneRow('upperChest'),
        },
        hipsEqualsShoulders: {
          buttonState: hipEqualBtn.textContent,
          prevSpreadBeforeToggle: prevSpread,
        },
        calibration: {
          calibrated:           cal._calibrated ?? null,
          avatarHipWidth:       r3(cal.avatarHipWidth ?? NaN),
          avatarLeftUpperArm:   r3(cal.avatarLeftUpperArm ?? NaN),
          avatarLeftUpperLeg:   r3(cal.avatarLeftUpperLeg ?? NaN),
          avatarLeftLowerLeg:   r3(cal.avatarLeftLowerLeg ?? NaN),
          avatarRightUpperLeg:  r3(cal.avatarRightUpperLeg ?? NaN),
          avatarRightLowerLeg:  r3(cal.avatarRightLowerLeg ?? NaN),
          performerHipWidth:    r3(cal.performerHipWidth ?? NaN),
          performerShoulderWidth: r3(cal.performerShoulderWidth ?? NaN),
          performerLegLen:      r3(cal.performerLegLen ?? NaN),
          bodyScale:             r3(m.calibration.bodyScale()),
          legScale:              r3(m.calibration.legScale()),
          armScaleL:             r3(m.calibration.armScale('left')),
          armScaleR:             r3(m.calibration.armScale('right')),
          scaleRef:              m.calibration.scaleRef,
          hipVisGate:            r3(m.calibration.hipVisGate),
          readiness:             m.calibration.readiness(),
        },
        applier: {
          mirrorX:        (m as any).applier?._mirrorX ?? null,
          legSpreadX:     r3(m.legSpreadX),
          shoulderSpread: r3(m.shoulderSpread),
        },
        latestFrame: frame ? {
          // MediaPipe BlazePose landmark indices: 23=LH, 24=RH, 25=LK, 26=RK, 27=LA, 28=RA
          // Note: MediaPipe is camera-side ("their LEFT is on viewer's RIGHT") — we mirror in mpDeltaToVrm.
          worldLandmarks: {
            leftHip:    lm(frame.worldLandmarks[23]),
            rightHip:   lm(frame.worldLandmarks[24]),
            leftKnee:   lm(frame.worldLandmarks[25]),
            rightKnee:  lm(frame.worldLandmarks[26]),
            leftAnkle:  lm(frame.worldLandmarks[27]),
            rightAnkle: lm(frame.worldLandmarks[28]),
            leftShoulder:  lm(frame.worldLandmarks[11]),
            rightShoulder: lm(frame.worldLandmarks[12]),
          },
          normLandmarks: {
            leftHip:    lm(frame.landmarks[23]),
            rightHip:   lm(frame.landmarks[24]),
            leftAnkle:  lm(frame.landmarks[27]),
            rightAnkle: lm(frame.landmarks[28]),
          },
        } : null,
        ikDebugTargets: {
          leftFootTarget:  dt?.leftFootTarget  ? vec3(dt.leftFootTarget)  : null,
          rightFootTarget: dt?.rightFootTarget ? vec3(dt.rightFootTarget) : null,
          leftKneeTarget:  dt?.leftKneeTarget  ? vec3(dt.leftKneeTarget)  : null,
          rightKneeTarget: dt?.rightKneeTarget ? vec3(dt.rightKneeTarget) : null,
          leftFootLocked:  dt?.leftFootLocked  ?? null,
          rightFootLocked: dt?.rightFootLocked ?? null,
        },
      };

      return JSON.stringify(data, null, 2);
    };

    const refreshDiag = (): void => { diagBody.textContent = buildDiag(); };
    diagBtn.addEventListener('click', () => {
      refreshDiag();
      diagOverlay.style.display = 'flex';
    });
    diagRefreshBtn.addEventListener('click', refreshDiag);
    diagCloseBtn.addEventListener('click', () => { diagOverlay.style.display = 'none'; });
    diagOverlay.addEventListener('click', (e) => {
      if (e.target === diagOverlay) diagOverlay.style.display = 'none';
    });
    let diagCopyResetId = 0;
    diagCopyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(diagBody.textContent ?? '').then(() => {
        diagCopyBtn.textContent = '✓ copied!';
        diagCopyBtn.classList.add('copied');
        clearTimeout(diagCopyResetId);
        diagCopyResetId = rememberTimeout(() => {
          diagCopyBtn.textContent = '📋 copy';
          diagCopyBtn.classList.remove('copied');
        }, 2000);
      });
    });
  }

  // Dump skeleton button — also exposed as window.dumpSkeleton() for console use.
  {
    const btn = document.querySelector<HTMLButtonElement>('#cal-dump-btn');
    const doDump = (): void => {
      const m = getMocap();
      if (!m) { console.warn('[mocap] not initialised'); return; }
      m.dumpSkeleton();
    };
    btn?.addEventListener('click', doDump);
    (window as any).dumpSkeleton = doDump;
  }

  // Calibration readiness indicator — small progress bars per metric.
  const readinessEl = document.querySelector<HTMLElement>('#cal-readiness')!;
  const readinessRows: Array<{ key: string; label: string; fill: HTMLElement; value: HTMLElement }> = [];
  {
    const rows: [string, string][] = [
      ['shoulders', '📐 Shoulders'],
      ['hips',      '🦴 Hips'],
      ['armL',      '🦾 Arm L'],
      ['armR',      '🦾 Arm R'],
      ['legs',      '🦵 Legs'],
    ];
    for (const [key, label] of rows) {
      const row = document.createElement('div');
      row.className = 'cal-r-row';
      row.innerHTML = `
        <span class="cal-r-label">${label}</span>
        <div class="cal-r-bar"><div class="cal-r-fill" style="width:0%"></div></div>
        <span class="cal-r-value">0%</span>
      `;
      readinessEl.appendChild(row);
      readinessRows.push({
        key, label,
        fill:  row.querySelector<HTMLElement>('.cal-r-fill')!,
        value: row.querySelector<HTMLElement>('.cal-r-value')!,
      });
    }
  }
  rememberInterval(() => {
    const m = getMocap();
    if (!m) return;
    const r = m.calibration.readiness() as Record<string, number>;
    for (const row of readinessRows) {
      const v = r[row.key] ?? 0;
      const pct = Math.round(v * 100);
      row.fill.style.width = `${pct}%`;
      row.value.textContent = `${pct}%`;
      row.fill.classList.toggle('ready',   v >= 0.9);
      row.fill.classList.toggle('partial', v >= 0.2 && v < 0.9);
    }
  }, 200);

  // Unify arm max toggle
  const unifyBtn = document.querySelector<HTMLButtonElement>('#cal-unify-btn')!;
  unifyBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    const next = !m.calibration.unifyArmMax;
    m.calibration.setUnifyArmMax(next);
    unifyBtn.textContent = next ? 'ON' : 'OFF';
    unifyBtn.classList.toggle('off', !next);
  });

  // ── Calibration override sliders ─────────────────────────────────────────

  const wireSlider = (
    sliderId: string,
    valueId: string,
    kind: 'shoulder' | 'leftArm' | 'rightArm',
  ): void => {
    const slider = document.querySelector<HTMLInputElement>(sliderId)!;
    const valEl  = document.querySelector<HTMLElement>(valueId)!;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valEl.textContent = v.toFixed(2);
      const m = getMocap();
      m?.calibration.setOverride(kind, v);
    });
  };
  wireSlider('#cal-sh-slider', '#cal-sh-val', 'shoulder');
  wireSlider('#cal-la-slider', '#cal-la-val', 'leftArm');
  wireSlider('#cal-ra-slider', '#cal-ra-val', 'rightArm');

  // Scale-ref mode (auto / median / head / shoulders / hips).
  {
    const btns = document.querySelectorAll<HTMLButtonElement>('button[data-ref]');
    btns.forEach((b) => b.addEventListener('click', () => {
      const ref = b.dataset.ref as 'auto' | 'shoulders' | 'hips' | 'head' | 'median';
      getMocap()?.calibration.setScaleRef(ref);
      btns.forEach((x) => x.classList.toggle('off', x.dataset.ref !== ref));
    }));
  }

  // Hip visibility gate — standalone slider (not an override multiplier).
  {
    const s = document.querySelector<HTMLInputElement>('#cal-hipgate-slider')!;
    const v = document.querySelector<HTMLElement>('#cal-hipgate-val')!;
    s.addEventListener('input', () => {
      const val = parseFloat(s.value);
      v.textContent = val.toFixed(2);
      getMocap()?.calibration.setHipVisGate(val);
    });
  }

  const wirePlainSlider = (
    sliderId: string,
    valueId: string,
    decimals: number,
    setter: (m: NonNullable<ReturnType<typeof getMocap>>, v: number) => void,
  ): void => {
    const slider = document.querySelector<HTMLInputElement>(sliderId)!;
    const valEl  = document.querySelector<HTMLElement>(valueId)!;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valEl.textContent = v.toFixed(decimals);
      const m = getMocap();
      if (m) setter(m, v);
    });
  };
  wirePlainSlider('#mocap-spine-slider',  '#mocap-spine-val',  2, (m, v) => m.setSpineSmoothing(v));
  wirePlainSlider('#mocap-smooth-slider', '#mocap-smooth-val', 2, (m, v) => m.setBodySmoothing(v));
  wirePlainSlider('#mocap-armz-slider',   '#mocap-armz-val',   2, (m, v) => m.setArmZAttenuation(v));
  wirePlainSlider('#mocap-pole-slider',   '#mocap-pole-val',   2, (m, v) => m.setPoleSmoothing(v));
  wirePlainSlider('#mocap-polez-slider',  '#mocap-polez-val',  2, (m, v) => m.setArmPoleZ(v));
  wirePlainSlider('#mocap-vis-slider',    '#mocap-vis-val',    2, (m, v) => m.setVisibilityThreshold(v));
  wirePlainSlider('#mocap-legspread-slider', '#mocap-legspread-val', 2, (m, v) => m.setLegSpreadX(v));

  const resetSliders = document.querySelector<HTMLButtonElement>('#cal-reset-btn')!;
  resetSliders.addEventListener('click', () => {
    const trios: [string, string, 'shoulder'|'leftArm'|'rightArm'][] = [
      ['#cal-sh-slider', '#cal-sh-val', 'shoulder'],
      ['#cal-la-slider', '#cal-la-val', 'leftArm'],
      ['#cal-ra-slider', '#cal-ra-val', 'rightArm'],
    ];
    for (const [sId, vId, kind] of trios) {
      const s = document.querySelector<HTMLInputElement>(sId)!;
      const v = document.querySelector<HTMLElement>(vId)!;
      s.value = '1';
      v.textContent = '1.00';
      getMocap()?.calibration.setOverride(kind, 1);
    }
    // Reset leg spread too — sits next to the calibration multipliers in the
    // UI and resets feel like one logical action.
    const ls = document.querySelector<HTMLInputElement>('#mocap-legspread-slider');
    const lv = document.querySelector<HTMLElement>('#mocap-legspread-val');
    if (ls && lv) {
      ls.value = '1';
      lv.textContent = '1.00';
      getMocap()?.setLegSpreadX(1);
    }
  });

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
    clearInterval(framesTimer);
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
