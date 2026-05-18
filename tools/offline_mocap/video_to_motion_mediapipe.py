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

from mediapipe_common import extract_video_pose


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
    extraction = extract_video_pose(
        args.video,
        target_fps=args.fps,
        mirror_x=args.mirror_x,
        visibility=args.visibility,
        max_frames=args.max_frames,
        include_debug=False,
    )

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
            "sourceFps": extraction["sourceFps"],
            "frameStep": extraction["frameStep"],
        },
        "frames": [
            {
                "time": i / args.fps,
                "root": frame["root"],
                "joints": frame["joints"],
            }
            for i, frame in enumerate(extraction["frames"])
        ],
    }
    output.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {output} ({len(payload['frames'])} frames at {args.fps:g} fps)")


if __name__ == "__main__":
    main()
