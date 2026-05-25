import type * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { LanguageHostProfile } from './languageHosts';

export interface ActiveAvatar {
  profile: LanguageHostProfile;
  vrm: VRM;
}

export interface AvatarCharacterManagerDeps {
  scene: THREE.Scene;
  loadVrm: (url: string) => Promise<VRM>;
}

export class AvatarSwapSupersededError extends Error {
  constructor() {
    super('avatar swap superseded by a newer request');
    this.name = 'AvatarSwapSupersededError';
  }
}

export class AvatarCharacterManager {
  private readonly scene: THREE.Scene;
  private readonly loadVrm: (url: string) => Promise<VRM>;
  private active: ActiveAvatar | null = null;
  private swapSerial = 0;

  constructor(deps: AvatarCharacterManagerDeps) {
    this.scene = deps.scene;
    this.loadVrm = deps.loadVrm;
  }

  get current(): ActiveAvatar | null {
    return this.active;
  }

  async swapTo(profile: LanguageHostProfile): Promise<ActiveAvatar> {
    const serial = ++this.swapSerial;
    const nextVrm = await this.loadVrm(profile.modelUrl);
    if (serial !== this.swapSerial) {
      this.disposeVrm(nextVrm);
      throw new AvatarSwapSupersededError();
    }

    const previous = this.active;
    const next = { profile, vrm: nextVrm };
    this.scene.add(nextVrm.scene);
    this.active = next;

    if (previous) {
      previous.vrm.scene.parent?.remove(previous.vrm.scene);
      this.disposeVrm(previous.vrm);
    }

    return next;
  }

  dispose(): void {
    this.swapSerial += 1;
    if (!this.active) return;
    this.active.vrm.scene.parent?.remove(this.active.vrm.scene);
    this.disposeVrm(this.active.vrm);
    this.active = null;
  }

  private disposeVrm(vrm: VRM): void {
    vrm.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else {
        material?.dispose();
      }
    });
  }
}
