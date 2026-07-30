"""
PDF loading and native-DPI detection.

Scanned engineering drawings are frequently embedded as tiled raster
images inside the PDF, each tile at some real scan resolution (often
1200 DPI for detailed technical drawings). Rendering at a guessed
default (e.g. 150/300 DPI) silently throws away real detail that's
actually present in the file. This detects the true native resolution
from the embedded image geometry instead of assuming one.
"""
from __future__ import annotations

import numpy as np
import fitz  # PyMuPDF


def load_pdf_ink(pdf_path: str, page_num: int = 0) -> tuple[np.ndarray, float]:
    """
    Load a PDF page and render it to a boolean ink bitmap at its true
    native scan resolution.

    Returns (ink, dpi) where ink is a boolean array (True = ink/black)
    and dpi is the resolution it was rendered at.
    """
    doc = fitz.open(pdf_path)
    page = doc[page_num]

    rects = []
    for img in page.get_images(full=True):
        xref = img[0]
        base = doc.extract_image(xref)
        tile_px_w = base["width"]
        for r in page.get_image_rects(xref):
            tile_pt_w = r.width
            if tile_pt_w > 0:
                scale_px_per_pt = tile_px_w / tile_pt_w
                rects.append(scale_px_per_pt * 72)

    if rects:
        # Tiled or single embedded raster -- use the detected native DPI,
        # not a guessed default.
        native_dpi = float(np.median(rects))
    else:
        native_dpi = 300.0  # vector-only or no embedded raster found

    zoom = native_dpi / 72
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY, alpha=False)
    img_arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    ink = img_arr < 128

    return ink, native_dpi
