<script setup lang="ts">
/**
 * Vue-owned overlay shell for the player page.
 *
 * The app still mounts feature islands into stable DOM anchors because the
 * Three.js/mocap bootstrap is not fully componentized yet. This component owns
 * those anchors, panel collapse persistence, and the hidden mocap media nodes.
 */

import { reactive, ref } from 'vue';
import SelectButton from 'primevue/selectbutton';
import Toast from 'primevue/toast';
import FileConverter from '../exports/FileConverter.vue';

const PANEL_KEY = 'vrm-player.panel-collapsed';
const PAGE_KEY = 'vrm-player.active-page';
const collapsed = reactive<Record<string, boolean>>({});
type AppPage = 'player' | 'retarget' | 'tools';
const pageOptions: Array<{ label: string; value: AppPage }> = [
  { label: 'Player', value: 'player' },
  { label: 'Retarget Lab', value: 'retarget' },
  { label: 'Convert & re-export', value: 'tools' },
];
const storedPage = (() => {
  try { return localStorage.getItem(PAGE_KEY); } catch { return null; }
})();
const activePage = ref<AppPage>(
  storedPage === 'tools' || storedPage === 'retarget' ? storedPage : 'player',
);

try {
  const raw = localStorage.getItem(PANEL_KEY);
  if (raw) Object.assign(collapsed, JSON.parse(raw));
} catch { /* ignore */ }

function save(): void {
  try { localStorage.setItem(PANEL_KEY, JSON.stringify(collapsed)); } catch { /* ignore */ }
}

function isCollapsed(id: string): boolean {
  return !!collapsed[id];
}

function setPage(next: AppPage | null): void {
  if (!next) return;
  activePage.value = next;
  try { localStorage.setItem(PAGE_KEY, next); } catch { /* ignore */ }
}

function onShellClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const title = target?.closest('.panel-title');
  if (!title) return;
  if (target?.closest('button, input, select, textarea, a')) return;

  const panel = title.closest<HTMLElement>('.panel');
  if (!panel?.id) return;
  collapsed[panel.id] = !collapsed[panel.id];
  save();
}
</script>

<template>
  <div id="app-page-tabs">
    <SelectButton
      class="app-page-select"
      :modelValue="activePage"
      :options="pageOptions"
      optionLabel="label"
      optionValue="value"
      :allowEmpty="false"
      @update:modelValue="setPage"
    />
  </div>

  <div id="ui-overlay" v-show="activePage === 'player'" @click.capture="onShellClick">
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
        <canvas id="mocap-canvas"></canvas>
      </div>
      <div id="queue-panel" class="panel" :class="{ collapsed: isCollapsed('queue-panel') }">
        <p class="panel-title"><span>Queue</span></p>
        <div id="queue-panel-root"></div>
      </div>
    </div>

    <div id="center-col"></div>

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

  <div id="tools-page" v-show="activePage === 'tools'">
    <div class="tools-page-inner">
      <section class="tools-section">
        <div class="tools-heading">
          <h1>Conversion</h1>
          <p>Convert animation files to JSON without loading them into the avatar.</p>
        </div>
        <FileConverter />
      </section>

      <section class="tools-section">
        <div class="tools-heading">
          <h1>Re-export</h1>
          <p>Download loaded queue clips as BVH, GLB, or VRMA.</p>
        </div>
        <div id="tools-reexport-root"></div>
      </section>
    </div>
  </div>

  <div id="retarget-page" v-show="activePage === 'retarget'">
    <div id="retarget-lab-root"></div>
  </div>

  <video id="mocap-video" playsinline></video>
  <Toast position="bottom-right" />
</template>

<style>
#app-page-tabs {
  position: fixed;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  pointer-events: auto;
}

:where(.app-page-select) {
  display: flex;
  padding: 3px;
  border-radius: 9px;
  background: rgba(16, 16, 16, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}

:where(.app-page-select .p-togglebutton) {
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
  padding: 6px 12px;
}

:where(.app-page-select .p-togglebutton-content) {
  background: transparent;
}

:where(.app-page-select .p-togglebutton[data-p-checked="true"]) {
  background: #2a3550;
  color: #fff;
}

.app-page-select .p-togglebutton .p-togglebutton-content {
  background: transparent !important;
}

.app-page-select .p-togglebutton {
  background: transparent !important;
  color: rgba(255, 255, 255, 0.6) !important;
}

.app-page-select .p-togglebutton[data-p-checked="true"] {
  background: #2a3550 !important;
  color: #fff !important;
}

.app-page-select .p-togglebutton[data-p-checked="true"] .p-togglebutton-label {
  color: #fff !important;
}

#ui-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-columns: 240px 1fr 260px;
  grid-template-rows: 1fr auto;
  gap: 8px;
  padding: 8px;
  padding-top: 46px;
  pointer-events: none;
  z-index: 10;
}

#left-col,
#right-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow-y: auto;
  pointer-events: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

#center-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
  min-height: 0;
}

#bottom-bar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: auto;
  padding: 0 2px;
}

.panel {
  position: relative;
  background: rgba(16, 16, 16, 0.92);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  padding: 10px 12px;
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
  flex: 1 1 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 80px;
}

#queue-panel-root {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

#mocap-tuning-panel,
#debug-panel,
#mocap-preview-panel {
  flex-shrink: 0;
}

#mocap-canvas {
  display: block;
  width: 100%;
  border-radius: 3px;
  background: #000;
}

#mocap-video {
  display: none;
}

#tools-page,
#retarget-page {
  position: fixed;
  inset: 0;
  z-index: 12;
  overflow: auto;
  padding: 58px 24px 24px;
  background: #0d0d0f;
  color: #e6e6e6;
  pointer-events: auto;
}

#retarget-lab-root {
  min-height: 320px;
}

.tools-page-inner {
  width: min(1120px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
  gap: 18px;
  align-items: start;
}

.tools-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tools-heading h1 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0;
}

.tools-heading p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  opacity: 0.58;
}

#tools-reexport-root {
  min-height: 260px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(16, 16, 16, 0.92);
  padding: 12px;
}

@media (max-width: 860px) {
  #app-page-tabs {
    left: 8px;
    right: 8px;
    transform: none;
  }
  :where(.app-page-select .p-togglebutton) {
    flex: 1;
    padding-inline: 8px;
  }
  #ui-overlay {
    padding-top: 54px;
  }
  .tools-page-inner {
    grid-template-columns: 1fr;
  }
}
</style>
