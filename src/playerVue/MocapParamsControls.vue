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
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
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
const qualityOptions: Array<{ label: string; value: 'lite' | 'full' | 'heavy' }> = [
  { label: 'lite', value: 'lite' },
  { label: 'full', value: 'full' },
  { label: 'heavy', value: 'heavy' },
];
const depthOptions: Array<{ label: string; value: 0 | 0.5 | 1 }> = [
  { label: '2D', value: 0 },
  { label: 'mid', value: 0.5 },
  { label: '3D', value: 1 },
];

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
async function setQuality(q: 'lite' | 'full' | 'heavy' | null): Promise<void> {
  if (!q) return;
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
function setDepth(v: 0 | 0.5 | 1 | null): void {
  if (v == null) return;
  depthScale.value = v;
  props.getMocap()?.setDepthScale(v);
}
</script>

<template>
  <div class="dbg-row">
    <span class="dbg-label">🎯 Pose model</span>
    <SelectButton
      class="prime-compact-select"
      v-model="poseQuality"
      :options="qualityOptions"
      optionLabel="label"
      optionValue="value"
      :allowEmpty="false"
      :disabled="poseQualityBusy"
      @update:modelValue="setQuality"
    />
  </div>

  <div class="dbg-row">
    <span class="dbg-label">🪞 Mirror mode</span>
    <Button class="dbg-toggle" data-testid="mocap-mirror" :class="{ off: !mirrorX }" :label="mirrorX ? 'ON' : 'OFF'" text size="small" @click="toggleMirror" />
  </div>

  <div class="dbg-row">
    <span class="dbg-label">😶 Face tracking</span>
    <Button class="dbg-toggle" data-testid="mocap-face" :class="{ off: !faceTracking }" :label="faceTracking ? 'ON' : 'OFF'" text size="small" @click="toggleFace" />
  </div>

  <div class="dbg-row">
    <span class="dbg-label">🚶 Hip position</span>
    <Button class="dbg-toggle" data-testid="mocap-hip" :class="{ off: !hipPosition }" :label="hipPosition ? 'ON' : 'OFF'" text size="small" @click="toggleHip" />
  </div>

  <div class="dbg-row">
    <span
      class="dbg-label"
      style="font-size:11px"
      title="When ON: if one arm/leg becomes invisible and the other side is live, copy the visible side's local quaternions to the missing side. Works for bilaterally-symmetric poses (claps, mirror dance); produces wrong poses for asymmetric motion. Off by default."
    >🪟 Symmetry fallback</span>
    <Button class="dbg-toggle" data-testid="mocap-symmetry" :class="{ off: !symmetryFallback }" :label="symmetryFallback ? 'ON' : 'OFF'" text size="small" @click="toggleSymmetry" />
  </div>

  <div class="dbg-row">
    <span class="dbg-label">📐 Depth</span>
    <SelectButton
      class="prime-compact-select"
      v-model="depthScale"
      :options="depthOptions"
      optionLabel="label"
      optionValue="value"
      :allowEmpty="false"
      @update:modelValue="setDepth"
    />
  </div>

</template>

<style scoped>
:deep(.p-button.dbg-toggle) {
  min-width: 34px;
  justify-content: center;
  padding: 2px 8px;
}
:deep(.prime-compact-select) {
  display: flex;
  gap: 3px;
}
:deep(.prime-compact-select .p-togglebutton) {
  border-radius: 999px;
  border: 1px solid transparent;
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.55);
  font-size: 9px;
  font-weight: 700;
  padding: 2px 8px;
}
:deep(.prime-compact-select .p-togglebutton-checked) {
  background: #3b5bdb;
  color: #fff;
}
:deep(.prime-compact-select .p-togglebutton[data-p-checked="true"]) {
  background: #3b5bdb;
  color: #fff;
}
:deep(.prime-compact-select .p-togglebutton .p-togglebutton-content) {
  background: transparent;
}
:deep(.prime-compact-select .p-togglebutton[data-p-checked="true"] .p-togglebutton-label) {
  color: #fff;
}
</style>
