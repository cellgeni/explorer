"""Write the Xenium test fixtures in this folder.

- cells.parquet: 10 cells in row groups of 4, typed like Xenium Ranger's file
  (optional DOUBLE centroids and areas, INT64 counts, UTF8 strings, ZSTD,
  plain encoding). Cell 3 has no area and cell 5 no segmentation method.
- cells_v1.parquet: the same cells without nucleus_count and
  segmentation_method, as Xenium Onboard Analysis 1.x wrote them, with
  dictionary encoding.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "pyarrow>=15" \
        python src/test/fixtures/xenium/make_fixtures.py
"""

from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent
CELLS = 10
ROW_GROUP_SIZE = 4
METHODS = [
    "Segmented by boundary stain (ATP1A1+CD45+E-Cadherin)",
    "Segmented by interior stain (18S)",
    "Segmented by nucleus expansion of 5.0µm",
]


def cell_id(number):
    # Xenium writes the hex digits of a uint32 prefix as the letters a-p.
    return "".join(chr(ord("a") + int(digit, 16)) for digit in f"{number:08x}") + "-1"


def cells():
    rows = range(CELLS)

    return {
        "cell_id": pa.array([cell_id(0x1234ABCD + row) for row in rows], pa.string()),
        "x_centroid": pa.array([10.5 + row for row in rows], pa.float64()),
        "y_centroid": pa.array([20.25 + 2 * row for row in rows], pa.float64()),
        "transcript_counts": pa.array([100 + row for row in rows], pa.int64()),
        "total_counts": pa.array([110 + row for row in rows], pa.int64()),
        "cell_area": pa.array(
            [None if row == 3 else 30.0 + row for row in rows], pa.float64()
        ),
        "nucleus_count": pa.array([row % 3 for row in rows], pa.int64()),
        "segmentation_method": pa.array(
            [None if row == 5 else METHODS[row % 3] for row in rows], pa.string()
        ),
    }


def main():
    columns = cells()
    pq.write_table(
        pa.table(columns),
        HERE / "cells.parquet",
        row_group_size=ROW_GROUP_SIZE,
        compression="zstd",
        use_dictionary=False,
    )

    v1_columns = {
        name: values
        for name, values in columns.items()
        if name not in ("nucleus_count", "segmentation_method")
    }
    pq.write_table(
        pa.table(v1_columns),
        HERE / "cells_v1.parquet",
        row_group_size=ROW_GROUP_SIZE,
        compression="zstd",
    )


if __name__ == "__main__":
    main()
