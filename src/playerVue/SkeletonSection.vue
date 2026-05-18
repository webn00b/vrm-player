<script setup lang="ts">
/**
 * Replaces `wireSkeletonToggles` + `wireBoneDrag` from
 * debugPanelTools.ts. Top section of the Main tab (after Demo mode):
 *   - 👤 Show model
 *   - 🦴 Show skeleton (+ body / fingers sub-toggles when on)
 *   - 🎯 Drag bones + Reset
 *
 * Default state: skeleton ON (visible by default for debug view), avatar
 * mesh OFF (opt-in via the model toggle) — same as the original.
 *
 * Bone-drag ON force-enables the skeleton overlay (there's nothing to
 * grab otherwise — matches `forceSkeletonOn` from the original).
 */

import { onMounted } from 'vue';
import type { SkeletonVisualizer } from '../skeletonVisualizer';
import type { BoneDragController } from '../boneDragController';
import { sceneControlsState as scene } from './sceneControlsState';

const props = defineProps<{
  skelViz: SkeletonVisualizer;
  boneDrag: BoneDragController;
  setModelVisible: (v: boolean) => void;
}>();

onMounted(() => {
  // Initial commit: skeleton visible, model hidden — matches the legacy
  // default. The actual sub-state (body / fingers) reflects whatever
  // SkeletonVisualizer was constructed with.
  props.setModelVisible(scene.modelOn);
  props.skelViz.setVisible(scene.skeletonOn);
  props.skelViz.setShowBody(scene.skelBodyOn);
  props.skelViz.setShowFingers(scene.skelFingersOn);
  props.skelViz.setShowLabels(scene.skelLabelsOn);
  props.boneDrag.setEnabled(scene.dragOn);
});

function toggleModel(): void {
  scene.modelOn = !scene.modelOn;
  props.setModelVisible(scene.modelOn);
}
function toggleSkeleton(): void {
  scene.skeletonOn = !scene.skeletonOn;
  props.skelViz.setVisible(scene.skeletonOn);
}
function toggleBody(): void {
  scene.skelBodyOn = !scene.skelBodyOn;
  props.skelViz.setShowBody(scene.skelBodyOn);
}
function toggleFingers(): void {
  scene.skelFingersOn = !scene.skelFingersOn;
  props.skelViz.setShowFingers(scene.skelFingersOn);
}
function toggleLabels(): void {
  scene.skelLabelsOn = !scene.skelLabelsOn;
  props.skelViz.setShowLabels(scene.skelLabelsOn);
  if (scene.skelLabelsOn && !scene.skeletonOn) {
    scene.skeletonOn = true;
    props.skelViz.setVisible(true);
  }
}
function toggleDrag(): void {
  scene.dragOn = !scene.dragOn;
  props.boneDrag.setEnabled(scene.dragOn);
  // Force-enable skeleton when turning drag on — same UX as legacy.
  if (scene.dragOn && !scene.skeletonOn) {
    scene.skeletonOn = true;
    props.skelViz.setVisible(true);
  }
}
function resetDrag(): void {
  props.boneDrag.resetAll();
}
</script>

<template>
  <div class="dbg-row">
    <span class="dbg-label">👤 Show model</span>
    <button class="dbg-toggle" :class="{ off: !scene.modelOn }" @click="toggleModel">
      {{ scene.modelOn ? 'ON' : 'OFF' }}
    </button>
  </div>
  <div class="dbg-row">
    <span class="dbg-label">🦴 Show skeleton</span>
    <button class="dbg-toggle" :class="{ off: !scene.skeletonOn }" @click="toggleSkeleton">
      {{ scene.skeletonOn ? 'ON' : 'OFF' }}
    </button>
  </div>
  <div v-show="scene.skeletonOn" class="dbg-row">
    <span class="dbg-label" style="opacity:.6;font-size:11px">🩵 Body &nbsp;&nbsp; 💛 Fingers</span>
    <div style="display:flex;gap:4px">
      <button class="dbg-toggle" :class="{ off: !scene.skelBodyOn }"    @click="toggleBody">
        {{ scene.skelBodyOn ? 'ON' : 'OFF' }}
      </button>
      <button class="dbg-toggle" :class="{ off: !scene.skelFingersOn }" @click="toggleFingers">
        {{ scene.skelFingersOn ? 'ON' : 'OFF' }}
      </button>
    </div>
  </div>
  <div v-show="scene.skeletonOn" class="dbg-row">
    <span class="dbg-label">🏷 Bone labels</span>
    <button
      class="dbg-toggle"
      :class="{ off: !scene.skelLabelsOn }"
      title="Show humanoid bone names in the 3D view"
      @click="toggleLabels"
    >
      {{ scene.skelLabelsOn ? 'ON' : 'OFF' }}
    </button>
  </div>
  <div class="dbg-row">
    <span class="dbg-label">🎯 Drag bones</span>
    <div class="dbg-btn-group">
      <button
        class="dbg-toggle"
        :class="{ off: !scene.dragOn }"
        title="Click joints in 3D to attach a rotation gizmo"
        @click="toggleDrag"
      >{{ scene.dragOn ? 'ON' : 'OFF' }}</button>
      <button
        class="dbg-toggle off"
        title="Clear all drag offsets"
        @click="resetDrag"
      >Reset</button>
    </div>
  </div>
</template>
