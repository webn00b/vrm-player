import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Object3D } from 'three';

// Body + limbs only — fingers/toes excluded (joints sit too close together for
// reliable picking and the gizmo would clutter the hand).
const DRAG_BONES: string[] = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

const HIT_RADIUS_DEFAULT = 0.045;
const HIT_RADIUS_FINE    = 0.022; // fingers/wrist/foot — closer joints
const FINE_BONES = new Set([
  'leftHand', 'rightHand', 'leftFoot', 'rightFoot',
  'leftLowerArm', 'rightLowerArm',
]);

interface HitSphere {
  bone:  string;
  mesh:  THREE.Mesh;
  /** The normalized bone we actually rotate. Cached for fast apply(). */
  node:  THREE.Object3D;
}
/**
 * Click-to-grab rotation gizmo for VRM humanoid bones.
 *
 * Per-bone Quaternion deltas are stored in `dragDeltas` and post-multiplied
 * onto each bone's normalized quaternion every frame in `apply()`. This sits
 * on top of mocap / BVH / bonePanel writes without fighting them — same
 * pattern as BonePosePanel.apply().
 */
export class BoneDragController {
  private vrm: VRM;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private orbit: OrbitControls;

  private hits: HitSphere[] = [];
  private dragDeltas = new Map<string, THREE.Quaternion>();

  private proxy = new THREE.Object3D();
  private gizmo: TransformControls;
  private gizmoHelper: Object3D;
  private raycaster = new THREE.Raycaster();
  private pointerNDC = new THREE.Vector2();

  private selectedBone: string | null = null;
  private _enabled = false;

  // Scratch
  private _v = new THREE.Vector3();

  // Bound listeners (so we can remove them in dispose)
  private _onPointerDown = (ev: PointerEvent): void => this.handlePointerDown(ev);
  private _onDraggingChanged = (ev: { value: unknown }): void => {
    const dragging = typeof ev.value === 'boolean' ? ev.value : false;
    this.orbit.enabled = !dragging;
  };

  constructor(
    vrm: VRM,
    scene: THREE.Scene,
    camera: THREE.Camera,
    domElement: HTMLElement,
    orbit: OrbitControls,
  ) {
    this.vrm = vrm;
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.orbit = orbit;

    // Build hit-sphere children attached to raw bones (so they ride the
    // visible rig). Visible:false keeps them invisible but still pickable.
    for (const name of DRAG_BONES) {
      const rawNode = vrm.humanoid.getRawBoneNode(name as VRMHumanBoneName);
      const normNode = vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
      if (!rawNode || !normNode) continue;
      const radius = FINE_BONES.has(name) ? HIT_RADIUS_FINE : HIT_RADIUS_DEFAULT;
      const geo = new THREE.SphereGeometry(radius, 12, 8);
      const mat = new THREE.MeshBasicMaterial({ visible: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.boneName = name;
      mesh.visible = false; // toggled with setEnabled
      rawNode.add(mesh);
      this.hits.push({ bone: name, mesh, node: normNode });
    }

    // Gizmo lives in the scene; attached to a proxy Object3D we move around.
    // TransformControls itself isn't an Object3D in three r170+ — its visual
    // representation is returned by getHelper(), which is what we add to scene.
    this.scene.add(this.proxy);
    this.gizmo = new TransformControls(camera, domElement);
    this.gizmo.setMode('rotate');
    this.gizmo.setSpace('local');
    this.gizmo.setSize(0.7);
    this.gizmo.enabled = false;
    this.gizmoHelper = this.gizmo.getHelper();
    this.gizmoHelper.visible = false;
    this.scene.add(this.gizmoHelper);

    // While the user is dragging a ring, suspend OrbitControls.
    this.gizmo.addEventListener('dragging-changed', this._onDraggingChanged);
    // Each gizmo nudge → store the proxy's quaternion as the delta for the
    // selected bone. Proxy was reset to identity on attach so this is the
    // *cumulative* drag relative to the snapshot, which is exactly what we
    // want: a delta to post-multiply onto whatever the live pose is.
    this.gizmo.addEventListener('objectChange', () => {
      if (!this.selectedBone) return;
      const slot = this.dragDeltas.get(this.selectedBone);
      if (slot) slot.copy(this.proxy.quaternion);
      else this.dragDeltas.set(this.selectedBone, this.proxy.quaternion.clone());
    });

    domElement.addEventListener('pointerdown', this._onPointerDown);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get enabled(): boolean { return this._enabled; }

  setEnabled(v: boolean): void {
    this._enabled = v;
    for (const h of this.hits) h.mesh.visible = false; // sphere mat is invisible anyway, but flag controls raycasting
    if (!v) {
      this.detachGizmo();
    }
  }

  resetAll(): void {
    // Snap previously-dragged bones back to identity (=T-pose for the
    // normalized rig). If mocap or BVH is active they overwrite on the next
    // tick — identity is harmless. If everything is silent, this is the only
    // thing that visibly undoes the drag, since apply() with an empty map is
    // a no-op and nothing else rewrites bone.quaternion.
    for (const name of this.dragDeltas.keys()) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
      node?.quaternion.identity();
    }
    this.dragDeltas.clear();
    this.detachGizmo();
  }

  /** Reposition the gizmo onto the currently selected bone (post-mocap). */
  update(): void {
    if (!this.selectedBone) return;
    const node = this.vrm.humanoid.getNormalizedBoneNode(this.selectedBone as VRMHumanBoneName);
    if (!node) return;
    node.getWorldPosition(this._v);
    this.proxy.position.copy(this._v);
    // updateMatrixWorld so the gizmo's helper meshes follow this frame
    this.proxy.updateMatrixWorld(true);
  }

  /** Post-multiply each stored delta onto its bone's normalized quaternion. */
  apply(): void {
    if (this.dragDeltas.size === 0) return;
    for (const [name, delta] of this.dragDeltas) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
      if (!node) continue;
      node.quaternion.multiply(delta);
    }
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.gizmo.removeEventListener('dragging-changed', this._onDraggingChanged);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.scene.remove(this.gizmoHelper);
    this.scene.remove(this.proxy);
    for (const h of this.hits) {
      h.mesh.parent?.remove(h.mesh);
      h.mesh.geometry.dispose();
      (h.mesh.material as THREE.Material).dispose();
    }
    this.hits = [];
    this.dragDeltas.clear();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private handlePointerDown(ev: PointerEvent): void {
    if (!this._enabled) return;
    if (ev.button !== 0) return; // left button only
    // Don't start a new selection if the gizmo is currently in a drag — its
    // own internal pointer handler will deal with it.
    if (this.gizmo.dragging) return;

    const rect = this.domElement.getBoundingClientRect();
    this.pointerNDC.x = ((ev.clientX - rect.left) / rect.width)  * 2 - 1;
    this.pointerNDC.y = -((ev.clientY - rect.top)  / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera as THREE.PerspectiveCamera);

    const meshes = this.hits.map((h) => h.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, false);
    if (intersects.length === 0) return;

    const hit = intersects[0].object;
    const boneName: string | undefined = hit.userData.boneName;
    if (!boneName) return;

    ev.stopPropagation();
    ev.preventDefault();
    this.selectBone(boneName);
  }

  private selectBone(name: string): void {
    this.selectedBone = name;
    const node = this.vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName);
    if (!node) return;
    // Place proxy at the bone's world position with identity rotation. The
    // gizmo writes into proxy.quaternion; we read that as the delta to
    // post-multiply onto the bone (so rings turn around bone-local axes
    // because we set space='local' and mocap will keep updating the bone
    // world frame each tick).
    node.getWorldPosition(this._v);
    this.proxy.position.copy(this._v);
    this.proxy.quaternion.identity();
    // Resume any prior delta for this bone so dragging continues from where
    // the user left off, instead of snapping back to identity.
    const prior = this.dragDeltas.get(name);
    if (prior) this.proxy.quaternion.copy(prior);
    this.proxy.updateMatrixWorld(true);

    this.gizmo.enabled = true;
    this.gizmo.attach(this.proxy);
    this.gizmoHelper.visible = true;
  }

  private detachGizmo(): void {
    this.selectedBone = null;
    this.gizmo.detach();
    this.gizmo.enabled = false;
    this.gizmoHelper.visible = false;
  }
}
