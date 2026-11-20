# Builds the IMG review's Phase 26 measurement fixtures and an independent
# oracle (numpy, float64) for the per-cell mean and share above.
#
#   uv run --with tifffile --with numpy --with imagecodecs \
#     python docs/review/2026-11-19/evidence/fixtures/imaging/make_measure_fixtures.py
#
# Writes, next to this script:
#   measure.ome.tif        80 x 56 uint16 OME-TIFF, 0.5 um/px, 32 x 16 tiles
#                          (non-square), deflate, two SubIFD levels (40 x 28,
#                          20 x 14), partial edge tiles at every level
#   measure.ome.zarr/      the same three levels as an OME-Zarr v2 store,
#                          24 x 24 chunks (no compressor)
#   aniso.ome.zarr/        one level, 0.5 um/px in x and 1.0 um/px in y
#   measure_expected.json  the oracle's per-cell results
#
# Oracle contract (plan 26-D4, read independently of the app's code): a cell
# is a disc in micrometres; a pixel counts when its centre is inside the disc
# (distance <= radius); a pixel inside several discs goes to the cell with the
# smallest (distance / radius)^2, ties to the lower cell index; mean and
# percent at or above the threshold over the cell's pixels; no pixels -> null.
import json
import os

import numpy as np
import tifffile

HERE = os.path.dirname(os.path.abspath(__file__))
MPP = 0.5
W, H = 80, 56
THRESHOLD = 2000


def level0():
    y, x = np.mgrid[0:H, 0:W]
    return (100 + (x * 37 + y * 101) % 4000).astype(np.uint16)


def down2(a):
    # 2 x 2 mean, exact halving (80 x 56 -> 40 x 28 -> 20 x 14).
    return (
        (a[0::2, 0::2].astype(np.uint32) + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])
        // 4
    ).astype(np.uint16)


levels = [level0()]
levels.append(down2(levels[0]))
levels.append(down2(levels[1]))

# --- OME-TIFF -------------------------------------------------------------
tif_path = os.path.join(HERE, 'measure.ome.tif')
with tifffile.TiffWriter(tif_path, ome=True) as tif:
    opts = dict(tile=(16, 32), compression='zlib', photometric='minisblack')
    tif.write(
        levels[0],
        subifds=2,
        metadata={
            'axes': 'YX',
            'PhysicalSizeX': MPP,
            'PhysicalSizeY': MPP,
            'PhysicalSizeXUnit': 'µm',
            'PhysicalSizeYUnit': 'µm',
            'Channel': {'Name': ['DAPI']},
        },
        **opts,
    )
    tif.write(levels[1], subfiletype=1, **opts)
    tif.write(levels[2], subfiletype=1, **opts)

# Read back what was stored, so the oracle uses the file's pixels.
with tifffile.TiffFile(tif_path) as t:
    stored = [lv.asarray() for lv in t.series[0].levels]
for a, b in zip(stored, levels):
    assert (a == b).all()


# --- OME-Zarr v2 ------------------------------------------------------------
def write_zarr(root, arrays, scales, chunk=24):
    os.makedirs(root, exist_ok=True)
    with open(os.path.join(root, '.zgroup'), 'w') as f:
        json.dump({'zarr_format': 2}, f)
    with open(os.path.join(root, '.zattrs'), 'w') as f:
        json.dump(
            {
                'multiscales': [
                    {
                        'version': '0.4',
                        'axes': [
                            {'name': 'y', 'type': 'space', 'unit': 'micrometer'},
                            {'name': 'x', 'type': 'space', 'unit': 'micrometer'},
                        ],
                        'datasets': [
                            {
                                'path': str(i),
                                'coordinateTransformations': [
                                    {'type': 'scale', 'scale': list(s)}
                                ],
                            }
                            for i, s in enumerate(scales)
                        ],
                    }
                ],
                'omero': {
                    'channels': [
                        {'label': 'DAPI', 'color': 'FFFFFF', 'window': {'start': 0, 'end': 4200}}
                    ]
                },
            },
            f,
        )
    for i, a in enumerate(arrays):
        d = os.path.join(root, str(i))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, '.zarray'), 'w') as f:
            json.dump(
                {
                    'zarr_format': 2,
                    'shape': list(a.shape),
                    'chunks': [chunk, chunk],
                    'dtype': '<u2',
                    'compressor': None,
                    'fill_value': 0,
                    'order': 'C',
                    'filters': None,
                    'dimension_separator': '.',
                },
                f,
            )
        h, w = a.shape
        for r in range(-(-h // chunk)):
            for c in range(-(-w // chunk)):
                block = np.zeros((chunk, chunk), np.uint16)
                part = a[r * chunk : (r + 1) * chunk, c * chunk : (c + 1) * chunk]
                block[: part.shape[0], : part.shape[1]] = part
                with open(os.path.join(d, f'{r}.{c}'), 'wb') as f:
                    f.write(block.astype('<u2').tobytes())


write_zarr(
    os.path.join(HERE, 'measure.ome.zarr'),
    levels,
    [(MPP * 2**i, MPP * 2**i) for i in range(3)],
)
# Anisotropic: x 0.5 um/px, y 1.0 um/px (same pixels as level 0).
write_zarr(os.path.join(HERE, 'aniso.ome.zarr'), [levels[0]], [(1.0, 0.5)])

# --- Cells (dataset micrometres, y down) ------------------------------------
cells = [
    {'x': 16.0, 'y': 8.0, 'radius': 2.0, 'note': 'on a level-0 tile corner'},
    {'x': 16.3, 'y': 7.7, 'area': float(np.pi * 1.5**2), 'note': 'overlaps cell 0'},
    {'x': 39.8, 'y': 27.9, 'radius': 1.5, 'note': 'past the right and bottom edges'},
    {'x': -5.0, 'y': 5.0, 'radius': 1.0, 'note': 'outside'},
    {'x': 5.25, 'y': 20.25, 'radius': 0.2, 'note': 'smaller than a coarse pixel'},
    {'x': 24.0, 'y': 14.0, 'radius': 3.0, 'note': 'exact tie with cell 6 at level 0'},
    {'x': 27.5, 'y': 14.0, 'radius': 3.0, 'note': 'exact tie with cell 5 at level 0'},
]
rng = np.random.default_rng(26)
for i in range(60):
    c = {
        'x': float(np.round(rng.uniform(-2, 42), 3)),
        'y': float(np.round(rng.uniform(-2, 30), 3)),
    }
    r = float(np.round(rng.uniform(0.6, 3.5), 3))
    if i % 2 == 0:
        c['area'] = float(np.pi * r * r)
    else:
        c['radius'] = r
    c['note'] = 'random'
    cells.append(c)

DEFAULT_RADIUS = 1.25  # micrometres, for cells without an area


def cell_radius(c):
    return np.sqrt(c['area'] / np.pi) if 'area' in c else c.get('radius', DEFAULT_RADIUS)


def oracle(img, mpp_x, mpp_y):
    h, w = img.shape
    best = np.full((h, w), np.inf)
    owner = np.full((h, w), -1)
    sensitive = set()
    py, px = np.mgrid[0:h, 0:w]
    cx_um = (px + 0.5) * mpp_x
    cy_um = (py + 0.5) * mpp_y
    for i, c in enumerate(cells):
        r = cell_radius(c)
        d2 = (cx_um - c['x']) ** 2 + (cy_um - c['y']) ** 2
        inside = d2 <= r * r
        # Pixels within float32 noise of the disc edge.
        if np.any(np.abs(d2 - r * r) < 1e-4 * r * r):
            sensitive.add(i)
        rel = d2 / (r * r)
        take = inside & (rel < best)
        best[take] = rel[take]
        owner[take] = i
    out = []
    for i in range(len(cells)):
        m = owner == i
        n = int(m.sum())
        if n == 0:
            out.append({'count': 0, 'mean': None, 'above': None})
        else:
            v = img[m].astype(np.float64)
            out.append(
                {
                    'count': n,
                    'mean': float(v.mean()),
                    'above': float((v >= THRESHOLD).sum() * 100 / n),
                }
            )
    return out, sorted(sensitive)


expected = {
    'threshold': THRESHOLD,
    'defaultRadius': DEFAULT_RADIUS,
    'cells': cells,
    'levels': {},
}
for L, img in enumerate(levels):
    res, sens = oracle(img, MPP * 2**L, MPP * 2**L)
    expected['levels'][str(L)] = {'results': res, 'boundarySensitive': sens}
res, sens = oracle(levels[0], 0.5, 1.0)
expected['aniso'] = {'results': res, 'boundarySensitive': sens}

with open(os.path.join(HERE, 'measure_expected.json'), 'w') as f:
    json.dump(expected, f, indent=1)

print('cells', len(cells))
for L in range(3):
    r = expected['levels'][str(L)]['results']
    print('level', L, 'with pixels', sum(1 for x in r if x['count']), 'sensitive',
          expected['levels'][str(L)]['boundarySensitive'])
print('aniso sensitive', expected['aniso']['boundarySensitive'])
