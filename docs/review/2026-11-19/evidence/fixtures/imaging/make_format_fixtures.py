# Builds the IMG review's small TIFF format fixtures.
#
#   uv run --with tifffile --with numpy --with imagecodecs \
#     python docs/review/2026-11-19/evidence/fixtures/imaging/make_format_fixtures.py
#
#   subifd_tiles.ome.tif   96 x 64 uint16 OME-TIFF, level 0 in 32 x 32 tiles,
#                          SubIFD level 1 (48 x 32) in 16 x 16 tiles
#   aniso.ome.tif          64 x 32 uint16 OME-TIFF, PhysicalSizeX 0.5,
#                          PhysicalSizeY 1.0 (micrometres), 16 x 16 tiles
#   planar_rgb.tif         40 x 24 uint8 RGB, planar configuration 2,
#                          16 x 16 tiles, LZW + horizontal predictor
#   zstd.ome.tif           48 x 40 uint16, zstd, 16 x 16 tiles
#   float32.ome.tif        32 x 32 float32, 16 x 16 tiles (docs: float fails)
#   int16.ome.tif          32 x 32 int16 (SampleFormat 2), values -500..499
#   no_compression_tag.tif 32 x 32 uint16, uncompressed, Compression tag removed
#   pixels.json            the expected pixels of each, for the repro
import json
import os

import numpy as np
import tifffile

HERE = os.path.dirname(os.path.abspath(__file__))
out = {}


def ramp(h, w, mod=4000, base=100):
    y, x = np.mgrid[0:h, 0:w]
    return (base + (x * 37 + y * 101) % mod).astype(np.uint16)


# SubIFD level with another tile size than level 0.
l0 = ramp(64, 96)
l1 = l0[::2, ::2].copy()
with tifffile.TiffWriter(os.path.join(HERE, 'subifd_tiles.ome.tif'), ome=True) as tif:
    tif.write(l0, subifds=1, tile=(32, 32), photometric='minisblack',
              metadata={'axes': 'YX', 'PhysicalSizeX': 1.0, 'PhysicalSizeY': 1.0})
    tif.write(l1, subfiletype=1, tile=(16, 16), photometric='minisblack')
out['subifd_tiles'] = {'level1': l1.tolist()}

# Non-square pixels.
a = ramp(32, 64)
tifffile.imwrite(os.path.join(HERE, 'aniso.ome.tif'), a, ome=True, tile=(16, 16),
                 photometric='minisblack',
                 metadata={'axes': 'YX', 'PhysicalSizeX': 0.5, 'PhysicalSizeY': 1.0,
                           'PhysicalSizeXUnit': 'µm', 'PhysicalSizeYUnit': 'µm'})

# Planar RGB with LZW + predictor.
y, x = np.mgrid[0:24, 0:40]
rgb = np.stack([(x * 6) % 256, (y * 10) % 256, ((x + y) * 3) % 256]).astype(np.uint8)
tifffile.imwrite(os.path.join(HERE, 'planar_rgb.tif'), rgb, planarconfig='separate',
                 photometric='rgb', tile=(16, 16), compression='lzw', predictor=True)
out['planar_rgb'] = {'r': rgb[0].tolist(), 'g': rgb[1].tolist(), 'b': rgb[2].tolist()}

# zstd tiles.
z = ramp(40, 48)
tifffile.imwrite(os.path.join(HERE, 'zstd.ome.tif'), z, ome=True, tile=(16, 16),
                 compression='zstd', photometric='minisblack')
out['zstd'] = {'pixels': z.tolist()}

# float32.
f = (ramp(32, 32).astype(np.float32) / 7.0)
tifffile.imwrite(os.path.join(HERE, 'float32.ome.tif'), f, ome=True, tile=(16, 16),
                 photometric='minisblack')

# int16 (SampleFormat 2), values -500..499.
i16 = (ramp(32, 32, mod=1000, base=0).astype(np.int32) - 500).astype(np.int16)
tifffile.imwrite(os.path.join(HERE, 'int16.ome.tif'), i16, ome=True, tile=(16, 16),
                 photometric='minisblack')
out['int16'] = {'pixels': i16.tolist()}

# Uncompressed tiles with the Compression tag removed (TIFF 6.0 default: 1).
nc = ramp(32, 32)
path = os.path.join(HERE, 'no_compression_tag.tif')
tifffile.imwrite(path, nc, tile=(16, 16), photometric='minisblack')
with tifffile.TiffFile(path) as t:
    tag = t.pages[0].tags['Compression']
    assert tag.value == 1
    tag_offset = tag.offset
raw = bytearray(open(path, 'rb').read())
# Re-code the entry as an unknown private tag (65000) so readers default it.
assert int.from_bytes(raw[tag_offset:tag_offset + 2], 'little') == 259
raw[tag_offset:tag_offset + 2] = (65000).to_bytes(2, 'little')
open(path, 'wb').write(raw)
out['no_compression_tag'] = {'pixels': nc.tolist()}

with open(os.path.join(HERE, 'pixels.json'), 'w') as fh:
    json.dump(out, fh)
print('ok')
