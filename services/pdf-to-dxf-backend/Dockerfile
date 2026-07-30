FROM python:3.11-slim

# libgl1/libglib2.0-0 are required by opencv-python-headless at import
# time even though it's the "headless" build -- skipping these produces
# a cryptic ImportError at container startup, not at build time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user with a writable HOME so matplotlib/ezdxf (used by
# render_preview.py) can write their font/config caches -- otherwise they try
# to write under a read-only HOME and error at request time, not build time.
RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    MPLCONFIGDIR=/home/user/.cache/matplotlib \
    PATH=/home/user/.local/bin:$PATH

WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user app ./app

USER user

# Bind to the platform-provided $PORT (Render injects it; falls back to 8000
# for local `docker run`). Shell form so ${PORT} is expanded at runtime.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
