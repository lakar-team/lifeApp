"""
PDF/PNG scan -> DXF vectorization pipeline.

Implements PDFTODXFBACKENDSPEC.md: native-resolution render, despeckle,
vectorized Zhang-Suen thinning, neighbor-run graph tracing, geometry
fitting with anti-phantom-arc guards, ezdxf export with audit, and
raster-back verification.

All stages report progress through a callback with real counters, never
simulated percentages.
"""

import math

import ezdxf
import fitz  # pymupdf
import numpy as np
import scipy.ndimage as ndi
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None  # scans here are legitimately hundreds of MP

# ----------------------------------------------------------------------
# Stage 1: load + native resolution detection
# ----------------------------------------------------------------------

DEFAULT_PDF_DPI = 300      # only when a PDF page has no embedded raster at all
DEFAULT_IMAGE_DPI = 600    # only when a PNG/JPG carries no DPI metadata
MAX_PIXELS = 300e6         # hard sanity ceiling; above this, downscale render


def load_input(path: str, filename: str, progress):
    """Returns (ink bool ndarray [True=foreground], dpi used)."""
    lower = filename.lower()
    if lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")):
        return _load_image(path, progress)
    return _load_pdf(path, progress)


def _load_image(path, progress):
    im = Image.open(path)
    dpi = float((im.info.get("dpi") or (DEFAULT_IMAGE_DPI, DEFAULT_IMAGE_DPI))[0]) or DEFAULT_IMAGE_DPI
    progress(stage="rendering", detail={"source": "image", "width": im.width,
                                        "height": im.height, "dpi": round(dpi)})
    gray = np.asarray(im.convert("L"))
    return gray < 128, dpi


def _detect_native_dpi(page):
    """True scan resolution from embedded image tiles: px-per-pt * 72.
    Scanned drawings are frequently a grid of image XObjects, not one image;
    any tile's pixel-width / placed-width gives the native scale."""
    best = None
    for img in page.get_images(full=True):
        xref, w_px = img[0], img[2]
        if not w_px:
            continue
        for rect in page.get_image_rects(xref):
            if rect.width <= 0:
                continue
            dpi = (w_px / rect.width) * 72.0
            # keep the highest plausible tile resolution seen on the page
            if 50 <= dpi <= 2400 and (best is None or dpi > best):
                best = dpi
    return best


def _load_pdf(path, progress):
    doc = fitz.open(path)
    page = doc[0]
    native = _detect_native_dpi(page)
    dpi = native or DEFAULT_PDF_DPI
    w_pt, h_pt = page.rect.width, page.rect.height
    # respect the sanity ceiling without silently dropping below native detail
    px = (w_pt * dpi / 72.0) * (h_pt * dpi / 72.0)
    if px > MAX_PIXELS:
        dpi *= math.sqrt(MAX_PIXELS / px)
    zoom = dpi / 72.0
    progress(stage="rendering", detail={
        "source": "pdf", "native_dpi": round(native) if native else None,
        "render_dpi": round(dpi),
        "width": round(w_pt * zoom), "height": round(h_pt * zoom)})
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom),
                          colorspace=fitz.csGRAY, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    ink = img < 128
    doc.close()
    return ink, dpi


# ----------------------------------------------------------------------
# Stage 2: despeckle
# ----------------------------------------------------------------------

def despeckle(ink, dpi, progress):
    # ~1/100 mm^2 of ink at the working resolution (22px at 1200dpi per spec)
    min_size = max(4, round(22 * (dpi / 1200.0) ** 2))
    labels, n = ndi.label(ink, structure=np.ones((3, 3), dtype=bool))
    sizes = np.bincount(labels.ravel())
    keep = sizes >= min_size
    keep[0] = False
    cleaned = keep[labels]
    progress(stage="despeckling", detail={
        "components": int(n),
        "kept": int(keep.sum()),
        "min_size_px": min_size,
        "ink_px": int(cleaned.sum())})
    return cleaned


# ----------------------------------------------------------------------
# Stage 3: vectorized Zhang-Suen thinning
# ----------------------------------------------------------------------

def zhang_suen(img, progress):
    img = img.copy()
    pad = np.zeros((img.shape[0] + 2, img.shape[1] + 2), dtype=bool)
    iteration = 0
    while True:
        changed = False
        for sub in range(2):
            pad[1:-1, 1:-1] = img
            p2 = pad[0:-2, 1:-1]; p3 = pad[0:-2, 2:]; p4 = pad[1:-1, 2:]
            p5 = pad[2:, 2:];     p6 = pad[2:, 1:-1]; p7 = pad[2:, 0:-2]
            p8 = pad[1:-1, 0:-2]; p9 = pad[0:-2, 0:-2]
            b = (p2.astype(np.uint8) + p3 + p4 + p5 + p6 + p7 + p8 + p9)
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            a = np.zeros(img.shape, dtype=np.uint8)
            for k in range(8):
                a += (~seq[k] & seq[k + 1])
            cond = img & (b >= 2) & (b <= 6) & (a == 1)
            if sub == 0:
                cond &= ~(p2 & p4 & p6); cond &= ~(p4 & p6 & p8)
            else:
                cond &= ~(p2 & p4 & p8); cond &= ~(p2 & p6 & p8)
            if cond.any():
                img[cond] = False
                changed = True
        iteration += 1
        progress(stage="thinning", detail={
            "iteration": iteration, "remaining_px": int(img.sum())})
        if not changed:
            break
    return img


# ----------------------------------------------------------------------
# Stage 4: skeleton -> graph (neighbor-run classification, edge bitmask)
# ----------------------------------------------------------------------

# clockwise ring from NW, as (dx, dy); index k's opposite direction is (k+4)%8
NB = [(-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]


def _build_runs_table():
    runs_table = []
    for m in range(256):
        present = [(m >> k) & 1 for k in range(8)]
        if all(present):
            runs_table.append((tuple(range(8)),))
            continue
        start = present.index(0)
        runs, cur = [], []
        for j in range(1, 9):
            k = (start + j) % 8
            if present[k]:
                cur.append(k)
            elif cur:
                runs.append(tuple(cur)); cur = []
        if cur:
            runs.append(tuple(cur))
        runs_table.append(tuple(runs))
    return runs_table


RUNS = _build_runs_table()
DEGREE = np.array([len(r) for r in RUNS], dtype=np.uint8)


def _neighbor_mask(skel):
    """Per-pixel 8-bit bitmask of foreground neighbors, bit k = NB[k]."""
    h, w = skel.shape
    pad = np.zeros((h + 2, w + 2), dtype=bool)
    pad[1:-1, 1:-1] = skel
    mask = np.zeros((h, w), dtype=np.uint8)
    for k, (dx, dy) in enumerate(NB):
        mask |= (pad[1 + dy:h + 1 + dy, 1 + dx:w + 1 + dx].astype(np.uint8) << k)
    return mask


# pixels whose whole neighborhood is one ring-consecutive pair are redundant
# width: the pair is directly adjacent, so removing the pixel changes nothing
# topologically. Zhang-Suen leaves these "staircase" doubles along curves,
# and they shred loop tracing into hundreds of 3-px orphan fragments.
_REDUNDANT = np.array([len(r) == 1 and len(r[0]) == 2 for r in RUNS], dtype=bool)


def staircase_reduce(skel):
    img = skel.copy()
    while True:
        mask = _neighbor_mask(img)
        cand = img & _REDUNDANT[mask]
        if not cand.any():
            return img
        # checkerboard parity: never remove two mutually-supporting pixels in
        # the same sweep, or a 2-wide diagonal could disconnect
        ys, xs = np.nonzero(cand)
        sel = ((ys + xs) & 1) == 0
        if not sel.any():
            sel = ~sel
        img[ys[sel], xs[sel]] = False


def trace_graph(skel, progress):
    """Returns list of branches: (points ndarray [N,2] of (x,y), closed bool).

    Junction/endpoint classification uses cyclic neighbor-run counts, never
    raw popcount (raw popcount turns every T-junction into phantom junctions
    and shreds circles into stub branches). Edge traversal is guarded by a
    per-pixel uint8 visited-direction bitmask so pathological loop topology
    can never trace forever.
    """
    h, w = skel.shape
    mask = _neighbor_mask(skel)
    degree = np.where(skel, DEGREE[mask], 0)
    is_node = skel & ((degree == 1) | (degree >= 3))
    visited = np.zeros((h, w), dtype=np.uint8)  # bit k: edge k out of px taken

    branches = []

    def walk(x, y, k):
        """Walk from node (x,y) into direction k until the next node pixel.
        Returns the point list, or None if the first edge was already taken."""
        if visited[y, x] & (1 << k):
            return None
        pts = [(x, y)]
        px, py = x, y
        while True:
            if visited[py, px] & (1 << k):   # cycle guard: edge re-take = stop
                return pts
            dx, dy = NB[k]
            qx, qy = px + dx, py + dy
            if not (0 <= qx < w and 0 <= qy < h) or not skel[qy, qx]:
                return pts
            visited[py, px] |= (1 << k)
            visited[qy, qx] |= (1 << ((k + 4) % 8))
            pts.append((qx, qy))
            if is_node[qy, qx]:
                return pts
            # pass-through pixel: continue along the run that doesn't contain
            # the direction we arrived from
            back = (k + 4) % 8
            nxt = None
            for run in RUNS[mask[qy, qx]]:
                if back not in run:
                    nxt = run[0]
                    break
            if nxt is None:
                return pts
            px, py, k = qx, qy, nxt

    # pass 1: branches out of every endpoint/junction, one per neighbor run
    node_ys, node_xs = np.nonzero(is_node)
    total_nodes = len(node_xs)
    for i in range(total_nodes):
        x, y = int(node_xs[i]), int(node_ys[i])
        for run in RUNS[mask[y, x]]:
            pts = walk(x, y, run[0])
            if pts and len(pts) >= 2:
                branches.append((np.array(pts, dtype=np.float64), False))
        if total_nodes and i % 5000 == 4999:
            progress(stage="tracing", detail={
                "nodes_done": i + 1, "nodes_total": total_nodes,
                "branches": len(branches)})

    # pass 2: untouched pixels belong to pure closed loops (no node anywhere)
    touched = visited > 0
    loop_px = skel & ~touched & ~is_node
    loop_ys, loop_xs = np.nonzero(loop_px)
    seen = np.zeros((h, w), dtype=bool)
    for i in range(len(loop_xs)):
        x, y = int(loop_xs[i]), int(loop_ys[i])
        if seen[y, x]:
            continue
        pts = [(x, y)]
        seen[y, x] = True
        px, py, back = x, y, -1
        while True:
            nxt = None
            for run in RUNS[mask[py, px]]:
                if back in run:
                    continue
                for k in run:
                    dx, dy = NB[k]
                    qx, qy = px + dx, py + dy
                    if 0 <= qx < w and 0 <= qy < h and skel[qy, qx] and not seen[qy, qx]:
                        nxt = (qx, qy, (k + 4) % 8)
                        break
                if nxt:
                    break
            if not nxt:
                break
            px, py, back = nxt
            seen[py, px] = True
            pts.append((px, py))
        # only a walk that actually returns adjacent to its start is a loop;
        # anything shorter than 8px here is a thinning artifact, not content
        if len(pts) >= 8:
            first, last = pts[0], pts[-1]
            is_closed = max(abs(first[0] - last[0]), abs(first[1] - last[1])) <= 1
            branches.append((np.array(pts, dtype=np.float64), is_closed))

    # isolated skeleton pixels are deliberate pen dots thinned to one pixel
    # (a real scanned dot survives despeckle, then collapses here) — keep
    # them; they'd otherwise vanish since a branch needs two points
    dot_ys, dot_xs = np.nonzero(skel & (degree == 0))
    dots = [(float(x), float(y)) for x, y in zip(dot_xs, dot_ys)]

    progress(stage="tracing", detail={
        "nodes_total": total_nodes, "branches": len(branches),
        "closed_loops": sum(1 for _, c in branches if c),
        "dots": len(dots)})
    return branches, dots


# ----------------------------------------------------------------------
# Stage 5: geometry fitting
# ----------------------------------------------------------------------

def _dp_iterative(pts, eps):
    """Iterative Douglas-Peucker (no recursion limits on long chains)."""
    n = len(pts)
    if n < 3:
        return pts
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 - i0 < 2:
            continue
        p0, p1 = pts[i0], pts[i1]
        d = p1 - p0
        norm = math.hypot(d[0], d[1])
        seg = pts[i0 + 1:i1]
        if norm < 1e-12:
            dist = np.hypot(seg[:, 0] - p0[0], seg[:, 1] - p0[1])
        else:
            dist = np.abs(d[0] * (p0[1] - seg[:, 1]) - d[1] * (p0[0] - seg[:, 0])) / norm
        j = int(np.argmax(dist))
        if dist[j] > eps:
            m = i0 + 1 + j
            keep[m] = True
            stack.append((i0, m))
            stack.append((m, i1))
    return pts[keep]


def _fit_circle(pts):
    """Kasa algebraic circle fit. Returns (cx, cy, r, rms) or None."""
    n = len(pts)
    if n < 3:
        return None
    x, y = pts[:, 0], pts[:, 1]
    z = x * x + y * y
    A = np.column_stack([x, y, np.ones(n)])
    try:
        sol, *_ = np.linalg.lstsq(A, z, rcond=None)
    except np.linalg.LinAlgError:
        return None
    cx, cy = sol[0] / 2.0, sol[1] / 2.0
    r2 = sol[2] + cx * cx + cy * cy
    if r2 <= 0:
        return None
    r = math.sqrt(r2)
    rms = math.sqrt(np.mean((np.hypot(x - cx, y - cy) - r) ** 2))
    return cx, cy, r, rms


def _merge_collinear(pts, tol_deg=2.0):
    """Drop interior vertices of nearly-collinear consecutive segments."""
    if len(pts) <= 2:
        return pts
    out = [pts[0], pts[1]]
    for c in pts[2:]:
        a, b = out[-2], out[-1]
        a1 = math.atan2(b[1] - a[1], b[0] - a[0])
        a2 = math.atan2(c[1] - b[1], c[0] - b[0])
        diff = abs(math.degrees(a1 - a2)) % 360
        if diff > 180:
            diff = 360 - diff
        if diff <= tol_deg:
            out[-1] = c
        else:
            out.append(c)
    return np.array(out)


def fit_geometry(branches, dots, dpi, progress):
    """Branch pixel-chains -> entity dicts, coordinates in px (image y-down)."""
    eps = max(0.75, 2.0 * dpi / 1200.0)      # ~0.042mm
    max_radius = 4000.0 * dpi / 1200.0        # physically-plausible radius cap
    # a real drawn arc is at least ~1mm radius; below that, "arcs" are just
    # junction debris that happens to satisfy the sweep test
    min_radius = 47.0 * dpi / 1200.0
    entities = [{"type": "POINT", "x": x, "y": y, "layer": "GEOMETRY-POINTS"}
                for x, y in dots]
    total = len(branches)
    # spur stubs off junctions/stroke-ends are thinning debris, not content;
    # 8px at 1200dpi = 0.17mm, well under the shortest real dash mark
    min_feature = max(3.0, 8.0 * dpi / 1200.0)
    for idx, (pts, closed) in enumerate(branches):
        if len(pts) < 2:
            continue
        path_len = float(np.hypot(*np.diff(pts, axis=0).T).sum())
        if not closed and path_len < min_feature:
            continue

        # circle/arc: fit a <=60-pt sample of the ORIGINAL chain so curvature
        # isn't lost to DP simplification first
        fitted = False
        if len(pts) >= 8 and path_len > 4 * eps:
            sample = pts[np.linspace(0, len(pts) - 1, min(60, len(pts))).astype(int)]
            fit = _fit_circle(sample)
            if fit:
                cx, cy, r, rms = fit
                sweep = path_len / r if r > 1e-9 else 0.0
                # guards: rms alone accepts straight lines as giant arcs
                if rms <= max(1.5, eps) and min_radius <= r <= max_radius and sweep >= 0.5:
                    if sweep >= 5.5 or (closed and sweep >= 5.5):
                        entities.append({"type": "CIRCLE", "cx": cx, "cy": cy,
                                         "r": r, "layer": "GEOMETRY-CIRCLES"})
                        fitted = True
                    elif not closed and sweep < 5.5:
                        # arc; pick the sweep that contains the traced midpoint
                        # (angles in y-up frame, as DXF expects)
                        a1 = math.atan2(cy - pts[0][1], pts[0][0] - cx)
                        a2 = math.atan2(cy - pts[-1][1], pts[-1][0] - cx)
                        mid = pts[len(pts) // 2]
                        am = math.atan2(cy - mid[1], mid[0] - cx)
                        ccw = (a2 - a1) % (2 * math.pi)
                        amr = (am - a1) % (2 * math.pi)
                        if amr > ccw:            # midpoint on the complement
                            a1, a2 = a2, a1
                        entities.append({"type": "ARC", "cx": cx, "cy": cy, "r": r,
                                         "start": math.degrees(a1) % 360,
                                         "end": math.degrees(a2) % 360,
                                         "layer": "GEOMETRY-ARCS"})
                        fitted = True

        if not fitted:
            simp = _dp_iterative(pts, eps)
            if len(simp) == 2 and not closed:
                entities.append({"type": "LINE",
                                 "x1": simp[0][0], "y1": simp[0][1],
                                 "x2": simp[1][0], "y2": simp[1][1],
                                 "layer": "GEOMETRY-LINES"})
            else:
                merged = _merge_collinear(simp)
                if closed and len(merged) > 1 and np.allclose(merged[0], merged[-1]):
                    merged = merged[:-1]
                if len(merged) >= 2:
                    entities.append({"type": "LWPOLYLINE",
                                     "points": merged.tolist(), "closed": bool(closed),
                                     "layer": "GEOMETRY-LINES"})
        if total and idx % 2000 == 1999:
            progress(stage="fitting", detail={"branch": idx + 1, "total": total,
                                              "entities": len(entities)})
    progress(stage="fitting", detail={"branch": total, "total": total,
                                      "entities": len(entities)})
    return entities


# ----------------------------------------------------------------------
# Stage 6: DXF export (ezdxf, audited)
# ----------------------------------------------------------------------

def write_dxf(entities, page_height_px, dpi, out_path):
    mm = 25.4 / dpi

    def xy(px, py):  # flip Y (image rows go down, DXF Y goes up) + px->mm
        return (px * mm, (page_height_px - py) * mm)

    doc = ezdxf.new("R2010", setup=False)
    doc.header["$INSUNITS"] = 4  # millimetres
    msp = doc.modelspace()
    doc.layers.add("GEOMETRY-LINES", color=5)
    doc.layers.add("GEOMETRY-ARCS", color=3)
    doc.layers.add("GEOMETRY-CIRCLES", color=1)
    doc.layers.add("GEOMETRY-POINTS", color=2)

    for e in entities:
        attribs = {"layer": e["layer"]}
        if e["type"] == "POINT":
            msp.add_point(xy(e["x"], e["y"]), dxfattribs=attribs)
        elif e["type"] == "LINE":
            msp.add_line(xy(e["x1"], e["y1"]), xy(e["x2"], e["y2"]), dxfattribs=attribs)
        elif e["type"] == "LWPOLYLINE":
            msp.add_lwpolyline([xy(px, py) for px, py in e["points"]],
                               close=e["closed"], dxfattribs=attribs)
        elif e["type"] == "CIRCLE":
            msp.add_circle(xy(e["cx"], e["cy"]), e["r"] * mm, dxfattribs=attribs)
        elif e["type"] == "ARC":
            msp.add_arc(xy(e["cx"], e["cy"]), e["r"] * mm, e["start"], e["end"],
                        dxfattribs=attribs)
    doc.saveas(out_path)

    check = ezdxf.readfile(out_path)
    auditor = check.audit()
    if auditor.errors:
        raise RuntimeError(f"DXF failed audit: {auditor.errors[:3]}")
    return len(entities)


# ----------------------------------------------------------------------
# Stage 7: verification (coverage metrics + overlay images)
# ----------------------------------------------------------------------

def _rasterize(entities, shape, scale):
    h, w = int(shape[0] * scale) + 1, int(shape[1] * scale) + 1
    im = Image.new("1", (w, h), 0)
    dr = ImageDraw.Draw(im)
    for e in entities:
        if e["type"] == "POINT":
            dr.point([(e["x"] * scale, e["y"] * scale)], fill=1)
        elif e["type"] == "LINE":
            dr.line([(e["x1"] * scale, e["y1"] * scale),
                     (e["x2"] * scale, e["y2"] * scale)], fill=1)
        elif e["type"] == "LWPOLYLINE":
            pts = [(px * scale, py * scale) for px, py in e["points"]]
            if e["closed"]:
                pts.append(pts[0])
            dr.line(pts, fill=1)
        elif e["type"] == "CIRCLE":
            cx, cy, r = e["cx"] * scale, e["cy"] * scale, e["r"] * scale
            dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=1)
        elif e["type"] == "ARC":
            cx, cy, r = e["cx"] * scale, e["cy"] * scale, e["r"] * scale
            # PIL arcs are y-down clockwise-from-3-o'clock; our angles are
            # y-up CCW -> negate
            dr.arc([cx - r, cy - r, cx + r, cy + r], -e["end"], -e["start"], fill=1)
    return np.asarray(im, dtype=bool)


def verify(ink, entities, out_dir, progress):
    scale = 0.25
    small_ink = ink[::4, ::4]
    vec = _rasterize(entities, ink.shape, scale)
    hh = min(small_ink.shape[0], vec.shape[0])
    ww = min(small_ink.shape[1], vec.shape[1])
    small_ink, vec = small_ink[:hh, :ww], vec[:hh, :ww]

    st = np.ones((5, 5), dtype=bool)  # ~2px dilation at 1/4 scale
    cov_ink = float((small_ink & ndi.binary_dilation(vec, st)).sum() / max(1, small_ink.sum()))
    cov_vec = float((vec & ndi.binary_dilation(small_ink, st)).sum() / max(1, vec.sum()))

    # overlay: original ink gray, vectors red, capped to ~2200px wide
    ds = max(1, int(math.ceil(ww / 2200)))
    ink_v = small_ink[::ds, ::ds]
    vec_v = vec[::ds, ::ds]
    rgb = np.full((*ink_v.shape, 3), 255, dtype=np.uint8)
    rgb[ink_v] = (170, 170, 170)
    rgb[vec_v] = (220, 30, 30)
    Image.fromarray(rgb).save(f"{out_dir}/overlay.png")

    # 2 zoomed crops of the densest regions (full-res ink vs vectors)
    crops = []
    density = ndi.uniform_filter(small_ink.astype(np.float32), size=101)
    for i in range(2):
        cy, cx = np.unravel_index(int(np.argmax(density)), density.shape)
        density[max(0, cy - 150):cy + 150, max(0, cx - 150):cx + 150] = -1
        y0, x0 = max(0, cy - 100), max(0, cx - 100)
        ink_c = small_ink[y0:y0 + 200, x0:x0 + 200]
        vec_c = vec[y0:y0 + 200, x0:x0 + 200]
        pair = np.full((ink_c.shape[0], ink_c.shape[1] * 2 + 8, 3), 255, dtype=np.uint8)
        pair[:, :ink_c.shape[1]][ink_c] = (60, 60, 60)
        pair[:, ink_c.shape[1] + 8:][vec_c] = (220, 30, 30)
        name = f"crop{i + 1}.png"
        Image.fromarray(pair).resize((pair.shape[1] * 3, pair.shape[0] * 3),
                                     Image.NEAREST).save(f"{out_dir}/{name}")
        crops.append(name)

    metrics = {"ink_covered_by_vectors": round(cov_ink, 4),
               "vectors_on_ink": round(cov_vec, 4)}
    progress(stage="verifying", detail=metrics)
    return metrics, crops


# ----------------------------------------------------------------------
# Orchestration
# ----------------------------------------------------------------------

def run_job(input_path, filename, out_dir, progress):
    """Full pipeline. Writes output.dxf/overlay.png/crop*.png into out_dir;
    returns a summary dict for the job store."""
    ink, dpi = load_input(input_path, filename, progress)
    ink = despeckle(ink, dpi, progress)
    skel = staircase_reduce(zhang_suen(ink, progress))
    branches, dots = trace_graph(skel, progress)
    entities = fit_geometry(branches, dots, dpi, progress)
    if not entities:
        raise RuntimeError("No geometry found — is the page blank or nearly blank?")
    n = write_dxf(entities, ink.shape[0], dpi, f"{out_dir}/output.dxf")
    metrics, crops = verify(ink, entities, out_dir, progress)
    return {"entities": n, "dpi": round(dpi, 1), "metrics": metrics,
            "crops": crops,
            "counts": {t: sum(1 for e in entities if e["type"] == t)
                       for t in ("LINE", "LWPOLYLINE", "ARC", "CIRCLE", "POINT")}}
