import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { VRM } from '@pixiv/three-vrm';
import {
  AvatarCharacterManager,
  AvatarSwapSupersededError,
} from '../../src/avatarCharacterManager';
import { resolveLanguageHostProfile } from '../../src/languageHosts';

function mockVrm(name: string): VRM {
  const scene = new THREE.Group();
  scene.name = name;
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  scene.add(new THREE.Mesh(geometry, material));
  return { scene } as VRM;
}

interface DisposableVrmMock {
  vrm: VRM;
  geometryDispose: ReturnType<typeof vi.spyOn>;
  materialDispose: ReturnType<typeof vi.spyOn>;
  textureDispose: ReturnType<typeof vi.spyOn>;
  skeletonDispose: ReturnType<typeof vi.spyOn>;
}

type UniformTextureMaterial = THREE.MeshBasicMaterial & {
  uniforms: Record<string, { value: unknown }>;
};

function mockDisposableVrm(name: string): DisposableVrmMock {
  const scene = new THREE.Group();
  scene.name = name;
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial() as UniformTextureMaterial;
  const skeleton = new THREE.Skeleton([new THREE.Bone()]);
  material.uniforms = {
    mainTexture: { value: texture },
    sharedTexture: { value: texture },
  };
  const geometryDispose = vi.spyOn(geometry, 'dispose');
  const materialDispose = vi.spyOn(material, 'dispose');
  const textureDispose = vi.spyOn(texture, 'dispose');
  const skeletonDispose = vi.spyOn(skeleton, 'dispose');

  scene.add(new THREE.Mesh(geometry, material));
  scene.add(new THREE.Mesh(geometry, material));
  const firstSkinnedMesh = new THREE.SkinnedMesh(geometry, material);
  const secondSkinnedMesh = new THREE.SkinnedMesh(geometry, material);
  firstSkinnedMesh.bind(skeleton);
  secondSkinnedMesh.bind(skeleton);
  scene.add(firstSkinnedMesh);
  scene.add(secondSkinnedMesh);

  return {
    vrm: { scene } as VRM,
    geometryDispose,
    materialDispose,
    textureDispose,
    skeletonDispose,
  };
}

function mockUserDataTextureVrm(name: string) {
  const scene = new THREE.Group();
  scene.name = name;
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const userDataTexture = new THREE.Texture();
  material.userData = {
    cachedPreviewTexture: userDataTexture,
  };
  const geometryDispose = vi.spyOn(geometry, 'dispose');
  const materialDispose = vi.spyOn(material, 'dispose');
  const userDataTextureDispose = vi.spyOn(userDataTexture, 'dispose');

  scene.add(new THREE.Mesh(geometry, material));

  return {
    vrm: { scene } as VRM,
    geometryDispose,
    materialDispose,
    userDataTextureDispose,
  };
}

describe('AvatarCharacterManager', () => {
  it('loads and adds the requested language host to the scene', async () => {
    const scene = new THREE.Scene();
    const loadVrm = vi.fn(async () => mockVrm('english-host'));
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    const active = await manager.swapTo(resolveLanguageHostProfile('en-US'));

    expect(loadVrm).toHaveBeenCalledWith('/models/hosts/en-US/host.vrm');
    expect(active.profile.locale).toBe('en-US');
    expect(scene.children).toContain(active.vrm.scene);
  });

  it('removes the previous host after a successful swap', async () => {
    const scene = new THREE.Scene();
    const first = mockDisposableVrm('first');
    const second = mockVrm('second');
    const loadVrm = vi.fn()
      .mockResolvedValueOnce(first.vrm)
      .mockResolvedValueOnce(second);
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    await manager.swapTo(resolveLanguageHostProfile('en-US'));
    await manager.swapTo(resolveLanguageHostProfile('ja-JP'));

    expect(scene.children).not.toContain(first.vrm.scene);
    expect(scene.children).toContain(second.scene);
    expect(manager.current?.profile.locale).toBe('ja-JP');
    expect(first.geometryDispose).toHaveBeenCalledTimes(1);
    expect(first.materialDispose).toHaveBeenCalledTimes(1);
    expect(first.textureDispose).toHaveBeenCalledTimes(1);
    expect(first.skeletonDispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the current host when a new host fails to load', async () => {
    const scene = new THREE.Scene();
    const first = mockVrm('first');
    const loadVrm = vi.fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('missing file'));
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    await manager.swapTo(resolveLanguageHostProfile('en-US'));
    await expect(manager.swapTo(resolveLanguageHostProfile('ja-JP'))).rejects.toThrow('missing file');

    expect(scene.children).toContain(first.scene);
    expect(manager.current?.profile.locale).toBe('en-US');
  });

  it('ignores stale slower loads when a newer swap finishes first', async () => {
    const scene = new THREE.Scene();
    let resolveSlow!: (vrm: VRM) => void;
    const slow = new Promise<VRM>((resolve) => { resolveSlow = resolve; });
    const stale = mockDisposableVrm('slow');
    const fast = Promise.resolve(mockVrm('fast'));
    const loadVrm = vi.fn()
      .mockReturnValueOnce(slow)
      .mockReturnValueOnce(fast);
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    const slowSwap = manager.swapTo(resolveLanguageHostProfile('fr-FR'));
    const fastSwap = manager.swapTo(resolveLanguageHostProfile('ru-RU'));
    await fastSwap;
    resolveSlow(stale.vrm);
    await expect(slowSwap).rejects.toThrow('superseded');

    expect(manager.current?.profile.locale).toBe('ru-RU');
    expect(scene.children.map((child) => child.name)).toEqual(['fast']);
    expect(stale.geometryDispose).toHaveBeenCalledTimes(1);
    expect(stale.materialDispose).toHaveBeenCalledTimes(1);
    expect(stale.textureDispose).toHaveBeenCalledTimes(1);
    expect(stale.skeletonDispose).toHaveBeenCalledTimes(1);
  });

  it('surfaces superseded when a stale slower load rejects after a newer swap', async () => {
    const scene = new THREE.Scene();
    let rejectSlow!: (error: Error) => void;
    const slow = new Promise<VRM>((_, reject) => { rejectSlow = reject; });
    const fast = Promise.resolve(mockVrm('fast'));
    const loadVrm = vi.fn()
      .mockReturnValueOnce(slow)
      .mockReturnValueOnce(fast);
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    const slowSwap = manager.swapTo(resolveLanguageHostProfile('fr-FR'));
    await manager.swapTo(resolveLanguageHostProfile('ru-RU'));
    rejectSlow(new Error('missing stale file'));
    await expect(slowSwap).rejects.toThrow(AvatarSwapSupersededError);

    expect(manager.current?.profile.locale).toBe('ru-RU');
    expect(scene.children.map((child) => child.name)).toEqual(['fast']);
  });

  it('does not dispose textures reachable only through material userData', async () => {
    const scene = new THREE.Scene();
    const active = mockUserDataTextureVrm('cached');
    const loadVrm = vi.fn(async () => active.vrm);
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    await manager.swapTo(resolveLanguageHostProfile('en-US'));
    manager.dispose();

    expect(active.geometryDispose).toHaveBeenCalledTimes(1);
    expect(active.materialDispose).toHaveBeenCalledTimes(1);
    expect(active.userDataTextureDispose).not.toHaveBeenCalled();
  });

  it('removes the active host when disposed', async () => {
    const scene = new THREE.Scene();
    const active = mockDisposableVrm('english-host');
    const loadVrm = vi.fn(async () => active.vrm);
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    await manager.swapTo(resolveLanguageHostProfile('en-US'));
    manager.dispose();

    expect(scene.children).toEqual([]);
    expect(manager.current).toBeNull();
    expect(active.geometryDispose).toHaveBeenCalledTimes(1);
    expect(active.materialDispose).toHaveBeenCalledTimes(1);
    expect(active.textureDispose).toHaveBeenCalledTimes(1);
    expect(active.skeletonDispose).toHaveBeenCalledTimes(1);
  });
});
