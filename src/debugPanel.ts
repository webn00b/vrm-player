import type { MicroAnimations } from './microAnimations';
import type { IdleLoop } from './idleLoop';
import type { PriorityAnimator } from './priorityAnimator';
import type { AnimationController } from './animationController';
import type { MocapController, MocapState } from './mocap/mocapController';
import type { SkeletonVisualizer } from './skeletonVisualizer';
import type { BoneValidator } from './validation/boneValidator';

export function mountDebugPanel(
  micro: MicroAnimations,
  idle: IdleLoop,
  pa: PriorityAnimator,
  getController: () => AnimationController | null,
  getMocap: () => MocapController | null,
  skelViz: SkeletonVisualizer,
  validator: BoneValidator,
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
        <span class="dbg-label">🦴 Show skeleton</span>
        <button class="dbg-toggle off" id="skel-toggle">OFF</button>
      </div>
      <div class="dbg-row" id="skel-options" style="display:none">
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
        <span class="dbg-label">🌊 1€ smoothing</span>
        <button class="dbg-toggle" id="mocap-filter-btn">ON</button>
      </div>
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
      <div class="dbg-hint">Hold T-pose while calibrating (arms out, straight)</div>
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
      <div class="dbg-hint">Recorded BVH auto-replays on the model for comparison</div>
      <canvas id="mocap-canvas" style="display:none;width:100%;border-radius:6px;margin-top:6px;background:#000"></canvas>
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
  const previewCvs  = root.querySelector<HTMLCanvasElement>('#mocap-canvas')!;
  const fileInput   = root.querySelector<HTMLInputElement>('#mocap-file-input')!;
  const fileLabel   = root.querySelector<HTMLElement>('#mocap-file-label')!;

  // Set canvas intrinsic resolution (4:3 at 2× panel width for sharpness)
  previewCvs.width  = 400;
  previewCvs.height = 300;

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
      previewCvs.style.display  = 'none';
      mocap?.setCanvas(null);
    } else if (state === 'live') {
      statusLbl.textContent     = '📷 Live';
      camBtn.textContent        = 'Stop';
      camBtn.classList.remove('off');
      fileLabel.classList.add('off');
      recRow.style.display      = 'flex';
      playRow.style.display     = 'flex';
      recBtn.textContent        = '⏺ Rec';
      recBtn.classList.remove('off');
      previewCvs.style.display  = 'block';
      mocap?.setCanvas(previewCvs);
    } else if (state === 'recording') {
      const isFile = (mocap?.duration ?? 0) > 0;
      statusLbl.textContent     = isFile ? '🎬 Processing…' : '📷 Recording…';
      recBtn.textContent        = '⏹ Stop';
      recBtn.classList.add('off');
      camBtn.disabled           = isFile; // disable Stop during file processing
      fileLabel.classList.add('off');
      playRow.style.display     = 'flex';
      previewCvs.style.display  = 'block';
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
    try {
      await mocap.startFromFile(file);
    } catch (e) {
      statusLbl.textContent = `❌ ${(e as Error).message.slice(0, 28)}`;
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
        const l = (s.leftArmScale * 100).toFixed(0);
        const r = (s.rightArmScale * 100).toFixed(0);
        calibStat.textContent = `✓ arms L ${l}%  R ${r}%`;
      } else {
        calibStat.textContent = `collecting ${s.sampleCount}/${s.sampleTarget}`;
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

  const skelToggle  = root.querySelector<HTMLButtonElement>('#skel-toggle')!;
  const skelBody    = root.querySelector<HTMLButtonElement>('#skel-body')!;
  const skelFingers = root.querySelector<HTMLButtonElement>('#skel-fingers')!;
  const skelOptions = root.querySelector<HTMLElement>('#skel-options')!;

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
}
