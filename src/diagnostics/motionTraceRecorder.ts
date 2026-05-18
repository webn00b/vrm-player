/**
 * MotionTraceRecorder — captures the final on-screen VRM humanoid pose to JSON.
 *
 * The output is intentionally aligned with tools/animation_validator.py:
 * frames[].bones[bone].localQuat/worldPos can be validated offline without
 * depending on three.js or VRM runtime state.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';

type V3 = [number, number, number];
type V4 = [number, number, number, number];

export interface MotionTraceBoneSample {
  localQuat: V4;
  worldQuat: V4;
  worldPos: V3;
}

export interface MotionTraceFrame {
  index: number;
  time: number;
  bones: Partial<Record<string, MotionTraceBoneSample>>;
}

export interface MotionTracePayload {
  schemaVersion: 1;
  name: string;
  source: 'vrm-player';
  captureStage: 'after-vrm-update';
  fps: number;
  duration: number;
  frameCount: number;
  bones: string[];
  frames: MotionTraceFrame[];
  meta: {
    startedAt: string;
    note: string;
  };
}

const TRACE_BONES: VRMHumanBoneName[] = [
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftShoulder,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightShoulder,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.RightHand,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.LeftToes,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.RightFoot,
  VRMHumanBoneName.RightToes,
];

function round(n: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function v3(v: THREE.Vector3): V3 {
  return [round(v.x, 5), round(v.y, 5), round(v.z, 5)];
}

function q4(q: THREE.Quaternion): V4 {
  return [round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)];
}

function safeFilenamePart(s: string): string {
  return s.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'motion_trace';
}

export class MotionTraceRecorder {
  private vrm: VRM;
  private frames: MotionTraceFrame[] = [];
  private nodeCache = new Map<VRMHumanBoneName, THREE.Object3D | null>();
  private activeFlag = false;
  private t0 = 0;
  private startedAt = '';
  private label = 'motion';
  private maxFrames = 1800;
  private lastTrace: MotionTracePayload | null = null;
  private tmpPos = new THREE.Vector3();
  private tmpWorldQ = new THREE.Quaternion();

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  get active(): boolean { return this.activeFlag; }
  get frameCount(): number { return this.frames.length; }
  get elapsed(): number {
    if (!this.activeFlag) return this.lastTrace?.duration ?? 0;
    return performance.now() / 1000 - this.t0;
  }

  start(label = 'motion', maxFrames = 1800): void {
    this.frames = [];
    this.label = label || 'motion';
    this.maxFrames = maxFrames;
    this.lastTrace = null;
    this.t0 = performance.now() / 1000;
    this.startedAt = new Date().toISOString();
    this.activeFlag = true;
  }

  stop(): MotionTracePayload {
    this.activeFlag = false;
    const trace = this.buildTrace();
    this.lastTrace = trace;
    return trace;
  }

  capture(): void {
    if (!this.activeFlag) return;
    const index = this.frames.length;
    const time = performance.now() / 1000 - this.t0;
    const bones: MotionTraceFrame['bones'] = {};

    for (const name of TRACE_BONES) {
      const node = this.getNode(name);
      if (!node) continue;
      node.getWorldPosition(this.tmpPos);
      node.getWorldQuaternion(this.tmpWorldQ);
      bones[name] = {
        localQuat: q4(node.quaternion),
        worldQuat: q4(this.tmpWorldQ),
        worldPos: v3(this.tmpPos),
      };
    }

    this.frames.push({
      index,
      time: round(time, 6),
      bones,
    });

    if (this.frames.length >= this.maxFrames) {
      this.stop();
    }
  }

  getTrace(): MotionTracePayload | null {
    return this.lastTrace ?? (this.frames.length > 0 ? this.buildTrace() : null);
  }

  download(filename?: string): void {
    const trace = this.lastTrace ?? this.stop();
    const base = filename ?? `${safeFilenamePart(trace.name)}.motion_trace.json`;
    const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = base.endsWith('.json') ? base : `${base}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private getNode(name: VRMHumanBoneName): THREE.Object3D | null {
    if (this.nodeCache.has(name)) return this.nodeCache.get(name) ?? null;
    const node = this.vrm.humanoid.getNormalizedBoneNode(name);
    this.nodeCache.set(name, node);
    return node;
  }

  private buildTrace(): MotionTracePayload {
    const duration = this.frames.length > 0
      ? this.frames[this.frames.length - 1].time
      : 0;
    const fps = duration > 0 && this.frames.length > 1
      ? (this.frames.length - 1) / duration
      : 0;
    const bones = Array.from(new Set(
      this.frames.flatMap(frame => Object.keys(frame.bones)),
    )).sort();
    return {
      schemaVersion: 1,
      name: this.label,
      source: 'vrm-player',
      captureStage: 'after-vrm-update',
      fps: round(fps, 3),
      duration: round(duration, 6),
      frameCount: this.frames.length,
      bones,
      frames: this.frames,
      meta: {
        startedAt: this.startedAt,
        note: 'Captured after vrm.update(delta), before hip-force/skeleton overlay/render.',
      },
    };
  }
}

