/**
 * glTF / GLB export for animation clips.
 *
 * Unlike `exportClipAsBvh` which plays the clip back through the live render
 * loop (so mocap overlays / validator clamp / bone-drag all participate),
 * this exporter writes the clip's raw track data directly. Downstream tools
 * (Unity, Unreal, Blender) get clean motion-capture data without playback-
 * specific post-processing — which is what character pipelines expect.
 *
 * Why glTF instead of FBX:
 *   - Three.js ships a maintained `GLTFExporter`; there is no equivalent
 *     `FBXExporter` (the format is binary-heavy and undocumented enough that
 *     no community npm package has stayed working).
 *   - glTF/GLB imports natively into Unity (via UniGLTF, already used by the
 *     VRM tooling the avatars come from), Unreal (glTFRuntime / Datasmith),
 *     Blender (built-in), and Maya/3ds Max via plugins.
 *   - GLB is binary, smaller than FBX ASCII, and self-contained (single file).
 *
 * Output shape: a GLB containing the VRM's bind-pose skeleton (no mesh — the
 * receiver already has the avatar) plus one `THREE.AnimationClip` as a glTF
 * `animations` entry. Track names are VRM-canonical (`leftUpperArm.quaternion`
 * etc.) so retargeting tools can map them directly.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/**
 * Build a bones-only Object3D tree from a VRM and export it together with
 * `clip` as a GLB blob. Returns the blob so the caller can decide whether to
 * trigger a download, send it over the wire, etc.
 *
 * The exported scene contains:
 *   - One `THREE.Object3D` per VRM humanoid bone, parented to match the rig
 *   - Bone names match the VRM convention (leftUpperArm, rightLowerLeg, ...)
 *   - Each bone's `position` matches its normalized rest position; `quaternion`
 *     is identity (bind pose, suitable for animation playback target)
 *
 * Mesh data is intentionally omitted — the downstream pipeline already has
 * the avatar (as VRM, FBX, or whatever the artist provided); we ship just
 * the motion. Adding the mesh would double GLB size and force the receiver
 * to either ignore it or set up bind-pose binding manually.
 */
export async function buildGlbBlobForClip(
  vrm: VRM,
  clip: THREE.AnimationClip,
): Promise<Blob> {
  // ── 1. Build a bones-only scene mirroring the VRM humanoid hierarchy ─
  // Walking the existing vrm.scene would drag in meshes and helper objects;
  // cloning bone-by-bone gives us a clean tree.
  const HUMANOID_BONES = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftEye', 'rightEye', 'jaw',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
    // Fingers — both sides.
    'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
    'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
    'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
    'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
    'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
    'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
    'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
    'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
    'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
    'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
  ] as const;

  // First pass: clone each bone as a plain Object3D positioned at its
  // normalized rest. Skipping bones the VRM doesn't have.
  const cloned = new Map<string, THREE.Object3D>();
  for (const name of HUMANOID_BONES) {
    const node = vrm.humanoid.getNormalizedBoneNode(name as any);
    if (!node) continue;
    const out = new THREE.Object3D();
    out.name = name;
    out.position.copy(node.position);
    // quaternion stays identity (bind pose)
    cloned.set(name, out);
  }

  // Second pass: re-parent according to the VRM hierarchy. Walk up each
  // bone's parent chain until we find another bone we cloned.
  const root = new THREE.Group();
  root.name = 'mocap-skeleton';
  for (const [name, node] of cloned) {
    const original = vrm.humanoid.getNormalizedBoneNode(name as any);
    let parent = original?.parent ?? null;
    let parentBoneName: string | null = null;
    while (parent) {
      const matchName = [...cloned.keys()].find(
        (n) => vrm.humanoid.getNormalizedBoneNode(n as any) === parent,
      );
      if (matchName) { parentBoneName = matchName; break; }
      parent = parent.parent;
    }
    if (parentBoneName) cloned.get(parentBoneName)!.add(node);
    else                root.add(node);
  }

  // ── 2. Export via GLTFExporter ───────────────────────────────────────
  const exporter = new GLTFExporter();
  const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('GLTFExporter returned JSON when binary was requested'));
      },
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      {
        binary: true,
        animations: [clip],
        // Don't bother with mesh/material defaults — we have neither.
        onlyVisible: false,
      },
    );
  });

  return new Blob([arrayBuffer], { type: 'model/gltf-binary' });
}

/** Browser-side download helper. Mirrors `downloadBvh`'s pattern so the call
 *  site looks symmetric: `downloadGlb(blob, name)` instead of constructing
 *  the anchor manually. */
export function downloadGlb(blob: Blob, filename = 'mocap.glb'): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.glb') ? filename : `${filename}.glb`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the object URL on the next tick so the click handler has time to
  // pick it up. Same pattern as downloadBvh.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Convenience: build + download in one call.
 *
 * Use this when you don't need access to the blob (e.g. user-clicked
 * "⬇ glb" button in the queue). Returns a promise that resolves to the
 * filename actually used, suitable for status-message wiring. */
export async function exportClipAsGlb(
  vrm: VRM,
  clip: THREE.AnimationClip,
  name: string,
): Promise<string> {
  const blob = await buildGlbBlobForClip(vrm, clip);
  const filename = `${name}.glb`;
  downloadGlb(blob, filename);
  return filename;
}
