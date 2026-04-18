"""
Generate brand card animations WITHOUT the logo icon.
Uses the clean background images + text overlays + animation effects.
Ace: luminous pulse bloom on bg_long_ss.png + gold text
TCF: data-glitch on bg_long_tcf.png + silver text
"""
import os, subprocess, math, sys

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


def ease_out_cubic(t):
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    return 3 * t * t - 2 * t * t * t


# --- ACE RICHIE ---

def gen_ace():
    print("Generating Ace Richie brand card...")
    bg = Image.open(os.path.join(ASSETS, "bg_long_ss.png")).convert("RGB").resize((W, H), Image.LANCZOS)

    font_title = ImageFont.truetype(FONT_MONTSERRAT, 72)
    font_tagline = ImageFont.truetype(FONT_MONTSERRAT, 28)

    # Pre-render text layer (static -- composited onto each frame)
    text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(text_layer)

    # "SOVEREIGN SYNTHESIS" -- gold, centered
    title = "SOVEREIGN SYNTHESIS"
    bbox = td.textbbox((0, 0), title, font=font_title)
    tw = bbox[2] - bbox[0]
    title_x = (W - tw) // 2
    title_y = 460

    # Shadow
    td.text((title_x + 2, title_y + 2), title, font=font_title, fill=(40, 30, 10, 180))
    # Gold text
    td.text((title_x, title_y), title, font=font_title, fill=(255, 207, 80, 255))

    # Tagline -- dimmer gold
    tagline = "ARCHITECTURE  //  SOVEREIGNTY  //  FREQUENCY"
    bbox2 = td.textbbox((0, 0), tagline, font=font_tagline)
    tw2 = bbox2[2] - bbox2[0]
    tag_x = (W - tw2) // 2
    tag_y = title_y + 85
    td.text((tag_x, tag_y), tagline, font=font_tagline, fill=(200, 170, 90, 200))

    # Gold accent line between title and tagline
    line_y = title_y + 75
    line_hw = 180
    td.line([(W // 2 - line_hw, line_y), (W // 2 + line_hw, line_y)], fill=(255, 207, 80, 160), width=2)

    frame_dir = os.path.join(TEMP, "ace")
    os.makedirs(frame_dir, exist_ok=True)

    for i in range(N_FRAMES):
        t = i / max(N_FRAMES - 1, 1)

        # Bloom intensity: starts bright, decays to clean
        bloom_t = 1.0 - ease_out_cubic(t)

        frame = bg.copy()

        if bloom_t > 0.01:
            bloom = Image.new("RGB", (W, H), (0, 0, 0))
            bd = ImageDraw.Draw(bloom)
            cx, cy = W // 2, H // 2 - 50
            radius = int(400 + bloom_t * 300)
            for r in range(radius, 0, -4):
                frac = r / radius
                intensity = int(255 * (1 - frac) * bloom_t * 0.7)
                color = (intensity, int(intensity * 0.75), int(intensity * 0.3))
                bd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)

            bloom = bloom.filter(ImageFilter.GaussianBlur(radius=60))
            frame = ImageChops.add(frame, bloom)

        if bloom_t > 0.1:
            enhancer = ImageEnhance.Brightness(frame)
            frame = enhancer.enhance(1.0 + bloom_t * 0.3)

        # Text fade-in: starts at t=0.3, fully visible by t=0.7
        text_t = max(0.0, min(1.0, (t - 0.3) / 0.4))
        text_alpha = int(255 * ease_out_cubic(text_t))

        if text_alpha > 0:
            faded_text = text_layer.copy()
            alpha = faded_text.split()[3]
            alpha = alpha.point(lambda p, a=text_alpha: int(p * a / 255))
            faded_text.putalpha(alpha)
            frame = frame.convert("RGBA")
            frame = Image.alpha_composite(frame, faded_text)
            frame = frame.convert("RGB")

        frame.save(os.path.join(frame_dir, "frame_{:04d}.png".format(i)))
        if i % 10 == 0:
            print("  Ace frame {}/{}".format(i, N_FRAMES))

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
    print("  OK Ace brand card: " + out_path)
    return True


# --- THE CONTAINMENT FIELD ---

def gen_tcf():
    print("Generating TCF brand card...")
    bg = Image.open(os.path.join(ASSETS, "bg_long_tcf.png")).convert("RGB").resize((W, H), Image.LANCZOS)

    font_title = ImageFont.truetype(FONT_BEBAS, 80)

    title = "THE CONTAINMENT FIELD"

    frame_dir = os.path.join(TEMP, "tcf")
    os.makedirs(frame_dir, exist_ok=True)

    for i in range(N_FRAMES):
        t = i / max(N_FRAMES - 1, 1)

        frame = bg.copy()
        arr = np.array(frame)

        # Data-glitch: RGB split + scan lines at start, resolving
        glitch_t = 1.0 - ease_out_cubic(t)

        if glitch_t > 0.02:
            offset = int(glitch_t * 25)
            r_ch = np.roll(arr[:, :, 0], offset, axis=1)
            b_ch = np.roll(arr[:, :, 2], -offset, axis=1)
            arr[:, :, 0] = r_ch
            arr[:, :, 2] = b_ch

            # Scan lines
            scan_intensity = glitch_t * 0.6
            for row in range(0, H, 4):
                if row % 8 < 4:
                    arr[row, :, :] = (arr[row, :, :].astype(float) * (1 - scan_intensity)).astype(np.uint8)

            # Random horizontal slice displacement
            if glitch_t > 0.3:
                rng = np.random.RandomState(i * 42)
                n_slices = int(glitch_t * 8)
                for _ in range(n_slices):
                    y = rng.randint(0, H - 30)
                    h = rng.randint(5, 25)
                    shift = rng.randint(-int(glitch_t * 60), int(glitch_t * 60))
                    arr[y:y + h, :, :] = np.roll(arr[y:y + h, :, :], shift, axis=1)

            # Static noise
            if glitch_t > 0.2:
                rng2 = np.random.RandomState(i * 77)
                noise = rng2.randint(0, int(glitch_t * 40), (H, W, 3), dtype=np.uint8)
                arr = np.clip(arr.astype(int) + noise.astype(int), 0, 255).astype(np.uint8)

        frame = Image.fromarray(arr)

        # Text layer
        text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        td = ImageDraw.Draw(text_layer)

        bbox = td.textbbox((0, 0), title, font=font_title)
        tw = bbox[2] - bbox[0]
        title_x = (W - tw) // 2
        title_y = 440

        text_opacity = int(255 * min(1.0, t / 0.5))

        if glitch_t > 0.1:
            offset_txt = int(glitch_t * 12)
            td.text((title_x - offset_txt, title_y), title, font=font_title,
                     fill=(255, 80, 80, int(text_opacity * 0.7)))
            td.text((title_x + offset_txt, title_y), title, font=font_title,
                     fill=(80, 80, 255, int(text_opacity * 0.7)))

        td.text((title_x, title_y), title, font=font_title, fill=(230, 235, 245, text_opacity))

        # Subtle blue accent line
        if t > 0.5:
            line_alpha = int(255 * min(1.0, (t - 0.5) / 0.3))
            line_y = title_y + 80
            line_hw = 160
            td.line([(W // 2 - line_hw, line_y), (W // 2 + line_hw, line_y)],
                     fill=(100, 140, 200, line_alpha), width=2)

        frame = frame.convert("RGBA")
        frame = Image.alpha_composite(frame, text_layer)
        frame = frame.convert("RGB")

        frame.save(os.path.join(frame_dir, "frame_{:04d}.png".format(i)))
        if i % 10 == 0:
            print("  TCF frame {}/{}".format(i, N_FRAMES))

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
    print("  OK TCF brand card: " + out_path)
    return True


if __name__ == "__main__":
    ok1 = gen_ace()
    ok2 = gen_tcf()
    if ok1 and ok2:
        print("\nBoth brand cards regenerated WITHOUT logo.")
    else:
        print("\nSomething failed.")
        sys.exit(1)
