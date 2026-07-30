"""
DXF export: pure contour geometry (no centerline/thinning anywhere),
with fill applied per the decisions from fill.compute_fill_decisions.

Layer scheme:
  SHAPE-FILLED   -- solid black fill applied (genuinely solid ink)
  SHAPE-OUTLINE  -- closed shape, not filled (encloses real empty space)
  SHAPE-INTERIOR -- interior hole regions (room interiors, gaps, etc.)
  NETWORK-OUTER  -- large fused components that aren't being filled
  LINE-THICK     -- elongated strokes, measured width >= threshold
  LINE-THIN      -- elongated strokes, measured width < threshold
"""
from __future__ import annotations

import cv2
import ezdxf
import numpy as np

LAYERS = {
    "filled":   ("SHAPE-FILLED",   1),
    "outline":  ("SHAPE-OUTLINE",  30),
    "interior": ("SHAPE-INTERIOR", 6),
    "network":  ("NETWORK-OUTER",  3),
    "thick":    ("LINE-THICK",     5),
    "thin":     ("LINE-THIN",      4),
}


def build_dxf(shapes, decisions, page_h_px: int, dpi: float, out_path: str,
              simplify_px: float = 0.25, large_area_px: float = 15000,
              thin_thick_split_px: float = 6.0, run_audit: bool = True) -> dict:
    mm_per_px = 25.4 / dpi
    doc = ezdxf.new("R2010", setup=False)
    doc.header["$INSUNITS"] = 4  # millimetres
    msp = doc.modelspace()
    for _, (name, color) in LAYERS.items():
        if name not in doc.layers:
            doc.layers.add(name, color=color)

    def xy(px, py):
        return (px * mm_per_px, (page_h_px - py) * mm_per_px)

    counts: dict[str, int] = {}
    hatched = 0

    for s in shapes:
        pts = np.array(s.contour, dtype=np.int32).reshape(-1, 1, 2)
        if len(pts) < 3:
            continue
        if simplify_px > 0:
            pts = cv2.approxPolyDP(pts, simplify_px, True)
        if len(pts) < 3:
            continue
        poly = [xy(float(p[0][0]), float(p[0][1])) for p in pts]

        will_fill = decisions.get(id(s), False)
        if s.kind == "region":
            key = "interior"
        elif s.area_px > large_area_px and not will_fill:
            key = "network"
        elif will_fill:
            key = "filled"
        elif s.kind == "stroke":
            key = "thick" if s.width_px >= thin_thick_split_px else "thin"
        else:
            key = "outline"
        counts[key] = counts.get(key, 0) + 1

        msp.add_lwpolyline(poly, close=True,
                            dxfattribs={"layer": LAYERS[key][0], "lineweight": 0})
        if will_fill:
            try:
                h = msp.add_hatch(color=LAYERS["filled"][1],
                                   dxfattribs={"layer": LAYERS["filled"][0]})
                h.paths.add_polyline_path(poly, is_closed=True)
                hatched += 1
            except Exception:
                pass

    doc.saveas(out_path)
    # The audit re-reads the whole DXF into a SECOND ezdxf document -- a large
    # memory spike on dense drawings. Skippable on memory-constrained hosts.
    audit_errors = 0
    if run_audit:
        audit_errors = len(ezdxf.readfile(out_path).audit().errors)
    return {"path": out_path, "counts": counts, "hatched": hatched,
            "audit_errors": audit_errors}
