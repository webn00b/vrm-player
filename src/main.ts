import './styles/player.css';
import { notify, setStatus } from './ui';
import { runPlayerModules } from './player/bootstrap';
import type { PlayerApp, PlayerContext } from './player/types';
import { coreSceneModule } from './player/modules/coreSceneModule';
import { shellModule } from './player/modules/shellModule';
import { vrmModule } from './player/modules/vrmModule';
import { playbackModule } from './player/modules/playbackModule';
import { toolingModule } from './player/modules/toolingModule';
import { animationImportModule } from './player/modules/animationImportModule';
import { playerUiModule } from './player/modules/playerUiModule';
import { mocapModule } from './player/modules/mocapModule';
import { debugModule } from './player/modules/debugModule';
import { inputModule } from './player/modules/inputModule';
import { renderLoopModule } from './player/modules/renderLoopModule';

type CleanupFn = () => void;
let selectedVrmUrl: string | null = null;
let selectedVrmName = '';
let activeApp: PlayerApp | null = null;
let playerGeneration = 0;
let hmrDisposeRegistered = false;

declare global {
  interface Window {
    __vrmPlayerCleanup?: CleanupFn;
  }
}

function disposeActiveApp(): void {
  playerGeneration += 1;
  const app = activeApp;
  activeApp = null;
  if (window.__vrmPlayerCleanup === disposeActiveApp) delete window.__vrmPlayerCleanup;
  app?.dispose();
}

function disposePreviousGlobalCleanup(): void {
  const cleanup = window.__vrmPlayerCleanup;
  if (cleanup && cleanup !== disposeActiveApp) cleanup();
}

function installGlobalCleanup(): void {
  window.__vrmPlayerCleanup = disposeActiveApp;
  if (!hmrDisposeRegistered) {
    import.meta.hot?.dispose(disposeActiveApp);
    hmrDisposeRegistered = true;
  }
}

function requestVrmFile(file: File): void {
  if (selectedVrmUrl?.startsWith('blob:')) URL.revokeObjectURL(selectedVrmUrl);
  selectedVrmUrl = URL.createObjectURL(file);
  selectedVrmName = file.name;
  void startPlayer().catch((err) => {
    console.error(err);
    setStatus(`error: ${(err as Error).message}`);
    notify({ severity: 'error', summary: 'VRM load failed', detail: (err as Error).message, life: 6000 });
  });
}

async function startPlayer(): Promise<void> {
  disposePreviousGlobalCleanup();
  disposeActiveApp();
  const startGeneration = ++playerGeneration;
  installGlobalCleanup();

  const container = document.getElementById('app');
  if (!container) throw new Error('#app not found');
  const shellHost = document.getElementById('ui-shell');
  if (!shellHost) throw new Error('#ui-shell not found');

  const playerCtx: PlayerContext = {
    roots: { app: container, shell: shellHost },
    options: {
      selectedVrmUrl,
      selectedVrmName,
      onVrmFileSelected: requestVrmFile,
    },
  };
  let app: PlayerApp;
  try {
    app = await runPlayerModules(playerCtx, [
      coreSceneModule,
      shellModule,
      vrmModule,
      playbackModule,
      toolingModule,
      animationImportModule,
      playerUiModule,
      mocapModule,
      debugModule,
      inputModule,
      renderLoopModule,
    ]);
  } catch (err) {
    if (startGeneration !== playerGeneration) return;
    throw err;
  }

  if (startGeneration !== playerGeneration) {
    try {
      app.dispose();
    } catch (err) {
      console.error('Failed to dispose stale player app', err);
    }
    return;
  }

  activeApp = app;
}

startPlayer().catch((err) => {
  console.error(err);
  setStatus(`error: ${(err as Error).message}`);
  notify({ severity: 'error', summary: 'Startup error', detail: (err as Error).message, life: 6000 });
});
