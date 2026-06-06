import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { retargetBvhToVrm } from '../../src/retarget';
import { buildMockVRM } from '../fixtures/mockVrm';

class ArrayBufferFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;

  async readAsArrayBuffer(blob: Blob): Promise<void> {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
}

test('retargeted BVH clip drives normalized humanoid bones through AnimationMixer', async () => {
  globalThis.FileReader = ArrayBufferFileReader as unknown as typeof FileReader;
  globalThis.ProgressEvent ??= class ProgressEvent extends Event {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;

    constructor(type: string, init: ProgressEventInit = {}) {
      super(type, init);
      this.lengthComputable = init.lengthComputable ?? false;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  } as typeof ProgressEvent;

  const text = readFileSync('animations/c1199df6f299a632faa4600459513a4c.bvh', 'utf8');
  const bvh = new BVHLoader().parse(text);
  const vrm = buildMockVRM();
  Object.assign(vrm.humanoid, {
    normalizedRestPose: {
      hips: { position: [0, 1, 0] },
    },
  });
  const clip = await retargetBvhToVrm(vrm, bvh, 'fixture-walk', {
    clampOutOfRange: false,
    skipRestCorrection: true,
  });
  const retargetInfo = clip.userData?.retargetInfo;
  assert.equal(retargetInfo?.source, 'bvh-vrma');
  assert.ok(Number.isFinite(retargetInfo?.restCorrectionTracks));
  assert.ok(Number.isFinite(retargetInfo?.signFlips));
  assert.ok(Number.isFinite(retargetInfo?.validationViolations));

  const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
  assert.ok(leftUpperArm);
  const before = leftUpperArm.quaternion.clone();

  const mixer = new THREE.AnimationMixer(vrm.scene);
  mixer.clipAction(clip).play();
  mixer.update(0.5);

  const movedDeg = THREE.MathUtils.radToDeg(before.angleTo(leftUpperArm.quaternion));
  assert.ok(
    movedDeg > 1,
    `expected leftUpperArm to move during BVH playback; moved ${movedDeg.toFixed(3)}deg`,
  );
});
