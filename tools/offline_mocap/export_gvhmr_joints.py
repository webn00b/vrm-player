#!/usr/bin/env python3
r"""Export SMPL-24 joints from a GVHMR demo result.

Run this inside the GVHMR Python environment, preferably from the GVHMR repo
root, after `tools/demo/demo.py` has created `outputs/demo/<video>/hmr4d_results.pt`.

Example:

  python C:\ai\vrm-player\tools\offline_mocap\export_gvhmr_joints.py ^
    C:\ai\gvhmr\outputs\demo\ted1\hmr4d_results.pt ^
    -o C:\ai\data\ted1.gvhmr-joints.pt
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any


def load_make_smplx() -> Any:
    try:
        from hmr4d.utils.smplx_utils import make_smplx
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Could not import GVHMR's hmr4d package. Run this from the GVHMR "
            "repo root after `pip install -e .`, or add GVHMR to PYTHONPATH."
        ) from exc
    return make_smplx


def resolve_body_model_file(gvhmr_root: Path, relative_path: str) -> Path:
    path = gvhmr_root / relative_path
    if not path.exists():
        raise SystemExit(
            f"Missing GVHMR body-model helper file: {path}\n"
            "Run this script from the GVHMR repo root, or pass --gvhmr-root."
        )
    return path


def move_to_start_point_face_z(torch: Any, verts: Any, regressor: Any) -> Any:
    """Match GVHMR demo global render normalization."""
    joints0 = torch.einsum("jv,lvi->lji", regressor, verts[[0]])
    offset = joints0[0, 0].clone()
    offset[1] = verts[:, :, 1].min()
    verts = verts - offset

    from hmr4d.utils.geo_transform import apply_T_on_points, compute_T_ayfz2ay

    transform = compute_T_ayfz2ay(torch.einsum("jv,lvi->lji", regressor, verts[[0]]), inverse=True)
    return apply_T_on_points(verts, transform)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="GVHMR hmr4d_results.pt")
    parser.add_argument("-o", "--output", type=Path, required=True)
    parser.add_argument("--gvhmr-root", type=Path, default=Path.cwd())
    parser.add_argument("--fps", type=float, default=30)
    parser.add_argument(
        "--space",
        choices=["global", "incam"],
        default="global",
        help="Use smpl_params_global or smpl_params_incam from the GVHMR result.",
    )
    parser.add_argument(
        "--no-normalize-global",
        action="store_true",
        help="Keep GVHMR global coordinates instead of matching demo global-view normalization.",
    )
    args = parser.parse_args()

    import torch

    make_smplx = load_make_smplx()
    gvhmr_root = args.gvhmr_root.resolve()
    result = torch.load(args.input, map_location="cpu")
    smpl_key = "smpl_params_global" if args.space == "global" else "smpl_params_incam"
    if smpl_key not in result:
        raise SystemExit(f"{args.input} does not contain {smpl_key!r}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    smplx = make_smplx("supermotion").to(device)
    smplx2smpl = torch.load(
        resolve_body_model_file(gvhmr_root, "hmr4d/utils/body_model/smplx2smpl_sparse.pt"),
        map_location=device,
    )
    regressor = torch.load(
        resolve_body_model_file(gvhmr_root, "hmr4d/utils/body_model/smpl_neutral_J_regressor.pt"),
        map_location=device,
    )

    smpl_params = {
        key: value.to(device) if hasattr(value, "to") else value
        for key, value in result[smpl_key].items()
    }
    with torch.no_grad():
        smplx_out = smplx(**smpl_params)
        smpl_verts = torch.stack([torch.matmul(smplx2smpl, verts) for verts in smplx_out.vertices])
        if args.space == "global" and not args.no_normalize_global:
            smpl_verts = move_to_start_point_face_z(torch, smpl_verts, regressor)
        joints = torch.einsum("jv,lvi->lji", regressor, smpl_verts).cpu()

    payload = {
        "version": 1,
        "name": args.input.stem,
        "source": "gvhmr",
        "fps": args.fps,
        "coordinateSpace": "smpl",
        "joints3d": joints,
        "adapter": {
            "input": str(args.input),
            "smplKey": smpl_key,
            "normalizedGlobal": args.space == "global" and not args.no_normalize_global,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(payload, args.output)
    print(f"wrote {args.output} ({joints.shape[0]} frames, {joints.shape[1]} joints)")


if __name__ == "__main__":
    main()
