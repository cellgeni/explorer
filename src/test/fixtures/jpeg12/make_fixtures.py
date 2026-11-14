"""Write the 12-bit JPEG decoder test fixtures in this folder, each with the
pixels libjpeg-turbo decodes from it as the reference (raw little-endian
samples, row by row).

- gradient_12bit.jpg / .u16: 45 x 37 12-bit grayscale (SOF1), encoded by
  imagecodecs (libjpeg-turbo). Odd sizes exercise partial blocks.
- gradient_12bit_tables.jpg + gradient_12bit_image.jpg: the same stream split
  as a TIFF writes it with a JPEGTables tag: DQT and DHT in the tables
  stream, the frame and scan in the image stream.
- restart_8bit.jpg / .u8: 45 x 37 8-bit grayscale with a restart interval of
  2 MCUs (DRI and RSTn markers), encoded by Pillow.
- merscope_tile.jpg / merscope_tile.json: one 384 x 384 tile of
  pictures/pyrmosaic_DAPI_z3.tif in the BioImage Archive S-BIAD3359 Ctrl173
  .vzg (CC0), with the reference's sum, minimum, maximum, and the centre
  64 x 64 samples. Run with --tile <path to the raw tile bytes> to replace it.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with numpy --with imagecodecs \\
        --with pillow python src/test/fixtures/jpeg12/make_fixtures.py
    npx prettier --write src/test/fixtures/jpeg12/*.json
"""

import io
import json
import struct
import sys
from pathlib import Path

import imagecodecs
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent


def gradient(height, width, peak, noise):
    rng = np.random.default_rng(1)
    y, x = np.mgrid[0:height, 0:width]
    image = peak / 2 + peak * 0.4 * np.sin(x / 5.0) * np.cos(y / 7.0)
    return (image + rng.normal(0, noise, (height, width))).clip(0, peak)


def segments(stream):
    """Marker segments of a JPEG stream up to SOS, then the scan and EOI."""
    out = [stream[:2]]
    pos = 2
    while True:
        marker = stream[pos + 1]
        length = struct.unpack(">H", stream[pos + 2 : pos + 4])[0]
        if marker == 0xDA:
            out.append(stream[pos:])
            return out
        out.append(stream[pos : pos + 2 + length])
        pos += 2 + length


def main():
    image = gradient(37, 45, 4095, 40).astype(np.uint16)
    encoded = imagecodecs.jpeg8_encode(image, level=92, bitspersample=12)
    (HERE / "gradient_12bit.jpg").write_bytes(encoded)
    (HERE / "gradient_12bit.u16").write_bytes(
        imagecodecs.jpeg8_decode(encoded).astype("<u2").tobytes()
    )

    parts = segments(encoded)
    tables = [part for part in parts[1:-1] if part[1] in (0xDB, 0xC4)]
    rest = [part for part in parts[1:-1] if part[1] not in (0xDB, 0xC4)]
    (HERE / "gradient_12bit_tables.jpg").write_bytes(
        b"\xff\xd8" + b"".join(tables) + b"\xff\xd9"
    )
    (HERE / "gradient_12bit_image.jpg").write_bytes(
        b"\xff\xd8" + b"".join(rest) + parts[-1]
    )

    small = gradient(37, 45, 255, 10).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(small).save(buffer, "JPEG", quality=90, restart_marker_blocks=2)
    (HERE / "restart_8bit.jpg").write_bytes(buffer.getvalue())
    (HERE / "restart_8bit.u8").write_bytes(
        np.asarray(Image.open(io.BytesIO(buffer.getvalue()))).astype(np.uint8).tobytes()
    )

    if "--tile" in sys.argv:
        tile = Path(sys.argv[sys.argv.index("--tile") + 1]).read_bytes()
        (HERE / "merscope_tile.jpg").write_bytes(tile)
    tile = (HERE / "merscope_tile.jpg").read_bytes()
    decoded = imagecodecs.jpeg8_decode(tile).astype(np.int64)
    height, width = decoded.shape
    centre = decoded[height // 2 - 32 : height // 2 + 32, width // 2 - 32 : width // 2 + 32]
    (HERE / "merscope_tile.json").write_text(
        json.dumps(
            {
                "width": width,
                "height": height,
                "sum": int(decoded.sum()),
                "min": int(decoded.min()),
                "max": int(decoded.max()),
                "centre": centre.ravel().tolist(),
            }
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
