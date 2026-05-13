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
</template>

<style scoped>
:deep(.p-button.dbg-toggle) {
  min-width: 34px;
  justify-content: center;
  padding: 2px 8px;
}
</style>
