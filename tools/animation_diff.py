#!/usr/bin/env python3
"""Compare two VRM-player animation JSON files.

The diff focuses on authored quaternion channels. It reports both component
changes and visual rotation changes:

- componentChangedKeyframes: raw [x,y,z,w] values changed
- visualChangedKeyframes: geometric quaternion angle changed
- hemisphereOnlyKeyframes: sign changed but represented rotation stayed the same

This makes repair output auditable without treating harmless quaternion
hemisphere fixes as visible motion edits.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import animation_validator as av


Quat = tuple[float, float, float, float]
DEFAULT_COMPONENT_EPS = 1e-6
DEFAULT_VISUAL_EPS_DEG = 0.01


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} top-level JSON value must be an object")
    return payload


def load_channel_tracks(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    channels = payload.get("channels")
    if not isinstance(channels, dict):
        raise ValueError("animation_diff.py currently supports JSON files with a channels object")
    tracks: dict[str, dict[str, Any]] = {}
    for raw_name, channel in channels.items():
        if not isinstance(channel, dict):
            continue
        times = channel.get("times")
        values = channel.get("values")
        if not isinstance(times, list) or not isinstance(values, list) or len(values) != len(times) * 4:
            continue
        quats = read_quats(values)
        if quats is None:
            continue
        bone = av.canonical_bone_name(str(raw_name))
        tracks[bone] = {
            "rawName": str(raw_name),
            "times": [float(t) if av.finite_number(t) else math.nan for t in times],
            "quats": quats,
        }
    return tracks


def read_quats(values: list[Any]) -> list[Quat] | None:
    out: list[Quat] = []
    for i in range(0, len(values), 4):
        q = av.as_float_tuple(values[i : i + 4], 4)
        if q is None:
            return None
        out.append(q)  # type: ignore[arg-type]
    return out


def component_delta(a: Quat, b: Quat) -> float:
    return max(abs(a[i] - b[i]) for i in range(4))


def quat_dot_raw(a: Quat, b: Quat) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]


def angle_diff_deg(a: float, b: float) -> float:
    diff = (b - a + math.pi) % (2 * math.pi) - math.pi
    return abs(diff) * av.RAD2DEG


def max_euler_delta_deg(bone: str, before: Quat, after: Quat) -> float | None:
    constraint = av.CONSTRAINTS.get(bone)
    if not constraint:
        return None
    e0 = av.quat_to_euler(before, constraint.order)
    e1 = av.quat_to_euler(after, constraint.order)
    return max(angle_diff_deg(e0[i], e1[i]) for i in range(3))


def classify_risk(max_delta_deg: float) -> str:
    if max_delta_deg < 1:
        return "tiny"
    if max_delta_deg < 5:
        return "low"
    if max_delta_deg < 20:
        return "medium"
    return "high"


def compare_payloads(
    before_payload: dict[str, Any],
    after_payload: dict[str, Any],
    *,
    before_name: str,
    after_name: str,
    component_eps: float = DEFAULT_COMPONENT_EPS,
    visual_eps_deg: float = DEFAULT_VISUAL_EPS_DEG,
) -> dict[str, Any]:
    before_tracks = load_channel_tracks(before_payload)
    after_tracks = load_channel_tracks(after_payload)
    bones = sorted(set(before_tracks) | set(after_tracks))
    bone_reports: list[dict[str, Any]] = []
    missing_before: list[str] = []
    missing_after: list[str] = []
    time_mismatch: list[str] = []

    totals = {
        "matchedTracks": 0,
        "matchedKeyframes": 0,
        "componentChangedKeyframes": 0,
        "visualChangedKeyframes": 0,
        "hemisphereOnlyKeyframes": 0,
        "changedBones": 0,
        "maxDeltaDeg": 0.0,
        "maxEulerDeltaDeg": 0.0,
    }
    max_change: dict[str, Any] | None = None

    for bone in bones:
        before = before_tracks.get(bone)
        after = after_tracks.get(bone)
        if before is None:
            missing_before.append(bone)
            continue
        if after is None:
            missing_after.append(bone)
            continue

        before_times = before["times"]
        after_times = after["times"]
        before_quats = before["quats"]
        after_quats = after["quats"]
        key_count = min(len(before_quats), len(after_quats))
        if len(before_quats) != len(after_quats) or before_times[:key_count] != after_times[:key_count]:
            time_mismatch.append(bone)

        totals["matchedTracks"] += 1
        totals["matchedKeyframes"] += key_count
        component_changed = 0
        visual_changed = 0
        hemisphere_only = 0
        max_delta = 0.0
        max_component = 0.0
        max_euler = 0.0
        worst: dict[str, Any] | None = None

        for i in range(key_count):
            q0 = before_quats[i]
            q1 = after_quats[i]
            raw_delta = component_delta(q0, q1)
            delta = av.quat_delta_deg(q0, q1)
            euler_delta = max_euler_delta_deg(bone, q0, q1)

            if raw_delta > component_eps:
                component_changed += 1
            if delta > visual_eps_deg:
                visual_changed += 1
            elif raw_delta > component_eps and quat_dot_raw(q0, q1) < 0:
                hemisphere_only += 1

            if delta > max_delta:
                max_delta = delta
            if raw_delta > max_component:
                max_component = raw_delta
            if euler_delta is not None and euler_delta > max_euler:
                max_euler = euler_delta

            if worst is None or delta > worst["deltaDeg"]:
                worst = {
                    "frame": i,
                    "time": before_times[i] if i < len(before_times) and math.isfinite(before_times[i]) else None,
                    "deltaDeg": round(delta, 4),
                    "componentDelta": round(raw_delta, 8),
                    "eulerDeltaDeg": round(euler_delta, 4) if euler_delta is not None else None,
                }

        totals["componentChangedKeyframes"] += component_changed
        totals["visualChangedKeyframes"] += visual_changed
        totals["hemisphereOnlyKeyframes"] += hemisphere_only
        if component_changed or visual_changed:
            totals["changedBones"] += 1
        if max_delta > totals["maxDeltaDeg"]:
            totals["maxDeltaDeg"] = max_delta
        if max_euler > totals["maxEulerDeltaDeg"]:
            totals["maxEulerDeltaDeg"] = max_euler
        if worst and (max_change is None or worst["deltaDeg"] > max_change["deltaDeg"]):
            max_change = {**worst, "bone": bone}

        if component_changed or visual_changed or hemisphere_only:
            bone_reports.append({
                "bone": bone,
                "keyframes": key_count,
                "componentChangedKeyframes": component_changed,
                "visualChangedKeyframes": visual_changed,
                "hemisphereOnlyKeyframes": hemisphere_only,
                "maxDeltaDeg": round(max_delta, 4),
                "maxEulerDeltaDeg": round(max_euler, 4),
                "maxComponentDelta": round(max_component, 8),
                "risk": classify_risk(max_delta),
                "worst": worst,
            })

    bone_reports.sort(key=lambda item: (-item["maxDeltaDeg"], -item["visualChangedKeyframes"], item["bone"]))
    summary = {
        **totals,
        "maxDeltaDeg": round(totals["maxDeltaDeg"], 4),
        "maxEulerDeltaDeg": round(totals["maxEulerDeltaDeg"], 4),
        "maxChange": max_change,
        "missingBefore": missing_before,
        "missingAfter": missing_after,
        "timeMismatch": time_mismatch,
    }
    return {
        "schemaVersion": 1,
        "inputs": {
            "before": before_name,
            "after": after_name,
        },
        "summary": summary,
        "bones": bone_reports,
    }


def write_markdown(report: dict[str, Any], path: Path) -> None:
    summary = report["summary"]
    lines = [
        f"# Animation diff: {Path(report['inputs']['before']).name}",
        "",
        f"- Before: `{report['inputs']['before']}`",
        f"- After: `{report['inputs']['after']}`",
        f"- Matched tracks: {summary['matchedTracks']}",
        f"- Matched keyframes: {summary['matchedKeyframes']}",
        f"- Changed bones: {summary['changedBones']}",
        f"- Visual changed keyframes: {summary['visualChangedKeyframes']}",
        f"- Hemisphere-only keyframes: {summary['hemisphereOnlyKeyframes']}",
        f"- Max delta: {summary['maxDeltaDeg']:.4f}deg",
        "",
    ]
    max_change = summary.get("maxChange")
    if isinstance(max_change, dict):
        lines.append(
            f"Worst visible change: `{max_change['bone']}` frame {max_change['frame']} "
            f"at {max_change.get('time')}s, {max_change['deltaDeg']:.4f}deg."
        )
        lines.append("")

    lines.extend(["## Changed Bones", ""])
    if report["bones"]:
        lines.append("| Bone | Visual keys | Component keys | Hemisphere-only | Max delta | Max Euler delta | Risk |")
        lines.append("| --- | ---: | ---: | ---: | ---: | ---: | --- |")
        for item in report["bones"]:
            lines.append(
                f"| `{item['bone']}` | {item['visualChangedKeyframes']} | "
                f"{item['componentChangedKeyframes']} | {item['hemisphereOnlyKeyframes']} | "
                f"{item['maxDeltaDeg']:.4f}deg | {item['maxEulerDeltaDeg']:.4f}deg | `{item['risk']}` |"
            )
    else:
        lines.append("No quaternion channel changes detected.")

    if summary["missingBefore"] or summary["missingAfter"] or summary["timeMismatch"]:
        lines.extend(["", "## Track Warnings", ""])
        for label, values in (
            ("Missing before", summary["missingBefore"]),
            ("Missing after", summary["missingAfter"]),
            ("Time/key mismatch", summary["timeMismatch"]),
        ):
            if values:
                lines.append(f"- {label}: {', '.join(f'`{value}`' for value in values)}")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Diff two VRM-player animation JSON files.")
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("-o", "--output", type=Path, help="Write diff JSON here")
    parser.add_argument("--summary", type=Path, help="Write Markdown summary here")
    parser.add_argument("--component-eps", type=float, default=DEFAULT_COMPONENT_EPS)
    parser.add_argument("--visual-eps-deg", type=float, default=DEFAULT_VISUAL_EPS_DEG)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    before_payload = read_json(args.before)
    after_payload = read_json(args.after)
    report = compare_payloads(
        before_payload,
        after_payload,
        before_name=str(args.before),
        after_name=str(args.after),
        component_eps=args.component_eps,
        visual_eps_deg=args.visual_eps_deg,
    )
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    if args.summary:
        write_markdown(report, args.summary)
    summary = report["summary"]
    print(
        f"diff {args.before.name} -> {args.after.name}: "
        f"{summary['changedBones']} bones, "
        f"{summary['visualChangedKeyframes']} visual keyframes, "
        f"max {summary['maxDeltaDeg']:.2f}deg"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
