<script setup lang="ts">
/**
 * Progress bar for the multi-minute video→BVH conversion. Shows the current
 * phase (analyze → lift → smooth → render), a step counter, the frame fraction,
 * and a filled bar. Driven by reactive props the CaptureSection poll updates
 * from MocapController.fileCaptureProgress.
 */
defineProps<{
  pct: number;        // 0..100 within the current phase
  phaseLabel: string; // human phase name, e.g. "Analyzing"
  step: number;       // 1-based phase index
  totalSteps: number;
  detail: string;     // e.g. "120 / 736 frames"
}>();
</script>

<template>
  <div class="cap-progress" data-testid="capture-progress">
    <div class="cap-progress-head">
      <span class="cap-progress-phase">{{ phaseLabel }}</span>
      <span class="cap-progress-step">step {{ step }}/{{ totalSteps }}</span>
    </div>
    <div class="cap-progress-track">
      <div class="cap-progress-fill" :style="{ width: pct + '%' }"></div>
    </div>
    <div class="cap-progress-detail">{{ detail }} · {{ pct }}%</div>
  </div>
</template>

<style scoped>
.cap-progress {
  margin: 6px 0 2px;
}
.cap-progress-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}
.cap-progress-phase {
  font-size: 11px;
  font-weight: 700;
  color: #e6e6e6;
}
.cap-progress-step {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
}
.cap-progress-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.cap-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #3b5bdb, #4c8dff);
  transition: width 180ms ease;
}
.cap-progress-detail {
  margin-top: 4px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}
</style>
