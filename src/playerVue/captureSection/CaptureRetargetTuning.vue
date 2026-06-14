<script setup lang="ts">
/**
 * Per-clip retarget tuning, shown only inside the Capture panel
 * (#mocap-tuning-panel → capture ui-mode). Knobs here correct geometry
 * artefacts of a specific clip's footage rather than global pipeline
 * behaviour, so they live next to the capture controls instead of the
 * inspect-mode mocap params.
 *
 *   - Arm-back limit: caps how far the wrist target may sit behind the
 *     shoulder's coronal plane. Depth/foreshortening ambiguity can fling a
 *     hand far back on isolated frames; 90° = off (no clamp).
 */
import { ref, onMounted } from 'vue';
import Slider from 'primevue/slider';
import type { MocapController } from '../../mocap/pipeline/mocapController';

const props = defineProps<{
  getMocap: () => MocapController | null;
}>();

const armBackLimit = ref(90); // 90 = off

onMounted(() => {
  const m = props.getMocap();
  if (m) armBackLimit.value = m.armBackLimitDeg;
});

function onArmBackLimit(): void {
  props.getMocap()?.setArmBackLimitDeg(armBackLimit.value);
}
</script>

<template>
  <div class="capture-tuning">
    <p class="capture-tuning-title">Retarget tuning</p>
    <div class="dbg-row">
      <span class="dbg-label">🙆 Arm-back limit {{ armBackLimit >= 90 ? 'off' : armBackLimit + '°' }}</span>
      <Slider
        class="dbg-slider"
        v-model="armBackLimit"
        :min="20"
        :max="90"
        :step="5"
        @update:modelValue="onArmBackLimit"
      />
    </div>
  </div>
</template>

<style scoped>
.capture-tuning {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.capture-tuning-title {
  margin: 0 0 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
}
</style>
