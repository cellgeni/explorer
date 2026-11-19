"""Write the JPEG 2000 decoder test fixtures in this folder: raw J2K
codestreams (as Xenium and Aperio TIFF tiles store them), encoded losslessly
by imagecodecs (OpenJPEG), with the source pixels as the reference (raw
little-endian samples, row by row, components interleaved).

- gradient_16bit.j2k / .u16: 45 x 37 16-bit grayscale with a 14-bit range,
  like a Xenium DAPI tile. Odd sizes exercise partial code-blocks.
- gradient_rgb.j2k / .u8: 45 x 37 8-bit RGB, like a JPEG 2000 SVS tile.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with numpy --with imagecodecs \\
        python src/test/fixtures/jpeg2000/make_fixtures.py
"""

from pathlib import Path

import imagecodecs
import numpy as np

HERE = Path(__file__).resolve().parent


def gradient(height, width, peak, noise, seed):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:height, 0:width]
    image = peak / 2 + peak * 0.4 * np.sin(x / 5.0) * np.cos(y / 7.0)
    return (image + rng.normal(0, noise, (height, width))).clip(0, peak)


def write(name, image, suffix):
    encoded = imagecodecs.jpeg2k_encode(
        image, codecformat=imagecodecs.JPEG2K.CODEC.J2K, reversible=True
    )
    assert np.array_equal(imagecodecs.jpeg2k_decode(encoded), image)
    (HERE / f"{name}.j2k").write_bytes(encoded)
    little_endian = image.astype(image.dtype.newbyteorder("<"))
    (HERE / f"{name}.{suffix}").write_bytes(little_endian.tobytes())


def main():
    write("gradient_16bit", gradient(37, 45, 16383, 200, 1).astype(np.uint16), "u16")
    rgb = np.stack(
        [gradient(37, 45, 255, 10, seed) for seed in (1, 2, 3)], axis=-1
    ).astype(np.uint8)
    write("gradient_rgb", rgb, "u8")


if __name__ == "__main__":
    main()
