# Animation repair report: idle_0.json

- Input: `animations/idle/idle_0.json`
- Output: `validation-reports/idle_0.repaired.json`
- Before issues: 10
- After issues: 2

## Enabled passes

- `fixNorm`: `True`
- `fixContinuity`: `True`
- `clampRom`: `True`
- `smoothJitter`: `False`
- `jitterDeg`: `60.0`

## Before / After

| Category | Before | After |
| --- | ---: | ---: |
| `flip` | 2 | 2 |
| `rom` | 8 | 0 |

## Automatically Fixed

- Normalized quaternions: 0
- Quaternion hemisphere flips: 0
- ROM clamps: 8
- Smoothed jitter spikes: 0
- Unsupported/non-quaternion channels skipped: 1

## Retarget Fix Candidates

- `rightUpperArm` axis `z`: 6 repeated ROM hits. Likely cause: rightUpperArm z-axis rotation is outside the configured anatomical range. Suggested fix: Inspect retarget mapping for this bone and clamp/smooth before building final keyframes.

## Manual / AI Review

- [error] `flip` at 0.013s frame 1 (rightHand): 65.87deg expected <= 60.0deg/frame. Next: Inspect this frame in the retarget stage; smooth/unwrap source rotation before building the track.
- [error] `flip` at 0.025s frame 2 (rightHand): 65.87deg expected <= 60.0deg/frame. Next: Inspect this frame in the retarget stage; smooth/unwrap source rotation before building the track.

## Notes

- Repeated ROM problems may be hidden by clamping in the repaired output. Treat them as source/retarget mapping candidates, not just bad keyframes.
