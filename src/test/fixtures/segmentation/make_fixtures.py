"""Write the imported segmentation test fixtures in this folder.

- vertices.parquet: one row per vertex as Xenium's cell_boundaries.parquet
  lays it out (cell_id, vertex_x, vertex_y, label_id), in two row groups of
  six rows, so cell "b" runs on from the first group into the second. Cells
  "a" (a 10 px square at 0, 0) and "b" (a triangle) repeat their first vertex
  last; "c" (three corners of a 4 px square at 20, 20) does not.
- wkt.parquet: a plain Parquet file (no GeoParquet metadata) with an integer
  `label` column and a `geometry` column of WKT strings: labels 5 and 6, and
  a row whose geometry is POINT, which is skipped.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "pyarrow>=15" \
        python src/test/fixtures/segmentation/make_fixtures.py
"""

from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent


def vertices():
    rows = [
        ("a", 0, 0),
        ("a", 10, 0),
        ("a", 10, 10),
        ("a", 0, 10),
        ("a", 0, 0),
        ("b", 30, 0),
        ("b", 40, 0),
        ("b", 35, 8),
        ("b", 30, 0),
        ("c", 20, 20),
        ("c", 24, 20),
        ("c", 24, 24),
    ]
    labels = {"a": 1, "b": 2, "c": 3}
    table = pa.table(
        {
            "cell_id": pa.array([row[0] for row in rows], pa.string()),
            "vertex_x": pa.array([row[1] for row in rows], pa.float32()),
            "vertex_y": pa.array([row[2] for row in rows], pa.float32()),
            "label_id": pa.array([labels[row[0]] for row in rows], pa.int32()),
        }
    )
    pq.write_table(table, HERE / "vertices.parquet", row_group_size=6)


def wkt():
    table = pa.table(
        {
            "label": pa.array([5, 6, 7], pa.int64()),
            "geometry": pa.array(
                [
                    "POLYGON ((0 0, 8 0, 8 8, 0 8, 0 0))",
                    "MULTIPOLYGON (((50 50, 51 50, 51 51, 50 50)), ((10 10, 30 10, 30 30, 10 30, 10 10)))",
                    "POINT (3 4)",
                ],
                pa.string(),
            ),
        }
    )
    pq.write_table(table, HERE / "wkt.parquet")


if __name__ == "__main__":
    vertices()
    wkt()
