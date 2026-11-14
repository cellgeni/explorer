"""Write the AnnData Zarr test fixtures in this folder.

- tiny.zarr: a 6-cell AnnData written with `adata.write_zarr` as Zarr v2, a
  dense X chunked by gene columns, with consolidated metadata (.zmetadata).
  Tests hide .zmetadata to read it the way stores written before anndata
  consolidated metadata are read.
- tiny.v3.zarr: the same AnnData with a CSR X, written as Zarr v3 without
  consolidated metadata.

Both hold obsm `spatial`, `X_umap`, and `X_scvi`; only a listing of obsm finds
`X_scvi`, as the viewer does not probe for it by name. The obs column
"stage  " ends in spaces, as some exported sample sheets do.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "anndata>=0.12" \
        python src/test/fixtures/anndata-zarr/make_fixtures.py
"""

import shutil
from pathlib import Path

import anndata as ad
import numpy as np
import pandas as pd
import scipy.sparse as sp
import zarr

HERE = Path(__file__).resolve().parent


def tiny_anndata(x):
    obs = pd.DataFrame(
        {
            "cluster": pd.Categorical(["A", "B", "A", "B", "A", "B"]),
            "score": np.array([0.1, 0.5, 0.9, 0.2, 0.4, 0.6], dtype="float32"),
            "stage  ": pd.Categorical(["early", "early", "late", "late", "late", "early"]),
        },
        index=[f"cell-{letter}" for letter in "abcdef"],
    )
    var = pd.DataFrame(index=["Actb", "Gad1", "Gapdh", "Sst"])
    spatial = np.array([[0, 0], [10, 0], [0, 10], [10, 10], [5, 5], [20, 20]], dtype="float64")
    umap = np.array([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]], dtype="float32")
    scvi = np.arange(18, dtype="float32").reshape(6, 3)
    return ad.AnnData(
        X=x,
        obs=obs,
        var=var,
        obsm={"spatial": spatial, "X_umap": umap, "X_scvi": scvi},
    )


def matrix():
    return np.array(
        [
            [1, 0, 5, 0],
            [2, 3, 0, 0],
            [0, 4, 6, 1],
            [7, 0, 8, 0],
            [0, 0, 0, 2],
            [3, 1, 0, 0],
        ],
        dtype="float32",
    )


def write(path, adata, zarr_format, consolidated):
    shutil.rmtree(path, ignore_errors=True)
    ad.settings.zarr_write_format = zarr_format
    adata.write_zarr(path, chunks=(6, 2) if not sp.issparse(adata.X) else None)

    if not consolidated:
        (path / ".zmetadata").unlink(missing_ok=True)

        if zarr_format == 3:
            # Rewrite the root zarr.json without consolidated_metadata.
            attrs = dict(zarr.open_group(path, mode="r", zarr_format=3).attrs)
            (path / "zarr.json").unlink()
            zarr.open_group(path, mode="a", zarr_format=3).attrs.update(attrs)


def main():
    write(HERE / "tiny.zarr", tiny_anndata(matrix()), 2, consolidated=True)
    write(
        HERE / "tiny.v3.zarr",
        tiny_anndata(sp.csr_matrix(matrix())),
        3,
        consolidated=False,
    )


if __name__ == "__main__":
    main()
