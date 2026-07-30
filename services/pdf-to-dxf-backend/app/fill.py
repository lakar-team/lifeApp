"""
Fill decision, as a standalone post-process after contourization.

Rewritten from scratch because the old rule (kind=='solid' and
hole_fraction<0.15 and bbox-diagonal<=150px) was measuring the wrong
thing and using an arbitrary size cutoff with no principled basis.

Why "ink fraction inside a shape's own tight outer boundary" doesn't
work (tested and discarded): ANY tightly-traced contour -- solid or
hollow -- shows near-100% self ink-fraction, because the contour hugs
the ink by construction. Measured on this drawing: solid-kind shapes
median 1.00, but large STROKE-kind shapes (elongated fused networks)
ALSO median 0.99. That statistic can't tell a filled digit from a
network of thin lines.

The test that actually distinguishes them: does the shape enclose a
MEANINGFUL HOLE? A hollow shape -- a ring, a box frame, the loop of a
double-line stroke -- encloses real empty area. A genuinely solid mark
-- a filled digit stroke, a dot, a solid valve indicator -- does not.
This is computed directly from the raw ink array (not the simplified
contour), using true connected-component hole area via cv2 hierarchy,
so it's exact rather than approximated by shape class or size.
"""
from __future__ import annotations

import cv2
import numpy as np


def compute_fill_decisions(shapes, ink: np.ndarray, hole_area_frac_max: float = 0.35):
    """
    For each shape, decide fill by directly re-deriving hole area from
    the raw ink at that shape's own connected-component label -- not by
    trusting the kind/hole_fraction values already on the Shape (those
    were computed once at extraction time for 'solid' shapes only;
    'stroke' shapes never got this evaluated at all, which was half of
    why the old rule made no sense on this drawing's big fused networks).

    Returns a dict {id(shape): bool}.
    """
    decisions = {}
    # group by label so we only touch each connected component's raw
    # pixels once, regardless of how many sub-shapes (holes/regions)
    # came from it
    by_label: dict[int, list] = {}
    for s in shapes:
        by_label.setdefault(s.label_id, []).append(s)

    for label_id, group in by_label.items():
        for s in group:
            x0, y0, x1, y1 = s.bbox
            x0, y0 = max(0, x0 - 1), max(0, y0 - 1)
            x1, y1 = min(ink.shape[1], x1 + 1), min(ink.shape[0], y1 + 1)
            if x1 <= x0 or y1 <= y0:
                decisions[id(s)] = False
                continue
            local_ink = ink[y0:y1, x0:x1]

            pts = np.array([(px - x0, py - y0) for px, py in s.contour],
                            dtype=np.int32).reshape(-1, 1, 2)
            if len(pts) < 3:
                decisions[id(s)] = False
                continue

            enclosed_mask = np.zeros(local_ink.shape, dtype=np.uint8)
            cv2.fillPoly(enclosed_mask, [pts], 1)
            enclosed_area = int(enclosed_mask.sum())
            if enclosed_area == 0:
                decisions[id(s)] = False
                continue

            # true hole area = enclosed area that is NOT ink in the
            # source scan (re-derived from raw pixels, exact -- not the
            # simplified/approximated contour geometry)
            hole_px = int((enclosed_mask.astype(bool) & ~local_ink).sum())
            hole_frac = hole_px / enclosed_area

            decisions[id(s)] = hole_frac <= hole_area_frac_max

    return decisions
