"""
End-to-end pipeline: PDF -> DXF.

This is the ENTIRE proven, working approach from the development
session, and nothing else. Earlier centerline/thinning approaches
(Zhang-Suen skeletonization, banded processing for memory safety,
stroke/centerline classification) were abandoned in favor of pure
contour tracing -- it's simpler, faster (~25-30s for a dense full A1
page vs. several minutes), and doesn't have the shape-distortion
problems thinning caused on fine detail like text.

Tuning knobs, and what's already been learned about each one:

  min_area_px (default 4): floor for a shape existing at all. Lower
    recovers finer detail; pushing much below 4 risks pulling in scan
    dust, though 4 tested clean on the reference drawing.

  hole_area_frac_max (default 0.35, in fill.py): how much enclosed
    emptiness a shape can have and still be classified "solid enough
    to fill". This is a FLAT threshold applied identically regardless
    of shape size -- known limitation, see below.

  simplify_px (default 0.25): Douglas-Peucker contour simplification
    tolerance. Lower preserves more detail at the cost of larger DXF
    files.

KNOWN OPEN ISSUE (as of last session): the flat fill threshold
over-fills medium/large shapes with genuinely busy content (e.g. a
table cell containing a small icon reads as "mostly ink" and gets
filled solid black, even though the intent was a thin cell border
with an icon inside, not a solid block). The fix that was diagnosed
but not yet implemented: scale the allowed hole fraction by shape
size -- lenient for small icon/character-scale shapes, strict
(near-zero tolerance) for anything cell/table-scale or larger. If
asked to improve fill quality, start there rather than re-adjusting
the single flat threshold, which was already found to have very
little headroom (the underlying hole-fraction distribution is
strongly bimodal, not a continuum you can dial gradually).
"""
from __future__ import annotations

import time

from . import extract, fill, export
from .load_pdf import load_pdf_ink


def pdf_to_dxf(pdf_path: str, out_dxf_path: str,
               min_area_px: int = 4,
               hole_area_frac_max: float = 0.35,
               simplify_px: float = 0.25,
               page_num: int = 0) -> dict:
    t0 = time.time()

    ink, dpi = load_pdf_ink(pdf_path, page_num=page_num)
    t_load = time.time() - t0

    shapes = extract.extract_shapes(ink, min_area_px=min_area_px)
    t_extract = time.time() - t0 - t_load

    decisions = fill.compute_fill_decisions(shapes, ink, hole_area_frac_max=hole_area_frac_max)
    t_fill = time.time() - t0 - t_load - t_extract

    result = export.build_dxf(shapes, decisions, ink.shape[0], dpi, out_dxf_path,
                               simplify_px=simplify_px)
    t_export = time.time() - t0 - t_load - t_extract - t_fill

    result["timing_s"] = {
        "load": round(t_load, 1),
        "extract": round(t_extract, 1),
        "fill_decide": round(t_fill, 1),
        "export": round(t_export, 1),
        "total": round(time.time() - t0, 1),
    }
    result["dpi"] = dpi
    result["shape_count"] = len(shapes)
    return result
