"""
Shape / attribute extraction for the pdf-to-dxf pipeline.

Why this replaces the thinning-first approach
---------------------------------------------
The original pipeline ran Zhang-Suen thinning on everything, which
collapses every stroke to 1px and reduces solid filled shapes to a
skeleton spine. That deliberately destroys the two attributes that
matter most for reading a construction drawing:

  - stroke WEIGHT (thick structural lines vs thin dimension/hatch lines)
  - solid FILL vs OUTLINE (a filled equipment symbol vs an open rectangle)

It is also the direct cause of the low ink-coverage number in the old
verification step: a 12px-wide black border reduced to a 1px centerline
cannot cover the original ink no matter how good the tracing is.

This module extracts those attributes instead of discarding them.

Method
------
1. Connected-component labelling on the ink mask.
2. Per component, a Euclidean distance transform gives the local
   half-width everywhere. max(DT) is the component's thickest radius.
3. Elongation = area / (4 * max_dt^2) separates linear strokes from
   blobs: a long thin stroke has large elongation, a filled disc has
   elongation ~= pi/4-ish regardless of size.
4. Components classified SOLID keep their OUTLINE (contour), not their
   skeleton, and are fitted to a primitive (triangle / rect / square /
   circle / polygon) via polygon approximation + circularity.
5. Components classified STROKE keep a centerline but carry a measured
   width, so downstream export can set a real DXF lineweight instead of
   emitting hairlines.

All deterministic. No model involved.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
import scipy.ndimage as ndi


@dataclass
class Shape:
    kind: str                 # "solid" | "stroke"
    primitive: str            # circle|square|rectangle|triangle|polygon|blob|line|polyline
    contour: list             # outline points (solid) or centerline points (stroke)
    width_px: float           # measured stroke width (strokes); mean thickness (solids)
    area_px: float
    bbox: tuple               # (x0, y0, x1, y1)
    filled: bool
    label_id: int = -1        # connected-component id (for exact masking)
    meta: dict = field(default_factory=dict)


def _classify_primitive(contour: np.ndarray, area: float) -> tuple[str, dict]:
    """Fit a geometric primitive to a closed contour."""
    peri = cv2.arcLength(contour, True)
    if peri <= 0:
        return "blob", {}
    circularity = 4 * np.pi * area / (peri * peri)

    # polygon approximation, tolerance proportional to perimeter
    approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
    n = len(approx)

    meta: dict[str, Any] = {"vertices": int(n), "circularity": round(float(circularity), 3)}

    if circularity > 0.80 and n > 5:
        return "circle", meta
    if n == 3:
        return "triangle", meta
    if n == 4:
        (_, _), (w, h), _ = cv2.minAreaRect(contour)
        if min(w, h) > 0:
            ar = max(w, h) / min(w, h)
            meta["aspect_ratio"] = round(float(ar), 2)
            return ("square" if ar < 1.15 else "rectangle"), meta
        return "rectangle", meta
    if n <= 10:
        return "polygon", meta
    return "blob", meta


def _emit_from_contour(cnt, x0, y0, area_override, elongation_split, thin_thick_split_px,
                        dt=None, padded=None):
    """Build a Shape (kind='stroke' or 'solid') from a single ink-level
    contour. area_override is the true pixel area if available (from
    connected-component labelling, for the outermost contour); nested
    ink islands use the contour's own polygon area since they don't
    have their own labelled pixel mask.
    """
    area = area_override if area_override is not None else float(cv2.contourArea(cnt))
    if dt is not None and padded is not None:
        max_dt = float(dt.max())
    else:
        peri = cv2.arcLength(cnt, True)
        max_dt = peri / 8.0 if peri > 0 else 1.0  # rough fallback
    elongation = area / (4.0 * max_dt * max_dt) if max_dt > 0 else 1.0

    if elongation >= elongation_split:
        if dt is not None and padded is not None:
            ridge = dt[padded]
            width = float(2.0 * np.median(ridge[ridge > 0])) if ridge.size else 2.0 * max_dt
        else:
            width = 2.0 * max_dt
        pts = [(int(p[0][0]) + x0, int(p[0][1]) + y0) for p in cnt]
        n_approx = len(cv2.approxPolyDP(cnt, 0.02 * cv2.arcLength(cnt, True), True))
        return Shape(
            kind="stroke",
            primitive="line" if n_approx <= 2 else "polyline",
            contour=pts, width_px=width, area_px=area,
            bbox=(x0, y0, x0, y0),  # bbox filled in by caller
            filled=False,
            meta={"elongation": round(float(elongation), 2),
                  "weight": "thin" if width < thin_thick_split_px else "thick"},
        )
    else:
        prim, meta = _classify_primitive(cnt, area)
        pts = [(int(p[0][0]) + x0, int(p[0][1]) + y0) for p in cnt]
        meta["elongation"] = round(float(elongation), 2)
        return Shape(
            kind="solid", primitive=prim, contour=pts,
            width_px=2.0 * max_dt, area_px=area,
            bbox=(x0, y0, x0, y0),
            filled=True,  # refined by caller using true hole area
            meta=meta,
        )


def extract_shapes(ink: np.ndarray,
                    min_area_px: int = 30,
                    elongation_split: float = 4.0,
                    thin_thick_split_px: float = 6.0) -> list[Shape]:
    """Extract shapes with fill/weight attributes from a boolean ink mask.

    Walks the FULL contour hierarchy (RETR_TREE), not just one level.
    Earlier versions used RETR_CCOMP (outer boundary + immediate hole
    only), which silently absorbs anything nested deeper: a hole that
    itself contains a nested ink island (very common -- text or a
    symbol sitting inside an enclosed gap) never became its own shape,
    and the hole's own fill-eligibility measurement picked up that
    nested ink as if it were part of the "empty" area. Measured on this
    drawing: 72% of interior-hole shapes were actually >50% ink by true
    pixel density -- they weren't holes at all, they had real content
    nested inside them that this extraction never surfaced. Walking the
    full tree makes every alternating ink/background level its own
    shape: even depths (0, 2, 4, ...) are ink and get evaluated for
    stroke/solid classification same as before; odd depths (1, 3, ...)
    are background regions.
    """
    lab, n = ndi.label(ink, structure=np.ones((3, 3), dtype=bool))
    objs = ndi.find_objects(lab)
    shapes: list[Shape] = []

    for i, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        sub = (lab[sl] == i)
        area = float(sub.sum())
        if area < min_area_px:
            continue

        padded = np.pad(sub, 1)
        dt = ndi.distance_transform_edt(padded)
        max_dt = float(dt.max())
        if max_dt <= 0:
            continue

        y0, x0 = sl[0].start - 1, sl[1].start - 1  # -1 for the pad

        u8 = (padded * 255).astype(np.uint8)
        contours, hierarchy = cv2.findContours(u8, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        if not contours or hierarchy is None:
            continue
        h = hierarchy[0]

        depth = {}
        def get_depth(k):
            if k in depth:
                return depth[k]
            parent = h[k][3]
            d = 0 if parent == -1 else get_depth(parent) + 1
            depth[k] = d
            return d
        for k in range(len(contours)):
            get_depth(k)

        outer_idx = max((k for k in range(len(contours)) if depth[k] == 0),
                         key=lambda k: cv2.contourArea(contours[k]), default=None)
        if outer_idx is None:
            continue

        for k, cnt in enumerate(contours):
            d = depth[k]
            ca = float(cv2.contourArea(cnt))
            if ca < min_area_px and k != outer_idx:
                continue

            if d % 2 == 0:
                # ink level (0 = the component itself, 2/4/... = nested
                # ink islands inside a background hole)
                area_override = area if k == outer_idx else None
                s = _emit_from_contour(cnt, x0, y0, area_override,
                                        elongation_split, thin_thick_split_px,
                                        dt=(dt if k == outer_idx else None),
                                        padded=(padded if k == outer_idx else None))
                xs = [p[0][0] for p in cnt]; ys = [p[0][1] for p in cnt]
                s.bbox = (x0 + min(xs), y0 + min(ys), x0 + max(xs), y0 + max(ys))
                s.label_id = i

                if k == outer_idx:
                    # true fill state needs the immediate hole area (children)
                    hole_area = sum(float(cv2.contourArea(contours[c]))
                                     for c in range(len(contours)) if h[c][3] == k)
                    enclosed = ca if ca > 0 else 1.0
                    hole_fraction = hole_area / enclosed
                    if s.kind == "solid":
                        s.filled = hole_fraction < 0.15
                        s.meta["hole_fraction"] = round(float(hole_fraction), 3)
                    s.meta["level"] = "outer"
                else:
                    # nested ink island: fill state from ITS OWN children
                    hole_area = sum(float(cv2.contourArea(contours[c]))
                                     for c in range(len(contours)) if h[c][3] == k)
                    enclosed = ca if ca > 0 else 1.0
                    hole_fraction = hole_area / enclosed
                    if s.kind == "solid":
                        s.filled = hole_fraction < 0.15
                        s.meta["hole_fraction"] = round(float(hole_fraction), 3)
                    s.meta["level"] = f"nested-ink-d{d}"
                shapes.append(s)
            else:
                # background level (hole) -- only emit as a 'region' shape
                # if it does NOT contain a nested ink island as a child;
                # if it does, that child is now its own real shape (see
                # above) and this region would just be double-booking
                # the same area
                has_ink_child = any(h[c][3] == k for c in range(len(contours)) if depth[c] == d + 1)
                if has_ink_child:
                    continue
                prim, meta = _classify_primitive(cnt, ca)
                meta["level"] = f"interior-d{d}"
                pts = [(int(p[0][0]) + x0, int(p[0][1]) + y0) for p in cnt]
                shapes.append(Shape(
                    kind="region", primitive=prim, contour=pts,
                    width_px=0.0, area_px=ca,
                    bbox=(x0 + min(p[0][0] for p in cnt), y0 + min(p[0][1] for p in cnt),
                          x0 + max(p[0][0] for p in cnt), y0 + max(p[0][1] for p in cnt)),
                    filled=False, label_id=i, meta=meta,
                ))

    return shapes


def summarize(shapes: list[Shape]) -> dict:
    out: dict[str, Any] = {"total": len(shapes)}
    by_kind: dict[str, int] = {}
    by_prim: dict[str, int] = {}
    by_weight: dict[str, int] = {}
    filled = 0
    for s in shapes:
        by_kind[s.kind] = by_kind.get(s.kind, 0) + 1
        by_prim[s.primitive] = by_prim.get(s.primitive, 0) + 1
        if s.kind == "stroke":
            w = s.meta.get("weight", "?")
            by_weight[w] = by_weight.get(w, 0) + 1
        if s.filled:
            filled += 1
    out["by_kind"] = by_kind
    out["by_primitive"] = by_prim
    out["stroke_weight"] = by_weight
    out["filled_count"] = filled
    return out
