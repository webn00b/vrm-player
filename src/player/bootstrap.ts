import { createCleanupRegistry } from './cleanup';
import type { PlayerApp, PlayerContext, PlayerModule } from './types';

export async function runPlayerModules(
  ctx: PlayerContext,
  modules: readonly PlayerModule[],
): Promise<PlayerApp> {
  const cleanup = createCleanupRegistry();

  try {
    for (const module of modules) {
      const moduleCleanup = await module.setup(ctx);
      if (moduleCleanup) cleanup.add(moduleCleanup);
    }
  } catch (error) {
    try {
      cleanup.dispose();
    } catch (cleanupError) {
      console.error('Player cleanup failed after module setup failure', cleanupError);
    }
    throw error;
  }

  return {
    ctx,
    dispose: () => cleanup.dispose(),
  };
}
