import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { VRM } from '@pixiv/three-vrm';
import { mapFbxBoneToVrm, countMappedBones } from './fbxBoneMap';
import { retargetFbxToVrmWorldSpace } from './fbxRetargetWorld';

/**
 * Load an `.fbx` file and produce a THREE.AnimationClip whose tracks bind to
 * the given VRM's normalized humanoid bones.
 *
 * Pipeline:
 *  1. FBXLoader parses the binary → Group containing skeleton + animations.
 *  2. We sanity-check that we recognise enough bones to be worth retargeting
 *     (≥8 mapped — anything less is not a humanoid we know).
 *  3. World-space retargeter samples the FBX clip on its own skeleton and
 *     re-expresses each frame's world rotations in VRM-local space, taking
 *     the per-bone rest-pose differences into account. This handles Mixamo,
 *     Maya HumanIK, Blender Rigify and similar rigs that use different
 *     bone-direction / bind-pose conventions than VRM.
 */
export async function loadFbxFromFile(
  file: File,
  vrm: VRM,
  name: string,
): Promise<THREE.AnimationClip> {
  const buffer = await file.arrayBuffer();
  const loader = new FBXLoader();
  // FBXLoader.parse expects ArrayBuffer + a path used to resolve embedded
  // texture refs. We have neither textures nor a real path, so '' is fine.
  const root = loader.parse(buffer, '');

  if (!root.animations?.length) {
    throw new Error('FBX file contains no animation clips');
  }

  const sourceClip = root.animations[0];

  // Inspect the source bone names to give the user a meaningful error early
  // if the skeleton is unrecognised.
  const sourceBones = new Set<string>();
  root.traverse((obj) => { if (obj.name) sourceBones.add(obj.name); });
  for (const track of sourceClip.tracks) {
    const dot = track.name.indexOf('.');
    sourceBones.add(dot > 0 ? track.name.slice(0, dot) : track.name);
  }
  const mappedCount = countMappedBones(sourceBones);
  if (mappedCount < 8) {
    const unmapped = [...sourceBones]
      .filter((n) => !mapFbxBoneToVrm(n))
      .slice(0, 12)
      .join(', ');
    throw new Error(
      `FBX skeleton not recognised — only ${mappedCount} bones mapped. Unmapped: ${unmapped}…`,
    );
  }

  // Diagnostic: log a few key bind-pose quaternions so the user can see the
  // raw rest-pose orientations the retargeter will compensate for.
  const sampleBones = [
    'mixamorigHips',
    'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
    'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot',
    'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand',
  ];
  for (const b of sampleBones) {
    const node = root.getObjectByName(b);
    if (node) {
      const q = node.quaternion;
      console.info(
        `[fbx-import] bind '${b}': [${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)}, ${q.w.toFixed(3)}]`,
      );
    }
  }

  // Hand off to world-space retargeter. Walks the FBX skeleton frame-by-frame
  // via a private AnimationMixer, snapshots world rotations, re-expresses
  // them as VRM-local rotations using each bone's rest-pose correction.
  const out = retargetFbxToVrmWorldSpace(root, sourceClip, vrm, name);

  // Track binding probe: verify each output target resolves under vrm.scene.
  const uniqueTargets = new Set<string>();
  for (const t of out.tracks) {
    const dot = t.name.indexOf('.');
    uniqueTargets.add(dot > 0 ? t.name.slice(0, dot) : t.name);
  }
  let resolved = 0;
  const missing: string[] = [];
  for (const target of uniqueTargets) {
    const node = THREE.PropertyBinding.findNode(vrm.scene, target);
    if (node) resolved++;
    else missing.push(target);
  }
  console.info(
    `[fbx-import] '${name}' tracks=${out.tracks.length}, ` +
    `binding probe: ${resolved}/${uniqueTargets.size} resolve under vrm.scene`,
  );
  if (missing.length > 0) {
    console.warn('[fbx-import] unresolved track targets:', missing.slice(0, 8));
  }

  return out;
}
