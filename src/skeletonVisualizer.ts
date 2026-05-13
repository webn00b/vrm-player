import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

// ── Humanoid bone connections ─────────────────────────────────────────────────
// Each pair [parent, child] draws one line segment.

const BODY_CONNECTIONS: [string, string][] = [
  // Spine
  ['hips',         'spine'],
  ['spine',        'chest'],
  ['chest',        'neck'],
  ['neck',         'head'],
  // Left arm
  ['chest',        'leftShoulder'],
  ['leftShoulder', 'leftUpperArm'],
  ['leftUpperArm', 'leftLowerArm'],
  ['leftLowerArm', 'leftHand'],
  // Right arm
  ['chest',         'rightShoulder'],
  ['rightShoulder', 'rightUpperArm'],
  ['rightUpperArm', 'rightLowerArm'],
  ['rightLowerArm', 'rightHand'],
  // Left leg
  ['hips',         'leftUpperLeg'],
  ['leftUpperLeg', 'leftLowerLeg'],
  ['leftLowerLeg', 'leftFoot'],
  ['leftFoot',     'leftToes'],
  // Right leg
  ['hips',          'rightUpperLeg'],
  ['rightUpperLeg', 'rightLowerLeg'],
  ['rightLowerLeg', 'rightFoot'],
  ['rightFoot',     'rightToes'],
];

const FINGER_CONNECTIONS: [string, string][] = (() => {
  const pairs: [string, string][] = [];
  for (const side of ['left', 'right'] as const) {
    const S = side;
    // Thumb
    pairs.push(
      [`${S}Hand`,             `${S}ThumbMetacarpal`],
      [`${S}ThumbMetacarpal`,  `${S}ThumbProximal`],
      [`${S}ThumbProximal`,    `${S}ThumbDistal`],
    );
    // Four fingers
    for (const finger of ['Index', 'Middle', 'Ring', 'Little'] as const) {
      pairs.push(
        [`${S}Hand`,                    `${S}${finger}Proximal`],
        [`${S}${finger}Proximal`,       `${S}${finger}Intermediate`],
        [`${S}${finger}Intermediate`,   `${S}${finger}Distal`],
      );
    }
  }
  return pairs;
})();

// Deduplicated list of all joint names used for the dot cloud
const ALL_JOINT_NAMES: string[] = (() => {
  const s = new Set<string>();
  for (const [a, b] of [...BODY_CONNECTIONS, ...FINGER_CONNECTIONS]) {
    s.add(a); s.add(b);
  }
  return [...s];
})();

// ── SkeletonVisualizer ────────────────────────────────────────────────────────

/**
 * Draws the VRM humanoid skeleton as coloured line segments + joint dots.
 *
 * Two layers (each independently togglable):
 *   body    – spine, arms, legs (~20 segments, bright cyan)
 *   fingers – all finger joints (~28 segments, yellow)
 *
 * Uses depthTest:false so the overlay is always visible even inside the mesh.
 */
export class SkeletonVisualizer {
  private scene:    THREE.Scene;
  private vrm:      VRM;
  private nodeCache = new Map<string, THREE.Object3D>();

  private bodyLines:   THREE.LineSegments;
  private fingerLines: THREE.LineSegments;
  private dots:        THREE.Points;

  private _showBody    = true;
  private _showFingers = true;
  private _visible     = false;

  // Scratch vectors
  private _pa = new THREE.Vector3();
  private _pb = new THREE.Vector3();

  constructor(vrm: VRM, scene: THREE.Scene) {
    this.vrm   = vrm;
    this.scene = scene;
    this._buildCache();

    const lineMat = (color: number) =>
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 });

    const dotMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.018,
      sizeAttenuation: true,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });

    this.bodyLines   = this._makeLines(BODY_CONNECTIONS,   lineMat(0x00e5ff));  // cyan
    this.fingerLines = this._makeLines(FINGER_CONNECTIONS, lineMat(0xffee00));  // yellow
    this.dots        = this._makeDots(dotMat);

    // Everything hidden by default
    this.bodyLines.visible   = false;
    this.fingerLines.visible = false;
    this.dots.visible        = false;

    scene.add(this.bodyLines, this.fingerLines, this.dots);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get visible():     boolean { return this._visible; }
  get showBody():    boolean { return this._showBody; }
  get showFingers(): boolean { return this._showFingers; }

  setVisible(v: boolean): void {
    this._visible = v;
    this._syncVisibility();
  }

  setShowBody(v: boolean): void {
    this._showBody = v;
    this._syncVisibility();
  }

  setShowFingers(v: boolean): void {
    this._showFingers = v;
    this._syncVisibility();
  }

  /** Call every frame (after vrm.update) to sync positions. */
  update(): void {
    if (!this._visible) return;
    if (this._showBody)    this._updateLines(this.bodyLines,   BODY_CONNECTIONS);
    if (this._showFingers) this._updateLines(this.fingerLines, FINGER_CONNECTIONS);
    this._updateDots();
  }

  dispose(): void {
    this.scene.remove(this.bodyLines, this.fingerLines, this.dots);
    this.bodyLines.geometry.dispose();
    this.fingerLines.geometry.dispose();
    this.dots.geometry.dispose();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _buildCache(): void {
    const getRaw = (name: string): THREE.Object3D | null =>
      this.vrm.humanoid.getRawBoneNode(name as VRMHumanBoneName);
    const getNorm = (name: string): THREE.Object3D | null =>
      this.vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
    for (const name of ALL_JOINT_NAMES) {
      // getRawBoneNode returns the actual Three.js bone that the mesh is skinned to,
      // so world positions match what's visually rendered.
      // getNormalizedBoneNode is a virtual T-pose wrapper used for driving animation —
      // its world position can diverge from the mesh in A-pose or custom rest-pose models.
      const node = getRaw(name) ?? getNorm(name);
      if (node) this.nodeCache.set(name, node);
    }
  }

  private _node(name: string): THREE.Object3D | null {
    return this.nodeCache.get(name) ?? null;
  }

  private _makeLines(connections: [string, string][], mat: THREE.LineBasicMaterial): THREE.LineSegments {
    const positions = new Float32Array(connections.length * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, connections.length * 2);
    return new THREE.LineSegments(geo, mat);
  }

  private _makeDots(mat: THREE.PointsMaterial): THREE.Points {
    const positions = new Float32Array(ALL_JOINT_NAMES.length * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(geo, mat);
  }

  private _updateLines(ls: THREE.LineSegments, connections: [string, string][]): void {
    const attr = ls.geometry.attributes.position as THREE.BufferAttribute;
    let i = 0;
    for (const [a, b] of connections) {
      const na = this._node(a);
      const nb = this._node(b);
      if (na && nb) {
        na.getWorldPosition(this._pa);
        nb.getWorldPosition(this._pb);
        attr.setXYZ(i,     this._pa.x, this._pa.y, this._pa.z);
        attr.setXYZ(i + 1, this._pb.x, this._pb.y, this._pb.z);
      }
      i += 2;
    }
    attr.needsUpdate = true;
  }

  private _updateDots(): void {
    const attr = this.dots.geometry.attributes.position as THREE.BufferAttribute;
    ALL_JOINT_NAMES.forEach((name, i) => {
      const n = this._node(name);
      if (n) {
        n.getWorldPosition(this._pa);
        attr.setXYZ(i, this._pa.x, this._pa.y, this._pa.z);
      }
    });
    attr.needsUpdate = true;
  }

  private _syncVisibility(): void {
    this.bodyLines.visible   = this._visible && this._showBody;
    this.fingerLines.visible = this._visible && this._showFingers;
    this.dots.visible        = this._visible;
  }
}
