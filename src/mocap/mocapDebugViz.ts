import * as THREE from 'three';
import type { PoseFrame } from './poseDetector';

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
  { idx: 11, label: 'L.Shoulder' },
  { idx: 12, label: 'R.Shoulder' },
  { idx: 13, label: 'L.Elbow'    },
  { idx: 14, label: 'R.Elbow'    },
  { idx: 15, label: 'L.Wrist'    },
  { idx: 16, label: 'R.Wrist'    },
  { idx: 23, label: 'L.Hip'      },
  { idx: 24, label: 'R.Hip'      },
  { idx: 25, label: 'L.Knee'     },
  { idx: 26, label: 'R.Knee'     },
  { idx: 27, label: 'L.Ankle'    },
  { idx: 28, label: 'R.Ankle'    },
];

type IkTargets = {
  leftWristTarget:  THREE.Vector3;
  rightWristTarget: THREE.Vector3;
  leftAnkleTarget:  THREE.Vector3;
  rightAnkleTarget: THREE.Vector3;
  hasArm: boolean;
  hasLeg: boolean;
};

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
   * Green dots/lines = raw performer landmarks in avatar space.
   */
  update(
    frame: PoseFrame,
    hipWorld: THREE.Vector3,
    bodyScale: number,
    hipsBaseRot: THREE.Quaternion,
    ikTargets?: IkTargets | null,
    actualBones?: ActualBones | null,
  ): void {
    const lms = frame.worldLandmarks;

    // Performer hip centre in MediaPipe space
    const lh = lms[23], rh = lms[24];
    const hipMpX = lh && rh ? (lh.x + rh.x) * 0.5 : 0;
    const hipMpY = lh && rh ? (lh.y + rh.y) * 0.5 : 0;
    const hipMpZ = lh && rh ? (lh.z + rh.z) * 0.5 : 0;

    const tmp = new THREE.Vector3();

    const toVrm = (lm: { x: number; y: number; z: number } | undefined, out: THREE.Vector3): boolean => {
      if (!lm) return false;
      const dx = lm.x - hipMpX;
      const dy = lm.y - hipMpY;
      const dz = lm.z - hipMpZ;
      out.set(this._mirror ? -dx : dx, -dy, -dz)
         .applyQuaternion(hipsBaseRot)
         .multiplyScalar(bodyScale)
         .add(hipWorld);
      return true;
    };

    for (let i = 0; i < 33; i++) {
      const ok = toVrm(lms[i], tmp);
      this._dots[i].position.copy(tmp);
      this._dots[i].visible = ok;
    }

    for (let c = 0; c < CONNECTIONS.length; c++) {
      const [a, b] = CONNECTIONS[c];
      const aOk = toVrm(lms[a], tmp);
      const posA = tmp.clone();
      const bOk = toVrm(lms[b], tmp);
      this._lines[c].visible = aOk && bOk;
      if (aOk && bOk) {
        const pos = this._lines[c].geometry.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, posA.x, posA.y, posA.z);
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
