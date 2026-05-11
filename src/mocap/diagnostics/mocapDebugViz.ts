import * as THREE from 'three';
import type { PoseFrame } from '../pipeline/poseDetector';
import type { MocapDebugTargets } from './mocapDiagnostics';

// Body connections to draw lines between joints
const CONNECTIONS: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24],       // torso box
  [11, 13], [13, 15],                             // left arm
  [12, 14], [14, 16],                             // right arm
  [23, 25], [25, 27],                             // left leg
  [24, 26], [26, 28],                             // right leg
];

// Key landmark indices + labels for stats readout
export const STAT_LANDMARKS: { idx: number; label: string }[] = [
  { idx:  0, label: 'Nose'       },
  { idx:  2, label: 'L.Eye'      },
  { idx:  5, label: 'R.Eye'      },
  { idx:  7, label: 'L.Ear'      },
  { idx:  8, label: 'R.Ear'      },
  { idx: 10, label: 'Mouth'      },
  { idx: 11, label: 'L.Shoulder' },
  { idx: 12, label: 'R.Shoulder' },
  { idx: 13, label: 'L.Elbow'    },
  { idx: 14, label: 'R.Elbow'    },
  { idx: 15, label: 'L.Wrist'    },
  { idx: 16, label: 'R.Wrist'    },
  { idx: 19, label: 'L.Index'    },
  { idx: 20, label: 'R.Index'    },
  { idx: 23, label: 'L.Hip'      },
  { idx: 24, label: 'R.Hip'      },
  { idx: 25, label: 'L.Knee'     },
  { idx: 26, label: 'R.Knee'     },
  { idx: 27, label: 'L.Ankle'    },
  { idx: 28, label: 'R.Ankle'    },
  { idx: 31, label: 'L.Toe'      },
  { idx: 32, label: 'R.Toe'      },
];

type IkTargets = Pick<
  MocapDebugTargets,
  'leftWristTarget' | 'rightWristTarget' | 'leftAnkleTarget' | 'rightAnkleTarget' | 'hasArm' | 'hasLeg'
>;

type ActualBones = {
  leftHand:  THREE.Vector3;
  rightHand: THREE.Vector3;
  leftFoot:  THREE.Vector3;
  rightFoot: THREE.Vector3;
};

export class MocapDebugViz {
  private _group   = new THREE.Group();
  private _dots:   THREE.Mesh[]   = [];
  private _lines:  THREE.Line[]   = [];
  private _mirror  = true;

  // Scratch vectors reused every frame to avoid GC pressure in the render loop.
  private _tmp  = new THREE.Vector3();
  private _tmpA = new THREE.Vector3();

  // IK targets (blue) and actual avatar bone endpoints (orange)
  private _ikTargetDots:   THREE.Mesh[] = [];  // 4: L/R wrist, L/R ankle
  private _actualBoneDots: THREE.Mesh[] = [];  // 4: L/R hand, L/R foot

  constructor(scene: THREE.Scene) {
    scene.add(this._group);
    this._group.visible = false;

    // Green landmark dots
    const dotGeo = new THREE.SphereGeometry(0.012, 6, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, depthTest: false });
    for (let i = 0; i < 33; i++) {
      const m = new THREE.Mesh(dotGeo, dotMat);
      this._dots.push(m);
      this._group.add(m);
    }

    // Green skeleton lines
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00ff88, opacity: 0.5, transparent: true, depthTest: false,
    });
    for (const _ of CONNECTIONS) {
      const geo  = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, lineMat);
      this._lines.push(line);
      this._group.add(line);
    }

    // Blue IK target markers (larger)
    const ikGeo = new THREE.SphereGeometry(0.025, 8, 8);
    const ikMat = new THREE.MeshBasicMaterial({ color: 0x2288ff, depthTest: false });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(ikGeo, ikMat);
      m.visible = false;
      this._ikTargetDots.push(m);
      this._group.add(m);
    }

    // Orange actual-bone markers (larger)
    const boneGeo = new THREE.SphereGeometry(0.02, 8, 8);
    const boneMat = new THREE.MeshBasicMaterial({ color: 0xff8800, depthTest: false });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(boneGeo, boneMat);
      m.visible = false;
      this._actualBoneDots.push(m);
      this._group.add(m);
    }
  }

  get visible(): boolean { return this._group.visible; }
  setVisible(v: boolean): void { this._group.visible = v; }

  /**
   * Update positions from a PoseFrame.
   * Blue spheres = IK targets (where solver aims).
   * Orange spheres = actual avatar bone endpoints after IK.
   * Green dots/lines = raw performer landmarks in avatar space, scaled
   *   hierarchically: each limb uses its own scale (body / arm L / arm R
   *   / leg L / leg R) so the viz matches the IK pipeline's proportions.
   */
  update(
    frame: PoseFrame,
    hipWorld: THREE.Vector3,
    bodyScale: number,
    hipsBaseRot: THREE.Quaternion,
    ikTargets?: IkTargets | null,
    actualBones?: ActualBones | null,
    perLimbScale?: { armL: number; armR: number; legL: number; legR: number } | null,
  ): void {
    const lms = frame.worldLandmarks;

    // Performer hip centre in MediaPipe space
    const lh = lms[23], rh = lms[24];
    const hipMpX = lh && rh ? (lh.x + rh.x) * 0.5 : 0;
    const hipMpY = lh && rh ? (lh.y + rh.y) * 0.5 : 0;
    const hipMpZ = lh && rh ? (lh.z + rh.z) * 0.5 : 0;

    const tmp  = this._tmp;
    const tmpA = this._tmpA;
    void hipsBaseRot;

    const armL = perLimbScale?.armL ?? bodyScale;
    const armR = perLimbScale?.armR ?? bodyScale;
    const legL = perLimbScale?.legL ?? bodyScale;
    const legR = perLimbScale?.legR ?? bodyScale;

    // Mirror mapping in vrm-player: character's LEFT ← performer's RIGHT
    // landmarks. Here we're NOT remapping the dot indices — we just want the
    // green viz to render performer limbs at the proportions the IK uses for
    // each side. So: performer LEFT landmarks (11/13/15…) get scaled by armR
    // (the scale that drives character's RIGHT arm), and vice versa.
    const scaleOf = (idx: number): number => {
      switch (idx) {
        case 13: case 15: case 17: case 19: case 21: return armR; // perf L limb → char R
        case 14: case 16: case 18: case 20: case 22: return armL; // perf R limb → char L
        case 25: case 27: case 29: case 31: return legR;                    // perf L leg → char R
        case 26: case 28: case 30: case 32: return legL;                    // perf R leg → char L
        default: return bodyScale; // torso, head, face, hips
      }
    };

    // Anchor points (in performer MP space) for each chain.
    // Arms branch from shoulders (11/12), legs from hips (23/24).
    // We place the anchor in avatar world via bodyScale, then extend the
    // sub-segments using the limb-specific scale.
    const anchorMpOf = (idx: number): [number, number, number] | null => {
      // Arms: anchor = same-side shoulder
      if ([13, 15, 17, 19, 21].includes(idx) && lms[11]) return [lms[11].x, lms[11].y, lms[11].z];
      if ([14, 16, 18, 20, 22].includes(idx) && lms[12]) return [lms[12].x, lms[12].y, lms[12].z];
      // Legs: anchor = same-side hip
      if ([25, 27, 29, 31].includes(idx) && lms[23]) return [lms[23].x, lms[23].y, lms[23].z];
      if ([26, 28, 30, 32].includes(idx) && lms[24]) return [lms[24].x, lms[24].y, lms[24].z];
      // Everything else anchors at hip center
      return [hipMpX, hipMpY, hipMpZ];
    };

    const computePos = (idx: number, out: THREE.Vector3): boolean => {
      const lm = lms[idx];
      if (!lm) return false;
      const anchorMp = anchorMpOf(idx)!;
      // Anchor position in avatar world = hipWorld + (anchor - hipCenter) * bodyScale
      const anchorX = hipWorld.x + (this._mirror ? -(anchorMp[0] - hipMpX) : (anchorMp[0] - hipMpX)) * bodyScale;
      const anchorY = hipWorld.y + (-(anchorMp[1] - hipMpY)) * bodyScale;
      const anchorZ = hipWorld.z + (-(anchorMp[2] - hipMpZ)) * bodyScale;
      // Sub-segment offset from the anchor uses the limb-specific scale.
      const scale = scaleOf(idx);
      const sx = this._mirror ? -(lm.x - anchorMp[0]) : (lm.x - anchorMp[0]);
      const sy = -(lm.y - anchorMp[1]);
      const sz = -(lm.z - anchorMp[2]);
      out.set(anchorX + sx * scale, anchorY + sy * scale, anchorZ + sz * scale);
      return true;
    };

    for (let i = 0; i < 33; i++) {
      const ok = computePos(i, tmp);
      this._dots[i].position.copy(tmp);
      this._dots[i].visible = ok;
    }

    for (let c = 0; c < CONNECTIONS.length; c++) {
      const [a, b] = CONNECTIONS[c];
      const aOk = computePos(a, tmpA);
      const bOk = computePos(b, tmp);
      this._lines[c].visible = aOk && bOk;
      if (aOk && bOk) {
        const pos = this._lines[c].geometry.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, tmpA.x, tmpA.y, tmpA.z);
        pos.setXYZ(1, tmp.x,  tmp.y,  tmp.z);
        pos.needsUpdate = true;
      }
    }

    // IK target spheres: [0]=leftWrist [1]=rightWrist [2]=leftAnkle [3]=rightAnkle
    if (ikTargets) {
      this._ikTargetDots[0].position.copy(ikTargets.leftWristTarget);
      this._ikTargetDots[1].position.copy(ikTargets.rightWristTarget);
      this._ikTargetDots[2].position.copy(ikTargets.leftAnkleTarget);
      this._ikTargetDots[3].position.copy(ikTargets.rightAnkleTarget);
      this._ikTargetDots[0].visible = this._ikTargetDots[1].visible = ikTargets.hasArm;
      this._ikTargetDots[2].visible = this._ikTargetDots[3].visible = ikTargets.hasLeg;
    } else {
      for (const d of this._ikTargetDots) d.visible = false;
    }

    // Actual avatar bone endpoint spheres: [0]=leftHand [1]=rightHand [2]=leftFoot [3]=rightFoot
    if (actualBones) {
      this._actualBoneDots[0].position.copy(actualBones.leftHand);
      this._actualBoneDots[1].position.copy(actualBones.rightHand);
      this._actualBoneDots[2].position.copy(actualBones.leftFoot);
      this._actualBoneDots[3].position.copy(actualBones.rightFoot);
      for (const d of this._actualBoneDots) d.visible = true;
    } else {
      for (const d of this._actualBoneDots) d.visible = false;
    }
  }

  dispose(): void {
    this._group.parent?.remove(this._group);
  }
}
