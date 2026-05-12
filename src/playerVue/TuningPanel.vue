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

import { ref, reactive, onMounted, watch } from 'vue';
import type { MocapController } from '../mocap/pipeline/mocapController';
import CalibrationBlock from './CalibrationBlock.vue';

const props = defineProps<{
  getMocap: () => MocapController | null;
}>();

const emit = defineEmits<{
  /** Bubble up the live calibration-status element from CalibrationBlock so
   *  debugPanel.ts can wire mocap.onCalibrationChange to its textContent. */
  (e: 'calibrationMounted', handles: { calibStat: HTMLElement }): void;
}>();

function onCalibrationMounted(handles: { calibStat: HTMLElement }): void {
  emit('calibrationMounted', handles);
}

// ── Smoothing / Depth sliders (inlined here instead of wrapped in a
// separate component — they're independent triples of `<input range>`
// with a value setter; nothing meaningful to factor out). ───────────────
const spineSm   = ref(0.25);
const limbSm    = ref(0.70);
const poleSm    = ref(0.60);
const armZ      = ref(1.00);
const armPoleZ  = ref(0.50);
const visThresh = ref(0.30);
const shoulderSpread = ref(0);

function onSpineSm(): void   { props.getMocap()?.setSpineSmoothing(spineSm.value); }
function onLimbSm(): void    { props.getMocap()?.setBodySmoothing(limbSm.value); }
function onPoleSm(): void    { props.getMocap()?.setPoleSmoothing(poleSm.value); }
function onArmZ(): void      { props.getMocap()?.setArmZAttenuation(armZ.value); }
function onArmPoleZ(): void  { props.getMocap()?.setArmPoleZ(armPoleZ.value); }
function onVisThresh(): void { props.getMocap()?.setVisibilityThreshold(visThresh.value); }
function onShoulderSpread(): void { props.getMocap()?.setShoulderSpread(shoulderSpread.value); }

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

    <!-- Calibration block — fully migrated (CalibrationBlock.vue handles
         the static block + the Calibration-tuning fold + Recal/Reset
         buttons + readiness bars + override sliders). -->
    <CalibrationBlock :getMocap="getMocap" @mounted="onCalibrationMounted" />

    <details
      class="dbg-fold"
      id="fold-smoothing"
      :open="foldOpen['fold-smoothing']"
      @toggle="onFoldToggle('fold-smoothing', $event)"
    >
      <summary>Smoothing</summary>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">🌀 Spine {{ spineSm.toFixed(2) }}</span>
          <input type="range" min="0.01" max="1" step="0.01"
                 v-model.number="spineSm" @input="onSpineSm"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🫨 Limb {{ limbSm.toFixed(2) }}</span>
          <input type="range" min="0.01" max="1" step="0.01"
                 v-model.number="limbSm" @input="onLimbSm"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🧲 Pole {{ poleSm.toFixed(2) }}</span>
          <input type="range" min="0.01" max="1" step="0.01"
                 v-model.number="poleSm" @input="onPoleSm"
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
          <span class="dbg-label">🫙 Arm Z target {{ armZ.toFixed(2) }}</span>
          <input type="range" min="0" max="1" step="0.01"
                 v-model.number="armZ" @input="onArmZ"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🧭 Arm pole Z {{ armPoleZ.toFixed(2) }}</span>
          <input type="range" min="0" max="1" step="0.01"
                 v-model.number="armPoleZ" @input="onArmPoleZ"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">👁 Vis threshold {{ visThresh.toFixed(2) }}</span>
          <input type="range" min="0" max="1" step="0.01"
                 v-model.number="visThresh" @input="onVisThresh"
                 style="flex:1;margin-left:8px">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">↔ Shoulder spread {{ shoulderSpread.toFixed(0) }}°</span>
          <input type="range" min="-20" max="20" step="1"
                 v-model.number="shoulderSpread" @input="onShoulderSpread"
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
