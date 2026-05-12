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
import type { MocapController } from '../mocap/pipeline/mocapController';

const props = defineProps<{
  getMocap: () => MocapController | null;
}>();

const oneEuroFilter = ref(true);
const handPriority  = ref(true);

onMounted(() => {
  const m = props.getMocap();
  if (!m) return;
  oneEuroFilter.value = m.filterEnabled;
  handPriority.value  = m.handTrackingPriorityEnabled;
});

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
</script>

<template>
  <div class="dbg-row">
    <span class="dbg-label">🌊 1€ smoothing</span>
    <button class="dbg-toggle" :class="{ off: !oneEuroFilter }" @click="toggleFilter">
      {{ oneEuroFilter ? 'ON' : 'OFF' }}
    </button>
  </div>
  <div class="dbg-row">
    <label class="dbg-label" for="mocap-handprio-box">✋ Wrist + fingers priority</label>
    <input
      type="checkbox"
      id="mocap-handprio-box"
      :checked="handPriority"
      style="width:14px;height:14px;accent-color:#6ea8ff"
      @change="onHandPriorityChange"
    >
  </div>
</template>
