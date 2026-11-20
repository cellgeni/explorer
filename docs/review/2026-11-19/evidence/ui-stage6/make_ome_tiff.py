# Stage 6 fixture: a 2-channel uint16 pyramidal OME-TIFF (4096 x 4096,
# 512 px deflate tiles, three SubIFD levels), for the tile decode worker and
# memory measurement (IO-02). Review-only; writes outside the repository.
#
#   uv run --with tifffile --with numpy --with imagecodecs python make_ome_tiff.py <out.ome.tif>
import sys

import numpy as np
import tifffile

out = sys.argv[1]
size = 4096
y, x = np.mgrid[0:size, 0:size].astype(np.float32)
r = np.hypot(x - size / 2, y - size / 2)
rings = (np.sin(r / 40) + 1) * 15000
grid = ((x % 500 < 4) | (y % 500 < 4)) * 30000
diag = ((x + y) % 997 < 8) * 20000
noise = np.random.default_rng(1).integers(0, 2000, (size, size))
c0 = np.clip(rings + grid + noise, 0, 65535).astype(np.uint16)
c1 = np.clip(rings[:, ::-1] + diag + noise, 0, 65535).astype(np.uint16)
data = np.stack([c0, c1])

levels = 3
with tifffile.TiffWriter(out, bigtiff=False, ome=True) as tif:
    options = dict(tile=(512, 512), compression='zlib', photometric='minisblack')
    tif.write(
        data,
        subifds=levels,
        metadata={'axes': 'CYX', 'Channel': {'Name': ['rings', 'diagonals']}},
        resolution=(1 / 0.5, 1 / 0.5),
        resolutionunit='MICROMETER',
        **options,
    )
    level = data
    for _ in range(levels):
        level = level[:, ::2, ::2]
        tif.write(level, subfiletype=1, **options)
print(out)
