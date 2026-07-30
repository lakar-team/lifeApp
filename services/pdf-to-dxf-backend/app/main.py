"""
FastAPI service: upload a PDF, get back a DXF (contour trace).

Endpoints:
  POST /convert       -- upload PDF, returns the DXF file directly
  POST /convert/info   -- upload PDF, returns JSON stats (no file body),
                          useful for the frontend to show progress/counts
                          before offering the download
  GET  /health         -- liveness check

Run locally:
  uvicorn app.main:app --reload

This is intentionally a thin wrapper. All the actual logic lives in
pipeline.py / extract.py / fill.py / export.py -- keep it that way so
this file doesn't accumulate business logic that's hard to test
without spinning up a server.
"""
from __future__ import annotations

import ctypes
import gc
import os
import tempfile
import threading
import uuid

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .pipeline import pdf_to_dxf
from .tile import pdf_to_dxf_auto, _rss_mb
from .load_pdf import probe_geometry
from .render_preview import render_dxf_to_pdf

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

# One heavy conversion at a time -- two concurrent ~400MB conversions would
# blow the 512MB cap. Serialise them.
_CONVERT_LOCK = threading.Semaphore(1)


def _release_memory():
    """Return freed heap to the OS after a conversion. Large numpy buffers are
    mmap'd and released on free, but glibc retains small-alloc arenas, so RSS
    ratchets up across requests and the next conversion OOMs -- malloc_trim
    hands that memory back so each conversion starts from a low baseline."""
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/probe")
async def probe(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = _save_upload(file, tmp)
        try:
            return probe_geometry(pdf_path)
        except Exception as e:
            raise HTTPException(500, f"probe failed: {e}")


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


# NOTE: sync `def` (not async) on purpose. FastAPI runs sync endpoints in a
# worker thread, so this multi-second CPU-bound conversion does NOT block the
# event loop -- /health keeps responding and Render won't kill the instance
# mid-convert. (numpy/opencv also release the GIL during heavy C work.)
@app.post("/convert")
def convert(file: UploadFile = File(...), format: str = "dxf"):
    fmt = format.lower()
    if fmt not in ("dxf", "pdf"):
        raise HTTPException(400, "format must be 'dxf' or 'pdf'")
    ext = "pdf" if fmt == "pdf" else "dxf"
    with _CONVERT_LOCK:
        try:
            with tempfile.TemporaryDirectory() as tmp:
                pdf_path = _save_upload(file, tmp)
                out_path = os.path.join(tmp, f"output.{ext}")
                print(f"[convert] start fmt={fmt} rss={_rss_mb()}MB", flush=True)
                try:
                    result = pdf_to_dxf_auto(pdf_path, out_path, fmt=fmt)
                except Exception as e:
                    raise HTTPException(500, f"Conversion failed: {e}")

                headers = {"X-Shape-Count": str(result.get("shape_count", 0)),
                           "X-Audit-Errors": str(result.get("audit_errors", 0))}
                # copy out of the tempdir before it's cleaned up
                persist_path = f"/tmp/{uuid.uuid4().hex}.{ext}"
                os.rename(out_path, persist_path)
            media = "application/pdf" if fmt == "pdf" else "image/vnd.dxf"
            return FileResponse(persist_path, media_type=media,
                                filename=f"converted.{ext}", headers=headers)
        finally:
            _release_memory()
            print(f"[convert] end rss={_rss_mb()}MB", flush=True)


@app.post("/convert/info")
def convert_info(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = _save_upload(file, tmp)
        dxf_path = os.path.join(tmp, "output.dxf")
        try:
            result = pdf_to_dxf_auto(pdf_path, dxf_path)
        except Exception as e:
            raise HTTPException(500, f"Conversion failed: {e}")
        return JSONResponse(result)
