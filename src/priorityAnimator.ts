import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AnimChannel {
  times: number[];
  values: number[];
}

export interface AnimData {
  duration?: number;
  channels: Record<string, AnimChannel>;
}

interface BoneSlot {
  quatPerFrame: number[];  // per-frame increment toward target
  dur: number;             // frames remaining
  coeff: number;           // original duration (for easing)
  level: number;           // priority level (higher = dominates)
}

// ─── Easing ──────────────────────────────────────────────────────────────────

/** Smooth bell curve — slow start, fast middle, slow end. */
function sineEase(increment: number[], step: number, total: number): number[] {
  const ease = Math.sin(Math.PI * step / total) * 1.57;
  return increment.map(v => v * ease);
}

/**
 * Anticipation + overshoot — small reverse at start, overshoots target,
 * settles back. Used for gesture-level animations (level ≥ 5).
 */
function overshootEase(increment: number[], step: number, total: number): number[] {
  const t = step / total; // 1 → 0 as animation plays out
  let ease: number;
  if (t > 0.88) {
    ease = -Math.sin(((t - 0.88) / 0.12) * Math.PI) * 0.12;
  } else if (t > 0.15) {
    ease = Math.sin((1 - (t - 0.15) / 0.73) * Math.PI * 0.5) * 1.7;
  } else {
    const st = t / 0.15;
    ease =
      Math.sin(st * Math.PI * 0.5 + Math.PI * 0.5) * 1.7 * 0.08 +
      Math.sin((1 - st) * Math.PI * 0.5) * 1.57;
  }
  return increment.map(v => v * ease);
}

// ─── PriorityAnimator ────────────────────────────────────────────────────────

/**
 * Priority-based bone blending engine.
 *
 * Each bone can be "owned" by one priority level at a time.
 * Scheduling a bone at a higher level overrides any current owner.
 * Lower-priority schedules are silently ignored.
 *
 * Bones are addressed by VRM humanoid names ("hips", "leftUpperArm", …).
 * The animator targets NORMALIZED bones so it composes cleanly with
 * three-vrm-animation clips running in the AnimationMixer.
 */
export class PriorityAnimator {
  private slots = new Map<string, BoneSlot>();
  private nodeCache = new Map<string, THREE.Object3D>();
  private vrm: VRM;

  // Public stats for debug UI
  activeBoneCount = 0;
  readonly levelSnapshot = new Map<string, number>();

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.rebuildCache();
  }

  private rebuildCache(): void {
    this.nodeCache.clear();
    // three-vrm v3: normalized bones live in getNormalizedBoneNode
    const humanoid = this.vrm.humanoid;
    const names = Object.keys(humanoid.humanBones) as string[];
    for (const name of names) {
      const node = humanoid.getNormalizedBoneNode(name as any);
      if (node) this.nodeCache.set(name, node);
    }
  }

  private node(name: string): THREE.Object3D | null {
    return this.nodeCache.get(name) ?? null;
  }

  // ── Scheduling ─────────────────────────────────────────────────────────────

  /**
   * Schedule bone to animate toward targetQuat at the given priority level.
   * speed is the number of frames for the transition (before jitter).
   */
  scheduleBone(
    bone: string,
    targetQuat: number[],
    speed: number,
    level: number,
  ): void {
    const existing = this.slots.get(bone);
    if (existing && existing.level > level && existing.dur > 0) return;

    const node = this.node(bone);
    if (!node) return;

    const current = node.quaternion.toArray() as number[];
    const diff = targetQuat.map((v, i) => v - current[i]);
    const totalDiff = diff.reduce((s, v) => s + Math.abs(v), 0);
    if (totalDiff < 0.0005) return;

    const dur = Math.max(4, Math.round(speed * (0.75 + Math.random() * 0.5)));
    this.slots.set(bone, {
      quatPerFrame: diff.map(v => v / dur),
      dur,
      coeff: dur,
      level,
    });
    this.levelSnapshot.set(bone, level);
  }

  /**
   * Schedule a set of bones from a JSON animation frame.
   * Only bones listed in activeBones are affected.
   */
  scheduleFromData(
    data: AnimData,
    allBones: string[],
    frame: number,
    speed: number,
    level: number,
    activeBones: string[],
  ): void {
    // Determine frame count from first available channel
    let frameCount = 0;
    for (const b of allBones) {
      const ch = data.channels[b];
      if (ch) { frameCount = ch.times.length; break; }
    }
    if (!frameCount) return;

    const f = ((frame % frameCount) + frameCount) % frameCount;

    for (const bone of allBones) {
      if (!activeBones.includes(bone)) continue;
      if (bone === 'Bone Position') continue; // root pos handled separately
      const ch = data.channels[bone];
      if (!ch) continue;

      const target = ch.values.slice(f * 4, f * 4 + 4);
      if (target.length !== 4) continue;

      this.scheduleBone(bone, target, speed, level);
    }
  }

  // ── Per-frame apply ────────────────────────────────────────────────────────

  /** Apply one frame of all active bone animations. Call after mixer.update(). */
  applyAll(): void {
    let active = 0;

    for (const [bone, slot] of this.slots) {
      if (slot.dur <= 0) {
        slot.level = 0;
        this.levelSnapshot.set(bone, 0);
        continue;
      }

      const node = this.node(bone);
      if (!node) { slot.dur--; continue; }

      const current = node.quaternion.toArray() as number[];
      const easeFn = slot.level >= 5 ? overshootEase : sineEase;
      const eased = easeFn(slot.quatPerFrame, slot.dur, slot.coeff);
      node.quaternion.fromArray(current.map((v, i) => v + eased[i]));

      slot.dur--;
      active++;
    }

    this.activeBoneCount = active;
  }

  /** Remove all active animations (e.g. when switching to BVH mode). */
  reset(): void {
    this.slots.clear();
    this.levelSnapshot.clear();
    this.activeBoneCount = 0;
  }
}
