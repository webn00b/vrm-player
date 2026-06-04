<script setup lang="ts">
/**
 * Vue-owned overlay shell for the player page.
 *
 * The app still mounts feature islands into stable DOM anchors because the
 * Three.js/mocap bootstrap is not fully componentized yet. This component owns
 * those anchors, page composition, and hidden mocap media nodes.
 */

import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import LanguageHostsPage from './LanguageHostsPage.vue';
import PlayerHelpPopover from './playerShell/PlayerHelpPopover.vue';
import PlayerOverlayAnchors from './playerShell/PlayerOverlayAnchors.vue';
import PlayerShellTopBar from './playerShell/PlayerShellTopBar.vue';
import ToolsPage from './playerShell/ToolsPage.vue';
import { usePlayerShellState } from './playerShell/usePlayerShellState';
import type { AppToastPayload } from '../ui';

const toast = useToast();

const {
  activePage,
  uiMode,
  zenMode,
  viewportCompact,
  helpOpen,
  isCollapsed,
  setPage,
  setMode,
  toggleZen,
  toggleViewportCompact,
  toggleHelp,
  setHelpOpen,
  togglePanel,
} = usePlayerShellState({
  showToast(payload: AppToastPayload): void {
    toast.add({
      severity: payload.severity ?? 'info',
      summary: payload.summary,
      detail: payload.detail,
      life: payload.life ?? 2600,
    });
  },
});
</script>

<template>
  <PlayerShellTopBar
    :active-page="activePage"
    :ui-mode="uiMode"
    :zen-mode="zenMode"
    :viewport-compact="viewportCompact"
    :help-open="helpOpen"
    @set-page="setPage"
    @set-mode="setMode"
    @toggle-zen="toggleZen"
    @toggle-viewport-compact="toggleViewportCompact"
    @toggle-help="toggleHelp"
  />

  <PlayerHelpPopover
    v-show="activePage === 'player' && helpOpen"
    @close="setHelpOpen(false)"
  />

  <PlayerOverlayAnchors
    v-show="activePage === 'player'"
    :ui-mode="uiMode"
    :zen-mode="zenMode"
    :is-collapsed="isCollapsed"
    @toggle-panel="togglePanel"
  />

  <ToolsPage v-show="activePage === 'tools'" />

  <div id="retarget-page" v-show="activePage === 'retarget'">
    <div id="retarget-lab-root"></div>
  </div>

  <div id="hosts-page-root" v-show="activePage === 'hosts'">
    <LanguageHostsPage v-if="activePage === 'hosts'" />
  </div>

  <video id="mocap-video" playsinline></video>
  <Toast position="bottom-right" />
</template>

<style scoped>
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
</style>
