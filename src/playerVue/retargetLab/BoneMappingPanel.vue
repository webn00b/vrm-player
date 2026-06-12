<script setup lang="ts">
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ManualFbxBoneMapping } from '../../animationLoaders/fbxBoneMapping';
import type { RetargetLabAnalysis, SkeletonJointMeta } from '../../retargetLabModel';

type MappingView = 'body' | 'fingers' | 'all';

interface RetargetSlot {
  name: VRMHumanBoneName;
  label: string;
  required: boolean;
}

defineProps<{
  mappingViewOptions: Array<{ label: string; value: MappingView }>;
  visibleSlots: RetargetSlot[];
  sourceOptions: SkeletonJointMeta[];
  mapping: ManualFbxBoneMapping;
  analysis: RetargetLabAnalysis | null;
  loading: boolean;
  importing: boolean;
  requiredMissingCount: number;
  mappedCount: number;
  slotCount: number;
}>();

const mappingView = defineModel<MappingView>('mappingView', { required: true });
const emit = defineEmits<{
  auto: [];
  clear: [];
  mappingChange: [slot: VRMHumanBoneName, value: string];
}>();
</script>

<template>
  <section class="lab-pane lab-mapping">
    <div class="section-title">
      <div>
        <h2>Bone Mapping</h2>
        <p>{{ requiredMissingCount }} required slots missing · {{ mappedCount }}/{{ slotCount }} mapped</p>
      </div>
      <div class="actions">
        <SelectButton
          v-model="mappingView"
          class="mapping-view-select"
          :options="mappingViewOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
        />
        <Button label="Auto" size="small" text :disabled="!analysis || loading || importing" @click="emit('auto')" />
        <Button label="Clear" size="small" text severity="secondary" :disabled="!analysis || loading || importing" @click="emit('clear')" />
      </div>
    </div>

    <div class="mapping-table">
      <div class="mapping-head">
        <span>VRM slot</span>
        <span>Source bone</span>
      </div>
      <div
        v-for="slot in visibleSlots"
        :key="slot.name"
        class="mapping-row"
        :class="{ 'missing-required': slot.required && !mapping[slot.name] }"
      >
        <div class="slot-label">
          <strong>{{ slot.label }}</strong>
          <span :class="{ missing: slot.required && !mapping[slot.name] }">
            {{ slot.required ? 'Required' : 'Optional' }}
          </span>
        </div>
        <select
          :value="mapping[slot.name] || ''"
          :disabled="!analysis || analysis.format === 'vrma' || sourceOptions.length === 0 || importing"
          @change="emit('mappingChange', slot.name, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">Unassigned</option>
          <option v-for="joint in sourceOptions" :key="joint.id" :value="joint.name">
            {{ joint.name }}{{ joint.trackCount ? ` (${joint.trackCount})` : '' }}
          </option>
        </select>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lab-pane {
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(16, 16, 16, 0.92);
  padding: 14px;
}

.lab-mapping {
  grid-column: 2;
  grid-row: 1 / span 2;
}

.section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.section-title h2 {
  margin: 0 0 4px;
  font-size: 16px;
  letter-spacing: 0;
}

.section-title p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.58);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

:deep(.mapping-view-select) {
  display: flex;
  padding: 2px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
}

:deep(.mapping-view-select .p-togglebutton) {
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font-size: 11px;
  padding: 5px 8px;
}

:deep(.mapping-view-select .p-togglebutton[data-p-checked="true"]) {
  background: rgba(147, 180, 255, 0.18);
  color: #dce7ff;
}

.mapping-table {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
}

.mapping-head,
.mapping-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.9fr) minmax(180px, 1.1fr);
  gap: 10px;
  align-items: center;
  padding: 5px 10px;
}

.mapping-head {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.mapping-row {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 2px solid transparent;
  transition: background 100ms;
}

.mapping-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.mapping-row.missing-required {
  border-left-color: #f59e0b;
  background: rgba(245, 158, 11, 0.06);
}

.slot-label strong {
  display: block;
  font-size: 12px;
}

.slot-label span {
  display: block;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.48);
}

.slot-label .missing {
  color: #fbbf24;
}

select {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: #0d0d0f;
  color: #e6e6e6;
  padding: 5px 8px;
  font-size: 12px;
}

@media (max-width: 1080px) {
  .lab-mapping {
    grid-column: auto;
    grid-row: auto;
  }
}
</style>
