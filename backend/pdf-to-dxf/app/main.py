"""
FastAPI wrapper around the vectorization pipeline.

A conversion is minutes long, so it never runs inside a request: POST
/convert enqueues it on a worker thread and returns a job_id immediately;
the frontend polls GET /jobs/{id} (real stage counters, not simulated
percentages) and fetches output.dxf / overlay.png when status == "done".
Job state lives on disk under JOB_DIR so a container restart doesn't 500
old status polls.
"""

import json
import os
import shutil
import threading
import time
import uuid

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import pipeline

JOB_DIR = os.environ.get("JOB_DIR", "/tmp/pdf2dxf-jobs")
JOB_TTL_HOURS = float(os.environ.get("JOB_TTL_HOURS", "24"))
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "300"))
# one conversion at a time by default: the pipeline is memory-hungry
WORKERS = threading.Semaphore(int(os.environ.get("MAX_CONCURRENT_JOBS", "1")))

ALLOWED_EXT = (".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")

app = FastAPI(title="PDF/PNG -> DXF Vectorizer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # public personal tool; no cookies/credentials used
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _job_path(job_id: str) -> str:
    # job ids are server-generated uuids; reject anything else (path safety)
    if not all(c in "0123456789abcdef-" for c in job_id):
        raise HTTPException(400, "bad job id")
    return os.path.join(JOB_DIR, job_id)


def _write_status(job_dir: str, **fields):
    path = os.path.join(job_dir, "status.json")
    current = {}
    if os.path.exists(path):
        with open(path) as f:
            current = json.load(f)
    current.update(fields)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(current, f)
    os.replace(tmp, path)


def _cleanup_old_jobs():
    if not os.path.isdir(JOB_DIR):
        return
    cutoff = time.time() - JOB_TTL_HOURS * 3600
    for name in os.listdir(JOB_DIR):
        p = os.path.join(JOB_DIR, name)
        try:
            if os.path.getmtime(p) < cutoff:
                shutil.rmtree(p, ignore_errors=True)
        except OSError:
            pass


def _run(job_id: str, filename: str):
    job_dir = _job_path(job_id)
    with WORKERS:
        try:
            _write_status(job_dir, status="rendering")

            def progress(stage, detail):
                _write_status(job_dir, status=stage, progress=detail)

            summary = pipeline.run_job(
                os.path.join(job_dir, "input"), filename, job_dir, progress)
            _write_status(job_dir, status="done", result=summary)
        except Exception as e:  # surfaced verbatim to the polling client
            _write_status(job_dir, status="error", error=str(e))


@app.get("/")
def root():
    return {"service": "pdf2dxf", "status": "ok",
            "endpoints": ["POST /convert", "GET /jobs/{id}",
                          "GET /jobs/{id}/output.dxf", "GET /jobs/{id}/overlay.png"]}


@app.post("/convert", status_code=202)
async def convert(file: UploadFile):
    name = file.filename or "upload.pdf"
    if not name.lower().endswith(ALLOWED_EXT):
        raise HTTPException(415, f"unsupported file type; expected one of {ALLOWED_EXT}")
    _cleanup_old_jobs()
    job_id = str(uuid.uuid4())
    job_dir = _job_path(job_id)
    os.makedirs(job_dir, exist_ok=True)

    size = 0
    with open(os.path.join(job_dir, "input"), "wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD_MB << 20:
                shutil.rmtree(job_dir, ignore_errors=True)
                raise HTTPException(413, f"file exceeds {MAX_UPLOAD_MB}MB limit")
            out.write(chunk)

    _write_status(job_dir, status="queued", filename=name, size=size,
                  created=time.time())
    threading.Thread(target=_run, args=(job_id, name), daemon=True).start()
    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    path = os.path.join(_job_path(job_id), "status.json")
    if not os.path.exists(path):
        raise HTTPException(404, "unknown job")
    with open(path) as f:
        return JSONResponse(json.load(f))


def _artifact(job_id: str, name: str, media_type: str):
    path = os.path.join(_job_path(job_id), name)
    if not os.path.exists(path):
        raise HTTPException(404, "not available (job not done yet?)")
    return FileResponse(path, media_type=media_type, filename=name)


@app.get("/jobs/{job_id}/output.dxf")
def download_dxf(job_id: str):
    return _artifact(job_id, "output.dxf", "application/dxf")


@app.get("/jobs/{job_id}/overlay.png")
def overlay(job_id: str):
    return _artifact(job_id, "overlay.png", "image/png")


@app.get("/jobs/{job_id}/crop1.png")
def crop1(job_id: str):
    return _artifact(job_id, "crop1.png", "image/png")


@app.get("/jobs/{job_id}/crop2.png")
def crop2(job_id: str):
    return _artifact(job_id, "crop2.png", "image/png")
