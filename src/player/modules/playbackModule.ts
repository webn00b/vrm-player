/**
 * Owns playback system setup for the player bootstrap.
 * Keeps animation controller construction out of main.ts and cleans up everything it registers.
 */
import { AnimationController, type QueueLoopMode } from '../../animationController';
import { IdleLoop } from '../../idleLoop';
import { MicroAnimations } from '../../microAnimations';
import { PriorityAnimator } from '../../priorityAnimator';
import type { PlaybackSystems } from '../../playerSystems';
import { requireVrm } from '../assertions';
import { readQueueLoopMode } from '../queueLoopMode';
import type { PlayerModule } from '../types';

export const playbackModule: PlayerModule = {
  name: 'playback',
  setup(ctx) {
    const vrm = requireVrm(ctx);
    const controller = new AnimationController(vrm);
    const mode = readQueueLoopMode();
    controller.setLoopMode(mode);

    const playback: PlaybackSystems = {
      controller,
      pa: new PriorityAnimator(vrm),
      micro: new MicroAnimations(),
      idle: new IdleLoop(),
    };

    ctx.queueLoopMode = mode;
    ctx.playback = playback;
  },
};
