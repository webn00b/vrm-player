import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { parseBVH, type ParsedBVH } from './bvhLoader';
import { retargetBvhToVrm } from './retarget';
import { loadVrmaFromFile } from './animationLoaders/vrmaFile';
import { loadFbxFromFile } from './animationLoaders/fbxFile';
import type { ManualFbxBoneMapping } from './animationLoaders/fbxBoneMapping';
import { channelAnimationJsonToClip, isChannelAnimationJson } from './animationLoaders/channelJsonFile';
import { parseCanonicalMotionJson } from './mocap/offline/canonicalMotion';
import { retargetCanonicalMotionToVrm, type OfflineRetargetOptions } from './mocap/offline/motionRetargeter';

export type ImportFormat = 'bvh' | 'vrma' | 'fbx' | 'motion-json' | 'channel-json';

export interface LoadedAnimation {
  name: string;
  clip: THREE.AnimationClip;
  /**
   * Original parsed BVH, when the source was a `.bvh` file. Lets the queue's
   * "⬇ VRMA" button re-encode without re-fetching the original. `null` for
   * VRMA and FBX inputs (we don't synthesize a BVH from an arbitrary clip
   * here — the queue offers a separate "⬇ BVH" live-recorder for that).
   */
  parsedBvh: ParsedBVH | null;
  format: ImportFormat;
}

function detectFormat(filename: string): ImportFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.bvh')) return 'bvh';
  if (lower.endsWith('.vrma')) return 'vrma';
  if (lower.endsWith('.fbx')) return 'fbx';
  if (lower.endsWith('.json')) {
    return 'motion-json';
  }
  return null;
}

const SUPPORTED_REGEX = /\.(bvh|vrma|fbx|json)$/i;

/** Returns true if the filename's extension is a supported animation format. */
export function isSupportedAnimationFile(filename: string): boolean {
  return SUPPORTED_REGEX.test(filename);
}

function logImportedAnimation(params: {
  file: File;
  format: ImportFormat;
  name: string;
  clip: THREE.AnimationClip;
  parsedBvh?: ParsedBVH | null;
}): void {
  console.info('[animation:import]', {
    file: params.file.name,
    bytes: params.file.size,
    format: params.format,
    name: params.name,
    durationSec: Number(params.clip.duration.toFixed(3)),
    tracks: params.clip.tracks.length,
    sourceBones: params.parsedBvh?.skeleton.bones.length ?? null,
    sourceTracks: params.parsedBvh?.clip.tracks.length ?? null,
  });
}

/**
 * Single entry point used by both the Capture-panel file picker and the
 * window drag-drop handler. Detects format by extension, runs the matching
 * loader + retargeter, and returns a clip ready for AnimationController.register.
 */
export async function loadAnimationFile(
  file: File,
  vrm: VRM,
  manualFbxMapping: ManualFbxBoneMapping = {},
): Promise<LoadedAnimation> {
  const fmt = detectFormat(file.name);
  if (!fmt) throw new Error(`Unsupported file extension: ${file.name}`);
  const baseName = file.name.replace(SUPPORTED_REGEX, '');

  if (fmt === 'bvh') {
    const text = await file.text();
    const bvh  = parseBVH(text);
    const clip = await retargetBvhToVrm(vrm, bvh, baseName);
    logImportedAnimation({ file, format: 'bvh', name: baseName, clip, parsedBvh: bvh });
    return { name: baseName, clip, parsedBvh: bvh, format: 'bvh' };
  }

  if (fmt === 'vrma') {
    const clip = await loadVrmaFromFile(file, vrm, baseName);
    logImportedAnimation({ file, format: 'vrma', name: baseName, clip });
    return { name: baseName, clip, parsedBvh: null, format: 'vrma' };
  }

  if (fmt === 'motion-json') {
    const text = await file.text();
    const raw = JSON.parse(text) as unknown;
    if (isChannelAnimationJson(raw)) {
      const clip = channelAnimationJsonToClip(raw, vrm, baseName);
      logImportedAnimation({ file, format: 'channel-json', name: baseName, clip });
      return { name: baseName, clip, parsedBvh: null, format: 'channel-json' };
    }
    const motion = parseCanonicalMotionJson(text, baseName);
    const offlineOpts: OfflineRetargetOptions = { clampOutOfRange: true };
    if (motion.source === 'gvhmr' || motion.source === 'smpl' || motion.coordinateSpace === 'smpl') {
      offlineOpts.positionSmoothingAlpha = 0.45;
      offlineOpts.rootMotionMode = 'locked';
    }
    const clip = retargetCanonicalMotionToVrm(vrm, motion, offlineOpts);
    logImportedAnimation({ file, format: 'motion-json', name: motion.name || baseName, clip });
    return { name: motion.name || baseName, clip, parsedBvh: null, format: 'motion-json' };
  }

  // fbx
  const clip = await loadFbxFromFile(file, vrm, baseName, manualFbxMapping);
  logImportedAnimation({ file, format: 'fbx', name: baseName, clip });
  return { name: baseName, clip, parsedBvh: null, format: 'fbx' };
}
