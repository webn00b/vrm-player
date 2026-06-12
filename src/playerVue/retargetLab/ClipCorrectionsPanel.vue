<script setup lang="ts">
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import type { QuaternionCorrection, QuaternionCorrectionMode } from '../../retargetCorrections';

defineProps<{
  correctionModeOptions: Array<{ label: string; value: QuaternionCorrectionMode }>;
  corrections: QuaternionCorrection[];
  activeCorrectionCount: number;
}>();

const correctionMode = defineModel<QuaternionCorrectionMode>('correctionMode', { required: true });

const emit = defineEmits<{
  addCorrection: [];
  clearCorrections: [];
  toggleCorrection: [id: string];
  removeCorrection: [id: string];
}>();
</script>

<template>
  <div class="correction-panel">
    <div class="correction-title">
      <span>Clip Corrections</span>
      <small>{{ activeCorrectionCount }}/{{ corrections.length }} active</small>
    </div>
    <SelectButton
      v-model="correctionMode"
      class="correction-mode-select"
      :options="correctionModeOptions"
      optionLabel="label"
      optionValue="value"
      :allowEmpty="false"
    />
    <div class="quat-actions">
      <Button label="Add correction" icon="pi pi-plus" size="small" @click="emit('addCorrection')" />
      <Button
        label="Clear"
        size="small"
        text
        severity="secondary"
        :disabled="corrections.length === 0"
        @click="emit('clearCorrections')"
      />
    </div>

    <div v-if="corrections.length" class="correction-list">
      <div v-for="correction in corrections" :key="correction.id" class="correction-item" :class="{ disabled: !correction.enabled }">
        <div>
          <strong>{{ correction.bone }}</strong>
          <span>{{ correction.mode }} · [{{ correction.q.map((n) => n.toFixed(3)).join(', ') }}]</span>
        </div>
        <div class="correction-actions">
          <Button
            :label="correction.enabled ? 'On' : 'Off'"
            size="small"
            text
            @click="emit('toggleCorrection', correction.id)"
          />
          <Button
            icon="pi pi-times"
            aria-label="Remove correction"
            size="small"
            text
            severity="danger"
            @click="emit('removeCorrection', correction.id)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.correction-panel {
  margin-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 10px;
}

.correction-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
}

.correction-title small {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.48);
}

:deep(.correction-mode-select) {
  display: flex;
  padding: 2px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  margin-top: 8px;
}

:deep(.correction-mode-select .p-togglebutton) {
  flex: 1;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font-size: 10px;
  padding: 5px 6px;
}

:deep(.correction-mode-select .p-togglebutton[data-p-checked="true"]) {
  background: rgba(147, 180, 255, 0.18);
  color: #dce7ff;
}

.quat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.correction-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.correction-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 7px;
  background: rgba(255, 255, 255, 0.035);
}

.correction-item.disabled {
  opacity: 0.45;
}

.correction-item strong,
.correction-item span {
  display: block;
  min-width: 0;
}

.correction-item strong {
  font-size: 11px;
}

.correction-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}

.correction-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>
