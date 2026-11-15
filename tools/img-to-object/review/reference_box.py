#!/usr/bin/env python3
"""Measure a reference photo the way the forge's review scores it.

Prints JSON: the image size, the subject's box (normalized x0, y0, x1, y1, y down) from the forge's
own foreground mask, the background color (the median of the four corners), and the mask's warnings.
The review renders into that box.

The subject is the largest blob on the forge's 224-cell grid (diagnose_render.load_mask, the mask
divine_eye scores), so a stray speck can't stretch the box. Its edges are then refined on the
full-resolution mask within one cell of that blob: a grid-quantized box is up to a cell off, which
costs a thin subject several points of silhouette IoU against a perfect render.

Standard library only. Copyright the LuminosiTS contributors. MIT OR Apache-2.0.
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

FORGE = Path(__file__).resolve().parents[1] / "upstream" / "forge"
sys.path[:0] = [str(FORGE / "stage4_review"), str(FORGE / "stage1_intake"), str(FORGE / "_shared"), str(FORGE)]

from diagnose_render import MASK_GRID_SIZE, bbox_of, load_mask  # noqa: E402
from extract_pbr_evidence import build_foreground_mask, load_image  # noqa: E402


def corner_background(width: int, height: int, pixels: list[tuple[int, int, int, int]]) -> str:
    patch = max(2, min(width, height) // 40)
    samples: list[tuple[int, int, int, int]] = []
    for cx, cy in ((0, 0), (width - patch, 0), (0, height - patch), (width - patch, height - patch)):
        for y in range(cy, cy + patch):
            for x in range(cx, cx + patch):
                samples.append(pixels[y * width + x])
    channels = [int(statistics.median(p[i] for p in samples)) for i in range(3)]
    return "#" + "".join(f"{c:02x}" for c in channels)


def measure(path: Path) -> dict[str, object]:
    width, height, pixels, load_warnings = load_image(path)
    mask, warnings = load_mask(path)
    x, y, w, h = bbox_of(mask)
    size = MASK_GRID_SIZE
    if w == 0 or h == 0:
        raise SystemExit(f"reference_box: no subject found in {path}")
    full, _diagnostics, _full_warnings = build_foreground_mask(width, height, pixels)
    wx0 = max(0, (x - 1) * width // size)
    wx1 = min(width, -(-(x + w + 1) * width // size))
    wy0 = max(0, (y - 1) * height // size)
    wy1 = min(height, -(-(y + h + 1) * height // size))
    xs: list[int] = []
    ys: list[int] = []
    for py in range(wy0, wy1):
        row = py * width
        for px in range(wx0, wx1):
            if full[row + px]:
                xs.append(px)
                ys.append(py)
    if xs:
        box = [min(xs) / width, min(ys) / height, (max(xs) + 1) / width, (max(ys) + 1) / height]
    else:
        box = [x / size, y / size, (x + w) / size, (y + h) / size]
    return {
        "width": width,
        "height": height,
        "box": [round(v, 6) for v in box],
        "background": corner_background(width, height, pixels),
        "warnings": [str(w) for w in [*load_warnings, *warnings]],
    }


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: reference_box.py IMAGE", file=sys.stderr)
        return 2
    print(json.dumps(measure(Path(argv[0]))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
