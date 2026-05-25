/**
 * Owns render-loop startup for the player bootstrap.
 * Keeps per-frame system ordering centralized in renderLoop.ts and out of main.ts.
 */
import { startRenderLoop } from '../../renderLoop';
import { requireMocap, requirePlayback, requireScene, requireTooling, requireVrm } from '../assertions';
import type { PlayerModule } from '../types';

export const renderLoopModule: PlayerModule = {
  name: 'render-loop',
  setup(ctx) {
    return startRenderLoop(
      requireScene(ctx),
      requireVrm(ctx),
      requirePlayback(ctx),
      requireMocap(ctx),
      requireTooling(ctx),
    );
  },
};
