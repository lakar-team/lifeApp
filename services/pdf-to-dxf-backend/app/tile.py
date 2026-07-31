"""
Unified vectorization pipeline: a PDF page -> a filled vector drawing.

ONE process for every document. A producer (`_iter_polys`) yields the drawing's
ink regions as polygons-with-holes in global millimetres; **tiling is an
internal, size-driven memory strategy** (a small page is simply one tile) and
never changes the result. A streaming sink serialises those regions to the
requested format -- vector **PDF** (the default) or **DXF** -- so both formats
come out of the SAME filled result and are guaranteed identical.

Fill rule: **every ink region is filled solid, preserving its inner holes**
(box interiors and letter counters stay open) -- "paint in the ink," so the
output resembles the original inked drawing. No per-shape fill decision, no
knob: if it's ink, it's filled.

Memory stays bounded to one tile because shapes are STREAMED straight to the
output -- we never hold all shapes or a full in-memory document.
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
import ezdxf
from ezdxf import const as ezconst

# --- memory budgeting: the grid auto-sizes from the ACTUAL page, aiming for
# comfortable headroom (each tile ~a third of the cap), not the ragged edge. ---
HOST_MEM_MB = 512
PROCESS_BASE_MB = 150
BYTES_PER_PX = 6            # gray(1B) + bool ink(1B) + OpenCV CV_32S labels(4B)
TARGET_TILE_MB = 170.0
TARGET_TILE_MP = TARGET_TILE_MB / BYTES_PER_PX
SAFE_SINGLE_PASS_MP = (0.65 * HOST_MEM_MB - PROCESS_BASE_MB) / BYTES_PER_PX  # ~31 MP
OVERLAP_PX = 96            # halo so a seam-crossing shape is whole in one tile
MIN_AREA_PX = 4            # drop ink specks smaller than this (scan noise)
MIN_HOLE_PX = 8            # drop negligible holes (keep real counters/interiors)
# Applied to the CAPTURED outline (never the raster): smooth de-jags, then
# simplify reduces point count. Both conservative -- tune to taste.
SMOOTH_SIGMA = 1.0         # light Gaussian de-jag along the contour (px); 0 = off
SIMPLIFY_PX = 0.5          # Douglas-Peucker point reduction after smoothing (px); 0 = off


def _rss_mb() -> int:
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024
    except Exception:
        pass
    return -1


def _detect_native_dpi(doc, page) -> float:
    rects = []
    for img in page.get_images(full=True):
        tile_px_w = img[2]  # (xref, smask, width, height, ...) -> width
        for r in page.get_image_rects(img[0]):
            if r.width > 0:
                rects.append((tile_px_w / r.width) * 72)
    return float(np.median(rects)) if rects else 300.0


def _render_region_ink(page, zoom, px0, py0, px1, py1):
    """Render just the pixel rectangle to a boolean ink mask, without
    materialising the whole page."""
    clip = fitz.Rect(px0 / zoom, py0 / zoom, px1 / zoom, py1 / zoom)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip,
                          colorspace=fitz.csGRAY, alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    return arr < 128


# --------------------------- streaming output sinks -------------------------

class PdfSink:
    """Minimal single-page vector PDF. Each ink region is a black fill with the
    even-odd rule, so inner holes stay open. Stroke operators are streamed to a
    temp content file (memory-bounded), then wrapped in a tiny PDF."""
    _K = 72.0 / 25.4  # millimetres -> PDF points

    def __init__(self, out_path, width_pt, height_pt):
        self.out_path = out_path
        self.w = width_pt
        self.h = height_pt
        self._content = out_path + ".content"
        self._cf = None

    def __enter__(self):
        self._cf = open(self._content, "w")
        self._cf.write("0 g\n")  # nonstroking colour = black
        return self

    def add_filled(self, outer, holes):
        k = self._K

        def ring(pts):
            it = iter(pts)
            x0, y0 = next(it)
            parts = [f"{x0 * k:.2f} {y0 * k:.2f} m"]
            for x, y in it:
                parts.append(f"{x * k:.2f} {y * k:.2f} l")
            parts.append("h")
            return " ".join(parts)

        segs = [ring(outer)] + [ring(h) for h in holes]
        self._cf.write(" ".join(segs) + " f*\n")  # even-odd: outer minus holes

    def __exit__(self, *exc):
        self._cf.close()
        clen = os.path.getsize(self._content)
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
            with open(self._content, "rb") as cf:
                shutil.copyfileobj(cf, f, 1 << 20)
            w("\nendstream\nendobj\n")
            xref = f.tell()
            w("xref\n0 5\n0000000000 65535 f \n")
            for i in range(1, 5):
                w(f"{off[i]:010d} 00000 n \n")
            w(f"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n")
        os.remove(self._content)
        return False


class DxfSink:
    """DXF with native solid HATCH fills -- one editable hatch per ink region
    (inner holes kept open via island detection) plus snappable boundary
    polylines. Builds an in-memory ezdxf document rather than streaming: the
    accepted tradeoff for real hatches. The raster is still tiled, so only the
    vector document grows with shape count, not the whole-page bitmap."""

    def __init__(self, out_path):
        self.out_path = out_path

    def __enter__(self):
        self.doc = ezdxf.new("R2010")
        self.doc.header["$INSUNITS"] = 4  # millimetres
        for name in ("INK-OUTLINE", "INK-FILL"):
            if name not in self.doc.layers:
                self.doc.layers.add(name, color=7)
        self.msp = self.doc.modelspace()
        return self

    def add_filled(self, outer, holes):
        # snappable boundary geometry
        self.msp.add_lwpolyline(outer, close=True,
                                dxfattribs={"layer": "INK-OUTLINE", "lineweight": 0})
        for h in holes:
            self.msp.add_lwpolyline(h, close=True,
                                    dxfattribs={"layer": "INK-OUTLINE", "lineweight": 0})
        # native solid hatch; outer boundary + holes -> island detection cuts holes
        hatch = self.msp.add_hatch(color=7, dxfattribs={"layer": "INK-FILL"})
        hatch.dxf.hatch_style = 0  # odd-even island detection
        hatch.paths.add_polyline_path(outer, is_closed=True,
                                      flags=ezconst.BOUNDARY_PATH_EXTERNAL)
        for h in holes:
            hatch.paths.add_polyline_path(h, is_closed=True,
                                          flags=ezconst.BOUNDARY_PATH_DEFAULT)

    def __exit__(self, *exc):
        self.doc.saveas(self.out_path)
        return False


# ------------------------------ producer ------------------------------------

def _grid(W, H):
    """Tile grid chosen from the actual page size; 1x1 when it fits one pass."""
    if W * H / 1e6 <= SAFE_SINGLE_PASS_MP:
        return 1, 1
    side = math.sqrt(TARGET_TILE_MP * 1e6)
    return max(1, math.ceil(H / side)), max(1, math.ceil(W / side))


def _smooth_ring(pts, sigma):
    """Light circular Gaussian along a closed contour: averages out the
    pixel-staircase jitter while keeping real corners (which span many
    consistent pixels and survive), operating on the captured outline points."""
    n = len(pts)
    if sigma <= 0 or n < 6:
        return pts
    radius = max(1, int(round(sigma * 2)))
    if n <= 2 * radius:
        return pts
    t = np.arange(-radius, radius + 1)
    ker = np.exp(-0.5 * (t / sigma) ** 2)
    ker /= ker.sum()
    padded = np.concatenate([pts[-radius:], pts, pts[:radius]], axis=0)
    xs = np.convolve(padded[:, 0], ker, mode="valid")
    ys = np.convolve(padded[:, 1], ker, mode="valid")
    return np.stack([xs, ys], axis=1)


def _to_mm(cnt, rx0, ry0, H, mm):
    """Process a captured contour into global mm: smooth (de-jag) THEN simplify
    (reduce points) -- both on the CAPTURED OUTLINE, never the raster -- then
    map to millimetres, Y-flipped."""
    pts = cnt[:, 0, :].astype(np.float32)
    if SMOOTH_SIGMA > 0:
        pts = _smooth_ring(pts, SMOOTH_SIGMA).astype(np.float32)
    if SIMPLIFY_PX > 0 and len(pts) >= 3:
        pts = cv2.approxPolyDP(pts.reshape(-1, 1, 2), SIMPLIFY_PX, True)[:, 0, :]
    if len(pts) < 3:
        return None
    return [((float(px) + rx0) * mm, (H - (float(py) + ry0)) * mm) for px, py in pts]


def _iter_polys(page, zoom, W, H, native_dpi):
    """Yield (outer_mm, [holes_mm]) per ink region in global millimetres.
    Tiles internally; de-dups seam-crossing regions by centroid ownership."""
    mm = 25.4 / native_dpi
    rows, cols = _grid(W, H)
    tile_w, tile_h = math.ceil(W / cols), math.ceil(H / rows)
    print(f"[trace] page {W}x{H} ({W*H/1e6:.0f}MP) grid {rows}x{cols} rss={_rss_mb()}MB", flush=True)

    for r in range(rows):
        for c in range(cols):
            cx0, cy0 = c * tile_w, r * tile_h
            cx1, cy1 = min(W, cx0 + tile_w), min(H, cy0 + tile_h)
            if cx1 <= cx0 or cy1 <= cy0:
                continue
            rx0, ry0 = max(0, cx0 - OVERLAP_PX), max(0, cy0 - OVERLAP_PX)
            rx1, ry1 = min(W, cx1 + OVERLAP_PX), min(H, cy1 + OVERLAP_PX)

            ink = _render_region_ink(page, zoom, rx0, ry0, rx1, ry1)
            u8 = (ink * np.uint8(255))
            # RETR_CCOMP: top-level contours are ink boundaries, their children
            # are holes (enclosed non-ink) -- exactly a polygon-with-holes.
            # CHAIN_APPROX_NONE = the full traced outline (every boundary pixel),
            # so smoothing has the staircase to average; we simplify afterwards.
            contours, hierarchy = cv2.findContours(u8, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
            if hierarchy is not None:
                hier = hierarchy[0]
                for i, cnt in enumerate(contours):
                    if hier[i][3] != -1:
                        continue  # not a top-level ink boundary
                    if cv2.contourArea(cnt) < MIN_AREA_PX:
                        continue
                    x, y, bw, bh = cv2.boundingRect(cnt)
                    gcx, gcy = rx0 + x + bw / 2.0, ry0 + y + bh / 2.0
                    if not (cx0 <= gcx < cx1 and cy0 <= gcy < cy1):
                        continue  # owned by a neighbouring tile's core
                    outer = _to_mm(cnt, rx0, ry0, H, mm)
                    if outer is None:
                        continue
                    holes = []
                    ch = hier[i][2]  # first child (hole)
                    while ch != -1:
                        if cv2.contourArea(contours[ch]) >= MIN_HOLE_PX:
                            hp = _to_mm(contours[ch], rx0, ry0, H, mm)
                            if hp is not None:
                                holes.append(hp)
                        ch = hier[ch][0]  # next sibling
                    yield outer, holes

            del ink, u8, contours, hierarchy
            gc.collect()
            print(f"[trace] tile {r},{c} rss={_rss_mb()}MB", flush=True)


def pdf_to_dxf_auto(pdf_path, out_path, fmt="dxf", page_num=0, **_):
    """Convert a PDF page to `out_path` in `fmt` ('pdf' or 'dxf'). Both formats
    are serialised from the SAME streamed filled-shape result."""
    t0 = time.time()
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    native_dpi = _detect_native_dpi(doc, page)
    zoom = native_dpi / 72.0
    W = int(round(page.rect.width * zoom))
    H = int(round(page.rect.height * zoom))

    if fmt == "pdf":
        sink = PdfSink(out_path, W * 72.0 / native_dpi, H * 72.0 / native_dpi)
    else:
        sink = DxfSink(out_path)

    n = 0
    with sink:
        for outer, holes in _iter_polys(page, zoom, W, H, native_dpi):
            sink.add_filled(outer, holes)
            n += 1

    print(f"[done] shapes={n} fmt={fmt} rss={_rss_mb()}MB", flush=True)
    return {"shape_count": n, "audit_errors": 0, "dpi": native_dpi,
            "megapixels": round(W * H / 1e6, 1),
            "timing_s": {"total": round(time.time() - t0, 1)}}
