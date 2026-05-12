<script setup lang="ts">
/**
 * Vue replacement for `buildTuningPanelHtml()` — the right-hand panel
 * that contains capture controls, calibration, smoothing/depth sliders,
 * and round-trip-verify tooling.
 *
 * Same bridge-migration strategy as DebugPanelRoot.vue: structure in Vue
 * (with reactive fold open-state shared via injection from the global
 * fold map), behaviour still driven by the existing imperative wirings
 * (wireMocapControls, wireDebugPanelCalibration, wireHipsEqualsAndDiagModal,
 * wireDebugPanelMocapParams, the smoothing/depth slider wirings) which
 * find elements by ID after mount.
 *
 * Fold persistence reads from the same localStorage key the main debug
 * panel uses so the user's open/closed preferences are coherent across
 * both panels.
 */

import { reactive, onMounted, watch } from 'vue';

const FOLD_KEY = 'vrm-player.dbg-fold';
const foldOpen = reactive<Record<string, boolean>>({});
try {
  const raw = localStorage.getItem(FOLD_KEY);
  if (raw) Object.assign(foldOpen, JSON.parse(raw));
} catch { /* ignore */ }
watch(foldOpen, (next) => {
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}, { deep: true });

function onFoldToggle(id: string, e: Event): void {
  foldOpen[id] = (e.target as HTMLDetailsElement).open;
}

onMounted(() => {
  for (const id in foldOpen) {
    const el = document.getElementById(id) as HTMLDetailsElement | null;
    if (el && foldOpen[id]) el.open = true;
  }
});
</script>

<template>
  <div>
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

      <button id="capture-stop-cam-btn" class="dbg-toggle off"
              style="display:none;width:100%">Stop camera</button>

      <div class="dbg-row" id="mocap-playback-row"
           style="display:none;gap:3px;justify-content:flex-start;margin-top:4px">
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
          <button class="dbg-toggle off" id="mocap-export-pose-btn"
                  title="Download current avatar pose as a 1-frame BVH">Export .bvh</button>
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

    <details
      class="dbg-fold"
      id="fold-cal-tuning"
      :open="foldOpen['fold-cal-tuning']"
      @toggle="onFoldToggle('fold-cal-tuning', $event)"
    >
      <summary>Calibration tuning</summary>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">🦴 Hips = shoulders</span>
          <div style="display:flex;gap:3px">
            <button class="dbg-toggle off" id="rig-hip-equal-btn"
                    title="Move upper-leg roots so hip width equals shoulder width">OFF</button>
            <button class="dbg-toggle off" id="hip-diag-btn"
                    title="Dump rig + mocap state for the leg/hip pipeline">🔬 Diag</button>
          </div>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🔗 Unify arm max</span>
          <button class="dbg-toggle off" id="cal-unify-btn"
                  title="Share performer arm max between L/R">OFF</button>
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
          <input type="range" id="cal-hipgate-slider" min="0.1" max="0.9" step="0.05" value="0.4"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">📐 Shoulder × <span id="cal-sh-val">1.00</span></span>
          <input type="range" id="cal-sh-slider" min="0.5" max="2" step="0.05" value="1"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🦾 L arm × <span id="cal-la-val">1.00</span></span>
          <input type="range" id="cal-la-slider" min="0.5" max="2" step="0.05" value="1"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🦾 R arm × <span id="cal-ra-val">1.00</span></span>
          <input type="range" id="cal-ra-slider" min="0.5" max="2" step="0.05" value="1"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🦵 Leg spread × <span id="mocap-legspread-val">1.00</span></span>
          <input type="range" id="mocap-legspread-slider" min="0.5" max="2" step="0.05" value="1"
                 style="flex:1;margin-left:8px"
                 title="Fan feet outward — compensates avatars whose rest hips are wider than the performer's projected hips">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🔍 Dump to console</span>
          <button class="dbg-toggle" id="cal-dump-btn"
                  title="Log full performer+avatar skeleton comparison">Dump</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">📊 Skeleton info</span>
          <button class="dbg-toggle off" id="skel-info-btn">View</button>
        </div>
      </div>
    </details>

    <details
      class="dbg-fold"
      id="fold-smoothing"
      :open="foldOpen['fold-smoothing']"
      @toggle="onFoldToggle('fold-smoothing', $event)"
    >
      <summary>Smoothing</summary>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">🌀 Spine <span id="mocap-spine-val">0.25</span></span>
          <input type="range" id="mocap-spine-slider" min="0.01" max="1" step="0.01" value="0.25"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🫨 Limb <span id="mocap-smooth-val">0.70</span></span>
          <input type="range" id="mocap-smooth-slider" min="0.01" max="1" step="0.01" value="0.7"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🧲 Pole <span id="mocap-pole-val">0.60</span></span>
          <input type="range" id="mocap-pole-slider" min="0.01" max="1" step="0.01" value="0.6"
                 style="flex:1;margin-left:8px">
        </div>
      </div>
    </details>

    <details
      class="dbg-fold"
      id="fold-depth"
      :open="foldOpen['fold-depth']"
      @toggle="onFoldToggle('fold-depth', $event)"
    >
      <summary>Depth &amp; pose shape</summary>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">🫙 Arm Z target <span id="mocap-armz-val">1.00</span></span>
          <input type="range" id="mocap-armz-slider" min="0" max="1" step="0.01" value="1"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🧭 Arm pole Z <span id="mocap-polez-val">0.50</span></span>
          <input type="range" id="mocap-polez-slider" min="0" max="1" step="0.01" value="0.5"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">👁 Vis threshold <span id="mocap-vis-val">0.30</span></span>
          <input type="range" id="mocap-vis-slider" min="0" max="1" step="0.01" value="0.3"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">↔ Shoulder spread <span id="mocap-spread-val">0°</span></span>
          <input type="range" id="mocap-spread-slider" min="-20" max="20" step="1" value="0"
                 style="flex:1;margin-left:8px">
        </div>
      </div>
    </details>

    <details
      class="dbg-fold"
      id="fold-roundtrip"
      :open="foldOpen['fold-roundtrip']"
      @toggle="onFoldToggle('fold-roundtrip', $event)"
    >
      <summary>Round-trip verify <span id="bvh-verify-state"
        style="opacity:.5;text-transform:none;letter-spacing:0"></span></summary>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">Source</span>
          <div style="display:flex;gap:3px">
            <button class="dbg-toggle off" id="bvh-verify-btn"
                    title="Live camera: record 3s → replay the BVH → diff each frame">Live (3s)</button>
            <button class="dbg-toggle off" id="bvh-verify-file-btn"
                    title="Video file: process → replay BVH → diff each frame">Video…</button>
            <input type="file" id="bvh-verify-file-input" accept="video/*" hidden>
          </div>
        </div>
        <div class="dbg-row">
          <span class="dbg-label" style="opacity:.7;font-size:11px">↳ replay mode</span>
          <div style="display:flex;gap:3px">
            <button class="dbg-toggle"     data-verify-mode="prod"
                    title="Play through the live render loop (validator.clampAll + vrm.update). Catches production-path divergence.">prod</button>
            <button class="dbg-toggle off" data-verify-mode="iso"
                    title="Scratch mixer + synchronous replay. Isolates BVH encoding math.">iso</button>
          </div>
        </div>
      </div>
    </details>

    <div class="dbg-hint">Recorded BVH auto-replays on the model for comparison</div>
  </div>
</template>
