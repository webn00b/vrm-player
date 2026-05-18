# Animation Validation

This project can validate animation data with `tools/animation_validator.py`.
The Python version is an offline research tool: it is meant to stabilize the
rules before the same report format is implemented in TypeScript for the player
UI.

The player can export a matching trace from the debug panel:

1. Switch to `Inspect`.
2. Open `Validation (ROM)`.
3. Use `Motion trace` → `Rec` / `Stop`.
4. Validate the downloaded `*.motion_trace.json` with the Python CLI.

## Run

```bash
python3 tools/animation_validator.py animations/idle/idle_0.json \
  -o validation-reports/idle_0.report.json \
  --summary validation-reports/idle_0.summary.md
```

The process exits with code `1` when at least one `error` issue is found.
Pass `--no-fail-on-error` when generating reports locally and you do not want
the command to fail.

## Repair

Use `tools/animation_repair.py` for conservative authored-track fixes:

```bash
python3 tools/animation_repair.py animations/idle/idle_0.json \
  -o validation-reports/idle_0.repaired.json \
  --report validation-reports/idle_0.repair.json \
  --repair-report validation-reports/idle_0.repair_report.md
```

Default passes:

- normalize quaternion tracks;
- fix antipodal quaternion continuity;
- clamp body-bone rotations to configured ROM.

Optional smoothing for isolated large steps:

```bash
python3 tools/animation_repair.py animations/idle/idle_0.json \
  -o validation-reports/idle_0.repaired.json \
  --smooth-jitter \
  --repair-report validation-reports/idle_0.repair_report.md
```

Repair currently targets the repo's authored `channels` animation JSON. A
downloaded `*.motion_trace.json` is a diagnostic capture of final on-screen
poses and should be validated, not edited as the source animation.

The Markdown repair report includes:

- before/after issue counts by category;
- what was fixed automatically;
- motion diff: changed bones, changed keyframes, max visible rotation delta,
  and risk level;
- repeated ROM patterns that are likely retarget mapping candidates;
- remaining issues that need manual or AI review.

## Diff

Use `tools/animation_diff.py` when you want to inspect how much a repair changed
the authored animation:

```bash
python3 tools/animation_diff.py animations/idle/idle_0.json \
  validation-reports/idle_0.repaired_smooth.json \
  -o validation-reports/idle_0.diff.json \
  --summary validation-reports/idle_0.diff.md
```

The diff separates visual quaternion changes from hemisphere-only sign changes,
so a continuity fix does not look like a visible pose edit.

## Supported Inputs

Existing animation JSON:

```json
{
  "duration": 3,
  "channels": {
    "hips": {
      "times": [0, 0.033],
      "values": [0, 0, 0, 1, 0, 0, 0, 1]
    }
  }
}
```

Player motion trace:

```json
{
  "name": "walk",
  "fps": 30,
  "frames": [
    {
      "time": 0,
      "bones": {
        "hips": {
          "localQuat": [0, 0, 0, 1],
          "worldPos": [0, 1, 0]
        },
        "leftFoot": {
          "localQuat": [0, 0, 0, 1],
          "worldPos": [-0.1, 0.02, 0.1]
        }
      }
    }
  ]
}
```

The validator also accepts a compact `bones` shape:

```json
{
  "fps": 30,
  "bones": {
    "hips": {
      "localQuat": [[0, 0, 0, 1]],
      "worldPos": [[0, 1, 0]]
    }
  }
}
```

## Report Shape

Each issue is designed to be useful to an LLM:

```json
{
  "id": "joint-range-violation",
  "severity": "error",
  "category": "rom",
  "timeStart": 1.233,
  "frameStart": 37,
  "bones": ["rightLowerArm"],
  "metric": "rightLowerArm.x Euler (XYZ)",
  "expected": "-10.0deg..150.0deg",
  "actual": "-42.0deg",
  "likelyCause": "right elbow flexion axis or sign may be wrong in retarget mapping.",
  "suggestedFix": "Check local bone basis, axis sign, and IK pole direction before adding more smoothing.",
  "evidence": {
    "axis": "x",
    "overByDeg": 32
  }
}
```

## Checks

- `nan`: invalid quaternion components.
- `quat-norm`: non-unit quaternions.
- `rom`: anatomical range violations using the same body constraints as the TS
  runtime validator. The Python validator uses a tiny default tolerance of
  `0.05deg` so values clamped exactly to a boundary are not reported as false
  positives.
- `flip`: large adjacent quaternion changes and antipodal hemisphere flips.
- `jitter`: per-bone rotation delta outliers.
- `ground-penetration`: foot/toe world position below floor.
- `foot-slide`: near-floor foot moves horizontally too fast.
- `hip-drift`: hips world Y changes too much across the trace.
- `bone-length`: parent-child world distance changes unexpectedly.

## TypeScript Port Plan

1. Keep the JSON report schema identical.
2. Move quaternion/euler helpers into `src/validation/animationDoctor.ts`.
3. Add a player-side trace exporter that samples final normalized bone poses
   after retargeting and validation.
4. Show report issues on a timeline in the existing validation fold.
