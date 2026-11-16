"""Parquet files for the structure drawer's row preview.

pages.parquet: 5,000 rows in one row group, written in pages of about 1 KB,
so its first rows sit in the first few pages of each column chunk:
  id (int64, 0..4999), name (string "cell-00000", dictionary-encoded),
  score (double, id / 4, null every 7th row), seen (timestamp[us, UTC],
  2024-01-01 plus id seconds), flag (bool, even ids).
nested.parquet: 3 rows with a list and a struct column:
  id (int32), tags (list<string>), point (struct<x: double, y: double>).

    uv run --with pyarrow python src/test/fixtures/parquet/make_fixtures.py
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

HERE = Path(__file__).parent


def main():
    rows = 5000
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    pages = pa.table(
        {
            "id": pa.array(range(rows), pa.int64()),
            "name": pa.array([f"cell-{i:05d}" for i in range(rows)], pa.string()),
            "score": pa.array(
                [None if i % 7 == 0 else i / 4 for i in range(rows)], pa.float64()
            ),
            "seen": pa.array(
                [start + timedelta(seconds=i) for i in range(rows)],
                pa.timestamp("us", tz="UTC"),
            ),
            "flag": pa.array([i % 2 == 0 for i in range(rows)], pa.bool_()),
        }
    )
    pq.write_table(
        pages,
        HERE / "pages.parquet",
        row_group_size=rows,
        data_page_size=1024,
        use_dictionary=["name"],
        compression="snappy",
    )

    nested = pa.table(
        {
            "id": pa.array([1, 2, 3], pa.int32()),
            "tags": pa.array([["a", "b"], [], None], pa.list_(pa.string())),
            "point": pa.array(
                [{"x": 1.5, "y": 2.5}, {"x": 3.0, "y": 4.0}, None],
                pa.struct([("x", pa.float64()), ("y", pa.float64())]),
            ),
        }
    )
    pq.write_table(nested, HERE / "nested.parquet", compression="zstd")


if __name__ == "__main__":
    main()
