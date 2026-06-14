<script setup lang="ts">
import type { UiMode } from './playerShellTypes';

defineProps<{
  uiMode: UiMode;
  zenMode: boolean;
  isCollapsed: (id: string) => boolean;
}>();

const emit = defineEmits<{
  togglePanel: [id: string];
}>();

function onShellClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const title = target?.closest('.panel-title');
  if (!title) return;
  if (target?.closest('button, input, select, textarea, a')) return;

  const panel = title.closest<HTMLElement>('.panel');
  if (!panel?.id) return;
  emit('togglePanel', panel.id);
}
</script>

<template>
  <div
    id="ui-overlay"
    :data-ui-mode="uiMode"
    :class="{ zen: zenMode }"
    @click.capture="onShellClick"
  >
    <div id="left-col">
      <div id="debug-panel" class="panel" :class="{ collapsed: isCollapsed('debug-panel') }">
        <p class="panel-title"><span>Controls</span></p>
        <div id="debug-panel-root"></div>
      </div>
      <div
        id="mocap-preview-panel"
        class="panel"
        :class="{ collapsed: isCollapsed('mocap-preview-panel') }"
        style="display:none"
      >
        <p class="panel-title"><span>Performer skeleton</span></p>
        <canvas id="mocap-canvas"></canvas>
      </div>
      <div id="queue-panel" class="panel" :class="{ collapsed: isCollapsed('queue-panel') }">
        <p class="panel-title"><span>Queue</span></p>
        <div id="queue-panel-root"></div>
      </div>
    </div>

    <div id="center-col">
      <div id="scene-toolbar-root"></div>
      <div id="validation-controls-root"></div>
      <div id="player-start-root"></div>
    </div>

    <div id="right-col">
      <div
        id="mocap-tuning-panel"
        class="panel"
        :class="{ collapsed: isCollapsed('mocap-tuning-panel') }"
      >
        <p class="panel-title"><span>Capture</span></p>
        <div id="mocap-tuning-panel-root"></div>
      </div>
    </div>

    <div id="bottom-bar"></div>
  </div>
</template>

<style>
#ui-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(220px, 268px) 1fr minmax(240px, 300px);
  grid-template-rows: 1fr;
  gap: 12px;
  padding: 70px 12px 82px;
  pointer-events: none;
  z-index: 10;
}

#ui-overlay.zen {
  grid-template-columns: 1fr;
}

#ui-overlay.zen #left-col,
#ui-overlay.zen #right-col {
  display: none;
}

#ui-overlay.zen #center-col {
  grid-column: 1 / -1;
}

#ui-overlay[data-ui-mode="play"] {
  grid-template-columns: minmax(220px, 268px) 1fr;
}

#ui-overlay[data-ui-mode="capture"] {
  grid-template-columns: 1fr minmax(250px, 310px);
}

#ui-overlay[data-ui-mode="inspect"] {
  grid-template-columns: minmax(230px, 280px) 1fr;
}

#ui-overlay[data-ui-mode="play"] #debug-panel,
#ui-overlay[data-ui-mode="play"] #mocap-tuning-panel,
#ui-overlay[data-ui-mode="capture"] #debug-panel,
#ui-overlay[data-ui-mode="inspect"] #mocap-tuning-panel {
  display: none !important;
}

#ui-overlay[data-ui-mode="play"] #right-col,
#ui-overlay[data-ui-mode="capture"] #left-col,
#ui-overlay[data-ui-mode="inspect"] #right-col {
  display: none;
}

#ui-overlay[data-ui-mode="play"] #center-col,
#ui-overlay[data-ui-mode="inspect"] #center-col {
  grid-column: 2;
}

#ui-overlay[data-ui-mode="capture"] #center-col {
  grid-column: 1;
}

#ui-overlay[data-ui-mode="capture"] #right-col {
  grid-column: 2;
}

#ui-overlay[data-ui-mode="capture"] #queue-panel,
#ui-overlay[data-ui-mode="inspect"] #queue-panel {
  max-height: 260px;
}

#ui-overlay[data-ui-mode="play"] #left-col {
  align-self: end;
}

#ui-overlay[data-ui-mode="play"] #queue-panel {
  max-height: min(360px, 42vh);
  min-height: 170px;
}

#ui-overlay[data-ui-mode="capture"] #mocap-tuning-panel-root > div > .dbg-divider,
#ui-overlay[data-ui-mode="capture"] #mocap-tuning-panel-root > div > .dbg-divider ~ * {
  display: none !important;
}

#ui-overlay[data-ui-mode="inspect"] #debug-panel .dbg-hint {
  opacity: 0.42;
}

#left-col,
#right-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  pointer-events: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

#center-col {
  display: grid;
  grid-template-rows: auto auto 1fr;
  align-items: start;
  justify-items: center;
  pointer-events: none;
  min-height: 0;
}

#scene-toolbar-root,
#validation-controls-root,
#player-start-root {
  pointer-events: auto;
}

#validation-controls-root {
  margin-top: 6px;
}

#bottom-bar {
  position: fixed;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  width: min(920px, calc(100vw - 24px));
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: auto;
  z-index: 24;
}

.panel {
  position: relative;
  background: linear-gradient(180deg, rgba(15, 18, 22, 0.9), rgba(9, 11, 14, 0.86));
  backdrop-filter: blur(14px);
  border: 1px solid rgba(169, 210, 215, 0.11);
  border-radius: 8px;
  padding: 10px 12px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.28);
  transition: padding 160ms ease;
}

.panel-title {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.4;
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.panel-title:hover { opacity: 0.7; }

.panel-title::after {
  content: '▾';
  font-size: 9px;
  opacity: 0.6;
  transform: rotate(0deg);
  transition: transform 160ms ease;
}

.panel.collapsed { padding: 7px 12px; }
.panel.collapsed > .panel-title { margin: 0; }
.panel.collapsed > .panel-title::after { transform: rotate(-90deg); }
.panel.collapsed > *:not(.panel-title) { display: none !important; }

#queue-panel {
  /* flex-basis auto (not 0): in play mode #left-col is auto-height, and a
     zero basis collapses the panel to its min-height instead of letting it
     grow with the queue up to its max-height. */
  flex: 1 1 auto;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 80px;
}

#queue-panel-root {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

#mocap-tuning-panel,
#debug-panel,
#mocap-preview-panel {
  flex-shrink: 0;
}

#mocap-preview-panel {
  display: flex;
  flex-direction: column;
}

#mocap-canvas {
  display: block;
  width: 100%;
  min-height: 0;
  flex: 1 1 auto;
  border-radius: 3px;
  background: #000;
}

#mocap-video {
  display: none;
}

/* Live webcam preview: a mirrored thumbnail in the corner while capturing,
   so the performer can see themselves during recording. */
#mocap-video.preview {
  display: block;
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 240px;
  height: auto;
  max-height: 40vh;
  z-index: 30;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  transform: scaleX(-1); /* mirror for a natural selfie view */
  background: #000;
  pointer-events: none;
}
#mocap-video.preview.recording {
  border-color: #ff4d4f;
  box-shadow: 0 0 0 2px rgba(255, 77, 79, 0.6), 0 6px 24px rgba(0, 0, 0, 0.45);
}

@media (max-width: 860px) {
  #ui-overlay {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
    align-content: start;
    gap: 8px;
    overflow-y: auto;
    padding-top: 112px;
    padding-bottom: 74px;
  }

  #ui-overlay[data-ui-mode="play"] #left-col {
    display: none;
  }

  #left-col,
  #right-col {
    width: 100%;
    max-height: none;
    overflow: visible;
  }

  #center-col {
    display: grid;
    grid-column: 1 !important;
  }

  #scene-toolbar-root {
    display: none;
  }

  #bottom-bar {
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
    transform: none;
    z-index: 25;
  }

  #queue-panel {
    min-height: 180px;
    max-height: none;
  }

  #ui-overlay.zen {
    display: block;
    overflow: hidden;
    padding-bottom: 74px;
  }
}
</style>
