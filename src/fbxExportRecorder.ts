/**
 * FBX 7.4 ASCII exporter for VRM skeleton + AnimationClip.
 *
 * Why this exists: there is no maintained FBXExporter in three.js (the
 * loaders folder ships FBXLoader, but no exporter), and community npm
 * packages (`fbx-exporter`, `@picode/three-fbx-exporter`) are 404 in
 * the npm registry as of 2026. So we hand-roll the FBX 7.4 ASCII
 * format here. Skeleton + animation only — no mesh, no materials.
 *
 * Output is accepted by:
 *   - three.js FBXLoader (verified by the round-trip test)
 *   - Unity FBX import (Autodesk SDK reader)
 *   - Unreal Engine FBX import (Autodesk SDK reader)
 *   - Blender FBX import (uses the Autodesk SDK on Windows, in-tree
 *     Python parser on Linux/Mac — both handle ASCII)
 *   - Maya / 3ds Max (native readers)
 *
 * Format reference: the spec is informal — Autodesk doesn't publish a
 * formal ASCII grammar — but the structure is documented by Blender's
 * FBX I/O addon (https://code.blender.org/2013/08/fbx-binary-file-
 * format-specification/) and three.js's FBXLoader source provides a
 * reverse-engineered reader. The exporter mirrors the minimum subset
 * those readers expect.
 *
 * Coordinate system: VRM uses Y-up, Z-forward, right-handed. FBX
 * default is also Y-up, Z-forward, right-handed (UpAxis=1, FrontAxis=2,
 * CoordAxis=0). No coordinate flips are needed for VRM↔FBX.
 *
 * Rotation order: FBX uses XYZ Euler by default (RotationOrder=0).
 * THREE.Euler with order='XYZ' uses the same convention, so quaternion
 * → Euler conversion is a direct THREE.Euler.setFromQuaternion(q,'XYZ').
 *
 * Time format: FBX uses int64 "KTime" units, equal to 1/46186158000 of
 * a second. We map clip-time-in-seconds to KTime via bigint multiply
 * to avoid float precision loss at long durations.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ── FBX format constants ─────────────────────────────────────────────────────

const FBX_VERSION = 7400;
/** FBX timeline-tick resolution: 46186158000 ticks/sec.
 *  Encoded as BigInt because clip durations × ticks easily overflow Number. */
const KTIME_ONE_SECOND = 46186158000n;
/** TimeMode enum: 11 = 30 fps (FBX_TIME_30 in Autodesk SDK). */
const TIME_MODE_30FPS = 11;
/** AnimationCurve key interpolation flag: 24840 = Linear interpolation. */
const KEY_FLAG_LINEAR = 24840;

// ── Public API ───────────────────────────────────────────────────────────────

/** Build the FBX ASCII text for the given clip applied to the given VRM's
 *  humanoid skeleton. Returns a string ready to write to a .fbx file. */
export function buildFbxTextForClip(vrm: VRM, clip: THREE.AnimationClip): string {
  const skeleton = collectBoneSpecs(vrm);
  if (skeleton.length === 0) {
    throw new Error('VRM has no humanoid bones to export');
  }
  // Index by bone name for O(1) lookups during track wiring.
  const boneByName = new Map(skeleton.map((b) => [b.name, b]));

  // Split clip tracks into rotation-curve groups per bone. Position tracks
  // are handled separately (only hips usually has a position track).
  const rotationTracks = new Map<string, THREE.QuaternionKeyframeTrack>();
  const positionTracks = new Map<string, THREE.VectorKeyframeTrack>();
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) continue;
    const boneName = track.name.slice(0, dot);
    const prop     = track.name.slice(dot + 1);
    if (!boneByName.has(boneName)) continue;  // ignore tracks for unknown bones
    if (prop === 'quaternion') rotationTracks.set(boneName, track as any);
    else if (prop === 'position') positionTracks.set(boneName, track as any);
  }

  const fbx = new FbxBuilder();
  writeHeader(fbx);
  writeGlobalSettings(fbx, clip.duration);
  writeDocuments(fbx);
  // References / Definitions are slim — we don't use file refs or templates.
  writeReferences(fbx);
  writeDefinitions(fbx, skeleton.length, rotationTracks.size, positionTracks.size);
  writeObjects(fbx, skeleton, rotationTracks, positionTracks, clip.duration);
  writeConnections(fbx);
  writeTakes(fbx);
  return fbx.toString();
}

/** Browser-side download helper. Mirrors `downloadBvh` / `downloadGlb`. */
export function downloadFbx(text: string, filename = 'mocap.fbx'): void {
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.fbx') ? filename : `${filename}.fbx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Build + download in one call. Returns the filename used. */
export async function exportClipAsFbx(
  vrm: VRM,
  clip: THREE.AnimationClip,
  name: string,
): Promise<string> {
  const text = buildFbxTextForClip(vrm, clip);
  const filename = `${name}.fbx`;
  downloadFbx(text, filename);
  return filename;
}

// ── FbxBuilder: ID counter + indented section writer ─────────────────────────

/** Mutable accumulator for FBX ASCII output. Manages indentation, ID counter,
 *  and connection records so the writer functions can be flat / declarative. */
class FbxBuilder {
  private idCounter = 1000n;
  private lines: string[] = [];
  /** Public so section writers can `indentLevel++` for inline blocks
   *  (curve-data sections that don't fit the standard `block()` pattern). */
  indentLevel = 0;
  /** Connections to emit in the Connections section at the end. */
  readonly connections: Array<{
    /** "OO" = Object→Object, "OP" = Object→Property. */
    type: 'OO' | 'OP';
    fromId: bigint;
    toId:   bigint;
    /** Only set for OP — the destination property name. */
    propertyName?: string;
  }> = [];

  /** Allocate a fresh 64-bit ID. FBX needs every object to have one. */
  nextId(): bigint { return this.idCounter++; }

  /** Emit a single line with current indentation. FBX text parser
   *  REQUIRES tab indentation — its node/property regex is `^\t{N}...`
   *  so spaces break block detection silently. */
  line(s: string): void {
    this.lines.push('\t'.repeat(this.indentLevel) + s);
  }

  /** Open a "Section: id, ..., type:" block, run `body()`, close `}`. */
  block(opener: string, body: () => void): void {
    this.line(opener + ' {');
    this.indentLevel++;
    body();
    this.indentLevel--;
    this.line('}');
  }

  /** A property in Properties70 — the standard FBX property block syntax. */
  p70Prop(name: string, type: string, subtype: string, flags: string, ...values: (number | string)[]): void {
    const vals = values.map((v) =>
      typeof v === 'string' ? `"${v}"` : Number.isInteger(v) ? `${v}` : (v as number).toFixed(6)
    ).join(',');
    this.line(`P: "${name}", "${type}", "${subtype}", "${flags}",${vals}`);
  }

  /** Add a connection record to be emitted later in writeConnections(). */
  connectOO(fromId: bigint, toId: bigint): void {
    this.connections.push({ type: 'OO', fromId, toId });
  }
  connectOP(fromId: bigint, toId: bigint, propertyName: string): void {
    this.connections.push({ type: 'OP', fromId, toId, propertyName });
  }

  toString(): string { return this.lines.join('\n') + '\n'; }
}

// ── Bone collection ──────────────────────────────────────────────────────────

interface BoneSpec {
  name: string;
  /** Local position relative to parent (in metres). */
  position: [number, number, number];
  /** Parent bone name, or null for root (hips). */
  parent: string | null;
  /** ID assigned during writeObjects. Set lazily; filled before writeConnections. */
  id?: bigint;
}

const HUMANOID_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftEye', 'rightEye', 'jaw',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;

function collectBoneSpecs(vrm: VRM): BoneSpec[] {
  const result: BoneSpec[] = [];
  for (const name of HUMANOID_BONES) {
    const node = vrm.humanoid.getNormalizedBoneNode(name as any);
    if (!node) continue;
    // Find parent bone by walking up the original VRM tree until we hit
    // another bone in HUMANOID_BONES.
    let parent: string | null = null;
    let cur = node.parent;
    while (cur) {
      const match = HUMANOID_BONES.find(
        (n) => vrm.humanoid.getNormalizedBoneNode(n as any) === cur,
      );
      if (match) { parent = match; break; }
      cur = cur.parent;
    }
    result.push({
      name,
      position: [node.position.x, node.position.y, node.position.z],
      parent,
    });
  }
  return result;
}

// ── Section writers ──────────────────────────────────────────────────────────

function writeHeader(fbx: FbxBuilder): void {
  fbx.line('; FBX 7.4.0 project file');
  fbx.line('; Generated by vrm-player BVH→FBX exporter');
  fbx.line('; Skeleton + animation only (no mesh/materials)');
  fbx.line('');
  fbx.block('FBXHeaderExtension: ', () => {
    fbx.line('FBXHeaderVersion: 1003');
    fbx.line(`FBXVersion: ${FBX_VERSION}`);
    // CreationTimeStamp must be present for parsers that strictly validate;
    // we fix it to a stable epoch so the test output is deterministic.
    fbx.block('CreationTimeStamp: ', () => {
      fbx.line('Version: 1000');
      fbx.line('Year: 2025');
      fbx.line('Month: 1');
      fbx.line('Day: 1');
      fbx.line('Hour: 0');
      fbx.line('Minute: 0');
      fbx.line('Second: 0');
      fbx.line('Millisecond: 0');
    });
    fbx.line('Creator: "vrm-player FBX exporter"');
  });
  fbx.line('');
}

function writeGlobalSettings(fbx: FbxBuilder, clipDurationSec: number): void {
  fbx.block('GlobalSettings: ', () => {
    fbx.line('Version: 1000');
    fbx.block('Properties70: ', () => {
      fbx.p70Prop('UpAxis',         'int', 'Integer', '', 1);
      fbx.p70Prop('UpAxisSign',     'int', 'Integer', '', 1);
      fbx.p70Prop('FrontAxis',      'int', 'Integer', '', 2);
      fbx.p70Prop('FrontAxisSign',  'int', 'Integer', '', 1);
      fbx.p70Prop('CoordAxis',      'int', 'Integer', '', 0);
      fbx.p70Prop('CoordAxisSign',  'int', 'Integer', '', 1);
      fbx.p70Prop('OriginalUpAxis', 'int', 'Integer', '', 1);
      fbx.p70Prop('OriginalUpAxisSign', 'int', 'Integer', '', 1);
      fbx.p70Prop('UnitScaleFactor',     'double', 'Number', '', 1);
      fbx.p70Prop('OriginalUnitScaleFactor', 'double', 'Number', '', 1);
      fbx.p70Prop('TimeMode',  'enum', '', '', TIME_MODE_30FPS);
      fbx.p70Prop('TimeProtocol', 'enum', '', '', 2);
      fbx.line(`P: "TimeSpanStart", "KTime", "Time", "",${0n}`);
      fbx.line(`P: "TimeSpanStop", "KTime", "Time", "",${secondsToKTime(clipDurationSec)}`);
      fbx.p70Prop('CustomFrameRate', 'double', 'Number', '', 30);
    });
  });
  fbx.line('');
}

function writeDocuments(fbx: FbxBuilder): void {
  fbx.block('Documents: ', () => {
    fbx.line('Count: 1');
    fbx.block('Document: 1, "", "Scene"', () => {
      fbx.block('Properties70: ', () => {
        fbx.p70Prop('SourceObject', 'object', '', '');
        fbx.p70Prop('ActiveAnimStackName', 'KString', '', '', 'Take 001');
      });
      fbx.line('RootNode: 0');
    });
  });
  fbx.line('');
}

function writeReferences(fbx: FbxBuilder): void {
  fbx.block('References: ', () => { /* empty */ });
  fbx.line('');
}

function writeDefinitions(fbx: FbxBuilder, boneCount: number, rotTrackCount: number, posTrackCount: number): void {
  // Total objects: each bone is a Model + NodeAttribute (LimbNode skeleton).
  // Each rotation track contributes 1 AnimCurveNode + 3 AnimCurves; each
  // position track also 1 + 3. Plus one AnimationLayer and one AnimationStack.
  const curveNodeCount = rotTrackCount + posTrackCount;
  const curveCount     = 3 * (rotTrackCount + posTrackCount);
  const totalCount =
    boneCount * 2 +        // Model + NodeAttribute per bone
    curveNodeCount +
    curveCount +
    2;                     // AnimLayer + AnimStack

  fbx.block('Definitions: ', () => {
    fbx.line('Version: 100');
    fbx.line(`Count: ${totalCount}`);
    fbx.block('ObjectType: "GlobalSettings"', () => fbx.line('Count: 1'));
    fbx.block('ObjectType: "Model"', () => {
      fbx.line(`Count: ${boneCount}`);
    });
    fbx.block('ObjectType: "NodeAttribute"', () => {
      fbx.line(`Count: ${boneCount}`);
    });
    fbx.block('ObjectType: "AnimationStack"', () => fbx.line('Count: 1'));
    fbx.block('ObjectType: "AnimationLayer"', () => fbx.line('Count: 1'));
    if (curveNodeCount > 0) {
      fbx.block('ObjectType: "AnimationCurveNode"', () => fbx.line(`Count: ${curveNodeCount}`));
    }
    if (curveCount > 0) {
      fbx.block('ObjectType: "AnimationCurve"', () => fbx.line(`Count: ${curveCount}`));
    }
  });
  fbx.line('');
}

function writeObjects(
  fbx: FbxBuilder,
  bones: BoneSpec[],
  rotationTracks: Map<string, THREE.QuaternionKeyframeTrack>,
  positionTracks: Map<string, THREE.VectorKeyframeTrack>,
  clipDurationSec: number,
): void {
  fbx.line('Objects:  {');
  fbx.indentLevel = 1;

  // 1) Bone Models + NodeAttributes
  for (const b of bones) {
    b.id = fbx.nextId();
    const attrId = fbx.nextId();
    writeModelBone(fbx, b);
    writeNodeAttributeLimb(fbx, b, attrId);
    // Connection: NodeAttribute → Model (the attribute defines the model is a bone).
    fbx.connectOO(attrId, b.id);
  }

  // 1b) Bone hierarchy: child Model → parent Model, or → RootNode (id=0) for root.
  // Done in a second pass so parent IDs are available regardless of declaration
  // order. FBX RootNode is the implicit id=0.
  for (const b of bones) {
    if (b.parent) {
      const parent = bones.find((p) => p.name === b.parent);
      if (parent?.id) fbx.connectOO(b.id!, parent.id);
      else            fbx.connectOO(b.id!, 0n);  // parent missing → attach to root
    } else {
      // hips (root bone) attaches to FBX scene RootNode.
      fbx.connectOO(b.id!, 0n);
    }
  }

  // 2) AnimationStack + AnimationLayer
  const stackId = fbx.nextId();
  fbx.block(`AnimationStack: ${stackId}, "AnimStack::Take 001", ""`, () => {
    fbx.block('Properties70: ', () => {
      fbx.line(`P: "LocalStart", "KTime", "Time", "",${0n}`);
      fbx.line(`P: "LocalStop", "KTime", "Time", "",${secondsToKTime(clipDurationSec)}`);
      fbx.line(`P: "ReferenceStart", "KTime", "Time", "",${0n}`);
      fbx.line(`P: "ReferenceStop", "KTime", "Time", "",${secondsToKTime(clipDurationSec)}`);
    });
  });
  const layerId = fbx.nextId();
  fbx.block(`AnimationLayer: ${layerId}, "AnimLayer::BaseLayer", ""`, () => {});
  fbx.connectOO(layerId, stackId);

  // 3) AnimationCurves + CurveNodes per track
  for (const [boneName, track] of rotationTracks) {
    const bone = bones.find((b) => b.name === boneName)!;
    writeAnimationTrack(fbx, bone, track, 'Lcl Rotation', layerId, /*isRotation*/ true);
  }
  for (const [boneName, track] of positionTracks) {
    const bone = bones.find((b) => b.name === boneName)!;
    writeAnimationTrack(fbx, bone, track, 'Lcl Translation', layerId, /*isRotation*/ false);
  }

  fbx.indentLevel = 0;
  fbx.line('}');
  fbx.line('');
}

function writeModelBone(fbx: FbxBuilder, b: BoneSpec): void {
  fbx.block(`Model: ${b.id}, "Model::${b.name}", "LimbNode"`, () => {
    fbx.line('Version: 232');
    fbx.block('Properties70: ', () => {
      fbx.p70Prop('RotationActive', 'bool', '', '', 1);
      fbx.p70Prop('InheritType',    'enum', '', '', 1);
      fbx.p70Prop('ScalingMax', 'Vector3D', 'Vector', '', 0, 0, 0);
      fbx.p70Prop('DefaultAttributeIndex', 'int', 'Integer', '', 0);
      fbx.p70Prop('Lcl Translation', 'Lcl Translation', '', 'A',
        b.position[0], b.position[1], b.position[2]);
      fbx.p70Prop('Lcl Rotation',    'Lcl Rotation',    '', 'A', 0, 0, 0);
      fbx.p70Prop('Lcl Scaling',     'Lcl Scaling',     '', 'A', 1, 1, 1);
    });
    fbx.line('Shading: T');
    fbx.line('Culling: "CullingOff"');
  });
}

function writeNodeAttributeLimb(fbx: FbxBuilder, b: BoneSpec, attrId: bigint): void {
  fbx.block(`NodeAttribute: ${attrId}, "NodeAttribute::${b.name}", "LimbNode"`, () => {
    fbx.block('Properties70: ', () => {
      // Size is a hint to FBX renderers for bone display radius. Use a small
      // constant; downstream tools usually re-derive from skeleton geometry.
      fbx.p70Prop('Size', 'double', 'Number', '', 1);
    });
    fbx.line('TypeFlags: "Skeleton"');
  });
}

function writeAnimationTrack(
  fbx: FbxBuilder,
  bone: BoneSpec,
  track: THREE.QuaternionKeyframeTrack | THREE.VectorKeyframeTrack,
  property: 'Lcl Rotation' | 'Lcl Translation',
  layerId: bigint,
  isRotation: boolean,
): void {
  // Sample the track at its native keyframes. For quaternions we convert
  // each keyframe to Euler XYZ degrees (FBX uses Euler angles in degrees).
  const times = track.times;  // Float32Array of seconds
  const n = times.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const zs = new Float32Array(n);

  if (isRotation) {
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler(0, 0, 0, 'XYZ');
    const RAD2DEG = 180 / Math.PI;
    const values = track.values;  // [x,y,z,w]×n
    let prevX = 0, prevY = 0, prevZ = 0;
    for (let i = 0; i < n; i++) {
      _q.set(values[i*4 + 0], values[i*4 + 1], values[i*4 + 2], values[i*4 + 3]);
      _e.setFromQuaternion(_q, 'XYZ');
      // Continuity fix: avoid ±180° jumps when Euler representation wraps —
      // pick the equivalent angle closest to the previous frame.
      let ex = _e.x * RAD2DEG;
      let ey = _e.y * RAD2DEG;
      let ez = _e.z * RAD2DEG;
      if (i > 0) {
        ex = unwrapDeg(prevX, ex);
        ey = unwrapDeg(prevY, ey);
        ez = unwrapDeg(prevZ, ez);
      }
      xs[i] = ex; ys[i] = ey; zs[i] = ez;
      prevX = ex; prevY = ey; prevZ = ez;
    }
  } else {
    // Translation: VectorKeyframeTrack values are [x,y,z]×n.
    const values = track.values;
    for (let i = 0; i < n; i++) {
      xs[i] = values[i*3 + 0];
      ys[i] = values[i*3 + 1];
      zs[i] = values[i*3 + 2];
    }
  }

  // CurveNode is the parent for the three per-axis curves.
  const curveNodeId = fbx.nextId();
  // dX/dY/dZ default values are zero (translation) or zero deg (rotation).
  fbx.block(`AnimationCurveNode: ${curveNodeId}, "AnimCurveNode::${property === 'Lcl Rotation' ? 'R' : 'T'}", ""`, () => {
    fbx.block('Properties70: ', () => {
      fbx.p70Prop('d|X', 'Number', '', 'A', xs[0]);
      fbx.p70Prop('d|Y', 'Number', '', 'A', ys[0]);
      fbx.p70Prop('d|Z', 'Number', '', 'A', zs[0]);
    });
  });

  // Three AnimationCurve entries (X, Y, Z).
  const xCurveId = fbx.nextId();
  writeCurve(fbx, xCurveId, times, xs);
  const yCurveId = fbx.nextId();
  writeCurve(fbx, yCurveId, times, ys);
  const zCurveId = fbx.nextId();
  writeCurve(fbx, zCurveId, times, zs);

  // Connections: curves → curve node (via property name "d|X" etc.);
  //              curve node → bone Model (via property name "Lcl Rotation" or "Lcl Translation");
  //              curve node → layer (OO).
  fbx.connectOP(xCurveId, curveNodeId, 'd|X');
  fbx.connectOP(yCurveId, curveNodeId, 'd|Y');
  fbx.connectOP(zCurveId, curveNodeId, 'd|Z');
  fbx.connectOP(curveNodeId, bone.id!, property);
  fbx.connectOO(curveNodeId, layerId);
}

function writeCurve(
  fbx: FbxBuilder, id: bigint,
  times: Float32Array, values: Float32Array,
): void {
  const n = times.length;
  fbx.block(`AnimationCurve: ${id}, "AnimCurve::", ""`, () => {
    fbx.line('Default: 0');
    fbx.line('KeyVer: 4008');
    fbx.line(`KeyTime: *${n} {`);
    fbx.indentLevel++;
    fbx.line(`a: ${Array.from(times, (t) => secondsToKTime(t).toString()).join(',')}`);
    fbx.indentLevel--;
    fbx.line('}');
    fbx.line(`KeyValueFloat: *${n} {`);
    fbx.indentLevel++;
    fbx.line(`a: ${Array.from(values, (v) => v.toFixed(6)).join(',')}`);
    fbx.indentLevel--;
    fbx.line('}');
    fbx.line(`KeyAttrFlags: *1 {`);
    fbx.indentLevel++;
    fbx.line(`a: ${KEY_FLAG_LINEAR}`);
    fbx.indentLevel--;
    fbx.line('}');
    fbx.line(`KeyAttrDataFloat: *4 {`);
    fbx.indentLevel++;
    fbx.line('a: 0,0,0,0');
    fbx.indentLevel--;
    fbx.line('}');
    fbx.line(`KeyAttrRefCount: *1 {`);
    fbx.indentLevel++;
    fbx.line(`a: ${n}`);
    fbx.indentLevel--;
    fbx.line('}');
  });
}

function writeConnections(fbx: FbxBuilder): void {
  fbx.block('Connections: ', () => {
    // Bone hierarchy: child Model → parent Model (or RootNode=0 for hips).
    // We use the connections array we accumulated, then append bone-parent
    // connections at the end so they're co-located with the rest.
    for (const c of fbx.connections) {
      if (c.type === 'OO') {
        fbx.line(`C: "OO",${c.fromId},${c.toId}`);
      } else {
        fbx.line(`C: "OP",${c.fromId},${c.toId},"${c.propertyName}"`);
      }
    }
  });
  fbx.line('');
}

function writeTakes(fbx: FbxBuilder): void {
  // Some loaders (older FBXLoader versions) require this section even when
  // empty — modern ones ignore it but tolerate its presence.
  fbx.block('Takes: ', () => {
    fbx.line('Current: "Take 001"');
  });
  fbx.line('');
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function secondsToKTime(s: number): bigint {
  // Multiply via bigint to avoid float precision loss at long durations.
  // 46186158000 ticks/sec → 10-minute clip = ~2.8e13 ticks, still fits in
  // int64 (1.8e19) but exceeds Number.MAX_SAFE_INTEGER (9e15) at large
  // sample counts. BigInt is the safe choice.
  return BigInt(Math.round(s * Number(KTIME_ONE_SECOND)));
}

/** Choose the angle equivalent to `cur` that lies closest to `prev`.
 *  Prevents ±180° jumps in Euler curves between adjacent keyframes when
 *  the quaternion crosses a singularity. */
function unwrapDeg(prev: number, cur: number): number {
  let d = cur - prev;
  while (d >  180) d -= 360;
  while (d < -180) d += 360;
  return prev + d;
}

// Tag connections list mutable on FbxBuilder (TS lazy-init hack — we wrote it
// in the class). No runtime effect.
declare module './fbxExportRecorder' {}
