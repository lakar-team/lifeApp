# PDF → DXF Vectorizer — backend

Server-side conversion engine for the adamtool "PDF to DXF" app
(`public/apps/pdf-to-dxf/`). Implements `PDFTODXFBACKENDSPEC.md`: scanned
engineering drawings (PDF with tiled 1-bit scans, or plain PNG/JPG) are
rendered at their **native** resolution, despeckled, thinned (vectorized
Zhang-Suen), traced into a topological graph, fitted to
lines/polylines/arcs/circles/points, and written as an audited DXF (mm
units) — with a raster-back verification overlay so you can eyeball the
result before opening CAD.

Cloudflare Pages hosts only the static frontend; **this service must run
somewhere that can execute Python with numpy/scipy for minutes at a time**
(a conversion of a 137 MP scan takes ~2–3 minutes and ~2 GB RAM).

## Run locally

```bash
cd backend/pdf-to-dxf
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

or with Docker:

```bash
docker build -t pdf2dxf backend/pdf-to-dxf
docker run -p 8000:8000 pdf2dxf
```

Then open the frontend (adamtool.pages.dev/apps/pdf-to-dxf/ or locally) and
set the backend URL to `http://localhost:8000`.

## Deploy to a container host

Any Docker host with **≥ 2 GB RAM** (4 GB comfortable) works. The
container listens on `$PORT` (default 8000).

- **Railway**: New Project → Deploy from GitHub repo → set the service's
  root directory to `backend/pdf-to-dxf` (it auto-detects the Dockerfile).
  Choose ≥ 2 GB memory in service settings.
- **Fly.io**: `fly launch --path backend/pdf-to-dxf` and pick a
  `shared-cpu-2x` with 2 GB, or edit `fly.toml` memory afterwards.
- **Render**: New Web Service → repo → Root Directory `backend/pdf-to-dxf`,
  runtime Docker. The free tier's 512 MB is NOT enough — pick a paid
  instance with ≥ 2 GB.
- **Your own machine / VM**: the `docker run` above, or bare `uvicorn`.

After deploying, paste the public URL (e.g. `https://pdf2dxf.up.railway.app`)
into the "Backend server" field of the frontend once; it's stored in the
browser's localStorage.

## Environment variables

| var | default | meaning |
|---|---|---|
| `JOB_DIR` | `/tmp/pdf2dxf-jobs` (`/data/jobs` in Docker) | job workspace |
| `JOB_TTL_HOURS` | `24` | results older than this are deleted |
| `MAX_UPLOAD_MB` | `300` | upload size limit |
| `MAX_CONCURRENT_JOBS` | `1` | parallel conversions (each needs ~2 GB) |

## API

```
POST /convert            multipart "file" (pdf/png/jpg/…)   → 202 {job_id}
GET  /jobs/{id}          → {status, progress, result?, error?}
GET  /jobs/{id}/output.dxf
GET  /jobs/{id}/overlay.png     scan (gray) + fitted vectors (red)
GET  /jobs/{id}/crop1.png|crop2.png   zoomed scan-vs-vector crops
```

`status` walks `queued → rendering → despeckling → thinning → tracing →
fitting → verifying → done` (or `error`); `progress` carries real stage
counters (thinning iteration + remaining pixels, branch N/total, …).
