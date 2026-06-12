<script setup lang="ts">
import { shallowRef } from 'vue';
import type { BoneValidator } from '../validation/boneValidator';
import type { BoneConstraintProfileId } from '../validation/boneConstraints';
import type { PoseValidator } from '../validation/poseValidator';
import {
  validationSettings,
  type ImportClampMode,
  type ValidationClampMode,
} from '../validation/validationSettings';

const props = defineProps<{
  validator: BoneValidator;
  poseValidator?: PoseValidator;
}>();

props.validator.setProfile(validationSettings.profileId);
props.poseValidator?.setProfile(validationSettings.profileId);
const runtimeEnabled = shallowRef(props.validator.enabled);

function toggleRuntime(): void {
  runtimeEnabled.value = !runtimeEnabled.value;
  props.validator.setEnabled(runtimeEnabled.value);
}

function setProfile(event: Event): void {
  const next = (event.target as HTMLSelectElement).value as BoneConstraintProfileId;
  validationSettings.profileId = next;
  props.validator.setProfile(next);
  props.poseValidator?.setProfile(next);
}

function setPlaybackMode(event: Event): void {
  validationSettings.playbackClampMode = (event.target as HTMLSelectElement).value as ValidationClampMode;
}

function setRecordingMode(event: Event): void {
  validationSettings.recordingClampMode = (event.target as HTMLSelectElement).value as ValidationClampMode;
}

function setImportMode(event: Event): void {
  validationSettings.importClampMode = (event.target as HTMLSelectElement).value as ImportClampMode;
}

function dumpValidationState(): void {
  console.log('[validator] controls dump', {
    enabled: props.validator.enabled,
    profileId: props.validator.profileId,
    settings: validationSettings,
    stats: props.validator.getStats(),
    poseStats: props.poseValidator?.getStats() ?? null,
    poseProfileId: props.poseValidator?.profileId ?? null,
    constraints: props.validator.getConstraints(),
  });
}
</script>

<template>
  <section class="validation-controls" aria-label="Validation controls">
    <div class="validation-controls-title">Limiters</div>

    <button
      class="validation-chip validation-runtime"
      :class="{ active: runtimeEnabled }"
      type="button"
      :aria-pressed="runtimeEnabled"
      title="Enable runtime bone rotation clamp"
      @click="toggleRuntime"
    >
      ROM {{ runtimeEnabled ? 'ON' : 'OFF' }}
    </button>

    <label class="validation-field">
      <span>Profile</span>
      <select :value="validationSettings.profileId" @change="setProfile">
        <option value="default">Default</option>
        <option value="mixamoLive">Mixamo Live</option>
      </select>
    </label>

    <label class="validation-field" title="Soft blends corrections in smoothly; Hard snaps to the bound instantly">
      <span>Playback</span>
      <select :value="validationSettings.playbackClampMode" @change="setPlaybackMode">
        <option value="safe">Soft</option>
        <option value="full">Hard</option>
        <option value="off">Off</option>
      </select>
    </label>

    <label class="validation-field" title="Soft blends corrections in smoothly; Hard snaps to the bound instantly">
      <span>Recording</span>
      <select :value="validationSettings.recordingClampMode" @change="setRecordingMode">
        <option value="safe">Soft</option>
        <option value="full">Hard</option>
        <option value="off">Off</option>
      </select>
    </label>

    <label class="validation-field">
      <span>Import</span>
      <select :value="validationSettings.importClampMode" @change="setImportMode">
        <option value="validate">Validate</option>
        <option value="clamp">Clamp</option>
      </select>
    </label>

    <button
      class="validation-chip validation-dump"
      type="button"
      aria-label="Dump validation state"
      title="Dump active validation state to console"
      @click="dumpValidationState"
    >
      Dump
    </button>
  </section>
</template>

<style scoped>
.validation-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  max-width: min(760px, calc(100vw - 24px));
  min-height: 34px;
  padding: 4px 6px;
  border-radius: 9px;
  pointer-events: auto;
  background: rgba(13, 16, 18, 0.9);
  border: 1px solid rgba(169, 210, 215, 0.12);
  backdrop-filter: blur(12px);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.22);
}

.validation-controls-title {
  padding: 0 4px;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.42);
}

.validation-chip,
.validation-field {
  height: 26px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.055);
  color: rgba(255, 255, 255, 0.82);
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 700;
}

.validation-chip {
  padding: 0 8px;
  cursor: pointer;
}

.validation-dump {
  color: rgba(255, 255, 255, 0.68);
}

.validation-chip.active {
  background: rgba(30, 188, 196, 0.18);
  border-color: rgba(123, 225, 232, 0.22);
  color: #b9fbff;
}

.validation-field {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 3px 0 7px;
}

.validation-field span {
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.48);
}

.validation-field select {
  height: 20px;
  min-width: 76px;
  border: 0;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.34);
  color: #f3f3f3;
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
}

@media (max-width: 720px) {
  .validation-controls {
    flex-wrap: wrap;
    align-content: center;
    justify-content: flex-start;
  }
}
</style>
