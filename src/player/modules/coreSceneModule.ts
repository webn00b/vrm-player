/**
 * Owns Three.js scene setup for the player bootstrap.
 * Keeps renderer/camera scene creation out of main.ts and cleans up everything it registers.
 */
import { createScene } from '../../scene';
import type { PlayerModule } from '../types';

export const coreSceneModule: PlayerModule = {
  name: 'core-scene',
  setup(ctx) {
    ctx.scene = createScene(ctx.roots.app);

    return () => {
      const scene = ctx.scene;
      ctx.scene = undefined;
      scene?.dispose();
    };
  },
};
