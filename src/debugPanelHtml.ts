import type { IdleLoop } from './idleLoop';

export function buildMainPanelHtml(idle: IdleLoop): string {
  return `
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
        <span class="dbg-label">📐 Depth</span>
        <div style="display:flex;gap:3px">
          <button class="dbg-toggle off" data-depth="0">2D</button>
          <button class="dbg-toggle off" data-depth="0.5">mid</button>
          <button class="dbg-toggle"     data-depth="1">3D</button>
        </div>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🔬 BVH диагностика</span>
        <button class="dbg-toggle off" id="bvh-diag-btn">Inspect</button>
      </div>
      <div class="dbg-hint">Detailed tuning sliders are in the panel on the right →</div>
    </div>
    </div>
  `;
}

export function buildTuningPanelHtml(): string {
  return `
      <p class="panel-title"><span>Mocap tuning</span></p>

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
          <span class="dbg-label">📤 Current pose</span>
          <button class="dbg-toggle off" id="mocap-export-pose-btn" title="Download current avatar pose as a 1-frame BVH">Export .bvh</button>
        </div>
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
