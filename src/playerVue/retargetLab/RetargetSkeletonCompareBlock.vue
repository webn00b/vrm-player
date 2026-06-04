<script setup lang="ts">
import type { SkeletonPreview } from './retargetPreviewModel';
import RetargetSkeletonPreviewCard from './RetargetSkeletonPreviewCard.vue';

defineProps<{
  originalPreview: SkeletonPreview;
  correctedPreview: SkeletonPreview;
  activeCorrectionCount: number;
}>();
</script>

<template>
  <div class="compare-block">
    <div class="preview-title compare-heading">
      <span>Target A/B</span>
      <small>{{ activeCorrectionCount }} correction{{ activeCorrectionCount === 1 ? '' : 's' }}</small>
    </div>
    <div class="compare-grid">
      <RetargetSkeletonPreviewCard
        title="Original target"
        meta="without settings"
        svg-label="Original target skeleton"
        compare
        :preview="originalPreview"
      />
      <RetargetSkeletonPreviewCard
        title="Corrected target"
        meta="active corrections"
        svg-label="Corrected target skeleton"
        corrected
        compare
        :preview="correctedPreview"
      />
    </div>
  </div>
</template>

<style scoped>
.compare-block {
  margin-top: 12px;
}

.preview-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
  font-weight: 700;
}

.preview-title small {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.48);
}

.compare-heading {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px 8px 0 0;
  background: rgba(255, 255, 255, 0.045);
}

.compare-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 8px;
}

@media (max-width: 1080px) {
  .compare-grid {
    grid-template-columns: 1fr;
  }
}
</style>
