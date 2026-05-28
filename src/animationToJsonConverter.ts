/**
 * Universal animation-file → JSON converter.
 *
 * Auto-detects format by file extension and routes to the appropriate
 * three.js loader. Produces a portable JSON dump of animation tracks
 * preserving the source file's own bone names (no VRM retargeting).
 *
 * Supported inputs:
 *   .fbx        → three's FBXLoader
 *   .bvh        → three's BVHLoader (returns { skeleton, clip })
 *   .glb / .gltf → three's GLTFLoader
 *   .vrma       → three's GLTFLoader (VRMA is glTF with VRM extras)
 *
 * Output schema is shared across formats — per-track JSON with seconds-
 * based time stamps. The `sourceFormat` field records the input format
 * so downstream tools can still distinguish a Mixamo FBX from a Biovision
 * BVH if needed.
 */

import * as THREE from 'three';
import { FBXLoader }  from 'three/examples/jsm/loaders/FBXLoader.js';
import { BVHLoader }  from 'three/examples/jsm/loaders/BVHLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

// ── Output schema ────────────────────────────────────────────────────────────

export type SourceFormat = 'fbx' | 'bvh' | 'glb' | 'gltf' | 'vrma';

export interface AnimJsonTrack {
  /** Bone / object name from the source file. */
  bone: string;
  /** Which transform property the track drives. */
  property: 'position' | 'quaternion' | 'scale' | 'morphTargetInfluences' | string;
  /** Keyframe time stamps in seconds, parallel to `values`. */
  times: number[];
  /**
   * Per-keyframe values:
   *   position / scale         → [x, y, z]
   *   quaternion               → [x, y, z, w]
   *   morphTargetInfluences    → [v]
   * All values rounded to 6 decimal places.
   */
  values: number[][];
}

export interface AnimJson {
  name: string;
  /** Duration in seconds. */
  duration: number;
  /** Best-guess fps from the modal time-step. Null if undetectable. */
  fps: number | null;
  tracks: AnimJsonTrack[];
}

export interface AnimJsonOutput {
  source: string;
  sourceFormat: SourceFormat;
  exportedAt: string;
  animations: AnimJson[];
  /** Union of bone names across all animations, sorted. */
  bones: string[];
}

export interface AgentOgiChannel {
  times: number[];
  values: number[];
}

export interface AgentOgiAnimationJson {
  duration?: number;
  channels: Record<string, AgentOgiChannel>;
}

export interface AgentOgiJsonOptions {
  normalizeQuaternions?: boolean;
  runtimeArmSpace?: [number, number, number];
}

// Backward-compat aliases — the old `fbxToJsonConverter` exported these names.
export type FbxJsonTrack     = AnimJsonTrack;
export type FbxJsonAnimation = AnimJson;
export type FbxJsonOutput    = AnimJsonOutput;

// ── Shape conversion (shared across all formats) ─────────────────────────────

const FLOAT_DECIMALS = 6;
const round = (n: number): number =>
  Math.round(n * 10 ** FLOAT_DECIMALS) / 10 ** FLOAT_DECIMALS;

function packValues(flat: ArrayLike<number>, stride: number): number[][] {
  const n = flat.length / stride;
  const out: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(stride);
    for (let j = 0; j < stride; j++) row[j] = round(flat[i * stride + j]);
    out[i] = row;
  }
  return out;
}

function strideForProperty(property: string): number {
  if (property === 'quaternion') return 4;
  if (property === 'position' || property === 'scale') return 3;
  return 1;
}

function splitTrackName(trackName: string): { bone: string; property: string } {
  const dot = trackName.lastIndexOf('.');
  if (dot < 0) return { bone: trackName, property: 'unknown' };
  return { bone: trackName.slice(0, dot), property: trackName.slice(dot + 1) };
}

function cleanNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function normalizeQuaternionFrame(x: number, y: number, z: number, w: number): [number, number, number, number] {
  const len = Math.hypot(x, y, z, w);
  if (len <= 1e-8) return [0, 0, 0, 1];
  return [
    cleanNumber(round(x / len)),
    cleanNumber(round(y / len)),
    cleanNumber(round(z / len)),
    cleanNumber(round(w / len)),
  ];
}

function precompensateAgentArmFrame(
  bone: string,
  frame: [number, number, number, number],
  armSpace: [number, number, number],
): [number, number, number, number] {
  const sign = bone.includes('right') ? -1 : 1;
  return [
    cleanNumber(round((frame[0] / armSpace[0]) * sign)),
    cleanNumber(round((frame[1] / armSpace[1]) * sign)),
    cleanNumber(round((frame[2] / armSpace[2]) * sign)),
    cleanNumber(round(frame[3] * sign)),
  ];
}

function buildVrmTrackTargetMap(vrm: VRM): Map<string, string> {
  const map = new Map<string, string>();
  const names = Object.keys(vrm.humanoid.humanBones);
  for (const bone of names) {
    map.set(bone, bone);
    const normalized = vrm.humanoid.getNormalizedBoneNode(bone as VRMHumanBoneName);
    if (normalized) {
      map.set(normalized.name, bone);
      map.set(normalized.uuid, bone);
    }
    const raw = vrm.humanoid.getRawBoneNode(bone as VRMHumanBoneName);
    if (raw) {
      map.set(raw.name, bone);
      map.set(raw.uuid, bone);
    }
  }
  return map;
}

function pushAgentBonePosition(
  channels: Record<string, AgentOgiChannel>,
  track: THREE.KeyframeTrack,
): void {
  const values = Array.from(track.values, round).map(cleanNumber);
  channels['Bone Position'] = {
    times: Array.from(track.times, round).map(cleanNumber),
    values,
  };
}

function ensureAgentBonePosition(channels: Record<string, AgentOgiChannel>): void {
  if (channels['Bone Position']) return;
  const first = Object.values(channels).find((channel) => channel.times.length > 0);
  if (!first) {
    channels['Bone Position'] = { times: [0], values: [0, 0, 0] };
    return;
  }
  channels['Bone Position'] = {
    times: [...first.times],
    values: new Array(first.times.length * 3).fill(0),
  };
}

function guessFps(tracks: AnimJsonTrack[]): number | null {
  const longest = tracks.reduce<AnimJsonTrack | null>(
    (best, t) => (t.times.length > (best?.times.length ?? 0) ? t : best),
    null,
  );
  if (!longest || longest.times.length < 2) return null;
  const steps: number[] = [];
  for (let i = 1; i < longest.times.length; i++) {
    steps.push(longest.times[i] - longest.times[i - 1]);
  }
  steps.sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)];
  if (median <= 0) return null;
  return Math.round(1 / median);
}

/** Convert a single three.js AnimationClip to the JSON-friendly shape.
 *  Pure transform — doesn't care which format the clip came from. */
export function clipToJson(clip: THREE.AnimationClip): AnimJson {
  const tracks: AnimJsonTrack[] = clip.tracks.map((track) => {
    const { bone, property } = splitTrackName(track.name);
    return {
      bone,
      property,
      times: Array.from(track.times, round),
      values: packValues(track.values, strideForProperty(property)),
    };
  });
  return {
    name: clip.name,
    duration: round(clip.duration),
    fps: guessFps(tracks),
    tracks,
  };
}

/**
 * Convert an already-retargeted player clip into the legacy channel JSON shape
 * consumed by agent_ogi_front's bani/vani animation runtime.
 */
export function clipToAgentOgiJson(
  clip: THREE.AnimationClip,
  vrm: VRM,
  options: AgentOgiJsonOptions = {},
): AgentOgiAnimationJson {
  const targetMap = buildVrmTrackTargetMap(vrm);
  const channels: Record<string, AgentOgiChannel> = {};
  const normalizeQuaternions = options.normalizeQuaternions ?? true;
  const armSpace = options.runtimeArmSpace ?? [1, 1, 1];

  for (const track of clip.tracks) {
    const { bone: trackTarget, property } = splitTrackName(track.name);
    const bone = targetMap.get(trackTarget) ?? trackTarget;

    if (property === 'position' && bone === 'hips') {
      pushAgentBonePosition(channels, track);
      continue;
    }
    if (property !== 'quaternion') continue;

    const values: number[] = [];
    for (let i = 0; i < track.values.length; i += 4) {
      const frame = normalizeQuaternions
        ? normalizeQuaternionFrame(
          track.values[i],
          track.values[i + 1],
          track.values[i + 2],
          track.values[i + 3],
        )
        : [
          cleanNumber(round(track.values[i])),
          cleanNumber(round(track.values[i + 1])),
          cleanNumber(round(track.values[i + 2])),
          cleanNumber(round(track.values[i + 3])),
        ] as [number, number, number, number];
      const agentFrame = bone.includes('Arm')
        ? precompensateAgentArmFrame(bone, frame, armSpace)
        : frame;
      values.push(...agentFrame);
    }

    channels[bone] = {
      times: Array.from(track.times, round).map(cleanNumber),
      values,
    };
  }

  ensureAgentBonePosition(channels);

  return {
    duration: round(clip.duration),
    channels,
  };
}

export function animationJsonToAgentOgiJson(
  output: AnimJsonOutput,
  animationIndex = 0,
  options: AgentOgiJsonOptions = {},
): AgentOgiAnimationJson {
  const animation = output.animations[animationIndex];
  if (!animation) throw new Error(`Animation index ${animationIndex} not found`);

  const normalizeQuaternions = options.normalizeQuaternions ?? true;
  const armSpace = options.runtimeArmSpace ?? [1, 1, 1];
  const channels: Record<string, AgentOgiChannel> = {};

  for (const track of animation.tracks) {
    if (track.property === 'position' && (track.bone === 'hips' || track.bone === 'Bone Position' || track.bone === 'root')) {
      channels['Bone Position'] = {
        times: track.times.map(cleanNumber),
        values: track.values.flat().map((value) => cleanNumber(round(value))),
      };
      continue;
    }
    if (track.property !== 'quaternion') continue;

    const values: number[] = [];
    for (const row of track.values) {
      if (row.length !== 4) continue;
      const frame = normalizeQuaternions
        ? normalizeQuaternionFrame(row[0], row[1], row[2], row[3])
        : row.map((value) => cleanNumber(round(value))) as [number, number, number, number];
      const agentFrame = track.bone.includes('Arm')
        ? precompensateAgentArmFrame(track.bone, frame, armSpace)
        : frame;
      values.push(...agentFrame);
    }
    channels[track.bone] = {
      times: track.times.map(cleanNumber),
      values,
    };
  }

  ensureAgentBonePosition(channels);

  return {
    duration: animation.duration,
    channels,
  };
}

/** Alias for backward compatibility with the old `clipToFbxJson` name. */
export const clipToFbxJson = clipToJson;

// ── Format-specific loaders → AnimationClip[] ────────────────────────────────

function parseFbxAnimations(buffer: ArrayBuffer): THREE.AnimationClip[] {
  const root = new FBXLoader().parse(buffer, '');
  return root.animations ?? [];
}

function parseBvhAnimation(text: string): THREE.AnimationClip[] {
  const result = new BVHLoader().parse(text);
  return result.clip ? [result.clip] : [];
}

async function parseGltfAnimations(buffer: ArrayBuffer): Promise<THREE.AnimationClip[]> {
  const gltf = await new Promise<{ animations: THREE.AnimationClip[] }>((resolve, reject) => {
    new GLTFLoader().parse(
      buffer, '',
      resolve,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
  return gltf.animations ?? [];
}

// ── Top-level conversion ─────────────────────────────────────────────────────

export function detectFormat(filename: string): SourceFormat | null {
  const ext = filename.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (!ext) return null;
  if (ext === 'fbx')  return 'fbx';
  if (ext === 'bvh')  return 'bvh';
  if (ext === 'glb')  return 'glb';
  if (ext === 'gltf') return 'gltf';
  if (ext === 'vrma') return 'vrma';
  return null;
}

/** Supported input formats — single-source-of-truth for UI accept attributes. */
export const SUPPORTED_INPUT_EXTENSIONS = ['.fbx', '.bvh', '.glb', '.gltf', '.vrma'] as const;

/**
 * Format-agnostic file → JSON conversion. Detects format by extension,
 * loads the file via three's appropriate loader, dumps animations as
 * portable JSON.
 *
 * @throws if the extension isn't supported or no animations are present.
 */
export async function animationFileToJson(file: File): Promise<AnimJsonOutput> {
  const format = detectFormat(file.name);
  if (!format) {
    throw new Error(
      `Unsupported file extension: ${file.name}. ` +
      `Supported: ${SUPPORTED_INPUT_EXTENSIONS.join(', ')}`,
    );
  }

  let clips: THREE.AnimationClip[];
  if (format === 'bvh') {
    const text = await file.text();
    clips = parseBvhAnimation(text);
  } else if (format === 'fbx') {
    const buffer = await file.arrayBuffer();
    clips = parseFbxAnimations(buffer);
  } else {
    // glb / gltf / vrma — all glTF-family
    const buffer = await file.arrayBuffer();
    clips = await parseGltfAnimations(buffer);
  }

  if (clips.length === 0) {
    throw new Error(`${format.toUpperCase()} file contains no animation clips`);
  }

  const animations = clips.map(clipToJson);
  const boneSet = new Set<string>();
  for (const a of animations) for (const t of a.tracks) boneSet.add(t.bone);

  return {
    source: file.name,
    sourceFormat: format,
    exportedAt: new Date().toISOString(),
    animations,
    bones: [...boneSet].sort(),
  };
}

/** Pre-parsed FBX-bytes entry point — kept for callers that already have
 *  the buffer (e.g. existing unit tests). */
export function fbxBufferToJson(buffer: ArrayBuffer, sourceName = ''): AnimJsonOutput {
  const clips = parseFbxAnimations(buffer);
  if (clips.length === 0) throw new Error('FBX file contains no animation clips');
  const animations = clips.map(clipToJson);
  const boneSet = new Set<string>();
  for (const a of animations) for (const t of a.tracks) boneSet.add(t.bone);
  return {
    source: sourceName,
    sourceFormat: 'fbx',
    exportedAt: new Date().toISOString(),
    animations,
    bones: [...boneSet].sort(),
  };
}

// ── Download helper ──────────────────────────────────────────────────────────

export function downloadAnimationJson(output: AnimJsonOutput, filename = 'animation.json'): void {
  const text = JSON.stringify(output, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadAgentOgiJson(output: AgentOgiAnimationJson, filename = 'animation.agent_ogi.json'): void {
  const text = JSON.stringify(output, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Convenience: pick file → detect format → parse → download JSON. */
export async function convertAnimationFileToJson(file: File): Promise<string> {
  const baseName = file.name.replace(/\.[a-z]+$/i, '');
  const output = await animationFileToJson(file);
  const filename = `${baseName}.json`;
  downloadAnimationJson(output, filename);
  return filename;
}

// Backward-compat aliases — old API names kept so existing callers don't break.
export const convertFbxFileToJson = convertAnimationFileToJson;
export const downloadFbxJson      = downloadAnimationJson;
