<script setup lang="ts">
/**
 * Vue-owned overlay shell for the player page.
 *
 * The app still mounts feature islands into stable DOM anchors because the
 * Three.js/mocap bootstrap is not fully componentized yet. This component owns
 * those anchors, panel collapse persistence, and the hidden mocap media nodes.
 */

import { onMounted, onUnmounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import FileConverter from '../exports/FileConverter.vue';
import LanguageHostsPage from './LanguageHostsPage.vue';
import type { AppToastPayload } from '../ui';

const PANEL_KEY = 'vrm-player.panel-collapsed';
const PAGE_KEY = 'vrm-player.active-page';
const MODE_KEY = 'vrm-player.ui-mode';
const ZEN_KEY = 'vrm-player.zen-mode';
const VIEWPORT_COMPACT_KEY = 'vrm-player.viewport-compact';
const VIEWPORT_LOG_PREFIX = '[viewport-compact]';
const collapsed = reactive<Record<string, boolean>>({});
type AppPage = 'player' | 'retarget' | 'tools' | 'hosts';
type UiMode = 'play' | 'capture' | 'inspect';
const pageOptions: Array<{ label: string; value: AppPage }> = [
  { label: 'Player', value: 'player' },
  { label: 'Retarget', value: 'retarget' },
  { label: 'Export', value: 'tools' },
  { label: 'Hosts', value: 'hosts' },
];
const modeOptions: Array<{ label: string; value: UiMode }> = [
  { label: 'Play', value: 'play' },
  { label: 'Capture', value: 'capture' },
  { label: 'Inspect', value: 'inspect' },
];
const storedPage = (() => {
  try { return localStorage.getItem(PAGE_KEY); } catch { return null; }
})();
const activePage = ref<AppPage>(
  storedPage === 'tools' || storedPage === 'retarget' || storedPage === 'hosts'
    ? storedPage
    : 'player',
);
const storedMode = (() => {
  try { return localStorage.getItem(MODE_KEY); } catch { return null; }
})();
const uiMode = ref<UiMode>(
  storedMode === 'capture' || storedMode === 'inspect' || storedMode === 'debug'
    ? (storedMode === 'debug' ? 'inspect' : storedMode)
    : 'play',
);
const zenMode = ref((() => {
  try { return localStorage.getItem(ZEN_KEY) === '1'; } catch { return false; }
})());
const viewportCompact = ref((() => {
  try {
    const stored = localStorage.getItem(VIEWPORT_COMPACT_KEY);
    console.info(VIEWPORT_LOG_PREFIX, 'shell init', { stored, compact: stored === '1' });
    return stored === '1';
  } catch (err) {
    console.warn(VIEWPORT_LOG_PREFIX, 'shell init failed to read localStorage', err);
    return false;
  }
})());
const helpOpen = ref(false);
const toast = useToast();

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

function setPage(next: AppPage | null, emitChange = true): void {
  if (!next) return;
  activePage.value = next;
  try { localStorage.setItem(PAGE_KEY, next); } catch { /* ignore */ }
  if (emitChange) {
    window.dispatchEvent(new CustomEvent<AppPage>('vrm-player:page-changed', { detail: next }));
  }
}

function setMode(next: UiMode | null): void {
  if (!next) return;
  uiMode.value = next;
  try { localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ }
}

function toggleZen(): void {
  zenMode.value = !zenMode.value;
  try { localStorage.setItem(ZEN_KEY, zenMode.value ? '1' : '0'); } catch { /* ignore */ }
}

function syncViewportCompact(): void {
  console.info(VIEWPORT_LOG_PREFIX, 'dispatch compact changed', {
    compact: viewportCompact.value,
  });
  window.dispatchEvent(new CustomEvent<boolean>(
    'vrm-player:viewport-compact-changed',
    { detail: viewportCompact.value },
  ));
}

function toggleViewportCompact(): void {
  const prev = viewportCompact.value;
  viewportCompact.value = !viewportCompact.value;
  try {
    localStorage.setItem(VIEWPORT_COMPACT_KEY, viewportCompact.value ? '1' : '0');
  } catch (err) {
    console.warn(VIEWPORT_LOG_PREFIX, 'failed to persist compact state', err);
  }
  console.info(VIEWPORT_LOG_PREFIX, 'button clicked', {
    prev,
    next: viewportCompact.value,
    stored: (() => {
      try { return localStorage.getItem(VIEWPORT_COMPACT_KEY); } catch { return null; }
    })(),
  });
  syncViewportCompact();
}

function toggleHelp(): void {
  helpOpen.value = !helpOpen.value;
}

onMounted(() => {
  syncViewportCompact();
  window.addEventListener('vrm-player:toggle-zen', toggleZen);
  window.addEventListener('vrm-player:toggle-help', toggleHelp);
  window.addEventListener('vrm-player:toast', onToast);
  window.addEventListener('vrm-player:set-page', onSetPage);
  window.addEventListener('keydown', onHelpKeydown);
});

onUnmounted(() => {
  window.removeEventListener('vrm-player:toggle-zen', toggleZen);
  window.removeEventListener('vrm-player:toggle-help', toggleHelp);
  window.removeEventListener('vrm-player:toast', onToast);
  window.removeEventListener('vrm-player:set-page', onSetPage);
  window.removeEventListener('keydown', onHelpKeydown);
});

function onToast(event: Event): void {
  const payload = (event as CustomEvent<AppToastPayload>).detail;
  if (!payload?.summary) return;
  toast.add({
    severity: payload.severity ?? 'info',
    summary: payload.summary,
    detail: payload.detail,
    life: payload.life ?? 2600,
  });
}

function onSetPage(event: Event): void {
  const page = (event as CustomEvent<AppPage>).detail;
  if (page === 'player' || page === 'retarget' || page === 'tools' || page === 'hosts') {
    setPage(page, false);
  }
}

function onHelpKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && helpOpen.value) helpOpen.value = false;
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
    <div class="shell-actions" v-show="activePage === 'player'">
      <SelectButton
        class="ui-mode-select"
        :modelValue="uiMode"
        :options="modeOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        aria-label="Player work mode"
        @update:modelValue="setMode"
      />
      <Button
        class="shell-action"
        :icon="zenMode ? 'pi pi-window-maximize' : 'pi pi-expand'"
        text
        rounded
        size="small"
        :aria-pressed="zenMode"
        title="Hide panels for scene preview"
        aria-label="Toggle zen preview"
        @click="toggleZen"
      />
      <Button
        class="shell-action viewport-compact-action"
        :icon="viewportCompact ? 'pi pi-window-maximize' : 'pi pi-window-minimize'"
        text
        rounded
        size="small"
        :aria-pressed="viewportCompact"
        :title="viewportCompact ? 'Restore viewport' : 'Shrink viewport to 256 x 256'"
        :aria-label="viewportCompact ? 'Restore viewport' : 'Shrink viewport'"
        @click="toggleViewportCompact"
      />
      <Button
        class="shell-action"
        icon="pi pi-question-circle"
        text
        rounded
        size="small"
        :aria-pressed="helpOpen"
        title="Shortcuts and workflow"
        aria-label="Open shortcuts help"
        @click="toggleHelp"
      />
    </div>
  </div>

  <aside v-show="activePage === 'player' && helpOpen" id="help-popover" aria-label="Shortcuts help">
    <div class="help-head">
      <span>Quick Help</span>
      <Button
        class="help-close"
        icon="pi pi-times"
        text
        rounded
        size="small"
        aria-label="Close help"
        @click="helpOpen = false"
      />
    </div>
    <div class="help-section">
      <h2>Workflow</h2>
      <div class="help-row"><kbd>1</kbd><span>Show avatar</span></div>
      <div class="help-row"><kbd>2</kbd><span>Add animation or start capture</span></div>
      <div class="help-row"><kbd>3</kbd><span>Play, export, or open in Retarget Lab</span></div>
    </div>
    <div class="help-section">
      <h2>Shortcuts</h2>
      <div class="help-grid">
        <kbd>Space</kbd><span>Play / pause</span>
        <kbd>M</kbd><span>Model</span>
        <kbd>S</kbd><span>Skeleton</span>
        <kbd>D</kbd><span>Drag bones</span>
        <kbd>R</kbd><span>Reset drag</span>
        <kbd>Z</kbd><span>Zen view</span>
        <kbd>?</kbd><span>This panel</span>
      </div>
    </div>
  </aside>

  <div
    id="ui-overlay"
    v-show="activePage === 'player'"
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

  <div id="hosts-page-root" v-show="activePage === 'hosts'">
    <LanguageHostsPage />
  </div>

  <video id="mocap-video" playsinline></video>
  <Toast position="bottom-right" />
</template>

<style>
#app-page-tabs {
  position: fixed;
  top: 10px;
  left: 12px;
  z-index: 30;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

:where(.app-page-select) {
  display: flex;
  padding: 3px;
  border-radius: 9px;
  background: rgba(16, 16, 16, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}

:where(.app-page-select .p-togglebutton),
:where(.ui-mode-select .p-togglebutton) {
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
  padding: 6px 12px;
}

:where(.app-page-select .p-togglebutton-content),
:where(.ui-mode-select .p-togglebutton-content) {
  background: transparent;
}

:where(.app-page-select .p-togglebutton[data-p-checked="true"]),
:where(.ui-mode-select .p-togglebutton[data-p-checked="true"]) {
  background: rgba(30, 188, 196, 0.18);
  color: #fff;
}

.app-page-select .p-togglebutton .p-togglebutton-content,
.ui-mode-select .p-togglebutton .p-togglebutton-content {
  background: transparent !important;
}

.app-page-select .p-togglebutton,
.ui-mode-select .p-togglebutton {
  background: transparent !important;
  color: rgba(255, 255, 255, 0.6) !important;
}

.app-page-select .p-togglebutton[data-p-checked="true"],
.ui-mode-select .p-togglebutton[data-p-checked="true"] {
  background: rgba(30, 188, 196, 0.18) !important;
  color: #fff !important;
}

.app-page-select .p-togglebutton[data-p-checked="true"] .p-togglebutton-label,
.ui-mode-select .p-togglebutton[data-p-checked="true"] .p-togglebutton-label {
  color: #fff !important;
}

.shell-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 9px;
  background: rgba(16, 16, 16, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}

.ui-mode-select {
  display: flex;
}

:where(.shell-action.p-button) {
  height: 30px;
  min-width: 30px;
  padding: 0 10px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.66);
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
}

:where(.shell-action.p-button:hover) {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

:where(.shell-action.p-button[aria-pressed="true"]) {
  background: #2a3550;
  color: #fff;
}

#help-popover {
  position: fixed;
  top: 54px;
  right: 16px;
  z-index: 35;
  width: 310px;
  padding: 12px;
  border-radius: 8px;
  pointer-events: auto;
  background: rgba(16, 16, 16, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.09);
  backdrop-filter: blur(10px);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.36);
}

.help-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.help-head span,
.help-section h2 {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.68);
}

:where(.help-close.p-button) {
  width: 26px;
  height: 26px;
  color: rgba(255, 255, 255, 0.54);
}

.help-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.help-section + .help-section {
  margin-top: 12px;
}

.help-row,
.help-grid {
  color: rgba(255, 255, 255, 0.74);
  font-size: 12px;
  line-height: 1.35;
}

.help-row {
  display: grid;
  grid-template-columns: 28px 1fr;
  align-items: center;
  gap: 8px;
}

.help-grid {
  display: grid;
  grid-template-columns: 62px 1fr;
  align-items: center;
  gap: 6px 9px;
}

kbd {
  display: inline-flex;
  justify-content: center;
  min-width: 24px;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.78);
  font-family: var(--font-mono);
  font-size: 10px;
}

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
#player-start-root {
  pointer-events: auto;
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

#tools-page {
  position: fixed;
  inset: 0;
  z-index: 12;
  overflow: auto;
  padding: 58px 24px 24px;
  background: #0d0d0f;
  color: #e6e6e6;
  pointer-events: auto;
}

#retarget-page {
  position: fixed;
  inset: 0;
  z-index: 12;
  overflow: auto;
  padding: 58px 24px 24px;
  background: #000;
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
    flex-direction: column;
    align-items: stretch;
  }
  .app-page-select {
    flex: 1;
    min-width: 0;
  }
  .shell-actions {
    flex-shrink: 0;
    width: 100%;
  }
  .ui-mode-select,
  .ui-mode-select .p-togglebutton {
    flex: 1;
  }
  :where(.app-page-select .p-togglebutton) {
    flex: 1;
    padding-inline: 8px;
  }
  :where(.shell-action.p-button) {
    padding-inline: 8px;
  }
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
  .tools-page-inner {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  #app-page-tabs {
    gap: 5px;
  }
  :where(.app-page-select .p-togglebutton) {
    font-size: 10px;
    padding-inline: 6px;
  }
  :where(.shell-action.p-button) {
    min-width: 28px;
    font-size: 10px;
  }
  :where(.ui-mode-select .p-togglebutton) {
    padding-inline: 7px;
    font-size: 10px;
  }
  :where(.shell-action.p-button .p-button-label) {
    display: none;
  }
}
</style>
