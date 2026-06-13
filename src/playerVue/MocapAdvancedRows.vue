<script setup lang="ts">
/**
 * Two rows that live at the top of the Mocap-advanced fold:
 *   - 🌊 1€ smoothing ON/OFF toggle
 *   - ✋ Wrist + fingers priority checkbox
 *
 * Split out from MocapParamsControls.vue because these live in a
 * different parent slot (inside the Mocap-advanced <details> fold)
 * while the other params (pose / mirror / face / hip / symm / depth)
 * live at the top of the Video tab.
 */

import { ref, onMounted } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import type { MocapController } from '../mocap/pipeline/mocapController';

const props = defineProps<{
  getMocap: () => MocapController | null;
}>();

const oneEuroFilter = ref(true);
const handPriority  = ref(true);

// Two-pass FILE pipeline stages (apply to the next video conversion).
const lifting     = ref(true);
const chainScale  = ref(true);
const autoTrim    = ref(true);
const smoothing   = ref(true);
const cropRedetect = ref(false);

onMounted(() => {
  const m = props.getMocap();
  if (!m) return;
  oneEuroFilter.value = m.filterEnabled;
  handPriority.value  = m.handTrackingPriorityEnabled;
  lifting.value      = m.liftingEnabled;
  chainScale.value   = m.chainScaleEnabled;
  autoTrim.value     = m.autoTrimEnabled;
  smoothing.value    = m.offlineSmoothingEnabled;
  cropRedetect.value = m.cropRedetectEnabled;
});

function toggleLifting(): void {
  const m = props.getMocap(); if (!m) return;
  lifting.value = !lifting.value; m.setLiftingEnabled(lifting.value);
}
function toggleChainScale(): void {
  const m = props.getMocap(); if (!m) return;
  chainScale.value = !chainScale.value; m.setChainScaleEnabled(chainScale.value);
}
function toggleSmoothing(): void {
  const m = props.getMocap(); if (!m) return;
  smoothing.value = !smoothing.value; m.setOfflineSmoothingEnabled(smoothing.value);
}
function toggleAutoTrim(): void {
  const m = props.getMocap(); if (!m) return;
  autoTrim.value = !autoTrim.value; m.setAutoTrimEnabled(autoTrim.value);
}
function toggleCropRedetect(): void {
  const m = props.getMocap(); if (!m) return;
  cropRedetect.value = !cropRedetect.value; m.setCropRedetectEnabled(cropRedetect.value);
}

function toggleFilter(): void {
  oneEuroFilter.value = !oneEuroFilter.value;
  props.getMocap()?.setFilterEnabled(oneEuroFilter.value);
}
function onHandPriorityChange(next: boolean): void {
  const m = props.getMocap();
  if (!m) {
    handPriority.value = true;
    return;
  }
  handPriority.value = next;
  m.setHandTrackingPriorityEnabled(handPriority.value);
}
</script>

<template>
  <div class="dbg-row">
    <span class="dbg-label">🌊 1€ smoothing</span>
    <Button class="dbg-toggle" :class="{ off: !oneEuroFilter }" :label="oneEuroFilter ? 'ON' : 'OFF'" text size="small" @click="toggleFilter" />
  </div>
  <div class="dbg-row">
    <label class="dbg-label" for="mocap-handprio-box">✋ Wrist + fingers priority</label>
    <Checkbox
      id="mocap-handprio-box"
      v-model="handPriority"
      binary
      @update:modelValue="onHandPriorityChange"
    />
  </div>

  <div class="dbg-section">Video pipeline (next conversion)</div>
  <div class="dbg-row">
    <span class="dbg-label">🧠 3D lifting</span>
    <Button class="dbg-toggle" :class="{ off: !lifting }" :label="lifting ? 'ON' : 'OFF'" text size="small"
      @click="toggleLifting" />
  </div>
  <div class="dbg-row">
    <span class="dbg-label">📏 Chain limb scale</span>
    <Button class="dbg-toggle" :class="{ off: !chainScale }" :label="chainScale ? 'ON' : 'OFF'" text size="small"
      @click="toggleChainScale" />
  </div>
  <div class="dbg-row">
    <span class="dbg-label">🌊 Offline smoothing</span>
    <Button class="dbg-toggle" :class="{ off: !smoothing }" :label="smoothing ? 'ON' : 'OFF'" text size="small"
      @click="toggleSmoothing" />
  </div>
  <div class="dbg-row">
    <span class="dbg-label">✂️ Auto-trim idle ends</span>
    <Button class="dbg-toggle" :class="{ off: !autoTrim }" :label="autoTrim ? 'ON' : 'OFF'" text size="small"
      @click="toggleAutoTrim" />
  </div>
  <div class="dbg-row">
    <span class="dbg-label">🔬 Crop re-detect</span>
    <Button class="dbg-toggle" :class="{ off: !cropRedetect }" :label="cropRedetect ? 'ON' : 'OFF'" text size="small"
      @click="toggleCropRedetect" />
  </div>
</template>

<style scoped>
:deep(.p-button.dbg-toggle) {
  min-width: 34px;
  justify-content: center;
  padding: 2px 8px;
}
.dbg-section {
  margin-top: 8px;
  font-size: 11px;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
