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
import type { VRM } from '@pixiv/three-vrm';
import type { MocapController } from '../mocap/pipeline/mocapController';
import type { AnimationController } from '../animationController';
import type { MocapDebugRecorder } from '../mocap/diagnostics/mocapDebugRecorder';
import CalibrationBlock from './CalibrationBlock.vue';
import BvhVerifyFold from './BvhVerifyFold.vue';
import CaptureSection from './CaptureSection.vue';

const props = defineProps<{
  getMocap: () => MocapController | null;
  /** Open the hip/leg diagnostics modal — forwarded to CalibrationBlock. */
  onHipDiag?: () => void;
  /** Mocap + related systems for the Capture section (full migration of
   *  the old wireMocapControls deps). */
  mocap: MocapController;
  mocapVrm: VRM;
  getController: () => AnimationController | null;
  dbgRecorder: MocapDebugRecorder;
  /** Wired in main.ts: imports a picked .bvh/.vrma/.fbx onto the queue. */
  onAnimFile?: (file: File) => Promise<void> | void;
}>();

const emit = defineEmits<{
  /** Bubble up the live calibration-status element from CalibrationBlock so
   *  debugPanel.ts can wire mocap.onCalibrationChange to its textContent. */
  (e: 'calibrationMounted', handles: { calibStat: HTMLElement }): void;
  /** Bubble up the hips=shoulders toggle state for the hip diag modal. */
  (e: 'hipsEqualsChanged', state: { buttonState: string; prevSpreadBeforeToggle: number | null }): void;
}>();

function onCalibrationMounted(handles: { calibStat: HTMLElement }): void {
  emit('calibrationMounted', handles);
}
function onHipsEqualsChanged(state: { buttonState: string; prevSpreadBeforeToggle: number | null }): void {
  emit('hipsEqualsChanged', state);
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
    <!-- Capture — fully migrated (CaptureSection.vue owns source-control,
         primary CTA, file inputs, playback row, advanced fold, AND the
         mocap state-change / error wiring). Replaces wireMocapControls. -->
    <CaptureSection
      :mocap="mocap"
      :mocapVrm="mocapVrm"
      :getMocap="getMocap"
      :getController="getController"
      :dbgRecorder="dbgRecorder"
      :onAnimFile="onAnimFile"
    />

    <div class="dbg-divider"></div>

    <!-- Calibration block — fully migrated (CalibrationBlock.vue handles
         the static block + the Calibration-tuning fold + Recal/Reset
         buttons + readiness bars + override sliders). -->
    <CalibrationBlock
      :getMocap="getMocap"
      :onHipDiag="onHipDiag"
      @mounted="onCalibrationMounted"
      @hips-equals-changed="onHipsEqualsChanged"
    />

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
                 class="dbg-slider">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🫨 Limb {{ limbSm.toFixed(2) }}</span>
          <input type="range" min="0.01" max="1" step="0.01"
                 v-model.number="limbSm" @input="onLimbSm"
                 class="dbg-slider">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🧲 Pole {{ poleSm.toFixed(2) }}</span>
          <input type="range" min="0.01" max="1" step="0.01"
                 v-model.number="poleSm" @input="onPoleSm"
                 class="dbg-slider">
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
                 class="dbg-slider">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🧭 Arm pole Z {{ armPoleZ.toFixed(2) }}</span>
          <input type="range" min="0" max="1" step="0.01"
                 v-model.number="armPoleZ" @input="onArmPoleZ"
                 class="dbg-slider">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">👁 Vis threshold {{ visThresh.toFixed(2) }}</span>
          <input type="range" min="0" max="1" step="0.01"
                 v-model.number="visThresh" @input="onVisThresh"
                 class="dbg-slider">
        </div>
        <div class="dbg-row">
          <span class="dbg-label">↔ Shoulder spread {{ shoulderSpread.toFixed(0) }}°</span>
          <input type="range" min="-20" max="20" step="1"
                 v-model.number="shoulderSpread" @input="onShoulderSpread"
                 class="dbg-slider">
        </div>
      </div>
    </details>

    <!-- Round-trip verify — fully migrated (BvhVerifyFold.vue owns fold +
         state machine + inline PrimeVue Dialog). Replaces mountBvhVerifyModal. -->
    <BvhVerifyFold :getMocap="getMocap" />

    <div class="dbg-hint">Recorded BVH auto-replays on the model for comparison</div>
  </div>
</template>
