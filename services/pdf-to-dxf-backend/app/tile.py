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
import os
import shutil
import time

import numpy as np
import cv2
import fitz  # PyMuPDF
from ezdxf.addons import r12writer

from . import extract, pipeline, render_preview


def _layer_for(s) -> str:
    """Pick a DXF layer for a shape (fill/hatch omitted -- outlines only)."""
    if s.kind == "region":
        return "SHAPE-INTERIOR"
    if s.kind == "stroke":
        return "LINE-THICK" if s.width_px >= 6.0 else "LINE-THIN"
    return "SHAPE-OUTLINE"


class StreamingPdf:
    """Minimal single-page vector PDF written by streaming path/stroke
    operators to a temp content file, so memory stays bounded regardless of
    entity count (matplotlib/ezdxf-readback would load everything at once and
    OOM on dense drawings). Exposes the same add_polyline_2d(points, closed,
    layer) signature as ezdxf's r12writer so the tiling loop is format-agnostic.
    Points are millimetres with Y already pointing up (PDF's convention)."""

    _K = 72.0 / 25.4  # millimetres -> PDF points

    def __init__(self, out_path: str, width_pt: float, height_pt: float):
        self.out_path = out_path
        self.w = width_pt
        self.h = height_pt
        self._content_path = out_path + ".content"
        self._cf = None

    def __enter__(self):
        self._cf = open(self._content_path, "w")
        self._cf.write("0.5 w 0 G\n")  # 0.5pt lines, black stroke
        return self

    def add_polyline_2d(self, points, closed=True, layer=None):
        k = self._K
        pts = list(points)
        if len(pts) < 2:
            return
        x0, y0 = pts[0]
        buf = [f"{x0 * k:.2f} {y0 * k:.2f} m"]
        for x, y in pts[1:]:
            buf.append(f"{x * k:.2f} {y * k:.2f} l")
        if closed:
            buf.append("h")
        buf.append("S")
        self._cf.write(" ".join(buf) + "\n")

    def __exit__(self, *exc):
        self._cf.close()
        clen = os.path.getsize(self._content_path)
        with open(self.out_path, "wb") as f:
            def w(s):
                f.write(s.encode("latin-1"))
            off = {}
            w("%PDF-1.4\n")
            off[1] = f.tell(); w("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
            off[2] = f.tell(); w("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
            off[3] = f.tell(); w(f"3 0 obj\n<< /Type /Page /Parent 2 0 R "
                                 f"/MediaBox [0 0 {self.w:.2f} {self.h:.2f}] /Contents 4 0 R >>\nendobj\n")
            off[4] = f.tell(); w(f"4 0 obj\n<< /Length {clen} >>\nstream\n")
            with open(self._content_path, "rb") as cf:
                shutil.copyfileobj(cf, f, 1 << 20)
            w("\nendstream\nendobj\n")
            xref = f.tell()
            w("xref\n0 5\n0000000000 65535 f \n")
            for i in range(1, 5):
                w(f"{off[i]:010d} 00000 n \n")
            w(f"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n")
        os.remove(self._content_path)
        return False


def _rss_mb() -> int:
    """Current resident memory in MB (Linux), for phase logging; -1 if n/a."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024
    except Exception:
        pass
    return -1

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


def pdf_to_dxf_auto(pdf_path: str, out_path: str, fmt: str = "dxf",
                    min_area_px: int = 4,
                    hole_area_frac_max: float = 0.35,
                    simplify_px: float = 0.25,
                    page_num: int = 0) -> dict:
    """Convert a PDF page to `out_path` in `fmt` ('dxf' or vectorized 'pdf'),
    tiling automatically when the page is too large to process in one pass.
    Both output formats stream per tile, so memory stays bounded."""
    t0 = time.time()
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    native_dpi = _detect_native_dpi(doc, page)
    zoom = native_dpi / 72.0
    W = int(round(page.rect.width * zoom))
    H = int(round(page.rect.height * zoom))
    mp = W * H / 1e6

    if mp <= SAFE_SINGLE_PASS_MP:
        # Small enough for one pass: use the original pipeline (which keeps
        # fills), and render a preview PDF from the DXF if PDF was requested.
        if fmt == "pdf":
            dxf_tmp = out_path + ".dxf"
            result = pipeline.pdf_to_dxf(
                pdf_path, dxf_tmp, min_area_px=min_area_px,
                hole_area_frac_max=hole_area_frac_max, simplify_px=simplify_px,
                page_num=page_num)
            render_preview.render_dxf_to_pdf(dxf_tmp, out_path)
            os.remove(dxf_tmp)
        else:
            result = pipeline.pdf_to_dxf(
                pdf_path, out_path, min_area_px=min_area_px,
                hole_area_frac_max=hole_area_frac_max, simplify_px=simplify_px,
                page_num=page_num)
        result["tiles"] = 1
        result["grid"] = "1x1"
        result["megapixels"] = round(mp, 1)
        result.setdefault("timing_s", {})["total"] = round(time.time() - t0, 1)
        return result

    # Choose a grid so each tile is ~<= TARGET_TILE_MP, roughly square tiles.
    side = math.sqrt(TARGET_TILE_MP * 1e6)
    cols = max(1, math.ceil(W / side))
    rows = max(1, math.ceil(H / side))
    tile_w = math.ceil(W / cols)
    tile_h = math.ceil(H / rows)
    print(f"[tile] page {W}x{H} ({mp:.0f}MP) grid {rows}x{cols} "
          f"tile~{tile_w}x{tile_h} fmt={fmt} rss={_rss_mb()}MB", flush=True)

    # Stream entities straight to the output (DXF via r12writer, or vector PDF
    # via StreamingPdf) so we never hold all shapes or a full in-memory
    # document: memory stays bounded to a single tile no matter how dense the
    # drawing. Coordinates go to global mm inline (Y flipped to the upward axis
    # both formats use, via the full page height).
    mm_per_px = 25.4 / native_dpi
    if fmt == "pdf":
        sink = StreamingPdf(out_path, W * 72.0 / native_dpi, H * 72.0 / native_dpi)
    else:
        sink = r12writer(out_path)

    n_entities = 0
    with sink as out:
        for r in range(rows):
            for c in range(cols):
                cx0, cy0 = c * tile_w, r * tile_h
                cx1, cy1 = min(W, cx0 + tile_w), min(H, cy0 + tile_h)
                if cx1 <= cx0 or cy1 <= cy0:
                    continue
                # rendered region = core + overlap halo
                rx0, ry0 = max(0, cx0 - OVERLAP_PX), max(0, cy0 - OVERLAP_PX)
                rx1, ry1 = min(W, cx1 + OVERLAP_PX), min(H, cy1 + OVERLAP_PX)

                ink = _render_region_ink(page, zoom, rx0, ry0, rx1, ry1)
                tshapes = extract.extract_shapes(ink, min_area_px=min_area_px)

                for s in tshapes:
                    bx0, by0, bx1, by1 = s.bbox  # tile-local (rel. to rx0,ry0)
                    gcx = rx0 + (bx0 + bx1) / 2.0  # global centroid
                    gcy = ry0 + (by0 + by1) / 2.0
                    if not (cx0 <= gcx < cx1 and cy0 <= gcy < cy1):
                        continue  # owned by a neighbouring tile's core
                    pts = np.array(s.contour, dtype=np.int32).reshape(-1, 1, 2)
                    if len(pts) < 3:
                        continue
                    if simplify_px > 0:
                        pts = cv2.approxPolyDP(pts, simplify_px, True)
                    if len(pts) < 3:
                        continue
                    poly = [((px + rx0) * mm_per_px, (H - (py + ry0)) * mm_per_px)
                            for px, py in pts[:, 0, :]]
                    out.add_polyline_2d(poly, closed=True, layer=_layer_for(s))
                    n_entities += 1

                del ink, tshapes
                gc.collect()
                print(f"[tile {r},{c}] entities={n_entities} rss={_rss_mb()}MB", flush=True)

    print(f"[done] entities={n_entities} fmt={fmt} rss={_rss_mb()}MB", flush=True)
    return {
        "path": out_path, "shape_count": n_entities, "audit_errors": 0,
        "counts": {}, "dpi": native_dpi, "tiles": rows * cols,
        "grid": f"{rows}x{cols}", "megapixels": round(mp, 1),
        "timing_s": {"total": round(time.time() - t0, 1)},
    }
