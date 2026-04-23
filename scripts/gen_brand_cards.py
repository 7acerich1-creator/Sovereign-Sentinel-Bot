"""
Generate brand card animations WITHOUT the logo icon.  S86 v2.
==================================================
Ace:  Multi-layered luminous bloom + sacred-geometry starburst +
      particle field + gold text fade-in.  Resolves to clean warm card.
TCF:  Aggressive RGB channel split + horizontal block displacement +
      scan lines + static noise + digital corruption blocks +
      silver text with RGB ghost.  Resolves to clean industrial card.
==================================================
"""
import os, subprocess, math, sys, shutil

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops, ImageEnhance
    import numpy as np
except ImportError:
    print("Installing Pillow + numpy...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow", "numpy", "--quiet"])
    from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops, ImageEnhance
    import numpy as np

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "brand-assets")
TEMP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "_brand_frames")
FPS = 30
DURATION = 1.3
N_FRAMES = int(FPS * DURATION)  # 39 frames
W, H = 1920, 1080

FONT_MONTSERRAT = os.path.join(ASSETS, "Montserrat-SemiBold.ttf")
FONT_BEBAS = os.path.join(ASSETS, "BebasNeue-Regular.ttf")


# ── easing ──────────────────────────────────────────
def ease_out_cubic(t):
    return 1 - (1 - t) ** 3

def ease_out_expo(t):
    return 1.0 if t >= 1.0 else 1.0 - 2.0 ** (-10.0 * t)

def ease_in_out_quad(t):
    return 2 * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 2 / 2


# ==================================================
#  SOVEREIGN SYNTHESIS
# ==================================================

def _draw_starburst(draw, cx, cy, n_rays, max_len, thickness, color_rgba, t_bloom):
    """Draw radiating lines from center -- sacred geometry starburst."""
    rng = np.random.RandomState(42)
    for i in range(n_rays):
        angle = (2 * math.pi * i / n_rays) + rng.uniform(-0.05, 0.05)
        length = max_len * t_bloom * rng.uniform(0.4, 1.0)
        x2 = cx + math.cos(angle) * length
        y2 = cy + math.sin(angle) * length
        a = int(color_rgba[3] * t_bloom * rng.uniform(0.3, 1.0))
        draw.line([(cx, cy), (x2, y2)], fill=(*color_rgba[:3], a), width=thickness)


def _draw_geometry_ring(draw, cx, cy, radius, sides, rotation, color_rgba, alpha_mult):
    """Draw a rotating polygon ring -- sacred geometry element."""
    points = []
    for i in range(sides):
        angle = rotation + 2 * math.pi * i / sides
        x = cx + math.cos(angle) * radius
        y = cy + math.sin(angle) * radius
        points.append((x, y))
    a = int(color_rgba[3] * alpha_mult)
    if a < 2:
        return
    for i in range(sides):
        draw.line([points[i], points[(i + 1) % sides]],
                  fill=(*color_rgba[:3], a), width=2)


def gen_ace():
    print("Generating Sovereign Synthesis brand card (v2 -- multi-layer bloom + geometry)...")
    bg = Image.open(os.path.join(ASSETS, "bg_long_ss.png")).convert("RGB").resize((W, H), Image.LANCZOS)

    # Load fonts
    font_title = ImageFont.truetype(FONT_MONTSERRAT, 72)
    font_tagline = ImageFont.truetype(FONT_MONTSERRAT, 28)

    # Pre-render static text layer
    text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(text_layer)

    title = "SOVEREIGN SYNTHESIS"
    bbox = td.textbbox((0, 0), title, font=font_title)
    tw = bbox[2] - bbox[0]
    title_x = (W - tw) // 2
    title_y = 460

    # Shadow
    td.text((title_x + 3, title_y + 3), title, font=font_title, fill=(40, 30, 10, 200))
    # Gold text
    td.text((title_x, title_y), title, font=font_title, fill=(255, 207, 80, 255))

    # Tagline
    tagline = "ARCHITECTURE  //  SOVEREIGNTY  //  FREQUENCY"
    bbox2 = td.textbbox((0, 0), tagline, font=font_tagline)
    tw2 = bbox2[2] - bbox2[0]
    tag_x = (W - tw2) // 2
    tag_y = title_y + 90
    td.text((tag_x, tag_y), tagline, font=font_tagline, fill=(200, 170, 90, 210))

    # Gold accent line
    line_y = title_y + 78
    line_hw = 200
    td.line([(W // 2 - line_hw, line_y), (W // 2 + line_hw, line_y)],
            fill=(255, 207, 80, 180), width=2)

    frame_dir = os.path.join(TEMP, "ace")
    if os.path.exists(frame_dir):
        shutil.rmtree(frame_dir)
    os.makedirs(frame_dir, exist_ok=True)

    cx, cy = W // 2, H // 2 - 60  # bloom center

    for i in range(N_FRAMES):
        t = i / max(N_FRAMES - 1, 1)

        # ── Bloom envelope: explosive start, decays to clean ──
        bloom_t = max(0, 1.0 - ease_out_expo(t))

        frame = bg.copy()

        # LAYER 1: Deep warm underbloom (large, soft)
        if bloom_t > 0.01:
            bloom1 = Image.new("RGB", (W, H), (0, 0, 0))
            bd1 = ImageDraw.Draw(bloom1)
            radius1 = int(500 + bloom_t * 400)
            for r in range(radius1, 0, -6):
                frac = r / radius1
                intensity = int(200 * (1 - frac) ** 1.5 * bloom_t)
                bd1.ellipse([cx - r, cy - r, cx + r, cy + r],
                           fill=(intensity, int(intensity * 0.7), int(intensity * 0.2)))
            bloom1 = bloom1.filter(ImageFilter.GaussianBlur(radius=80))
            frame = ImageChops.add(frame, bloom1)

        # LAYER 2: Hot core bloom (small, bright, white-gold)
        if bloom_t > 0.15:
            core_t = max(0, (bloom_t - 0.15) / 0.85)
            bloom2 = Image.new("RGB", (W, H), (0, 0, 0))
            bd2 = ImageDraw.Draw(bloom2)
            radius2 = int(150 + core_t * 250)
            for r in range(radius2, 0, -4):
                frac = r / radius2
                intensity = int(255 * (1 - frac) ** 2.0 * core_t)
                bd2.ellipse([cx - r, cy - r, cx + r, cy + r],
                           fill=(intensity, int(intensity * 0.9), int(intensity * 0.5)))
            bloom2 = bloom2.filter(ImageFilter.GaussianBlur(radius=40))
            frame = ImageChops.add(frame, bloom2)

        # LAYER 3: Sacred geometry -- starburst rays
        if bloom_t > 0.05:
            geo_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            gd = ImageDraw.Draw(geo_layer)
            _draw_starburst(gd, cx, cy, n_rays=24, max_len=int(600 * bloom_t),
                          thickness=2, color_rgba=(255, 220, 120, 180), t_bloom=bloom_t)
            # Rotating hexagon
            rot_angle = t * math.pi * 0.5  # slow rotate
            _draw_geometry_ring(gd, cx, cy, radius=int(180 + bloom_t * 80),
                              sides=6, rotation=rot_angle,
                              color_rgba=(255, 207, 80, 160), alpha_mult=bloom_t)
            # Inner triangle
            _draw_geometry_ring(gd, cx, cy, radius=int(100 + bloom_t * 50),
                              sides=3, rotation=-rot_angle * 1.5,
                              color_rgba=(255, 230, 160, 120), alpha_mult=bloom_t * 0.8)
            # Outer dodecagon (barely visible)
            _draw_geometry_ring(gd, cx, cy, radius=int(280 + bloom_t * 120),
                              sides=12, rotation=rot_angle * 0.3,
                              color_rgba=(255, 200, 100, 80), alpha_mult=bloom_t * 0.5)
            geo_layer_blur = geo_layer.filter(ImageFilter.GaussianBlur(radius=3))
            frame = frame.convert("RGBA")
            frame = Image.alpha_composite(frame, geo_layer_blur)
            frame = frame.convert("RGB")

        # LAYER 4: Particle field (tiny bright dots flying outward)
        if bloom_t > 0.1:
            particle_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            pd_draw = ImageDraw.Draw(particle_layer)
            rng = np.random.RandomState(i + 100)
            n_particles = int(40 * bloom_t)
            for _ in range(n_particles):
                angle = rng.uniform(0, 2 * math.pi)
                dist = rng.uniform(50, 500) * (1.0 + (1.0 - bloom_t) * 0.5)
                px = int(cx + math.cos(angle) * dist)
                py = int(cy + math.sin(angle) * dist)
                if 0 <= px < W and 0 <= py < H:
                    size = rng.randint(1, 4)
                    a = int(rng.uniform(100, 255) * bloom_t)
                    pd_draw.ellipse([px - size, py - size, px + size, py + size],
                                   fill=(255, 220, 140, a))
            frame = frame.convert("RGBA")
            frame = Image.alpha_composite(frame, particle_layer)
            frame = frame.convert("RGB")

        # Brightness enhancement on bloom frames
        if bloom_t > 0.05:
            enhancer = ImageEnhance.Brightness(frame)
            frame = enhancer.enhance(1.0 + bloom_t * 0.4)

        # ── Text fade-in: starts at t=0.25, fully visible by t=0.65 ──
        text_t = max(0.0, min(1.0, (t - 0.25) / 0.4))
        text_alpha = int(255 * ease_out_cubic(text_t))

        if text_alpha > 0:
            faded_text = text_layer.copy()
            alpha = faded_text.split()[3]
            alpha = alpha.point(lambda p, a=text_alpha: int(p * a / 255))
            faded_text.putalpha(alpha)
            frame = frame.convert("RGBA")
            frame = Image.alpha_composite(frame, faded_text)
            frame = frame.convert("RGB")

        frame.save(os.path.join(frame_dir, f"frame_{i:04d}.png"))
        if i % 10 == 0:
            print(f"  SS frame {i}/{N_FRAMES}")

    out_path = os.path.join(ASSETS, "brand_card_ace.mp4")
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(FPS),
        "-i", os.path.join(frame_dir, "frame_%04d.png"),
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-t", str(DURATION),
        out_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print("FFMPEG ERROR: " + r.stderr[-500:])
        return False
    print(f"  OK -> {out_path}")
    return True


# ==================================================
#  THE CONTAINMENT FIELD -- Data Corruption Glitch
# ==================================================

def gen_tcf():
    print("Generating TCF brand card (v2 -- hardcore glitch + corruption)...")
    bg = Image.open(os.path.join(ASSETS, "bg_long_tcf.png")).convert("RGB").resize((W, H), Image.LANCZOS)

    font_title = ImageFont.truetype(FONT_BEBAS, 80)
    title = "THE CONTAINMENT FIELD"

    frame_dir = os.path.join(TEMP, "tcf")
    if os.path.exists(frame_dir):
        shutil.rmtree(frame_dir)
    os.makedirs(frame_dir, exist_ok=True)

    for i in range(N_FRAMES):
        t = i / max(N_FRAMES - 1, 1)

        frame = bg.copy()
        arr = np.array(frame)

        # ── Glitch envelope: aggressive start, resolves to clean ──
        glitch_t = max(0, 1.0 - ease_out_expo(t))

        if glitch_t > 0.01:
            # LAYER 1: RGB channel split (aggressive)
            offset = int(glitch_t * 40)
            r_ch = np.roll(arr[:, :, 0], offset, axis=1)
            b_ch = np.roll(arr[:, :, 2], -offset, axis=1)
            # Slight vertical shift on green
            g_ch = np.roll(arr[:, :, 1], int(glitch_t * 8), axis=0)
            arr[:, :, 0] = r_ch
            arr[:, :, 1] = g_ch
            arr[:, :, 2] = b_ch

            # LAYER 2: Scan lines (every 2nd row darkened)
            scan_intensity = min(0.8, glitch_t * 0.9)
            scanline_mask = np.ones((H, W, 3), dtype=np.float32)
            for row in range(0, H, 2):
                scanline_mask[row, :, :] = 1.0 - scan_intensity
            arr = (arr.astype(np.float32) * scanline_mask).clip(0, 255).astype(np.uint8)

            # LAYER 3: Horizontal block displacement (aggressive)
            if glitch_t > 0.15:
                rng = np.random.RandomState(i * 42)
                n_slices = int(glitch_t * 15)
                for _ in range(n_slices):
                    y = rng.randint(0, H - 40)
                    h = rng.randint(4, 35)
                    shift = rng.randint(-int(glitch_t * 100), int(glitch_t * 100))
                    arr[y:y + h, :, :] = np.roll(arr[y:y + h, :, :], shift, axis=1)

            # LAYER 4: Corruption blocks (random rectangles with wrong color data)
            if glitch_t > 0.3:
                rng2 = np.random.RandomState(i * 99)
                n_blocks = int(glitch_t * 12)
                for _ in range(n_blocks):
                    bx = rng2.randint(0, W - 120)
                    by = rng2.randint(0, H - 30)
                    bw = rng2.randint(30, 120)
                    bh = rng2.randint(4, 20)
                    # Grab a slice from a random other position
                    sx = rng2.randint(0, W - bw)
                    sy = rng2.randint(0, H - bh)
                    arr[by:by + bh, bx:bx + bw, :] = arr[sy:sy + bh, sx:sx + bw, :]

            # LAYER 5: Static noise overlay
            if glitch_t > 0.1:
                rng3 = np.random.RandomState(i * 77)
                noise_strength = int(glitch_t * 55)
                noise = rng3.randint(0, noise_strength + 1, (H, W, 3), dtype=np.uint8)
                arr = np.clip(arr.astype(np.int16) + noise.astype(np.int16), 0, 255).astype(np.uint8)

            # LAYER 6: Intermittent full-frame flash (first few frames only)
            if glitch_t > 0.8 and i % 3 == 0:
                flash_intensity = int((glitch_t - 0.8) * 200)
                arr = np.clip(arr.astype(np.int16) + flash_intensity, 0, 255).astype(np.uint8)

        frame = Image.fromarray(arr)

        # ── Text layer with RGB ghost effect ──
        text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        td = ImageDraw.Draw(text_layer)

        bbox = td.textbbox((0, 0), title, font=font_title)
        tw = bbox[2] - bbox[0]
        title_x = (W - tw) // 2
        title_y = 440

        text_opacity = int(255 * min(1.0, t / 0.4))

        # RGB ghost text (displaced red + blue copies behind main text)
        if glitch_t > 0.05:
            offset_txt = int(glitch_t * 18)
            td.text((title_x - offset_txt, title_y - int(glitch_t * 4)),
                    title, font=font_title,
                    fill=(255, 60, 60, int(text_opacity * 0.6 * glitch_t)))
            td.text((title_x + offset_txt, title_y + int(glitch_t * 3)),
                    title, font=font_title,
                    fill=(60, 60, 255, int(text_opacity * 0.6 * glitch_t)))
            # Green channel ghost
            td.text((title_x, title_y - int(glitch_t * 6)),
                    title, font=font_title,
                    fill=(60, 255, 60, int(text_opacity * 0.3 * glitch_t)))

        # Main silver text
        td.text((title_x, title_y), title, font=font_title,
                fill=(230, 235, 245, text_opacity))

        # Subtle cool accent line
        if t > 0.45:
            line_alpha = int(255 * min(1.0, (t - 0.45) / 0.3))
            line_y = title_y + 82
            line_hw = 180
            td.line([(W // 2 - line_hw, line_y), (W // 2 + line_hw, line_y)],
                    fill=(100, 140, 200, line_alpha), width=2)

        frame = frame.convert("RGBA")
        frame = Image.alpha_composite(frame, text_layer)
        frame = frame.convert("RGB")

        frame.save(os.path.join(frame_dir, f"frame_{i:04d}.png"))
        if i % 10 == 0:
            print(f"  TCF frame {i}/{N_FRAMES}")

    out_path = os.path.join(ASSETS, "brand_card_tcf.mp4")
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(FPS),
        "-i", os.path.join(frame_dir, "frame_%04d.png"),
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-t", str(DURATION),
        out_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print("FFMPEG ERROR: " + r.stderr[-500:])
        return False
    print(f"  OK -> {out_path}")
    return True


if __name__ == "__main__":
    print(f"=== Brand Card Generator v2 ===")
    print(f"Frames: {N_FRAMES} @ {FPS}fps = {DURATION}s")
    print(f"Resolution: {W}x{H}")
    print()
    ok1 = gen_ace()
    ok2 = gen_tcf()
    if ok1 and ok2:
        print("\nBoth brand cards regenerated WITHOUT logo.")
    else:
        print("\nSomething failed.")
        sys.exit(1)
