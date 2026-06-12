# Mixamo Retarget Reference

This project does not vendor `vrm-mixamo-retarget` or the V-Sekai Mixamo sandbox.
Instead, it uses the same ideas as local, tested code:

- normalize Mixamo bone names (`mixamorig:LeftArm`, `mixamorigLeftArm`)
- map Mixamo arm/leg/finger bones to VRM humanoid names
- keep BVH/VRMA retarget diagnostics on generated clips
- apply local ROM first, then pose-chain guardrails
- correct obvious arm-chain failures with two-bone IK

## Reference Concepts

- Mixamo arm chain: `LeftArm -> LeftForeArm -> LeftHand`
- VRM arm chain: `leftUpperArm -> leftLowerArm -> leftHand`
- Two-bone IK chain: root/upper/lower/tip plus target and pole/hint

## Runtime Order

1. BVH/mocap/manual layers write the authored pose.
2. Red skeleton snapshots the authored pose.
3. `BoneValidator` clamps local ROM.
4. `PoseValidator` classifies and corrects arm-chain pose violations.
5. Debug/logger/recording/render see the corrected pose.

## Known Limits

The first pose validator release handles arms only. Legs should use the same
profile and two-bone IK shape in a later pass.
