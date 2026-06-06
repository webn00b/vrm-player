<script setup lang="ts">
/**
 * Replaces `wireValidation` + `wireSkeletonLogger` from debugPanelTools.ts.
 * Inside content of the Validation fold on the Main tab:
 *   - 🦴 Clamp bone rotations ON/OFF + per-frame clamped count + worst
 *     bone readout (polled at 200 ms)
 *   - 📋 Skel-log Rec / Stop + download last digest
 */

import { ref, onMounted, onUnmounted } from 'vue';
import type { BoneValidator } from '../validation/boneValidator';
import type { PoseValidator } from '../validation/poseValidator';
import type { SkeletonLogger } from '../diagnostics/skeletonLogger';
import type { MotionTraceRecorder } from '../diagnostics/motionTraceRecorder';
import type { MocapController } from '../mocap/pipeline/mocapController';
import type { AnimationController } from '../animationController';

const props = defineProps<{
  validator: BoneValidator;
  poseValidator?: PoseValidator;
  skeletonLogger: SkeletonLogger;
  motionTraceRecorder: MotionTraceRecorder;
  mocap: MocapController;
  getController: () => AnimationController | null;
}>();

const valStat  = ref('clamped/frame: 0');
const valWorst = ref('worst: —');
const valArms  = ref('arms: —');
const poseStat = ref('pose: —');

const logActive = ref(false);
const logStat   = ref('');
const traceActive = ref(false);
const traceStat   = ref('');

let pollTimer = 0;

function fmtDeg(value: number | null): string {
  return Number.isFinite(value) ? `${value!.toFixed(0)}°` : '—';
}

function armFlag(value: number | null): string {
  return Number.isFinite(value) && value! > 120 ? ' back' : '';
}

onMounted(() => {
  pollTimer = window.setInterval(() => {
    // Validator stats — always polled, cheap.
    const s = props.validator.getStats();
    valStat.value = `clamped/frame: ${s.clampedThisFrame}`;
    valWorst.value = s.worstBone
      ? `worst: ${s.worstBone} +${(s.worstDelta * 180 / Math.PI).toFixed(1)}°`
      : 'worst: —';
    const left = s.armPosture.left;
    const right = s.armPosture.right;
    valArms.value =
      `arms: L upper ${fmtDeg(left.upperArmForwardDeg)}${armFlag(left.upperArmForwardDeg)} / fore ${fmtDeg(left.forearmForwardDeg)}${armFlag(left.forearmForwardDeg)}` +
      ` · R upper ${fmtDeg(right.upperArmForwardDeg)}${armFlag(right.upperArmForwardDeg)} / fore ${fmtDeg(right.forearmForwardDeg)}${armFlag(right.forearmForwardDeg)}`;
    const pose = props.poseValidator?.getStats();
    poseStat.value = pose
      ? `pose: clamped ${pose.clampedThisFrame} · ${pose.violations.length ? pose.violations.join(', ') : 'ok'}`
      : 'pose: —';
    // Skel-log live frame count while recording.
    if (props.skeletonLogger.active) {
      logStat.value = `${props.skeletonLogger.frameCount}fr · recording…`;
    }
    if (props.motionTraceRecorder.active) {
      traceActive.value = true;
      traceStat.value = `${props.motionTraceRecorder.frameCount}fr · ${props.motionTraceRecorder.elapsed.toFixed(1)}s`;
    } else {
      traceActive.value = false;
      const trace = props.motionTraceRecorder.getTrace();
      traceStat.value = trace ? `${trace.frameCount}fr · ${trace.duration.toFixed(2)}s saved` : '';
    }
  }, 200);
});
onUnmounted(() => clearInterval(pollTimer));

function dumpConstraints(): void {
  console.log('[validator] active profile:', {
    enabled: props.validator.enabled,
    profileId: props.validator.profileId,
    stats: props.validator.getStats(),
    constraints: props.validator.getConstraints(),
  });
}

// ── Skel-log ───────────────────────────────────────────────────────────────
function inferLogLabel(): string {
  if (props.mocap.state !== 'off') return 'mocap';
  const c = props.getController();
  if (c && c.hasBvhActive) return 'clip';
  return 'idle';
}
function toggleLog(): void {
  if (props.skeletonLogger.active) {
    const digest = props.skeletonLogger.stop();
    console.log(digest);
    logActive.value = false;
    logStat.value = `${props.skeletonLogger.frameCount}fr · digest in console`;
  } else {
    props.skeletonLogger.start(inferLogLabel());
    logActive.value = true;
    logStat.value = 'recording…';
  }
}
function downloadLog(): void {
  if (props.skeletonLogger.frameCount === 0) {
    logStat.value = 'no recording yet';
    return;
  }
  props.skeletonLogger.download(`skel_log_${Date.now()}.txt`);
}

// ── Motion trace ───────────────────────────────────────────────────────────
function inferTraceLabel(): string {
  const c = props.getController();
  if (c?.currentName) return c.currentName;
  return inferLogLabel();
}
function toggleTrace(): void {
  if (props.motionTraceRecorder.active) {
    const trace = props.motionTraceRecorder.stop();
    traceActive.value = false;
    traceStat.value = `${trace.frameCount}fr · ${trace.duration.toFixed(2)}s saved`;
    props.motionTraceRecorder.download(`${trace.name}_${Date.now()}.motion_trace.json`);
  } else {
    props.motionTraceRecorder.start(inferTraceLabel());
    traceActive.value = true;
    traceStat.value = 'recording…';
  }
}
function downloadTrace(): void {
  const trace = props.motionTraceRecorder.getTrace();
  if (!trace) {
    traceStat.value = 'no trace yet';
    return;
  }
  props.motionTraceRecorder.download(`${trace.name}_${Date.now()}.motion_trace.json`);
}
</script>

<template>
  <div class="dbg-stat">{{ valStat }}</div>
  <div class="dbg-stat">{{ valWorst }}</div>
  <div class="dbg-stat">{{ valArms }}</div>
  <div class="dbg-stat">{{ poseStat }}</div>

  <div class="dbg-row">
    <span class="dbg-label" style="opacity:.6;font-size:11px">dump active profile to console</span>
    <button class="dbg-toggle off" @click="dumpConstraints">Dump</button>
  </div>

  <div class="dbg-row" style="margin-top:6px">
    <span class="dbg-label">📋 Skel log</span>
    <div class="dbg-btn-group">
      <button
        class="dbg-toggle"
        :class="{ off: !logActive }"
        title="Toggle compact per-frame skeleton diagnostics. Stop → console digest."
        @click="toggleLog"
      >{{ logActive ? '⏹ Stop' : '⏺ Rec' }}</button>
      <button
        class="dbg-toggle off"
        title="Download last digest as .txt"
        @click="downloadLog"
      >⬇</button>
    </div>
  </div>
  <div class="dbg-stat">{{ logStat }}</div>

  <div class="dbg-row" style="margin-top:6px">
    <span class="dbg-label">🧪 Motion trace</span>
    <div class="dbg-btn-group">
      <button
        class="dbg-toggle"
        :class="{ off: !traceActive }"
        title="Record final normalized bone local rotations and world positions as motion_trace.json"
        @click="toggleTrace"
      >{{ traceActive ? '⏹ Stop' : '⏺ Rec' }}</button>
      <button
        class="dbg-toggle off"
        title="Download last motion trace as JSON for tools/animation_validator.py"
        @click="downloadTrace"
      >⬇</button>
    </div>
  </div>
  <div class="dbg-stat">{{ traceStat }}</div>
</template>
