import type { IdleLoop } from './idleLoop';

export function buildMainPanelHtml(idle: IdleLoop): string {
  return `
    <div class="dbg-tabs">
      <button class="dbg-tab active" data-tab="main">Main</button>
      <button class="dbg-tab"        data-tab="video">Video</button>
    </div>

    <div class="dbg-tab-panel active" data-panel="main">

    <div class="dbg-section">
      <div class="dbg-row">
        <span class="dbg-label" style="font-weight:600">🎭 Demo mode</span>
        <button class="dbg-toggle" id="dbg-demo">OFF</button>
      </div>
      <div class="dbg-hint" id="dbg-hint">Mutes BVH — shows idle priority blending</div>
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
      <div class="dbg-row">
        <span class="dbg-label">🎯 Drag bones</span>
        <div style="display:flex;gap:3px">
          <button class="dbg-toggle off" id="bone-drag-toggle" title="Click joints in 3D to attach a rotation gizmo">OFF</button>
          <button class="dbg-toggle off" id="bone-drag-reset" title="Clear all drag offsets">Reset</button>
        </div>
      </div>
    </div>

    <div class="dbg-divider"></div>

    <details class="dbg-fold" id="fold-idle">
      <summary>Idle poses</summary>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">💃 Idle poses</span>
          <button class="dbg-toggle off" data-key="idle">OFF</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🫁 Breathing</span>
          <button class="dbg-toggle off" data-key="breathing">OFF</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🌊 Head sway</span>
          <button class="dbg-toggle off" data-key="headSway">OFF</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">👁 Eye saccades</span>
          <button class="dbg-toggle off" data-key="eyeSaccades">OFF</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">😑 Blink</span>
          <button class="dbg-toggle off" data-key="blink">OFF</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">⚖️ Weight shift</span>
          <button class="dbg-toggle off" data-key="weightShift">OFF</button>
        </div>
      </div>
    </details>

    <details class="dbg-fold" id="fold-validation">
      <summary>Validation (ROM)</summary>
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
        <div class="dbg-row" style="margin-top:6px">
          <span class="dbg-label">📋 Skel log</span>
          <div style="display:flex;gap:3px">
            <button class="dbg-toggle off" id="skel-log-btn" title="Toggle compact per-frame skeleton diagnostics. Stop → console digest.">⏺ Rec</button>
            <button class="dbg-toggle off" id="skel-log-dl" title="Download last digest as .txt">⬇</button>
          </div>
        </div>
        <div class="dbg-stat" id="skel-log-stat"></div>
      </div>
    </details>

    <details class="dbg-fold" id="fold-bvh-export">
      <summary>BVH export</summary>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label" title="Write BVH in SystemAnimatorOnline / XR Animator's format. Uses YXZ Euler order, ×10 OFFSET scale, and canonicalised bone offsets so the file plays back correctly on those third-party VRM players.">🎬 SystemAnimator-compat</span>
          <button class="dbg-toggle off" id="bvh-sa-compat-btn">OFF</button>
        </div>
        <div class="dbg-hint" style="font-size:10px">
          ON → BVH из mocap-recorder и из «⬇ BVH» queue-export пишется в формате SystemAnimator (YXZ-Euler, OFFSET ×10, canonical axes). Применяется к следующей записи; текущая идущая запись доезжает в исходном формате.
        </div>
      </div>
    </details>

    <details class="dbg-fold" id="fold-diagnostics">
      <summary>Diagnostics</summary>
      <div class="dbg-section">
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
      </div>
    </details>

    <details class="dbg-fold" id="fold-hipforce">
      <summary>Hip force</summary>
      <div class="dbg-section">
        <div class="dbg-stat" id="dbg-hipforce-mass">tracked mass: —</div>
        <div class="dbg-stat" id="dbg-hipforce-total">|F_total|: —</div>
        <div class="dbg-stat" id="dbg-hipforce-grav">|F_grav|:  —</div>
        <div class="dbg-stat" id="dbg-hipforce-inert">|F_inert|: —</div>
        <div class="dbg-stat" id="dbg-hipforce-tilt">tilt vs Y_hip: —</div>
        <div class="dbg-stat" id="dbg-hipforce-gtilt">gravity tilt: —</div>
        <div class="dbg-row" style="margin-top:6px">
          <span class="dbg-label">⚖ Balance corrector</span>
          <button class="dbg-toggle off" id="hipbal-btn">OFF</button>
        </div>
        <div class="dbg-stat" id="dbg-hipbal-angles">corr. angles: —</div>
      </div>
    </details>

    </div>

    <div class="dbg-tab-panel" data-panel="video">

    <div class="dbg-section">
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
        <span class="dbg-label">📐 Depth</span>
        <div style="display:flex;gap:3px">
          <button class="dbg-toggle off" data-depth="0">2D</button>
          <button class="dbg-toggle off" data-depth="0.5">mid</button>
          <button class="dbg-toggle"     data-depth="1">3D</button>
        </div>
      </div>
    </div>

    <div class="dbg-divider"></div>

    <details class="dbg-fold" id="fold-mocap-advanced">
      <summary>Mocap advanced</summary>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">🌊 1€ smoothing</span>
          <button class="dbg-toggle" id="mocap-filter-btn">ON</button>
        </div>
        <div class="dbg-row">
          <label class="dbg-label" for="mocap-handprio-box">✋ Wrist + fingers priority</label>
          <input type="checkbox" id="mocap-handprio-box" checked style="width:14px;height:14px;accent-color:#6ea8ff">
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
          <span class="dbg-label">🔬 BVH диагностика</span>
          <button class="dbg-toggle off" id="bvh-diag-btn">Inspect</button>
        </div>
      </div>
    </details>

    <div class="dbg-hint">Detailed tuning sliders are in the panel on the right →</div>
    </div>
  `;
}

export function buildTuningPanelHtml(): string {
  return `
      <p class="panel-title"><span>Capture</span></p>

      <div class="dbg-section">
        <div class="capture-source">
          <button class="capture-src-btn" data-source="camera"   aria-pressed="true">📷 Camera</button>
          <button class="capture-src-btn" data-source="video"    aria-pressed="false">📁 Video</button>
          <button class="capture-src-btn" data-source="animfile" aria-pressed="false">🎬 Anim</button>
        </div>

        <button id="capture-primary-btn" class="capture-primary">Start camera</button>
        <input type="file" id="mocap-file-input" accept="video/*" hidden>
        <input type="file" id="anim-file-input" accept=".bvh,.vrma,.fbx" hidden>

        <div class="capture-status">
          <span id="mocap-status-label">📷 Camera off</span>
          <span id="mocap-frames" style="opacity:.55"></span>
        </div>
        <div class="capture-status" style="margin-top:-2px">
          <span id="mocap-source-info" style="opacity:.45;font-size:10px"></span>
        </div>

        <button id="capture-stop-cam-btn" class="dbg-toggle off" style="display:none;width:100%">Stop camera</button>

        <div class="dbg-row" id="mocap-playback-row" style="display:none;gap:3px;justify-content:flex-start;margin-top:4px">
          <button class="dbg-toggle" id="mocap-pause-btn" title="Pause / resume">⏸</button>
          <button class="dbg-toggle off" id="mocap-step-back-btn" title="Step -1 frame">⏮</button>
          <button class="dbg-toggle off" id="mocap-step-fwd-btn"  title="Step +1 frame">⏭</button>
          <button class="dbg-toggle off" id="mocap-grab-btn"      title="Grab current pose">💾</button>
          <button class="dbg-toggle off" id="mocap-flush-btn"     title="Download captured BVH">⬇</button>
        </div>

        <details class="capture-advanced">
          <summary>Advanced…</summary>
          <div class="dbg-row">
            <span class="dbg-label">📤 Single pose</span>
            <button class="dbg-toggle off" id="mocap-export-pose-btn" title="Download current avatar pose as a 1-frame BVH">Export .bvh</button>
          </div>
        </details>
      </div>

      <div class="dbg-divider"></div>

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
      </div>

      <details class="dbg-fold" id="fold-cal-tuning">
        <summary>Calibration tuning</summary>
        <div class="dbg-section">
          <div class="dbg-row">
            <span class="dbg-label">🦴 Hips = shoulders</span>
            <div style="display:flex;gap:3px">
              <button class="dbg-toggle off" id="rig-hip-equal-btn" title="Move upper-leg roots so hip width equals shoulder width">OFF</button>
              <button class="dbg-toggle off" id="hip-diag-btn" title="Dump rig + mocap state for the leg/hip pipeline">🔬 Diag</button>
            </div>
          </div>
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
            <span class="dbg-label">🦵 Leg spread × <span id="mocap-legspread-val">1.00</span></span>
            <input type="range" id="mocap-legspread-slider" min="0.5" max="2" step="0.05" value="1" style="flex:1;margin-left:8px" title="Fan feet outward — compensates avatars whose rest hips are wider than the performer's projected hips">
          </div>
          <div class="dbg-row">
            <span class="dbg-label">🔍 Dump to console</span>
            <button class="dbg-toggle" id="cal-dump-btn" title="Log full performer+avatar skeleton comparison">Dump</button>
          </div>
          <div class="dbg-row">
            <span class="dbg-label">📊 Skeleton info</span>
            <button class="dbg-toggle off" id="skel-info-btn">View</button>
          </div>
        </div>
      </details>

      <details class="dbg-fold" id="fold-smoothing">
        <summary>Smoothing</summary>
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
      </details>

      <details class="dbg-fold" id="fold-depth">
        <summary>Depth &amp; pose shape</summary>
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
      </details>

      <details class="dbg-fold" id="fold-roundtrip">
        <summary>Round-trip verify <span id="bvh-verify-state" style="opacity:.5;text-transform:none;letter-spacing:0"></span></summary>
        <div class="dbg-section">
          <div class="dbg-row">
            <span class="dbg-label">Source</span>
            <div style="display:flex;gap:3px">
              <button class="dbg-toggle off" id="bvh-verify-btn"      title="Live camera: record 3s → replay the BVH → diff each frame">Live (3s)</button>
              <button class="dbg-toggle off" id="bvh-verify-file-btn" title="Video file: process → replay BVH → diff each frame">Video…</button>
              <input type="file" id="bvh-verify-file-input" accept="video/*" hidden>
            </div>
          </div>
          <div class="dbg-row">
            <span class="dbg-label" style="opacity:.7;font-size:11px">↳ replay mode</span>
            <div style="display:flex;gap:3px">
              <button class="dbg-toggle"     data-verify-mode="prod" title="Play through the live render loop (validator.clampAll + vrm.update). Catches production-path divergence.">prod</button>
              <button class="dbg-toggle off" data-verify-mode="iso"  title="Scratch mixer + synchronous replay. Isolates BVH encoding math.">iso</button>
            </div>
          </div>
        </div>
      </details>

      <div class="dbg-hint">Recorded BVH auto-replays on the model for comparison</div>
    `;
}
