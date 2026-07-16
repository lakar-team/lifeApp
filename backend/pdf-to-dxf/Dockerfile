FROM python:3.12-slim

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV JOB_DIR=/data/jobs
RUN mkdir -p /data/jobs

# single worker on purpose: jobs are memory-hungry; concurrency is
# controlled inside the app via MAX_CONCURRENT_JOBS
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
