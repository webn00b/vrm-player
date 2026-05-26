import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { LanguageHostProfile } from './languageHosts';

export interface ActiveAvatar {
  profile: LanguageHostProfile;
  vrm: VRM;
}

interface PendingAvatarSwap {
  previous: ActiveAvatar | null;
  next: ActiveAvatar;
}

interface PreparedAvatarResources {
  emptyChildNodes: THREE.Object3D[];
  materialsWithTextures: THREE.Material[];
  renderableNodes: THREE.Object3D[];
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

export class AvatarHostAssetLoadError extends Error {
  constructor(
    readonly profile: LanguageHostProfile,
    cause: unknown,
  ) {
    super(`Host asset unavailable: ${profile.modelUrl}`, { cause });
    this.name = 'AvatarHostAssetLoadError';
  }
}

export class AvatarCharacterManager {
  private readonly scene: THREE.Scene;
  private readonly loadVrm: (url: string) => Promise<VRM>;
  private readonly preparedResources = new WeakMap<VRM, PreparedAvatarResources>();
  private active: ActiveAvatar | null = null;
  private pending: PendingAvatarSwap | null = null;
  private retiredAfterRender: VRM[] = [];
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
    this.disposePendingSwap();

    let nextVrm: VRM;
    try {
      nextVrm = await this.loadVrm(profile.modelUrl);
    } catch (error) {
      if (serial !== this.swapSerial) {
        throw new AvatarSwapSupersededError();
      }
      throw new AvatarHostAssetLoadError(profile, error);
    }

    if (serial !== this.swapSerial) {
      this.disposeVrm(nextVrm);
      throw new AvatarSwapSupersededError();
    }

    const next = { profile, vrm: nextVrm };
    nextVrm.scene.visible = false;
    this.preparedResources.set(nextVrm, this.prepareVrmForSwap(nextVrm));
    this.scene.add(nextVrm.scene);
    this.pending = { previous: this.active, next };

    return next;
  }

  beforeRender(): void {
    if (!this.pending) return;

    const { previous, next } = this.pending;
    if (previous) previous.vrm.scene.visible = false;
    next.vrm.scene.visible = true;
    this.active = next;
    this.pending = null;
    if (previous) this.retiredAfterRender.push(previous.vrm);
  }

  afterRender(): void {
    if (!this.retiredAfterRender.length) return;

    const retired = this.retiredAfterRender;
    this.retiredAfterRender = [];
    retired.forEach((vrm) => {
      this.scene.remove(vrm.scene);
      this.disposeVrm(vrm);
    });
  }

  dispose(): void {
    this.swapSerial += 1;
    this.disposePendingSwap();
    this.afterRender();
    if (this.active) {
      this.scene.remove(this.active.vrm.scene);
      this.disposeVrm(this.active.vrm);
    }
    this.active = null;
  }

  private disposePendingSwap(): void {
    if (!this.pending) return;
    this.scene.remove(this.pending.next.vrm.scene);
    this.disposeVrm(this.pending.next.vrm);
    this.pending = null;
  }

  private prepareVrmForSwap(vrm: VRM): PreparedAvatarResources {
    const emptyChildNodes: THREE.Object3D[] = [];
    const materialsWithTextures = new Set<THREE.Material>();
    const renderableNodes: THREE.Object3D[] = [];

    vrm.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const hasGeometry = !!mesh.geometry;
      const material = mesh.material;

      if (hasGeometry || material) {
        renderableNodes.push(obj);
      } else if (obj.children.length === 0) {
        emptyChildNodes.push(obj);
      }

      const inspectMaterial = (item: THREE.Material): void => {
        if (this.materialHasTexture(item)) materialsWithTextures.add(item);
      };

      if (Array.isArray(material)) {
        material.forEach(inspectMaterial);
      } else if (material) {
        inspectMaterial(material);
      }
    });

    return {
      emptyChildNodes,
      materialsWithTextures: [...materialsWithTextures],
      renderableNodes,
    };
  }

  private materialHasTexture(material: THREE.Material): boolean {
    let hasTexture = false;

    Object.values(material).forEach((value) => {
      if (value instanceof THREE.Texture) hasTexture = true;
    });

    const maybeUniforms = (material as THREE.Material & {
      uniforms?: Record<string, { value: unknown } | unknown>;
    }).uniforms;

    if (maybeUniforms) {
      const textures = new Set<THREE.Texture>();
      Object.values(maybeUniforms).forEach((uniform) => {
        if (
          uniform
          && typeof uniform === 'object'
          && 'value' in uniform
        ) {
          this.collectTextureResources(uniform.value, textures);
        } else {
          this.collectTextureResources(uniform, textures);
        }
      });
      if (textures.size > 0) hasTexture = true;
    }

    return hasTexture;
  }

  private disposeVrm(vrm: VRM): void {
    this.preparedResources.delete(vrm);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const skeletons = new Set<THREE.Skeleton>();

    vrm.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) {
        geometries.add(mesh.geometry);
      }

      const skinnedMesh = obj as THREE.SkinnedMesh;
      if (skinnedMesh.skeleton) {
        skeletons.add(skinnedMesh.skeleton);
      }

      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((item) => this.collectMaterialResources(item, materials, textures));
      } else if (material) {
        this.collectMaterialResources(material, materials, textures);
      }
    });

    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    skeletons.forEach((skeleton) => skeleton.dispose());
  }

  private collectMaterialResources(
    material: THREE.Material,
    materials: Set<THREE.Material>,
    textures: Set<THREE.Texture>,
  ): void {
    materials.add(material);

    Object.values(material).forEach((value) => {
      if (value instanceof THREE.Texture) {
        textures.add(value);
      }
    });

    const maybeUniforms = (material as THREE.Material & {
      uniforms?: Record<string, { value: unknown } | unknown>;
    }).uniforms;

    if (maybeUniforms) {
      Object.values(maybeUniforms).forEach((uniform) => {
        if (
          uniform
          && typeof uniform === 'object'
          && 'value' in uniform
        ) {
          this.collectTextureResources(uniform.value, textures);
        } else {
          this.collectTextureResources(uniform, textures);
        }
      });
    }
  }

  private collectTextureResources(
    value: unknown,
    textures: Set<THREE.Texture>,
    seen = new WeakSet<object>(),
  ): void {
    if (value instanceof THREE.Texture) {
      textures.add(value);
      return;
    }

    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    Object.values(value).forEach((child) => {
      this.collectTextureResources(child, textures, seen);
    });
  }
}
