<script setup lang="ts">
/**
 * Replaces `wireDebugPanelCalibration` (199 LOC). Lives in TuningPanel.
 *
 * Self-contained: owns BOTH the static block (recal/reset/readiness)
 * AND the Calibration-tuning fold. The fold is rendered as a native
 * `<details>` inside this component so the Reset button can mutate
 * the slider state directly via local refs — no cross-component
 * coordination needed.
 *
 * Fold open-state persisted to the same `vrm-player.dbg-fold` localStorage
 * key the other folds use, so user preferences stay coherent.
 *
 * Hips-equals / hip-diag buttons and the Skeleton-info button keep
 * their original IDs because wireHipsEqualsAndDiagModal and
 * mountSkelModal still own them (those modals haven't migrated yet).
 */

import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { MocapController } from '../mocap/pipeline/mocapController';

const props = defineProps<{
  getMocap: () => MocapController | null;
  /** Opens the hip/leg diagnostics modal. Provided by the host so the modal
   *  can live as a sibling Vue island (mounted at <body> level). */
  onHipDiag?: () => void;
}>();

const emit = defineEmits<{
  /** Bubbles up the live calibration-status text element so debugPanel.ts
   *  can wire mocap.onCalibrationChange to mutate its textContent. */
  (e: 'mounted', handles: { calibStat: HTMLElement }): void;
  /** Fires whenever the hips=shoulders toggle changes, so the diagnostics
   *  dump can include the current button state + prevSpread. */
  (e: 'hipsEqualsChanged', state: { buttonState: string; prevSpreadBeforeToggle: number | null }): void;
}>();

// ── Readiness bars ────────────────────────────────────────────────────────
interface ReadinessRow { key: string; label: string; pct: number; state: 'idle' | 'partial' | 'ready' }
const readiness = ref<ReadinessRow[]>([
  { key: 'shoulders', label: '📐 Shoulders', pct: 0, state: 'idle' },
  { key: 'hips',      label: '🦴 Hips',      pct: 0, state: 'idle' },
  { key: 'armL',      label: '🦾 Arm L',     pct: 0, state: 'idle' },
  { key: 'armR',      label: '🦾 Arm R',     pct: 0, state: 'idle' },
  { key: 'legs',      label: '🦵 Legs',      pct: 0, state: 'idle' },
]);

const calibStatRef = ref<HTMLElement | null>(null);

let pollTimer = 0;
onMounted(() => {
  pollTimer = window.setInterval(() => {
    const m = props.getMocap();
    if (!m) return;
    const r = m.calibration.readiness() as Record<string, number>;
    for (const row of readiness.value) {
      const v = r[row.key] ?? 0;
      row.pct = Math.round(v * 100);
      row.state = v >= 0.9 ? 'ready' : v >= 0.2 ? 'partial' : 'idle';
    }
  }, 200);

  if (calibStatRef.value) emit('mounted', { calibStat: calibStatRef.value });
  window.dumpSkeleton = doDump;
});
onUnmounted(() => {
  clearInterval(pollTimer);
  if (window.dumpSkeleton === doDump) delete window.dumpSkeleton;
});

// ── Static actions ────────────────────────────────────────────────────────
function recalibrate(): void { props.getMocap()?.recalibrate(); }
function doDump(): void {
  const m = props.getMocap();
  if (!m) { console.warn('[mocap] not initialised'); return; }
  m.dumpSkeleton();
}

// ── Unify arm max + scale ref ─────────────────────────────────────────────
const unifyArmMax = ref(false);
function toggleUnify(): void {
  const m = props.getMocap();
  if (!m) return;
  unifyArmMax.value = !m.calibration.unifyArmMax;
  m.calibration.setUnifyArmMax(unifyArmMax.value);
}

type ScaleRef = 'auto' | 'shoulders' | 'hips' | 'head' | 'median';
const scaleRef = ref<ScaleRef>('auto');
function setScaleRef(r: ScaleRef): void {
  scaleRef.value = r;
  props.getMocap()?.calibration.setScaleRef(r);
}
const scaleRefLabel = (r: ScaleRef): string =>
  r === 'shoulders' ? 'shlds' : r === 'median' ? 'med' : r;

// ── Sliders ───────────────────────────────────────────────────────────────
const hipGate    = ref(0.4);
const shOverride = ref(1);
const laOverride = ref(1);
const raOverride = ref(1);
const legSpread  = ref(1);

function onHipGate(): void   { props.getMocap()?.calibration.setHipVisGate(hipGate.value); }
function onShOver(): void    { props.getMocap()?.calibration.setOverride('shoulder',  shOverride.value); }
function onLaOver(): void    { props.getMocap()?.calibration.setOverride('leftArm',   laOverride.value); }
function onRaOver(): void    { props.getMocap()?.calibration.setOverride('rightArm',  raOverride.value); }
function onLegSpread(): void { props.getMocap()?.setLegSpreadX(legSpread.value); }

// ── Hips = shoulders width-override toggle ───────────────────────────────
// Was wireHipsEqualsAndDiagModal — pulled in here because it mutates the
// `legSpread` slider above. See debugPanelHipsModal.ts for the why-not-
// translate-bones explanation.
const hipsEqualActive   = ref(false);
const hipsEqualDisabled = ref(false);
const hipsEqualTitle    = ref('Move upper-leg roots so hip width equals shoulder width');
let prevSpread: number | null = null;

function emitHipsEqualsState(): void {
  emit('hipsEqualsChanged', {
    buttonState: hipsEqualActive.value ? 'ON' : 'OFF',
    prevSpreadBeforeToggle: prevSpread,
  });
}

function applySpread(v: number): void {
  legSpread.value = Math.max(0.5, Math.min(2, v));
  props.getMocap()?.setLegSpreadX(v);
}

function toggleHipsEqual(): void {
  const m = props.getMocap();
  if (!m) return;
  const vrm = m.vrm;
  const sL = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
  const sR = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
  if (!sL || !sR) {
    const missing = [!sL && 'leftUpperArm', !sR && 'rightUpperArm'].filter(Boolean).join(', ');
    console.warn(`[hip-equal] missing humanoid bone(s): ${missing}`);
    hipsEqualTitle.value = `Disabled — VRM missing: ${missing}`;
    hipsEqualDisabled.value = true;
    return;
  }

  hipsEqualActive.value = !hipsEqualActive.value;
  if (hipsEqualActive.value) {
    // See debugPanelHipsModal.ts for the legSpreadX-vs-bone-translation
    // rationale.
    const performerHipWidth = m.calibration.performerHipWidthMetric;
    const avatarHipWidth    = m.calibration.avatarHipWidth;
    if (performerHipWidth < 1e-4 || avatarHipWidth < 1e-4) {
      console.warn('[hip-equal] hip width measurement unavailable; skipping');
      hipsEqualActive.value = false;
      emitHipsEqualsState();
      return;
    }
    const ratio = avatarHipWidth / performerHipWidth;
    prevSpread = m.legSpreadX;
    applySpread(ratio);
  } else if (prevSpread != null) {
    applySpread(prevSpread);
    prevSpread = null;
  }
  emitHipsEqualsState();
}

function resetSliders(): void {
  const m = props.getMocap();
  shOverride.value = 1; m?.calibration.setOverride('shoulder', 1);
  laOverride.value = 1; m?.calibration.setOverride('leftArm',  1);
  raOverride.value = 1; m?.calibration.setOverride('rightArm', 1);
  legSpread.value  = 1; m?.setLegSpreadX(1);
}

// ── Fold open-state (shared localStorage key with the rest of the panel) ──
const FOLD_KEY = 'vrm-player.dbg-fold';
const FOLD_ID  = 'fold-cal-tuning';
const foldOpen = reactive<Record<string, boolean>>({});
try {
  const raw = localStorage.getItem(FOLD_KEY);
  if (raw) Object.assign(foldOpen, JSON.parse(raw));
} catch { /* ignore */ }
watch(foldOpen, (next) => {
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}, { deep: true });
function onFoldToggle(e: Event): void {
  foldOpen[FOLD_ID] = (e.target as HTMLDetailsElement).open;
}
</script>

<template>
  <!-- Static block (above the fold) ──────────────────────────────────────── -->
  <div class="dbg-section">
    <div class="dbg-row">
      <span class="dbg-label">📏 Calibration</span>
      <div style="display:flex;gap:3px">
        <button class="dbg-toggle off" @click="recalibrate">Recal</button>
        <button class="dbg-toggle off" title="Reset sliders to 1.00" @click="resetSliders">Reset</button>
      </div>
    </div>
    <div class="dbg-hint">Auto-scales each frame from hip width — no T-pose needed</div>
    <div ref="calibStatRef" class="dbg-stat">—</div>

    <div class="readiness-list">
      <div v-for="row in readiness" :key="row.key" class="cal-r-row">
        <span class="cal-r-label">{{ row.label }}</span>
        <div class="cal-r-bar">
          <div
            class="cal-r-fill"
            :class="{ ready: row.state === 'ready', partial: row.state === 'partial' }"
            :style="{ width: row.pct + '%' }"
          ></div>
        </div>
        <span class="cal-r-value">{{ row.pct }}%</span>
      </div>
    </div>
  </div>

  <!-- Calibration-tuning fold ────────────────────────────────────────────── -->
  <details
    class="dbg-fold"
    :id="FOLD_ID"
    :open="foldOpen[FOLD_ID]"
    @toggle="onFoldToggle"
  >
    <summary>Calibration tuning</summary>
    <div class="dbg-section">
      <!-- Hips-equals toggle (was wireHipsEqualsAndDiagModal). Diag button
           emits 'onHipDiag' upward so the modal Vue island can open. -->
      <div class="dbg-row">
        <span class="dbg-label">🦴 Hips = shoulders</span>
        <div style="display:flex;gap:3px">
          <button
            class="dbg-toggle"
            :class="{ off: !hipsEqualActive }"
            :disabled="hipsEqualDisabled"
            :title="hipsEqualTitle"
            @click="toggleHipsEqual"
          >{{ hipsEqualActive ? 'ON' : 'OFF' }}</button>
          <button
            class="dbg-toggle off"
            title="Dump rig + mocap state for the leg/hip pipeline"
            @click="onHipDiag?.()"
          >🔬 Diag</button>
        </div>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🔗 Unify arm max</span>
        <button
          class="dbg-toggle"
          :class="{ off: !unifyArmMax }"
          title="Share performer arm max between L/R"
          @click="toggleUnify"
        >{{ unifyArmMax ? 'ON' : 'OFF' }}</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">📍 Scale ref</span>
        <div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:flex-end">
          <button
            v-for="r in (['auto', 'median', 'head', 'shoulders', 'hips'] as const)"
            :key="r"
            class="dbg-toggle"
            :class="{ off: scaleRef !== r }"
            @click="setScaleRef(r)"
          >{{ scaleRefLabel(r) }}</button>
        </div>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🚪 Hip vis gate {{ hipGate.toFixed(2) }}</span>
        <input
          type="range" min="0.1" max="0.9" step="0.05"
          v-model.number="hipGate" @input="onHipGate"
          style="flex:1;margin-left:8px"
        >
      </div>
      <div class="dbg-row">
        <span class="dbg-label">📐 Shoulder × {{ shOverride.toFixed(2) }}</span>
        <input
          type="range" min="0.5" max="2" step="0.05"
          v-model.number="shOverride" @input="onShOver"
          style="flex:1;margin-left:8px"
        >
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🦾 L arm × {{ laOverride.toFixed(2) }}</span>
        <input
          type="range" min="0.5" max="2" step="0.05"
          v-model.number="laOverride" @input="onLaOver"
          style="flex:1;margin-left:8px"
        >
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🦾 R arm × {{ raOverride.toFixed(2) }}</span>
        <input
          type="range" min="0.5" max="2" step="0.05"
          v-model.number="raOverride" @input="onRaOver"
          style="flex:1;margin-left:8px"
        >
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🦵 Leg spread × {{ legSpread.toFixed(2) }}</span>
        <input
          type="range" min="0.5" max="2" step="0.05"
          v-model.number="legSpread" @input="onLegSpread"
          style="flex:1;margin-left:8px"
          title="Fan feet outward — compensates avatars whose rest hips are wider than the performer's projected hips"
        >
      </div>
      <div class="dbg-row">
        <span class="dbg-label">🔍 Dump to console</span>
        <button class="dbg-toggle" @click="doDump"
                title="Log full performer+avatar skeleton comparison">Dump</button>
      </div>
      <div class="dbg-row">
        <span class="dbg-label">📊 Skeleton info</span>
        <!-- skel-info-btn — id'd, owned by mountSkelModal. -->
        <button class="dbg-toggle off" id="skel-info-btn">View</button>
      </div>
    </div>
  </details>
</template>

<style scoped>
.readiness-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cal-r-row    { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.cal-r-label  { flex-shrink: 0; width: 72px; opacity: 0.65; }
.cal-r-bar    { flex: 1; height: 6px; background: rgba(255,255,255,0.07); border-radius: 3px; overflow: hidden; }
.cal-r-fill   { height: 100%; background: rgba(255,255,255,0.2); transition: width 200ms, background 200ms; }
.cal-r-fill.partial { background: #fbbf24; }
.cal-r-fill.ready   { background: #4ade80; }
.cal-r-value  { flex-shrink: 0; width: 32px; text-align: right;
                font-family: ui-monospace, "SF Mono", Menlo, monospace;
                font-size: 10px; opacity: 0.55; }
</style>
