<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import Slider from 'primevue/slider';
import type { MocapController } from '../mocap/pipeline/mocapController';
import {
  loadMocapStabilizerSettings,
  saveMocapStabilizerSettings,
  type MocapStabilizerControlState,
} from './mocapStabilizerSettings';

const props = defineProps<{
  getMocap: () => MocapController | null;
}>();

const prerollSec = shallowRef(1.5);
const bodyMaxStep = shallowRef(0.45);
const bodyMaxZStep = shallowRef(0.18);
const bodyMaxGapFrames = shallowRef(3);
const handMaxStep = shallowRef(0.12);
const handMaxZStep = shallowRef(0.12);
const handMaxGapFrames = shallowRef(2);

function currentState(): MocapStabilizerControlState {
  return {
    prerollSec: prerollSec.value,
    bodyMaxStep: bodyMaxStep.value,
    bodyMaxZStep: bodyMaxZStep.value,
    bodyMaxGapFrames: Math.round(bodyMaxGapFrames.value),
    handMaxStep: handMaxStep.value,
    handMaxZStep: handMaxZStep.value,
    handMaxGapFrames: Math.round(handMaxGapFrames.value),
  };
}

function syncFromMocap(): void {
  const mocap = props.getMocap();
  if (!mocap) return;
  const { body, hand } = mocap.stabilizerSettings;
  prerollSec.value = mocap.fileCaptureCalibrationPrerollSec;
  bodyMaxStep.value = body.maxStep;
  bodyMaxZStep.value = body.maxZStep;
  bodyMaxGapFrames.value = body.maxGapFrames;
  handMaxStep.value = hand.maxStep;
  handMaxZStep.value = hand.maxZStep;
  handMaxGapFrames.value = hand.maxGapFrames;
}

function applySettings(settings: Partial<MocapStabilizerControlState>): void {
  if (settings.prerollSec !== undefined) prerollSec.value = settings.prerollSec;
  if (settings.bodyMaxStep !== undefined) bodyMaxStep.value = settings.bodyMaxStep;
  if (settings.bodyMaxZStep !== undefined) bodyMaxZStep.value = settings.bodyMaxZStep;
  if (settings.bodyMaxGapFrames !== undefined) bodyMaxGapFrames.value = settings.bodyMaxGapFrames;
  if (settings.handMaxStep !== undefined) handMaxStep.value = settings.handMaxStep;
  if (settings.handMaxZStep !== undefined) handMaxZStep.value = settings.handMaxZStep;
  if (settings.handMaxGapFrames !== undefined) handMaxGapFrames.value = settings.handMaxGapFrames;

  const mocap = props.getMocap();
  if (!mocap) return;
  const state = currentState();
  mocap.setFileCaptureCalibrationPrerollSec(state.prerollSec);
  mocap.setBodyStabilizerSettings({
    maxStep: state.bodyMaxStep,
    maxZStep: state.bodyMaxZStep,
    maxGapFrames: state.bodyMaxGapFrames,
  });
  mocap.setHandStabilizerSettings({
    maxStep: state.handMaxStep,
    maxZStep: state.handMaxZStep,
    maxGapFrames: state.handMaxGapFrames,
  });
}

function persistCurrentSettings(): void {
  saveMocapStabilizerSettings(currentState());
}

function onPreroll(): void {
  props.getMocap()?.setFileCaptureCalibrationPrerollSec(prerollSec.value);
  persistCurrentSettings();
}

function onBodyMaxStep(): void {
  props.getMocap()?.setBodyStabilizerSettings({ maxStep: bodyMaxStep.value });
  persistCurrentSettings();
}

function onBodyMaxZStep(): void {
  props.getMocap()?.setBodyStabilizerSettings({ maxZStep: bodyMaxZStep.value });
  persistCurrentSettings();
}

function onBodyMaxGapFrames(): void {
  props.getMocap()?.setBodyStabilizerSettings({ maxGapFrames: Math.round(bodyMaxGapFrames.value) });
  persistCurrentSettings();
}

function onHandMaxStep(): void {
  props.getMocap()?.setHandStabilizerSettings({ maxStep: handMaxStep.value });
  persistCurrentSettings();
}

function onHandMaxZStep(): void {
  props.getMocap()?.setHandStabilizerSettings({ maxZStep: handMaxZStep.value });
  persistCurrentSettings();
}

function onHandMaxGapFrames(): void {
  props.getMocap()?.setHandStabilizerSettings({ maxGapFrames: Math.round(handMaxGapFrames.value) });
  persistCurrentSettings();
}

onMounted(() => {
  syncFromMocap();
  const stored = loadMocapStabilizerSettings();
  if (stored) applySettings(stored);
});
</script>

<template>
  <div class="dbg-section mocap-stabilizer-controls">
    <div class="dbg-row">
      <span class="dbg-label">Calibration preroll {{ prerollSec.toFixed(1) }}s</span>
      <Slider
        class="dbg-slider"
        v-model="prerollSec"
        :min="0"
        :max="3"
        :step="0.1"
        @update:modelValue="onPreroll"
      />
    </div>

    <div class="stabilizer-group-title">Body landmark clamp</div>
    <div class="dbg-row">
      <span class="dbg-label">Body XY {{ bodyMaxStep.toFixed(2) }}</span>
      <Slider
        class="dbg-slider"
        v-model="bodyMaxStep"
        :min="0.05"
        :max="1"
        :step="0.01"
        @update:modelValue="onBodyMaxStep"
      />
    </div>
    <div class="dbg-row">
      <span class="dbg-label">Body Z {{ bodyMaxZStep.toFixed(2) }}</span>
      <Slider
        class="dbg-slider"
        v-model="bodyMaxZStep"
        :min="0.02"
        :max="0.6"
        :step="0.01"
        @update:modelValue="onBodyMaxZStep"
      />
    </div>
    <div class="dbg-row">
      <span class="dbg-label">Body gap {{ Math.round(bodyMaxGapFrames) }}f</span>
      <Slider
        class="dbg-slider"
        v-model="bodyMaxGapFrames"
        :min="0"
        :max="10"
        :step="1"
        @update:modelValue="onBodyMaxGapFrames"
      />
    </div>

    <div class="stabilizer-group-title">Hand landmark clamp</div>
    <div class="dbg-row">
      <span class="dbg-label">Hand XY {{ handMaxStep.toFixed(2) }}</span>
      <Slider
        class="dbg-slider"
        v-model="handMaxStep"
        :min="0.02"
        :max="0.4"
        :step="0.01"
        @update:modelValue="onHandMaxStep"
      />
    </div>
    <div class="dbg-row">
      <span class="dbg-label">Hand Z {{ handMaxZStep.toFixed(2) }}</span>
      <Slider
        class="dbg-slider"
        v-model="handMaxZStep"
        :min="0.02"
        :max="0.4"
        :step="0.01"
        @update:modelValue="onHandMaxZStep"
      />
    </div>
    <div class="dbg-row">
      <span class="dbg-label">Hand gap {{ Math.round(handMaxGapFrames) }}f</span>
      <Slider
        class="dbg-slider"
        v-model="handMaxGapFrames"
        :min="0"
        :max="10"
        :step="1"
        @update:modelValue="onHandMaxGapFrames"
      />
    </div>
  </div>
</template>

<style scoped>
.mocap-stabilizer-controls {
  gap: 6px;
}

.stabilizer-group-title {
  margin-top: 4px;
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.62);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
