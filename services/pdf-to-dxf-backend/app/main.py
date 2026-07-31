"""
FastAPI service: upload a PDF, get back a DXF or a vector PDF (contour trace).

Endpoints:
  POST /convert?format=dxf|pdf  -- upload PDF, returns the converted file
  POST /probe                   -- upload PDF, returns size/DPI/memory estimate
  GET  /health                  -- liveness check

Memory design: the heavy conversion runs in a SHORT-LIVED SUBPROCESS
(app.convert_cli), so all the memory it touches -- including one-time
OpenCV/scipy warm-up that never frees within a process -- is reclaimed by the
OS when the child exits. The long-lived server therefore stays lean and RSS
does not ratchet past the 512MB cap across successive conversions. To keep the
parent light it deliberately does NOT import numpy/opencv/etc. at module load;
those live only in the child (and in the lazily-imported /probe path).

Run locally:
  uvicorn app.main:app --reload
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app = FastAPI(title="PDF-to-DXF Contour Trace Service")

# Restricted to the ADAMTOOL frontend origins (custom domain + any Cloudflare
# Pages preview subdomain) plus localhost for dev. expose_headers lets the
# browser read the conversion stats returned on /convert.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://([a-z0-9-]+\.)*adamtool\.(online|pages\.dev)|http://localhost(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Shape-Count", "X-Audit-Errors"],
)

MAX_UPLOAD_MB = 50
CONVERT_TIMEOUT_S = 290
# One heavy conversion at a time: two concurrent children would together blow
# the 512MB cap. Serialise them.
_CONVERT_LOCK = threading.Semaphore(1)


def _rss_mb() -> int:
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024
    except Exception:
        pass
    return -1


def _save_upload(file: UploadFile, dest_dir: str) -> str:
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")
    path = os.path.join(dest_dir, f"{uuid.uuid4().hex}.pdf")
    size = 0
    with open(path, "wb") as f:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_MB * 1024 * 1024:
                raise HTTPException(413, f"File exceeds {MAX_UPLOAD_MB}MB limit")
            f.write(chunk)
    return path


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/probe")
async def probe(file: UploadFile = File(...)):
    from .load_pdf import probe_geometry  # lazy import: keep the parent lean
    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = _save_upload(file, tmp)
        try:
            return probe_geometry(pdf_path)
        except Exception as e:
            raise HTTPException(500, f"probe failed: {e}")


@app.post("/convert")
def convert(file: UploadFile = File(...), format: str = "dxf",
            smooth: float | None = None, simplify: float | None = None):
    fmt = format.lower()
    if fmt not in ("dxf", "pdf"):
        raise HTTPException(400, "format must be 'dxf' or 'pdf'")
    ext = "pdf" if fmt == "pdf" else "dxf"
    with _CONVERT_LOCK:
        # A persisted work dir (not an auto-cleaned tempdir) so FileResponse can
        # stream the output after the handler returns; removed by a background
        # task once the response is sent.
        work = tempfile.mkdtemp(prefix="pdf2dxf-")
        try:
            pdf_path = _save_upload(file, work)
            out_path = os.path.join(work, f"output.{ext}")
            print(f"[convert] start fmt={fmt} parent_rss={_rss_mb()}MB", flush=True)
            try:
                proc = subprocess.run(
                    [sys.executable, "-m", "app.convert_cli", pdf_path, out_path, fmt,
                     "" if smooth is None else str(smooth),
                     "" if simplify is None else str(simplify)],
                    timeout=CONVERT_TIMEOUT_S,
                )
            except subprocess.TimeoutExpired:
                shutil.rmtree(work, ignore_errors=True)
                raise HTTPException(504, "Conversion timed out")
            finally:
                print(f"[convert] end parent_rss={_rss_mb()}MB", flush=True)

            if proc.returncode != 0 or not os.path.exists(out_path):
                shutil.rmtree(work, ignore_errors=True)
                raise HTTPException(
                    500, f"Conversion failed (worker exit {proc.returncode}); "
                         "the drawing may be too large for the free tier.")

            result = {}
            res_path = out_path + ".result.json"
            if os.path.exists(res_path):
                try:
                    with open(res_path) as f:
                        result = json.load(f)
                except Exception:
                    pass

            headers = {"X-Shape-Count": str(result.get("shape_count", 0)),
                       "X-Audit-Errors": str(result.get("audit_errors", 0))}
            media = "application/pdf" if fmt == "pdf" else "image/vnd.dxf"
            return FileResponse(
                out_path, media_type=media, filename=f"converted.{ext}",
                headers=headers,
                background=BackgroundTask(shutil.rmtree, work, ignore_errors=True),
            )
        except HTTPException:
            raise
        except Exception as e:
            shutil.rmtree(work, ignore_errors=True)
            raise HTTPException(500, f"Conversion failed: {e}")
