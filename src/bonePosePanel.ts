import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

const DEG = Math.PI / 180;

interface BoneAxis { axis: 'x' | 'y' | 'z'; min: number; max: number; label: string; }
interface BoneDef  { vrm: string; label: string; axes: BoneAxis[]; }

const BONES: BoneDef[] = [
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
    for (const b of BONES) this._offsets.set(b.vrm, { x: 0, y: 0, z: 0 });
  }

  get enabled(): boolean { return this._enabled; }

  /** Post-multiply each bone's current quaternion with the stored Euler offset. */
  apply(): void {
    if (!this._enabled) return;
    for (const b of BONES) {
      const off = this._offsets.get(b.vrm)!;
      if (off.x === 0 && off.y === 0 && off.z === 0) continue;
      const node = this._vrm.humanoid.getNormalizedBoneNode(b.vrm as any);
      if (!node) continue;
      this._e.set(off.x * DEG, off.y * DEG, off.z * DEG, 'YXZ');
      this._q.setFromEuler(this._e);
      node.quaternion.multiply(this._q);
    }
  }

  resetAll(): void {
    for (const off of this._offsets.values()) { off.x = 0; off.y = 0; off.z = 0; }
  }

  mount(container: HTMLElement): void {
    container.innerHTML = '';

    const header = document.createElement('p');
    header.className = 'panel-title';
    header.innerHTML = `
      <span>Bones</span>
      <span style="display:flex;gap:6px;margin-left:auto">
        <button id="bone-toggle" class="dbg-toggle">ON</button>
        <button id="bone-reset"  class="dbg-toggle off">Reset</button>
      </span>`;
    // Prevent the button clicks from also triggering panel collapse.
    header.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', (ev) => ev.stopPropagation())
    );
    container.appendChild(header);

    const toggleBtn = header.querySelector<HTMLButtonElement>('#bone-toggle')!;
    toggleBtn.addEventListener('click', () => {
      this._enabled = !this._enabled;
      toggleBtn.textContent = this._enabled ? 'ON' : 'OFF';
      toggleBtn.classList.toggle('off', !this._enabled);
      if (!this._enabled) this.resetAll();
    });

    header.querySelector<HTMLButtonElement>('#bone-reset')!.addEventListener('click', () => {
      this.resetAll();
      container.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((s) => {
        s.value = '0';
        const valEl = container.querySelector<HTMLElement>(`#${s.id}-val`);
        if (valEl) valEl.textContent = '0°';
      });
    });

    for (const bone of BONES) {
      // Skip bones not present in this VRM
      if (!this._vrm.humanoid.getNormalizedBoneNode(bone.vrm as any)) continue;

      const section = document.createElement('div');
      section.style.cssText = 'margin-bottom:8px';

      const title = document.createElement('div');
      title.style.cssText = 'font-size:10px;opacity:.45;margin-bottom:3px;font-weight:600';
      title.textContent = bone.label;
      section.appendChild(title);

      for (const ax of bone.axes) {
        const sliderId = `bone-${bone.vrm}-${ax.axis}`;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px';
        row.innerHTML = `
          <span style="font-size:10px;opacity:.55;width:58px;flex-shrink:0">${ax.label}</span>
          <input type="range" id="${sliderId}" min="${ax.min}" max="${ax.max}" step="1" value="0"
                 style="flex:1;accent-color:#3b5bdb;height:3px">
          <span id="${sliderId}-val" style="font-size:10px;font-family:ui-monospace,monospace;opacity:.6;width:28px;text-align:right">0°</span>`;
        section.appendChild(row);

        const slider = row.querySelector<HTMLInputElement>('input')!;
        const valEl  = row.querySelector<HTMLElement>(`#${sliderId}-val`)!;
        slider.addEventListener('input', () => {
          const v = parseFloat(slider.value);
          valEl.textContent = `${v}°`;
          this._offsets.get(bone.vrm)![ax.axis] = v;
        });
      }

      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px;background:rgba(255,255,255,.06);margin:6px 0 4px';
      section.appendChild(divider);
      container.appendChild(section);
    }
  }
}

const BTN_STYLE = 'font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;border:none;cursor:pointer;color:#fff;letter-spacing:.04em;';
