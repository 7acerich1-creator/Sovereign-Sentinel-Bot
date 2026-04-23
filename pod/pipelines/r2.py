"""
pod/pipelines/r2.py — Cloudflare R2 upload pipeline.

Per D5 (PROJECT_POD_MIGRATION.md):
    Cloudflare R2 (primary) for video + thumbnail artifacts.
    Zero egress fees, S3-compatible API.

Environment variables:
    R2_ACCOUNT_ID         — Cloudflare account ID
    R2_ACCESS_KEY_ID      — R2 API token key ID
    R2_SECRET_ACCESS_KEY  — R2 API token secret
    R2_BUCKET_VIDEOS      — Bucket name for video MP4s
    R2_BUCKET_THUMBS      — Bucket name for thumbnails
    R2_PUBLIC_URL_BASE    — Public URL prefix (e.g., https://pub-xxx.r2.dev)
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import boto3
import structlog

log = structlog.get_logger("pipeline.r2")


def _get_client():
    """Create a boto3 S3 client pointed at Cloudflare R2."""
    account_id = os.environ.get("R2_ACCOUNT_ID", "")
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "")

    if not all([account_id, access_key, secret_key]):
        raise RuntimeError(
            "R2 credentials incomplete — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, "
            "R2_SECRET_ACCESS_KEY in pod environment"
        )

    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )


def is_configured() -> bool:
    """Check if R2 credentials are set (not whether they're valid)."""
    return bool(
        os.environ.get("R2_ACCOUNT_ID")
        and os.environ.get("R2_ACCESS_KEY_ID")
        and os.environ.get("R2_SECRET_ACCESS_KEY")
        and os.environ.get("R2_BUCKET_VIDEOS")
    )


def upload_artifacts(
    video_path: str,
    thumbnail_path: str,
    job_id: str,
    brand: str,
) -> dict:
    """
    Upload video + thumbnail to Cloudflare R2.

    Args:
        video_path: Path to the final MP4.
        thumbnail_path: Path to the thumbnail JPG/PNG.
        job_id: Unique job identifier (used in R2 key).
        brand: 'sovereign_synthesis' or 'containment_field'.

    Returns:
        {
            "video_url": "https://pub-xxx.r2.dev/videos/sovereign_synthesis/fv_..._final.mp4",
            "thumbnail_url": "https://pub-xxx.r2.dev/thumbs/sovereign_synthesis/fv_..._thumb.jpg",
        }
    """
    client = _get_client()
    video_bucket = os.environ.get("R2_BUCKET_VIDEOS", "sovereign-videos")
    thumb_bucket = os.environ.get("R2_BUCKET_THUMBS", video_bucket)  # same bucket OK
    public_base = os.environ.get("R2_PUBLIC_URL_BASE", "").rstrip("/")

    results = {}

    # Upload video
    video_ext = Path(video_path).suffix or ".mp4"
    video_key = f"videos/{brand}/{job_id}{video_ext}"
    t0 = time.monotonic()
    log.info("r2_upload_video_start", bucket=video_bucket, key=video_key)

    file_size = os.path.getsize(video_path)
    content_type = "video/mp4"

    # Use multipart upload for files > 100MB
    config = boto3.s3.transfer.TransferConfig(
        multipart_threshold=100 * 1024 * 1024,  # 100MB
        multipart_chunksize=50 * 1024 * 1024,   # 50MB chunks
        max_concurrency=4,
    )

    client.upload_file(
        video_path,
        video_bucket,
        video_key,
        ExtraArgs={"ContentType": content_type},
        Config=config,
    )

    elapsed = time.monotonic() - t0
    log.info(
        "r2_upload_video_done",
        key=video_key,
        size_mb=round(file_size / (1024 * 1024), 1),
        elapsed_s=round(elapsed, 1),
    )

    if public_base:
        results["video_url"] = f"{public_base}/{video_key}"
    else:
        # Construct from bucket custom domain or R2 dev URL
        results["video_url"] = f"https://{video_bucket}.r2.dev/{video_key}"

    # Upload thumbnail
    thumb_ext = Path(thumbnail_path).suffix or ".jpg"
    thumb_key = f"thumbs/{brand}/{job_id}{thumb_ext}"
    log.info("r2_upload_thumb_start", bucket=thumb_bucket, key=thumb_key)

    thumb_content_type = "image/jpeg" if thumb_ext in (".jpg", ".jpeg") else "image/png"

    client.upload_file(
        thumbnail_path,
        thumb_bucket,
        thumb_key,
        ExtraArgs={"ContentType": thumb_content_type},
    )

    log.info("r2_upload_thumb_done", key=thumb_key)

    if public_base:
        results["thumbnail_url"] = f"{public_base}/{thumb_key}"
    else:
        results["thumbnail_url"] = f"https://{thumb_bucket}.r2.dev/{thumb_key}"

    return results
