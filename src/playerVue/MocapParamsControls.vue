<script setup lang="ts">
/**
 * Replaces `wireDebugPanelMocapParams` (133 LOC of click handlers +
 * manual classList toggles + dataset lookups).
 *
 * Renders into the Video tab body of the main debug panel:
 *   - Pose model quality (lite / full / heavy) — async, disables buttons
 *     during model swap; refuses to switch when mocap is non-idle.
 *   - Mirror / Face / Hip-position / Symmetry-fallback / 1€-smoothing
 *     ON/OFF toggles
 *   - Hand-priority checkbox (with mirror to MocapController state)
 *   - Depth segmented control (2D / mid / 3D)
 *
 * Initial state is read from `getMocap()` on mount; subsequent toggles
 * mutate both the local Vue ref and the controller setter (single
 * source of truth is still the controller — we just mirror).
 */

import { ref, onMounted } from 'vue';
import type { MocapController } from '../mocap/pipeline/mocapController';

const props = defineProps<{
  getMocap: () => MocapController | null;
}>();

// ── Reactive mirrors of MocapController state ──────────────────────────
const poseQuality       = ref<'lite' | 'full' | 'heavy'>('full');
const poseQualityBusy   = ref(false);
const mirrorX           = ref(true);
const symmetryFallback  = ref(false);
const faceTracking      = ref(true);
const hipPosition       = ref(true);
const oneEuroFilter     = ref(true);
const handPriority      = ref(true);
const depthScale        = ref<0 | 0.5 | 1>(1);

onMounted(() => {
  const m = props.getMocap();
  if (!m) return;
  poseQuality.value      = m.poseQuality;
  mirrorX.value          = m.mirrorX;
  symmetryFallback.value = m.symmetryFallback;
  faceTracking.value     = m.faceTrackingEnabled;
  hipPosition.value      = m.hipPositionEnabled;
  oneEuroFilter.value    = m.filterEnabled;
  handPriority.value     = m.handTrackingPriorityEnabled;
  depthScale.value       = m.depthScale as 0 | 0.5 | 1;
});

// ── Pose quality (async — model swap takes time) ───────────────────────
async function setQuality(q: 'lite' | 'full' | 'heavy'): Promise<void> {
  const m = props.getMocap();
  // Refuse mid-session swap — same guard as the original.
  if (!m || m.state !== 'off') return;
  poseQualityBusy.value = true;
  try {
    await m.setPoseQuality(q);
    poseQuality.value = q;
  } finally {
    poseQualityBusy.value = false;
  }
}

// ── Simple toggle helpers ──────────────────────────────────────────────
function toggleMirror(): void {
  mirrorX.value = !mirrorX.value;
  props.getMocap()?.setMirrorX(mirrorX.value);
}
function toggleSymmetry(): void {
  symmetryFallback.value = !symmetryFallback.value;
  props.getMocap()?.setSymmetryFallback(symmetryFallback.value);
}
function toggleFace(): void {
  faceTracking.value = !faceTracking.value;
  props.getMocap()?.setFaceTrackingEnabled(faceTracking.value);
}
function toggleHip(): void {
  hipPosition.value = !hipPosition.value;
  props.getMocap()?.setHipPositionEnabled(hipPosition.value);
}
function toggleFilter(): void {
  oneEuroFilter.value = !oneEuroFilter.value;
  props.getMocap()?.setFilterEnabled(oneEuroFilter.value);
}
function onHandPriorityChange(e: Event): void {
  const m = props.getMocap();
  if (!m) {
    handPriority.value = true;
    (e.target as HTMLInputElement).checked = true;
    return;
  }
  handPriority.value = (e.target as HTMLInputElement).checked;
  m.setHandTrackingPriorityEnabled(handPriority.value);
}
function setDepth(v: 0 | 0.5 | 1): void {
  depthScale.value = v;
  props.getMocap()?.setDepthScale(v);
}
</script>

<template>
  <div class="dbg-row">
    <span class="dbg-label">🎯 Pose model</span>
    <div class="dbg-btn-group">
      <button
        v-for="q in (['lite', 'full', 'heavy'] as const)"
        :key="q"
        class="dbg-toggle"
        :class="{ off: poseQuality !== q }"
        :disabled="poseQualityBusy"
        @click="setQuality(q)"
      >{{ poseQualityBusy && poseQuality === q ? '…' : q }}</button>
    </div>
  </div>

  <div class="dbg-row">
    <span class="dbg-label">🪞 Mirror mode</span>
    <button class="dbg-toggle" :class="{ off: !mirrorX }" @click="toggleMirror">
      {{ mirrorX ? 'ON' : 'OFF' }}
    </button>
  </div>

  <div class="dbg-row">
    <span class="dbg-label">😶 Face tracking</span>
    <button class="dbg-toggle" :class="{ off: !faceTracking }" @click="toggleFace">
      {{ faceTracking ? 'ON' : 'OFF' }}
    </button>
  </div>

  <div class="dbg-row">
    <span class="dbg-label">🚶 Hip position</span>
    <button class="dbg-toggle" :class="{ off: !hipPosition }" @click="toggleHip">
      {{ hipPosition ? 'ON' : 'OFF' }}
    </button>
  </div>

  <div class="dbg-row">
    <span
      class="dbg-label"
      style="font-size:11px"
      title="When ON: if one arm/leg becomes invisible and the other side is live, copy the visible side's local quaternions to the missing side. Works for bilaterally-symmetric poses (claps, mirror dance); produces wrong poses for asymmetric motion. Off by default."
    >🪟 Symmetry fallback</span>
    <button class="dbg-toggle" :class="{ off: !symmetryFallback }" @click="toggleSymmetry">
      {{ symmetryFallback ? 'ON' : 'OFF' }}
    </button>
  </div>

  <div class="dbg-row">
    <span class="dbg-label">📐 Depth</span>
    <div class="dbg-btn-group">
      <button class="dbg-toggle" :class="{ off: depthScale !== 0 }"   @click="setDepth(0)">2D</button>
      <button class="dbg-toggle" :class="{ off: depthScale !== 0.5 }" @click="setDepth(0.5)">mid</button>
      <button class="dbg-toggle" :class="{ off: depthScale !== 1 }"   @click="setDepth(1)">3D</button>
    </div>
  </div>

</template>
