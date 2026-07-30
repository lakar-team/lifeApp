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

import os
import tempfile
import uuid

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .pipeline import pdf_to_dxf
from .load_pdf import probe_geometry

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


@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = _save_upload(file, tmp)
        dxf_path = os.path.join(tmp, "output.dxf")
        try:
            result = pdf_to_dxf(pdf_path, dxf_path)
        except Exception as e:
            raise HTTPException(500, f"Conversion failed: {e}")

        # copy out of the tempdir before it's cleaned up
        persist_path = f"/tmp/{uuid.uuid4().hex}.dxf"
        os.rename(dxf_path, persist_path)
        return FileResponse(
            persist_path, media_type="image/vnd.dxf",
            filename="converted.dxf",
            headers={"X-Shape-Count": str(result["shape_count"]),
                     "X-Audit-Errors": str(result["audit_errors"])},
        )


@app.post("/convert/info")
async def convert_info(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = _save_upload(file, tmp)
        dxf_path = os.path.join(tmp, "output.dxf")
        try:
            result = pdf_to_dxf(pdf_path, dxf_path)
        except Exception as e:
            raise HTTPException(500, f"Conversion failed: {e}")
        return JSONResponse(result)
