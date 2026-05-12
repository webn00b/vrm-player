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

const props = defineProps<{
  pa:    PriorityAnimator;
  micro: MicroAnimations;
  idle:  IdleLoop;
  controller: AnimationController;
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
type LayerKey = 'idle' | 'breathing' | 'headSway' | 'eyeSaccades' | 'blink' | 'weightShift';
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
    (props.micro as any)[key] = layers[key];
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
        :class="{ active: activeTab === 'main' }"
        @click="activeTab = 'main'"
      >Main</button>
      <button
        class="dbg-tab"
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

      <!-- Skeleton section (ids consumed by wireDebugPanelTools) ─────────── -->
      <h2>Skeleton</h2>
      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">👤 Show model</span>
          <button class="dbg-toggle off" id="model-toggle">OFF</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🦴 Show skeleton</span>
          <button class="dbg-toggle" id="skel-toggle">ON</button>
        </div>
        <div class="dbg-row" id="skel-options" style="display:flex">
          <span class="dbg-label" style="opacity:.6;font-size:11px">🩵 Body &nbsp;&nbsp; 💛 Fingers</span>
          <div style="display:flex;gap:4px">
            <button class="dbg-toggle" id="skel-body">ON</button>
            <button class="dbg-toggle" id="skel-fingers">ON</button>
          </div>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🎯 Drag bones</span>
          <div style="display:flex;gap:3px">
            <button class="dbg-toggle off" id="bone-drag-toggle"
                    title="Click joints in 3D to attach a rotation gizmo">OFF</button>
            <button class="dbg-toggle off" id="bone-drag-reset"
                    title="Clear all drag offsets">Reset</button>
          </div>
        </div>
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

      <!-- Validation fold (id'd elements for wireDebugPanelTools) ─────────── -->
      <details
        class="dbg-fold"
        id="fold-validation"
        :open="foldOpen['fold-validation']"
        @toggle="onFoldToggle('fold-validation', $event)"
      >
        <summary>Validation (ROM)</summary>
        <div class="dbg-section">
          <div class="dbg-row">
            <span class="dbg-label">🦴 Clamp bone rotations</span>
            <button class="dbg-toggle" id="val-toggle">ON</button>
          </div>
          <div class="dbg-stat" id="val-stat">clamped/frame: 0</div>
          <div class="dbg-stat" id="val-worst">worst: —</div>
          <div class="dbg-row">
            <span class="dbg-label" style="opacity:.6;font-size:11px">dump defaults to console</span>
            <button class="dbg-toggle off" id="val-dump">Dump</button>
          </div>
          <div class="dbg-row" style="margin-top:6px">
            <span class="dbg-label">📋 Skel log</span>
            <div style="display:flex;gap:3px">
              <button class="dbg-toggle off" id="skel-log-btn"
                      title="Toggle compact per-frame skeleton diagnostics. Stop → console digest.">⏺ Rec</button>
              <button class="dbg-toggle off" id="skel-log-dl"
                      title="Download last digest as .txt">⬇</button>
            </div>
          </div>
          <div class="dbg-stat" id="skel-log-stat"></div>
        </div>
      </details>

      <!-- Diagnostics fold (id'd elements for wireDebugPanelStats) ────────── -->
      <details
        class="dbg-fold"
        id="fold-diagnostics"
        :open="foldOpen['fold-diagnostics']"
        @toggle="onFoldToggle('fold-diagnostics', $event)"
      >
        <summary>Diagnostics</summary>
        <div class="dbg-section">
          <div class="dbg-levels">
            <div class="dbg-level-row">
              <span class="dbg-lv-label">Lv 1 – lower body</span>
              <div class="dbg-bar-wrap"><div class="dbg-bar" id="dbg-bar-1"></div></div>
            </div>
            <div class="dbg-level-row">
              <span class="dbg-lv-label">Lv 2 – upper body</span>
              <div class="dbg-bar-wrap"><div class="dbg-bar" id="dbg-bar-2"></div></div>
            </div>
            <div class="dbg-level-row">
              <span class="dbg-lv-label">Lv 5+ – gesture</span>
              <div class="dbg-bar-wrap"><div class="dbg-bar" id="dbg-bar-5"></div></div>
            </div>
          </div>
          <div class="dbg-stat" id="dbg-bones">Active bones: 0</div>
          <div class="dbg-stat" id="dbg-clips">Idle clips: {{ idle.clipCount }}</div>
        </div>
      </details>

      <!-- Hip force fold (id'd elements for wireDebugPanelStats) ──────────── -->
      <details
        class="dbg-fold"
        id="fold-hipforce"
        :open="foldOpen['fold-hipforce']"
        @toggle="onFoldToggle('fold-hipforce', $event)"
      >
        <summary>Hip force</summary>
        <div class="dbg-section">
          <div class="dbg-stat" id="dbg-hipforce-mass">tracked mass: —</div>
          <div class="dbg-stat" id="dbg-hipforce-total">|F_total|: —</div>
          <div class="dbg-stat" id="dbg-hipforce-grav">|F_grav|:  —</div>
          <div class="dbg-stat" id="dbg-hipforce-inert">|F_inert|: —</div>
          <div class="dbg-stat" id="dbg-hipforce-tilt">tilt vs Y_hip: —</div>
          <div class="dbg-stat" id="dbg-hipforce-gtilt">gravity tilt: —</div>
          <div class="dbg-row" style="margin-top:6px">
            <span class="dbg-label">⚖ Balance corrector</span>
            <button class="dbg-toggle off" id="hipbal-btn">OFF</button>
          </div>
          <div class="dbg-stat" id="dbg-hipbal-angles">corr. angles: —</div>
        </div>
      </details>

    </div>

    <!-- ── VIDEO TAB ──────────────────────────────────────────────────────── -->
    <div v-show="activeTab === 'video'" class="dbg-tab-panel active" data-panel="video">

      <div class="dbg-section">
        <div class="dbg-row">
          <span class="dbg-label">🎯 Pose model</span>
          <div style="display:flex;gap:3px">
            <button class="dbg-toggle off" data-quality="lite">lite</button>
            <button class="dbg-toggle"     data-quality="full">full</button>
            <button class="dbg-toggle off" data-quality="heavy">heavy</button>
          </div>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🪞 Mirror mode</span>
          <button class="dbg-toggle" id="mocap-mirror-btn">ON</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">😶 Face tracking</span>
          <button class="dbg-toggle" id="mocap-face-btn">ON</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">🚶 Hip position</span>
          <button class="dbg-toggle" id="mocap-hip-btn">ON</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label" style="font-size:11px"
                title="When ON: if one arm/leg becomes invisible and the other side is live, copy the visible side's local quaternions to the missing side. Works for bilaterally-symmetric poses (claps, mirror dance); produces wrong poses for asymmetric motion. Off by default.">
            🪟 Symmetry fallback
          </span>
          <button class="dbg-toggle off" id="mocap-symmetry-btn">OFF</button>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">📐 Depth</span>
          <div style="display:flex;gap:3px">
            <button class="dbg-toggle off" data-depth="0">2D</button>
            <button class="dbg-toggle off" data-depth="0.5">mid</button>
            <button class="dbg-toggle"     data-depth="1">3D</button>
          </div>
        </div>
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
          <div class="dbg-row">
            <span class="dbg-label">🌊 1€ smoothing</span>
            <button class="dbg-toggle" id="mocap-filter-btn">ON</button>
          </div>
          <div class="dbg-row">
            <label class="dbg-label" for="mocap-handprio-box">✋ Wrist + fingers priority</label>
            <input type="checkbox" id="mocap-handprio-box" checked
                   style="width:14px;height:14px;accent-color:#6ea8ff">
          </div>
          <div class="dbg-row">
            <span class="dbg-label">🟢 Performer skeleton</span>
            <button class="dbg-toggle off" id="mocap-dbgskel-btn">OFF</button>
          </div>
          <div class="dbg-row">
            <span class="dbg-label">📊 Debug record <span id="dbgrec-frames" style="opacity:.5"></span></span>
            <button class="dbg-toggle off" id="dbgrec-btn">⏺ Rec</button>
          </div>
          <div id="mocap-vis-stats" style="display:none;margin-top:4px"></div>
          <div id="mocap-scalar-stats"
               style="display:none;margin-top:6px;font-size:10px;font-family:ui-monospace,monospace;opacity:.75;line-height:1.5"></div>
          <div class="dbg-row">
            <span class="dbg-label">🔬 BVH диагностика</span>
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
