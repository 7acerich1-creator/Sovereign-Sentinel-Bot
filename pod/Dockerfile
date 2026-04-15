# PROJECT_POD_MIGRATION — Phase 1 Task 1.1
# Sovereign Content Production Worker
#
# Decisions applied (from PROJECT_POD_MIGRATION.md Open Decisions):
#   D1: H100 80GB SXM (preferred) / A100 80GB SXM (fallback) — CUDA 12.1 runtime
#   D2: FLUX.1 [dev] bf16 full precision, 1024x1024, 30 steps, guidance 3.5
#   D3: Docker image, pushed to RunPod template registry (reproducible)
#   D4: FastAPI on :8000, Bearer auth via POD_WORKER_TOKEN
#   D5: Cloudflare R2 for video/thumbnail artifacts (S3-compatible client)
#   D6: 10-min idle sleep handled by Railway orchestrator, not the pod
#
# Build:   docker build -t sovereign-pod:<tag> pod/
# Smoke:   docker run --gpus all -p 8000:8000 -e POD_WORKER_TOKEN=test sovereign-pod:<tag>
#          curl -H "Authorization: Bearer test" http://localhost:8000/health

FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/runpod-volume/huggingface \
    TORCH_HOME=/runpod-volume/torch \
    TRANSFORMERS_CACHE=/runpod-volume/huggingface/transformers \
    XDG_CACHE_HOME=/runpod-volume/cache

# System deps: Python 3.11, ffmpeg (video composition + silencedetect),
# git (HF model pull), curl (health checks), build-essential (wheel compiles)
RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common \
        ca-certificates \
        curl \
        git \
        build-essential \
        ffmpeg \
        libsndfile1 \
        espeak-ng \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
        python3.11 \
        python3.11-dev \
        python3.11-venv \
        python3.11-distutils \
    && curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CUDA-enabled PyTorch FIRST so pip resolves the rest against it.
# torch 2.4.x matches FLUX.1 [dev] (diffusers>=0.30) + TTS 0.22.0 (XTTSv2)
# at bf16 precision on 80GB cards without OOM.
RUN pip install --upgrade pip setuptools wheel \
    && pip install --index-url https://download.pytorch.org/whl/cu121 \
        torch==2.4.1 \
        torchvision==0.19.1 \
        torchaudio==2.4.1

# Pod-specific Python deps (see pod/requirements.txt for pinning rationale)
#
# blinker 1.4 ships pre-installed via python3-distutils in the Ubuntu 22.04
# CUDA base image. pip cannot safely uninstall distutils-managed packages,
# so any transitive dep (flask -> blinker>=1.6) fails with
#   "error: uninstall-distutils-installed-package".
# Fix: install a fresh blinker with --ignore-installed BEFORE the main
# requirements install. After this, pip sees a pip-managed blinker it can
# upgrade/replace cleanly.
COPY requirements.txt .
RUN pip install --ignore-installed blinker \
    && pip install -r requirements.txt

# Source: FastAPI worker + any shared utilities
COPY worker.py .
COPY pipelines/ ./pipelines/

# Speaker reference WAVs live on /runpod-volume (Task 1.5), not baked in.
# Model weights (FLUX.1 [dev], XTTSv2) download to $HF_HOME on first /health
# hit, cached on the attached volume across pod restarts.

# Non-root user for the worker process (RunPod pods run as root by default;
# we still drop privileges for the server itself where possible).
RUN useradd -m -u 1000 sovereign \
    && mkdir -p /runpod-volume \
    && chown -R sovereign:sovereign /app

EXPOSE 8000

# Healthcheck calls the worker's /health endpoint WITHOUT auth (it's an
# unprotected liveness probe); /produce still requires Bearer.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -fsS http://localhost:8000/health/live || exit 1

# Uvicorn in prod-mode: single worker (FLUX + XTTS both load to GPU; no
# worker replication at the process level — concurrency is per-request
# inside the FastAPI app, not via uvicorn workers)
CMD ["uvicorn", "worker:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--log-level", "info", \
     "--no-access-log", \
     "--timeout-keep-alive", "75"]
