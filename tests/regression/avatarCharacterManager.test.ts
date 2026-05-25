import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { VRM } from '@pixiv/three-vrm';
import { AvatarCharacterManager } from '../../src/avatarCharacterManager';
import { resolveLanguageHostProfile } from '../../src/languageHosts';

function mockVrm(name: string): VRM {
  const scene = new THREE.Group();
  scene.name = name;
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  scene.add(new THREE.Mesh(geometry, material));
  return { scene } as VRM;
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
    const first = mockVrm('first');
    const second = mockVrm('second');
    const loadVrm = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    await manager.swapTo(resolveLanguageHostProfile('en-US'));
    await manager.swapTo(resolveLanguageHostProfile('ja-JP'));

    expect(scene.children).not.toContain(first.scene);
    expect(scene.children).toContain(second.scene);
    expect(manager.current?.profile.locale).toBe('ja-JP');
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
    const fast = Promise.resolve(mockVrm('fast'));
    const loadVrm = vi.fn()
      .mockReturnValueOnce(slow)
      .mockReturnValueOnce(fast);
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    const slowSwap = manager.swapTo(resolveLanguageHostProfile('fr-FR'));
    const fastSwap = manager.swapTo(resolveLanguageHostProfile('ru-RU'));
    await fastSwap;
    resolveSlow(mockVrm('slow'));
    await expect(slowSwap).rejects.toThrow('superseded');

    expect(manager.current?.profile.locale).toBe('ru-RU');
    expect(scene.children.map((child) => child.name)).toEqual(['fast']);
  });

  it('removes the active host when disposed', async () => {
    const scene = new THREE.Scene();
    const loadVrm = vi.fn(async () => mockVrm('english-host'));
    const manager = new AvatarCharacterManager({ scene, loadVrm });

    await manager.swapTo(resolveLanguageHostProfile('en-US'));
    manager.dispose();

    expect(scene.children).toEqual([]);
    expect(manager.current).toBeNull();
  });
});
