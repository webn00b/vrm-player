<script setup lang="ts">
/**
 * Replaces `wireDebugRecorder` from debugPanelTools.ts. One row in the
 * Mocap-advanced fold:
 *   📊 Debug record [<frame count>] [⏺ Rec / ⏹ Stop]
 */

import { ref, onMounted, onUnmounted } from 'vue';
import type { MocapDebugRecorder } from '../mocap/diagnostics/mocapDebugRecorder';

const props = defineProps<{
  dbgRecorder: MocapDebugRecorder;
}>();

const active     = ref(false);
const frameLabel = ref('');

let timer = 0;
onMounted(() => {
  timer = window.setInterval(() => {
    if (props.dbgRecorder.active) {
      active.value = true;
      frameLabel.value = `${props.dbgRecorder.frameCount}fr`;
    } else {
      active.value = false;
      frameLabel.value = props.dbgRecorder.frameCount > 0
        ? `${props.dbgRecorder.frameCount}fr saved`
        : '';
    }
  }, 200);
});
onUnmounted(() => clearInterval(timer));

function toggle(): void {
  if (props.dbgRecorder.active) {
    props.dbgRecorder.stop();
    active.value = false;
  } else {
    props.dbgRecorder.start();
    active.value = true;
  }
}
</script>

<template>
  <div class="dbg-row">
    <span class="dbg-label">
      📊 Debug record <span style="opacity:.5">{{ frameLabel }}</span>
    </span>
    <button
      class="dbg-toggle"
      :class="{ off: !active }"
      @click="toggle"
    >{{ active ? '⏹ Stop' : '⏺ Rec' }}</button>
  </div>
</template>
