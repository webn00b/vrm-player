<script setup lang="ts">
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import type { SkeletonJointMeta, RetargetLabAnalysis } from '../../retargetLabModel';
import type { QuaternionCorrection } from '../../retargetCorrections';
import type { MappingReportRow, SummaryRow } from './retargetReportModel';
import RetargetReportCorrectionsSection from './RetargetReportCorrectionsSection.vue';
import RetargetReportJointsSection from './RetargetReportJointsSection.vue';
import RetargetReportKeyValueSection from './RetargetReportKeyValueSection.vue';
import RetargetReportMappingSection from './RetargetReportMappingSection.vue';
import RetargetReportSummarySection from './RetargetReportSummarySection.vue';
import RetargetReportWarningsSection from './RetargetReportWarningsSection.vue';

defineProps<{
  summaryRows: SummaryRow[];
  quaternionRows: SummaryRow[];
  corrections: QuaternionCorrection[];
  activeCorrectionCount: number;
  mappingRows: MappingReportRow[];
  mappedCount: number;
  slotCount: number;
  analysis: RetargetLabAnalysis | null;
  targetJoints: SkeletonJointMeta[];
}>();

const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{
  copy: [];
}>();
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    dismissable-mask
    :draggable="false"
    :style="{ width: '760px', maxWidth: '94vw' }"
    :content-style="{ maxHeight: '78vh', overflow: 'auto', padding: '0' }"
  >
    <template #header>
      <div class="modal-header">
        <span class="modal-title">Retarget report</span>
        <Button
          icon="pi pi-copy"
          label="copy"
          severity="secondary"
          size="small"
          text
          @click="emit('copy')"
        />
      </div>
    </template>

    <div class="report-dashboard">
      <RetargetReportSummarySection :rows="summaryRows" />
      <RetargetReportKeyValueSection title="Quaternion State" :rows="quaternionRows" />
      <RetargetReportCorrectionsSection
        :corrections="corrections"
        :active-correction-count="activeCorrectionCount"
      />
      <RetargetReportMappingSection
        :rows="mappingRows"
        :mapped-count="mappedCount"
        :slot-count="slotCount"
      />
      <RetargetReportWarningsSection :warnings="analysis?.warnings ?? []" />
      <RetargetReportJointsSection
        :source-joints="analysis?.sourceJoints ?? []"
        :target-joints="targetJoints"
      />
    </div>
  </Dialog>
</template>

<style scoped>
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.modal-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}

.report-dashboard {
  padding: 14px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: #e0e0e0;
}
</style>
