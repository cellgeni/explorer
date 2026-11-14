"""Write the MERSCOPE test fixtures in this folder: one small region laid out
as the instrument writes it.

- cell_by_gene.csv: 3 cells x 3 genes and 2 Blank columns. Cell IDs are
  19-digit int64 values; the first two are the same number as a double.
- cell_metadata.csv: the instrument's columns plus one stain's intensities.
  transcript_count includes Blank counts, so it differs from the gene sums.
- cell_boundaries.parquet: GeoParquet 0.4.0 with WKB MultiPolygons in µm,
  one row per cell per z plane (0-6), as written by the instrument. Plane 3
  outlines are 8 µm squares, the other planes 4 µm, and one outline belongs
  to no cell in the tables.
- cell_boundaries.parquet.gz: the same file gzipped, as GEO serves it.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "pyarrow>=15" \\
        python src/test/fixtures/merscope/make_fixtures.py
"""

import gzip
import json
import struct
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent

CELLS = [
    # id, fov, volume, centre, gene counts, blank counts, transcript_count
    ("1577590100000000000", 12, 500.5, (1010.0, 2010.0), (3, 0, 1), (0, 1), 6),
    ("1577590100000000001", 12, 300.25, (1030.0, 2010.0), (0, 5, 0), (2, 0), 9),
    ("1577590100000000002", 13, 200.0, (1020.0, 2030.0), (0, 0, 0), (0, 0), 2),
]
# An outline whose cell is in neither table.
EXTRA_OUTLINE = ("1577590100000000099", (1050.0, 2050.0))
PLANES = range(7)
MIDDLE_PLANE = 3


def write_csvs():
    lines = ["cell,GENE_A,GENE_B,GENE_C,Blank-0,Blank-1"]
    for cell_id, _, _, _, genes, blanks, _ in CELLS:
        lines.append(",".join([cell_id, *map(str, genes), *map(str, blanks)]))
    (HERE / "cell_by_gene.csv").write_text("\n".join(lines) + "\n")

    lines = [
        "EntityID,fov,volume,center_x,center_y,min_x,min_y,max_x,max_y,"
        "anisotropy,transcript_count,perimeter_area_ratio,solidity,"
        "DAPI_raw,DAPI_high_pass"
    ]
    for index, (cell_id, fov, volume, (x, y), _, _, count) in enumerate(CELLS):
        lines.append(
            ",".join(
                str(value)
                for value in [
                    cell_id, fov, volume, x, y, x - 4, y - 4, x + 4, y + 4,
                    1.25 + index, count, 0.5, 0.98, 1000 * (index + 1), 10 * (index + 1),
                ]
            )
        )
    (HERE / "cell_metadata.csv").write_text("\n".join(lines) + "\n")


def square(cx, cy, size):
    half = size / 2
    return [
        (cx - half, cy - half),
        (cx + half, cy - half),
        (cx + half, cy + half),
        (cx - half, cy + half),
        (cx - half, cy - half),
    ]


def wkb_multipolygon(ring):
    polygon = struct.pack("<BIII", 1, 3, 1, len(ring)) + b"".join(
        struct.pack("<2d", *point) for point in ring
    )
    return struct.pack("<BII", 1, 6, 1) + polygon


def write_boundaries():
    outlines = [(cell[0], cell[3]) for cell in CELLS] + [EXTRA_OUTLINE]
    rows = []
    for plane in PLANES:
        for cell_id, (x, y) in outlines:
            size = 8.0 if plane == MIDDLE_PLANE else 4.0
            rows.append((cell_id, plane, wkb_multipolygon(square(x, y, size))))
    table = pa.table(
        {
            "ID": pa.array(range(len(rows)), pa.int64()),
            "EntityID": pa.array([int(row[0]) for row in rows], pa.int64()),
            "ZIndex": pa.array([row[1] for row in rows], pa.int64()),
            "Geometry": pa.array([row[2] for row in rows], pa.binary()),
            "Type": pa.array(["cell"] * len(rows), pa.string()),
            "ZLevel": pa.array([1.5 * (row[1] + 1) for row in rows], pa.float64()),
            "Name": pa.nulls(len(rows)),
            "ParentID": pa.nulls(len(rows)),
            "ParentType": pa.nulls(len(rows)),
            "__index_level_0__": pa.array(range(len(rows)), pa.int64()),
        }
    )
    metadata = {
        b"geo": json.dumps(
            {
                "primary_column": "Geometry",
                "columns": {
                    "Geometry": {
                        "encoding": "WKB",
                        "crs": None,
                        "geometry_type": "MultiPolygon",
                        "bbox": [1002.0, 2002.0, 1054.0, 2054.0],
                    }
                },
                "version": "0.4.0",
                "creator": {"library": "geopandas", "version": "0.12.1"},
            }
        ).encode(),
        b"pandas": json.dumps(
            {"index_columns": ["__index_level_0__"], "columns": []}
        ).encode(),
    }
    path = HERE / "cell_boundaries.parquet"
    pq.write_table(table.replace_schema_metadata(metadata), path, compression="snappy")
    (HERE / "cell_boundaries.parquet.gz").write_bytes(
        gzip.compress(path.read_bytes(), mtime=0)
    )


if __name__ == "__main__":
    write_csvs()
    write_boundaries()
