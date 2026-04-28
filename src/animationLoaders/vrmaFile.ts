import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VRM } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { applyHumanoidRestCorrectionsToClip } from '../humanoidRestPose';

/**
 * Load a `.vrma` file (glTF binary with the VRM animation extension) and
 * convert it into a THREE.AnimationClip targeting the given VRM. Mirrors the
 * loader half of `retargetBvhToVrm` but skips the BVH→VRMA encode step
 * because the input is already VRMA.
 */
export async function loadVrmaFromFile(file: File, vrm: VRM, name: string): Promise<THREE.AnimationClip> {
  const buffer = await file.arrayBuffer();
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const blob = new Blob([buffer], { type: 'model/gltf-binary' });
  const url  = URL.createObjectURL(blob);
  try {
    const gltf = await loader.loadAsync(url);
    const vrmAnimations = gltf.userData.vrmAnimations;
    if (!vrmAnimations?.length) throw new Error('No VRM animations in this file');
    const clip = createVRMAnimationClip(vrmAnimations[0], vrm);
    clip.name = name;
    // Same A-pose→T-pose correction the BVH→VRMA path applies, so a re-imported
    // self-recorded VRMA round-trips back to the same on-screen pose.
    applyHumanoidRestCorrectionsToClip(clip, vrm);
    return clip;
  } finally {
    URL.revokeObjectURL(url);
  }
}
