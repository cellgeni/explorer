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
- region_0.vzg: a ZIP64 zip, every entry deflated, laid out as the
  MERSCOPE Vizualizer file: pictures/manifest.json (stains DAPI and PolyT,
  planes 0-6), pictures/micron_to_mosaic_pixel_transform.csv (0.5 µm per
  pixel, origin 1000, 2000 µm), and pictures/pyrmosaic_DAPI_z3.tif, a
  200 x 160 12-bit JPEG BigTIFF whose three levels are pages, as tifffile
  writes the real ones. pyrmosaic_reference.json holds the image's samples
  at level 0 as tifffile decodes them.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "pyarrow>=15" --with numpy \\
        --with tifffile --with imagecodecs \\
        python src/test/fixtures/merscope/make_fixtures.py
    npx prettier --write src/test/fixtures/merscope/*.json
"""

import gzip
import io
import json
import struct
import zipfile
import zlib
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import tifffile

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


def pyramid_tiff():
    y, x = np.mgrid[0:160, 0:200]
    image = (2000 + 1500 * np.sin(x / 9.0) * np.cos(y / 11.0)).clip(0, 4095)
    image = image.astype(np.uint16)
    buffer = io.BytesIO()
    with tifffile.TiffWriter(buffer, bigtiff=True) as tif:
        level = image
        for _ in range(3):
            tif.write(
                level,
                tile=(32, 32),
                compression="jpeg",
                compressionargs={"level": 92},
                bitspersample=12,
                metadata=None,
            )
            level = level[::2, ::2]
    data = buffer.getvalue()
    decoded = tifffile.TiffFile(io.BytesIO(data)).pages[0].asarray()
    return data, decoded


def write_vzg():
    manifest = {
        "microns_per_pixel": 0.5,
        "mosaic_width_pixels": 200,
        "mosaic_height_pixels": 160,
        "bbox_microns": [1000.0, 2000.0, 1100.0, 2080.0],
        "mosaic_files": [
            {"stain": stain, "z": z, "file_name": f"mosaic_{stain}_z{z}.tif"}
            for z in range(7)
            for stain in ("DAPI", "PolyT")
        ],
    }
    transform = "2 0 -2000\n0 2 -4000\n0 0 1\n"
    tiff, decoded = pyramid_tiff()
    path = HERE / "region_0.vzg"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in (
            ("pictures/manifest.json", json.dumps(manifest).encode()),
            ("pictures/micron_to_mosaic_pixel_transform.csv", transform.encode()),
            ("pictures/pyrmosaic_DAPI_z3.tif", tiff),
        ):
            info = zipfile.ZipInfo(name, date_time=(2024, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            with archive.open(info, "w", force_zip64=True) as entry:
                entry.write(data)
    (HERE / "pyrmosaic_reference.json").write_text(
        json.dumps(
            {
                "levels": [[160, 200], [80, 100], [40, 50]],
                "sum": int(decoded.astype(np.int64).sum()),
                "firstRow": decoded[0, :32].tolist(),
            }
        )
        + "\n"
    )


if __name__ == "__main__":
    write_csvs()
    write_boundaries()
    write_vzg()
