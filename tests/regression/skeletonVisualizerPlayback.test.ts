import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkeletonVisualizer } from '../../src/skeletonVisualizer';

function installCanvasStub(): void {
  globalThis.document ??= {
    createElement: () => ({
      width: 1,
      height: 1,
      getContext: () => ({
        font: '',
        textBaseline: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        measureText: (text: string) => ({ width: text.length * 10 }),
        beginPath: () => {},
        moveTo: () => {},
        arcTo: () => {},
        closePath: () => {},
        fill: () => {},
        stroke: () => {},
        fillText: () => {},
      }),
    }),
  } as unknown as Document;
}

function makeBone(name: string, position: THREE.Vector3, parent?: THREE.Object3D): THREE.Object3D {
  const bone = new THREE.Object3D();
  bone.name = name;
  bone.position.copy(position);
  parent?.add(bone);
  return bone;
}

test('skeleton overlay follows normalized bones driven by BVH playback', () => {
  installCanvasStub();

  const scene = new THREE.Scene();
  const rawRoot = new THREE.Object3D();
  const normRoot = new THREE.Object3D();
  const raw = new Map<string, THREE.Object3D>();
  const norm = new Map<string, THREE.Object3D>();

  raw.set('hips', makeBone('rawHips', new THREE.Vector3(0, 0, 0), rawRoot));
  raw.set('spine', makeBone('rawSpine', new THREE.Vector3(0, 1, 0), raw.get('hips')));
  norm.set('hips', makeBone('hips', new THREE.Vector3(0, 0, 0), normRoot));
  norm.set('spine', makeBone('spine', new THREE.Vector3(0, 2, 0), norm.get('hips')));

  rawRoot.updateMatrixWorld(true);
  normRoot.updateMatrixWorld(true);

  const vrm = {
    humanoid: {
      getRawBoneNode: (name: string) => raw.get(name) ?? null,
      getNormalizedBoneNode: (name: string) => norm.get(name) ?? null,
    },
  };

  const visualizer = new SkeletonVisualizer(vrm as never, scene);
  visualizer.setVisible(true);
  visualizer.update();

  const bodyLines = (visualizer as unknown as { bodyLines: THREE.LineSegments }).bodyLines;
  const positions = bodyLines.geometry.attributes.position as THREE.BufferAttribute;
  assert.equal(positions.getY(0), 0);
  assert.equal(positions.getY(1), 2);

  visualizer.dispose();
});

test('unclamped skeleton overlay renders the pre-validation captured pose in red', () => {
  installCanvasStub();

  const scene = new THREE.Scene();
  const root = new THREE.Object3D();
  const bones = new Map<string, THREE.Object3D>();
  bones.set('hips', makeBone('hips', new THREE.Vector3(0, 0, 0), root));
  bones.set('spine', makeBone('spine', new THREE.Vector3(0, 2, 0), bones.get('hips')));
  root.updateMatrixWorld(true);

  const vrm = {
    scene: root,
    humanoid: {
      getRawBoneNode: () => null,
      getNormalizedBoneNode: (name: string) => bones.get(name) ?? null,
    },
  };

  const visualizer = new SkeletonVisualizer(vrm as never, scene);
  visualizer.setUnclampedVisible(true);
  visualizer.captureUnclampedPose();

  bones.get('spine')?.position.set(0, 1, 0);
  root.updateMatrixWorld(true);
  visualizer.update();

  const unclampedLines = (visualizer as unknown as { unclampedBodyLines: THREE.LineSegments }).unclampedBodyLines;
  const positions = unclampedLines.geometry.attributes.position as THREE.BufferAttribute;
  assert.equal((unclampedLines.material as THREE.LineBasicMaterial).color.getHex(), 0xff3344);
  assert.equal(positions.getY(0), 0);
  assert.equal(positions.getY(1), 2);

  visualizer.dispose();
});

test('unclamped red skeleton renders behind the regular skeleton when poses overlap', () => {
  installCanvasStub();

  const scene = new THREE.Scene();
  const root = new THREE.Object3D();
  const bones = new Map<string, THREE.Object3D>();
  bones.set('hips', makeBone('hips', new THREE.Vector3(0, 0, 0), root));
  bones.set('spine', makeBone('spine', new THREE.Vector3(0, 2, 0), bones.get('hips')));

  const vrm = {
    scene: root,
    humanoid: {
      getRawBoneNode: () => null,
      getNormalizedBoneNode: (name: string) => bones.get(name) ?? null,
    },
  };

  const visualizer = new SkeletonVisualizer(vrm as never, scene);
  const layers = visualizer as unknown as {
    bodyLines: THREE.LineSegments;
    dots: THREE.Points;
    unclampedBodyLines: THREE.LineSegments;
    unclampedDots: THREE.Points;
  };

  assert.ok(layers.unclampedBodyLines.renderOrder < layers.bodyLines.renderOrder);
  assert.ok(layers.unclampedDots.renderOrder < layers.dots.renderOrder);

  visualizer.dispose();
});
