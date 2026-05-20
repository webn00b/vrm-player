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

const BODY_JOINT_NAMES = new Set<string>(BODY_CONNECTIONS.flat());
const FINGER_JOINT_NAMES = new Set<string>(FINGER_CONNECTIONS.flat());
const SKEL_LOG_PREFIX = '[skeleton-visualizer]';
const SKEL_LOG_INTERVAL_MS = 1000;

interface BoneLabel {
  name: string;
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
}

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
  private labels:      BoneLabel[] = [];

  private _showBody    = true;
  private _showFingers = true;
  private _showLabels  = false;
  private _visible     = false;
  private _lastUpdateLogMs = 0;
  private _updateCount = 0;

  // Scratch vectors
  private _pa = new THREE.Vector3();
  private _pb = new THREE.Vector3();

  constructor(vrm: VRM, scene: THREE.Scene) {
    this.vrm   = vrm;
    this.scene = scene;
    this._buildCache();
    console.info(SKEL_LOG_PREFIX, 'created', {
      cachedNodes: this.nodeCache.size,
      expectedNodes: ALL_JOINT_NAMES.length,
      missingNodes: ALL_JOINT_NAMES.filter((name) => !this.nodeCache.has(name)),
      bodyConnections: BODY_CONNECTIONS.length,
      fingerConnections: FINGER_CONNECTIONS.length,
    });

    const lineMat = (color: number) =>
      new THREE.LineBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.85,
      });

    const dotMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.018,
      sizeAttenuation: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });

    this.bodyLines   = this._makeLines(BODY_CONNECTIONS,   lineMat(0x00e5ff));  // cyan
    this.fingerLines = this._makeLines(FINGER_CONNECTIONS, lineMat(0xffee00));  // yellow
    this.dots        = this._makeDots(dotMat);
    this.labels      = this._makeLabels();
    this.bodyLines.renderOrder = 1000;
    this.fingerLines.renderOrder = 1001;
    this.dots.renderOrder = 1002;
    this.bodyLines.frustumCulled = false;
    this.fingerLines.frustumCulled = false;
    this.dots.frustumCulled = false;

    // Everything hidden by default
    this.bodyLines.visible   = false;
    this.fingerLines.visible = false;
    this.dots.visible        = false;
    for (const label of this.labels) label.sprite.visible = false;

    scene.add(this.bodyLines, this.fingerLines, this.dots, ...this.labels.map(l => l.sprite));
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get visible():     boolean { return this._visible; }
  get showBody():    boolean { return this._showBody; }
  get showFingers(): boolean { return this._showFingers; }
  get showLabels():  boolean { return this._showLabels; }

  setVisible(v: boolean): void {
    const prev = this._visible;
    this._visible = v;
    console.info(SKEL_LOG_PREFIX, 'setVisible', { prev, next: v });
    this._syncVisibility();
  }

  setShowBody(v: boolean): void {
    const prev = this._showBody;
    this._showBody = v;
    console.info(SKEL_LOG_PREFIX, 'setShowBody', { prev, next: v });
    this._syncVisibility();
  }

  setShowFingers(v: boolean): void {
    const prev = this._showFingers;
    this._showFingers = v;
    console.info(SKEL_LOG_PREFIX, 'setShowFingers', { prev, next: v });
    this._syncVisibility();
  }

  setShowLabels(v: boolean): void {
    const prev = this._showLabels;
    this._showLabels = v;
    console.info(SKEL_LOG_PREFIX, 'setShowLabels', { prev, next: v });
    this._syncVisibility();
  }

  /** Call every frame (after vrm.update) to sync positions. */
  update(): void {
    this._updateCount++;
    if (!this._visible) {
      this._maybeLogUpdate('skipped hidden');
      return;
    }
    const body = this._showBody
      ? this._updateLines(this.bodyLines, BODY_CONNECTIONS)
      : { valid: 0, missing: BODY_CONNECTIONS.length };
    const fingers = this._showFingers
      ? this._updateLines(this.fingerLines, FINGER_CONNECTIONS)
      : { valid: 0, missing: FINGER_CONNECTIONS.length };
    const dots = this._updateDots();
    if (this._showLabels) this._updateLabels();
    this._maybeLogUpdate('updated', { body, fingers, dots });
  }

  dispose(): void {
    console.info(SKEL_LOG_PREFIX, 'dispose', {
      updateCount: this._updateCount,
      cachedNodes: this.nodeCache.size,
    });
    this.scene.remove(this.bodyLines, this.fingerLines, this.dots, ...this.labels.map(l => l.sprite));
    this.bodyLines.geometry.dispose();
    this.fingerLines.geometry.dispose();
    this.dots.geometry.dispose();
    for (const label of this.labels) {
      label.texture.dispose();
      label.material.dispose();
    }
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

  private _makeLabels(): BoneLabel[] {
    return ALL_JOINT_NAMES.map((name) => {
      const { texture, aspect } = this._makeLabelTexture(name);
      const material = new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.renderOrder = 1000;
      sprite.scale.set(0.05 * aspect, 0.05, 1);
      return { name, sprite, texture, material };
    });
  }

  private _makeLabelTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
    const paddingX = 12;
    const paddingY = 7;
    const fontSize = 22;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.width = 1;
      canvas.height = 1;
      return { texture: new THREE.CanvasTexture(canvas), aspect: 1 };
    }

    ctx.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const metrics = ctx.measureText(text);
    const width = Math.ceil(metrics.width + paddingX * 2);
    const height = Math.ceil(fontSize + paddingY * 2);
    canvas.width = Math.max(64, width);
    canvas.height = height;

    ctx.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(5, 10, 14, 0.78)';
    this._roundRect(ctx, 0, 0, canvas.width, canvas.height, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(185, 251, 255, 0.55)';
    ctx.lineWidth = 2;
    this._roundRect(ctx, 1, 1, canvas.width - 2, canvas.height - 2, 7);
    ctx.stroke();
    ctx.fillStyle = '#f4fbff';
    ctx.fillText(text, paddingX, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return { texture, aspect: canvas.width / canvas.height };
  }

  private _roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  private _updateLines(
    ls: THREE.LineSegments,
    connections: [string, string][],
  ): { valid: number; missing: number } {
    const attr = ls.geometry.attributes.position as THREE.BufferAttribute;
    let i = 0;
    let valid = 0;
    let missing = 0;
    for (const [a, b] of connections) {
      const na = this._node(a);
      const nb = this._node(b);
      if (na && nb) {
        na.getWorldPosition(this._pa);
        nb.getWorldPosition(this._pb);
        attr.setXYZ(i,     this._pa.x, this._pa.y, this._pa.z);
        attr.setXYZ(i + 1, this._pb.x, this._pb.y, this._pb.z);
        valid++;
      } else {
        missing++;
      }
      i += 2;
    }
    attr.needsUpdate = true;
    return { valid, missing };
  }

  private _updateDots(): { valid: number; missing: number } {
    const attr = this.dots.geometry.attributes.position as THREE.BufferAttribute;
    let valid = 0;
    let missing = 0;
    ALL_JOINT_NAMES.forEach((name, i) => {
      const n = this._node(name);
      if (n) {
        n.getWorldPosition(this._pa);
        attr.setXYZ(i, this._pa.x, this._pa.y, this._pa.z);
        valid++;
      } else {
        missing++;
      }
    });
    attr.needsUpdate = true;
    return { valid, missing };
  }

  private _updateLabels(): void {
    for (const label of this.labels) {
      const n = this._node(label.name);
      if (!n) {
        label.sprite.visible = false;
        continue;
      }
      n.getWorldPosition(this._pa);
      label.sprite.position.set(this._pa.x, this._pa.y + 0.035, this._pa.z);
      label.sprite.visible = this._labelAllowed(label.name);
    }
  }

  private _labelAllowed(name: string): boolean {
    if (!this._visible || !this._showLabels) return false;
    const body = BODY_JOINT_NAMES.has(name);
    const fingers = FINGER_JOINT_NAMES.has(name);
    return (this._showBody && body) || (this._showFingers && fingers);
  }

  private _syncVisibility(): void {
    this.bodyLines.visible   = this._visible && this._showBody;
    this.fingerLines.visible = this._visible && this._showFingers;
    this.dots.visible        = this._visible;
    for (const label of this.labels) {
      label.sprite.visible = this._labelAllowed(label.name);
    }
    console.info(SKEL_LOG_PREFIX, 'syncVisibility', {
      visible: this._visible,
      showBody: this._showBody,
      showFingers: this._showFingers,
      showLabels: this._showLabels,
      bodyLinesVisible: this.bodyLines.visible,
      fingerLinesVisible: this.fingerLines.visible,
      dotsVisible: this.dots.visible,
      labelVisibleCount: this.labels.filter((label) => label.sprite.visible).length,
      sceneAttached: !!this.bodyLines.parent && !!this.fingerLines.parent && !!this.dots.parent,
    });
  }

  private _maybeLogUpdate(
    reason: string,
    stats?: {
      body: { valid: number; missing: number };
      fingers: { valid: number; missing: number };
      dots: { valid: number; missing: number };
    },
  ): void {
    const now = performance.now();
    if (now - this._lastUpdateLogMs < SKEL_LOG_INTERVAL_MS) return;
    this._lastUpdateLogMs = now;
    const hips = this._node('hips');
    const head = this._node('head');
    const sample: Record<string, [number, number, number] | null> = {};
    for (const [name, node] of [['hips', hips], ['head', head]] as const) {
      if (!node) {
        sample[name] = null;
        continue;
      }
      node.getWorldPosition(this._pa);
      sample[name] = [
        Number(this._pa.x.toFixed(3)),
        Number(this._pa.y.toFixed(3)),
        Number(this._pa.z.toFixed(3)),
      ];
    }
    console.info(SKEL_LOG_PREFIX, reason, {
      updateCount: this._updateCount,
      visible: this._visible,
      showBody: this._showBody,
      showFingers: this._showFingers,
      bodyLinesVisible: this.bodyLines.visible,
      fingerLinesVisible: this.fingerLines.visible,
      dotsVisible: this.dots.visible,
      cachedNodes: this.nodeCache.size,
      sample,
      stats,
    });
  }
}
