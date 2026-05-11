/**
 * Standalone FBX → JSON converter.
 *
 * Different concern from `loadFbxFromFile` (which retargets FBX onto the
 * VRM avatar's normalized humanoid). This converter is "raw" — it preserves
 * the FBX's own bone names ('mixamorigHips', 'CC_Base_L_Upperarm', etc.)
 * and emits a portable, schema-stable JSON suitable for use in any
 * downstream pipeline (Python mocap tools, custom engines, server-side
 * processing). No avatar needed.
 *
 * Output shape: per-track, three-style time/values arrays. Mirrors glTF's
 * accessor model rather than BVH's uniform-frame model — each bone can
 * have its own keyframe set (FBX commonly has gaps where bones don't move).
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// ── Output schema ────────────────────────────────────────────────────────────

export interface FbxJsonTrack {
  /** Bone / object name from the FBX (e.g. 'mixamorigHips'). */
  bone: string;
  /** Which transform property this track drives. */
  property: 'position' | 'quaternion' | 'scale' | 'morphTargetInfluences' | string;
  /** Keyframe time stamps in seconds, parallel to `values`. */
  times: number[];
  /**
   * Per-keyframe values. Shape depends on property:
   *   position / scale         → [x, y, z]
   *   quaternion               → [x, y, z, w]
   *   morphTargetInfluences    → [v] (scalar)
   * All tracks rounded to 6 decimal places to keep files small without
   * visible precision loss for animation playback.
   */
  values: number[][];
}

export interface FbxJsonAnimation {
  name: string;
  /** Duration in seconds. */
  duration: number;
  /**
   * Best-guess frame rate derived from the most common keyframe interval
   * across tracks. Null if no usable keyframes were found.
   */
  fps: number | null;
  tracks: FbxJsonTrack[];
}

export interface FbxJsonOutput {
  /** Source filename, if known. Empty string when not provided. */
  source: string;
  /** ISO 8601 timestamp of the conversion. */
  exportedAt: string;
  /** All animations the FBX file contained. Usually just one ('Take 001'). */
  animations: FbxJsonAnimation[];
  /** Sorted, unique bone names that appear in any track. Useful for
   *  picking a target rig before retargeting downstream. */
  bones: string[];
}

// ── Conversion ───────────────────────────────────────────────────────────────

const FLOAT_PRECISION = 6;
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Lossy-by-design rounding: keeps file size sane without affecting playback. */
function packValues(flat: ArrayLike<number>, stride: number): number[][] {
  const n = flat.length / stride;
  const out: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(stride);
    for (let j = 0; j < stride; j++) row[j] = round6(flat[i * stride + j]);
    out[i] = row;
  }
  return out;
}

/** Stride per track property — how many numbers per keyframe value. */
function strideForProperty(property: string): number {
  if (property === 'quaternion') return 4;
  if (property === 'position' || property === 'scale') return 3;
  return 1;  // morph influence or unknown scalar
}

/** Split a three.js track name like 'mixamorigHips.position' into bone + property. */
function splitTrackName(trackName: string): { bone: string; property: string } {
  const dot = trackName.lastIndexOf('.');
  if (dot < 0) return { bone: trackName, property: 'unknown' };
  return { bone: trackName.slice(0, dot), property: trackName.slice(dot + 1) };
}

/** Best-guess fps from the most common time-step between adjacent keyframes
 *  in the longest track. Rounded to nearest integer fps (commonly 24/30/60). */
function guessFps(tracks: FbxJsonTrack[]): number | null {
  const longest = tracks.reduce<FbxJsonTrack | null>(
    (best, t) => (t.times.length > (best?.times.length ?? 0) ? t : best),
    null,
  );
  if (!longest || longest.times.length < 2) return null;
  // Modal time-step across the track (cheap median substitute).
  const steps: number[] = [];
  for (let i = 1; i < longest.times.length; i++) {
    steps.push(longest.times[i] - longest.times[i - 1]);
  }
  steps.sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)];
  if (median <= 0) return null;
  return Math.round(1 / median);
}

/** Convert one three.js AnimationClip to the JSON-friendly shape. */
export function clipToFbxJson(clip: THREE.AnimationClip): FbxJsonAnimation {
  const tracks: FbxJsonTrack[] = clip.tracks.map((track) => {
    const { bone, property } = splitTrackName(track.name);
    const stride = strideForProperty(property);
    return {
      bone,
      property,
      times: Array.from(track.times, round6),
      values: packValues(track.values, stride),
    };
  });
  return {
    name: clip.name,
    duration: round6(clip.duration),
    fps: guessFps(tracks),
    tracks,
  };
}

/** Top-level conversion: FBX bytes → JSON-ready object. Throws if the
 *  FBX file is unparseable or contains no animations. */
export function fbxBufferToJson(buffer: ArrayBuffer, sourceName = ''): FbxJsonOutput {
  const loader = new FBXLoader();
  const root = loader.parse(buffer, '');

  if (!root.animations || root.animations.length === 0) {
    throw new Error('FBX file contains no animation clips');
  }

  const animations = root.animations.map((clip) => clipToFbxJson(clip));
  // Union of bone names across all animations, deduped + sorted.
  const boneSet = new Set<string>();
  for (const a of animations) for (const t of a.tracks) boneSet.add(t.bone);
  const bones = [...boneSet].sort();

  return {
    source: sourceName,
    exportedAt: new Date().toISOString(),
    animations,
    bones,
  };
}

// ── Download helper ──────────────────────────────────────────────────────────

export function downloadFbxJson(output: FbxJsonOutput, filename = 'animation.json'): void {
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

/** One-shot convenience: pick file → parse → download JSON. Returns
 *  the filename written (or rejects if conversion failed). */
export async function convertFbxFileToJson(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const baseName = file.name.replace(/\.fbx$/i, '');
  const output = fbxBufferToJson(buffer, file.name);
  const filename = `${baseName}.json`;
  downloadFbxJson(output, filename);
  return filename;
}
