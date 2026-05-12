<script setup lang="ts">
/**
 * Vue replacement for `buildMainPanelHtml()` + the inline tab / fold /
 * demo / layer-toggle logic that lived in `mountDebugPanel`.
 *
 * Strategy: **bridge migration**.
 *
 * Things genuinely converted to Vue reactivity:
 *   - Tabs (Main / Video) — `activeTab: ref<'main'|'video'>` + v-show
 *   - <details> fold persistence — open-state per-id in localStorage,
 *     reactive `foldOpen` map + @toggle handler
 *   - Demo mode toggle — `demoMode: ref<boolean>` + reactive class/text
 *   - Layer toggles (idle / breathing / headSway / etc.) — `states: reactive`
 *     with simple click→toggle handlers
 *
 * Things left as id'd `<button>` / `<div>` containers for the existing
 * imperative `wireXxx` functions (debugPanelTools / Stats / MocapControls
 * / etc.) to attach listeners to AFTER mount:
 *   - Skeleton row (model/skeleton/body/fingers/drag toggles)
 *   - Validation fold (val-toggle, val-stat, skel-log buttons)
 *   - Diagnostics fold (priority bars + active-bones / clips readouts)
 *   - Hip force fold (mass / total / grav / inert / tilt readouts)
 *   - Video tab body (mocap params, advanced, dbgrec)
 *
 * Those wireXxx functions query `document.getElementById(...)` which still
 * works because Vue renders the same IDs and never unmounts these nodes
 * (we use v-show for tabs, native <details> for folds — DOM persists).
 *
 * Per-section deeper Vue migration can land in follow-up commits.
 */

import { ref, reactive, onMounted, watch } from 'vue';
import type { IdleLoop } from '../idleLoop';
import type { PriorityAnimator } from '../priorityAnimator';
import type { MicroAnimations } from '../microAnimations';
import type { AnimationController } from '../animationController';
import type { HipForceTracker } from '../physics/hipForce';
import type { HipBalanceCorrector } from '../physics/hipBalanceCorrector';
import type { MocapController } from '../mocap/pipeline/mocapController';
import type { MocapDebugViz } from '../mocap/diagnostics/mocapDebugViz';
import type { MocapDebugRecorder } from '../mocap/diagnostics/mocapDebugRecorder';
import type { BoneValidator } from '../validation/boneValidator';
import type { SkeletonVisualizer } from '../skeletonVisualizer';
import type { BoneDragController } from '../boneDragController';
import type { SkeletonLogger } from '../diagnostics/skeletonLogger';
import StatsPanel from './StatsPanel.vue';
import HipForcePanel from './HipForcePanel.vue';
import MocapStatsPanel from './MocapStatsPanel.vue';
import SkeletonSection from './SkeletonSection.vue';
import ValidationFoldContent from './ValidationFoldContent.vue';
import MocapParamsControls from './MocapParamsControls.vue';
import MocapAdvancedRows from './MocapAdvancedRows.vue';
import DebugRecorderRow from './DebugRecorderRow.vue';

const props = defineProps<{
  pa:    PriorityAnimator;
  micro: MicroAnimations;
  idle:  IdleLoop;
  controller: AnimationController;
  hipForce:   HipForceTracker;
  hipBalance: HipBalanceCorrector;
  getMocap:      () => MocapController | null;
  mocapDebugViz: MocapDebugViz;
  // Props for the Vue-migrated tools sections (Skeleton, Validation, etc).
  validator:       BoneValidator;
  skelViz:         SkeletonVisualizer;
  boneDrag:        BoneDragController;
  skeletonLogger:  SkeletonLogger;
  mocap:           MocapController;
  getController:   () => AnimationController | null;
  setModelVisible: (v: boolean) => void;
  dbgRecorder:     MocapDebugRecorder;
}>();

// ── Tabs ─────────────────────────────────────────────────────────────────────
const activeTab = ref<'main' | 'video'>('main');

// ── Folds (per-id open state, persisted to localStorage) ─────────────────────
const FOLD_KEY = 'vrm-player.dbg-fold';
const foldOpen = reactive<Record<string, boolean>>({});
try {
  const raw = localStorage.getItem(FOLD_KEY);
  if (raw) Object.assign(foldOpen, JSON.parse(raw));
} catch { /* quota / private mode — silently ignore */ }
watch(foldOpen, (next) => {
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}, { deep: true });

/** Use as `@toggle="onFoldToggle('fold-id', $event)"` on `<details>`. */
function onFoldToggle(id: string, e: Event): void {
  foldOpen[id] = (e.target as HTMLDetailsElement).open;
}

// ── Demo mode ────────────────────────────────────────────────────────────────
const demoMode = ref(false);
function toggleDemo(): void {
  demoMode.value = !demoMode.value;
  props.controller.setMuted(demoMode.value);
  if (!demoMode.value) props.pa.reset();
}

// ── Layer toggles (idle / breathing / headSway / eyeSaccades / blink / weightShift) ─
/** Keys on MicroAnimations that are simple boolean enable flags. Picking
 *  them explicitly gives us a type-safe `(props.micro)[key]` index access
 *  without `as any`. */
type MicroKey = 'breathing' | 'headSway' | 'eyeSaccades' | 'blink' | 'weightShift';
type LayerKey = 'idle' | MicroKey;
const layers = reactive<Record<LayerKey, boolean>>({
  idle: false, breathing: false, headSway: false,
  eyeSaccades: false, blink: false, weightShift: false,
});
function toggleLayer(key: LayerKey): void {
  layers[key] = !layers[key];
  if (key === 'idle') {
    props.idle.enabled = layers[key];
    if (!layers[key]) props.pa.reset();
  } else {
    props.micro[key as MicroKey] = layers[key];
  }
}

// ── Apply initial fold state on mount ────────────────────────────────────────
onMounted(() => {
  // <details> elements use the native HTML `open` attribute. v-bind:open
  // applies the persisted state — Vue refs do this reactively but for
  // initial mount we ensure the attribute is in sync.
  for (const id in foldOpen) {
    const el = document.getElementById(id) as HTMLDetailsElement | null;
    if (el && foldOpen[id]) el.open = true;
  }
});
</script>

<template>
  <div>
    <!-- Tabs ─────────────────────────────────────────────────────────────── -->
    <div class="dbg-tabs">
      <button
        class="dbg-tab"
        data-testid="dbg-tab-main"
        :class="{ active: activeTab === 'main' }"
        @click="activeTab = 'main'"
      >Main</button>
      <button
        class="dbg-tab"
        data-testid="dbg-tab-video"
        :class="{ active: activeTab === 'video' }"
        @click="activeTab = 'video'"
      >Video</button>
    </div>

    <!-- ── MAIN TAB ───────────────────────────────────────────────────────── -->
    <div v-show="activeTab === 'main'" class="dbg-tab-panel active" data-panel="main">

      <!-- Demo mode ─────────────────────────────────────────────────────── -->
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label" style="font-weight:600">🎭 Demo mode</span>
          <button
            class="dbg-toggle"
            :class="{ off: !demoMode }"
            @click="toggleDemo"
          >{{ demoMode ? 'ON' : 'OFF' }}</button>
        </div>
        <div class="dbg-hint" :style="{ opacity: demoMode ? 0 : 0.5 }">
          Mutes BVH — shows idle priority blending
        </div>
      </div>

      <div class="dbg-divider"></div>

      <!-- Skeleton section — fully migrated to Vue (SkeletonSection.vue) ─── -->
      <h2>Skeleton</h2>
      <div class="dbg-section">
        <SkeletonSection
          :skelViz="skelViz"
          :boneDrag="boneDrag"
          :setModelVisible="setModelVisible"
        />
      </div>

      <div class="dbg-divider"></div>

      <!-- Idle poses fold ─────────────────────────────────────────────────── -->
      <details
        class="dbg-fold"
        id="fold-idle"
        :open="foldOpen['fold-idle']"
        @toggle="onFoldToggle('fold-idle', $event)"
      >
        <summary>Idle poses</summary>
        <div class="dbg-section">
          <div class="dbg-row" v-for="(label, key) in {
            idle:         '💃 Idle poses',
            breathing:    '🫁 Breathing',
            headSway:     '🌊 Head sway',
            eyeSaccades:  '👁 Eye saccades',
            blink:        '😑 Blink',
            weightShift:  '⚖️ Weight shift',
          } as Record<LayerKey, string>" :key="key">
            <span class="dbg-label">{{ label }}</span>
            <button
              class="dbg-toggle"
              :class="{ off: !layers[key] }"
              @click="toggleLayer(key)"
            >{{ layers[key] ? 'ON' : 'OFF' }}</button>
          </div>
        </div>
      </details>

      <!-- Validation fold — fully migrated to Vue (ValidationFoldContent.vue) -->
      <details
        class="dbg-fold"
        id="fold-validation"
        :open="foldOpen['fold-validation']"
        @toggle="onFoldToggle('fold-validation', $event)"
      >
        <summary>Validation (ROM)</summary>
        <div class="dbg-section">
          <ValidationFoldContent
            :validator="validator"
            :skeletonLogger="skeletonLogger"
            :mocap="mocap"
            :getController="getController"
          />
        </div>
      </details>

      <!-- Diagnostics fold — fully migrated to Vue (StatsPanel.vue) ─────── -->
      <details
        class="dbg-fold"
        id="fold-diagnostics"
        :open="foldOpen['fold-diagnostics']"
        @toggle="onFoldToggle('fold-diagnostics', $event)"
      >
        <summary>Diagnostics</summary>
        <div class="dbg-section">
          <StatsPanel :pa="pa" :idleClips="idle.clipCount" />
        </div>
      </details>

      <!-- Hip force fold — fully migrated to Vue (HipForcePanel.vue). Polling
           is skipped when the fold is collapsed via the `open` prop. -->
      <details
        class="dbg-fold"
        id="fold-hipforce"
        :open="foldOpen['fold-hipforce']"
        @toggle="onFoldToggle('fold-hipforce', $event)"
      >
        <summary>Hip force</summary>
        <div class="dbg-section">
          <HipForcePanel
            :hipForce="hipForce"
            :hipBalance="hipBalance"
            :open="!!foldOpen['fold-hipforce']"
          />
        </div>
      </details>

    </div>

    <!-- ── VIDEO TAB ──────────────────────────────────────────────────────── -->
    <div v-show="activeTab === 'video'" class="dbg-tab-panel active" data-panel="video">

      <!-- Pose / mirror / face / hip / symmetry / depth — fully migrated. -->
      <div class="dbg-section">
        <MocapParamsControls :getMocap="getMocap" />
      </div>

      <div class="dbg-divider"></div>

      <details
        class="dbg-fold"
        id="fold-mocap-advanced"
        :open="foldOpen['fold-mocap-advanced']"
        @toggle="onFoldToggle('fold-mocap-advanced', $event)"
      >
        <summary>Mocap advanced</summary>
        <div class="dbg-section">
          <!-- 1€ smoothing + Wrist+fingers priority — fully migrated. -->
          <MocapAdvancedRows :getMocap="getMocap" />

          <!-- Performer skeleton overlay + per-landmark visibility + scalar
               stats — fully migrated (MocapStatsPanel.vue). -->
          <MocapStatsPanel :getMocap="getMocap" :mocapDebugViz="mocapDebugViz" />

          <!-- Debug record row — fully migrated (DebugRecorderRow.vue). -->
          <DebugRecorderRow :dbgRecorder="dbgRecorder" />

          <div class="dbg-row">
            <span class="dbg-label">🔬 BVH диагностика</span>
            <!-- bvh-diag-btn — id'd, owned by mountBvhModal. -->
            <button class="dbg-toggle off" id="bvh-diag-btn">Inspect</button>
          </div>
        </div>
      </details>

      <div class="dbg-hint">Detailed tuning sliders are in the panel on the right →</div>

    </div>
  </div>
</template>

<style scoped>
/* This component renders elements that use global CSS rules from index.html
   (.dbg-tabs / .dbg-tab / .dbg-toggle / .dbg-section / etc.). We intentionally
   don't restyle them — match the rest of the player's look. */
</style>
