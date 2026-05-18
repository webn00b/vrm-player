#!/usr/bin/env python3
"""Convert synchronized front/side videos into vrm-player multiview motion JSON."""

from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

from mediapipe_common import LM, extract_video_pose, landmark_confidence, side_indices


CANONICAL_JOINTS = [
    "hips",
    "spine",
    "chest",
    "upperChest",
    "neck",
    "head",
    "leftShoulder",
    "leftUpperArm",
    "leftLowerArm",
    "leftHand",
    "rightShoulder",
    "rightUpperArm",
    "rightLowerArm",
    "rightHand",
    "leftUpperLeg",
    "leftLowerLeg",
    "leftFoot",
    "leftToes",
    "rightUpperLeg",
    "rightLowerLeg",
    "rightFoot",
    "rightToes",
]

BONE_PAIRS = [
    ("hips", "spine"),
    ("spine", "chest"),
    ("chest", "neck"),
    ("neck", "head"),
    ("leftUpperArm", "leftLowerArm"),
    ("leftLowerArm", "leftHand"),
    ("rightUpperArm", "rightLowerArm"),
    ("rightLowerArm", "rightHand"),
    ("leftUpperLeg", "leftLowerLeg"),
    ("leftLowerLeg", "leftFoot"),
    ("rightUpperLeg", "rightLowerLeg"),
    ("rightLowerLeg", "rightFoot"),
]

BONE_NORMALIZE_ORDER = [
    ("hips", "spine"),
    ("spine", "chest"),
    ("chest", "upperChest"),
    ("upperChest", "neck"),
    ("neck", "head"),
    ("chest", "leftUpperArm"),
    ("leftUpperArm", "leftLowerArm"),
    ("leftLowerArm", "leftHand"),
    ("chest", "rightUpperArm"),
    ("rightUpperArm", "rightLowerArm"),
    ("rightLowerArm", "rightHand"),
    ("hips", "leftUpperLeg"),
    ("leftUpperLeg", "leftLowerLeg"),
    ("leftLowerLeg", "leftFoot"),
    ("leftFoot", "leftToes"),
    ("hips", "rightUpperLeg"),
    ("rightUpperLeg", "rightLowerLeg"),
    ("rightLowerLeg", "rightFoot"),
    ("rightFoot", "rightToes"),
]

DIAGNOSTIC_JOINTS = [
    "hips",
    "chest",
    "head",
    "leftHand",
    "rightHand",
    "leftFoot",
    "rightFoot",
]


def depth_from_side(position: list[float], axis: str, scale: float, offset: float) -> float:
    sign = -1.0 if axis.startswith("-") else 1.0
    axis_name = axis[-1]
    value = position[0] if axis_name == "x" else position[2]
    return sign * value * scale + offset


def image_landmark_position(
    lms: list[dict[str, float]],
    index: int,
    hips_x: float,
    hips_y: float,
    scale: float,
    mirror_x: bool,
) -> list[float]:
    lm = lms[index]
    x = (lm["x"] - hips_x) * scale
    if mirror_x:
        x = -x
    y = (hips_y - lm["y"]) * scale
    return [x, y, 0.0]


def image_confidence(lms: list[dict[str, float]], index: int) -> float:
    return float(lms[index].get("visibility", lms[index].get("presence", 1.0)))


def image_midpoint(a: list[float], b: list[float]) -> list[float]:
    return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5]


def image_body_reference(lms: list[dict[str, float]], mirror_x: bool) -> tuple[float, float, float]:
    left, right = side_indices(mirror_x)
    left_hip = lms[left["hip"]]
    right_hip = lms[right["hip"]]
    hips_x = (left_hip["x"] + right_hip["x"]) * 0.5
    hips_y = (left_hip["y"] + right_hip["y"]) * 0.5
    head_y = min(lms[LM["LEFT_EAR"]]["y"], lms[LM["RIGHT_EAR"]]["y"])
    foot_y = max(
        lms[left["ankle"]]["y"],
        lms[right["ankle"]]["y"],
        lms[left["toe"]]["y"],
        lms[right["toe"]]["y"],
    )
    image_height = max(0.15, foot_y - head_y)
    return hips_x, hips_y, 1.65 / image_height


def build_image_joints(
    frame: dict[str, Any],
    mirror_x: bool,
    visibility: float,
) -> dict[str, dict[str, Any]]:
    lms = frame.get("imageLandmarks") or []
    if len(lms) <= LM["RIGHT_FOOT_INDEX"]:
        return {}
    left, right = side_indices(mirror_x)
    hips_x, hips_y, scale = image_body_reference(lms, mirror_x)

    def pos(index: int) -> list[float]:
        return image_landmark_position(lms, index, hips_x, hips_y, scale, mirror_x)

    def conf(*indices: int) -> float:
        return min(image_confidence(lms, index) for index in indices)

    joints: dict[str, dict[str, Any]] = {}
    lh = pos(left["hip"])
    rh = pos(right["hip"])
    ls = pos(left["shoulder"])
    rs = pos(right["shoulder"])
    hips = image_midpoint(lh, rh)
    chest = image_midpoint(ls, rs)
    spine = image_midpoint(hips, chest)
    head = image_midpoint(pos(LM["LEFT_EAR"]), pos(LM["RIGHT_EAR"]))

    joints["hips"] = {"position": hips, "confidence": conf(left["hip"], right["hip"])}
    joints["spine"] = {"position": spine, "confidence": conf(left["hip"], right["hip"], left["shoulder"], right["shoulder"])}
    joints["chest"] = {"position": chest, "confidence": conf(left["shoulder"], right["shoulder"])}
    joints["upperChest"] = joints["chest"]
    joints["neck"] = {"position": image_midpoint(chest, head), "confidence": conf(left["shoulder"], right["shoulder"], LM["LEFT_EAR"], LM["RIGHT_EAR"])}
    joints["head"] = {"position": head, "confidence": conf(LM["LEFT_EAR"], LM["RIGHT_EAR"])}

    mapping = [
        ("leftUpperArm", left["shoulder"]),
        ("leftLowerArm", left["elbow"]),
        ("leftHand", left["wrist"]),
        ("rightUpperArm", right["shoulder"]),
        ("rightLowerArm", right["elbow"]),
        ("rightHand", right["wrist"]),
        ("leftUpperLeg", left["hip"]),
        ("leftLowerLeg", left["knee"]),
        ("leftFoot", left["ankle"]),
        ("leftToes", left["toe"]),
        ("rightUpperLeg", right["hip"]),
        ("rightLowerLeg", right["knee"]),
        ("rightFoot", right["ankle"]),
        ("rightToes", right["toe"]),
    ]
    for name, index in mapping:
        c = image_confidence(lms, index)
        if c >= visibility:
            joints[name] = {"position": pos(index), "confidence": c}
    return joints


def image_depth_from_side(side_position: list[float], side_depth_axis: str, depth_scale: float, depth_offset: float) -> float:
    sign = -1.0 if side_depth_axis.startswith("-") else 1.0
    # In image-orthogonal mode side X is the useful depth signal. The z options
    # are accepted for CLI compatibility but collapse to the same planar source.
    value = side_position[0]
    return sign * value * depth_scale + depth_offset


def position_range(points: list[list[float]]) -> dict[str, Any]:
    if not points:
        return {"count": 0}
    axes = {}
    for index, axis in enumerate(["x", "y", "z"]):
        vals = [p[index] for p in points]
        mn = min(vals)
        mx = max(vals)
        axes[axis] = {"min": mn, "max": mx, "span": mx - mn}
    return {"count": len(points), **axes}


def distance(a: list[float], b: list[float]) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def normalize_bone_lengths(frames: list[dict[str, Any]]) -> dict[str, float]:
    target_lengths: dict[str, float] = {}
    for parent, child in BONE_NORMALIZE_ORDER:
        values = [
            distance(frame["joints"][parent]["position"], frame["joints"][child]["position"])
            for frame in frames
            if parent in frame["joints"] and child in frame["joints"]
        ]
        values = [v for v in values if v > 1e-5]
        if values:
            target_lengths[f"{parent}-{child}"] = statistics.median(values)

    for frame in frames:
        joints = frame["joints"]
        for parent, child in BONE_NORMALIZE_ORDER:
            key = f"{parent}-{child}"
            target = target_lengths.get(key)
            if not target or parent not in joints or child not in joints:
                continue
            parent_pos = joints[parent]["position"]
            child_pos = joints[child]["position"]
            delta = [
                child_pos[0] - parent_pos[0],
                child_pos[1] - parent_pos[1],
                child_pos[2] - parent_pos[2],
            ]
            length = math.sqrt(delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2)
            if length <= 1e-5:
                continue
            scale = target / length
            joints[child]["position"] = [
                parent_pos[0] + delta[0] * scale,
                parent_pos[1] + delta[1] * scale,
                parent_pos[2] + delta[2] * scale,
            ]
    return target_lengths


def numeric_stats(values: list[float]) -> dict[str, float | int]:
    if not values:
        return {"count": 0}
    mn = min(values)
    mx = max(values)
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    stdev = math.sqrt(variance)
    return {
        "count": len(values),
        "min": mn,
        "max": mx,
        "mean": mean,
        "span": mx - mn,
        "stdev": stdev,
        "relativeStdev": stdev / mean if abs(mean) > 1e-9 else 0.0,
    }


def analyze_motion(frames: list[dict[str, Any]], joint_stats: dict[str, Any]) -> dict[str, Any]:
    joint_ranges = {}
    for joint_name in DIAGNOSTIC_JOINTS:
        points = [
            frame["joints"][joint_name]["position"]
            for frame in frames
            if joint_name in frame["joints"]
        ]
        joint_ranges[joint_name] = position_range(points)

    bone_lengths = {}
    for a, b in BONE_PAIRS:
        values = [
            distance(frame["joints"][a]["position"], frame["joints"][b]["position"])
            for frame in frames
            if a in frame["joints"] and b in frame["joints"]
        ]
        bone_lengths[f"{a}-{b}"] = numeric_stats(values)

    worst_bones = sorted(
        (
            {"bone": bone, **stats}
            for bone, stats in bone_lengths.items()
            if stats.get("count", 0)
        ),
        key=lambda item: (item.get("relativeStdev", 0), item.get("span", 0)),
        reverse=True,
    )[:8]

    root_points = [
        frame.get("root", {}).get("position")
        for frame in frames
        if frame.get("root", {}).get("position")
    ]
    contact_counts = {
        "leftFoot": sum(1 for frame in frames if frame.get("contacts", {}).get("leftFoot")),
        "rightFoot": sum(1 for frame in frames if frame.get("contacts", {}).get("rightFoot")),
    }
    low_coverage = {
        joint: stats
        for joint, stats in joint_stats.items()
        if stats.get("coverage", 1) < 0.98 or stats.get("meanConfidence", 1) < 0.75
    }

    bone_penalty = sum(float(item.get("relativeStdev", 0)) for item in worst_bones)
    root_range = position_range(root_points) if root_points else {"count": 0}
    root_motion = sum(float(root_range.get(axis, {}).get("span", 0)) for axis in ["x", "y", "z"])
    quality_score = bone_penalty + root_motion * 0.2 + len(low_coverage) * 0.25

    return {
        "qualityScore": quality_score,
        "jointRanges": joint_ranges,
        "rootRange": root_range,
        "boneLengths": bone_lengths,
        "worstBones": worst_bones,
        "lowCoverageJoints": low_coverage,
        "contactCounts": contact_counts,
    }


def combine_confidence(front_conf: float, side_conf: float) -> float:
    return 1.0 - (1.0 - front_conf) * (1.0 - side_conf)


def weighted_average(a: float, b: float, wa: float, wb: float) -> float:
    total = wa + wb
    if total <= 1e-6:
        return (a + b) * 0.5
    return (a * wa + b * wb) / total


def fuse_joint(
    name: str,
    front_joint: dict[str, Any] | None,
    side_joint: dict[str, Any] | None,
    previous: dict[str, list[float]],
    side_depth_axis: str,
    depth_scale: float,
    depth_offset: float,
) -> tuple[dict[str, Any] | None, str]:
    if front_joint and side_joint:
        front_pos = front_joint["position"]
        side_pos = side_joint["position"]
        front_conf = float(front_joint.get("confidence", 1.0))
        side_conf = float(side_joint.get("confidence", 1.0))
        position = [
            front_pos[0],
            weighted_average(front_pos[1], side_pos[1], front_conf, side_conf),
            depth_from_side(side_pos, side_depth_axis, depth_scale, depth_offset),
        ]
        previous[name] = position
        return {"position": position, "confidence": combine_confidence(front_conf, side_conf)}, "fused"

    if front_joint:
        front_pos = front_joint["position"]
        prev = previous.get(name)
        z = prev[2] if prev else front_pos[2] * 0.25
        position = [front_pos[0], front_pos[1], z]
        previous[name] = position
        return {
            "position": position,
            "confidence": float(front_joint.get("confidence", 1.0)) * 0.5,
        }, "frontOnly"

    if side_joint:
        side_pos = side_joint["position"]
        prev = previous.get(name)
        x = prev[0] if prev else 0.0
        position = [
            x,
            side_pos[1],
            depth_from_side(side_pos, side_depth_axis, depth_scale, depth_offset),
        ]
        previous[name] = position
        return {
            "position": position,
            "confidence": float(side_joint.get("confidence", 1.0)) * 0.5,
        }, "sideOnly"

    return None, "missing"


def fuse_image_joint(
    name: str,
    front_joint: dict[str, Any] | None,
    side_joint: dict[str, Any] | None,
    previous: dict[str, list[float]],
    side_depth_axis: str,
    depth_scale: float,
    depth_offset: float,
) -> tuple[dict[str, Any] | None, str]:
    if front_joint and side_joint:
        front_pos = front_joint["position"]
        side_pos = side_joint["position"]
        front_conf = float(front_joint.get("confidence", 1.0))
        side_conf = float(side_joint.get("confidence", 1.0))
        position = [
            front_pos[0],
            weighted_average(front_pos[1], side_pos[1], front_conf, side_conf),
            image_depth_from_side(side_pos, side_depth_axis, depth_scale, depth_offset),
        ]
        previous[name] = position
        return {"position": position, "confidence": combine_confidence(front_conf, side_conf)}, "fused"

    if front_joint:
        front_pos = front_joint["position"]
        prev = previous.get(name)
        position = [front_pos[0], front_pos[1], prev[2] if prev else 0.0]
        previous[name] = position
        return {"position": position, "confidence": float(front_joint.get("confidence", 1.0)) * 0.5}, "frontOnly"

    if side_joint:
        side_pos = side_joint["position"]
        prev = previous.get(name)
        position = [
            prev[0] if prev else 0.0,
            side_pos[1],
            image_depth_from_side(side_pos, side_depth_axis, depth_scale, depth_offset),
        ]
        previous[name] = position
        return {"position": position, "confidence": float(side_joint.get("confidence", 1.0)) * 0.5}, "sideOnly"

    return None, "missing"


def detect_foot_contacts(frames: list[dict[str, Any]]) -> None:
    foot_names = [("leftFoot", "leftFoot"), ("rightFoot", "rightFoot")]
    foot_floor = {}
    for joint_name, _contact_name in foot_names:
        ys = [
            frame["joints"][joint_name]["position"][1]
            for frame in frames
            if joint_name in frame["joints"]
        ]
        if ys:
            foot_floor[joint_name] = min(ys)

    for frame in frames:
        contacts: dict[str, bool] = {}
        for joint_name, contact_name in foot_names:
            joint = frame["joints"].get(joint_name)
            floor = foot_floor.get(joint_name)
            if not joint or floor is None:
                continue
            contacts[contact_name] = abs(joint["position"][1] - floor) < 0.04
        if contacts:
            frame["contacts"] = contacts


def smooth_positions(frames: list[dict[str, Any]], alpha: float) -> None:
    if alpha >= 1.0:
        return
    alpha = max(0.05, min(1.0, alpha))
    last_by_joint: dict[str, list[float]] = {}
    last_root: list[float] | None = None
    for frame in frames:
        root_pos = frame.get("root", {}).get("position")
        if root_pos and last_root:
            root_pos[:] = [
                last_root[0] + (root_pos[0] - last_root[0]) * alpha,
                last_root[1] + (root_pos[1] - last_root[1]) * alpha,
                last_root[2] + (root_pos[2] - last_root[2]) * alpha,
            ]
        if root_pos:
            last_root = list(root_pos)

        for joint_name, joint in frame["joints"].items():
            pos = joint.get("position")
            if not pos:
                continue
            last = last_by_joint.get(joint_name)
            if last:
                pos[:] = [
                    last[0] + (pos[0] - last[0]) * alpha,
                    last[1] + (pos[1] - last[1]) * alpha,
                    last[2] + (pos[2] - last[2]) * alpha,
                ]
            last_by_joint[joint_name] = list(pos)


def fuse_frames(
    front_frames: list[dict[str, Any]],
    side_frames: list[dict[str, Any]],
    fps: float,
    side_offset_frames: int,
    side_depth_axis: str,
    depth_scale: float,
    depth_offset: float,
    mode: str = "rough-orthogonal",
    front_mirror_x: bool = True,
    side_mirror_x: bool = True,
    visibility: float = 0.35,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    previous: dict[str, list[float]] = {}
    stats: dict[str, dict[str, float]] = defaultdict(lambda: {
        "fused": 0,
        "frontOnly": 0,
        "sideOnly": 0,
        "missing": 0,
        "confidenceSum": 0.0,
    })

    for front_index, front in enumerate(front_frames):
        side_index = front_index + side_offset_frames
        if side_index < 0 or side_index >= len(side_frames):
            continue
        side = side_frames[side_index]
        if mode == "image-orthogonal":
            front_joints = build_image_joints(front, front_mirror_x, visibility)
            side_joints = build_image_joints(side, side_mirror_x, visibility)
            joint_fuser = fuse_image_joint
        else:
            front_joints = front["joints"]
            side_joints = side["joints"]
            joint_fuser = fuse_joint
        joints: dict[str, dict[str, Any]] = {}

        for joint_name in CANONICAL_JOINTS:
            joint, state = joint_fuser(
                joint_name,
                front_joints.get(joint_name),
                side_joints.get(joint_name),
                previous,
                side_depth_axis,
                depth_scale,
                depth_offset,
            )
            stats[joint_name][state] += 1
            if joint:
                stats[joint_name]["confidenceSum"] += float(joint.get("confidence", 0.0))
                joints[joint_name] = joint

        hips = joints.get("hips")
        if not hips:
            continue
        frames.append({
            "time": len(frames) / fps,
            "root": {"position": hips["position"]},
            "joints": joints,
        })

    report_stats = {}
    for joint_name, joint_stats in stats.items():
        present = joint_stats["fused"] + joint_stats["frontOnly"] + joint_stats["sideOnly"]
        total = present + joint_stats["missing"]
        report_stats[joint_name] = {
            "fusedFrames": int(joint_stats["fused"]),
            "frontOnlyFrames": int(joint_stats["frontOnly"]),
            "sideOnlyFrames": int(joint_stats["sideOnly"]),
            "missingFrames": int(joint_stats["missing"]),
            "meanConfidence": joint_stats["confidenceSum"] / present if present else 0.0,
            "coverage": present / total if total else 0.0,
        }
    return frames, report_stats


def make_fused_variant(
    front_frames: list[dict[str, Any]],
    side_frames: list[dict[str, Any]],
    fps: float,
    side_offset_frames: int,
    side_depth_axis: str,
    depth_scale: float,
    depth_offset: float,
    smoothing_alpha: float,
    mode: str = "rough-orthogonal",
    front_mirror_x: bool = True,
    side_mirror_x: bool = True,
    visibility: float = 0.35,
    normalize_lengths: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    frames, joint_stats = fuse_frames(
        front_frames,
        side_frames,
        fps=fps,
        side_offset_frames=side_offset_frames,
        side_depth_axis=side_depth_axis,
        depth_scale=depth_scale,
        depth_offset=depth_offset,
        mode=mode,
        front_mirror_x=front_mirror_x,
        side_mirror_x=side_mirror_x,
        visibility=visibility,
    )
    smooth_positions(frames, smoothing_alpha)
    target_lengths = normalize_bone_lengths(frames) if normalize_lengths else {}
    detect_foot_contacts(frames)
    analysis = analyze_motion(frames, joint_stats)
    analysis["normalizedBoneLengths"] = target_lengths
    return frames, joint_stats, analysis


def run_candidate_analysis(
    front_frames: list[dict[str, Any]],
    side_frames: list[dict[str, Any]],
    fps: float,
    base_offset: int,
    smoothing_alpha: float,
    mode: str = "rough-orthogonal",
    front_mirror_x: bool = True,
    side_mirror_x: bool = True,
    visibility: float = 0.35,
    normalize_lengths: bool = True,
) -> list[dict[str, Any]]:
    candidates = []
    for offset in range(base_offset - 2, base_offset + 3):
        for axis in ["x", "-x", "z", "-z"]:
            for scale in [0.5, 0.75, 1.0, 1.25, 1.5]:
                frames, joint_stats, analysis = make_fused_variant(
                    front_frames,
                    side_frames,
                    fps=fps,
                    side_offset_frames=offset,
                    side_depth_axis=axis,
                    depth_scale=scale,
                    depth_offset=0.0,
                    smoothing_alpha=smoothing_alpha,
                    mode=mode,
                    front_mirror_x=front_mirror_x,
                    side_mirror_x=side_mirror_x,
                    visibility=visibility,
                    normalize_lengths=normalize_lengths,
                )
                candidates.append({
                    "sideOffsetFrames": offset,
                    "sideDepthAxis": axis,
                    "depthScale": scale,
                    "framesWritten": len(frames),
                    "qualityScore": analysis["qualityScore"],
                    "worstBones": analysis["worstBones"][:4],
                    "rootRange": analysis["rootRange"],
                    "lowCoverageJoints": analysis["lowCoverageJoints"],
                    "jointStatsSummary": {
                        "leftHand": joint_stats.get("leftHand"),
                        "rightHand": joint_stats.get("rightHand"),
                        "leftFoot": joint_stats.get("leftFoot"),
                        "rightFoot": joint_stats.get("rightFoot"),
                    },
                })
    return sorted(candidates, key=lambda c: (c["qualityScore"], -c["framesWritten"]))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--front", type=Path, required=True)
    parser.add_argument("--side", type=Path, required=True)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--fps", type=float, default=0.0, help="Target FPS; 0 keeps source FPS.")
    parser.add_argument("--side-offset-frames", type=int, default=0)
    parser.add_argument("--front-mirror-x", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--side-mirror-x", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--visibility", type=float, default=0.35)
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--mode", choices=["rough-orthogonal", "image-orthogonal"], default="rough-orthogonal")
    parser.add_argument("--side-depth-axis", choices=["x", "z", "-x", "-z"], default="x")
    parser.add_argument("--depth-scale", type=float, default=1.0)
    parser.add_argument("--depth-offset", type=float, default=0.0)
    parser.add_argument("--smoothing-alpha", type=float, default=0.65)
    parser.add_argument("--normalize-bone-lengths", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--analyze-candidates", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--debug", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args()

    output = args.output or args.front.with_suffix(".multiview.motion.json")
    front = extract_video_pose(
        args.front,
        target_fps=args.fps,
        mirror_x=args.front_mirror_x,
        visibility=args.visibility,
        max_frames=args.max_frames,
        include_debug=args.debug or args.mode == "image-orthogonal",
    )
    side = extract_video_pose(
        args.side,
        target_fps=args.fps,
        mirror_x=args.side_mirror_x,
        visibility=args.visibility,
        max_frames=args.max_frames + max(0, args.side_offset_frames) if args.max_frames else 0,
        include_debug=args.debug or args.mode == "image-orthogonal",
    )
    fps = args.fps if args.fps > 0 else min(float(front["fps"]), float(side["fps"]))
    frames, joint_stats, analysis = make_fused_variant(
        front["frames"],
        side["frames"],
        fps=fps,
        side_offset_frames=args.side_offset_frames,
        side_depth_axis=args.side_depth_axis,
        depth_scale=args.depth_scale,
        depth_offset=args.depth_offset,
        smoothing_alpha=args.smoothing_alpha,
        mode=args.mode,
        front_mirror_x=args.front_mirror_x,
        side_mirror_x=args.side_mirror_x,
        visibility=args.visibility,
        normalize_lengths=args.normalize_bone_lengths,
    )

    payload = {
        "version": 1,
        "name": output.stem,
        "source": "multiview",
        "fps": fps,
        "coordinateSpace": "vrm",
        "adapter": {
            "runtime": "mediapipe",
            "views": ["front", "side"],
            "inputs": {"front": str(args.front), "side": str(args.side)},
            "sync": {"sideFrameOffset": args.side_offset_frames},
            "calibration": {
                "mode": args.mode,
                "sideDepthAxis": args.side_depth_axis,
                "depthScale": args.depth_scale,
                "depthOffset": args.depth_offset,
            },
            "frontMirrorX": args.front_mirror_x,
            "sideMirrorX": args.side_mirror_x,
            "visibility": args.visibility,
        },
        "frames": frames,
    }
    write_json(output, payload)

    if args.debug:
        write_json(output.with_suffix(".front.pose.json"), front)
        write_json(output.with_suffix(".side.pose.json"), side)

    report = {
        "framesRead": {"front": front["framesRead"], "side": side["framesRead"]},
        "framesDetected": {"front": front["framesDetected"], "side": side["framesDetected"]},
        "framesWritten": len(frames),
        "fps": fps,
        "sync": {"sideOffsetFrames": args.side_offset_frames},
        "calibration": {
            "mode": args.mode,
            "sideDepthAxis": args.side_depth_axis,
            "depthScale": args.depth_scale,
            "depthOffset": args.depth_offset,
        },
        "jointStats": joint_stats,
    }
    write_json(output.with_suffix(".fusion.report.json"), report)
    candidates = run_candidate_analysis(
        front["frames"],
        side["frames"],
        fps=fps,
        base_offset=args.side_offset_frames,
        smoothing_alpha=args.smoothing_alpha,
        mode=args.mode,
        front_mirror_x=args.front_mirror_x,
        side_mirror_x=args.side_mirror_x,
        visibility=args.visibility,
        normalize_lengths=args.normalize_bone_lengths,
    ) if args.analyze_candidates else []
    analysis_payload = {
        "selected": {
            "sideOffsetFrames": args.side_offset_frames,
            "sideDepthAxis": args.side_depth_axis,
            "depthScale": args.depth_scale,
            "depthOffset": args.depth_offset,
            "smoothingAlpha": args.smoothing_alpha,
            "normalizeBoneLengths": args.normalize_bone_lengths,
            "framesWritten": len(frames),
            "qualityScore": analysis["qualityScore"],
        },
        "framesRead": report["framesRead"],
        "framesDetected": report["framesDetected"],
        "selectedAnalysis": analysis,
        "candidateSearch": {
            "enabled": args.analyze_candidates,
            "top": candidates[:12],
            "count": len(candidates),
        },
        "notes": [
            "Lower qualityScore is better; it combines bone-length drift, root drift and low-coverage penalties.",
            "Large relativeStdev in worstBones means the fused skeleton changes limb length too much.",
            "This diagnostic ranks rough-orthogonal options only; it is not true calibrated triangulation.",
        ],
    }
    write_json(output.with_suffix(".fusion.analysis.json"), analysis_payload)
    print(f"wrote {output} ({len(frames)} frames at {fps:g} fps)")
    print(f"wrote {output.with_suffix('.fusion.report.json')}")
    print(f"wrote {output.with_suffix('.fusion.analysis.json')}")


if __name__ == "__main__":
    main()
