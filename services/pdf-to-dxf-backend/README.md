# pdf-to-dxf-backend

Backend service for the ADAMTOOL **pdf-to-dxf** tool. Converts scanned
engineering / architectural PDF drawings into DXF (CAD) files using pure
contour tracing (FastAPI + OpenCV + ezdxf, containerised).

Deployed to **Render** as a Docker web service, built from this subfolder
(`services/pdf-to-dxf-backend/`, Root Directory in the Render service). The
ADAMTOOL frontend at `public/apps/pdf-to-dxf/` POSTs uploads to it.

## API

- `POST /convert` — multipart `file` (PDF) → returns the DXF file. Response
  headers `X-Shape-Count`, `X-Audit-Errors` carry stats.
- `POST /convert/info` — same input → JSON stats only.
- `GET /health` — liveness.

A dense full-page drawing takes ~25–45s to convert.

> The canonical source / design notes for this service live in
> `AI Platforms/pdf to dxf/dxf_contour_service/` (see its `CLAUDE.md`). This
> copy is the deploy target; keep them in sync if the algorithm changes.
