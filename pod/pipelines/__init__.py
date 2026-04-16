"""
Pod pipeline modules -- Phase 4 real inference + composition.

    xtts.py      -- XTTSv2 per-chunk TTS
    flux.py      -- FLUX.1 [dev] bf16 1024x1024 image gen
    compose.py   -- Ken Burns + ffmpeg concat + mux
    r2.py        -- Cloudflare R2 upload (boto3 S3 compat)
"""
from .xtts import load_model as load_xtts
from .xtts import is_loaded as xtts_loaded
from .xtts import synthesize_scenes
from .flux import load_model as load_flux
from .flux import is_loaded as flux_loaded
from .flux import generate_scene_images
from .compose import compose_video
from .r2 import upload_artifacts
from .r2 import is_configured as r2_configured

__all__ = [
    "load_xtts",
    "xtts_loaded",
    "synthesize_scenes",
    "load_flux",
    "flux_loaded",
    "generate_scene_images",
    "compose_video",
    "upload_artifacts",
    "r2_configured",
]
