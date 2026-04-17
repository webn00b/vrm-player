import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

export interface ParsedBVH {
  clip: THREE.AnimationClip;
  skeleton: THREE.Skeleton;
}

export async function loadBVH(url: string): Promise<ParsedBVH> {
  const text = await (await fetch(url)).text();
  return parseBVH(text);
}

/** Parse a BVH text string directly (no network fetch). Used for in-memory replay. */
export function parseBVH(text: string): ParsedBVH {
  const { skeleton, clip } = new BVHLoader().parse(text);
  return { clip, skeleton };
}
