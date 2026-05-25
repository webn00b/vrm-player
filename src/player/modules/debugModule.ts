/**
 * Owns debug panel mounting for the player bootstrap.
 * Keeps diagnostics UI wiring separate from player startup and render-loop code.
 */
import { mountDebugPanel } from '../../debugPanel';
import { requireAnimation, requireMocap, requirePlayback, requireTooling, requireVrm } from '../assertions';
import type { PlayerModule } from '../types';

export const debugModule: PlayerModule = {
  name: 'debug',
  setup(ctx) {
    const vrm = requireVrm(ctx);
    const playback = requirePlayback(ctx);
    const mocap = requireMocap(ctx);
    const tooling = requireTooling(ctx);
    const animation = requireAnimation(ctx);

    return mountDebugPanel(
      playback,
      mocap,
      tooling,
      (visible) => { vrm.scene.visible = visible; },
      animation.handleAnimationFile,
    );
  },
};
