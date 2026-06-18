<script setup lang="ts">
/**
 * Conversion settings reviewed BEFORE a video→BVH run is started. Shown in
 * the Capture panel while the "video" source is selected, so the user sets
 * quality knobs first and then triggers the conversion from the primary CTA.
 *
 *   - Pose model: lite / full / heavy (model swap; only when idle)
 *   - Depth: 2D / mid / 3D (how much landmark Z is trusted)
 *   - Arm-back limit: caps how far a hand may reach behind the body
 *     (depth ambiguity guard); 90° = off
 *
 * State mirrors the MocapController (single source of truth); we read it on
 * mount and write through the setters on change.
 */
import { reactive, ref, onMounted, onUnmounted } from 'vue';
import SelectButton from 'primevue/selectbutton';
import Slider from 'primevue/slider';
import type { MocapController } from '../../mocap/pipeline/mocapController';
import type { HipCompensator } from '../../physics/hipCompensation';
import type { HipComRotator } from '../../physics/hipComRotation';

const props = defineProps<{
  getMocap: () => MocapController | null;
  /** Live hip balancers (player overlay) — tuned here, applied each frame. */
  hipCompensator: HipCompensator;
  hipComRotator: HipComRotator;
  /** Disable the model swap while a conversion is in flight. */
  busy?: boolean;
}>();

const poseQuality     = ref<'lite' | 'full' | 'heavy'>('full');
const poseQualityBusy = ref(false);
const depthScale      = ref<0 | 0.5 | 1>(1);
const armBackLimit    = ref(90); // 90 = off

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
  poseQuality.value  = m.poseQuality;
  depthScale.value   = m.depthScale as 0 | 0.5 | 1;
  armBackLimit.value = m.armBackLimitDeg;
});

async function setQuality(q: 'lite' | 'full' | 'heavy' | null): Promise<void> {
  if (!q) return;
  const m = props.getMocap();
  if (!m || m.state !== 'off') return; // refuse mid-session swap
  poseQualityBusy.value = true;
  try {
    await m.setPoseQuality(q);
    poseQuality.value = q;
  } finally {
    poseQualityBusy.value = false;
  }
}

function setDepth(v: 0 | 0.5 | 1 | null): void {
  if (v == null) return;
  depthScale.value = v;
  props.getMocap()?.setDepthScale(v);
}

function onArmBackLimit(): void {
  props.getMocap()?.setArmBackLimitDeg(armBackLimit.value);
}

// ── Hips CoM balance (live player overlay) ────────────────────────────────
const onOffOptions: Array<{ label: string; value: boolean }> = [
  { label: 'OFF', value: false },
  { label: 'ON', value: true },
];

const compEnabled = ref(props.hipCompensator.enabled);
const compGain    = ref(props.hipCompensator.gain);
const rotEnabled  = ref(props.hipComRotator.enabled);
const rotGain     = ref(props.hipComRotator.gain);

const hipText = reactive({
  comErr: 'CoM→feet: —',
  hipOff: 'hip offset: —',
  rotAng: 'rot angle: —',
});

function setCompEnabled(v: boolean | null): void {
  if (v == null) return;
  props.hipCompensator.enabled = v;
  compEnabled.value = props.hipCompensator.enabled;
}
function onCompGain(): void {
  props.hipCompensator.gain = compGain.value;
  compGain.value = props.hipCompensator.gain;
}
function setRotEnabled(v: boolean | null): void {
  if (v == null) return;
  props.hipComRotator.enabled = v;
  rotEnabled.value = props.hipComRotator.enabled;
}
function onRotGain(): void {
  props.hipComRotator.gain = rotGain.value;
  rotGain.value = props.hipComRotator.gain;
}

let hipTimer = 0;
function refreshHips(): void {
  const c = props.hipCompensator.latest;
  if (c && c.totalMass > 0) {
    const dx = (c.supportCenter.x - c.com.x) * 100;
    const dz = (c.supportCenter.z - c.com.z) * 100;
    hipText.comErr = `CoM→feet: ΔX=${dx.toFixed(1)} ΔZ=${dz.toFixed(1)} cm`;
    hipText.hipOff = `hip offset: ${(c.offset.length() * 100).toFixed(1)} cm`;
  } else {
    hipText.comErr = 'CoM→feet: —';
    hipText.hipOff = 'hip offset: (off)';
  }
  const r = props.hipComRotator.latest;
  hipText.rotAng = (r && r.totalMass > 0)
    ? `rot angle: ${(r.angle * 180 / Math.PI).toFixed(1)}°`
    : 'rot angle: (off)';
}

onMounted(() => {
  refreshHips();
  hipTimer = window.setInterval(refreshHips, 150);
});
onUnmounted(() => clearInterval(hipTimer));
</script>

<template>
  <div class="convert-settings">
    <p class="convert-settings-title">Conversion settings</p>

    <div class="dbg-row">
      <span class="dbg-label">🎯 Pose model</span>
      <SelectButton
        class="prime-compact-select"
        v-model="poseQuality"
        :options="qualityOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        :disabled="poseQualityBusy || busy"
        @update:modelValue="setQuality"
      />
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
        :disabled="busy"
        @update:modelValue="setDepth"
      />
    </div>

    <div class="dbg-row">
      <span class="dbg-label">🙆 Arm-back limit {{ armBackLimit >= 90 ? 'off' : armBackLimit + '°' }}</span>
      <Slider
        class="dbg-slider"
        v-model="armBackLimit"
        :min="20"
        :max="90"
        :step="5"
        :disabled="busy"
        @update:modelValue="onArmBackLimit"
      />
    </div>

    <p class="convert-settings-title" style="margin-top:10px">Hips balance</p>

    <div class="dbg-row">
      <span class="dbg-label">⊕ CoM compensation (move)</span>
      <SelectButton
        class="prime-compact-select"
        v-model="compEnabled"
        :options="onOffOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        @update:modelValue="setCompEnabled"
      />
    </div>
    <div class="dbg-row">
      <span class="dbg-label">gain {{ compGain.toFixed(2) }}</span>
      <Slider
        class="dbg-slider"
        v-model="compGain"
        :min="0"
        :max="1"
        :step="0.05"
        @update:modelValue="onCompGain"
      />
    </div>
    <div class="dbg-stat">{{ hipText.comErr }}</div>
    <div class="dbg-stat">{{ hipText.hipOff }}</div>

    <div class="dbg-row" style="margin-top:6px">
      <span class="dbg-label">⟳ CoM rotation (spine bend)</span>
      <SelectButton
        class="prime-compact-select"
        v-model="rotEnabled"
        :options="onOffOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        @update:modelValue="setRotEnabled"
      />
    </div>
    <div class="dbg-row">
      <span class="dbg-label">gain {{ rotGain.toFixed(2) }}</span>
      <Slider
        class="dbg-slider"
        v-model="rotGain"
        :min="0"
        :max="1"
        :step="0.05"
        @update:modelValue="onRotGain"
      />
    </div>
    <div class="dbg-stat">{{ hipText.rotAng }}</div>
  </div>
</template>

<style scoped>
.convert-settings {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.convert-settings-title {
  margin: 0 0 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
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
