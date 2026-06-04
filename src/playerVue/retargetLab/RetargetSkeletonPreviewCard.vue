<script setup lang="ts">
import type { SkeletonPreview } from './retargetPreviewModel';

withDefaults(defineProps<{
  title: string;
  meta: string;
  preview: SkeletonPreview;
  svgLabel: string;
  corrected?: boolean;
  compare?: boolean;
}>(), {
  corrected: false,
  compare: false,
});
</script>

<template>
  <div class="preview-card" :class="{ corrected, compare }">
    <div class="preview-title">
      <span>{{ title }}</span>
      <small>{{ meta }}</small>
    </div>
    <svg
      viewBox="0 0 100 100"
      class="skeleton-svg"
      :class="{ correctedSvg: corrected }"
      role="img"
      :aria-label="svgLabel"
    >
      <line
        v-for="line in preview.lines"
        :key="line.id"
        :x1="line.x1"
        :y1="line.y1"
        :x2="line.x2"
        :y2="line.y2"
        :class="{ active: line.active }"
      />
      <circle
        v-for="node in preview.nodes"
        :key="node.id"
        :cx="node.x"
        :cy="node.y"
        :r="node.active ? 1.9 : 1.15"
        :class="{ active: node.active, missing: node.missing }"
      >
        <title>{{ node.name }}</title>
      </circle>
    </svg>
  </div>
</template>

<style scoped>
.preview-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: #0d0d0f;
  overflow: hidden;
}

.preview-card.compare {
  border-color: rgba(147, 180, 255, 0.12);
}

.preview-card.corrected {
  border-color: rgba(34, 197, 94, 0.2);
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

.skeleton-svg {
  display: block;
  width: 100%;
  height: clamp(300px, 28vw, 460px);
  background:
    linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
  background-size: 20px 20px;
}

.skeleton-svg line {
  stroke: rgba(255, 255, 255, 0.26);
  stroke-width: 0.75;
  vector-effect: non-scaling-stroke;
}

.skeleton-svg line.active {
  stroke: #93b4ff;
  stroke-width: 1.35;
}

.skeleton-svg.correctedSvg line.active {
  stroke: #86efac;
}

.skeleton-svg circle {
  fill: rgba(255, 255, 255, 0.48);
  stroke: rgba(0, 0, 0, 0.7);
  stroke-width: 0.45;
  vector-effect: non-scaling-stroke;
}

.skeleton-svg circle.active {
  fill: #93b4ff;
}

.skeleton-svg.correctedSvg circle.active {
  fill: #86efac;
}

.skeleton-svg circle.missing {
  fill: #f59e0b;
}

@media (max-width: 1080px) {
  .skeleton-svg {
    height: 320px;
  }
}
</style>
