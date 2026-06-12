<script setup lang="ts">
import type { SkeletonPreview } from './retargetPreviewModel';
import RetargetSkeletonCompareBlock from './RetargetSkeletonCompareBlock.vue';
import RetargetSkeletonPreviewCard from './RetargetSkeletonPreviewCard.vue';

defineProps<{
  sourcePreview: SkeletonPreview;
  targetPreview: SkeletonPreview;
  originalComparePreview: SkeletonPreview;
  correctedComparePreview: SkeletonPreview;
  activeCorrectionCount: number;
}>();
</script>

<template>
  <section class="lab-pane lab-preview">
    <div class="section-title">
      <div>
        <h2>Skeleton Preview</h2>
        <p>Bright joints are currently mapped into humanoid slots.</p>
      </div>
    </div>

    <div class="preview-grid">
      <RetargetSkeletonPreviewCard
        title="Source"
        :meta="`${sourcePreview.nodes.length} joints`"
        svg-label="Source skeleton preview"
        :preview="sourcePreview"
      />
      <RetargetSkeletonPreviewCard
        title="Target VRM"
        :meta="`${targetPreview.nodes.length} joints`"
        svg-label="Target skeleton preview"
        :preview="targetPreview"
      />
    </div>

    <RetargetSkeletonCompareBlock
      v-if="activeCorrectionCount > 0"
      :original-preview="originalComparePreview"
      :corrected-preview="correctedComparePreview"
      :active-correction-count="activeCorrectionCount"
    />
    <p v-else class="compare-hint">
      Add a clip correction to compare the original and corrected targets here.
    </p>
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

/* Lives in the left column under the source panel, so the skeletons stay
   near the viewport while the (tall) mapping table is being edited. */
.lab-preview {
  grid-column: 1;
  grid-row: 2;
  align-self: start;
}

.compare-hint {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.42);
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

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 1080px) {
  .lab-preview {
    grid-column: auto;
    grid-row: auto;
  }

  .preview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
