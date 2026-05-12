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

import { ref, onMounted } from 'vue';
import type { SkeletonVisualizer } from '../skeletonVisualizer';
import type { BoneDragController } from '../boneDragController';

const props = defineProps<{
  skelViz: SkeletonVisualizer;
  boneDrag: BoneDragController;
  setModelVisible: (v: boolean) => void;
}>();

const modelOn      = ref(false);
const skeletonOn   = ref(true);
const skelBodyOn   = ref(true);
const skelFingersOn = ref(true);
const dragOn       = ref(false);

onMounted(() => {
  // Initial commit: skeleton visible, model hidden — matches the legacy
  // default. The actual sub-state (body / fingers) reflects whatever
  // SkeletonVisualizer was constructed with.
  props.setModelVisible(false);
  props.skelViz.setVisible(true);
  skeletonOn.value   = props.skelViz.visible;
  skelBodyOn.value   = props.skelViz.showBody;
  skelFingersOn.value = props.skelViz.showFingers;
  dragOn.value       = props.boneDrag.enabled;
});

function toggleModel(): void {
  modelOn.value = !modelOn.value;
  props.setModelVisible(modelOn.value);
}
function toggleSkeleton(): void {
  skeletonOn.value = !skeletonOn.value;
  props.skelViz.setVisible(skeletonOn.value);
}
function toggleBody(): void {
  skelBodyOn.value = !skelBodyOn.value;
  props.skelViz.setShowBody(skelBodyOn.value);
}
function toggleFingers(): void {
  skelFingersOn.value = !skelFingersOn.value;
  props.skelViz.setShowFingers(skelFingersOn.value);
}
function toggleDrag(): void {
  dragOn.value = !dragOn.value;
  props.boneDrag.setEnabled(dragOn.value);
  // Force-enable skeleton when turning drag on — same UX as legacy.
  if (dragOn.value && !skeletonOn.value) {
    skeletonOn.value = true;
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
    <button class="dbg-toggle" :class="{ off: !modelOn }" @click="toggleModel">
      {{ modelOn ? 'ON' : 'OFF' }}
    </button>
  </div>
  <div class="dbg-row">
    <span class="dbg-label">🦴 Show skeleton</span>
    <button class="dbg-toggle" :class="{ off: !skeletonOn }" @click="toggleSkeleton">
      {{ skeletonOn ? 'ON' : 'OFF' }}
    </button>
  </div>
  <div v-show="skeletonOn" class="dbg-row">
    <span class="dbg-label" style="opacity:.6;font-size:11px">🩵 Body &nbsp;&nbsp; 💛 Fingers</span>
    <div style="display:flex;gap:4px">
      <button class="dbg-toggle" :class="{ off: !skelBodyOn }"    @click="toggleBody">
        {{ skelBodyOn ? 'ON' : 'OFF' }}
      </button>
      <button class="dbg-toggle" :class="{ off: !skelFingersOn }" @click="toggleFingers">
        {{ skelFingersOn ? 'ON' : 'OFF' }}
      </button>
    </div>
  </div>
  <div class="dbg-row">
    <span class="dbg-label">🎯 Drag bones</span>
    <div style="display:flex;gap:3px">
      <button
        class="dbg-toggle"
        :class="{ off: !dragOn }"
        title="Click joints in 3D to attach a rotation gizmo"
        @click="toggleDrag"
      >{{ dragOn ? 'ON' : 'OFF' }}</button>
      <button
        class="dbg-toggle off"
        title="Clear all drag offsets"
        @click="resetDrag"
      >Reset</button>
    </div>
  </div>
</template>
