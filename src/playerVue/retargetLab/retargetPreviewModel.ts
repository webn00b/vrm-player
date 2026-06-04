import * as THREE from 'three';
import type { SkeletonJointMeta } from '../../retargetLabModel';
import type { QuaternionCorrection } from '../../retargetCorrections';

export interface PreviewNode {
  id: string;
  name: string;
  x: number;
  y: number;
  active: boolean;
  missing: boolean;
}

export interface PreviewLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  active: boolean;
}

export interface SkeletonPreview {
  nodes: PreviewNode[];
  lines: PreviewLine[];
}

export function buildSkeletonPreview(
  joints: SkeletonJointMeta[],
  activeNames: Set<string>,
  missingNames: Set<string> = new Set(),
): SkeletonPreview {
  if (joints.length === 0) return { nodes: [], lines: [] };

  const xs = joints.map((joint) => joint.position[0]);
  const ys = joints.map((joint) => joint.position[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.001);
  const spanY = Math.max(maxY - minY, 0.001);
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  const toPoint = (joint: SkeletonJointMeta) => ({
    x: 10 + ((joint.position[0] - minX) / spanX) * 80,
    y: 90 - ((joint.position[1] - minY) / spanY) * 80,
  });
  const nodes = joints.map((joint) => {
    const point = toPoint(joint);
    return {
      id: joint.id,
      name: joint.name,
      x: point.x,
      y: point.y,
      active: activeNames.has(joint.name),
      missing: missingNames.has(joint.name),
    };
  });
  const lines = joints.flatMap((joint) => {
    if (!joint.parentId) return [];
    const parent = byId.get(joint.parentId);
    if (!parent) return [];
    const a = toPoint(parent);
    const b = toPoint(joint);
    return [{
      id: `${joint.parentId}-${joint.id}`,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      active: activeNames.has(joint.name) && activeNames.has(parent.name),
    }];
  });
  return { nodes, lines };
}

export function buildCorrectedTargetJoints(
  joints: SkeletonJointMeta[],
  corrections: QuaternionCorrection[],
): SkeletonJointMeta[] {
  if (joints.length === 0) return [];
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  const children = new Map<string, SkeletonJointMeta[]>();
  const roots: SkeletonJointMeta[] = [];
  for (const joint of joints) {
    if (!joint.parentId || !byId.has(joint.parentId)) {
      roots.push(joint);
      continue;
    }
    const list = children.get(joint.parentId) ?? [];
    list.push(joint);
    children.set(joint.parentId, list);
  }

  const correctionByBone = new Map<string, THREE.Quaternion>();
  for (const correction of corrections) {
    if (!correction.enabled) continue;
    correctionByBone.set(
      correction.bone,
      new THREE.Quaternion(correction.q[0], correction.q[1], correction.q[2], correction.q[3]).normalize(),
    );
  }

  const corrected = new Map<string, SkeletonJointMeta>();
  const visit = (joint: SkeletonJointMeta, parentPos: THREE.Vector3 | null, parentRot: THREE.Quaternion): void => {
    const originalPos = new THREE.Vector3(...joint.position);
    const originalParent = joint.parentId ? byId.get(joint.parentId) ?? null : null;
    const localOffset = originalParent
      ? originalPos.clone().sub(new THREE.Vector3(...originalParent.position))
      : originalPos.clone();
    const pos = parentPos
      ? parentPos.clone().add(localOffset.applyQuaternion(parentRot))
      : originalPos.clone();
    const ownRot = parentRot.clone();
    const correction = correctionByBone.get(joint.name);
    if (correction) ownRot.multiply(correction);
    corrected.set(joint.id, {
      ...joint,
      position: [pos.x, pos.y, pos.z],
    });
    for (const child of children.get(joint.id) ?? []) visit(child, pos, ownRot);
  };

  for (const root of roots) visit(root, null, new THREE.Quaternion());
  return joints.map((joint) => corrected.get(joint.id) ?? joint);
}
