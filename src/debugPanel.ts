import type { MicroAnimations } from './microAnimations';
import type { IdleLoop } from './idleLoop';
import type { PriorityAnimator } from './priorityAnimator';
import type { AnimationController } from './animationController';
import type { MocapController, MocapState } from './mocap/mocapController';
import type { SkeletonVisualizer } from './skeletonVisualizer';
import type { BoneValidator } from './validation/boneValidator';
import type { MocapDebugViz } from './mocap/mocapDebugViz';
import { STAT_LANDMARKS } from './mocap/mocapDebugViz';
import type { MocapDebugRecorder } from './mocap/mocapDebugRecorder';

export function mountDebugPanel(
  micro: MicroAnimations,
  idle: IdleLoop,
  pa: PriorityAnimator,
  getController: () => AnimationController | null,
  getMocap: () => MocapController | null,
  skelViz: SkeletonVisualizer,
  validator: BoneValidator,
  mocapDebugViz: MocapDebugViz,
  dbgRecorder: MocapDebugRecorder,
  setModelVisible: (v: boolean) => void,
): void {
  const root = document.getElementById('debug-panel');
  if (!root) return;

  root.innerHTML = `
    <div class="dbg-tabs">
      <button class="dbg-tab active" data-tab="main">Main</button>
      <button class="dbg-tab"        data-tab="video">Video</button>
    </div>

    <div class="dbg-tab-panel active" data-panel="main">
    <h2>Layers</h2>

    <div class="dbg-section">
      <div class="dbg-row">
        <span class="dbg-label" style="font-weight:600">🎭 Demo mode</span>
        <button class="dbg-toggle" id="dbg-demo">OFF</button>
      </div>
      <div class="dbg-hint" id="dbg-hint">Mutes BVH — shows idle priority blending</div>
    </div>

    <div class="dbg-divider"></div>

    <div class="dbg-section">
      <div class="dbg-row">
        <span class="dbg-label">💃 Idle poses</span>
        <button class="dbg-toggle" data-key="idle">ON</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🫁 Breathing</span>
        <button class="dbg-toggle" data-key="breathing">ON</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🌊 Head sway</span>
        <button class="dbg-toggle" data-key="headSway">ON</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">👁 Eye saccades</span>
        <button class="dbg-toggle" data-key="eyeSaccades">ON</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">😑 Blink</span>
        <button class="dbg-toggle" data-key="blink">ON</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">⚖️ Weight shift</span>
        <button class="dbg-toggle" data-key="weightShift">ON</button>
      </div>
    </div>

    <div class="dbg-divider"></div>

    <h2>Priority levels</h2>
    <div class="dbg-levels">
      <div class="dbg-level-row">
        <span class="dbg-lv-label">Lv 1 – lower body</span>
        <div class="dbg-bar-wrap"><div class="dbg-bar" id="dbg-bar-1"></div></div>
      </div>
      <div class="dbg-level-row">
        <span class="dbg-lv-label">Lv 2 – upper body</span>
        <div class="dbg-bar-wrap"><div class="dbg-bar" id="dbg-bar-2"></div></div>
      </div>
      <div class="dbg-level-row">
        <span class="dbg-lv-label">Lv 5+ – gesture</span>
        <div class="dbg-bar-wrap"><div class="dbg-bar" id="dbg-bar-5"></div></div>
      </div>
    </div>
    <div class="dbg-stat" id="dbg-bones">Active bones: 0</div>
    <div class="dbg-stat" id="dbg-clips">Idle clips: ${idle.clipCount}</div>

    <div class="dbg-divider"></div>

    <h2>Validation (ROM)</h2>
    <div class="dbg-section">
      <div class="dbg-row">
        <span class="dbg-label">🦴 Clamp bone rotations</span>
        <button class="dbg-toggle" id="val-toggle">ON</button>
      </div>
      <div class="dbg-stat" id="val-stat">clamped/frame: 0</div>
      <div class="dbg-stat" id="val-worst">worst: —</div>
      <div class="dbg-row">
        <span class="dbg-label" style="opacity:.6;font-size:11px">dump defaults to console</span>
        <button class="dbg-toggle off" id="val-dump">Dump</button>
      </div>
    </div>

    <div class="dbg-divider"></div>

    <h2>Skeleton</h2>
    <div class="dbg-section">
      <div class="dbg-row">
        <span class="dbg-label">👤 Show model</span>
        <button class="dbg-toggle off" id="model-toggle">OFF</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🦴 Show skeleton</span>
        <button class="dbg-toggle" id="skel-toggle">ON</button>
      </div>
      <div class="dbg-row" id="skel-options" style="display:flex">
        <span class="dbg-label" style="opacity:.6;font-size:11px">🩵 Body &nbsp;&nbsp; 💛 Fingers</span>
        <div style="display:flex;gap:4px">
          <button class="dbg-toggle" id="skel-body">ON</button>
          <button class="dbg-toggle" id="skel-fingers">ON</button>
        </div>
      </div>
    </div>

    </div>

    <div class="dbg-tab-panel" data-panel="video">
    <h2>Mocap</h2>
    <div class="dbg-section">
      <div class="dbg-row">
        <span class="dbg-label" id="mocap-status-label">📷 Camera off</span>
        <button class="dbg-toggle off" id="mocap-cam-btn">Start</button>
      </div>
      <div class="dbg-row" id="mocap-rec-row" style="display:none">
        <span class="dbg-label" id="mocap-frames">0 frames</span>
        <button class="dbg-toggle" id="mocap-rec-btn">⏺ Rec</button>
      </div>
      <div class="dbg-row" id="mocap-playback-row" style="display:none;gap:3px">
        <button class="dbg-toggle" id="mocap-pause-btn">⏸</button>
        <button class="dbg-toggle off" id="mocap-step-back-btn" title="Step -1 frame">⏮</button>
        <button class="dbg-toggle off" id="mocap-step-fwd-btn"  title="Step +1 frame">⏭</button>
        <button class="dbg-toggle off" id="mocap-grab-btn"      title="Grab current pose">💾</button>
        <button class="dbg-toggle off" id="mocap-flush-btn"     title="Download captured BVH">⬇</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">📁 From video</span>
        <label class="dbg-toggle off" id="mocap-file-label" style="cursor:pointer">Load</label>
        <input type="file" id="mocap-file-input" accept="video/*" style="display:none">
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🎯 Pose model</span>
        <div style="display:flex;gap:3px">
          <button class="dbg-toggle off" data-quality="lite">lite</button>
          <button class="dbg-toggle"      data-quality="full">full</button>
          <button class="dbg-toggle off" data-quality="heavy">heavy</button>
        </div>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🪞 Mirror mode</span>
        <button class="dbg-toggle" id="mocap-mirror-btn">ON</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">😶 Face tracking</span>
        <button class="dbg-toggle" id="mocap-face-btn">ON</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🚶 Hip position</span>
        <button class="dbg-toggle" id="mocap-hip-btn">ON</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">↔ Shoulder spread <span id="mocap-spread-val">0°</span></span>
        <input type="range" id="mocap-spread-slider" min="-20" max="20" step="1" value="0" style="flex:1;margin-left:8px">
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🌊 1€ smoothing</span>
        <button class="dbg-toggle" id="mocap-filter-btn">ON</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🟢 Performer skeleton</span>
        <button class="dbg-toggle off" id="mocap-dbgskel-btn">OFF</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">📊 Debug record <span id="dbgrec-frames" style="opacity:.5"></span></span>
        <button class="dbg-toggle off" id="dbgrec-btn">⏺ Rec</button>
      </div>
      <div id="mocap-vis-stats" style="display:none;margin-top:4px"></div>
      <div class="dbg-row">
        <span class="dbg-label">📐 Depth</span>
        <div style="display:flex;gap:3px">
          <button class="dbg-toggle off" data-depth="0">2D</button>
          <button class="dbg-toggle"     data-depth="0.5">mid</button>
          <button class="dbg-toggle off" data-depth="1">3D</button>
        </div>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">📏 Calibration</span>
        <div style="display:flex;gap:3px">
          <button class="dbg-toggle off" id="mocap-recal-btn">Recal</button>
          <button class="dbg-toggle off" id="cal-reset-btn" title="Reset sliders to 1.00">Reset</button>
        </div>
      </div>
      <div class="dbg-hint">Auto-scales each frame from hip width — no T-pose needed</div>
      <div class="dbg-stat" id="mocap-calib-stat">—</div>
      <div class="dbg-row">
        <span class="dbg-label">📐 Shoulder × <span id="cal-sh-val">1.00</span></span>
        <input type="range" id="cal-sh-slider" min="0.5" max="2" step="0.05" value="1" style="flex:1;margin-left:8px">
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🦾 L arm × <span id="cal-la-val">1.00</span></span>
        <input type="range" id="cal-la-slider" min="0.5" max="2" step="0.05" value="1" style="flex:1;margin-left:8px">
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🦾 R arm × <span id="cal-ra-val">1.00</span></span>
        <input type="range" id="cal-ra-slider" min="0.5" max="2" step="0.05" value="1" style="flex:1;margin-left:8px">
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🌀 Spine smooth <span id="mocap-spine-val">0.25</span></span>
        <input type="range" id="mocap-spine-slider" min="0.01" max="1" step="0.01" value="0.25" style="flex:1;margin-left:8px">
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🫨 Limb smooth <span id="mocap-smooth-val">0.70</span></span>
        <input type="range" id="mocap-smooth-slider" min="0.01" max="1" step="0.01" value="0.7" style="flex:1;margin-left:8px">
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🫙 Arm Z depth <span id="mocap-armz-val">0.33</span></span>
        <input type="range" id="mocap-armz-slider" min="0" max="1" step="0.01" value="0.33" style="flex:1;margin-left:8px">
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🧲 Pole smooth <span id="mocap-pole-val">0.60</span></span>
        <input type="range" id="mocap-pole-slider" min="0.01" max="1" step="0.01" value="0.6" style="flex:1;margin-left:8px">
      </div>
      <div class="dbg-hint">Recorded BVH auto-replays on the model for comparison</div>
    </div>
    </div>
  `;

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

  setInterval(() => {
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
      statusLbl.textContent     = '📷 Camera off';
      camBtn.textContent        = 'Start';
      camBtn.classList.add('off');
      camBtn.disabled           = false;
      fileLabel.classList.add('off');
      recRow.style.display      = 'none';
      playRow.style.display     = 'none';
      previewPanel.style.display  = 'none';
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
      framesTimer = window.setInterval(() => {
        const m = getMocap();
        if (!m) return;
        const dur = m.duration;
        framesLbl.textContent = dur > 0
          ? `${m.currentTime.toFixed(1)}s / ${dur.toFixed(1)}s`
          : `${m.frameCount} frames`;
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

  // ── Shoulder spread slider ───────────────────────────────────────────────────

  const spreadSlider = root.querySelector<HTMLInputElement>('#mocap-spread-slider')!;
  const spreadVal    = root.querySelector<HTMLElement>('#mocap-spread-val')!;
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

  let dbgSkelOn = false;
  dbgSkelBtn.addEventListener('click', () => {
    dbgSkelOn = !dbgSkelOn;
    mocapDebugViz.setVisible(dbgSkelOn);
    dbgSkelBtn.textContent = dbgSkelOn ? 'ON' : 'OFF';
    dbgSkelBtn.classList.toggle('off', !dbgSkelOn);
    visStatsEl.style.display = dbgSkelOn ? 'grid' : 'none';
  });

  // Update visibility stats every 200ms when debug skeleton is on
  setInterval(() => {
    if (!dbgSkelOn) return;
    const frame = getMocap()?.latestFrame;
    if (!frame) return;
    for (const { idx } of STAT_LANDMARKS) {
      const lm  = frame.landmarks[idx];
      const vis = lm?.visibility ?? null;
      const el  = visBadges.get(idx)!;
      if (vis === null) { el.textContent = '—'; el.style.color = ''; continue; }
      const pct = Math.round(vis * 100);
      el.textContent = `${pct}%`;
      el.style.color = vis >= 0.6 ? '#4ade80' : vis >= 0.3 ? '#fbbf24' : '#f87171';
    }
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
    framesLbl.textContent = `${m.frameCount} frames`;
  });

  flushBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    m.flushGrabbed();
  });

  // ── Recalibrate button ────────────────────────────────────────────────────

  const recalBtn  = root.querySelector<HTMLButtonElement>('#mocap-recal-btn')!;
  const calibStat = root.querySelector<HTMLElement>('#mocap-calib-stat')!;
  recalBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    m.recalibrate();
  });

  // ── Calibration override sliders ─────────────────────────────────────────

  const wireSlider = (
    sliderId: string,
    valueId: string,
    kind: 'shoulder' | 'leftArm' | 'rightArm',
  ): void => {
    const slider = root.querySelector<HTMLInputElement>(sliderId)!;
    const valEl  = root.querySelector<HTMLElement>(valueId)!;
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

  const wirePlainSlider = (
    sliderId: string,
    valueId: string,
    decimals: number,
    setter: (m: NonNullable<ReturnType<typeof getMocap>>, v: number) => void,
  ): void => {
    const slider = root.querySelector<HTMLInputElement>(sliderId)!;
    const valEl  = root.querySelector<HTMLElement>(valueId)!;
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

  const resetSliders = root.querySelector<HTMLButtonElement>('#cal-reset-btn')!;
  resetSliders.addEventListener('click', () => {
    const trios: [string, string, 'shoulder'|'leftArm'|'rightArm'][] = [
      ['#cal-sh-slider', '#cal-sh-val', 'shoulder'],
      ['#cal-la-slider', '#cal-la-val', 'leftArm'],
      ['#cal-ra-slider', '#cal-ra-val', 'rightArm'],
    ];
    for (const [sId, vId, kind] of trios) {
      const s = root.querySelector<HTMLInputElement>(sId)!;
      const v = root.querySelector<HTMLElement>(vId)!;
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

  setInterval(() => {
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

  // Skeleton ON by default
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
  setInterval(() => {
    if (dbgRecorder.active) {
      dbgRecFrames.textContent = `${dbgRecorder.frameCount}fr`;
    } else {
      dbgRecFrames.textContent = dbgRecorder.frameCount > 0
        ? `${dbgRecorder.frameCount}fr saved`
        : '';
    }
  }, 200);
}
