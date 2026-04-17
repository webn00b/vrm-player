import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import type { ParsedBVH } from './bvhLoader';
// @ts-ignore — copied JS module from pixiv/bvh2vrma
import { convertBVHToVRMAnimation } from './bvh2vrma/convertBVHToVRMAnimation.js';

/**
 * Full pipeline: BVH → VRMA (via GLTFExporter) → VRMAnimation → AnimationClip
 * Uses the exact same logic as the reference project (pixiv/bvh2vrma).
 */
export async function retargetBvhToVrm(vrm: VRM, bvh: ParsedBVH, name: string): Promise<THREE.AnimationClip> {
  // Step 1: convert BVH to VRMA ArrayBuffer
  const vrmaBuffer: ArrayBuffer = await convertBVHToVRMAnimation(bvh);

  // Step 2: load the VRMA via GLTFLoader + VRMAnimationLoaderPlugin
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const blob = new Blob([vrmaBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  let clip: THREE.AnimationClip;
  try {
    const gltf = await loader.loadAsync(url);
    const vrmAnimations = gltf.userData.vrmAnimations;
    if (!vrmAnimations?.length) throw new Error('No VRM animations in exported VRMA');
    clip = createVRMAnimationClip(vrmAnimations[0], vrm);
    clip.name = name;
  } finally {
    URL.revokeObjectURL(url);
  }

  return clip;
}
