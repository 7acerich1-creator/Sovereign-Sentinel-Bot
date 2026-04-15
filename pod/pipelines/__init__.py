"""Pod pipeline modules — skeleton.

Per PROJECT_POD_MIGRATION.md this package will host the real inference and
composition pipelines in Phase 4:

    xtts.py      — XTTSv2 per-chunk, speaker WAV from /runpod-volume/speakers/
    flux.py      — FLUX.1 [dev] bf16 1024x1024 @ 30 steps / 3.5 guidance (D2)
    compose.py   — Ken Burns + ffmpeg concat + mux, audio-validated pre-upload
    r2.py        — Cloudflare R2 upload (D5), boto3 with endpoint_url override

Phase 1 Task 1.3 ships the FastAPI skeleton (worker.py) only. Nothing in
this package is imported by worker.py until Phase 4 wires the real calls.
"""
