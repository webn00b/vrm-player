import { onMounted, onUnmounted, reactive, shallowRef } from 'vue';
import type { AppToastPayload } from '../../ui';
import type { AppPage, UiMode } from './playerShellTypes';
import { isAppPage, isUiMode } from './playerShellTypes';

const PANEL_KEY = 'vrm-player.panel-collapsed';
const PAGE_KEY = 'vrm-player.active-page';
const MODE_KEY = 'vrm-player.ui-mode';
const ZEN_KEY = 'vrm-player.zen-mode';
const VIEWPORT_COMPACT_KEY = 'vrm-player.viewport-compact';
const VIEWPORT_LOG_PREFIX = '[viewport-compact]';

interface UsePlayerShellStateOptions {
  showToast: (payload: AppToastPayload) => void;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function readStoredPage(): AppPage {
  const stored = readStorage(PAGE_KEY);
  return isAppPage(stored) && stored !== 'player' ? stored : 'player';
}

function readStoredMode(): UiMode {
  const stored = readStorage(MODE_KEY);
  if (stored === 'debug') return 'inspect';
  return isUiMode(stored) ? stored : 'play';
}

function readViewportCompact(): boolean {
  try {
    const stored = localStorage.getItem(VIEWPORT_COMPACT_KEY);
    console.info(VIEWPORT_LOG_PREFIX, 'shell init', { stored, compact: stored === '1' });
    return stored === '1';
  } catch (err) {
    console.warn(VIEWPORT_LOG_PREFIX, 'shell init failed to read localStorage', err);
    return false;
  }
}

export function usePlayerShellState({ showToast }: UsePlayerShellStateOptions) {
  const collapsed = reactive<Record<string, boolean>>({});
  const activePage = shallowRef<AppPage>(readStoredPage());
  const uiMode = shallowRef<UiMode>(readStoredMode());
  const zenMode = shallowRef(readStorage(ZEN_KEY) === '1');
  const viewportCompact = shallowRef(readViewportCompact());
  const helpOpen = shallowRef(false);

  try {
    const raw = localStorage.getItem(PANEL_KEY);
    if (raw) Object.assign(collapsed, JSON.parse(raw));
  } catch {
    /* ignore */
  }

  function saveCollapsed(): void {
    writeStorage(PANEL_KEY, JSON.stringify(collapsed));
  }

  function isCollapsed(id: string): boolean {
    return !!collapsed[id];
  }

  function togglePanel(id: string): void {
    collapsed[id] = !collapsed[id];
    saveCollapsed();
  }

  function setPage(next: AppPage | null, emitChange = true): void {
    if (!next) return;
    activePage.value = next;
    writeStorage(PAGE_KEY, next);
    if (emitChange) {
      window.dispatchEvent(new CustomEvent<AppPage>('vrm-player:page-changed', { detail: next }));
    }
  }

  function setMode(next: UiMode | null): void {
    if (!next) return;
    uiMode.value = next;
    writeStorage(MODE_KEY, next);
  }

  function toggleZen(): void {
    zenMode.value = !zenMode.value;
    writeStorage(ZEN_KEY, zenMode.value ? '1' : '0');
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
      stored: readStorage(VIEWPORT_COMPACT_KEY),
    });
    syncViewportCompact();
  }

  function toggleHelp(): void {
    helpOpen.value = !helpOpen.value;
  }

  function setHelpOpen(next: boolean): void {
    helpOpen.value = next;
  }

  function onToast(event: Event): void {
    const payload = (event as CustomEvent<AppToastPayload>).detail;
    if (!payload?.summary) return;
    showToast(payload);
  }

  function onSetPage(event: Event): void {
    const page = (event as CustomEvent<AppPage>).detail;
    if (isAppPage(page)) setPage(page, false);
  }

  function onHelpKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && helpOpen.value) helpOpen.value = false;
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

  return {
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
  };
}
