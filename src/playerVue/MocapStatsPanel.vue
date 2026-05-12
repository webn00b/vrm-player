<script setup lang="ts">
/**
 * Replaces `wireDebugPanelMocapStats` — the "Mocap advanced" block of
 * the Video tab. ~190 LOC of getElementById + setInterval + textContent
 * mutations becomes ~120 LOC of reactive Vue state.
 *
 * What it owns:
 *   - Debug-skeleton overlay toggle (mirrors `mocapDebugViz.visible`)
 *   - Per-landmark visibility grid (33 landmarks × MediaPipe pose model)
 *   - Detector FPS counter (frame-identity diff over 500 ms window)
 *   - Scalar stats: calibration / scales / proportions / target reach /
 *     tracking health / input meta (hands / face / state / fps)
 *
 * Polling cadence matches the original: 100 ms fps counter (runs always
 * so toggle ON gives instant fps reading), 200 ms heavy stats (skipped
 * when toggle is OFF).
 */

import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import type { MocapController } from '../mocap/pipeline/mocapController';
import type { MocapDebugViz } from '../mocap/diagnostics/mocapDebugViz';
import { STAT_LANDMARKS } from '../mocap/diagnostics/mocapDebugViz';

const props = defineProps<{
  getMocap: () => MocapController | null;
  mocapDebugViz: MocapDebugViz;
}>();

// ── Toggle state ───────────────────────────────────────────────────────────
const dbgSkelOn = ref(false);
function toggleDbgSkel(): void {
  dbgSkelOn.value = !dbgSkelOn.value;
  props.mocapDebugViz.setVisible(dbgSkelOn.value);
}

// ── Per-landmark visibility badges ─────────────────────────────────────────
// Indexed map of "landmark idx → visibility %", or null if no data.
const visibility = reactive<Record<number, number | null>>({});
for (const { idx } of STAT_LANDMARKS) visibility[idx] = null;

const visColor = (v: number | null): string => {
  if (v === null) return '';
  if (v >= 0.6) return '#4ade80';
  if (v >= 0.3) return '#fbbf24';
  return '#f87171';
};
const visText = (v: number | null): string =>
  v === null ? '—' : `${Math.round(v * 100)}%`;

// ── Detector FPS counter ───────────────────────────────────────────────────
const fps = ref(0);

// ── Scalar stats — bundled into one reactive object ────────────────────────
interface ScalarStats {
  calibrated: boolean;
  bodyScale: number;
  shoulderWidthScale: number;
  leftArmScale: number;
  rightArmScale: number;
  legScale: number;
  reach:  { armL: number; armR: number; legL: number; legR: number };
  hasArm: boolean;
  hasLeg: boolean;
  trackHealth: {
    leftArm:  { phase: string; msSinceLoss: number };
    rightArm: { phase: string; msSinceLoss: number };
    leftLeg:  { phase: string; msSinceLoss: number };
    rightLeg: { phase: string; msSinceLoss: number };
    hips:     { phase: string; msSinceLoss: number };
    spine:    { phase: string; msSinceLoss: number };
  };
  hands:  string;
  face:   number;
  state:  string;
  bvhRec:  number;
  bvhGrab: number;
}

const stats = ref<ScalarStats | null>(null);
const avgVis = ref(0);

// Derived from `stats` — pull the scale factors as percentages.
const scalePct = computed(() => {
  if (!stats.value) return null;
  const s = stats.value;
  return {
    body:  (s.bodyScale * 100).toFixed(0),
    armL:  (s.leftArmScale * 100).toFixed(0),
    armR:  (s.rightArmScale * 100).toFixed(0),
    leg:   (s.legScale * 100).toFixed(0),
    shldr: (s.shoulderWidthScale * 100).toFixed(0),
    // Proportions (perf/avatar) — inverse of scale.
    propBody: (s.bodyScale > 0 ? (1 / s.bodyScale) * 100 : 0).toFixed(0),
    propArmL: (s.leftArmScale  > 0 ? (1 / s.leftArmScale)  * 100 : 0).toFixed(0),
    propArmR: (s.rightArmScale > 0 ? (1 / s.rightArmScale) * 100 : 0).toFixed(0),
  };
});

// Target reach % color thresholds — green < 90 < amber ≤ 100 < red.
const fitColor = (pct: number): string =>
  pct < 90 ? '#4ade80' : pct <= 100 ? '#fbbf24' : '#f87171';

// Tracking-health phase color.
const phaseColor = (phase: string): string => {
  if (phase === 'live')       return '#4ade80';
  if (phase === 'recovering') return '#86efac';
  if (phase === 'fresh')      return '#fbbf24';
  if (phase === 'decaying')   return '#fb923c';
  return '#f87171';  // rested
};
const phaseLabel = (chain: { phase: string; msSinceLoss: number }): string => {
  if (chain.phase === 'live' || chain.phase === 'recovering') return chain.phase;
  return `${chain.phase} (${(chain.msSinceLoss / 1000).toFixed(1)}s)`;
};

// ── Poll loops ─────────────────────────────────────────────────────────────
// FPS — always-on at 100 ms so the count is instant when user toggles ON.
let fpsTimer = 0;
let fpsFrames = 0;
let fpsWindowStart = performance.now();
let prevFrameRef: unknown = null;

function fpsTick(): void {
  const frame = props.getMocap()?.latestFrame;
  if (frame && frame !== prevFrameRef) {
    fpsFrames++;
    prevFrameRef = frame;
  }
  const now = performance.now();
  const dt = now - fpsWindowStart;
  if (dt >= 500) {
    fps.value = (fpsFrames * 1000) / dt;
    fpsFrames = 0;
    fpsWindowStart = now;
  }
}

// Heavy stats — only refresh while toggle is ON.
let statsTimer = 0;
function statsTick(): void {
  if (!dbgSkelOn.value) return;
  const m = props.getMocap();
  const frame = m?.latestFrame;
  if (!m || !frame) {
    stats.value = null;
    return;
  }

  // Per-landmark visibility.
  let visSum = 0, visCount = 0;
  for (const { idx } of STAT_LANDMARKS) {
    const lm = frame.landmarks[idx];
    const v  = lm?.visibility ?? null;
    visibility[idx] = v;
    if (v !== null) { visSum += v; visCount++; }
  }
  avgVis.value = visCount ? (visSum / visCount) : 0;

  // Scalar stats.
  const cal = m.calibration;
  const st  = cal.status();
  stats.value = {
    calibrated:         st.calibrated,
    bodyScale:          st.bodyScale,
    shoulderWidthScale: st.shoulderWidthScale,
    leftArmScale:       st.leftArmScale,
    rightArmScale:      st.rightArmScale,
    legScale:           cal.legScale(),
    reach:              m.getReachPercent(),
    hasArm:             m.debugTargets.hasArm,
    hasLeg:             m.debugTargets.hasLeg,
    trackHealth:        m.getTrackingHealth(),
    hands:              frame.hands.map((h) => h.side).sort().join('+') || '—',
    face:               frame.faceLandmarks?.length ?? 0,
    state:              m.state,
    bvhRec:             m.recordingFrameCount,
    bvhGrab:            m.grabbedFrameCount,
  };
}

onMounted(() => {
  fpsTimer = window.setInterval(fpsTick, 100);
  statsTimer = window.setInterval(statsTick, 200);
});
onUnmounted(() => {
  clearInterval(fpsTimer);
  clearInterval(statsTimer);
});
</script>

<template>
  <div class="dbg-row">
    <span class="dbg-label">🟢 Performer skeleton</span>
    <button
      class="dbg-toggle"
      :class="{ off: !dbgSkelOn }"
      @click="toggleDbgSkel"
    >{{ dbgSkelOn ? 'ON' : 'OFF' }}</button>
  </div>

  <!-- Per-landmark visibility grid — only when toggle is ON ─────────── -->
  <div
    v-show="dbgSkelOn"
    class="vis-grid"
  >
    <div
      v-for="{ idx, label } in STAT_LANDMARKS"
      :key="idx"
      class="vis-row"
    >
      <span class="vis-label">{{ label }}</span>
      <span :style="{ color: visColor(visibility[idx]) }">{{ visText(visibility[idx]) }}</span>
    </div>
  </div>

  <!-- Scalar stats block — only when toggle is ON ──────────────────── -->
  <div
    v-show="dbgSkelOn"
    class="scalar-stats"
  >
    <template v-if="stats && scalePct">
      <div class="stat-row">
        <span class="stat-key">🧭 Calibrated</span>
        <span :style="{ color: stats.calibrated ? '#4ade80' : '#f87171' }">{{ stats.calibrated ? 'yes' : 'no' }}</span>
      </div>
      <div class="stat-row"><span class="stat-key">📏 Body scale</span><span>{{ scalePct.body }}%</span></div>
      <div class="stat-row"><span class="stat-key">📐 Shoulder scl</span><span>{{ scalePct.shldr }}%</span></div>
      <div class="stat-row"><span class="stat-key">🦾 Arm L / R</span><span>{{ scalePct.armL }}% / {{ scalePct.armR }}%</span></div>
      <div class="stat-row"><span class="stat-key">🦵 Leg scale</span><span>{{ scalePct.leg }}%</span></div>

      <div class="sub-header">— proportions (perf/avatar) —</div>
      <div class="stat-row"><span class="stat-key">🧍 Body</span><span>{{ scalePct.propBody }}%</span></div>
      <div class="stat-row"><span class="stat-key">🦾 Arm L / R</span><span>{{ scalePct.propArmL }}% / {{ scalePct.propArmR }}%</span></div>

      <div class="sub-header">— target reach (% of limb) —</div>
      <div class="stat-row">
        <span class="stat-key">✋ L arm</span>
        <span v-if="stats.hasArm" :style="{ color: fitColor(stats.reach.armL) }">{{ stats.reach.armL.toFixed(0) }}%</span>
        <span v-else>—</span>
      </div>
      <div class="stat-row">
        <span class="stat-key">✋ R arm</span>
        <span v-if="stats.hasArm" :style="{ color: fitColor(stats.reach.armR) }">{{ stats.reach.armR.toFixed(0) }}%</span>
        <span v-else>—</span>
      </div>
      <div class="stat-row">
        <span class="stat-key">🦶 L leg</span>
        <span v-if="stats.hasLeg" :style="{ color: fitColor(stats.reach.legL) }">{{ stats.reach.legL.toFixed(0) }}%</span>
        <span v-else>—</span>
      </div>
      <div class="stat-row">
        <span class="stat-key">🦶 R leg</span>
        <span v-if="stats.hasLeg" :style="{ color: fitColor(stats.reach.legR) }">{{ stats.reach.legR.toFixed(0) }}%</span>
        <span v-else>—</span>
      </div>

      <div class="sub-header">— tracking health —</div>
      <div class="stat-row"><span class="stat-key">🦾 L arm</span>
        <span :style="{ color: phaseColor(stats.trackHealth.leftArm.phase) }">{{ phaseLabel(stats.trackHealth.leftArm) }}</span>
      </div>
      <div class="stat-row"><span class="stat-key">🦾 R arm</span>
        <span :style="{ color: phaseColor(stats.trackHealth.rightArm.phase) }">{{ phaseLabel(stats.trackHealth.rightArm) }}</span>
      </div>
      <div class="stat-row"><span class="stat-key">🦵 L leg</span>
        <span :style="{ color: phaseColor(stats.trackHealth.leftLeg.phase) }">{{ phaseLabel(stats.trackHealth.leftLeg) }}</span>
      </div>
      <div class="stat-row"><span class="stat-key">🦵 R leg</span>
        <span :style="{ color: phaseColor(stats.trackHealth.rightLeg.phase) }">{{ phaseLabel(stats.trackHealth.rightLeg) }}</span>
      </div>
      <div class="stat-row"><span class="stat-key">🧍 Hips</span>
        <span :style="{ color: phaseColor(stats.trackHealth.hips.phase) }">{{ phaseLabel(stats.trackHealth.hips) }}</span>
      </div>
      <div class="stat-row"><span class="stat-key">〰 Spine</span>
        <span :style="{ color: phaseColor(stats.trackHealth.spine.phase) }">{{ phaseLabel(stats.trackHealth.spine) }}</span>
      </div>

      <div class="sub-header">— input —</div>
      <div class="stat-row"><span class="stat-key">✋ Hands</span><span>{{ stats.hands }}</span></div>
      <div class="stat-row"><span class="stat-key">😶 Face pts</span><span>{{ stats.face || '—' }}</span></div>
      <div class="stat-row"><span class="stat-key">👁 Avg vis</span><span>{{ Math.round(avgVis * 100) }}%</span></div>
      <div class="stat-row"><span class="stat-key">⏱ Detector fps</span><span>{{ fps.toFixed(1) }}</span></div>
      <div class="stat-row"><span class="stat-key">📼 BVH rec/grab</span><span>{{ stats.bvhRec }}/{{ stats.bvhGrab }}</span></div>
      <div class="stat-row"><span class="stat-key">▶ State</span><span>{{ stats.state }}</span></div>
    </template>
  </div>
</template>

<style scoped>
.vis-grid {
  font-size: 10px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 6px;
  margin-top: 4px;
}
.vis-row {
  display: flex;
  justify-content: space-between;
  gap: 4px;
}
.vis-label { opacity: 0.45; }

.scalar-stats {
  margin-top: 6px;
  font-size: 10px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  opacity: 0.75;
  line-height: 1.5;
}
.stat-row {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.stat-key { opacity: 0.5; }
.sub-header {
  margin-top: 6px;
  opacity: 0.5;
  font-size: 9px;
}
</style>
