# Monocular hands & depth — exploration log (2026-06)

What we tried to push single-camera hand/depth quality past the heuristics, what
we measured, and why each was parked. Measure-first throughout — nothing shipped
to `main` without a rendered/measured win.

## Shipped to `main` (the wins that stuck)

The clasp/contact heuristics in `directPoseApplier`, all verified by rendering:
- forearm de-penetration (iterated to clearance) — `measure-armcross`
- clasp wrist-merge (V, not crossed X) + finger-align (palms-together)
- leg rate-limit on half-body (kills hallucinated-leg teleports) — `measure-legjitter`
- arm-back limit, monotonic detect timestamps (live→file), capture-tab UX.

These remain the best hand result for single-camera capture.

## Parked explorations (branches, NOT in `main`)

### WiLoR 3D hands — `feat/python-hands-wilor`
3D hand reconstruction (Python/PyTorch, MANO) to replace MediaPipe's
depth-guessed fingers. See `docs/wilor-hands.md` on that branch.
- **Runs on macOS** (CPU; MPS crashes wilor-mini's ViT). Env recipe: conda
  py3.10 + patched chumpy + `git+…/WiLoR-mini` + dill. Detects both hands.
- **Blocked**: WiLoR outputs hands in its own camera frame; mapping that to the
  avatar frame needs a rotation we can't recover. Tried, all rendered, all fail:
  1. axis sign-flips (8) — none correct.
  2. Kabsch fit vs MediaPipe hands — 26 mm residual, still wrong. Circular:
     MediaPipe's hand-Z is the very garbage WiLoR is meant to replace.
  3. per-frame palm-basis align to MediaPipe — fails at the clasp, because
     MediaPipe is occluded-garbage exactly there.
- **Root cause**: no reliable orientation reference exists in a monocular
  pipeline at the occluded clasp. Verdict: frozen; raw WiLoR ≤ the heuristic.

### Temporal Z-sign resolution — `feat/temporal-z-sign`
Idea: resolve foreshortening front/back ambiguity by temporal continuity.
- **Measured first** (`measure-zflip`): depth-sign flips in current output are
  ~0% on half-body clips, ~1% on ted1 arms (genuine gesture crossings). The
  existing smoother + guards already keep the sign stable; old "arms back" was a
  static bias (already fixed), not a flip. **Not built** — fixes a non-problem.

### General self-collision solver — `feat/temporal-z-sign`
Idea: one capsule solver to generalize the point fixes.
- **Measured first** (`measure-selfcollide`): the dominant "collisions" are
  legitimate resting contact (upper-arm against torso, 100% of frames) that must
  be preserved. Real deep self-penetration is rare (forearm-through-torso ~1.5%
  on ted1; some dance leg-leg). **Not built** — high false-positive risk for a
  marginal gain.

## Conclusion

The pipeline is near the single-camera ceiling. The remaining artifacts (clasp
hand orientation, residual depth magnitude) are fundamentally monocular. The
next real quality lever is **multi-view** (true depth) — the existing Multi-view
capture mode — not more single-camera heuristics.

## Diagnostic tools (regression checks)

On the branches: `measure-armcross`, `measure-legjitter`, `measure-armback`,
`measure-zflip`, `measure-selfcollide` (all `tools/*.mjs`, take a BVH). Worth
cherry-picking to `main` if we keep iterating.
