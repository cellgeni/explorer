"""Write the JPEG streams of the synthetic NDPI test slide in this folder,
encoded by Pillow (libjpeg-turbo). src/test/ndpiFixtures.ts stores each as
one strip of a TIFF with the NDPI tags, and works out the McuStarts tag from
the restart markers, as NanoZoomer scanners write it.

- level0.jpg: 118 x 44 RGB, 4:2:0 (16 x 16 MCUs), a restart marker every 4
  MCUs, so 2 restart intervals per MCU row and a partial last MCU column
  and row.
- level1.jpg: 59 x 22 RGB, 4:4:4 (8 x 8 MCUs), a restart marker every 2
  MCUs: 4 intervals per row.
- level2.jpg: 30 x 11 RGB without restart markers.
- macro.jpg: 40 x 20 RGB, the slide overview.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with numpy --with pillow \\
        python src/test/fixtures/ndpi/make_fixtures.py
"""

import io
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent


def pattern(width, height):
    """Colour ramps and stripes, so a misplaced block shows."""
    y, x = np.mgrid[0:height, 0:width]
    red = (x * 255 / max(1, width - 1)).round()
    green = (y * 255 / max(1, height - 1)).round()
    blue = np.where(((x // 5) + (y // 3)) % 2 == 0, 40, 220)
    return np.stack([red, green, blue], axis=-1).astype(np.uint8)


def encode(image, subsampling, restart_blocks):
    buffer = io.BytesIO()
    options = {"quality": 95, "subsampling": subsampling}
    if restart_blocks:
        options["restart_marker_blocks"] = restart_blocks
    Image.fromarray(image).save(buffer, "JPEG", **options)
    return buffer.getvalue()


def main():
    (HERE / "level0.jpg").write_bytes(encode(pattern(118, 44), 2, 4))
    (HERE / "level1.jpg").write_bytes(encode(pattern(59, 22), 0, 2))
    (HERE / "level2.jpg").write_bytes(encode(pattern(30, 11), 0, 0))
    (HERE / "macro.jpg").write_bytes(encode(pattern(40, 20)[:, ::-1], 0, 0))


if __name__ == "__main__":
    main()
