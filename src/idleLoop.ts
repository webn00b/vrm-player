import type { VRM } from '@pixiv/three-vrm';
import type { AnimData } from './priorityAnimator';
import { PriorityAnimator } from './priorityAnimator';

// Auto-discover idle JSON files (Vite resolves at build time)
const idleModules = import.meta.glob('/animations/idle/*.json', {
  import: 'default',
  eager: true,
}) as Record<string, AnimData>;

// ── Bone groups (mirrors ogi bones.ts) ────────────────────────────────────────

const LOWER_BONES = [
  'hips', 'spine',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
];

const UPPER_BONES = [
  'neck', 'head', 'chest', 'upperChest',
  'leftShoulder',  'leftUpperArm',  'leftLowerArm',  'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
];

const ALL_IDLE_BONES = [...new Set([...LOWER_BONES, ...UPPER_BONES])];

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomFrame(data: AnimData): number {
  // Frame count derived from first channel with data
  for (const ch of Object.values(data.channels)) {
    if (ch.times.length > 0) return Math.floor(Math.random() * ch.times.length);
  }
  return 0;
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── IdleLoop ─────────────────────────────────────────────────────────────────

/**
 * Drives the PriorityAnimator with idle pose data.
 *
 * Two layers, just like ogi:
 *   Level 1 – lower body (hips, legs, spine)    — fires infrequently
 *   Level 2 – upper body (torso, arms, head)    — fires more often
 *
 * Both layers pick a random frame from a random idle file each time they fire.
 * "SpeedRans" — probabilistic firing each frame — prevents lockstep repetition.
 */
export class IdleLoop {
  private clips: AnimData[] = [];
  private boneNames: string[] = [];
  enabled = false;

  // Stats for debug UI
  lastLevel1Frame = 0;
  lastLevel2Frame = 0;
  clipCount = 0;

  constructor() {
    this.clips = Object.values(idleModules).filter(
      (d) => d && typeof d === 'object' && d.channels,
    );
    this.clipCount = this.clips.length;

    // Collect bone names from all clips
    const nameSet = new Set<string>();
    for (const clip of this.clips) {
      for (const k of Object.keys(clip.channels)) nameSet.add(k);
    }
    this.boneNames = [...nameSet].filter((n) => ALL_IDLE_BONES.includes(n));
  }

  get loaded(): boolean { return this.clips.length > 0; }

  /**
   * Call once per frame. Probabilistically fires each layer.
   * speed controls how many frames the transition takes.
   */
  update(vrm: VRM, pa: PriorityAnimator, speed = 18): void {
    if (!this.enabled || this.clips.length === 0) return;

    // Lower body: fires ~30% of frames (very lazy idle)
    if (Math.random() < 0.30) {
      const clip = randomItem(this.clips);
      const frame = randomFrame(clip);
      this.lastLevel1Frame = frame;
      pa.scheduleFromData(clip, this.boneNames, frame, speed * 2, 1, LOWER_BONES);
    }

    // Upper body: fires ~20% of frames
    if (Math.random() < 0.20) {
      const clip = randomItem(this.clips);
      const frame = randomFrame(clip);
      this.lastLevel2Frame = frame;
      pa.scheduleFromData(clip, this.boneNames, frame, speed * 1.5, 2, UPPER_BONES);
    }
  }
}
