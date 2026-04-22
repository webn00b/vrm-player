import * as THREE from 'three';
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
import type { PoseFrame, Landmark3D } from './mocap/poseDetector';

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
      <div id="mocap-scalar-stats" style="display:none;margin-top:6px;font-size:10px;font-family:ui-monospace,monospace;opacity:.75;line-height:1.5"></div>
      <div class="dbg-row">
        <span class="dbg-label">📐 Depth</span>
        <div style="display:flex;gap:3px">
          <button class="dbg-toggle off" data-depth="0">2D</button>
          <button class="dbg-toggle off" data-depth="0.5">mid</button>
          <button class="dbg-toggle"     data-depth="1">3D</button>
        </div>
      </div>
      <div class="dbg-hint">Detailed tuning sliders are in the panel on the right →</div>
    </div>
    </div>
  `;

  // ── Right-side mocap tuning panel ────────────────────────────────────────
  const tuningRoot = document.getElementById('mocap-tuning-panel');
  if (tuningRoot) {
    tuningRoot.innerHTML = `
      <p class="panel-title"><span>Mocap tuning</span></p>

      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">📏 Calibration</span>
          <div style="display:flex;gap:3px">
            <button class="dbg-toggle off" id="mocap-recal-btn">Recal</button>
            <button class="dbg-toggle off" id="cal-reset-btn" title="Reset sliders to 1.00">Reset</button>
          </div>
        </div>
        <div class="dbg-hint">Auto-scales each frame from hip width — no T-pose needed</div>
        <div class="dbg-stat" id="mocap-calib-stat">—</div>

        <div id="cal-readiness" style="margin-top:8px;display:flex;flex-direction:column;gap:3px"></div>
        <div class="dbg-row">
          <span class="dbg-label">🔗 Unify arm max</span>
          <button class="dbg-toggle off" id="cal-unify-btn" title="Share performer arm max between L/R">OFF</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">📍 Scale ref</span>
          <div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:flex-end">
            <button class="dbg-toggle"     data-ref="auto">auto</button>
            <button class="dbg-toggle off" data-ref="median">med</button>
            <button class="dbg-toggle off" data-ref="head">head</button>
            <button class="dbg-toggle off" data-ref="shoulders">shlds</button>
            <button class="dbg-toggle off" data-ref="hips">hips</button>
          </div>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🚪 Hip vis gate <span id="cal-hipgate-val">0.40</span></span>
          <input type="range" id="cal-hipgate-slider" min="0.1" max="0.9" step="0.05" value="0.4" style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🔍 Dump to console</span>
          <button class="dbg-toggle" id="cal-dump-btn" title="Log full performer+avatar skeleton comparison">Dump</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">📊 Skeleton info</span>
          <button class="dbg-toggle off" id="skel-info-btn">View</button>
        </div>
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
      </div>

      <div class="dbg-divider"></div>

      <h2>Smoothing</h2>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">🌀 Spine <span id="mocap-spine-val">0.25</span></span>
          <input type="range" id="mocap-spine-slider" min="0.01" max="1" step="0.01" value="0.25" style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🫨 Limb <span id="mocap-smooth-val">0.70</span></span>
          <input type="range" id="mocap-smooth-slider" min="0.01" max="1" step="0.01" value="0.7" style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🧲 Pole <span id="mocap-pole-val">0.60</span></span>
          <input type="range" id="mocap-pole-slider" min="0.01" max="1" step="0.01" value="0.6" style="flex:1;margin-left:8px">
        </div>
      </div>

      <div class="dbg-divider"></div>

      <h2>Depth &amp; pose shape</h2>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">🫙 Arm Z target <span id="mocap-armz-val">1.00</span></span>
          <input type="range" id="mocap-armz-slider" min="0" max="1" step="0.01" value="1" style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🧭 Arm pole Z <span id="mocap-polez-val">0.50</span></span>
          <input type="range" id="mocap-polez-slider" min="0" max="1" step="0.01" value="0.5" style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">👁 Vis threshold <span id="mocap-vis-val">0.30</span></span>
          <input type="range" id="mocap-vis-slider" min="0" max="1" step="0.01" value="0.3" style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">↔ Shoulder spread <span id="mocap-spread-val">0°</span></span>
          <input type="range" id="mocap-spread-slider" min="-20" max="20" step="1" value="0" style="flex:1;margin-left:8px">
        </div>
      </div>

      <div class="dbg-hint">Recorded BVH auto-replays on the model for comparison</div>
    `;
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
  setInterval(() => {
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
  setInterval(() => {
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
      row('📼 BVH frames',    String(m.frameCount)),
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
    framesLbl.textContent = `${m.frameCount} frames`;
  });

  flushBtn.addEventListener('click', () => {
    const m = getMocap();
    if (!m) return;
    m.flushGrabbed();
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
  setInterval(() => {
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
  setInterval(() => {
    if (dbgRecorder.active) {
      dbgRecFrames.textContent = `${dbgRecorder.frameCount}fr`;
    } else {
      dbgRecFrames.textContent = dbgRecorder.frameCount > 0
        ? `${dbgRecorder.frameCount}fr saved`
        : '';
    }
  }, 200);

  // ── Skeleton info modal ───────────────────────────────────────────────────

  const skelInfoBtn   = document.querySelector<HTMLButtonElement>('#skel-info-btn');
  const modalOverlay  = document.getElementById('skel-modal-overlay')!;
  const modalBody     = document.getElementById('skel-modal-body')!;
  const modalCloseBtn = document.getElementById('skel-modal-close')!;
  const modalCopyBtn  = document.getElementById('skel-modal-copy')!;

  let modalTimer = 0;

  type AvatarJointPositions = ReturnType<MocapController['getAvatarJointPositions']>;
  type LimbScales = { armL: number; armR: number; legL: number; legR: number };
  type ArmSide = 'left' | 'right';
  type ArmDebugTargets = {
    elbowTarget: THREE.Vector3 | null;
    poleRaw: THREE.Vector3 | null;
    poleSmoothed: THREE.Vector3 | null;
  };

  const skelRow = (label: string, value: string): string =>
    `<div class="skel-row">
       <span class="skel-row-label">${label}</span>
       <span class="skel-row-value">${value}</span>
     </div>`;

  const fmtM   = (v: number): string => v > 1e-4 ? `${v.toFixed(3)} m` : '<span style="opacity:.35">—</span>';
  const fmtPct = (v: number): string => v > 0 ? `${(v * 100).toFixed(1)}%` : '<span style="opacity:.35">—</span>';
  const fmtNum = (v: number): string => Number.isFinite(v) ? v.toFixed(3) : '<span style="opacity:.35">—</span>';
  const fmtCm = (v: number): string =>
    Number.isFinite(v) ? `${(v * 100).toFixed(1)} cm` : '<span style="opacity:.35">—</span>';
  const fmtDeg = (v: number): string =>
    Number.isFinite(v) ? `${v.toFixed(1)}°` : '<span style="opacity:.35">—</span>';
  const fmtVecHtml = (v: THREE.Vector3 | null | undefined): string =>
    v ? `<span style="font-family:ui-monospace,monospace">${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}</span>`
      : '<span style="opacity:.35">—</span>';
  const fmtVecText = (v: THREE.Vector3 | null | undefined): string =>
    v ? `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}` : '—';
  const fmtVisHtml = (v: number | undefined): string =>
    v == null ? '<span style="opacity:.35">—</span>' : `${(v * 100).toFixed(0)}%`;
  const fmtVisText = (v: number | undefined): string =>
    v == null ? '—' : `${(v * 100).toFixed(0)}%`;
  const fmtLmHtml = (lm: Landmark3D | null | undefined): string =>
    lm
      ? `<span style="font-family:ui-monospace,monospace">${lm.x.toFixed(3)}, ${lm.y.toFixed(3)}, ${lm.z.toFixed(3)}</span> <span style="opacity:.55">vis ${fmtVisText(lm.visibility)}</span>`
      : '<span style="opacity:.35">—</span>';
  const fmtLmText = (lm: Landmark3D | null | undefined): string =>
    lm ? `${lm.x.toFixed(3)}, ${lm.y.toFixed(3)}, ${lm.z.toFixed(3)} · vis ${fmtVisText(lm.visibility)}` : '—';
  const fmtRatio = (avatar: number, perf: number): string => {
    if (avatar <= 1e-4 || perf <= 1e-4) return '<span style="opacity:.35">—</span>';
    const r = avatar / perf;
    const color = r < 0.85 ? '#f87171' : r > 1.15 ? '#fbbf24' : '#4ade80';
    return `<span style="color:${color}">${r.toFixed(2)}×</span>`;
  };
  const reachHtml = (v: number): string => {
    if (v <= 0) return '<span style="opacity:.35">—</span>';
    const color = v < 90 ? '#4ade80' : v <= 100 ? '#fbbf24' : '#f87171';
    return `<span style="color:${color}">${v.toFixed(0)}%</span>`;
  };
  const lockHtml = (locked: boolean): string =>
    locked
      ? '<span class="skel-uncal">🔒 locked</span>'
      : '<span class="skel-cal">✓ free</span>';

  const distLm = (a: Landmark3D | null | undefined, b: Landmark3D | null | undefined): number => {
    if (!a || !b) return Number.NaN;
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const distVec = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined): number =>
    a && b ? a.distanceTo(b) : Number.NaN;
  const avgVec = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined): THREE.Vector3 | null =>
    a && b ? new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5) : null;
  const vecBetween = (from: THREE.Vector3 | null | undefined, to: THREE.Vector3 | null | undefined): THREE.Vector3 | null =>
    from && to ? new THREE.Vector3().subVectors(to, from) : null;
  const angleVecDeg = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined): number => {
    if (!a || !b) return Number.NaN;
    const lenA = a.length();
    const lenB = b.length();
    if (lenA <= 1e-6 || lenB <= 1e-6) return Number.NaN;
    return THREE.MathUtils.radToDeg(a.angleTo(b));
  };
  const deltaAxis = (a: THREE.Vector3 | null | undefined, b: THREE.Vector3 | null | undefined, axis: 'x' | 'y' | 'z'): number =>
    a && b ? a[axis] - b[axis] : Number.NaN;

  const computePerformerAvatarSpacePoint = (
    frame: PoseFrame | null,
    avatarHips: THREE.Vector3,
    bodyScale: number,
    scales: LimbScales,
    idx: number,
  ): THREE.Vector3 | null => {
    if (!frame) return null;
    const lms = frame.worldLandmarks;
    const lm = lms[idx];
    if (!lm) return null;

    const lh = lms[23];
    const rh = lms[24];
    const hipMpX = lh && rh ? (lh.x + rh.x) * 0.5 : 0;
    const hipMpY = lh && rh ? (lh.y + rh.y) * 0.5 : 0;
    const hipMpZ = lh && rh ? (lh.z + rh.z) * 0.5 : 0;

    const scaleOf = (landmarkIdx: number): number => {
      switch (landmarkIdx) {
        case 13: case 15: case 17: case 19: case 21: return scales.armR;
        case 14: case 16: case 18: case 20: case 22: return scales.armL;
        case 25: case 27: case 29: case 31: return scales.legR;
        case 26: case 28: case 30: case 32: return scales.legL;
        default: return bodyScale;
      }
    };

    const anchorMpOf = (landmarkIdx: number): [number, number, number] | null => {
      if ([13, 15, 17, 19, 21].includes(landmarkIdx) && lms[11]) return [lms[11].x, lms[11].y, lms[11].z];
      if ([14, 16, 18, 20, 22].includes(landmarkIdx) && lms[12]) return [lms[12].x, lms[12].y, lms[12].z];
      if ([25, 27, 29, 31].includes(landmarkIdx) && lms[23]) return [lms[23].x, lms[23].y, lms[23].z];
      if ([26, 28, 30, 32].includes(landmarkIdx) && lms[24]) return [lms[24].x, lms[24].y, lms[24].z];
      return [hipMpX, hipMpY, hipMpZ];
    };

    const anchorMp = anchorMpOf(idx);
    if (!anchorMp) return null;

    const anchorX = avatarHips.x - (anchorMp[0] - hipMpX) * bodyScale;
    const anchorY = avatarHips.y - (anchorMp[1] - hipMpY) * bodyScale;
    const anchorZ = avatarHips.z - (anchorMp[2] - hipMpZ) * bodyScale;

    const scale = scaleOf(idx);
    const sx = -(lm.x - anchorMp[0]);
    const sy = -(lm.y - anchorMp[1]);
    const sz = -(lm.z - anchorMp[2]);
    return new THREE.Vector3(anchorX + sx * scale, anchorY + sy * scale, anchorZ + sz * scale);
  };

  const buildArmSnapshot = (
    side: ArmSide,
    frame: PoseFrame | null,
    normalizedAvatar: AvatarJointPositions,
    rawAvatar: AvatarJointPositions,
    bodyScale: number,
    scales: LimbScales,
    armDebug: ArmDebugTargets,
    target: THREE.Vector3 | null,
    reachPercent: number,
  ) => {
    const source = side === 'left'
      ? { shoulder: 12, elbow: 14, wrist: 16, mapping: 'Avatar LEFT ← performer RIGHT (12/14/16)' }
      : { shoulder: 11, elbow: 13, wrist: 15, mapping: 'Avatar RIGHT ← performer LEFT (11/13/15)' };

    const rawShoulder = frame?.worldLandmarks[source.shoulder] ?? null;
    const rawElbow    = frame?.worldLandmarks[source.elbow] ?? null;
    const rawWrist    = frame?.worldLandmarks[source.wrist] ?? null;

    const performerAvatarShoulder = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, source.shoulder);
    const performerAvatarElbow    = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, source.elbow);
    const performerAvatarWrist    = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, source.wrist);

    const actualNormShoulder = side === 'left' ? normalizedAvatar.leftUpperArm  : normalizedAvatar.rightUpperArm;
    const actualNormElbow    = side === 'left' ? normalizedAvatar.leftLowerArm  : normalizedAvatar.rightLowerArm;
    const actualNormWrist    = side === 'left' ? normalizedAvatar.leftHand      : normalizedAvatar.rightHand;
    const actualRawShoulder  = side === 'left' ? rawAvatar.leftUpperArm         : rawAvatar.rightUpperArm;
    const actualRawElbow     = side === 'left' ? rawAvatar.leftLowerArm         : rawAvatar.rightLowerArm;
    const actualRawWrist     = side === 'left' ? rawAvatar.leftHand             : rawAvatar.rightHand;

    return {
      side,
      mapping: source.mapping,
      raw: { shoulder: rawShoulder, elbow: rawElbow, wrist: rawWrist },
      performerAvatar: {
        shoulder: performerAvatarShoulder,
        elbow: performerAvatarElbow,
        wrist: performerAvatarWrist,
      },
      actualNormalized: {
        shoulder: actualNormShoulder,
        elbow: actualNormElbow,
        wrist: actualNormWrist,
      },
      actualRaw: {
        shoulder: actualRawShoulder,
        elbow: actualRawElbow,
        wrist: actualRawWrist,
      },
      elbowTarget: armDebug.elbowTarget,
      target,
      poleRaw: armDebug.poleRaw,
      poleSmoothed: armDebug.poleSmoothed,
      reachPercent,
      errors: {
        shoulderGreenToNorm:   distVec(performerAvatarShoulder, actualNormShoulder),
        shoulderGreenToRaw:    distVec(performerAvatarShoulder, actualRawShoulder),
        elbowGreenToBlue:      distVec(performerAvatarElbow, armDebug.elbowTarget),
        elbowBlueToNorm:       distVec(armDebug.elbowTarget, actualNormElbow),
        elbowBlueToRaw:        distVec(armDebug.elbowTarget, actualRawElbow),
        elbowGreenToNorm:      distVec(performerAvatarElbow, actualNormElbow),
        elbowGreenToRaw:       distVec(performerAvatarElbow, actualRawElbow),
        wristGreenToBlue:      distVec(performerAvatarWrist, target),
        wristBlueToNorm:       distVec(target, actualNormWrist),
        wristBlueToRaw:        distVec(target, actualRawWrist),
        wristGreenToNorm:      distVec(performerAvatarWrist, actualNormWrist),
        wristGreenToRaw:       distVec(performerAvatarWrist, actualRawWrist),
        wristNormToRaw:        distVec(actualNormWrist, actualRawWrist),
      },
      lengths: {
        performerRawUpper:    distLm(rawShoulder, rawElbow),
        performerRawLower:    distLm(rawElbow, rawWrist),
        performerAvatarUpper: distVec(performerAvatarShoulder, performerAvatarElbow),
        performerAvatarLower: distVec(performerAvatarElbow, performerAvatarWrist),
        actualNormUpper:      distVec(actualNormShoulder, actualNormElbow),
        actualNormLower:      distVec(actualNormElbow, actualNormWrist),
        actualRawUpper:       distVec(actualRawShoulder, actualRawElbow),
        actualRawLower:       distVec(actualRawElbow, actualRawWrist),
      },
      feasibility: {
        upperDelta: distVec(performerAvatarShoulder, performerAvatarElbow) - distVec(actualNormShoulder, actualNormElbow),
        lowerDelta: distVec(performerAvatarElbow, performerAvatarWrist) - distVec(actualNormElbow, actualNormWrist),
      },
    };
  };

  const buildTorsoSnapshot = (
    frame: PoseFrame | null,
    normalizedAvatar: AvatarJointPositions,
    rawAvatar: AvatarJointPositions,
    bodyScale: number,
    scales: LimbScales,
  ) => {
    const projectedLeftShoulder  = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 12);
    const projectedRightShoulder = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 11);
    const projectedLeftHip       = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 24);
    const projectedRightHip      = computePerformerAvatarSpacePoint(frame, normalizedAvatar.hips, bodyScale, scales, 23);

    const projectedShoulderMid = avgVec(projectedLeftShoulder, projectedRightShoulder);
    const projectedHipMid      = avgVec(projectedLeftHip, projectedRightHip);
    const projectedShoulderAxis = vecBetween(projectedLeftShoulder, projectedRightShoulder);
    const projectedHipAxis      = vecBetween(projectedLeftHip, projectedRightHip);

    const normLeftShoulder   = normalizedAvatar.leftUpperArm;
    const normRightShoulder  = normalizedAvatar.rightUpperArm;
    const normLeftHip        = normalizedAvatar.leftUpperLeg;
    const normRightHip       = normalizedAvatar.rightUpperLeg;
    const normShoulderMid    = avgVec(normLeftShoulder, normRightShoulder);
    const normHipMid         = avgVec(normLeftHip, normRightHip);
    const normShoulderAxis   = vecBetween(normLeftShoulder, normRightShoulder);
    const normHipAxis        = vecBetween(normLeftHip, normRightHip);

    const rawLeftShoulder    = rawAvatar.leftUpperArm;
    const rawRightShoulder   = rawAvatar.rightUpperArm;
    const rawLeftHip         = rawAvatar.leftUpperLeg;
    const rawRightHip        = rawAvatar.rightUpperLeg;
    const rawShoulderMid     = avgVec(rawLeftShoulder, rawRightShoulder);
    const rawHipMid          = avgVec(rawLeftHip, rawRightHip);
    const rawShoulderAxis    = vecBetween(rawLeftShoulder, rawRightShoulder);
    const rawHipAxis         = vecBetween(rawLeftHip, rawRightHip);

    return {
      projected: {
        leftShoulder: projectedLeftShoulder,
        rightShoulder: projectedRightShoulder,
        shoulderMid: projectedShoulderMid,
        leftHip: projectedLeftHip,
        rightHip: projectedRightHip,
        hipMid: projectedHipMid,
        shoulderAxis: projectedShoulderAxis,
        hipAxis: projectedHipAxis,
      },
      actualNormalized: {
        leftShoulder: normLeftShoulder,
        rightShoulder: normRightShoulder,
        shoulderMid: normShoulderMid,
        leftHip: normLeftHip,
        rightHip: normRightHip,
        hipMid: normHipMid,
        shoulderAxis: normShoulderAxis,
        hipAxis: normHipAxis,
      },
      actualRaw: {
        leftShoulder: rawLeftShoulder,
        rightShoulder: rawRightShoulder,
        shoulderMid: rawShoulderMid,
        leftHip: rawLeftHip,
        rightHip: rawRightHip,
        hipMid: rawHipMid,
        shoulderAxis: rawShoulderAxis,
        hipAxis: rawHipAxis,
      },
      errors: {
        shoulderMidGreenToNorm: distVec(projectedShoulderMid, normShoulderMid),
        shoulderMidGreenToRaw:  distVec(projectedShoulderMid, rawShoulderMid),
        hipMidGreenToNorm:      distVec(projectedHipMid, normHipMid),
        hipMidGreenToRaw:       distVec(projectedHipMid, rawHipMid),
        shoulderAxisGreenToNorm: angleVecDeg(projectedShoulderAxis, normShoulderAxis),
        shoulderAxisGreenToRaw:  angleVecDeg(projectedShoulderAxis, rawShoulderAxis),
        hipAxisGreenToNorm:      angleVecDeg(projectedHipAxis, normHipAxis),
        hipAxisGreenToRaw:       angleVecDeg(projectedHipAxis, rawHipAxis),
        shoulderWidthGreenToNorm: distVec(projectedLeftShoulder, projectedRightShoulder) - distVec(normLeftShoulder, normRightShoulder),
        shoulderWidthGreenToRaw:  distVec(projectedLeftShoulder, projectedRightShoulder) - distVec(rawLeftShoulder, rawRightShoulder),
        torsoHeightGreenToNorm:   deltaAxis(projectedShoulderMid, projectedHipMid, 'y') - deltaAxis(normShoulderMid, normHipMid, 'y'),
        torsoHeightGreenToRaw:    deltaAxis(projectedShoulderMid, projectedHipMid, 'y') - deltaAxis(rawShoulderMid, rawHipMid, 'y'),
        torsoDepthGreenToNorm:    deltaAxis(projectedShoulderMid, projectedHipMid, 'z') - deltaAxis(normShoulderMid, normHipMid, 'z'),
        torsoDepthGreenToRaw:     deltaAxis(projectedShoulderMid, projectedHipMid, 'z') - deltaAxis(rawShoulderMid, rawHipMid, 'z'),
      },
      lengths: {
        shoulderWidthGreen: distVec(projectedLeftShoulder, projectedRightShoulder),
        shoulderWidthNorm:  distVec(normLeftShoulder, normRightShoulder),
        shoulderWidthRaw:   distVec(rawLeftShoulder, rawRightShoulder),
        hipWidthGreen:      distVec(projectedLeftHip, projectedRightHip),
        hipWidthNorm:       distVec(normLeftHip, normRightHip),
        hipWidthRaw:        distVec(rawLeftHip, rawRightHip),
        torsoHeightGreen:   deltaAxis(projectedShoulderMid, projectedHipMid, 'y'),
        torsoHeightNorm:    deltaAxis(normShoulderMid, normHipMid, 'y'),
        torsoHeightRaw:     deltaAxis(rawShoulderMid, rawHipMid, 'y'),
        torsoDepthGreen:    deltaAxis(projectedShoulderMid, projectedHipMid, 'z'),
        torsoDepthNorm:     deltaAxis(normShoulderMid, normHipMid, 'z'),
        torsoDepthRaw:      deltaAxis(rawShoulderMid, rawHipMid, 'z'),
      },
    };
  };

  const getDebugSnapshot = () => {
    const m = getMocap();
    if (!m) return null;

    const cal       = m.calibration;
    const frame     = m.latestFrame;
    const pm        = cal.performerMeasurements();
    const st        = cal.status();
    const reach     = m.getReachPercent();
    const dt        = m.debugTargets;
    const avatarNormalized = m.getAvatarJointPositions('normalized');
    const avatarRaw        = m.getAvatarJointPositions('raw');
    const readiness = cal.readiness();
    const overrides = cal.getOverrides();
    const validatorStats = validator.getStats();
    const scales = {
      armL: cal.armScale('left'),
      armR: cal.armScale('right'),
      legL: cal.legScale(),
      legR: cal.legScale(),
    };
    const bodyScale = cal.bodyScale();
    const avatarArmL = cal.avatarLeftUpperArm  + cal.avatarLeftLowerArm;
    const avatarArmR = cal.avatarRightUpperArm + cal.avatarRightLowerArm;
    const avatarLegL = cal.avatarLeftUpperLeg  + cal.avatarLeftLowerLeg;
    const avatarLegR = cal.avatarRightUpperLeg + cal.avatarRightLowerLeg;
    const leftArm = buildArmSnapshot(
      'left',
      frame,
      avatarNormalized,
      avatarRaw,
      bodyScale,
      { ...scales, armL: scales.armL, armR: scales.armR },
      {
        elbowTarget: dt.hasArm ? dt.leftElbowTarget : null,
        poleRaw: dt.hasArm ? dt.leftArmPoleRaw : null,
        poleSmoothed: dt.hasArm ? dt.leftArmPoleSmoothed : null,
      },
      dt.hasArm ? dt.leftWristTarget : null,
      reach.armL,
    );
    const rightArm = buildArmSnapshot(
      'right',
      frame,
      avatarNormalized,
      avatarRaw,
      bodyScale,
      { ...scales, armL: scales.armL, armR: scales.armR },
      {
        elbowTarget: dt.hasArm ? dt.rightElbowTarget : null,
        poleRaw: dt.hasArm ? dt.rightArmPoleRaw : null,
        poleSmoothed: dt.hasArm ? dt.rightArmPoleSmoothed : null,
      },
      dt.hasArm ? dt.rightWristTarget : null,
      reach.armR,
    );
    const torso = buildTorsoSnapshot(
      frame,
      avatarNormalized,
      avatarRaw,
      bodyScale,
      { ...scales, armL: scales.armL, armR: scales.armR },
    );

    return {
      m,
      cal,
      frame,
      pm,
      st,
      dt,
      reach,
      avatarNormalized,
      avatarRaw,
      readiness,
      overrides,
      validatorStats,
      scales,
      bodyScale,
      avatarArmL,
      avatarArmR,
      avatarLegL,
      avatarLegR,
      torso,
      leftArm,
      rightArm,
    };
  };

  const buildModalContent = (): string => {
    const snap = getDebugSnapshot();
    if (!snap) return '<p style="opacity:.45;text-align:center;margin:24px 0">Start mocap to see data</p>';

    const {
      m,
      cal,
      frame,
      pm,
      st,
      dt,
      reach,
      readiness,
      overrides,
      validatorStats,
      scales,
      avatarArmL,
      avatarArmR,
      avatarLegL,
      avatarLegR,
      torso,
      leftArm,
      rightArm,
    } = snap;

    const torsoSectionHtml = `
      <div class="skel-section">
        <h4>Torso diagnostic</h4>
        ${skelRow('Green sh mid', fmtVecHtml(torso.projected.shoulderMid))}
        ${skelRow('Green hip mid', fmtVecHtml(torso.projected.hipMid))}
        ${skelRow('Norm sh mid', fmtVecHtml(torso.actualNormalized.shoulderMid))}
        ${skelRow('Norm hip mid', fmtVecHtml(torso.actualNormalized.hipMid))}
        ${skelRow('Raw sh mid', fmtVecHtml(torso.actualRaw.shoulderMid))}
        ${skelRow('Raw hip mid', fmtVecHtml(torso.actualRaw.hipMid))}
        ${skelRow('Green sh axis', fmtVecHtml(torso.projected.shoulderAxis))}
        ${skelRow('Norm sh axis', fmtVecHtml(torso.actualNormalized.shoulderAxis))}
        ${skelRow('Raw sh axis', fmtVecHtml(torso.actualRaw.shoulderAxis))}
        ${skelRow('Err sh mid G→N', fmtCm(torso.errors.shoulderMidGreenToNorm))}
        ${skelRow('Err sh mid G→R', fmtCm(torso.errors.shoulderMidGreenToRaw))}
        ${skelRow('Err hip mid G→N', fmtCm(torso.errors.hipMidGreenToNorm))}
        ${skelRow('Err hip mid G→R', fmtCm(torso.errors.hipMidGreenToRaw))}
        ${skelRow('Err sh axis G→N', fmtDeg(torso.errors.shoulderAxisGreenToNorm))}
        ${skelRow('Err sh axis G→R', fmtDeg(torso.errors.shoulderAxisGreenToRaw))}
        ${skelRow('Err hip axis G→N', fmtDeg(torso.errors.hipAxisGreenToNorm))}
        ${skelRow('Err hip axis G→R', fmtDeg(torso.errors.hipAxisGreenToRaw))}
        ${skelRow('Δ shoulder width G→N', fmtCm(torso.errors.shoulderWidthGreenToNorm))}
        ${skelRow('Δ shoulder width G→R', fmtCm(torso.errors.shoulderWidthGreenToRaw))}
        ${skelRow('Δ torso height G→N', fmtCm(torso.errors.torsoHeightGreenToNorm))}
        ${skelRow('Δ torso height G→R', fmtCm(torso.errors.torsoHeightGreenToRaw))}
        ${skelRow('Δ torso depth G→N', fmtCm(torso.errors.torsoDepthGreenToNorm))}
        ${skelRow('Δ torso depth G→R', fmtCm(torso.errors.torsoDepthGreenToRaw))}
        ${skelRow('Shoulder width G/N/R', `${fmtNum(torso.lengths.shoulderWidthGreen)} / ${fmtNum(torso.lengths.shoulderWidthNorm)} / ${fmtNum(torso.lengths.shoulderWidthRaw)} m`)}
        ${skelRow('Hip width G/N/R', `${fmtNum(torso.lengths.hipWidthGreen)} / ${fmtNum(torso.lengths.hipWidthNorm)} / ${fmtNum(torso.lengths.hipWidthRaw)} m`)}
        ${skelRow('Torso height G/N/R', `${fmtNum(torso.lengths.torsoHeightGreen)} / ${fmtNum(torso.lengths.torsoHeightNorm)} / ${fmtNum(torso.lengths.torsoHeightRaw)} m`)}
        ${skelRow('Torso depth G/N/R', `${fmtNum(torso.lengths.torsoDepthGreen)} / ${fmtNum(torso.lengths.torsoDepthNorm)} / ${fmtNum(torso.lengths.torsoDepthRaw)} m`)}
      </div>`;

    const armSectionHtml = (title: string, arm: ReturnType<typeof buildArmSnapshot>): string => `
      <div class="skel-section">
        <h4>${title}</h4>
        ${skelRow('Mapping', arm.mapping)}
        ${skelRow('Reach', reachHtml(arm.reachPercent))}
        ${skelRow('Performer raw S', fmtLmHtml(arm.raw.shoulder))}
        ${skelRow('Performer raw E', fmtLmHtml(arm.raw.elbow))}
        ${skelRow('Performer raw W', fmtLmHtml(arm.raw.wrist))}
        ${skelRow('Green shoulder', fmtVecHtml(arm.performerAvatar.shoulder))}
        ${skelRow('Green elbow', fmtVecHtml(arm.performerAvatar.elbow))}
        ${skelRow('Green wrist', fmtVecHtml(arm.performerAvatar.wrist))}
        ${skelRow('Elbow target', fmtVecHtml(arm.elbowTarget))}
        ${skelRow('Blue target', fmtVecHtml(arm.target))}
        ${skelRow('Pole raw', fmtVecHtml(arm.poleRaw))}
        ${skelRow('Pole smooth', fmtVecHtml(arm.poleSmoothed))}
        ${skelRow('Norm shoulder', fmtVecHtml(arm.actualNormalized.shoulder))}
        ${skelRow('Norm elbow', fmtVecHtml(arm.actualNormalized.elbow))}
        ${skelRow('Norm wrist', fmtVecHtml(arm.actualNormalized.wrist))}
        ${skelRow('Raw shoulder', fmtVecHtml(arm.actualRaw.shoulder))}
        ${skelRow('Raw elbow', fmtVecHtml(arm.actualRaw.elbow))}
        ${skelRow('Raw wrist', fmtVecHtml(arm.actualRaw.wrist))}
        ${skelRow('Err shoulder G→N', fmtCm(arm.errors.shoulderGreenToNorm))}
        ${skelRow('Err shoulder G→R', fmtCm(arm.errors.shoulderGreenToRaw))}
        ${skelRow('Err elbow G→T', fmtCm(arm.errors.elbowGreenToBlue))}
        ${skelRow('Err elbow T→N', fmtCm(arm.errors.elbowBlueToNorm))}
        ${skelRow('Err elbow T→R', fmtCm(arm.errors.elbowBlueToRaw))}
        ${skelRow('Err elbow G→N', fmtCm(arm.errors.elbowGreenToNorm))}
        ${skelRow('Err elbow G→R', fmtCm(arm.errors.elbowGreenToRaw))}
        ${skelRow('Err wrist G→B', fmtCm(arm.errors.wristGreenToBlue))}
        ${skelRow('Err wrist B→N', fmtCm(arm.errors.wristBlueToNorm))}
        ${skelRow('Err wrist B→R', fmtCm(arm.errors.wristBlueToRaw))}
        ${skelRow('Err wrist G→N', fmtCm(arm.errors.wristGreenToNorm))}
        ${skelRow('Err wrist G→R', fmtCm(arm.errors.wristGreenToRaw))}
        ${skelRow('Err wrist N→R', fmtCm(arm.errors.wristNormToRaw))}
        ${skelRow('Elbow ref upper Δ', fmtCm(arm.feasibility.upperDelta))}
        ${skelRow('Elbow ref lower Δ', fmtCm(arm.feasibility.lowerDelta))}
        ${skelRow('Raw upper/lower', `${fmtNum(arm.lengths.performerRawUpper)} / ${fmtNum(arm.lengths.performerRawLower)} m`)}
        ${skelRow('Green upper/lower', `${fmtNum(arm.lengths.performerAvatarUpper)} / ${fmtNum(arm.lengths.performerAvatarLower)} m`)}
        ${skelRow('Norm upper/lower', `${fmtNum(arm.lengths.actualNormUpper)} / ${fmtNum(arm.lengths.actualNormLower)} m`)}
        ${skelRow('Raw upper/lower', `${fmtNum(arm.lengths.actualRawUpper)} / ${fmtNum(arm.lengths.actualRawLower)} m`)}
      </div>`;

    return `
      <div class="skel-cols">
        <div class="skel-section">
          <h4>Performer (MediaPipe, metres)</h4>
          ${skelRow('Hip width',      fmtM(pm.hipWidth))}
          ${skelRow('Shoulder width', fmtM(pm.shoulderWidth))}
          ${skelRow('Head width',     fmtM(pm.headWidth))}
          ${skelRow('Arm L max',      fmtM(pm.leftArmMax))}
          ${skelRow('Arm R max',      fmtM(pm.rightArmMax))}
          ${skelRow('Leg length',     fmtM(pm.legLen))}
        </div>
        <div class="skel-section">
          <h4>Avatar skeleton (rest pose)</h4>
          ${skelRow('Hip width',      fmtM(cal.avatarHipWidth))}
          ${skelRow('Shoulder width', fmtM(cal.avatarShoulderWidth))}
          ${skelRow('Head width',     fmtM(cal.avatarHeadWidth))}
          ${skelRow('Arm L upper',    fmtM(cal.avatarLeftUpperArm))}
          ${skelRow('Arm L lower',    fmtM(cal.avatarLeftLowerArm))}
          ${skelRow('Arm R upper',    fmtM(cal.avatarRightUpperArm))}
          ${skelRow('Arm R lower',    fmtM(cal.avatarRightLowerArm))}
          ${skelRow('Leg L upper',    fmtM(cal.avatarLeftUpperLeg))}
          ${skelRow('Leg L lower',    fmtM(cal.avatarLeftLowerLeg))}
          ${skelRow('Leg R upper',    fmtM(cal.avatarRightUpperLeg))}
          ${skelRow('Leg R lower',    fmtM(cal.avatarRightLowerLeg))}
        </div>
      </div>
      <div class="skel-divider"></div>
      <div class="skel-cols">
        <div class="skel-section">
          <h4>Capture &amp; tuning</h4>
          ${skelRow('Live frame', frame ? '<span class="skel-cal">yes</span>' : '<span class="skel-uncal">no</span>')}
          ${skelRow('Hands detected', frame ? (frame.hands.map((h) => h.side).join(', ') || '—') : '<span style="opacity:.35">—</span>')}
          ${skelRow('Face landmarks', frame ? String(frame.faceLandmarks.length) : '<span style="opacity:.35">—</span>')}
          ${skelRow('Scale ref', cal.scaleRef)}
          ${skelRow('Pose model', m.poseQuality)}
          ${skelRow('Mirror', m.mirrorX ? 'ON' : 'OFF')}
          ${skelRow('1€ filter', m.filterEnabled ? 'ON' : 'OFF')}
          ${skelRow('Visibility gate', fmtPct(m.visibilityThreshold))}
          ${skelRow('Depth scale', fmtNum(m.depthScale))}
          ${skelRow('Arm Z atten', fmtNum(m.armZAttenuation))}
          ${skelRow('Pole Z', fmtNum(m.armPoleZ))}
          ${skelRow('Body smooth', fmtNum(m.bodySmoothing))}
          ${skelRow('Spine smooth', fmtNum(m.spineSmoothing))}
          ${skelRow('Pole smooth', fmtNum(m.poleSmoothing))}
          ${skelRow('Shoulder spread', `${m.shoulderSpread.toFixed(0)}°`)}
          ${skelRow('Validator', validator.enabled ? 'ON' : 'OFF')}
          ${skelRow('Clamped/frame', String(validatorStats.clampedThisFrame))}
          ${skelRow('Worst clamp', validatorStats.worstBone
            ? `${validatorStats.worstBone} +${(validatorStats.worstDelta * 180 / Math.PI).toFixed(1)}°`
            : '<span style="opacity:.35">—</span>')}
        </div>
        <div class="skel-section">
          <h4>Readiness &amp; overrides</h4>
          ${skelRow('Shoulders ready', fmtPct(readiness.shoulders))}
          ${skelRow('Hips ready', fmtPct(readiness.hips))}
          ${skelRow('Legs ready', fmtPct(readiness.legs))}
          ${skelRow('Arm L ready', fmtPct(readiness.armL))}
          ${skelRow('Arm R ready', fmtPct(readiness.armR))}
          ${skelRow('Shoulder override', fmtNum(overrides.shoulder))}
          ${skelRow('L arm override', fmtNum(overrides.leftArm))}
          ${skelRow('R arm override', fmtNum(overrides.rightArm))}
          ${skelRow('Body scale raw', fmtPct(st.bodyScale))}
          ${skelRow('Arm L scale raw', fmtPct(scales.armL))}
          ${skelRow('Arm R scale raw', fmtPct(scales.armR))}
          ${skelRow('Leg scale raw', fmtPct(scales.legL))}
          ${skelRow('Wrist targets active', dt.hasArm ? '<span class="skel-cal">yes</span>' : '<span class="skel-uncal">no</span>')}
          ${skelRow('Ankle targets active', dt.hasLeg ? '<span class="skel-cal">yes</span>' : '<span class="skel-uncal">no</span>')}
        </div>
      </div>
      <div class="skel-divider"></div>
      <div class="skel-cols">
        <div class="skel-section">
          <h4>Calibration scales</h4>
          ${skelRow('Calibrated',    st.calibrated
              ? '<span class="skel-cal">yes</span>'
              : '<span class="skel-uncal">no</span>')}
          ${skelRow('Body scale',    fmtPct(st.bodyScale))}
          ${skelRow('Arm L scale',   fmtPct(st.leftArmScale))}
          ${skelRow('Arm R scale',   fmtPct(st.rightArmScale))}
          ${skelRow('Leg scale',     fmtPct(cal.legScale()))}
          ${skelRow('Shoulder ×',    fmtPct(st.shoulderWidthScale))}
        </div>
        <div class="skel-section">
          <h4>IK reach &amp; foot lock</h4>
          ${skelRow('Arm L reach',  reachHtml(reach.armL))}
          ${skelRow('Arm R reach',  reachHtml(reach.armR))}
          ${skelRow('Leg L reach',  reachHtml(reach.legL))}
          ${skelRow('Leg R reach',  reachHtml(reach.legR))}
          ${skelRow('L foot',       dt.hasLeg ? lockHtml(dt.leftFootLocked)  : '<span style="opacity:.35">—</span>')}
          ${skelRow('R foot',       dt.hasLeg ? lockHtml(dt.rightFootLocked) : '<span style="opacity:.35">—</span>')}
        </div>
      </div>
      <div class="skel-divider"></div>
      <div class="skel-cols">
        <div class="skel-section">
          <h4>Size ratios (avatar / performer)</h4>
          ${skelRow('Hip',       fmtRatio(cal.avatarHipWidth,      pm.hipWidth))}
          ${skelRow('Shoulder',  fmtRatio(cal.avatarShoulderWidth, pm.shoulderWidth))}
          ${skelRow('Head',      fmtRatio(cal.avatarHeadWidth,     pm.headWidth))}
          ${skelRow('Arm L',     fmtRatio(avatarArmL, pm.rightArmMax))}
          ${skelRow('Arm R',     fmtRatio(avatarArmR, pm.leftArmMax))}
          ${skelRow('Leg',       fmtRatio((avatarLegL + avatarLegR) * 0.5, pm.legLen))}
        </div>
        <div class="skel-section">
          <h4>Segment totals</h4>
          ${skelRow('Arm L total', fmtM(avatarArmL))}
          ${skelRow('Arm R total', fmtM(avatarArmR))}
          ${skelRow('Leg L total', fmtM(avatarLegL))}
          ${skelRow('Leg R total', fmtM(avatarLegR))}
          ${skelRow('Arm asym',    fmtM(Math.abs(avatarArmL - avatarArmR)))}
          ${skelRow('Leg asym',    fmtM(Math.abs(avatarLegL - avatarLegR)))}
        </div>
      </div>
      <div class="skel-divider"></div>
      <div class="skel-cols">
        ${torsoSectionHtml}
      </div>
      <div class="skel-divider"></div>
      <div class="skel-cols">
        ${armSectionHtml('Arm diagnostic: avatar LEFT', leftArm)}
        ${armSectionHtml('Arm diagnostic: avatar RIGHT', rightArm)}
      </div>`;
  };

  const buildClipboardText = (): string => {
    const snap = getDebugSnapshot();
    if (!snap) return 'No mocap data available.';

    const {
      m,
      cal,
      frame,
      pm,
      st,
      dt,
      reach,
      readiness,
      overrides,
      validatorStats,
      scales,
      avatarArmL,
      avatarArmR,
      avatarLegL,
      avatarLegR,
      torso,
      leftArm,
      rightArm,
    } = snap;

    const f = (v: number) => Number.isFinite(v) ? v.toFixed(4) : '—';
    const p = (v: number) => v > 0 ? (v * 100).toFixed(1) + '%' : '—';
    const r = (a: number, b: number) => (a > 1e-4 && b > 1e-4) ? (a / b).toFixed(3) + '×' : '—';
    const cm = (v: number) => Number.isFinite(v) ? `${(v * 100).toFixed(1)} cm` : '—';

    const armText = (title: string, arm: ReturnType<typeof buildArmSnapshot>): string[] => [
      `--- ${title} ---`,
      `Mapping:         ${arm.mapping}`,
      `Reach:           ${arm.reachPercent > 0 ? arm.reachPercent.toFixed(0) + '%' : '—'}`,
      `Perf raw S:      ${fmtLmText(arm.raw.shoulder)}`,
      `Perf raw E:      ${fmtLmText(arm.raw.elbow)}`,
      `Perf raw W:      ${fmtLmText(arm.raw.wrist)}`,
      `Green shoulder:  ${fmtVecText(arm.performerAvatar.shoulder)}`,
      `Green elbow:     ${fmtVecText(arm.performerAvatar.elbow)}`,
      `Green wrist:     ${fmtVecText(arm.performerAvatar.wrist)}`,
      `Elbow target:    ${fmtVecText(arm.elbowTarget)}`,
      `Blue target:     ${fmtVecText(arm.target)}`,
      `Pole raw:        ${fmtVecText(arm.poleRaw)}`,
      `Pole smooth:     ${fmtVecText(arm.poleSmoothed)}`,
      `Norm shoulder:   ${fmtVecText(arm.actualNormalized.shoulder)}`,
      `Norm elbow:      ${fmtVecText(arm.actualNormalized.elbow)}`,
      `Norm wrist:      ${fmtVecText(arm.actualNormalized.wrist)}`,
      `Raw shoulder:    ${fmtVecText(arm.actualRaw.shoulder)}`,
      `Raw elbow:       ${fmtVecText(arm.actualRaw.elbow)}`,
      `Raw wrist:       ${fmtVecText(arm.actualRaw.wrist)}`,
      `Err shoulder G→N:${cm(arm.errors.shoulderGreenToNorm)}`,
      `Err shoulder G→R:${cm(arm.errors.shoulderGreenToRaw)}`,
      `Err elbow G→T:   ${cm(arm.errors.elbowGreenToBlue)}`,
      `Err elbow T→N:   ${cm(arm.errors.elbowBlueToNorm)}`,
      `Err elbow T→R:   ${cm(arm.errors.elbowBlueToRaw)}`,
      `Err elbow G→N:   ${cm(arm.errors.elbowGreenToNorm)}`,
      `Err elbow G→R:   ${cm(arm.errors.elbowGreenToRaw)}`,
      `Err wrist G→B:   ${cm(arm.errors.wristGreenToBlue)}`,
      `Err wrist B→N:   ${cm(arm.errors.wristBlueToNorm)}`,
      `Err wrist B→R:   ${cm(arm.errors.wristBlueToRaw)}`,
      `Err wrist G→N:   ${cm(arm.errors.wristGreenToNorm)}`,
      `Err wrist G→R:   ${cm(arm.errors.wristGreenToRaw)}`,
      `Err wrist N→R:   ${cm(arm.errors.wristNormToRaw)}`,
      `Elbow ref upper Δ:${cm(arm.feasibility.upperDelta)}`,
      `Elbow ref lower Δ:${cm(arm.feasibility.lowerDelta)}`,
      `Raw upper/lower: ${f(arm.lengths.performerRawUpper)} / ${f(arm.lengths.performerRawLower)}`,
      `Green upper/lwr: ${f(arm.lengths.performerAvatarUpper)} / ${f(arm.lengths.performerAvatarLower)}`,
      `Norm upper/lwr:  ${f(arm.lengths.actualNormUpper)} / ${f(arm.lengths.actualNormLower)}`,
      `Raw upper/lwr:   ${f(arm.lengths.actualRawUpper)} / ${f(arm.lengths.actualRawLower)}`,
      '',
    ];

    const torsoText = [
      '--- Torso diagnostic ---',
      `Green sh mid:    ${fmtVecText(torso.projected.shoulderMid)}`,
      `Green hip mid:   ${fmtVecText(torso.projected.hipMid)}`,
      `Norm sh mid:     ${fmtVecText(torso.actualNormalized.shoulderMid)}`,
      `Norm hip mid:    ${fmtVecText(torso.actualNormalized.hipMid)}`,
      `Raw sh mid:      ${fmtVecText(torso.actualRaw.shoulderMid)}`,
      `Raw hip mid:     ${fmtVecText(torso.actualRaw.hipMid)}`,
      `Green sh axis:   ${fmtVecText(torso.projected.shoulderAxis)}`,
      `Norm sh axis:    ${fmtVecText(torso.actualNormalized.shoulderAxis)}`,
      `Raw sh axis:     ${fmtVecText(torso.actualRaw.shoulderAxis)}`,
      `Err sh mid G→N:  ${cm(torso.errors.shoulderMidGreenToNorm)}`,
      `Err sh mid G→R:  ${cm(torso.errors.shoulderMidGreenToRaw)}`,
      `Err hip mid G→N: ${cm(torso.errors.hipMidGreenToNorm)}`,
      `Err hip mid G→R: ${cm(torso.errors.hipMidGreenToRaw)}`,
      `Err sh axis G→N: ${Number.isFinite(torso.errors.shoulderAxisGreenToNorm) ? torso.errors.shoulderAxisGreenToNorm.toFixed(1) + '°' : '—'}`,
      `Err sh axis G→R: ${Number.isFinite(torso.errors.shoulderAxisGreenToRaw) ? torso.errors.shoulderAxisGreenToRaw.toFixed(1) + '°' : '—'}`,
      `Err hip axis G→N:${Number.isFinite(torso.errors.hipAxisGreenToNorm) ? torso.errors.hipAxisGreenToNorm.toFixed(1) + '°' : '—'}`,
      `Err hip axis G→R:${Number.isFinite(torso.errors.hipAxisGreenToRaw) ? torso.errors.hipAxisGreenToRaw.toFixed(1) + '°' : '—'}`,
      `Δ shoulder width G→N:${cm(torso.errors.shoulderWidthGreenToNorm)}`,
      `Δ shoulder width G→R:${cm(torso.errors.shoulderWidthGreenToRaw)}`,
      `Δ torso height G→N:${cm(torso.errors.torsoHeightGreenToNorm)}`,
      `Δ torso height G→R:${cm(torso.errors.torsoHeightGreenToRaw)}`,
      `Δ torso depth G→N: ${cm(torso.errors.torsoDepthGreenToNorm)}`,
      `Δ torso depth G→R: ${cm(torso.errors.torsoDepthGreenToRaw)}`,
      `Shoulder width G/N/R: ${f(torso.lengths.shoulderWidthGreen)} / ${f(torso.lengths.shoulderWidthNorm)} / ${f(torso.lengths.shoulderWidthRaw)}`,
      `Hip width G/N/R:      ${f(torso.lengths.hipWidthGreen)} / ${f(torso.lengths.hipWidthNorm)} / ${f(torso.lengths.hipWidthRaw)}`,
      `Torso height G/N/R:   ${f(torso.lengths.torsoHeightGreen)} / ${f(torso.lengths.torsoHeightNorm)} / ${f(torso.lengths.torsoHeightRaw)}`,
      `Torso depth G/N/R:    ${f(torso.lengths.torsoDepthGreen)} / ${f(torso.lengths.torsoDepthNorm)} / ${f(torso.lengths.torsoDepthRaw)}`,
      '',
    ];

    return [
      '=== Skeleton Info ===',
      '',
      '--- Performer (metres) ---',
      `Hip width:      ${f(pm.hipWidth)}`,
      `Shoulder width: ${f(pm.shoulderWidth)}`,
      `Head width:     ${f(pm.headWidth)}`,
      `Arm L max:      ${f(pm.leftArmMax)}`,
      `Arm R max:      ${f(pm.rightArmMax)}`,
      `Leg length:     ${f(pm.legLen)}`,
      '',
      '--- Avatar skeleton ---',
      `Hip width:      ${f(cal.avatarHipWidth)}`,
      `Shoulder width: ${f(cal.avatarShoulderWidth)}`,
      `Head width:     ${f(cal.avatarHeadWidth)}`,
      `Arm L upper:    ${f(cal.avatarLeftUpperArm)}`,
      `Arm L lower:    ${f(cal.avatarLeftLowerArm)}`,
      `Arm R upper:    ${f(cal.avatarRightUpperArm)}`,
      `Arm R lower:    ${f(cal.avatarRightLowerArm)}`,
      `Leg L upper:    ${f(cal.avatarLeftUpperLeg)}`,
      `Leg L lower:    ${f(cal.avatarLeftLowerLeg)}`,
      `Leg R upper:    ${f(cal.avatarRightUpperLeg)}`,
      `Leg R lower:    ${f(cal.avatarRightLowerLeg)}`,
      '',
      '--- Capture & tuning ---',
      `Live frame:      ${frame ? 'yes' : 'no'}`,
      `Hands detected:  ${frame ? (frame.hands.map((h) => h.side).join(', ') || '—') : '—'}`,
      `Face landmarks:  ${frame ? String(frame.faceLandmarks.length) : '—'}`,
      `Scale ref:       ${cal.scaleRef}`,
      `Pose model:      ${m.poseQuality}`,
      `Mirror:          ${m.mirrorX ? 'ON' : 'OFF'}`,
      `1€ filter:       ${m.filterEnabled ? 'ON' : 'OFF'}`,
      `Visibility gate: ${p(m.visibilityThreshold)}`,
      `Depth scale:     ${m.depthScale.toFixed(2)}`,
      `Arm Z atten:     ${m.armZAttenuation.toFixed(2)}`,
      `Pole Z:          ${m.armPoleZ.toFixed(2)}`,
      `Body smooth:     ${m.bodySmoothing.toFixed(2)}`,
      `Spine smooth:    ${m.spineSmoothing.toFixed(2)}`,
      `Pole smooth:     ${m.poleSmoothing.toFixed(2)}`,
      `Shoulder spread: ${m.shoulderSpread.toFixed(0)}°`,
      `Validator:       ${validator.enabled ? 'ON' : 'OFF'}`,
      `Clamped/frame:   ${validatorStats.clampedThisFrame}`,
      `Worst clamp:     ${validatorStats.worstBone
        ? `${validatorStats.worstBone} +${(validatorStats.worstDelta * 180 / Math.PI).toFixed(1)}°`
        : '—'}`,
      '',
      '--- Readiness & overrides ---',
      `Shoulders ready: ${p(readiness.shoulders)}`,
      `Hips ready:      ${p(readiness.hips)}`,
      `Legs ready:      ${p(readiness.legs)}`,
      `Arm L ready:     ${p(readiness.armL)}`,
      `Arm R ready:     ${p(readiness.armR)}`,
      `Shoulder ovrd:   ${overrides.shoulder.toFixed(2)}`,
      `L arm ovrd:      ${overrides.leftArm.toFixed(2)}`,
      `R arm ovrd:      ${overrides.rightArm.toFixed(2)}`,
      `Body scale raw:  ${p(st.bodyScale)}`,
      `Arm L scale raw: ${p(scales.armL)}`,
      `Arm R scale raw: ${p(scales.armR)}`,
      `Leg scale raw:   ${p(scales.legL)}`,
      `Wrist targets:   ${dt.hasArm ? 'yes' : 'no'}`,
      `Ankle targets:   ${dt.hasLeg ? 'yes' : 'no'}`,
      '',
      '--- Calibration scales ---',
      `Calibrated:     ${st.calibrated ? 'yes' : 'no'}`,
      `Body scale:     ${p(st.bodyScale)}`,
      `Arm L scale:    ${p(st.leftArmScale)}`,
      `Arm R scale:    ${p(st.rightArmScale)}`,
      `Leg scale:      ${p(cal.legScale())}`,
      `Shoulder ×:     ${p(st.shoulderWidthScale)}`,
      '',
      '--- IK reach & foot lock ---',
      `Arm L reach:    ${reach.armL > 0 ? reach.armL.toFixed(0) + '%' : '—'}`,
      `Arm R reach:    ${reach.armR > 0 ? reach.armR.toFixed(0) + '%' : '—'}`,
      `Leg L reach:    ${reach.legL > 0 ? reach.legL.toFixed(0) + '%' : '—'}`,
      `Leg R reach:    ${reach.legR > 0 ? reach.legR.toFixed(0) + '%' : '—'}`,
      `L foot:         ${dt.hasLeg ? (dt.leftFootLocked  ? 'locked' : 'free') : '—'}`,
      `R foot:         ${dt.hasLeg ? (dt.rightFootLocked ? 'locked' : 'free') : '—'}`,
      '',
      '--- Size ratios (avatar/performer) ---',
      `Hip:      ${r(cal.avatarHipWidth,      pm.hipWidth)}`,
      `Shoulder: ${r(cal.avatarShoulderWidth, pm.shoulderWidth)}`,
      `Head:     ${r(cal.avatarHeadWidth,     pm.headWidth)}`,
      `Arm L:    ${r(avatarArmL, pm.rightArmMax)}`,
      `Arm R:    ${r(avatarArmR, pm.leftArmMax)}`,
      `Leg:      ${r((avatarLegL + avatarLegR) * 0.5, pm.legLen)}`,
      '',
      '--- Segment totals ---',
      `Arm L total: ${f(avatarArmL)}`,
      `Arm R total: ${f(avatarArmR)}`,
      `Leg L total: ${f(avatarLegL)}`,
      `Leg R total: ${f(avatarLegR)}`,
      `Arm asym:    ${f(Math.abs(avatarArmL - avatarArmR))}`,
      `Leg asym:    ${f(Math.abs(avatarLegL - avatarLegR))}`,
      '',
      ...torsoText,
      ...armText('Arm diagnostic: avatar LEFT', leftArm),
      ...armText('Arm diagnostic: avatar RIGHT', rightArm),
    ].join('\n');
  };

  const refreshModal = (): void => { modalBody.innerHTML = buildModalContent(); };

  const openModal = (): void => {
    modalOverlay.classList.add('open');
    refreshModal();
    modalTimer = window.setInterval(refreshModal, 500);
  };

  const closeModal = (): void => {
    modalOverlay.classList.remove('open');
    clearInterval(modalTimer);
  };

  skelInfoBtn?.addEventListener('click', openModal);
  modalCloseBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal();
  });

  let copyResetTimer = 0;
  modalCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(buildClipboardText()).then(() => {
      modalCopyBtn.textContent = '✓ copied!';
      modalCopyBtn.classList.add('copied');
      clearTimeout(copyResetTimer);
      copyResetTimer = window.setTimeout(() => {
        modalCopyBtn.textContent = '📋 copy';
        modalCopyBtn.classList.remove('copied');
      }, 2000);
    });
  });
}
