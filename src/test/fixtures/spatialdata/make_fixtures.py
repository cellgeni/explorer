"""Write the SpatialData shapes test fixtures in this folder.

Both are GeoParquet with WKB geometry, Snappy, one row group, laid out like
spatialdata-io's shapes.parquet (pandas index in `__index_level_0__`):

- cell_boundaries.parquet: 4 polygons with string ids. Cell 1 has a hole;
  cell 2 is a MultiPolygon whose second polygon is the larger; cell 3 is a
  3D (ISO WKB Polygon Z) square.
- cell_circles.parquet: 3 points with a radius column and integer ids.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "pyarrow>=15" \
        python src/test/fixtures/spatialdata/make_fixtures.py
"""

import json
import struct
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent


def square(x, y, size, z=None):
    corners = [(x, y), (x + size, y), (x + size, y + size), (x, y + size), (x, y)]
    return [(cx, cy) if z is None else (cx, cy, z) for cx, cy in corners]


def wkb_polygon(rings, type_code=3):
    parts = [struct.pack("<BII", 1, type_code, len(rings))]
    for ring in rings:
        parts.append(struct.pack("<I", len(ring)))
        for point in ring:
            parts.append(struct.pack(f"<{len(point)}d", *point))
    return b"".join(parts)


def wkb_multipolygon(polygons):
    return struct.pack("<BII", 1, 6, len(polygons)) + b"".join(polygons)


def wkb_point(x, y):
    return struct.pack("<BIdd", 1, 1, x, y)


def write(name, columns, geometry_types, bbox):
    table = pa.table(columns)
    metadata = {
        b"geo": json.dumps(
            {
                "version": "1.1.0",
                "primary_column": "geometry",
                "columns": {
                    "geometry": {
                        "encoding": "WKB",
                        "crs": None,
                        "geometry_types": geometry_types,
                        "bbox": bbox,
                    }
                },
            }
        ).encode(),
        b"pandas": json.dumps(
            {"index_columns": ["__index_level_0__"], "columns": []}
        ).encode(),
    }
    pq.write_table(
        table.replace_schema_metadata(metadata),
        HERE / name,
        compression="snappy",
    )


def main():
    write(
        "cell_boundaries.parquet",
        {
            "geometry": pa.array(
                [
                    wkb_polygon([square(0, 0, 2)]),
                    wkb_polygon([square(4, 0, 4), square(5, 1, 1)]),
                    wkb_multipolygon(
                        [wkb_polygon([square(10, 0, 1)]), wkb_polygon([square(12, 0, 3)])]
                    ),
                    wkb_polygon([square(0, 10, 2, z=5.0)], type_code=1003),
                ],
                pa.binary(),
            ),
            "__index_level_0__": pa.array(
                ["aaaa-1", "aaab-1", "aaac-1", "aaad-1"], pa.string()
            ),
        },
        ["Polygon", "MultiPolygon", "Polygon Z"],
        [0, 0, 15, 12],
    )
    write(
        "cell_circles.parquet",
        {
            "geometry": pa.array(
                [wkb_point(1, 1), wkb_point(6, 2), wkb_point(13.5, 1.5)], pa.binary()
            ),
            "radius": pa.array([1.0, 2.0, 1.5], pa.float64()),
            "__index_level_0__": pa.array([7, 8, 9], pa.int64()),
        },
        ["Point"],
        [1, 1, 13.5, 2],
    )


if __name__ == "__main__":
    main()
