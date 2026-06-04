<script setup lang="ts">
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { SkeletonJointMeta } from '../../retargetLabModel';
import type {
  AxisAngleField,
  AxisAngleFields,
  EulerDegFields,
  QuaternionEditorMode,
  QuaternionField,
  QuaternionFields,
  VectorField,
} from './retargetQuaternionTypes';

defineProps<{
  targetJoints: SkeletonJointMeta[];
  modeOptions: Array<{ label: string; value: QuaternionEditorMode }>;
  quat: QuaternionFields;
  eulerDeg: EulerDegFields;
  axisAngle: AxisAngleFields;
}>();

const selectedBone = defineModel<VRMHumanBoneName>('selectedBone', { required: true });
const mode = defineModel<QuaternionEditorMode>('mode', { required: true });

const emit = defineEmits<{
  boneChange: [];
  quatFieldChange: [field: QuaternionField, value: number];
  eulerFieldChange: [field: VectorField, value: number];
  axisAngleFieldChange: [field: AxisAngleField, value: number];
  read: [];
  apply: [];
  normalize: [];
  identity: [];
  invert: [];
  copyJson: [];
  pasteJson: [];
}>();

function numberFromInput(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}
</script>

<template>
  <div>
    <div class="quat-title">
      <span>Quaternion Editor</span>
      <small>local bone rotation</small>
    </div>

    <div class="quat-row">
      <label>Bone</label>
      <select v-model="selectedBone" @change="emit('boneChange')">
        <option v-for="joint in targetJoints" :key="joint.id" :value="joint.name">
          {{ joint.name }}
        </option>
      </select>
    </div>

    <SelectButton
      v-model="mode"
      class="quat-mode-select"
      :options="modeOptions"
      optionLabel="label"
      optionValue="value"
      :allowEmpty="false"
    />

    <div v-if="mode === 'euler'" class="quat-grid">
      <label>X°<input :value="eulerDeg.x" type="number" step="0.1" @input="emit('eulerFieldChange', 'x', numberFromInput($event))" /></label>
      <label>Y°<input :value="eulerDeg.y" type="number" step="0.1" @input="emit('eulerFieldChange', 'y', numberFromInput($event))" /></label>
      <label>Z°<input :value="eulerDeg.z" type="number" step="0.1" @input="emit('eulerFieldChange', 'z', numberFromInput($event))" /></label>
    </div>

    <div v-else-if="mode === 'quat'" class="quat-grid">
      <label>X<input :value="quat.x" type="number" step="0.0001" @input="emit('quatFieldChange', 'x', numberFromInput($event))" /></label>
      <label>Y<input :value="quat.y" type="number" step="0.0001" @input="emit('quatFieldChange', 'y', numberFromInput($event))" /></label>
      <label>Z<input :value="quat.z" type="number" step="0.0001" @input="emit('quatFieldChange', 'z', numberFromInput($event))" /></label>
      <label>W<input :value="quat.w" type="number" step="0.0001" @input="emit('quatFieldChange', 'w', numberFromInput($event))" /></label>
    </div>

    <div v-else class="quat-grid">
      <label>Axis X<input :value="axisAngle.x" type="number" step="0.01" @input="emit('axisAngleFieldChange', 'x', numberFromInput($event))" /></label>
      <label>Axis Y<input :value="axisAngle.y" type="number" step="0.01" @input="emit('axisAngleFieldChange', 'y', numberFromInput($event))" /></label>
      <label>Axis Z<input :value="axisAngle.z" type="number" step="0.01" @input="emit('axisAngleFieldChange', 'z', numberFromInput($event))" /></label>
      <label>Angle°<input :value="axisAngle.angle" type="number" step="0.1" @input="emit('axisAngleFieldChange', 'angle', numberFromInput($event))" /></label>
    </div>

    <div class="quat-actions">
      <Button label="Read" icon="pi pi-refresh" size="small" text @click="emit('read')" />
      <Button label="Apply" icon="pi pi-check" size="small" @click="emit('apply')" />
      <Button label="Normalize" size="small" text @click="emit('normalize')" />
      <Button label="Identity" size="small" text severity="secondary" @click="emit('identity')" />
      <Button label="Invert" size="small" text severity="secondary" @click="emit('invert')" />
    </div>

    <div class="quat-actions">
      <Button label="Copy JSON" icon="pi pi-copy" size="small" text @click="emit('copyJson')" />
      <Button label="Paste JSON" icon="pi pi-clipboard" size="small" text @click="emit('pasteJson')" />
    </div>
  </div>
</template>

<style scoped>
.quat-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
}

.quat-title small {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.48);
}

.quat-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.quat-row label,
.quat-grid label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.58);
}

.quat-row select,
.quat-grid input {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: #0d0d0f;
  color: #e6e6e6;
  padding: 7px 8px;
  font-size: 12px;
}

:deep(.quat-mode-select) {
  display: flex;
  padding: 2px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  margin-bottom: 8px;
}

:deep(.quat-mode-select .p-togglebutton) {
  flex: 1;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font-size: 11px;
  padding: 5px 8px;
}

:deep(.quat-mode-select .p-togglebutton[data-p-checked="true"]) {
  background: rgba(147, 180, 255, 0.18);
  color: #dce7ff;
}

.quat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.quat-grid input {
  display: block;
  margin-top: 3px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}

.quat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}
</style>
