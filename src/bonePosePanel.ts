import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

const DEG = Math.PI / 180;

export interface BoneAxis { axis: 'x' | 'y' | 'z'; min: number; max: number; label: string; }
export interface BoneDef  { vrm: string; label: string; axes: BoneAxis[]; }

export const BONE_POSE_DEFS: BoneDef[] = [
  {
    vrm: 'head', label: 'Head',
    axes: [
      { axis: 'x', min: -30, max: 30,  label: 'Nod ↕'   },
      { axis: 'y', min: -60, max: 60,  label: 'Turn ↔'  },
      { axis: 'z', min: -20, max: 20,  label: 'Tilt ↗'  },
    ],
  },
  {
    vrm: 'neck', label: 'Neck',
    axes: [
      { axis: 'x', min: -20, max: 20, label: 'Nod ↕'  },
      { axis: 'y', min: -30, max: 30, label: 'Turn ↔' },
    ],
  },
  {
    vrm: 'upperChest', label: 'Upper chest',
    axes: [
      { axis: 'x', min: -30, max: 30, label: 'Lean ↕'   },
      { axis: 'y', min: -30, max: 30, label: 'Twist ↔'  },
      { axis: 'z', min: -20, max: 20, label: 'Side ↗'   },
    ],
  },
  {
    vrm: 'chest', label: 'Chest',
    axes: [
      { axis: 'x', min: -30, max: 30, label: 'Lean ↕'  },
      { axis: 'y', min: -30, max: 30, label: 'Twist ↔' },
    ],
  },
  {
    vrm: 'spine', label: 'Spine',
    axes: [
      { axis: 'x', min: -20, max: 20, label: 'Lean ↕'  },
      { axis: 'y', min: -20, max: 20, label: 'Twist ↔' },
    ],
  },
  {
    vrm: 'hips', label: 'Hips',
    axes: [
      { axis: 'x', min: -20, max: 20, label: 'Tilt ↕'  },
      { axis: 'y', min: -40, max: 40, label: 'Turn ↔'  },
      { axis: 'z', min: -15, max: 15, label: 'Side ↗'  },
    ],
  },
  {
    vrm: 'leftShoulder', label: 'L Shoulder',
    axes: [
      { axis: 'y', min: -30, max: 30, label: 'Fwd/Back' },
      { axis: 'z', min: -25, max: 25, label: 'Up/Down'  },
    ],
  },
  {
    vrm: 'rightShoulder', label: 'R Shoulder',
    axes: [
      { axis: 'y', min: -30, max: 30, label: 'Fwd/Back' },
      { axis: 'z', min: -25, max: 25, label: 'Up/Down'  },
    ],
  },
  {
    vrm: 'leftUpperArm', label: 'L Upper arm',
    axes: [
      { axis: 'x', min: -30, max: 30, label: 'Fwd/Back' },
      { axis: 'z', min: -30, max: 30, label: 'Up/Down'  },
    ],
  },
  {
    vrm: 'rightUpperArm', label: 'R Upper arm',
    axes: [
      { axis: 'x', min: -30, max: 30, label: 'Fwd/Back' },
      { axis: 'z', min: -30, max: 30, label: 'Up/Down'  },
    ],
  },
  {
    vrm: 'leftLowerArm', label: 'L Forearm',
    axes: [
      { axis: 'y', min: -80, max: 10, label: 'Bend'    },
      { axis: 'z', min: -30, max: 30, label: 'Twist'   },
    ],
  },
  {
    vrm: 'rightLowerArm', label: 'R Forearm',
    axes: [
      { axis: 'y', min: -10, max: 80, label: 'Bend'    },
      { axis: 'z', min: -30, max: 30, label: 'Twist'   },
    ],
  },
  // Ranges below mirror src/validation/boneConstraints.ts so the visible slider
  // travel matches what the ROM clamp will actually accept — otherwise the
  // user dials past a limit and sees nothing change.
  {
    vrm: 'leftUpperLeg', label: 'L Upper leg',
    axes: [
      { axis: 'y', min: -30, max: 90,  label: 'Fwd/Back' },
      { axis: 'z', min: -30, max: 45,  label: 'Spread'   },
      { axis: 'x', min: -30, max: 30,  label: 'Twist'    },
    ],
  },
  {
    vrm: 'rightUpperLeg', label: 'R Upper leg',
    axes: [
      { axis: 'y', min: -30, max: 90,  label: 'Fwd/Back' },
      { axis: 'z', min: -30, max: 45,  label: 'Spread'   },
      { axis: 'x', min: -30, max: 30,  label: 'Twist'    },
    ],
  },
  {
    vrm: 'leftLowerLeg', label: 'L Knee',
    axes: [
      { axis: 'x', min: 0, max: 140, label: 'Bend' },
    ],
  },
  {
    vrm: 'rightLowerLeg', label: 'R Knee',
    axes: [
      { axis: 'x', min: 0, max: 140, label: 'Bend' },
    ],
  },
  {
    vrm: 'leftFoot', label: 'L Foot',
    axes: [
      { axis: 'x', min: -50, max: 30, label: 'Up/Down' },
      { axis: 'z', min: -35, max: 15, label: 'Roll'    },
    ],
  },
  {
    vrm: 'rightFoot', label: 'R Foot',
    axes: [
      { axis: 'x', min: -50, max: 30, label: 'Up/Down' },
      { axis: 'z', min: -35, max: 15, label: 'Roll'    },
    ],
  },
];

// Storage: boneName → { x, y, z } offsets in degrees
type AxisOffsets = { x: number; y: number; z: number };

export class BonePosePanel {
  private _vrm: VRM;
  private _offsets = new Map<string, AxisOffsets>();
  private _enabled = true;
  private _q = new THREE.Quaternion();
  private _e = new THREE.Euler();

  constructor(vrm: VRM) {
    this._vrm = vrm;
    for (const b of BONE_POSE_DEFS) this._offsets.set(b.vrm, { x: 0, y: 0, z: 0 });
  }

  get enabled(): boolean { return this._enabled; }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) this.resetAll();
  }

  getAvailableBones(): BoneDef[] {
    return BONE_POSE_DEFS.filter((b) => this._vrm.humanoid.getNormalizedBoneNode(b.vrm as VRMHumanBoneName));
  }

  getOffset(bone: string, axis: BoneAxis['axis']): number {
    return this._offsets.get(bone)?.[axis] ?? 0;
  }

  setOffset(bone: string, axis: BoneAxis['axis'], degrees: number): void {
    const offsets = this._offsets.get(bone);
    if (!offsets) return;
    offsets[axis] = degrees;
  }

  /** Post-multiply each bone's current quaternion with the stored Euler offset. */
  apply(): void {
    if (!this._enabled) return;
    for (const b of BONE_POSE_DEFS) {
      const off = this._offsets.get(b.vrm)!;
      if (off.x === 0 && off.y === 0 && off.z === 0) continue;
      const node = this._vrm.humanoid.getNormalizedBoneNode(b.vrm as VRMHumanBoneName);
      if (!node) continue;
      this._e.set(off.x * DEG, off.y * DEG, off.z * DEG, 'YXZ');
      this._q.setFromEuler(this._e);
      node.quaternion.multiply(this._q);
    }
  }

  resetAll(): void {
    for (const off of this._offsets.values()) { off.x = 0; off.y = 0; off.z = 0; }
  }

}
