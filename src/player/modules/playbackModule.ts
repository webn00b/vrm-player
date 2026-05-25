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
import type { PlayerModule } from '../types';

const QUEUE_LOOP_KEY = 'vrm-player.queue-loop-mode';

function readQueueLoopMode(): QueueLoopMode {
  try {
    return localStorage.getItem(QUEUE_LOOP_KEY) === 'one' ? 'one' : 'queue';
  } catch {
    return 'queue';
  }
}

export function writeQueueLoopMode(mode: QueueLoopMode): void {
  try { localStorage.setItem(QUEUE_LOOP_KEY, mode); } catch { /* ignore */ }
}

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
