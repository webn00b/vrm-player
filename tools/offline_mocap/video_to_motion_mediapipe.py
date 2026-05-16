#!/usr/bin/env python3
"""Local fallback: convert a video to vrm-player motion JSON with MediaPipe Pose.

This is not a replacement for WHAM/GVHMR. It exists so the offline import path
can be exercised locally from a video without uploading private footage or
requiring SMPL checkpoints. The output uses the same `.motion.json` contract as
the WHAM/GVHMR adapter.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp


LM = {
    "LEFT_EAR": 7,
    "RIGHT_EAR": 8,
    "LEFT_SHOULDER": 11,
    "RIGHT_SHOULDER": 12,
    "LEFT_ELBOW": 13,
    "RIGHT_ELBOW": 14,
    "LEFT_WRIST": 15,
    "RIGHT_WRIST": 16,
    "LEFT_HIP": 23,
    "RIGHT_HIP": 24,
    "LEFT_KNEE": 25,
    "RIGHT_KNEE": 26,
    "LEFT_ANKLE": 27,
    "RIGHT_ANKLE": 28,
    "LEFT_FOOT_INDEX": 31,
    "RIGHT_FOOT_INDEX": 32,
}


def convert_point(point, mirror_x: bool) -> list[float]:
    x = -point.x if mirror_x else point.x
    return [x, -point.y, -point.z]


def midpoint(a: list[float], b: list[float]) -> list[float]:
    return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5]


def visible(point, threshold: float) -> bool:
    return getattr(point, "visibility", 1.0) >= threshold


def add_joint(joints: dict, name: str, point, mirror_x: bool, threshold: float) -> None:
    if visible(point, threshold):
        joints[name] = {
            "position": convert_point(point, mirror_x),
            "confidence": float(getattr(point, "visibility", 1.0)),
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--mirror-x", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--visibility", type=float, default=0.35)
    parser.add_argument("--max-frames", type=int, default=0)
    args = parser.parse_args()

    output = args.output or args.video.with_suffix(".mediapipe.motion.json")
    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise SystemExit(f"Could not open video: {args.video}")

    source_fps = cap.get(cv2.CAP_PROP_FPS) or args.fps
    frame_step = max(1, round(source_fps / args.fps))
    pose = mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=2,
        smooth_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    frames = []
    frame_index = 0
    kept_index = 0
    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            if frame_index % frame_step != 0:
                frame_index += 1
                continue

            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            result = pose.process(rgb)
            frame_index += 1
            if not result.pose_world_landmarks:
                continue

            lms = result.pose_world_landmarks.landmark
            mirror = args.mirror_x
            left = {
                "shoulder": LM["RIGHT_SHOULDER"] if mirror else LM["LEFT_SHOULDER"],
                "elbow": LM["RIGHT_ELBOW"] if mirror else LM["LEFT_ELBOW"],
                "wrist": LM["RIGHT_WRIST"] if mirror else LM["LEFT_WRIST"],
                "hip": LM["RIGHT_HIP"] if mirror else LM["LEFT_HIP"],
                "knee": LM["RIGHT_KNEE"] if mirror else LM["LEFT_KNEE"],
                "ankle": LM["RIGHT_ANKLE"] if mirror else LM["LEFT_ANKLE"],
                "toe": LM["RIGHT_FOOT_INDEX"] if mirror else LM["LEFT_FOOT_INDEX"],
            }
            right = {
                "shoulder": LM["LEFT_SHOULDER"] if mirror else LM["RIGHT_SHOULDER"],
                "elbow": LM["LEFT_ELBOW"] if mirror else LM["RIGHT_ELBOW"],
                "wrist": LM["LEFT_WRIST"] if mirror else LM["RIGHT_WRIST"],
                "hip": LM["LEFT_HIP"] if mirror else LM["RIGHT_HIP"],
                "knee": LM["LEFT_KNEE"] if mirror else LM["RIGHT_KNEE"],
                "ankle": LM["LEFT_ANKLE"] if mirror else LM["RIGHT_ANKLE"],
                "toe": LM["LEFT_FOOT_INDEX"] if mirror else LM["RIGHT_FOOT_INDEX"],
            }

            joints: dict = {}
            lh = convert_point(lms[left["hip"]], mirror)
            rh = convert_point(lms[right["hip"]], mirror)
            ls = convert_point(lms[left["shoulder"]], mirror)
            rs = convert_point(lms[right["shoulder"]], mirror)
            hips = midpoint(lh, rh)
            chest = midpoint(ls, rs)
            spine = midpoint(hips, chest)

            joints["hips"] = {"position": hips, "confidence": 1.0}
            joints["spine"] = {"position": spine, "confidence": 1.0}
            joints["chest"] = {"position": chest, "confidence": 1.0}
            joints["upperChest"] = {"position": chest, "confidence": 1.0}
            head = midpoint(convert_point(lms[LM["LEFT_EAR"]], mirror), convert_point(lms[LM["RIGHT_EAR"]], mirror))
            joints["neck"] = {"position": midpoint(chest, head), "confidence": 1.0}
            joints["head"] = {"position": head, "confidence": 1.0}

            add_joint(joints, "leftUpperArm", lms[left["shoulder"]], mirror, args.visibility)
            add_joint(joints, "leftLowerArm", lms[left["elbow"]], mirror, args.visibility)
            add_joint(joints, "leftHand", lms[left["wrist"]], mirror, args.visibility)
            add_joint(joints, "rightUpperArm", lms[right["shoulder"]], mirror, args.visibility)
            add_joint(joints, "rightLowerArm", lms[right["elbow"]], mirror, args.visibility)
            add_joint(joints, "rightHand", lms[right["wrist"]], mirror, args.visibility)
            add_joint(joints, "leftUpperLeg", lms[left["hip"]], mirror, args.visibility)
            add_joint(joints, "leftLowerLeg", lms[left["knee"]], mirror, args.visibility)
            add_joint(joints, "leftFoot", lms[left["ankle"]], mirror, args.visibility)
            add_joint(joints, "leftToes", lms[left["toe"]], mirror, args.visibility)
            add_joint(joints, "rightUpperLeg", lms[right["hip"]], mirror, args.visibility)
            add_joint(joints, "rightLowerLeg", lms[right["knee"]], mirror, args.visibility)
            add_joint(joints, "rightFoot", lms[right["ankle"]], mirror, args.visibility)
            add_joint(joints, "rightToes", lms[right["toe"]], mirror, args.visibility)

            frames.append({
                "time": kept_index / args.fps,
                "root": {"position": hips},
                "joints": joints,
            })
            kept_index += 1
            if args.max_frames and kept_index >= args.max_frames:
                break
    finally:
        pose.close()
        cap.release()

    payload = {
        "version": 1,
        "name": args.video.stem,
        "source": "mediapipe",
        "fps": args.fps,
        "coordinateSpace": "vrm",
        "adapter": {
            "input": str(args.video),
            "mirrorX": args.mirror_x,
            "visibility": args.visibility,
        },
        "frames": frames,
    }
    output.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {output} ({len(frames)} frames at {args.fps:g} fps)")


if __name__ == "__main__":
    main()

