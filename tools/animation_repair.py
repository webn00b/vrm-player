#!/usr/bin/env python3
"""Repair simple animation-track issues in VRM-player animation JSON.

This is the first, conservative repair layer. It edits authored quaternion
tracks, not diagnostic motion traces. Supported input today is the repo's
existing animation JSON shape:

  {"channels": {"rightLowerArm": {"times": [...], "values": [x,y,z,w,...]}}}

Repairs:
  - normalize non-unit quaternions
  - keep adjacent quaternions in the same hemisphere
  - clamp body-bone rotations to the same ROM constraints as the validator
  - optionally smooth large adjacent quaternion steps
"""

from __future__ import annotations

import argparse
import json
import math
from copy import deepcopy
from pathlib import Path
from typing import Any

import animation_validator as av
import animation_diff as ad


Quat = tuple[float, float, float, float]
EPS = 1e-9


def quat_dot(a: Quat, b: Quat) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]


def quat_norm(q: Quat) -> float:
    return math.sqrt(sum(v * v for v in q))


def normalize(q: Quat) -> Quat:
    n = quat_norm(q)
    if n < EPS or not math.isfinite(n):
        return q
    return (q[0] / n, q[1] / n, q[2] / n, q[3] / n)


def negate(q: Quat) -> Quat:
    return (-q[0], -q[1], -q[2], -q[3])


def slerp(a: Quat, b: Quat, t: float) -> Quat:
    a = normalize(a)
    b = normalize(b)
    dot = quat_dot(a, b)
    if dot < 0:
        b = negate(b)
        dot = -dot
    dot = max(-1.0, min(1.0, dot))
    if dot > 0.9995:
        return normalize(tuple(a[i] + (b[i] - a[i]) * t for i in range(4)))  # type: ignore[return-value]
    theta0 = math.acos(dot)
    theta = theta0 * t
    sin_theta = math.sin(theta)
    sin_theta0 = math.sin(theta0)
    s0 = math.cos(theta) - dot * sin_theta / sin_theta0
    s1 = sin_theta / sin_theta0
    return normalize(tuple((s0 * a[i]) + (s1 * b[i]) for i in range(4)))  # type: ignore[return-value]


def euler_to_quat(euler: av.Vec3, order: str) -> Quat:
    x, y, z = euler
    c1 = math.cos(x / 2)
    c2 = math.cos(y / 2)
    c3 = math.cos(z / 2)
    s1 = math.sin(x / 2)
    s2 = math.sin(y / 2)
    s3 = math.sin(z / 2)

    if order == "XYZ":
        q = (
            s1 * c2 * c3 + c1 * s2 * s3,
            c1 * s2 * c3 - s1 * c2 * s3,
            c1 * c2 * s3 + s1 * s2 * c3,
            c1 * c2 * c3 - s1 * s2 * s3,
        )
    elif order == "YXZ":
        q = (
            s1 * c2 * c3 + c1 * s2 * s3,
            c1 * s2 * c3 - s1 * c2 * s3,
            c1 * c2 * s3 - s1 * s2 * c3,
            c1 * c2 * c3 + s1 * s2 * s3,
        )
    elif order == "ZXY":
        q = (
            s1 * c2 * c3 - c1 * s2 * s3,
            c1 * s2 * c3 + s1 * c2 * s3,
            c1 * c2 * s3 + s1 * s2 * c3,
            c1 * c2 * c3 - s1 * s2 * s3,
        )
    elif order == "ZYX":
        q = (
            s1 * c2 * c3 - c1 * s2 * s3,
            c1 * s2 * c3 + s1 * c2 * s3,
            c1 * c2 * s3 - s1 * s2 * c3,
            c1 * c2 * c3 + s1 * s2 * s3,
        )
    elif order == "YZX":
        q = (
            s1 * c2 * c3 + c1 * s2 * s3,
            c1 * s2 * c3 + s1 * c2 * s3,
            c1 * c2 * s3 - s1 * s2 * c3,
            c1 * c2 * c3 - s1 * s2 * s3,
        )
    elif order == "XZY":
        q = (
            s1 * c2 * c3 - c1 * s2 * s3,
            c1 * s2 * c3 - s1 * c2 * s3,
            c1 * c2 * s3 + s1 * s2 * c3,
            c1 * c2 * c3 + s1 * s2 * s3,
        )
    else:
        raise ValueError(f"Unsupported Euler order: {order}")
    return normalize(q)


def read_track_quats(values: list[Any]) -> list[Quat] | None:
    if len(values) % 4 != 0:
        return None
    out: list[Quat] = []
    for i in range(0, len(values), 4):
        q = av.as_float_tuple(values[i : i + 4], 4)
        if q is None:
            return None
        out.append(q)  # type: ignore[arg-type]
    return out


def write_track_quats(values: list[Any], quats: list[Quat]) -> None:
    values[:] = [
        round(component, 8)
        for q in quats
        for component in q
    ]


class AnimationRepairer:
    def __init__(
        self,
        *,
        fix_norm: bool,
        fix_continuity: bool,
        clamp_rom: bool,
        smooth_jitter: bool,
        jitter_deg: float,
    ):
        self.fix_norm = fix_norm
        self.fix_continuity = fix_continuity
        self.clamp_rom = clamp_rom
        self.smooth_jitter = smooth_jitter
        self.jitter_deg = jitter_deg
        self.stats: dict[str, int] = {
            "tracksVisited": 0,
            "quaternionsVisited": 0,
            "normalized": 0,
            "hemisphereFlips": 0,
            "romClamped": 0,
            "jitterSmoothed": 0,
            "unsupportedChannels": 0,
        }

    def repair_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if "channels" not in payload or not isinstance(payload["channels"], dict):
            raise ValueError("animation_repair.py currently supports only JSON files with a channels object")

        out = deepcopy(payload)
        for raw_name, channel in out["channels"].items():
            if not isinstance(channel, dict):
                continue
            values = channel.get("values")
            times = channel.get("times")
            if not isinstance(values, list) or not isinstance(times, list) or len(values) != len(times) * 4:
                self.stats["unsupportedChannels"] += 1
                continue
            bone = av.canonical_bone_name(str(raw_name))
            quats = read_track_quats(values)
            if quats is None:
                self.stats["unsupportedChannels"] += 1
                continue
            self.stats["tracksVisited"] += 1
            self.stats["quaternionsVisited"] += len(quats)
            repaired = self.repair_track(bone, quats)
            write_track_quats(values, repaired)

        out.setdefault("repair", {})
        out["repair"] = {
            "tool": "tools/animation_repair.py",
            "version": 1,
            "stats": self.stats,
            "passes": {
                "fixNorm": self.fix_norm,
                "fixContinuity": self.fix_continuity,
                "clampRom": self.clamp_rom,
                "smoothJitter": self.smooth_jitter,
                "jitterDeg": self.jitter_deg,
            },
        }
        return out

    def repair_track(self, bone: str, quats: list[Quat]) -> list[Quat]:
        out = list(quats)

        if self.fix_norm:
            for i, q in enumerate(out):
                nq = normalize(q)
                if quat_delta_raw(q, nq) > 1e-7 or abs(quat_norm(q) - 1.0) > 1e-5:
                    self.stats["normalized"] += 1
                out[i] = nq

        if self.fix_continuity:
            for i in range(1, len(out)):
                if quat_dot(out[i - 1], out[i]) < 0:
                    out[i] = negate(out[i])
                    self.stats["hemisphereFlips"] += 1

        if self.clamp_rom:
            constraint = av.CONSTRAINTS.get(bone)
            if constraint:
                for i, q in enumerate(out):
                    cq, changed = self.clamp_quat(q, constraint)
                    if changed:
                        self.stats["romClamped"] += 1
                    out[i] = cq

        if self.smooth_jitter and len(out) >= 3:
            out = self.smooth_large_steps(out)

        if self.fix_norm:
            out = [normalize(q) for q in out]
        if self.fix_continuity:
            for i in range(1, len(out)):
                if quat_dot(out[i - 1], out[i]) < 0:
                    out[i] = negate(out[i])
                    self.stats["hemisphereFlips"] += 1
        return out

    def clamp_quat(self, q: Quat, constraint: av.RotationConstraint) -> tuple[Quat, bool]:
        euler = av.quat_to_euler(q, constraint.order)
        clamped = (
            min(max(euler[0], constraint.min[0]), constraint.max[0]),
            min(max(euler[1], constraint.min[1]), constraint.max[1]),
            min(max(euler[2], constraint.min[2]), constraint.max[2]),
        )
        changed = any(abs(euler[i] - clamped[i]) > 1e-8 for i in range(3))
        if not changed:
            return q, False
        cq = euler_to_quat(clamped, constraint.order)
        if quat_dot(normalize(q), cq) < 0:
            cq = negate(cq)
        return cq, True

    def smooth_large_steps(self, quats: list[Quat]) -> list[Quat]:
        out = list(quats)
        for i in range(1, len(quats) - 1):
            prev_delta = av.quat_delta_deg(out[i - 1], out[i])
            next_delta = av.quat_delta_deg(out[i], out[i + 1])
            if prev_delta <= self.jitter_deg and next_delta <= self.jitter_deg:
                continue
            # Replace isolated spikes with the midpoint between neighbours.
            neighbour_delta = av.quat_delta_deg(out[i - 1], out[i + 1])
            if neighbour_delta < max(prev_delta, next_delta):
                out[i] = slerp(out[i - 1], out[i + 1], 0.5)
                self.stats["jitterSmoothed"] += 1
        return out


def quat_delta_raw(a: Quat, b: Quat) -> float:
    return max(abs(a[i] - b[i]) for i in range(4))


def validate_payload(payload: dict[str, Any], name: str) -> dict[str, Any]:
    fps = float(payload.get("fps") or payload.get("sampleRate") or 30.0)
    if "channels" in payload:
        trace = av.parse_channel_animation(name, fps, payload)
    elif "frames" in payload:
        trace = av.parse_frame_trace(name, fps, payload)
    elif "bones" in payload:
        trace = av.parse_bone_array_trace(name, fps, payload)
    else:
        raise ValueError("Unsupported payload for validation")
    return av.AnimationValidator(av.ValidatorOptions()).validate(trace)


def count_by_key(issues: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for issue in issues:
        value = str(issue.get(key, "unknown"))
        counts[value] = counts.get(value, 0) + 1
    return counts


def issue_axis(issue: dict[str, Any]) -> str | None:
    evidence = issue.get("evidence")
    if isinstance(evidence, dict) and isinstance(evidence.get("axis"), str):
        return evidence["axis"]
    metric = str(issue.get("metric", ""))
    if "." in metric:
        tail = metric.split(".", 1)[1]
        if tail:
            return tail[0]
    return None


def retarget_candidates(before: dict[str, Any]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for issue in before.get("issues", []):
        if issue.get("category") != "rom":
            continue
        bones = issue.get("bones")
        if not isinstance(bones, list) or not bones:
            continue
        axis = issue_axis(issue) or "?"
        grouped.setdefault((str(bones[0]), axis), []).append(issue)

    candidates: list[dict[str, Any]] = []
    for (bone, axis), issues in grouped.items():
        if len(issues) < 3:
            continue
        first = issues[0]
        candidates.append({
            "bone": bone,
            "axis": axis,
            "count": len(issues),
            "firstTime": first.get("timeStart"),
            "likelyCause": first.get("likelyCause"),
            "suggestedFix": first.get("suggestedFix"),
        })
    return sorted(candidates, key=lambda item: (-int(item["count"]), item["bone"], item["axis"]))


def ai_review_items(after: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for issue in after.get("issues", []):
        category = issue.get("category")
        severity = issue.get("severity")
        if severity == "error" or category in {
            "foot-slide",
            "ground-penetration",
            "hip-drift",
            "bone-length",
            "jitter",
            "flip",
        }:
            items.append(issue)
    return items


def category_delta(before: dict[str, Any], after: dict[str, Any]) -> list[tuple[str, int, int]]:
    before_counts = before.get("summary", {}).get("categoryCounts") or {}
    after_counts = after.get("summary", {}).get("categoryCounts") or {}
    keys = sorted(set(before_counts) | set(after_counts))
    return [(key, int(before_counts.get(key, 0)), int(after_counts.get(key, 0))) for key in keys]


def write_repair_markdown(
    *,
    input_path: Path,
    output_path: Path,
    markdown_path: Path,
    before: dict[str, Any],
    after: dict[str, Any],
    repair_stats: dict[str, int],
    passes: dict[str, Any],
    diff_report: dict[str, Any] | None = None,
) -> None:
    before_summary = before.get("summary", {})
    after_summary = after.get("summary", {})
    candidates = retarget_candidates(before)
    review = ai_review_items(after)
    lines = [
        f"# Animation repair report: {input_path.name}",
        "",
        f"- Input: `{input_path}`",
        f"- Output: `{output_path}`",
        f"- Before issues: {before_summary.get('issueCount', 0)}",
        f"- After issues: {after_summary.get('issueCount', 0)}",
        "",
        "## Enabled passes",
        "",
    ]
    for key, value in passes.items():
        display_value = str(value).lower() if isinstance(value, bool) else str(value)
        lines.append(f"- `{key}`: `{display_value}`")

    lines.extend(["", "## Before / After", ""])
    deltas = category_delta(before, after)
    if deltas:
        lines.append("| Category | Before | After |")
        lines.append("| --- | ---: | ---: |")
        for category, before_count, after_count in deltas:
            lines.append(f"| `{category}` | {before_count} | {after_count} |")
    else:
        lines.append("No issues found before or after repair.")

    lines.extend(["", "## Automatically Fixed", ""])
    fixed_lines = [
        ("Normalized quaternions", repair_stats.get("normalized", 0)),
        ("Quaternion hemisphere flips", repair_stats.get("hemisphereFlips", 0)),
        ("ROM clamps", repair_stats.get("romClamped", 0)),
        ("Smoothed jitter spikes", repair_stats.get("jitterSmoothed", 0)),
    ]
    for label, count in fixed_lines:
        lines.append(f"- {label}: {count}")
    if repair_stats.get("unsupportedChannels", 0):
        lines.append(f"- Unsupported/non-quaternion channels skipped: {repair_stats['unsupportedChannels']}")

    lines.extend(["", "## Motion Diff", ""])
    if diff_report:
        diff_summary = diff_report["summary"]
        lines.extend([
            f"- Changed bones: {diff_summary['changedBones']}",
            f"- Visual changed keyframes: {diff_summary['visualChangedKeyframes']}",
            f"- Hemisphere-only keyframes: {diff_summary['hemisphereOnlyKeyframes']}",
            f"- Max visible delta: {diff_summary['maxDeltaDeg']:.4f}deg",
        ])
        max_change = diff_summary.get("maxChange")
        if isinstance(max_change, dict):
            lines.append(
                f"- Worst visible change: `{max_change['bone']}` frame {max_change['frame']} "
                f"at {max_change.get('time')}s, {max_change['deltaDeg']:.4f}deg"
            )
        if diff_report["bones"]:
            lines.extend(["", "| Bone | Visual keys | Component keys | Max delta | Risk |", "| --- | ---: | ---: | ---: | --- |"])
            for item in diff_report["bones"][:12]:
                lines.append(
                    f"| `{item['bone']}` | {item['visualChangedKeyframes']} | "
                    f"{item['componentChangedKeyframes']} | {item['maxDeltaDeg']:.4f}deg | `{item['risk']}` |"
                )
        else:
            lines.append("- No quaternion channel changes detected.")
    else:
        lines.append("- Not available for this input format.")

    lines.extend(["", "## Retarget Fix Candidates", ""])
    if candidates:
        for item in candidates:
            lines.append(
                f"- `{item['bone']}` axis `{item['axis']}`: {item['count']} repeated ROM hits. "
                f"Likely cause: {item['likelyCause']} Suggested fix: {item['suggestedFix']}"
            )
    else:
        lines.append("- None detected.")

    lines.extend(["", "## Manual / AI Review", ""])
    if review:
        for issue in review[:20]:
            bones = ", ".join(str(bone) for bone in issue.get("bones", []))
            lines.append(
                f"- [{issue.get('severity')}] `{issue.get('category')}` at "
                f"{float(issue.get('timeStart', 0)):.3f}s frame {issue.get('frameStart')} "
                f"({bones}): {issue.get('actual')} expected {issue.get('expected')}. "
                f"Next: {issue.get('suggestedFix')}"
            )
    elif diff_report and any(item.get("risk") == "high" for item in diff_report.get("bones", [])):
        for item in diff_report["bones"]:
            if item.get("risk") != "high":
                continue
            worst = item.get("worst") or {}
            lines.append(
                f"- [review] high visual diff on `{item['bone']}`: max {item['maxDeltaDeg']:.4f}deg "
                f"at frame {worst.get('frame')}. Validator passes, but compare playback before accepting."
            )
    else:
        lines.append("- None after repair.")

    lines.extend(["", "## Notes", ""])
    if candidates:
        lines.append(
            "- Repeated ROM problems may be hidden by clamping in the repaired output. "
            "Treat them as source/retarget mapping candidates, not just bad keyframes."
        )
    if after_summary.get("issueCount", 0) == 0:
        lines.append("- The repaired file passes the current validator thresholds.")
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair simple quaternion-track issues in animation JSON.")
    parser.add_argument("input", type=Path)
    parser.add_argument("-o", "--output", type=Path, required=True)
    parser.add_argument("--no-fix-norm", action="store_true")
    parser.add_argument("--no-fix-continuity", action="store_true")
    parser.add_argument("--no-clamp-rom", action="store_true")
    parser.add_argument("--smooth-jitter", action="store_true", help="Smooth isolated large adjacent quaternion steps.")
    parser.add_argument("--jitter-deg", type=float, default=60.0)
    parser.add_argument("--report", type=Path, help="Optional repair summary JSON.")
    parser.add_argument(
        "--repair-report",
        "--summary",
        dest="repair_report",
        type=Path,
        help="Optional Markdown report with before/after, auto-fixes, retarget candidates, and review items.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    with args.input.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise SystemExit("Top-level JSON value must be an object")

    repairer = AnimationRepairer(
        fix_norm=not args.no_fix_norm,
        fix_continuity=not args.no_fix_continuity,
        clamp_rom=not args.no_clamp_rom,
        smooth_jitter=args.smooth_jitter,
        jitter_deg=args.jitter_deg,
    )
    before_report = validate_payload(payload, args.input.stem)
    repaired = repairer.repair_payload(payload)
    after_report = validate_payload(repaired, args.output.stem)
    diff_report = ad.compare_payloads(
        payload,
        repaired,
        before_name=str(args.input),
        after_name=str(args.output),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(repaired, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    summary = {
        "input": str(args.input),
        "output": str(args.output),
        "stats": repairer.stats,
        "before": before_report["summary"],
        "after": after_report["summary"],
        "diff": diff_report["summary"],
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.repair_report:
        write_repair_markdown(
            input_path=args.input,
            output_path=args.output,
            markdown_path=args.repair_report,
            before=before_report,
            after=after_report,
            repair_stats=repairer.stats,
            passes=repaired["repair"]["passes"],
            diff_report=diff_report,
        )
    print(
        "repaired "
        f"{args.input.name}: {repairer.stats['normalized']} normalized, "
        f"{repairer.stats['hemisphereFlips']} continuity flips, "
        f"{repairer.stats['romClamped']} ROM clamps, "
        f"{repairer.stats['jitterSmoothed']} smoothed"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
