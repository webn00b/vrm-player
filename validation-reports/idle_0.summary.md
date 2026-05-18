# Animation validation: idle_0

- Source format: `channels`
- Duration: 3.000s
- Frames: 6
- Issues: 10 (+0 suppressed)

## Category counts

- `rom`: 8
- `flip`: 2

## Top issues

- [warning] `rom` at 0.000s frame 0 (rightUpperArm): -74.6deg expected -60.0deg..180.0deg. Fix: Inspect retarget mapping for this bone and clamp/smooth before building final keyframes.
- [warning] `rom` at 0.013s frame 1 (rightUpperArm): -74.6deg expected -60.0deg..180.0deg. Fix: Inspect retarget mapping for this bone and clamp/smooth before building final keyframes.
- [error] `flip` at 0.013s frame 1 (rightHand): 65.87deg expected <= 60.0deg/frame. Fix: Inspect this frame in the retarget stage; smooth/unwrap source rotation before building the track.
- [warning] `rom` at 0.025s frame 2 (rightUpperArm): -74.6deg expected -60.0deg..180.0deg. Fix: Inspect retarget mapping for this bone and clamp/smooth before building final keyframes.
- [error] `flip` at 0.025s frame 2 (rightHand): 65.87deg expected <= 60.0deg/frame. Fix: Inspect this frame in the retarget stage; smooth/unwrap source rotation before building the track.
- [warning] `rom` at 0.025s frame 2 (leftLowerLeg): -11.9deg expected -5.0deg..140.0deg. Fix: Check local bone basis, axis sign, and IK pole direction before adding more smoothing.
- [warning] `rom` at 0.037s frame 3 (rightUpperArm): -74.6deg expected -60.0deg..180.0deg. Fix: Inspect retarget mapping for this bone and clamp/smooth before building final keyframes.
- [error] `rom` at 0.050s frame 4 (rightUpperArm): -85.6deg expected -60.0deg..180.0deg. Fix: Inspect retarget mapping for this bone and clamp/smooth before building final keyframes.
- [warning] `rom` at 0.062s frame 5 (rightUpperArm): -74.6deg expected -60.0deg..180.0deg. Fix: Inspect retarget mapping for this bone and clamp/smooth before building final keyframes.
- [warning] `rom` at 0.062s frame 5 (rightLowerLeg): -9.0deg expected -5.0deg..140.0deg. Fix: Check local bone basis, axis sign, and IK pole direction before adding more smoothing.
