# Animation repair report: idle_0.json

- Input: `animations/idle/idle_0.json`
- Output: `validation-reports/idle_0.repaired_smooth.json`
- Before issues: 10
- After issues: 0

## Enabled passes

- `fixNorm`: `true`
- `fixContinuity`: `true`
- `clampRom`: `true`
- `smoothJitter`: `true`
- `jitterDeg`: `60.0`

## Before / After

| Category | Before | After |
| --- | ---: | ---: |
| `flip` | 2 | 0 |
| `rom` | 8 | 0 |

## Automatically Fixed

- Normalized quaternions: 0
- Quaternion hemisphere flips: 0
- ROM clamps: 8
- Smoothed jitter spikes: 1
- Unsupported/non-quaternion channels skipped: 1

## Motion Diff

- Changed bones: 4
- Visual changed keyframes: 9
- Hemisphere-only keyframes: 0
- Max visible delta: 65.8734deg
- Worst visible change: `rightHand` frame 1 at 0.0125s, 65.8734deg

| Bone | Visual keys | Component keys | Max delta | Risk |
| --- | ---: | ---: | ---: | --- |
| `rightHand` | 1 | 1 | 65.8734deg | `high` |
| `rightUpperArm` | 6 | 6 | 25.5625deg | `high` |
| `leftLowerLeg` | 1 | 1 | 6.8865deg | `medium` |
| `rightLowerLeg` | 1 | 1 | 4.0277deg | `low` |

## Retarget Fix Candidates

- `rightUpperArm` axis `z`: 6 repeated ROM hits. Likely cause: rightUpperArm z-axis rotation is outside the configured anatomical range. Suggested fix: Inspect retarget mapping for this bone and clamp/smooth before building final keyframes.

## Manual / AI Review

- [review] high visual diff on `rightHand`: max 65.8734deg at frame 1. Validator passes, but compare playback before accepting.
- [review] high visual diff on `rightUpperArm`: max 25.5625deg at frame 4. Validator passes, but compare playback before accepting.

## Notes

- Repeated ROM problems may be hidden by clamping in the repaired output. Treat them as source/retarget mapping candidates, not just bad keyframes.
- The repaired file passes the current validator thresholds.
