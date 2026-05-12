<script setup lang="ts">
/**
 * Replaces `mountBvhVerifyModal` (279 LOC of state machine + manual
 * overlay) with a single Vue component. Owns:
 *   - The Round-trip verify fold UI (Source + replay-mode rows)
 *   - The capture → retarget → replay → diff state machine
 *   - The inline PrimeVue Dialog (BvhVerifyModal) that displays progress
 *
 * Fold open-state persisted to the same `vrm-player.dbg-fold` localStorage
 * key the other folds use, so user preferences stay coherent.
 */

import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import BvhVerifyModal from './BvhVerifyModal.vue';
import type { MocapController } from '../mocap/pipeline/mocapController';
import {
  clearDiagBuffer,
  compareSnapshots,
  flushDiagBuffer,
  formatReport,
  replayClipWithSnapshots,
  type PoseSnapshot,
} from '../mocap/bvh/bvhRoundtripVerifier';
import { runProductionReplay } from '../mocap/bvh/bvhRoundtripProductionReplay';
import { parseBVH } from '../bvhLoader';
import { retargetBvhToVrm } from '../retarget';

const props = defineProps<{
  getMocap: () => MocapController | null;
}>();

// ── State machine ──────────────────────────────────────────────────────────
const CAPTURE_DURATION_MS = 3000;

type State = 'idle' | 'capturing' | 'retargeting' | 'replaying' | 'reporting';
type Source = { kind: 'live' } | { kind: 'file'; file: File };
type ReplayMode = 'prod' | 'iso';

const state       = ref<State>('idle');
const replayMode  = ref<ReplayMode>('prod');
const stateLabel  = ref('');
const modalOpen   = ref(false);
const modalText   = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

let activeTimers = new Set<number>();
const trackTimeout = (cb: () => void, ms: number): number => {
  const id = window.setTimeout(() => { activeTimers.delete(id); cb(); }, ms);
  activeTimers.add(id);
  return id;
};

function setStatePhase(s: State): void {
  state.value = s;
  stateLabel.value = s === 'idle' ? '' : `(${s}…)`;
}

function openModal(text: string): void {
  modalText.value = text;
  modalOpen.value = true;
}
function setModalText(text: string): void { modalText.value = text; }
function appendModalLine(line: string): void {
  modalText.value = modalText.value ? `${modalText.value}\n${line}` : line;
}

function fail(err: string): void {
  setStatePhase('idle');
  console.warn('[verify] fail:', err);
  if (modalOpen.value) appendModalLine(`\n❌ ${err}`);
  else openModal(`❌ ${err}`);
}

async function runLive(mocap: MocapController): Promise<{ bvh: string; expected: PoseSnapshot[] } | null> {
  if (mocap.state !== 'live') {
    fail(`Need mocap state === 'live'; current: '${mocap.state}'. Start the camera first.`);
    return null;
  }
  setStatePhase('capturing');
  mocap.startVerifyRecording();
  mocap.startVerifyCapture();

  const tickId = window.setInterval(() => {
    if (state.value !== 'capturing') return;
    stateLabel.value = `(capturing ${mocap.verifyCapturedCount} frames…)`;
  }, 150);
  activeTimers.add(tickId);

  await new Promise<void>((resolve) => trackTimeout(resolve, CAPTURE_DURATION_MS));

  clearInterval(tickId);
  activeTimers.delete(tickId);

  const expected = mocap.stopVerifyCapture();
  const bvh = mocap.stopVerifyRecording();
  return { bvh, expected };
}

async function runFile(mocap: MocapController, file: File): Promise<{ bvh: string; expected: PoseSnapshot[] } | null> {
  if (mocap.state !== 'off') {
    fail(`Need mocap state === 'off' for file verification; current '${mocap.state}'. Stop the camera first.`);
    return null;
  }
  setStatePhase('capturing');
  stateLabel.value = `(processing ${file.name}…)`;
  try {
    return await mocap.startVerifyFromFile(file, (frames) => {
      if (state.value === 'capturing') {
        stateLabel.value = `(processing ${file.name}, ${frames} frames…)`;
      }
    });
  } catch (e) {
    fail(`file processing failed: ${(e as Error).message}`);
    return null;
  }
}

async function run(source: Source): Promise<void> {
  const mocap = props.getMocap();
  if (!mocap) { fail('Mocap not initialized'); return; }

  clearDiagBuffer();
  openModal(`🧪 BVH round-trip verification — ${replayMode.value === 'prod' ? 'PRODUCTION' : 'ISOLATED'} replay
Source: ${source.kind === 'live' ? 'live camera (3s)' : `video file "${source.file.name}"`}
`);
  console.info('[verify] run start', { mode: replayMode.value, source: source.kind });

  // ── Capture ─────────────────────────────────────────────────────────────
  appendModalLine(`[1/4] Capturing…`);
  const cap = source.kind === 'live' ? await runLive(mocap) : await runFile(mocap, source.file);
  if (!cap) return;
  const { bvh: bvhText, expected } = cap;
  appendModalLine(`      ✓ captured ${expected.length} frames, BVH ${bvhText.length} chars`);

  if (expected.length < 2) { fail(`captured only ${expected.length} frame(s)`); return; }
  if (!bvhText)            { fail('BVH generation returned empty'); return; }

  // ── Retarget ────────────────────────────────────────────────────────────
  setStatePhase('retargeting');
  appendModalLine(`[2/4] Retargeting BVH → VRMA → clip…`);
  let clip;
  try {
    const parsed = parseBVH(bvhText);
    clip = await retargetBvhToVrm(mocap.vrm, parsed, 'verify-roundtrip');
  } catch (e) {
    fail(`retarget failed: ${(e as Error).message}`);
    return;
  }
  appendModalLine(`      ✓ clip duration=${clip.duration.toFixed(3)}s, tracks=${clip.tracks.length}`);

  // ── Replay ──────────────────────────────────────────────────────────────
  setStatePhase('replaying');
  appendModalLine(`[3/4] Replaying (${replayMode.value})… this may take up to ${expected.length}/30 = ${(expected.length / 30).toFixed(1)}s`);
  await new Promise((r) => trackTimeout(r as () => void, 50));

  let actual: PoseSnapshot[];
  let lastProg = 0;
  try {
    if (replayMode.value === 'iso') {
      actual = replayClipWithSnapshots(mocap.vrm, clip, expected.length);
    } else {
      actual = await runProductionReplay(mocap.vrm, clip, expected.length, (i) => {
        if (i - lastProg >= 15 || i === expected.length) {
          appendModalLine(`      … ${i}/${expected.length} frames`);
          lastProg = i;
        }
        if (state.value === 'replaying') {
          stateLabel.value = `(prod replay ${i}/${expected.length}…)`;
        }
      });
    }
  } catch (e) {
    fail(`replay failed: ${(e as Error).message}`);
    return;
  }
  appendModalLine(`      ✓ captured ${actual.length} actual snapshots`);

  // ── Diff ────────────────────────────────────────────────────────────────
  setStatePhase('reporting');
  appendModalLine(`[4/4] Comparing expected vs actual…`);
  const report = compareSnapshots(expected, actual);
  const header = `=== Replay mode: ${replayMode.value === 'prod' ? 'PRODUCTION (renderLoop + clamp + vrm.update)' : 'ISOLATED (scratch mixer)'} ===\n\n`;
  const diagLines = flushDiagBuffer();
  const diagSection = diagLines.length > 0
    ? `--- Diagnostics (per-stage trace, copy-friendly) ---\n${diagLines.join('\n')}\n\n`
    : '';
  setModalText(header + diagSection + formatReport(report));
  setStatePhase('idle');
}

// ── UI event handlers ──────────────────────────────────────────────────────
function onLiveClick(): void {
  if (state.value !== 'idle') return;
  run({ kind: 'live' }).catch((e) => fail((e as Error).message));
}
function onFileBtnClick(): void {
  if (state.value !== 'idle') return;
  fileInputRef.value?.click();
}
function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f || state.value !== 'idle') return;
  run({ kind: 'file', file: f }).catch((e) => fail((e as Error).message));
}
function setReplayMode(m: ReplayMode): void {
  if (state.value !== 'idle') return;
  replayMode.value = m;
}

// ── Fold open-state (shared localStorage key) ──────────────────────────────
const FOLD_KEY = 'vrm-player.dbg-fold';
const FOLD_ID  = 'fold-roundtrip';
const foldOpen = reactive<Record<string, boolean>>({});
try {
  const raw = localStorage.getItem(FOLD_KEY);
  if (raw) Object.assign(foldOpen, JSON.parse(raw));
} catch { /* ignore */ }
watch(foldOpen, (next) => {
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}, { deep: true });
function onFoldToggle(e: Event): void {
  foldOpen[FOLD_ID] = (e.target as HTMLDetailsElement).open;
}

onMounted(() => { /* no-op; refs already wired */ });
onUnmounted(() => {
  for (const id of activeTimers) {
    clearTimeout(id);
    clearInterval(id);
  }
  activeTimers.clear();
});
</script>

<template>
  <details
    class="dbg-fold"
    :id="FOLD_ID"
    :open="foldOpen[FOLD_ID]"
    @toggle="onFoldToggle"
  >
    <summary>Round-trip verify
      <span style="opacity:.5;text-transform:none;letter-spacing:0">{{ stateLabel }}</span>
    </summary>
    <div class="dbg-section">
      <div class="dbg-row">
        <span class="dbg-label">Source</span>
        <div style="display:flex;gap:3px">
          <button
            class="dbg-toggle off"
            :disabled="state !== 'idle'"
            title="Live camera: record 3s → replay the BVH → diff each frame"
            @click="onLiveClick"
          >{{ state === 'idle' ? 'Live (3s)' : '…' }}</button>
          <button
            class="dbg-toggle off"
            :disabled="state !== 'idle'"
            title="Video file: process → replay BVH → diff each frame"
            @click="onFileBtnClick"
          >{{ state === 'idle' ? 'Video…' : '…' }}</button>
          <input ref="fileInputRef" type="file" accept="video/*" hidden @change="onFileChange">
        </div>
      </div>
      <div class="dbg-row">
        <span class="dbg-label" style="opacity:.7;font-size:11px">↳ replay mode</span>
        <div style="display:flex;gap:3px">
          <button
            class="dbg-toggle"
            :class="{ off: replayMode !== 'prod' }"
            title="Play through the live render loop (validator.clampAll + vrm.update). Catches production-path divergence."
            @click="setReplayMode('prod')"
          >prod</button>
          <button
            class="dbg-toggle"
            :class="{ off: replayMode !== 'iso' }"
            title="Scratch mixer + synchronous replay. Isolates BVH encoding math."
            @click="setReplayMode('iso')"
          >iso</button>
        </div>
      </div>
    </div>
  </details>

  <!-- PrimeVue Dialog teleports itself to <body>, so it's fine rendering it
       here inside the fold — no z-index / overflow clipping issues. -->
  <BvhVerifyModal v-model="modalOpen" :content="modalText" />
</template>
