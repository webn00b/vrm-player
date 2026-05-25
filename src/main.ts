import './styles/player.css';
import { notify, setStatus } from './ui';
import type { ToolingSystems } from './playerSystems';
import { runPlayerModules } from './player/bootstrap';
import type { PlayerContext } from './player/types';
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

declare global {
  interface Window {
    __vrmPlayerCleanup?: CleanupFn;
    __skelLog?: ToolingSystems['skeletonLogger'];
    __motionTrace?: ToolingSystems['motionTraceRecorder'];
  }
}

function installGlobalCleanup(cleanup: CleanupFn): void {
  let disposed = false;
  const wrapped = (): void => {
    if (disposed) return;
    disposed = true;
    cleanup();
    if (window.__vrmPlayerCleanup === wrapped) delete window.__vrmPlayerCleanup;
  };
  window.__vrmPlayerCleanup = wrapped;
  import.meta.hot?.dispose(() => wrapped());
}

async function main() {
  const previousCleanup = window.__vrmPlayerCleanup as CleanupFn | undefined;
  previousCleanup?.();
  const container = document.getElementById('app');
  if (!container) throw new Error('#app not found');
  const shellHost = document.getElementById('ui-shell');
  if (!shellHost) throw new Error('#ui-shell not found');

  const playerCtx: PlayerContext = {
    roots: { app: container, shell: shellHost },
    options: {
      selectedVrmUrl,
      selectedVrmName,
      onVrmFileSelected: (file) => {
        if (selectedVrmUrl?.startsWith('blob:')) URL.revokeObjectURL(selectedVrmUrl);
        selectedVrmUrl = URL.createObjectURL(file);
        selectedVrmName = file.name;
        void main().catch((err) => {
          console.error(err);
          setStatus(`error: ${(err as Error).message}`);
          notify({ severity: 'error', summary: 'VRM load failed', detail: (err as Error).message, life: 6000 });
        });
      },
    },
  };
  const app = await runPlayerModules(playerCtx, [
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

  const cleanupFns: CleanupFn[] = [];
  const registerCleanup = (...fns: Array<CleanupFn | undefined>): void => {
    for (const fn of fns) if (fn) cleanupFns.push(fn);
  };
  const cleanup = (): void => {
    for (let i = cleanupFns.length - 1; i >= 0; i--) cleanupFns[i]();
    cleanupFns.length = 0;
  };
  registerCleanup(
    () => app.dispose(),
  );
  installGlobalCleanup(cleanup);
}

main().catch((err) => {
  console.error(err);
  setStatus(`error: ${(err as Error).message}`);
  notify({ severity: 'error', summary: 'Startup error', detail: (err as Error).message, life: 6000 });
});
