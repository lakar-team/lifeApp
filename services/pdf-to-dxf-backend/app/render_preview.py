"""
Render a DXF to a preview PDF for the user to see without opening CAD.

Two non-default settings here matter and are easy to accidentally lose
if this gets rewritten later:

1. hatching_timeout must be raised well above the ezdxf default (30s).
   With thousands of hatch entities on a busy drawing, the default
   timeout silently drops whatever hasn't rendered yet -- this was
   the exact cause of a "fill appears in some places but not others"
   bug that took real effort to diagnose. 600s has held up on the
   largest drawings tested so far; scale up if a much bigger page
   times out again.

2. lineweight_scaling=0 + min_lineweight force every line to render
   at minimum width. Without this, ezdxf's matplotlib backend applies
   its own default weight regardless of what's set in the DXF file
   itself, making everything look thicker than the geometry actually
   is.
"""
from __future__ import annotations

import ezdxf
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
from ezdxf.addons.drawing.config import (
    Configuration, BackgroundPolicy, ColorPolicy, HatchPolicy, LineweightPolicy,
)
import matplotlib.pyplot as plt


def render_dxf_to_pdf(dxf_path: str, out_pdf_path: str,
                       figsize: tuple[float, float] = (20, 14),
                       hatching_timeout: float = 600.0,
                       min_lineweight: float = 0.05) -> None:
    doc = ezdxf.readfile(dxf_path)
    cfg = Configuration(
        background_policy=BackgroundPolicy.WHITE,
        color_policy=ColorPolicy.BLACK,
        hatch_policy=HatchPolicy.SHOW_SOLID,
        hatching_timeout=hatching_timeout,
        lineweight_policy=LineweightPolicy.ABSOLUTE,
        lineweight_scaling=0.0,
        min_lineweight=min_lineweight,
    )
    fig = plt.figure(figsize=figsize)
    ax = fig.add_axes([0, 0, 1, 1])
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")
    Frontend(RenderContext(doc), MatplotlibBackend(ax), config=cfg).draw_layout(
        doc.modelspace(), finalize=True
    )
    fig.savefig(out_pdf_path, dpi=300, facecolor="white")
    plt.close(fig)
