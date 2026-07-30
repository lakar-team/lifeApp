"""
Memory-bounded tiled conversion.

The single-pass pipeline renders the whole page at native DPI (a 1200-DPI
A1 scan is ~140 MP) and OpenCV's component/contour buffers on top of that
push peak memory past a small host's limit (e.g. 512 MB free tier). This
module keeps the EXACT same contour pipeline but feeds it one overlapping
tile at a time, so peak memory scales with a tile, not the whole page.

Why tiling is safe for CONTOUR tracing specifically: contour tracing is a
local operation (trace an ink boundary), so a shape cut at a tile seam just
degrades into two pieces that still cover the ink. This is unlike the
abandoned centerline/skeleton approach, where a break at a seam corrupted
the topological graph's connectivity -- that's why banded processing was
dropped THERE, and why it's fine here.

Seam handling: tiles are rendered with an OVERLAP halo, and each shape is
kept by exactly one tile -- the tile whose CORE (non-overlap) region
contains the shape's centroid. Shapes smaller than the halo that sit near a
seam are captured whole by one tile; shapes larger than a tile still split,
which is acceptable for contour output.
"""
from __future__ import annotations

import gc
import math
import time

import numpy as np
import fitz  # PyMuPDF

from . import extract, fill, export, pipeline

# Memory budgeting. The grid is chosen from the ACTUAL page size so the tool
# adapts per input file, and deliberately aims for comfortable headroom rather
# than the ragged edge of the host's RAM cap.
HOST_MEM_MB = 512          # free-tier hard cap
PROCESS_BASE_MB = 150      # interpreter + numpy/opencv/scipy/fastapi baseline
BYTES_PER_PX = 6           # gray(1B) + bool ink(1B) + OpenCV CV_32S labels(4B)
# Aim each tile's raster working set at ~a third of the cap, so peak
# (base + one tile + churn) lands around half of HOST_MEM_MB -- not near it.
TARGET_TILE_MB = 170.0
TARGET_TILE_MP = TARGET_TILE_MB / BYTES_PER_PX          # ~28 MP per tile
# One pass only when the whole page fits the same comfortable budget; above
# this we tile. (base + MP*bytes stays well under the cap.)
SAFE_SINGLE_PASS_MP = (0.65 * HOST_MEM_MB - PROCESS_BASE_MB) / BYTES_PER_PX  # ~31 MP
# Halo so a shape straddling a seam is captured whole within one tile's core.
OVERLAP_PX = 96


def _detect_native_dpi(doc, page) -> float:
    rects = []
    for img in page.get_images(full=True):
        tile_px_w = img[2]  # (xref, smask, width, height, ...) -> width
        for r in page.get_image_rects(img[0]):
            if r.width > 0:
                rects.append((tile_px_w / r.width) * 72)
    return float(np.median(rects)) if rects else 300.0


def _render_region_ink(page, zoom: float, px0: int, py0: int, px1: int, py1: int) -> np.ndarray:
    """Render just the pixel rectangle [px0,px1) x [py0,py1) to a boolean ink
    mask, without materialising the whole page."""
    clip = fitz.Rect(px0 / zoom, py0 / zoom, px1 / zoom, py1 / zoom)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip,
                          colorspace=fitz.csGRAY, alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    return arr < 128


def _offset_shape(s, gx: int, gy: int) -> None:
    """Shift a Shape's tile-local pixel coords into global page coords."""
    s.contour = [(x + gx, y + gy) for (x, y) in s.contour]
    x0, y0, x1, y1 = s.bbox
    s.bbox = (x0 + gx, y0 + gy, x1 + gx, y1 + gy)


def pdf_to_dxf_auto(pdf_path: str, out_dxf_path: str,
                    min_area_px: int = 4,
                    hole_area_frac_max: float = 0.35,
                    simplify_px: float = 0.25,
                    page_num: int = 0) -> dict:
    """Convert a PDF page to DXF, tiling automatically if the page is too
    large to process in one pass. Returns the same result dict as
    pipeline.pdf_to_dxf, plus 'tiles'/'grid'/'megapixels'."""
    t0 = time.time()
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    native_dpi = _detect_native_dpi(doc, page)
    zoom = native_dpi / 72.0
    W = int(round(page.rect.width * zoom))
    H = int(round(page.rect.height * zoom))
    mp = W * H / 1e6

    if mp <= SAFE_SINGLE_PASS_MP:
        # Small enough: use the original single-pass path verbatim.
        result = pipeline.pdf_to_dxf(
            pdf_path, out_dxf_path, min_area_px=min_area_px,
            hole_area_frac_max=hole_area_frac_max, simplify_px=simplify_px,
            page_num=page_num)
        result["tiles"] = 1
        result["grid"] = "1x1"
        result["megapixels"] = round(mp, 1)
        result["timing_s"]["total"] = round(time.time() - t0, 1)
        return result

    # Choose a grid so each tile is ~<= TARGET_TILE_MP, roughly square tiles.
    side = math.sqrt(TARGET_TILE_MP * 1e6)
    cols = max(1, math.ceil(W / side))
    rows = max(1, math.ceil(H / side))
    tile_w = math.ceil(W / cols)
    tile_h = math.ceil(H / rows)

    all_shapes: list = []
    decisions: dict = {}
    for r in range(rows):
        for c in range(cols):
            # core (owned) region for this tile
            cx0, cy0 = c * tile_w, r * tile_h
            cx1, cy1 = min(W, cx0 + tile_w), min(H, cy0 + tile_h)
            if cx1 <= cx0 or cy1 <= cy0:
                continue
            # rendered region = core + overlap halo
            rx0, ry0 = max(0, cx0 - OVERLAP_PX), max(0, cy0 - OVERLAP_PX)
            rx1, ry1 = min(W, cx1 + OVERLAP_PX), min(H, cy1 + OVERLAP_PX)

            ink = _render_region_ink(page, zoom, rx0, ry0, rx1, ry1)
            tshapes = extract.extract_shapes(ink, min_area_px=min_area_px)
            tdec = fill.compute_fill_decisions(tshapes, ink,
                                               hole_area_frac_max=hole_area_frac_max)

            for s in tshapes:
                bx0, by0, bx1, by1 = s.bbox  # tile-local (rel. to rx0,ry0)
                gcx = rx0 + (bx0 + bx1) / 2.0  # global centroid
                gcy = ry0 + (by0 + by1) / 2.0
                if not (cx0 <= gcx < cx1 and cy0 <= gcy < cy1):
                    continue  # owned by a neighbouring tile's core
                keep = tdec.get(id(s), False)
                _offset_shape(s, rx0, ry0)
                all_shapes.append(s)
                decisions[id(s)] = keep

            del ink, tshapes, tdec
            gc.collect()

    result = export.build_dxf(all_shapes, decisions, H, native_dpi,
                              out_dxf_path, simplify_px=simplify_px)
    result["dpi"] = native_dpi
    result["shape_count"] = len(all_shapes)
    result["tiles"] = rows * cols
    result["grid"] = f"{rows}x{cols}"
    result["megapixels"] = round(mp, 1)
    result["timing_s"] = {"total": round(time.time() - t0, 1)}
    return result
