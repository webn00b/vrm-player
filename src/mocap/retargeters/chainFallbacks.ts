import type * as THREE from 'three';
import { trackPhase } from '../trackers/boneTrackState';
import type { DirectPoseRig } from './directPoseRig';

/**
 * A3: opt-in symmetry fallback for a two-bone IK chain (arm or leg). When one
 * side becomes invisible while the other side is live, copy the other side's
 * local-frame quaternions to keep the missing limb animated. Works best for
 * bilaterally-symmetric poses (claps, mirror dance) and produces
 * incorrect-but-not-broken poses for asymmetric input. Relies on the
 * assumption that VRM rigs have mirror-symmetric local bone frames so the
 * same local rotation produces mirrored world motion on the other side.
 *
 * Returns true when the copy was applied (caller should stop processing).
 */
export function trySymmetryChainCopy(
  rig: DirectPoseRig,
  side: 'left' | 'right',
  chainSuffix: 'UpperArm' | 'UpperLeg',
  lowerSuffix: 'LowerArm' | 'LowerLeg',
): boolean {
  if (!rig.settings.symmetryFallback) return false;
  const upperName = side + chainSuffix;
  const lowerName = side + lowerSuffix;
  const otherSide = side === 'left' ? 'right' : 'left';
  const otherUpperName = otherSide + chainSuffix;
  const otherLowerName = otherSide + lowerSuffix;
  const otherUpperPhase = trackPhase(rig.boneTracker.state(otherUpperName), rig.now);
  if (otherUpperPhase !== 'live' && otherUpperPhase !== 'recovering') return false;

  const upperNode = rig.nodeCache.get(upperName);
  const lowerNode = rig.nodeCache.get(lowerName);
  const otherUpper = rig.nodeCache.get(otherUpperName);
  const otherLower = rig.nodeCache.get(otherLowerName);
  if (!upperNode || !lowerNode || !otherUpper || !otherLower) return false;

  upperNode.quaternion.copy(otherUpper.quaternion);
  upperNode.updateWorldMatrix(false, true);
  lowerNode.quaternion.copy(otherLower.quaternion);
  lowerNode.updateWorldMatrix(false, true);
  rig.boneTracker.markObserved(upperName, upperNode.quaternion, rig.now);
  rig.boneTracker.markObserved(lowerName, lowerNode.quaternion, rig.now);
  return true;
}

/**
 * A1: chain landmarks unreliable → fade upper+lower toward rest via the
 * state machine instead of leaving the bones frozen at their last IK pose.
 * Distinguishes "occluded for 1 frame" (hold last good IK) from "occluded
 * for >800ms" (slide back to rest pose).
 */
export function fadeChainToRest(
  rig: DirectPoseRig,
  upperName: string,
  lowerName: string,
  lerp: number,
  qScratch: THREE.Quaternion,
): void {
  const upperNode = rig.nodeCache.get(upperName);
  const lowerNode = rig.nodeCache.get(lowerName);

  if (upperNode) {
    const upperFade = rig.boneTracker.fade(upperName, rig.now, qScratch);
    if (lerp >= 1) upperNode.quaternion.copy(upperFade);
    else           upperNode.quaternion.slerp(upperFade, lerp);
    upperNode.updateWorldMatrix(false, true);
  }
  if (lowerNode) {
    const lowerFade = rig.boneTracker.fade(lowerName, rig.now, qScratch);
    if (lerp >= 1) lowerNode.quaternion.copy(lowerFade);
    else           lowerNode.quaternion.slerp(lowerFade, lerp);
    lowerNode.updateWorldMatrix(false, true);
  }
}
