"""
Preview the full 5-second opening sequence exactly as it appears in the video.
1.3s brand card animation + 3.7s typewriter overlay on last frame = 5.0s total.
Replicates compose.py _render_opening_sequence() logic locally.
"""
import os, subprocess, sys

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "brand-assets")
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "_preview")
os.makedirs(OUT_DIR, exist_ok=True)

W, H = 1920, 1080
FPS = 30
BRAND_CARD_DUR = 1.3
TYPEWRITER_DUR = 3.7
TAIL_FRAC = 0.25  # hold fully typed for last 25% of typewriter window

STYLES = {
    "sovereign_synthesis": {
        "card": os.path.join(ASSETS, "brand_card_ace.mp4"),
        "font": "Montserrat SemiBold",
        "fontsize": 54,
        "primary": "&H0080CFFF",
        "secondary": "&HFF000000",
        "outline": "&H00102040",
        "bold": 1,
        "outline_w": 2.5,
        "shadow": 1,
        "hook": "The Architecture Behind Every Reality Shift",
    },
    "containment_field": {
        "card": os.path.join(ASSETS, "brand_card_tcf.mp4"),
        "font": "JetBrains Mono",
        "fontsize": 52,
        "primary": "&H00E0E0E0",
        "secondary": "&HFF000000",
        "outline": "&H00202020",
        "bold": 0,
        "outline_w": 2.0,
        "shadow": 0,
        "hook": "The System Was Never Designed For Your Benefit",
    },
}


def _ts(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    cs = int((s - int(s)) * 100)
    return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"


def build_preview(brand_key):
    s = STYLES[brand_key]
    print(f"\n--- Building {brand_key} preview ---")

    card_path = s["card"]
    if not os.path.isfile(card_path):
        print(f"  ERROR: brand card not found: {card_path}")
        return False

    # Step 1: Extract last frame
    last_frame = os.path.join(OUT_DIR, f"{brand_key}_last_frame.png")
    subprocess.run([
        "ffmpeg", "-y", "-sseof", "-0.05", "-i", card_path,
        "-frames:v", "1", "-q:v", "1", last_frame,
    ], capture_output=True, text=True, timeout=15)
    if not os.path.isfile(last_frame):
        print("  ERROR: could not extract last frame")
        return False
    print(f"  Last frame extracted")

    # Step 2: Normalize brand card to output dims
    card_norm = os.path.join(OUT_DIR, f"{brand_key}_card_norm.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-i", card_path,
        "-vf", f"scale={W}:{H}:flags=lanczos,format=yuv420p",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-t", f"{BRAND_CARD_DUR:.3f}", "-r", str(FPS), "-an",
        card_norm,
    ], capture_output=True, text=True, timeout=30)
    print(f"  Card normalized")

    # Step 3: Generate typewriter ASS
    ass_path = os.path.join(OUT_DIR, f"{brand_key}_typewriter.ass")
    text = s["hook"]
    active_dur = TYPEWRITER_DUR * (1.0 - TAIL_FRAC)
    n_chars = max(1, len(text))
    char_interval_ms = max(30, min(int((active_dur / n_chars) * 1000), 200))
    cs_dur = max(1, char_interval_ms // 10)

    karaoke_parts = []
    for ch in text:
        esc = ch
        if ch == "\\": esc = "\\\\"
        elif ch == "{": esc = "\\{"
        elif ch == "}": esc = "\\}"
        karaoke_parts.append(f"{{\\kf{cs_dur}}}{esc}")
    karaoke_text = "".join(karaoke_parts)

    ass_content = f"""[Script Info]
Title: Typewriter Opening Preview
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: {W}
PlayResY: {H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Typewriter,{s['font']},{s['fontsize']},{s['primary']},{s['secondary']},{s['outline']},&H80000000,{s['bold']},0,0,0,100,100,1.5,0,1,{s['outline_w']},{s['shadow']},2,80,80,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,{_ts(0.0)},{_ts(TYPEWRITER_DUR)},Typewriter,,0,0,0,,{karaoke_text}
"""
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(ass_content)
    print(f"  Typewriter ASS generated ({n_chars} chars, {char_interval_ms}ms/char)")

    # Step 4: Render typewriter segment (last frame + ASS overlay)
    typewriter_clip = os.path.join(OUT_DIR, f"{brand_key}_typewriter.mp4")
    ass_escaped = ass_path.replace("\\", "/").replace(":", "\\:")
    subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-i", last_frame,
        "-filter_complex",
        f"[0:v]scale={W}:{H}:flags=lanczos,format=yuv420p,subtitles='{ass_escaped}'[v]",
        "-map", "[v]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-t", f"{TYPEWRITER_DUR:.3f}", "-r", str(FPS), "-an",
        typewriter_clip,
    ], capture_output=True, text=True, timeout=60)
    print(f"  Typewriter clip rendered")

    # Step 5: Concat brand card + typewriter
    concat_list = os.path.join(OUT_DIR, f"{brand_key}_concat.txt")
    with open(concat_list, "w") as f:
        f.write(f"file '{card_norm}'\n")
        f.write(f"file '{typewriter_clip}'\n")

    out_path = os.path.join(OUT_DIR, f"preview_opening_{brand_key}.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list,
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-an",
        out_path,
    ], capture_output=True, text=True, timeout=30)

    if os.path.isfile(out_path):
        size_kb = os.path.getsize(out_path) // 1024
        print(f"  OK -> {out_path} ({size_kb} KB)")
        return True
    else:
        print(f"  ERROR: output not created")
        return False


if __name__ == "__main__":
    ok1 = build_preview("sovereign_synthesis")
    ok2 = build_preview("containment_field")
    if ok1 and ok2:
        print("\nBoth previews ready.")
    else:
        print("\nSomething failed.")
        sys.exit(1)
