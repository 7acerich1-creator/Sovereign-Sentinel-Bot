"""Preview the delogo'd brand card in the full 5s opening sequence."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from preview_opening import build_preview, STYLES, OUT_DIR

# Point Ace to the delogo'd version
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "brand-assets")
STYLES["ace_richie"]["card"] = os.path.join(ASSETS, "brand_card_ace_clean.mp4")

ok = build_preview("ace_richie")
if ok:
    # Copy to repo root for easy access
    import shutil
    src = os.path.join(OUT_DIR, "preview_opening_ace_richie.mp4")
    dst = os.path.join(os.path.dirname(ASSETS), "preview_delogo_ace.mp4")
    shutil.copy2(src, dst)
    print(f"\nCopied to {dst}")
