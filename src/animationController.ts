import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

const CROSSFADE_DURATION = 0.5; // seconds

export interface SequenceItem {
  name: string;
  action: THREE.AnimationAction;
  duration: number;
}

export type PlaybackListener = (queuePos: number, item: SequenceItem) => void;

interface CrossfadeState {
  from: THREE.AnimationAction;
  to: THREE.AnimationAction;
  elapsed: number;
  duration: number;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Queue-based animation controller.
 *
 * All registered clips live in `items[]` (the "library").
 * `queue[]` holds indices into items and defines what actually plays.
 * The queue starts empty — nothing plays until items are added.
 */
export class AnimationController {
  readonly mixer: THREE.AnimationMixer;
  private readonly items: SequenceItem[] = [];

  // Queue: ordered list of item indices to play
  private queue: number[] = [];
  private queuePos = -1;         // current position in queue (-1 = not playing)
  private prevItemIndex = -1;    // item index of the previously active clip

  private timeInCurrent = 0;
  private crossfade: CrossfadeState | null = null;
  private listener: PlaybackListener | null = null;
  private _muted = false;

  constructor(vrm: VRM) {
    this.mixer = new THREE.AnimationMixer(vrm.scene);
  }

  // ── Registration ───────────────────────────────────────────────────────────

  register(name: string, clip: THREE.AnimationClip): void {
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.setEffectiveWeight(0);
    // Don't play() here — activate lazily in activateQueuePos so the mixer
    // only ticks the 1–2 actions that are actually in use.
    this.items.push({ name, action, duration: clip.duration });
  }

  get itemCount(): number { return this.items.length; }
  getItemName(index: number): string { return this.items[index]?.name ?? ''; }

  // ── Queue management ───────────────────────────────────────────────────────

  /** Add an item (by library index) to the end of the queue. */
  addToQueue(itemIndex: number): void {
    if (itemIndex < 0 || itemIndex >= this.items.length) return;
    this.queue.push(itemIndex);
    if (this.queuePos < 0) {
      // Queue was empty — start playing immediately
      this.activateQueuePos(0);
    }
  }

  /** Remove a queue entry by its position in the queue. */
  removeFromQueue(queueIndex: number): void {
    if (queueIndex < 0 || queueIndex >= this.queue.length) return;
    const wasActive = queueIndex === this.queuePos;
    this.queue.splice(queueIndex, 1);

    if (this.queue.length === 0) {
      this.stopAll();
      this.queuePos = -1;
      return;
    }

    if (wasActive) {
      // Removed the currently playing item — advance to the same position (which is now the next)
      const nextPos = Math.min(queueIndex, this.queue.length - 1);
      this.activateQueuePos(nextPos);
    } else if (queueIndex < this.queuePos) {
      // Removed something before the current position — adjust index
      this.queuePos--;
    }
  }

  /** Reorder queue using "insert before toIndex" semantics. */
  reorderQueue(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= this.queue.length || toIndex > this.queue.length) return;

    const activeQueuePos = this.queuePos;

    const [item] = this.queue.splice(fromIndex, 1);
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
    this.queue.splice(insertAt, 0, item);

    // Track the active queue entry by position, not by itemIndex:
    // the queue can contain duplicate clips pointing at the same library item.
    if (activeQueuePos >= 0) {
      if (activeQueuePos === fromIndex) {
        this.queuePos = insertAt;
        return;
      }

      let nextActivePos = activeQueuePos;
      if (fromIndex < nextActivePos) nextActivePos--;
      if (insertAt <= nextActivePos) nextActivePos++;
      this.queuePos = nextActivePos;
    }
  }

  get queueLength(): number { return this.queue.length; }
  get currentQueuePos(): number { return this.queuePos; }

  /** Map a queue position to its underlying library item index, or -1. */
  getItemIndexAtQueuePos(queueIndex: number): number {
    if (queueIndex < 0 || queueIndex >= this.queue.length) return -1;
    return this.queue[queueIndex];
  }

  /** Jump to a position in the queue. */
  jumpTo(queueIndex: number): void {
    if (queueIndex < 0 || queueIndex >= this.queue.length) return;
    this.activateQueuePos(queueIndex);
  }

  // ── Mute (demo mode) ───────────────────────────────────────────────────────

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (muted) {
      for (const item of this.items) { item.action.setEffectiveWeight(0); item.action.stop(); }
      this.crossfade = null;
    } else if (this.queuePos >= 0) {
      const item = this.items[this.queue[this.queuePos]];
      if (item) { item.action.play(); item.action.setEffectiveWeight(1); }
    }
  }
  get muted(): boolean { return this._muted; }
  get hasBvhActive(): boolean { return this.queuePos >= 0; }

  // ── Transport (play/pause/seek/skip) ───────────────────────────────────────

  get paused(): boolean { return this.mixer.timeScale === 0; }
  setPaused(v: boolean): void { this.mixer.timeScale = v ? 0 : 1; }
  togglePaused(): void { this.setPaused(!this.paused); }

  /** Current playback time in the active clip (seconds). 0 when queue empty. */
  get currentTime(): number { return this.timeInCurrent; }
  /** Duration of the active clip (seconds). 0 when queue empty. */
  get currentDuration(): number {
    if (this.queuePos < 0) return 0;
    return this.items[this.queue[this.queuePos]]?.duration ?? 0;
  }
  /** Name of the active clip. '' when queue empty. */
  get currentName(): string {
    if (this.queuePos < 0) return '';
    return this.items[this.queue[this.queuePos]]?.name ?? '';
  }

  /** Seek the active clip to an absolute time in seconds (clamped to duration). */
  seek(seconds: number): void {
    if (this.queuePos < 0) return;
    const item = this.items[this.queue[this.queuePos]];
    if (!item) return;
    const t = Math.max(0, Math.min(seconds, Math.max(item.duration - 1e-3, 0)));
    item.action.time = t;
    this.timeInCurrent = t;
  }

  next(): void {
    if (this.queue.length === 0) return;
    this.activateQueuePos((this.queuePos + 1) % this.queue.length);
  }
  prev(): void {
    if (this.queue.length === 0) return;
    const n = this.queue.length;
    this.activateQueuePos(((this.queuePos - 1) % n + n) % n);
  }

  // ── Listener ───────────────────────────────────────────────────────────────

  onChange(listener: PlaybackListener): void {
    this.listener = listener;
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(delta: number): void {
    // Update crossfade weights before mixer tick
    if (this.crossfade) {
      const cf = this.crossfade;
      cf.elapsed += delta;
      const t = Math.min(cf.elapsed / cf.duration, 1);
      const eased = smoothstep(t);
      cf.from.setEffectiveWeight(1 - eased);
      cf.to.setEffectiveWeight(eased);
      if (t >= 1) {
        cf.from.setEffectiveWeight(0);
        cf.from.stop(); // remove from mixer — only the active action ticks
        cf.to.setEffectiveWeight(1);
        this.crossfade = null;
      }
    }

    this.mixer.update(delta);

    if (this.queuePos < 0 || this.queue.length === 0) return;
    // When paused, freeze time tracking and auto-advance — the mixer is already
    // frozen via timeScale, but timeInCurrent must not drift forward either or
    // we'd silently skip to the next clip while the user expects a hold.
    if (this.paused) return;

    // Auto-advance when current clip is about to end
    this.timeInCurrent += delta;
    const currentItem = this.items[this.queue[this.queuePos]];
    const triggerAt = Math.max(currentItem.duration - CROSSFADE_DURATION, 0);

    if (this.timeInCurrent >= triggerAt && this.queue.length > 1) {
      this.activateQueuePos((this.queuePos + 1) % this.queue.length);
    } else if (this.timeInCurrent >= currentItem.duration && this.queue.length === 1) {
      this.timeInCurrent = 0; // single item: reset timer, action loops naturally
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private activateQueuePos(pos: number): void {
    if (pos < 0 || pos >= this.queue.length) return;
    const itemIndex = this.queue[pos];
    const next = this.items[itemIndex];

    if (this.prevItemIndex >= 0 && this.prevItemIndex !== itemIndex) {
      const from = this.items[this.prevItemIndex].action;
      next.action.play();
      next.action.reset();
      this.crossfade = { from, to: next.action, elapsed: 0, duration: CROSSFADE_DURATION };
    } else {
      next.action.play();
      next.action.reset();
      next.action.setEffectiveWeight(1);
      this.crossfade = null;
    }

    this.prevItemIndex = itemIndex;
    this.queuePos = pos;
    this.timeInCurrent = 0;
    this.listener?.(pos, next);
  }

  private stopAll(): void {
    for (const item of this.items) { item.action.setEffectiveWeight(0); item.action.stop(); }
    this.crossfade = null;
    this.timeInCurrent = 0;
  }
}
