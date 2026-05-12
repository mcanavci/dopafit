"""Pad any screenshot to Chrome Web Store specs (1280×800, no alpha).

Usage:
    python3 ship/screenshot.py <input.png> [<input2.png> ...]

Outputs:
    ship/screens/<original-name>-1280x800.png    (RGB, no alpha)

The source screenshot (typically a Chrome extension popup ~380×600) is
centered on a 1280×800 brand-cream background. Output is 24-bit RGB PNG —
exactly what Chrome Web Store accepts.
"""

import sys
from pathlib import Path
from PIL import Image

BG = (249, 248, 246)   # brand cream — matches the popup card background
TARGET = (1280, 800)


def pad(src: Path, out_dir: Path) -> Path:
    img = Image.open(src).convert("RGB")
    src_w, src_h = img.size

    # If the source is already taller than the target, scale it down.
    max_h = int(TARGET[1] * 0.92)  # leave 4% padding top + bottom
    if src_h > max_h:
        scale = max_h / src_h
        new_w = int(src_w * scale)
        img = img.resize((new_w, max_h), Image.LANCZOS)
        src_w, src_h = img.size

    canvas = Image.new("RGB", TARGET, BG)
    paste_x = (TARGET[0] - src_w) // 2
    paste_y = (TARGET[1] - src_h) // 2
    canvas.paste(img, (paste_x, paste_y))

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{src.stem}-1280x800.png"
    canvas.save(out_path, "PNG", optimize=True)
    return out_path


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    out_dir = Path(__file__).parent / "screens"
    for src in sys.argv[1:]:
        path = Path(src).expanduser().resolve()
        if not path.exists():
            print(f"  ✗ not found: {path}")
            continue
        out = pad(path, out_dir)
        size_kb = out.stat().st_size // 1024
        print(f"  ✓ {path.name} → {out.relative_to(Path.cwd()) if out.is_relative_to(Path.cwd()) else out} ({size_kb} KB, 1280×800 RGB)")


if __name__ == "__main__":
    main()
