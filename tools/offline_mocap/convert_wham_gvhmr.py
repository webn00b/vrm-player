#!/usr/bin/env python3
"""Convert WHAM/GVHMR-style result dumps to vrm-player motion JSON.

This script intentionally does not run WHAM/GVHMR. It is the thin adapter
between an offline Python mocap job and the browser importer:

  python tools/offline_mocap/convert_wham_gvhmr.py result.pt --source gvhmr

Supported inputs are JSON, NPZ, pickle, and torch .pt/.pth files when the
matching Python packages are installed in the environment that produced them.
The converter searches common keys for an array shaped [frames, joints, 3].
"""

from __future__ import annotations

import argparse
import json
import pickle
from pathlib import Path
from typing import Any


PREFERRED_JOINT_KEYS = (
    "joints3d",
    "joints_3d",
    "smpl_joints",
    "pred_joints",
    "world_joints",
    "global_joints",
    "keypoints3d",
    "keypoints_3d",
)


def to_plain(value: Any) -> Any:
    if hasattr(value, "detach"):
        value = value.detach().cpu().numpy()
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, dict):
        return {str(k): to_plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_plain(v) for v in value]
    return value


def load_input(path: Path) -> Any:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return json.loads(path.read_text())
    if suffix == ".npz":
        import numpy as np

        data = np.load(path, allow_pickle=True)
        return {key: data[key] for key in data.files}
    if suffix in {".pt", ".pth"}:
        import torch

        return torch.load(path, map_location="cpu")
    with path.open("rb") as fh:
        return pickle.load(fh)


def shape3(value: Any) -> tuple[int, int, int] | None:
    plain = to_plain(value)
    if not isinstance(plain, list) or not plain:
        return None
    if not isinstance(plain[0], list) or not plain[0]:
        return None
    if not isinstance(plain[0][0], list) or len(plain[0][0]) < 3:
        return None
    return (len(plain), len(plain[0]), len(plain[0][0]))


def walk_candidates(value: Any, prefix: str = "") -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_key = f"{prefix}.{key}" if prefix else str(key)
            out.extend(walk_candidates(child, child_key))
    else:
        if shape3(value):
            out.append((prefix, value))
    return out


def find_joint_array(data: Any, requested_key: str | None) -> tuple[str, Any]:
    plain = to_plain(data)
    if requested_key:
      cur = plain
      for part in requested_key.split("."):
          cur = cur[part]
      if not shape3(cur):
          raise SystemExit(f"--key {requested_key!r} is not shaped [frames, joints, 3]")
      return requested_key, cur

    candidates = walk_candidates(plain)
    if not candidates:
        raise SystemExit("No [frames, joints, 3] array found. Pass --key path.to.joints.")

    preferred = {key: i for i, key in enumerate(PREFERRED_JOINT_KEYS)}
    candidates.sort(key=lambda kv: min((preferred[k] for k in preferred if k in kv[0].lower()), default=999))
    return candidates[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--source", choices=["wham", "gvhmr", "smpl", "unknown"], default="unknown")
    parser.add_argument("--fps", type=float, default=30)
    parser.add_argument("--key", help="Dot-path to joints array, e.g. results.smpl_joints")
    args = parser.parse_args()

    key, joints = find_joint_array(load_input(args.input), args.key)
    out_path = args.output or args.input.with_suffix(f".{args.source if args.source != 'unknown' else 'motion'}.json")
    payload = {
        "version": 1,
        "name": args.input.stem,
        "source": args.source,
        "fps": args.fps,
        "coordinateSpace": "smpl",
        "adapter": {
            "input": str(args.input),
            "jointKey": key,
        },
        "joints3d": to_plain(joints),
    }
    out_path.write_text(json.dumps(payload, separators=(",", ":")))
    frames, joints_count, _ = shape3(joints) or (0, 0, 0)
    print(f"wrote {out_path} ({frames} frames, {joints_count} joints, key={key})")


if __name__ == "__main__":
    main()

