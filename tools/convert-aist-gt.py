#!/usr/bin/env python3
"""Convert an AIST++ keypoints3d .pkl annotation into JSON for the BVH benchmark.

Usage:
    python3 tools/convert-aist-gt.py <keypoints3d.pkl> [out.json]

The pickle contains COCO-17 3D keypoints (in centimetres, 60 fps):
    keypoints3d           (N, 17, 3) float32
    keypoints3d_optim     (N, 17, 3) float32  -- bundle-adjusted, preferred

COCO-17 joint order:
    0 nose, 1 left_eye, 2 right_eye, 3 left_ear, 4 right_ear,
    5 left_shoulder, 6 right_shoulder, 7 left_elbow, 8 right_elbow,
    9 left_wrist, 10 right_wrist, 11 left_hip, 12 right_hip,
    13 left_knee, 14 right_knee, 15 left_ankle, 16 right_ankle

Output JSON: { "fps": 60, "joints": [...17 names...], "frames": [[[x,y,z]*17], ...] }
Coordinates converted to metres.
"""
import json
import pickle
import sys
from pathlib import Path

COCO_JOINTS = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".json")

    with src.open("rb") as fh:
        data = pickle.load(fh)

    kp = data.get("keypoints3d_optim")
    source = "keypoints3d_optim"
    if kp is None:
        kp = data["keypoints3d"]
        source = "keypoints3d"

    n_frames, n_joints, _ = kp.shape
    assert n_joints == len(COCO_JOINTS), f"expected 17 joints, got {n_joints}"

    # AIST++ keypoints are in centimetres; convert to metres.
    frames = (kp / 100.0).round(5).tolist()

    dst.write_text(json.dumps({
        "source": str(src.name),
        "field": source,
        "fps": 60,
        "joints": COCO_JOINTS,
        "frames": frames,
    }))
    print(f"wrote {dst} ({n_frames} frames, 60 fps, {source})")


if __name__ == "__main__":
    main()
