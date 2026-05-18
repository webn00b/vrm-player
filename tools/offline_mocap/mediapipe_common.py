from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import mediapipe as mp

REPO_ROOT = Path(__file__).resolve().parents[2]
HOLISTIC_TASK_PATH = REPO_ROOT / "public" / "mediapipe" / "holistic_landmarker.task"

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


def convert_point(point: Any, mirror_x: bool) -> list[float]:
    x = -point.x if mirror_x else point.x
    return [float(x), float(-point.y), float(-point.z)]


def midpoint(a: list[float], b: list[float]) -> list[float]:
    return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5]


def visible(point: Any, threshold: float) -> bool:
    return landmark_confidence(point) >= threshold


def landmark_confidence(point: Any) -> float:
    return float(getattr(point, "visibility", getattr(point, "presence", 1.0)))


def combined_confidence(*points: Any) -> float:
    if not points:
        return 1.0
    return min(landmark_confidence(point) for point in points)


def side_indices(mirror_x: bool) -> tuple[dict[str, int], dict[str, int]]:
    left = {
        "shoulder": LM["RIGHT_SHOULDER"] if mirror_x else LM["LEFT_SHOULDER"],
        "elbow": LM["RIGHT_ELBOW"] if mirror_x else LM["LEFT_ELBOW"],
        "wrist": LM["RIGHT_WRIST"] if mirror_x else LM["LEFT_WRIST"],
        "hip": LM["RIGHT_HIP"] if mirror_x else LM["LEFT_HIP"],
        "knee": LM["RIGHT_KNEE"] if mirror_x else LM["LEFT_KNEE"],
        "ankle": LM["RIGHT_ANKLE"] if mirror_x else LM["LEFT_ANKLE"],
        "toe": LM["RIGHT_FOOT_INDEX"] if mirror_x else LM["LEFT_FOOT_INDEX"],
    }
    right = {
        "shoulder": LM["LEFT_SHOULDER"] if mirror_x else LM["RIGHT_SHOULDER"],
        "elbow": LM["LEFT_ELBOW"] if mirror_x else LM["RIGHT_ELBOW"],
        "wrist": LM["LEFT_WRIST"] if mirror_x else LM["RIGHT_WRIST"],
        "hip": LM["LEFT_HIP"] if mirror_x else LM["RIGHT_HIP"],
        "knee": LM["LEFT_KNEE"] if mirror_x else LM["RIGHT_KNEE"],
        "ankle": LM["LEFT_ANKLE"] if mirror_x else LM["RIGHT_ANKLE"],
        "toe": LM["LEFT_FOOT_INDEX"] if mirror_x else LM["RIGHT_FOOT_INDEX"],
    }
    return left, right


def add_joint(joints: dict[str, dict[str, Any]], name: str, point: Any, mirror_x: bool, threshold: float) -> None:
    if visible(point, threshold):
        joints[name] = {
            "position": convert_point(point, mirror_x),
            "confidence": landmark_confidence(point),
        }


def landmark_to_dict(point: Any) -> dict[str, float]:
    out = {
        "x": float(point.x),
        "y": float(point.y),
        "z": float(point.z),
    }
    if hasattr(point, "visibility"):
        out["visibility"] = float(point.visibility)
    if hasattr(point, "presence"):
        out["presence"] = float(point.presence)
    return out


def build_canonical_joints(lms: list[Any], mirror_x: bool, visibility: float) -> dict[str, dict[str, Any]]:
    left, right = side_indices(mirror_x)
    joints: dict[str, dict[str, Any]] = {}

    left_hip = lms[left["hip"]]
    right_hip = lms[right["hip"]]
    left_shoulder = lms[left["shoulder"]]
    right_shoulder = lms[right["shoulder"]]

    lh = convert_point(left_hip, mirror_x)
    rh = convert_point(right_hip, mirror_x)
    ls = convert_point(left_shoulder, mirror_x)
    rs = convert_point(right_shoulder, mirror_x)
    hips = midpoint(lh, rh)
    chest = midpoint(ls, rs)
    spine = midpoint(hips, chest)

    joints["hips"] = {"position": hips, "confidence": combined_confidence(left_hip, right_hip)}
    joints["spine"] = {
        "position": spine,
        "confidence": combined_confidence(left_hip, right_hip, left_shoulder, right_shoulder),
    }
    joints["chest"] = {"position": chest, "confidence": combined_confidence(left_shoulder, right_shoulder)}
    joints["upperChest"] = {"position": chest, "confidence": combined_confidence(left_shoulder, right_shoulder)}

    left_ear = lms[LM["LEFT_EAR"]]
    right_ear = lms[LM["RIGHT_EAR"]]
    head = midpoint(convert_point(left_ear, mirror_x), convert_point(right_ear, mirror_x))
    joints["neck"] = {
        "position": midpoint(chest, head),
        "confidence": combined_confidence(left_shoulder, right_shoulder, left_ear, right_ear),
    }
    joints["head"] = {"position": head, "confidence": combined_confidence(left_ear, right_ear)}

    add_joint(joints, "leftUpperArm", lms[left["shoulder"]], mirror_x, visibility)
    add_joint(joints, "leftLowerArm", lms[left["elbow"]], mirror_x, visibility)
    add_joint(joints, "leftHand", lms[left["wrist"]], mirror_x, visibility)
    add_joint(joints, "rightUpperArm", lms[right["shoulder"]], mirror_x, visibility)
    add_joint(joints, "rightLowerArm", lms[right["elbow"]], mirror_x, visibility)
    add_joint(joints, "rightHand", lms[right["wrist"]], mirror_x, visibility)
    add_joint(joints, "leftUpperLeg", lms[left["hip"]], mirror_x, visibility)
    add_joint(joints, "leftLowerLeg", lms[left["knee"]], mirror_x, visibility)
    add_joint(joints, "leftFoot", lms[left["ankle"]], mirror_x, visibility)
    add_joint(joints, "leftToes", lms[left["toe"]], mirror_x, visibility)
    add_joint(joints, "rightUpperLeg", lms[right["hip"]], mirror_x, visibility)
    add_joint(joints, "rightLowerLeg", lms[right["knee"]], mirror_x, visibility)
    add_joint(joints, "rightFoot", lms[right["ankle"]], mirror_x, visibility)
    add_joint(joints, "rightToes", lms[right["toe"]], mirror_x, visibility)

    return joints


class _LandmarkList:
    def __init__(self, landmarks: list[Any]):
        self.landmark = landmarks


class _PoseResult:
    def __init__(self, pose_landmarks: list[Any], pose_world_landmarks: list[Any]):
        self.pose_landmarks = _LandmarkList(pose_landmarks) if pose_landmarks else None
        self.pose_world_landmarks = _LandmarkList(pose_world_landmarks) if pose_world_landmarks else None


class _SolutionsPoseDetector:
    def __init__(self):
        self._pose = mp.solutions.pose.Pose(
            static_image_mode=False,
            model_complexity=2,
            smooth_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

    def process(self, rgb, _timestamp_ms: int) -> Any:
        return self._pose.process(rgb)

    def close(self) -> None:
        self._pose.close()


class _TasksHolisticPoseDetector:
    def __init__(self):
        if not HOLISTIC_TASK_PATH.exists():
            raise RuntimeError(f"Missing MediaPipe model: {HOLISTIC_TASK_PATH}")
        from mediapipe.tasks.python import BaseOptions, vision

        options = vision.HolisticLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(HOLISTIC_TASK_PATH)),
            running_mode=vision.RunningMode.VIDEO,
            min_pose_detection_confidence=0.5,
            min_pose_landmarks_confidence=0.5,
        )
        self._landmarker = vision.HolisticLandmarker.create_from_options(options)

    def process(self, rgb, timestamp_ms: int) -> _PoseResult:
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect_for_video(image, timestamp_ms)
        return _PoseResult(result.pose_landmarks, result.pose_world_landmarks)

    def close(self) -> None:
        self._landmarker.close()


def create_pose_detector():
    if hasattr(mp, "solutions"):
        return _SolutionsPoseDetector()
    return _TasksHolisticPoseDetector()


def extract_video_pose(
    video: Path,
    target_fps: float,
    mirror_x: bool,
    visibility: float,
    max_frames: int = 0,
    include_debug: bool = False,
) -> dict[str, Any]:
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video}")

    source_fps = float(cap.get(cv2.CAP_PROP_FPS) or target_fps or 30.0)
    frame_step = max(1, round(source_fps / target_fps)) if target_fps > 0 else 1
    output_fps = source_fps / frame_step
    pose = create_pose_detector()

    frames: list[dict[str, Any]] = []
    frame_index = 0
    kept_index = 0
    detected_frames = 0
    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break

            source_frame_index = frame_index
            frame_index += 1
            if source_frame_index % frame_step != 0:
                continue

            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            timestamp_ms = int(round(source_frame_index * 1000.0 / source_fps))
            result = pose.process(rgb, timestamp_ms)
            if not result.pose_world_landmarks:
                continue

            detected_frames += 1
            lms = result.pose_world_landmarks.landmark
            joints = build_canonical_joints(lms, mirror_x, visibility)
            hips = joints["hips"]["position"]
            frame = {
                "frameIndex": source_frame_index,
                "time": kept_index / output_fps,
                "root": {"position": hips},
                "joints": joints,
            }
            if include_debug:
                frame["rawWorldLandmarks"] = [landmark_to_dict(point) for point in lms]
                image_landmarks = result.pose_landmarks.landmark if result.pose_landmarks else []
                frame["imageLandmarks"] = [landmark_to_dict(point) for point in image_landmarks]
            frames.append(frame)
            kept_index += 1
            if max_frames and kept_index >= max_frames:
                break
    finally:
        pose.close()
        cap.release()

    return {
        "video": str(video),
        "sourceFps": source_fps,
        "fps": output_fps,
        "frameStep": frame_step,
        "framesRead": frame_index,
        "framesDetected": detected_frames,
        "frames": frames,
        "mirrorX": mirror_x,
        "visibility": visibility,
    }
