"""Write the Visium HD test fixtures in this folder.

- barcode_mappings.parquet: a 48 x 40 grid of 2 um bins laid out like Space
  Ranger 4's file: sorted by 2 um barcode, one 2 um row (40 bins) per row
  group, so 48 row groups of 6 column chunks each, with min/max statistics.
  Cells are 5 x 5 blocks of 2 um bins on a 6-bin pitch; the centre 3 x 3 of
  each is nucleus.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "pyarrow>=15" \
        python src/test/fixtures/visium-hd/make_fixtures.py
"""

from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent
ROWS = 48
COLS = 40
CELL_PITCH = 6
CELL_SIZE = 5


def barcode(size, row, col):
    return f"s_{size:03d}um_{row:05d}_{col:05d}-1"


def barcode_mappings():
    columns = {
        "square_002um": [],
        "square_008um": [],
        "square_016um": [],
        "cell_id": [],
        "in_nucleus": [],
        "in_cell": [],
    }

    for row in range(ROWS):
        for col in range(COLS):
            in_cell = row % CELL_PITCH < CELL_SIZE and col % CELL_PITCH < CELL_SIZE
            in_nucleus = in_cell and 1 <= row % CELL_PITCH <= 3 and 1 <= col % CELL_PITCH <= 3
            cell = (row // CELL_PITCH) * (COLS // CELL_PITCH + 1) + col // CELL_PITCH + 1
            columns["square_002um"].append(barcode(2, row, col))
            columns["square_008um"].append(barcode(8, row // 4, col // 4))
            columns["square_016um"].append(barcode(16, row // 8, col // 8))
            columns["cell_id"].append(f"cellid_{cell:09d}-1" if in_cell else None)
            columns["in_nucleus"].append(in_nucleus)
            columns["in_cell"].append(in_cell)

    return pa.table(
        {
            "square_002um": pa.array(columns["square_002um"], pa.string()),
            "square_008um": pa.array(columns["square_008um"], pa.string()),
            "square_016um": pa.array(columns["square_016um"], pa.string()),
            "cell_id": pa.array(columns["cell_id"], pa.string()),
            "in_nucleus": pa.array(columns["in_nucleus"], pa.bool_()),
            "in_cell": pa.array(columns["in_cell"], pa.bool_()),
        }
    )


def main():
    pq.write_table(
        barcode_mappings(),
        HERE / "barcode_mappings.parquet",
        row_group_size=COLS,
        compression="snappy",
    )


if __name__ == "__main__":
    main()
