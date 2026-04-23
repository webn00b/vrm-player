import type { MocapState } from './mocap/mocapController';
import { STAT_LANDMARKS } from './mocap/mocapDebugViz';
import { buildMainPanelHtml, buildTuningPanelHtml } from './debugPanelHtml';
import { mountSkelModal } from './debugPanelSkelModal';
import type { PlaybackSystems, MocapSystems, ToolingSystems } from './playerSystems';

export function mountDebugPanel(
  playback: PlaybackSystems,
  mocapSys: MocapSystems,
  tooling: ToolingSystems,
  setModelVisible: (v: boolean) => void,
): () => void {
  const { pa, micro, idle, controller } = playback;
  const { mocap, debugViz: mocapDebugViz, dbgRecorder } = mocapSys;
  const { skelViz, validator } = tooling;
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
    idle: true, breathing: true, headSway: true,
    eyeSaccades: true, blink: true, weightShift: true,
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

  const camBtn      = root.querySelector<HTMLButtonElement>('#mocap-cam-btn')!;
  const recBtn      = root.querySelector<HTMLButtonElement>('#mocap-rec-btn')!;
  const recRow      = root.querySelector<HTMLElement>('#mocap-rec-row')!;
  const playRow     = root.querySelector<HTMLElement>('#mocap-playback-row')!;
  const pauseBtn    = root.querySelector<HTMLButtonElement>('#mocap-pause-btn')!;
  const stepBackBtn = root.querySelector<HTMLButtonElement>('#mocap-step-back-btn')!;
  const stepFwdBtn  = root.querySelector<HTMLButtonElement>('#mocap-step-fwd-btn')!;
  const grabBtn     = root.querySelector<HTMLButtonElement>('#mocap-grab-btn')!;
  const flushBtn    = root.querySelector<HTMLButtonElement>('#mocap-flush-btn')!;
  const exportPoseBtn = root.querySelector<HTMLButtonElement>('#mocap-export-pose-btn')!;
  const statusLbl   = root.querySelector<HTMLElement>('#mocap-status-label')!;
  const framesLbl   = root.querySelector<HTMLElement>('#mocap-frames')!;
  const previewPanel = document.getElementById('mocap-preview-panel')!;
  const previewCvs   = document.getElementById('mocap-canvas') as HTMLCanvasElement;
  const fileInput    = root.querySelector<HTMLInputElement>('#mocap-file-input')!;
  const fileLabel    = root.querySelector<HTMLElement>('#mocap-file-label')!;

  // Set canvas intrinsic resolution (4:3 at 2× panel width for sharpness)
  previewCvs.width  = 440;
  previewCvs.height = 330;

  let framesTimer = 0;

  function updateMocapUI(state: MocapState): void {
    clearInterval(framesTimer);
    const mocap = getMocap();
    if (state === 'off') {
      const hasFrozenFrame = !!mocap?.latestFrame;
      statusLbl.textContent     = hasFrozenFrame ? '📷 Camera off (last frame)' : '📷 Camera off';
      camBtn.textContent        = 'Start';
      camBtn.classList.add('off');
      camBtn.disabled           = false;
      fileLabel.classList.add('off');
      recRow.style.display      = 'none';
      playRow.style.display     = 'none';
      previewPanel.style.display  = hasFrozenFrame ? 'block' : 'none';
      mocap?.setCanvas(null);
      // Auto-stop debug recorder when file processing completes
      if (dbgRecorder.active) dbgRecorder.stop();
    } else if (state === 'live') {
      statusLbl.textContent     = '📷 Live';
      camBtn.textContent        = 'Stop';
      camBtn.classList.remove('off');
      fileLabel.classList.add('off');
      recRow.style.display      = 'flex';
      playRow.style.display     = 'flex';
      recBtn.textContent        = '⏺ Rec';
      recBtn.classList.remove('off');
      previewPanel.style.display  = 'block';
      mocap?.setCanvas(previewCvs);
    } else if (state === 'recording') {
      const isFile = (mocap?.duration ?? 0) > 0;
      statusLbl.textContent     = isFile ? '🎬 Processing…' : '📷 Recording…';
      recBtn.textContent        = '⏹ Stop';
      recBtn.classList.add('off');
      camBtn.disabled           = isFile; // disable Stop during file processing
      fileLabel.classList.add('off');
      playRow.style.display     = 'flex';
      previewPanel.style.display  = 'block';
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

  camBtn.addEventListener('click', async () => {
    const mocap = getMocap();
    if (!mocap) return;
    if (mocap.state === 'off') {
      camBtn.textContent = '…';
      camBtn.disabled    = true;
      try {
        await mocap.startLive();
      } catch (e) {
        camBtn.disabled   = false;
        statusLbl.textContent = '❌ Camera error';
      }
      camBtn.disabled = false;
    } else {
      if (mocap.state === 'recording') mocap.stopRecording();
      mocap.stop();
    }
  });

  recBtn.addEventListener('click', () => {
    const mocap = getMocap();
    if (!mocap) return;
    if (mocap.state === 'live')      mocap.startRecording();
    else if (mocap.state === 'recording') mocap.stopRecording();
  });

  // ── File video input ─────────────────────────────────────────────────────────

  fileLabel.addEventListener('click', () => fileInput.click());

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

  // ── Validation (ROM) ──────────────────────────────────────────────────────

  const valToggle = root.querySelector<HTMLButtonElement>('#val-toggle')!;
  const valStat   = root.querySelector<HTMLElement>('#val-stat')!;
  const valWorst  = root.querySelector<HTMLElement>('#val-worst')!;
  const valDump   = root.querySelector<HTMLButtonElement>('#val-dump')!;

  valToggle.addEventListener('click', () => {
    const on = !validator.enabled;
    validator.setEnabled(on);
    valToggle.textContent = on ? 'ON' : 'OFF';
    valToggle.classList.toggle('off', !on);
  });

  valDump.addEventListener('click', () => {
    console.log('[validator] default bone constraints:', validator.getConstraints());
  });

  rememberInterval(() => {
    const s = validator.getStats();
    valStat.textContent = `clamped/frame: ${s.clampedThisFrame}`;
    if (s.worstBone) {
      const deg = (s.worstDelta * 180 / Math.PI).toFixed(1);
      valWorst.textContent = `worst: ${s.worstBone} +${deg}°`;
    } else {
      valWorst.textContent = 'worst: —';
    }
  }, 200);

  // ── Skeleton toggles ──────────────────────────────────────────────────────

  const modelToggle = root.querySelector<HTMLButtonElement>('#model-toggle')!;
  const skelToggle  = root.querySelector<HTMLButtonElement>('#skel-toggle')!;
  const skelBody    = root.querySelector<HTMLButtonElement>('#skel-body')!;
  const skelFingers = root.querySelector<HTMLButtonElement>('#skel-fingers')!;
  const skelOptions = root.querySelector<HTMLElement>('#skel-options')!;

  // Default debug view: skeleton on, avatar mesh opt-in via the model toggle.
  setModelVisible(false);
  skelViz.setVisible(true);

  modelToggle.addEventListener('click', () => {
    const on = modelToggle.textContent === 'OFF';
    setModelVisible(on);
    modelToggle.textContent = on ? 'ON' : 'OFF';
    modelToggle.classList.toggle('off', !on);
  });

  skelToggle.addEventListener('click', () => {
    const on = !skelViz.visible;
    skelViz.setVisible(on);
    skelToggle.textContent = on ? 'ON' : 'OFF';
    skelToggle.classList.toggle('off', !on);
    skelOptions.style.display = on ? 'flex' : 'none';
  });

  skelBody.addEventListener('click', () => {
    const on = !skelViz.showBody;
    skelViz.setShowBody(on);
    skelBody.textContent = on ? 'ON' : 'OFF';
    skelBody.classList.toggle('off', !on);
  });

  skelFingers.addEventListener('click', () => {
    const on = !skelViz.showFingers;
    skelViz.setShowFingers(on);
    skelFingers.textContent = on ? 'ON' : 'OFF';
    skelFingers.classList.toggle('off', !on);
  });

  // ── Debug recorder ────────────────────────────────────────────────────────

  const dbgRecBtn    = root.querySelector<HTMLButtonElement>('#dbgrec-btn')!;
  const dbgRecFrames = root.querySelector<HTMLElement>('#dbgrec-frames')!;

  dbgRecBtn.addEventListener('click', () => {
    if (dbgRecorder.active) {
      dbgRecorder.stop();
      dbgRecBtn.textContent = '⏺ Rec';
      dbgRecBtn.classList.add('off');
    } else {
      dbgRecorder.start();
      dbgRecBtn.textContent = '⏹ Stop';
      dbgRecBtn.classList.remove('off');
    }
  });

  // Update frame counter while recording
  rememberInterval(() => {
    if (dbgRecorder.active) {
      dbgRecFrames.textContent = `${dbgRecorder.frameCount}fr`;
    } else {
      dbgRecFrames.textContent = dbgRecorder.frameCount > 0
        ? `${dbgRecorder.frameCount}fr saved`
        : '';
    }
  }, 200);

  // ── Skeleton info modal ───────────────────────────────────────────────────

  const cleanupSkelModal = mountSkelModal({
    getMocap,
    validator,
    signal: listenerAbort.signal,
    rememberInterval,
    rememberTimeout,
  });


  return () => {
    clearInterval(framesTimer);
    cleanupSkelModal();
    for (const id of intervalIds) clearInterval(id);
    for (const id of timeoutIds) clearTimeout(id);
    listenerAbort.abort();
    if ((window as any).dumpSkeleton) delete (window as any).dumpSkeleton;
    root.innerHTML = '';
  };
}
