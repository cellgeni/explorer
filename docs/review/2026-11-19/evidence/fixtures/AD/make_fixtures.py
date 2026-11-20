"""Review fixtures for area AD (AnnData / SpatialData), 2026-11-19.

Written with anndata/h5py/pyarrow, independent of the viewer, so the values
in expected.json come from numpy, not from the code under review.

- axes-{csr,csc,dense}.h5ad: 6 cells x 6 genes. Duplicate and colliding obs
  and var names, an empty and a padded obs name, negative values, a NaN, an
  all-zero row and an all-zero column; obs columns of several dtypes.
- axes-{csr,csc,dense}.zarr: the same AnnData written with write_zarr (v2,
  consolidated), for the AnnData Zarr backend.
- scan-{csr,csc}.h5ad (in $AD_SCAN_DIR): 20,000 cells x 2,000 genes, ~5% dense, gzip, for the
  range-read cost measurement (wire vs decoded bytes, requests).
- int64-shapes.parquet: three circles indexed by int64 ids above 2**53, as
  spatialdata-io writes MERSCOPE EntityIDs; int64-shapes-small.parquet the
  same circles with ids 12-14 (control).

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "anndata>=0.12" --with pyarrow \
        python docs/review/2026-11-19/evidence/fixtures/AD/make_fixtures.py
"""

import json
import os
import shutil
import struct
import warnings
from pathlib import Path

import anndata as ad
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import scipy.sparse as sp

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
# The two 6 MB scan files are not kept in the review folder; set AD_SCAN_DIR.
SCAN_DIR = Path(os.environ.get("AD_SCAN_DIR", HERE))

OBS_NAMES = ["c0", "c0", "c0-2", "c3", "", " c5 "]
VAR_NAMES = ["G", "G", "G-2", "Neg", "Empty", "Nan"]
X = np.array(
    [
        # G   G    G-2  Neg   Empty Nan
        [1.0, 0.0, 10.0, -2.0, 0.0, 0.0],
        [2.0, 0.0, 20.0, 0.0, 0.0, 0.0],
        [3.0, 5.0, 30.0, 0.0, 0.0, 1.0],
        [0.0, 6.0, 40.0, -1.0, 0.0, np.nan],
        [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        [4.0, 7.0, 50.0, 3.0, 0.0, 2.0],
    ],
    dtype=np.float32,
)
BIG = 2**53


def axes_adata(kind):
    matrix = {"csr": sp.csr_matrix, "csc": sp.csc_matrix, "dense": np.asarray}[kind](X)
    obs = pd.DataFrame(
        {
            "cluster": pd.Categorical(["A", "B", None, "A", "B", "A"]),
            "flag": np.array([True, False, True, False, True, False]),
            "count_na": pd.array([1, None, 3, 4, 5, 6], dtype="Int64"),
            "big_id": np.array([BIG + 1, BIG + 2, BIG + 3, 1, 2, 3], dtype=np.int64),
            "note": ["x", "y", "", "z", "x", "y"],
        },
        index=pd.Index(OBS_NAMES),
    )
    var = pd.DataFrame(index=pd.Index(VAR_NAMES))
    adata = ad.AnnData(X=matrix, obs=obs, var=var)
    # Asymmetric so x/y swaps and scale errors show: x = 10*row + 1, y = 100*row + 2.
    rows = np.arange(len(OBS_NAMES), dtype=np.float64)
    adata.obsm["spatial"] = np.stack([10 * rows + 1, 100 * rows + 2], axis=1)
    adata.obsm["X_umap"] = np.stack([rows, -rows], axis=1)
    return adata


def write_axes():
    for kind in ("csr", "csc", "dense"):
        adata = axes_adata(kind)
        adata.write_h5ad(HERE / f"axes-{kind}.h5ad", compression="gzip")
        store = HERE / f"axes-{kind}.zarr"
        shutil.rmtree(store, ignore_errors=True)
        adata.write_zarr(store)
        try:
            import zarr

            zarr.consolidate_metadata(str(store))
        except Exception as error:  # noqa: BLE001
            print("consolidate failed", error)

    expected = {
        "obsNamesAsStored": OBS_NAMES,
        "varNamesAsStored": VAR_NAMES,
        "X": [[None if np.isnan(v) else float(v) for v in row] for row in X],
        "coordinates": [[10 * r + 1, 100 * r + 2] for r in range(len(OBS_NAMES))],
        # numpy oracles for the multi-gene reads
        "sumGNeg": [float(X[r, 0] + X[r, 3]) for r in range(len(OBS_NAMES))],
        "column1": [float(v) for v in X[:, 1]],
        "column2": [float(v) for v in X[:, 2]],
        "meanNegOverCells": float(np.mean(X[:, 3])),
        "bigIdsExact": [str(BIG + 1), str(BIG + 2), str(BIG + 3)],
    }
    (HERE / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")


def write_scan():
    rng = np.random.default_rng(7)
    rows, cols, density = 20_000, 2_000, 0.05
    matrix = sp.random(rows, cols, density=density, format="csr", random_state=rng, dtype=np.float32)
    matrix.data = np.ceil(matrix.data * 9).astype(np.float32)  # counts 1..9
    obs = pd.DataFrame(index=pd.Index([f"cell{i}" for i in range(rows)]))
    var = pd.DataFrame(index=pd.Index([f"gene{j}" for j in range(cols)]))
    coords = np.stack([np.arange(rows) % 200, np.arange(rows) // 200], axis=1).astype(np.float64)
    stats = {}
    for kind in ("csr", "csc"):
        x = matrix if kind == "csr" else matrix.tocsc()
        adata = ad.AnnData(X=x, obs=obs, var=var)
        adata.obsm["spatial"] = coords
        path = SCAN_DIR / f"scan-{kind}.h5ad"
        adata.write_h5ad(path, compression="gzip")
        stats[kind] = {"fileBytes": path.stat().st_size}
    col0 = matrix[:, 0].toarray().ravel()
    stats["nnz"] = int(matrix.nnz)
    stats["gene0Nonzero"] = int((col0 != 0).sum())
    stats["gene0Sum"] = float(col0.sum())
    stats["decodedDataPlusIndicesBytes"] = int(matrix.nnz * (4 + 4))
    (HERE / "scan-expected.json").write_text(json.dumps(stats, indent=2) + "\n")


def wkb_point(x, y):
    return struct.pack("<BIdd", 1, 1, x, y)


def write_int64_shapes():
    write_int64_shapes_with(
        np.array([BIG * 256 + 12, BIG * 256 + 13, BIG * 256 + 14], dtype=np.int64),
        "int64-shapes.parquet",
    )
    # Control: the same shapes with ids below 2**53.
    write_int64_shapes_with(np.array([12, 13, 14], dtype=np.int64), "int64-shapes-small.parquet")


def write_int64_shapes_with(ids, name):
    table = pa.table(
        {
            "geometry": pa.array([wkb_point(1, 1), wkb_point(5, 1), wkb_point(9, 1)], pa.binary()),
            "radius": pa.array([1.0, 1.0, 1.0]),
            "__index_level_0__": pa.array(ids, pa.int64()),
        }
    )
    pandas_meta = {
        "index_columns": ["__index_level_0__"],
        "columns": [],
        "column_indexes": [],
        "pandas_version": "2.2.0",
    }
    geo = {
        "version": "1.1.0",
        "primary_column": "geometry",
        "columns": {"geometry": {"encoding": "WKB", "geometry_types": ["Point"]}},
    }
    table = table.replace_schema_metadata(
        {b"geo": json.dumps(geo).encode(), b"pandas": json.dumps(pandas_meta).encode()}
    )
    pq.write_table(table, HERE / name)
    if name == "int64-shapes.parquet":
        (HERE / "int64-expected.json").write_text(
            json.dumps({"ids": [str(int(v)) for v in ids]}, indent=2) + "\n"
        )


if __name__ == "__main__":
    write_axes()
    write_scan()
    write_int64_shapes()
    for path in sorted(HERE.iterdir()):
        if path.is_file():
            print(path.name, path.stat().st_size)
