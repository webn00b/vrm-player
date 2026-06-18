<script setup lang="ts">
/**
 * Hip-force diagnostic readout + balance-corrector toggle.
 *
 * Replaces `wireHipForceReadout` from the old debugPanelStats.ts.
 * Polls `hipForce.latest` every 100 ms but only computes formatting
 * when the fold is open — same lazy behaviour as the original.
 *
 * Reactive refs for each line of the readout; Vue template renders
 * them as `<div class="dbg-stat">` blocks matching the original look.
 */

import { reactive, ref, onMounted, onUnmounted } from 'vue';
import type { HipForceTracker } from '../physics/hipForce';
import type { HipBalanceCorrector } from '../physics/hipBalanceCorrector';
import type { HipCompensator } from '../physics/hipCompensation';

const props = defineProps<{
  hipForce: HipForceTracker;
  hipBalance: HipBalanceCorrector;
  hipCompensator: HipCompensator;
  /** True when the parent's Hip force fold is open. We poll the
   *  cheap `pa.levelSnapshot` always, but skip the costly hip-force
   *  formatting when the fold is collapsed. */
  open: boolean;
}>();

const text = reactive({
  mass:   'tracked mass: —',
  total:  '|F_total|: —',
  grav:   '|F_grav|:  —',
  inert:  '|F_inert|: —',
  tilt:   'tilt vs Y_hip: —',
  gtilt:  'gravity tilt: —',
  angles: 'corr. angles: —',
  comErr: 'CoM→feet: —',
  hipOff: 'hip offset: —',
});

const enabled = ref(props.hipBalance.enabled);
function toggleBalance(): void {
  props.hipBalance.enabled = !props.hipBalance.enabled;
  enabled.value = props.hipBalance.enabled;
}

const compEnabled = ref(props.hipCompensator.enabled);
const compGain = ref(props.hipCompensator.gain);
function toggleCompensator(): void {
  props.hipCompensator.enabled = !props.hipCompensator.enabled;
  compEnabled.value = props.hipCompensator.enabled;
}
function onGainInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value);
  props.hipCompensator.gain = v;
  compGain.value = props.hipCompensator.gain;
}

let timer = 0;
function refresh(): void {
  if (!props.open) return;
  const r = props.hipForce.latest;
  if (!r) {
    text.total = '|F_total|: —';
    return;
  }
  const fmtN = (v: number): string => `${v.toFixed(1)} N`;

  text.mass = `tracked mass: ${r.totalMass.toFixed(1)} kg`;
  if (!r.ready) {
    text.total = '|F_total|: warming up…';
    text.grav  = `|F_grav|:  ${fmtN(r.gravityWorld.length())}`;
    text.inert = '|F_inert|: —';
    text.tilt  = 'tilt vs Y_hip: —';
  } else {
    text.total = `|F_total|: ${fmtN(r.totalWorld.length())}`;
    text.grav  = `|F_grav|:  ${fmtN(r.gravityWorld.length())}`;
    text.inert = `|F_inert|: ${fmtN(r.inertiaWorld.length())}`;

    const local = r.totalInHipSpace;
    const len = local.length();
    text.tilt = len < 1e-6
      ? 'tilt vs Y_hip: —'
      : `tilt vs Y_hip: ${(Math.acos(Math.max(-1, Math.min(1, local.y / len))) * 180 / Math.PI).toFixed(1)}°`;
  }
  // Gravity tilt is valid even before warmup.
  const gLocal = r.gravityInHipSpace;
  const gLen = gLocal.length();
  text.gtilt = gLen < 1e-6
    ? 'gravity tilt: —'
    : `gravity tilt: ${(Math.acos(Math.max(-1, Math.min(1, -gLocal.y / gLen))) * 180 / Math.PI).toFixed(1)}°`;

  if (props.hipBalance.enabled) {
    const a = props.hipBalance.latestAnglesDeg;
    text.angles = `corr. angles: X=${a.x.toFixed(1)}°  Z=${a.z.toFixed(1)}°`;
  } else {
    text.angles = 'corr. angles: (off)';
  }

  // Hip CoM compensation readout (cm). Populated even when disabled if a prior
  // apply() left a result, but cleared once it resets to null.
  const c = props.hipCompensator.latest;
  if (c && c.totalMass > 0) {
    const dx = (c.supportCenter.x - c.com.x) * 100;
    const dz = (c.supportCenter.z - c.com.z) * 100;
    text.comErr = `CoM→feet: ΔX=${dx.toFixed(1)}  ΔZ=${dz.toFixed(1)} cm`;
    text.hipOff = `hip offset: ${(c.offset.length() * 100).toFixed(1)} cm`;
  } else {
    text.comErr = 'CoM→feet: —';
    text.hipOff = 'hip offset: (off)';
  }
}

onMounted(() => {
  refresh();
  timer = window.setInterval(refresh, 100);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="dbg-stat">{{ text.mass }}</div>
  <div class="dbg-stat">{{ text.total }}</div>
  <div class="dbg-stat">{{ text.grav }}</div>
  <div class="dbg-stat">{{ text.inert }}</div>
  <div class="dbg-stat">{{ text.tilt }}</div>
  <div class="dbg-stat">{{ text.gtilt }}</div>
  <div class="dbg-row" style="margin-top:6px">
    <span class="dbg-label">⚖ Balance corrector</span>
    <button
      class="dbg-toggle"
      :class="{ off: !enabled }"
      @click="toggleBalance"
    >{{ enabled ? 'ON' : 'OFF' }}</button>
  </div>
  <div class="dbg-stat">{{ text.angles }}</div>

  <div class="dbg-row" style="margin-top:6px">
    <span class="dbg-label">⊕ Hip CoM compensation</span>
    <button
      class="dbg-toggle"
      :class="{ off: !compEnabled }"
      @click="toggleCompensator"
    >{{ compEnabled ? 'ON' : 'OFF' }}</button>
  </div>
  <div class="dbg-row">
    <span class="dbg-label">gain {{ compGain.toFixed(2) }}</span>
    <input
      type="range" min="0" max="1" step="0.05"
      :value="compGain"
      @input="onGainInput"
    />
  </div>
  <div class="dbg-stat">{{ text.comErr }}</div>
  <div class="dbg-stat">{{ text.hipOff }}</div>
</template>
