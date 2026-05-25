import type { QueueLoopMode } from '../animationController';

const QUEUE_LOOP_KEY = 'vrm-player.queue-loop-mode';

export function readQueueLoopMode(): QueueLoopMode {
  try {
    return localStorage.getItem(QUEUE_LOOP_KEY) === 'one' ? 'one' : 'queue';
  } catch {
    return 'queue';
  }
}

export function writeQueueLoopMode(mode: QueueLoopMode): void {
  try {
    localStorage.setItem(QUEUE_LOOP_KEY, mode);
  } catch {
    /* ignore */
  }
}
