"""
Remove the SS logo box from brand_card_ace.mp4 - v6 iterative erosion inpaint.

The problem: single-pass inpaint pulls from the dark panel edges, filling
the region with dark instead of golden bloom.

v6 solution: iterative inpainting with progressive mask erosion.
  1. Start with full mask covering the logo panel
  2. Inpaint with moderate radius (pulls golden bloom into outer edge)
  3. Erode the mask (shrink it inward)
  4. Inpaint again (now the outer ring has golden bloom, inner pulls from that)
  5. Repeat until mask is fully consumed

Each iteration eats ~15px inward. The golden bloom propagates progressively
from the outside edges toward the center, like a healing wave.
"""
import os, subprocess, sys, shutil

try:
    import cv2
    import numpy as np
except ImportError:
    print("Installing opencv-python + numpy...")
    subprocess.check_call([sys.executable, "-m", "pip", "install",
                           "opencv-python-headless", "numpy", "--quiet"])
    import cv2
    import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "brand-assets")
TEMP = os.path.join(ROOT, "scripts", "_inpaint_frames")

INPUT = os.path.join(ASSETS, "brand_card_ace.mp4")
OUTPUT = os.path.join(ASSETS, "brand_card_ace.mp4")

# Logo region - generous mask covering entire dark panel
LOGO_X = 850
LOGO_Y = 140
LOGO_W = 220
LOGO_H = 260

# Iterative inpaint parameters
INPAINT_RADIUS = 20        # radius per pass
EROSION_PER_PASS = 15      # pixels to erode mask each pass
MAX_PASSES = 12            # safety limit


def iterative_inpaint(frame, base_mask, radius, erosion_px, max_passes):
    """
    Progressively inpaint from outside in, letting golden bloom
    propagate inward through the dark panel region.
    """
    result = frame.copy()
    mask = base_mask.copy()
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                       (erosion_px * 2 + 1, erosion_px * 2 + 1))

    for p in range(max_passes):
        if mask.max() == 0:
            break  # mask fully consumed

        # Inpaint current mask region
        result = cv2.inpaint(result, mask, radius, cv2.INPAINT_TELEA)

        # Erode mask inward for next pass
        mask = cv2.erode(mask, kernel, iterations=1)

    return result, p + 1


def run():
    print("=== Inpaint Brand Card v6 - Iterative Erosion ===")
    print(f"Input: {INPUT}")
    print(f"Logo region: x={LOGO_X} y={LOGO_Y} w={LOGO_W} h={LOGO_H}")
    print(f"Radius: {INPAINT_RADIUS}, Erosion: {EROSION_PER_PASS}px/pass")

    if os.path.exists(TEMP):
        shutil.rmtree(TEMP)
    os.makedirs(TEMP)
    os.makedirs(os.path.join(ROOT, "scripts", "_preview"), exist_ok=True)

    cap = cv2.VideoCapture(INPUT)
    if not cap.isOpened():
        print(f"ERROR: Cannot open {INPUT}")
        return False

    fps = cap.get(cv2.CAP_PROP_FPS)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"Video: {w}x{h} @ {fps}fps, {total} frames")

    # Create base mask
    base_mask = np.zeros((h, w), dtype=np.uint8)
    base_mask[LOGO_Y:LOGO_Y + LOGO_H, LOGO_X:LOGO_X + LOGO_W] = 255
    # Slight dilation to catch panel border/shadow
    dk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    base_mask = cv2.dilate(base_mask, dk, iterations=1)

    print(f"Processing {total} frames...")
    frame_paths = []
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        inpainted, passes = iterative_inpaint(
            frame, base_mask, INPAINT_RADIUS, EROSION_PER_PASS, MAX_PASSES
        )

        # Debug frame 24
        if idx == 24:
            debug = os.path.join(ROOT, "scripts", "_preview", "debug_v6_result.png")
            cv2.imwrite(debug, inpainted)
            debug_orig = os.path.join(ROOT, "scripts", "_preview", "debug_v6_original.png")
            cv2.imwrite(debug_orig, frame)
            print(f"  DEBUG: frame 24 saved ({passes} passes used)")

        path = os.path.join(TEMP, f"frame_{idx:04d}.png")
        cv2.imwrite(path, inpainted)
        frame_paths.append(path)

        if idx % 10 == 0:
            print(f"  Frame {idx}/{total} ({passes} passes)")
        idx += 1

    cap.release()
    print(f"  Processed {idx} frames")

    out_temp = os.path.join(TEMP, "brand_card_ace_v6.mp4")
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(int(fps)),
        "-i", os.path.join(TEMP, "frame_%04d.png"),
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-t", str(total / fps),
        out_temp,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        print(f"FFMPEG ERROR: {r.stderr[-500:]}")
        return False

    shutil.copy2(out_temp, OUTPUT)
    size_kb = os.path.getsize(OUTPUT) // 1024
    print(f"\n  OK -> {OUTPUT} ({size_kb} KB)")

    preview = os.path.join(ROOT, "scripts", "_preview", "ace_inpaint_result.png")
    frame_idx = int(0.8 * fps)
    if frame_idx < len(frame_paths):
        shutil.copy2(frame_paths[frame_idx], preview)
        print(f"  Preview -> {preview}")

    return True


if __name__ == "__main__":
    ok = run()
    if not ok:
        sys.exit(1)
