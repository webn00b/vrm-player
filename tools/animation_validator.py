#!/usr/bin/env python3
"""Offline animation validator for VRM-player motion traces.

The validator intentionally depends only on the Python standard library. It can
read two input shapes:

1. A future motion trace exported by the player:
   {"fps": 30, "frames": [{"time": 0, "bones": {"hips": {"localQuat": [...]}}}]}

2. Existing animation JSON files produced by this repo:
   {"duration": 3, "channels": {"hips": {"times": [...], "values": [...]}}}

It emits a machine-readable report and an optional Markdown summary. The report
is designed as an "AI evidence pack": each issue includes where it happened,
what was expected, what was observed, and a likely fix hypothesis.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


Vec3 = tuple[float, float, float]
Quat = tuple[float, float, float, float]


RAD2DEG = 180.0 / math.pi
DEG2RAD = math.pi / 180.0
EPS = 1e-9


def d(deg: float) -> float:
    return deg * DEG2RAD


@dataclass(frozen=True)
class RotationConstraint:
    order: str
    min: Vec3
    max: Vec3


def c(order: str, mins: tuple[float, float, float], maxs: tuple[float, float, float]) -> RotationConstraint:
    return RotationConstraint(order, tuple(d(v) for v in mins), tuple(d(v) for v in maxs))


# Mirrors the body constraints from src/validation/boneConstraints.ts. Fingers
# are intentionally omitted for the MVP because most animation-debug failures in
# this project happen in the body retarget chain.
CONSTRAINTS: dict[str, RotationConstraint] = {
    "hips": c("YXZ", (-30, -90, -30), (30, 90, 30)),
    "spine": c("YXZ", (-25, -20, -20), (35, 20, 20)),
    "chest": c("YXZ", (-25, -20, -20), (35, 20, 20)),
    "upperChest": c("YXZ", (-25, -20, -20), (35, 20, 20)),
    "neck": c("YXZ", (-45, -70, -40), (60, 70, 40)),
    "head": c("YXZ", (-30, -40, -30), (40, 40, 30)),
    "leftShoulder": c("YXZ", (-20, -20, -20), (30, 20, 30)),
    "rightShoulder": c("YXZ", (-20, -20, -20), (30, 20, 30)),
    "leftUpperArm": c("YXZ", (-80, -110, -60), (110, 110, 180)),
    "rightUpperArm": c("YXZ", (-80, -110, -60), (110, 110, 180)),
    "leftLowerArm": c("XYZ", (-10, -90, -10), (150, 90, 10)),
    "rightLowerArm": c("XYZ", (-10, -90, -10), (150, 90, 10)),
    "leftHand": c("XYZ", (-80, -30, -80), (70, 20, 80)),
    "rightHand": c("XYZ", (-80, -30, -80), (70, 20, 80)),
    "leftUpperLeg": c("YXZ", (-30, -45, -30), (125, 45, 45)),
    "rightUpperLeg": c("YXZ", (-30, -45, -30), (125, 45, 45)),
    "leftLowerLeg": c("XYZ", (-5, -10, -5), (140, 10, 5)),
    "rightLowerLeg": c("XYZ", (-5, -10, -5), (140, 10, 5)),
    "leftFoot": c("XYZ", (-50, -30, -35), (30, 30, 15)),
    "rightFoot": c("XYZ", (-50, -30, -35), (30, 30, 15)),
    "leftToes": c("XYZ", (-30, -10, -10), (60, 10, 10)),
    "rightToes": c("XYZ", (-30, -10, -10), (60, 10, 10)),
}


BONE_ALIASES = {
    "".join(ch for ch in name.lower() if ch.isalnum()): name for name in CONSTRAINTS
}
BONE_ALIASES.update({
    "leftupleg": "leftUpperLeg",
    "rightupleg": "rightUpperLeg",
    "leftleg": "leftLowerLeg",
    "rightleg": "rightLowerLeg",
    "leftarm": "leftUpperArm",
    "rightarm": "rightUpperArm",
    "leftforearm": "leftLowerArm",
    "rightforearm": "rightLowerArm",
})


PARENT_CHILDREN = {
    "hips": ["spine", "leftUpperLeg", "rightUpperLeg"],
    "spine": ["chest"],
    "chest": ["upperChest", "leftShoulder", "rightShoulder"],
    "upperChest": ["neck", "leftShoulder", "rightShoulder"],
    "neck": ["head"],
    "leftShoulder": ["leftUpperArm"],
    "rightShoulder": ["rightUpperArm"],
    "leftUpperArm": ["leftLowerArm"],
    "rightUpperArm": ["rightLowerArm"],
    "leftLowerArm": ["leftHand"],
    "rightLowerArm": ["rightHand"],
    "leftUpperLeg": ["leftLowerLeg"],
    "rightUpperLeg": ["rightLowerLeg"],
    "leftLowerLeg": ["leftFoot"],
    "rightLowerLeg": ["rightFoot"],
    "leftFoot": ["leftToes"],
    "rightFoot": ["rightToes"],
}


@dataclass
class BoneSample:
    local_quat: Quat | None = None
    world_pos: Vec3 | None = None


@dataclass
class FrameSample:
    index: int
    time: float
    bones: dict[str, BoneSample] = field(default_factory=dict)


@dataclass
class MotionTrace:
    name: str
    source_format: str
    fps: float
    duration: float
    frames: list[FrameSample]


@dataclass
class ValidatorOptions:
    floor_y: float = 0.0
    ground_tolerance: float = 0.03
    foot_contact_height: float = 0.08
    foot_slide_speed: float = 0.45
    flip_deg: float = 60.0
    quat_norm_tolerance: float = 0.02
    hip_drift_y: float = 0.20
    bone_length_relative_tolerance: float = 0.12
    rom_tolerance_deg: float = 0.05
    max_issues: int = 250


def finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def as_float_tuple(values: Any, length: int) -> tuple[float, ...] | None:
    if not isinstance(values, (list, tuple)) or len(values) != length:
        return None
    out = []
    for value in values:
        if not finite_number(value):
            return None
        out.append(float(value))
    return tuple(out)


def canonical_bone_name(name: str) -> str:
    key = "".join(ch for ch in name.lower() if ch.isalnum())
    return BONE_ALIASES.get(key, name)


def quat_norm(q: Quat) -> float:
    return math.sqrt(sum(v * v for v in q))


def normalize_quat(q: Quat) -> Quat:
    n = quat_norm(q)
    if n < EPS:
        return q
    return (q[0] / n, q[1] / n, q[2] / n, q[3] / n)


def quat_raw_dot(a: Quat, b: Quat) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]


def quat_delta_deg(a: Quat, b: Quat) -> float:
    dot = abs(quat_raw_dot(normalize_quat(a), normalize_quat(b)))
    dot = max(-1.0, min(1.0, dot))
    return 2.0 * math.acos(dot) * RAD2DEG


def quat_to_euler(q: Quat, order: str) -> Vec3:
    x, y, z, w = normalize_quat(q)
    xx, yy, zz, ww = x * x, y * y, z * z, w * w
    m00 = ww + xx - yy - zz
    m01 = 2 * (x * y - z * w)
    m02 = 2 * (x * z + y * w)
    m10 = 2 * (x * y + z * w)
    m11 = ww - xx + yy - zz
    m12 = 2 * (y * z - x * w)
    m20 = 2 * (x * z - y * w)
    m21 = 2 * (y * z + x * w)
    m22 = ww - xx - yy + zz

    def clamp(v: float) -> float:
        return -1.0 if v < -1.0 else 1.0 if v > 1.0 else v

    ex = ey = ez = 0.0
    if order == "XYZ":
        ey = math.asin(clamp(m02))
        if abs(m02) < 0.9999999:
            ex = math.atan2(-m12, m22)
            ez = math.atan2(-m01, m00)
        else:
            ex = math.atan2(m21, m11)
    elif order == "YXZ":
        ex = math.asin(-clamp(m12))
        if abs(m12) < 0.9999999:
            ey = math.atan2(m02, m22)
            ez = math.atan2(m10, m11)
        else:
            ey = math.atan2(-m20, m00)
    elif order == "ZXY":
        ex = math.asin(clamp(m21))
        if abs(m21) < 0.9999999:
            ey = math.atan2(-m20, m22)
            ez = math.atan2(-m01, m11)
        else:
            ez = math.atan2(m10, m00)
    elif order == "ZYX":
        ey = math.asin(-clamp(m20))
        if abs(m20) < 0.9999999:
            ex = math.atan2(m21, m22)
            ez = math.atan2(m10, m00)
        else:
            ez = math.atan2(-m01, m11)
    elif order == "YZX":
        ez = math.asin(clamp(m10))
        if abs(m10) < 0.9999999:
            ex = math.atan2(-m12, m11)
            ey = math.atan2(-m20, m00)
        else:
            ey = math.atan2(m02, m22)
    elif order == "XZY":
        ez = math.asin(-clamp(m01))
        if abs(m01) < 0.9999999:
            ex = math.atan2(m21, m11)
            ey = math.atan2(m02, m00)
        else:
            ex = math.atan2(-m12, m22)
    else:
        raise ValueError(f"Unsupported Euler order: {order}")
    return (ex, ey, ez)


def vec_distance(a: Vec3, b: Vec3) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def horizontal_distance(a: Vec3, b: Vec3) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2)


def extract_quat(sample: Any) -> Quat | None:
    if isinstance(sample, dict):
        for key in ("localQuat", "localQuaternion", "quaternion", "quat", "q"):
            quat = as_float_tuple(sample.get(key), 4)
            if quat is not None:
                return quat  # type: ignore[return-value]
    return as_float_tuple(sample, 4)  # type: ignore[return-value]


def extract_world_pos(sample: Any) -> Vec3 | None:
    if not isinstance(sample, dict):
        return None
    for key in ("worldPos", "worldPosition", "position", "pos"):
        pos = as_float_tuple(sample.get(key), 3)
        if pos is not None:
            return pos  # type: ignore[return-value]
    return None


def load_motion_trace(path: Path) -> MotionTrace:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("Top-level JSON value must be an object")

    name = str(payload.get("name") or path.stem)
    fps = float(payload.get("fps") or payload.get("sampleRate") or 30.0)
    if "frames" in payload:
        return parse_frame_trace(name, fps, payload)
    if "bones" in payload:
        return parse_bone_array_trace(name, fps, payload)
    if "channels" in payload:
        return parse_channel_animation(name, fps, payload)
    raise ValueError("Unsupported trace: expected frames, bones, or channels")


def parse_frame_trace(name: str, fps: float, payload: dict[str, Any]) -> MotionTrace:
    frames: list[FrameSample] = []
    raw_frames = payload.get("frames")
    if not isinstance(raw_frames, list):
        raise ValueError("frames must be a list")
    for index, raw_frame in enumerate(raw_frames):
        if not isinstance(raw_frame, dict):
            continue
        time = float(raw_frame.get("time", index / fps))
        frame = FrameSample(index=index, time=time)
        raw_bones = raw_frame.get("bones")
        if not isinstance(raw_bones, dict):
            raw_bones = raw_frame.get("joints", {})
        if isinstance(raw_bones, dict):
            for raw_name, raw_sample in raw_bones.items():
                bone = canonical_bone_name(str(raw_name))
                frame.bones[bone] = BoneSample(
                    local_quat=extract_quat(raw_sample),
                    world_pos=extract_world_pos(raw_sample),
                )
        if "hips" not in frame.bones and isinstance(raw_frame.get("root"), dict):
            root_pos = extract_world_pos(raw_frame["root"])
            if root_pos is not None:
                frame.bones["hips"] = BoneSample(world_pos=root_pos)
        frames.append(frame)
    duration = float(payload.get("duration", frames[-1].time if frames else 0.0))
    return MotionTrace(name, "frames", fps, duration, frames)


def parse_bone_array_trace(name: str, fps: float, payload: dict[str, Any]) -> MotionTrace:
    raw_bones = payload.get("bones")
    if not isinstance(raw_bones, dict):
        raise ValueError("bones must be an object")
    times = payload.get("times")
    frame_count = 0
    for raw_sample in raw_bones.values():
        if not isinstance(raw_sample, dict):
            continue
        for key in ("localQuat", "localQuats", "quaternions", "worldPos", "worldPositions"):
            value = raw_sample.get(key)
            if isinstance(value, list):
                frame_count = max(frame_count, len(value))
    if isinstance(times, list):
        frame_count = max(frame_count, len(times))

    frames = [
        FrameSample(
            index=i,
            time=float(times[i]) if isinstance(times, list) and i < len(times) and finite_number(times[i]) else i / fps,
        )
        for i in range(frame_count)
    ]
    for raw_name, raw_track in raw_bones.items():
        if not isinstance(raw_track, dict):
            continue
        bone = canonical_bone_name(str(raw_name))
        quats = first_list(raw_track, ("localQuat", "localQuats", "quaternions", "quat"))
        positions = first_list(raw_track, ("worldPos", "worldPositions", "positions"))
        for i, frame in enumerate(frames):
            local_quat = extract_quat(quats[i]) if quats and i < len(quats) else None
            world_pos = as_float_tuple(positions[i], 3) if positions and i < len(positions) else None
            frame.bones[bone] = BoneSample(local_quat=local_quat, world_pos=world_pos)  # type: ignore[arg-type]
    duration = float(payload.get("duration", frames[-1].time if frames else 0.0))
    return MotionTrace(name, "bones", fps, duration, frames)


def first_list(raw: dict[str, Any], keys: Iterable[str]) -> list[Any] | None:
    for key in keys:
        value = raw.get(key)
        if isinstance(value, list):
            return value
    return None


def parse_channel_animation(name: str, fps: float, payload: dict[str, Any]) -> MotionTrace:
    channels = payload.get("channels")
    if not isinstance(channels, dict):
        raise ValueError("channels must be an object")

    # Channels can have different sample counts. Use a sparse time map so each
    # source keyframe is checked exactly at its authored timestamp.
    frame_by_time: dict[float, FrameSample] = {}

    def get_frame(time: float) -> FrameSample:
        key = round(time, 8)
        frame = frame_by_time.get(key)
        if frame is None:
            frame = FrameSample(index=0, time=time)
            frame_by_time[key] = frame
        return frame

    for raw_name, raw_channel in channels.items():
        if not isinstance(raw_channel, dict):
            continue
        times = raw_channel.get("times")
        values = raw_channel.get("values")
        if not isinstance(times, list) or not isinstance(values, list):
            continue
        if len(times) == 0 or len(values) != len(times) * 4:
            continue
        bone = canonical_bone_name(str(raw_name))
        for i, raw_time in enumerate(times):
            if not finite_number(raw_time):
                continue
            quat = as_float_tuple(values[i * 4 : i * 4 + 4], 4)
            if quat is None:
                continue
            get_frame(float(raw_time)).bones[bone] = BoneSample(local_quat=quat)  # type: ignore[arg-type]

    frames = [frame_by_time[key] for key in sorted(frame_by_time)]
    for i, frame in enumerate(frames):
        frame.index = i
    duration = float(payload.get("duration", frames[-1].time if frames else 0.0))
    return MotionTrace(name, "channels", fps, duration, frames)


class AnimationValidator:
    def __init__(self, options: ValidatorOptions):
        self.options = options
        self.issues: list[dict[str, Any]] = []
        self.suppressed_issue_count = 0
        self.counters: dict[str, int] = {}

    def validate(self, trace: MotionTrace) -> dict[str, Any]:
        self.issues = []
        self.suppressed_issue_count = 0
        self.counters = {}

        self.check_quaternions(trace)
        self.check_foot_motion(trace)
        self.check_hip_drift(trace)
        self.check_bone_lengths(trace)

        severity_counts: dict[str, int] = {}
        category_counts: dict[str, int] = {}
        for issue in self.issues:
            severity_counts[issue["severity"]] = severity_counts.get(issue["severity"], 0) + 1
            category_counts[issue["category"]] = category_counts.get(issue["category"], 0) + 1

        return {
            "schemaVersion": 1,
            "trace": {
                "name": trace.name,
                "sourceFormat": trace.source_format,
                "fps": trace.fps,
                "duration": trace.duration,
                "frameCount": len(trace.frames),
            },
            "summary": {
                "issueCount": len(self.issues),
                "suppressedIssueCount": self.suppressed_issue_count,
                "severityCounts": severity_counts,
                "categoryCounts": category_counts,
                "rawEventCounts": self.counters,
            },
            "issues": self.issues,
        }

    def add_issue(
        self,
        *,
        severity: str,
        category: str,
        issue_id: str,
        frame: FrameSample,
        bones: list[str],
        metric: str,
        expected: str,
        actual: str,
        likely_cause: str,
        suggested_fix: str,
        evidence: dict[str, Any] | None = None,
    ) -> None:
        self.counters[category] = self.counters.get(category, 0) + 1
        if len(self.issues) >= self.options.max_issues:
            self.suppressed_issue_count += 1
            return
        self.issues.append({
            "id": issue_id,
            "severity": severity,
            "category": category,
            "timeStart": round(frame.time, 6),
            "timeEnd": round(frame.time, 6),
            "frameStart": frame.index,
            "frameEnd": frame.index,
            "bones": bones,
            "metric": metric,
            "expected": expected,
            "actual": actual,
            "likelyCause": likely_cause,
            "suggestedFix": suggested_fix,
            "evidence": evidence or {},
        })

    def check_quaternions(self, trace: MotionTrace) -> None:
        prev_quat_by_bone: dict[str, tuple[FrameSample, Quat]] = {}
        delta_by_bone: dict[str, list[tuple[FrameSample, float]]] = {}

        for frame in trace.frames:
            for bone, sample in frame.bones.items():
                q = sample.local_quat
                if q is None:
                    continue
                if not all(math.isfinite(v) for v in q):
                    self.add_issue(
                        severity="error",
                        category="nan",
                        issue_id="nan-quaternion",
                        frame=frame,
                        bones=[bone],
                        metric="local quaternion",
                        expected="all components finite",
                        actual=str(q),
                        likely_cause="A solver or retarget step produced invalid math.",
                        suggested_fix="Trace the writer for this bone and guard divisions, acos/asin inputs, and zero-length vectors.",
                    )
                    continue

                norm = quat_norm(q)
                if abs(norm - 1.0) > self.options.quat_norm_tolerance:
                    self.add_issue(
                        severity="warning",
                        category="quat-norm",
                        issue_id="non-unit-quaternion",
                        frame=frame,
                        bones=[bone],
                        metric="|q|",
                        expected=f"1.0 +/- {self.options.quat_norm_tolerance:.3f}",
                        actual=f"{norm:.5f}",
                        likely_cause="Quaternion was accumulated or interpolated without normalization.",
                        suggested_fix="Normalize quaternion tracks after retargeting and before validation/playback.",
                        evidence={"quat": list(q), "norm": norm},
                    )

                constraint = CONSTRAINTS.get(bone)
                if constraint:
                    self.check_rom(frame, bone, q, constraint)

                prev = prev_quat_by_bone.get(bone)
                if prev:
                    prev_frame, prev_q = prev
                    delta = quat_delta_deg(prev_q, q)
                    delta_by_bone.setdefault(bone, []).append((frame, delta))
                    raw_dot = quat_raw_dot(normalize_quat(prev_q), normalize_quat(q))
                    if raw_dot < -0.95 and delta < 5:
                        self.add_issue(
                            severity="warning",
                            category="flip",
                            issue_id="antipodal-quaternion-sign-flip",
                            frame=frame,
                            bones=[bone],
                            metric="raw quaternion dot",
                            expected=">= -0.95 or geometric delta > 5deg",
                            actual=f"dot={raw_dot:.4f}, delta={delta:.2f}deg",
                            likely_cause="The track flips quaternion hemisphere between adjacent keys.",
                            suggested_fix="Run quaternion continuity pass and keep adjacent keyframes in the same hemisphere.",
                            evidence={"previousFrame": prev_frame.index, "rawDot": raw_dot, "deltaDeg": delta},
                        )
                    elif delta > self.options.flip_deg:
                        self.add_issue(
                            severity="error",
                            category="flip",
                            issue_id="large-quaternion-step",
                            frame=frame,
                            bones=[bone],
                            metric="adjacent quaternion delta",
                            expected=f"<= {self.options.flip_deg:.1f}deg/frame",
                            actual=f"{delta:.2f}deg",
                            likely_cause="Retarget mapping, Euler unwrap, or source mocap tracking jumped between frames.",
                            suggested_fix="Inspect this frame in the retarget stage; smooth/unwrap source rotation before building the track.",
                            evidence={"previousFrame": prev_frame.index, "deltaDeg": delta},
                        )
                prev_quat_by_bone[bone] = (frame, q)

        self.check_jitter(delta_by_bone)

    def check_rom(self, frame: FrameSample, bone: str, q: Quat, constraint: RotationConstraint) -> None:
        euler = quat_to_euler(q, constraint.order)
        tol = self.options.rom_tolerance_deg * DEG2RAD
        axis_names = ("x", "y", "z")
        for i, axis in enumerate(axis_names):
            value = euler[i]
            lo = constraint.min[i]
            hi = constraint.max[i]
            if value < lo - tol or value > hi + tol:
                limit = lo if value < lo else hi
                over_by = abs(value - limit)
                self.add_issue(
                    severity="error" if over_by * RAD2DEG >= 15 else "warning",
                    category="rom",
                    issue_id="joint-range-violation",
                    frame=frame,
                    bones=[bone],
                    metric=f"{bone}.{axis} Euler ({constraint.order})",
                    expected=f"{lo * RAD2DEG:.1f}deg..{hi * RAD2DEG:.1f}deg",
                    actual=f"{value * RAD2DEG:.1f}deg",
                    likely_cause=rom_likely_cause(bone, axis, value, lo, hi),
                    suggested_fix=rom_suggested_fix(bone),
                    evidence={
                        "axis": axis,
                        "order": constraint.order,
                        "valueDeg": value * RAD2DEG,
                        "limitDeg": limit * RAD2DEG,
                        "overByDeg": over_by * RAD2DEG,
                        "quat": list(q),
                    },
                )

    def check_jitter(self, delta_by_bone: dict[str, list[tuple[FrameSample, float]]]) -> None:
        for bone, deltas in delta_by_bone.items():
            if len(deltas) < 8:
                continue
            values = [v for _, v in deltas]
            mean = statistics.fmean(values)
            stdev = statistics.pstdev(values)
            threshold = max(5.0, mean + 4.0 * stdev)
            for frame, delta in deltas:
                if delta <= threshold:
                    continue
                self.add_issue(
                    severity="warning",
                    category="jitter",
                    issue_id="rotation-jitter-spike",
                    frame=frame,
                    bones=[bone],
                    metric="adjacent quaternion delta outlier",
                    expected=f"<= {threshold:.2f}deg for this bone",
                    actual=f"{delta:.2f}deg",
                    likely_cause="Single-frame mocap noise, IK pole instability, or an unsmoothed source key.",
                    suggested_fix="Apply temporal smoothing to this bone/source target or clamp acceleration around the spike.",
                    evidence={"meanDeltaDeg": mean, "stdevDeltaDeg": stdev, "deltaDeg": delta},
                )

    def check_foot_motion(self, trace: MotionTrace) -> None:
        for foot in ("leftFoot", "rightFoot", "leftToes", "rightToes"):
            prev: tuple[FrameSample, Vec3] | None = None
            for frame in trace.frames:
                sample = frame.bones.get(foot)
                pos = sample.world_pos if sample else None
                if pos is None:
                    continue
                if pos[1] < self.options.floor_y - self.options.ground_tolerance:
                    self.add_issue(
                        severity="error",
                        category="ground-penetration",
                        issue_id="foot-below-floor",
                        frame=frame,
                        bones=[foot],
                        metric="world Y",
                        expected=f">= floorY - {self.options.ground_tolerance:.3f}",
                        actual=f"{pos[1]:.4f}",
                        likely_cause="Floor calibration, root height, or foot IK target is too low.",
                        suggested_fix="Recalibrate floor/root Y and clamp planted feet above the floor plane.",
                        evidence={"worldPos": list(pos), "floorY": self.options.floor_y},
                    )
                if prev:
                    prev_frame, prev_pos = prev
                    dt = max(EPS, frame.time - prev_frame.time)
                    near_floor = (
                        abs(pos[1] - self.options.floor_y) <= self.options.foot_contact_height
                        and abs(prev_pos[1] - self.options.floor_y) <= self.options.foot_contact_height
                    )
                    speed = horizontal_distance(pos, prev_pos) / dt
                    if near_floor and speed > self.options.foot_slide_speed:
                        self.add_issue(
                            severity="warning",
                            category="foot-slide",
                            issue_id="planted-foot-sliding",
                            frame=frame,
                            bones=[foot],
                            metric="horizontal speed while near floor",
                            expected=f"<= {self.options.foot_slide_speed:.3f}m/s",
                            actual=f"{speed:.3f}m/s",
                            likely_cause="Root motion and planted foot lock disagree.",
                            suggested_fix="Add/strengthen foot-lock correction or bake matching root motion for this interval.",
                            evidence={
                                "previousFrame": prev_frame.index,
                                "prevWorldPos": list(prev_pos),
                                "worldPos": list(pos),
                                "speed": speed,
                            },
                        )
                prev = (frame, pos)

    def check_hip_drift(self, trace: MotionTrace) -> None:
        hip_points = [
            (frame, sample.world_pos)
            for frame in trace.frames
            if (sample := frame.bones.get("hips")) and sample.world_pos is not None
        ]
        if len(hip_points) < 2:
            return
        first_frame, first_pos = hip_points[0]
        last_frame, last_pos = hip_points[-1]
        dy = last_pos[1] - first_pos[1]
        if abs(dy) > self.options.hip_drift_y:
            self.add_issue(
                severity="warning",
                category="hip-drift",
                issue_id="hips-world-y-drift",
                frame=last_frame,
                bones=["hips"],
                metric="hips world Y drift",
                expected=f"<= {self.options.hip_drift_y:.3f}m over trace",
                actual=f"{dy:.3f}m",
                likely_cause="Accumulated root translation, floor normalization, or vertical scale mismatch.",
                suggested_fix="Normalize root height at import and separate intentional jump/crouch motion from drift.",
                evidence={
                    "firstFrame": first_frame.index,
                    "firstY": first_pos[1],
                    "lastY": last_pos[1],
                    "deltaY": dy,
                },
            )

    def check_bone_lengths(self, trace: MotionTrace) -> None:
        lengths: dict[tuple[str, str], list[tuple[FrameSample, float]]] = {}
        for frame in trace.frames:
            for parent, children in PARENT_CHILDREN.items():
                parent_sample = frame.bones.get(parent)
                if not parent_sample or parent_sample.world_pos is None:
                    continue
                for child in children:
                    child_sample = frame.bones.get(child)
                    if not child_sample or child_sample.world_pos is None:
                        continue
                    length = vec_distance(parent_sample.world_pos, child_sample.world_pos)
                    lengths.setdefault((parent, child), []).append((frame, length))

        for (parent, child), samples in lengths.items():
            if len(samples) < 4:
                continue
            nonzero = [length for _, length in samples if length > EPS]
            if not nonzero:
                continue
            median = statistics.median(nonzero)
            tolerance = max(0.01, median * self.options.bone_length_relative_tolerance)
            for frame, length in samples:
                if abs(length - median) <= tolerance:
                    continue
                self.add_issue(
                    severity="warning",
                    category="bone-length",
                    issue_id="world-bone-length-change",
                    frame=frame,
                    bones=[parent, child],
                    metric="parent-child world distance",
                    expected=f"{median:.4f}m +/- {tolerance:.4f}m",
                    actual=f"{length:.4f}m",
                    likely_cause="World positions come from inconsistent spaces or the retargeter is stretching the chain.",
                    suggested_fix="Verify source/target scale and make sure world positions are sampled after final skeleton update.",
                    evidence={"medianLength": median, "length": length},
                )


def rom_likely_cause(bone: str, axis: str, value: float, lo: float, hi: float) -> str:
    side = "right" if bone.startswith("right") else "left" if bone.startswith("left") else ""
    if "LowerArm" in bone:
        return f"{side} elbow flexion axis or sign may be wrong in retarget mapping.".strip()
    if "LowerLeg" in bone:
        return f"{side} knee pole direction or flexion sign may be inverted.".strip()
    if "Foot" in bone or "Toes" in bone:
        return "Foot IK target, ankle basis, or floor compensation produced an impossible ankle/toe pose."
    if bone in {"spine", "chest", "upperChest", "neck", "head"}:
        return "Torso/head rotation is over-concentrated in one joint instead of distributed along the chain."
    if value < lo or value > hi:
        return f"{bone} {axis}-axis rotation is outside the configured anatomical range."
    return "Joint rotation exceeded configured range."


def rom_suggested_fix(bone: str) -> str:
    if "LowerArm" in bone or "LowerLeg" in bone:
        return "Check local bone basis, axis sign, and IK pole direction before adding more smoothing."
    if bone in {"spine", "chest", "upperChest", "neck", "head"}:
        return "Distribute rotation over the torso/head chain and clamp per segment before export."
    return "Inspect retarget mapping for this bone and clamp/smooth before building final keyframes."


def write_summary(report: dict[str, Any], path: Path) -> None:
    trace = report["trace"]
    summary = report["summary"]
    lines = [
        f"# Animation validation: {trace['name']}",
        "",
        f"- Source format: `{trace['sourceFormat']}`",
        f"- Duration: {trace['duration']:.3f}s",
        f"- Frames: {trace['frameCount']}",
        f"- Issues: {summary['issueCount']} (+{summary['suppressedIssueCount']} suppressed)",
        "",
        "## Category counts",
        "",
    ]
    category_counts = summary.get("categoryCounts") or {}
    if category_counts:
        for category, count in sorted(category_counts.items(), key=lambda item: (-item[1], item[0])):
            lines.append(f"- `{category}`: {count}")
    else:
        lines.append("- No issues found")
    lines.extend(["", "## Top issues", ""])
    for issue in report["issues"][:30]:
        bones = ", ".join(issue["bones"])
        lines.append(
            f"- [{issue['severity']}] `{issue['category']}` at "
            f"{issue['timeStart']:.3f}s frame {issue['frameStart']} ({bones}): "
            f"{issue['actual']} expected {issue['expected']}. Fix: {issue['suggestedFix']}"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate VRM-player animation traces.")
    parser.add_argument("input", type=Path, help="motion_trace.json or animation JSON")
    parser.add_argument("-o", "--output", type=Path, help="Write report JSON here")
    parser.add_argument("--summary", type=Path, help="Write Markdown summary here")
    parser.add_argument("--floor-y", type=float, default=0.0)
    parser.add_argument("--ground-tolerance", type=float, default=0.03)
    parser.add_argument("--foot-contact-height", type=float, default=0.08)
    parser.add_argument("--foot-slide-speed", type=float, default=0.45)
    parser.add_argument("--flip-deg", type=float, default=60.0)
    parser.add_argument("--hip-drift-y", type=float, default=0.20)
    parser.add_argument("--rom-tolerance-deg", type=float, default=0.05)
    parser.add_argument("--max-issues", type=int, default=250)
    parser.add_argument(
        "--no-fail-on-error",
        action="store_true",
        help="Always exit with code 0 after writing the report.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    trace = load_motion_trace(args.input)
    options = ValidatorOptions(
        floor_y=args.floor_y,
        ground_tolerance=args.ground_tolerance,
        foot_contact_height=args.foot_contact_height,
        foot_slide_speed=args.foot_slide_speed,
        flip_deg=args.flip_deg,
        hip_drift_y=args.hip_drift_y,
        rom_tolerance_deg=args.rom_tolerance_deg,
        max_issues=args.max_issues,
    )
    report = AnimationValidator(options).validate(trace)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    if args.summary:
        write_summary(report, args.summary)
    issue_count = report["summary"]["issueCount"]
    print(f"validated {trace.name}: {issue_count} issues", flush=True)
    if args.no_fail_on_error:
        return 0
    return 1 if any(issue["severity"] == "error" for issue in report["issues"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
