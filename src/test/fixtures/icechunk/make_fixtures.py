"""Write the Icechunk test fixtures in this folder.

- tiny.h5ad and tiny.h5ad.icechunk: a 6-cell AnnData with a CSR X, and its
  companion repository of virtual references, written by
  scripts/make_h5ad_reference.py with the H5AD at https://example.test/tiny.h5ad.
- anndata.icechunk: the same AnnData written into a repository with
  `adata.write_zarr(session.store, consolidate_metadata=False)`, its chunks
  stored in the repository.
- image.icechunk: an OME-Zarr 0.5 image, one 8 x 8 uint8 channel.
- spatialdata.icechunk: a SpatialData root holding that image and a table.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "virtualizarr[hdf,icechunk]>=2.8" --with anndata \
        python src/test/fixtures/icechunk/make_fixtures.py
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("ICECHUNK_LOG", "error")

import anndata as ad
import icechunk
import numpy as np
import pandas as pd
import scipy.sparse as sp
import zarr

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parents[3] / "scripts" / "make_h5ad_reference.py"


def tiny_anndata():
    obs = pd.DataFrame(
        {
            "cluster": pd.Categorical(["A", "B", "A", "B", "A", "B"]),
            "score": np.array([0.1, 0.5, 0.9, 0.2, 0.4, 0.6], dtype="float32"),
        },
        index=[f"cell-{letter}" for letter in "abcdef"],
    )
    var = pd.DataFrame(index=["Actb", "Gad1", "Gapdh", "Sst"])
    x = sp.csr_matrix(
        np.array(
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
    )
    spatial = np.array([[0, 0], [10, 0], [0, 10], [10, 10], [5, 5], [20, 20]], dtype="float64")
    return ad.AnnData(X=x, obs=obs, var=var, obsm={"spatial": spatial})


def new_repository(path):
    shutil.rmtree(path, ignore_errors=True)
    repo = icechunk.Repository.create(icechunk.local_filesystem_storage(str(path)))
    return repo.writable_session("main")


def write_image(group):
    group.attrs["ome"] = {
        "version": "0.5",
        "multiscales": [
            {
                "axes": [
                    {"name": "c", "type": "channel"},
                    {"name": "y", "type": "space", "unit": "micrometer"},
                    {"name": "x", "type": "space", "unit": "micrometer"},
                ],
                "datasets": [
                    {"path": "0", "coordinateTransformations": [{"type": "scale", "scale": [1, 0.5, 0.5]}]}
                ],
            }
        ],
    }
    level = group.create_array("0", shape=(1, 8, 8), chunks=(1, 4, 4), dtype="uint8", dimension_names=["c", "y", "x"])
    level[:] = np.arange(64, dtype="uint8").reshape(1, 8, 8) * 4


def main():
    adata = tiny_anndata()
    h5ad = HERE / "tiny.h5ad"
    adata.write_h5ad(h5ad, compression="gzip")
    shutil.rmtree(HERE / "tiny.h5ad.icechunk", ignore_errors=True)
    subprocess.run(
        [sys.executable, str(SCRIPT), "--icechunk", "--url", "https://example.test/tiny.h5ad", str(h5ad)],
        check=True,
    )

    session = new_repository(HERE / "anndata.icechunk")
    ad.settings.zarr_write_format = 3
    # Icechunk has no consolidated metadata; its snapshot lists every node.
    adata.write_zarr(session.store, consolidate_metadata=False)
    session.commit("AnnData fixture")

    session = new_repository(HERE / "image.icechunk")
    write_image(zarr.open_group(session.store, mode="w", zarr_format=3))
    session.commit("OME-Zarr image fixture")

    session = new_repository(HERE / "spatialdata.icechunk")
    root = zarr.open_group(session.store, mode="w", zarr_format=3)
    root.attrs["spatialdata_attrs"] = {"version": "0.2"}
    write_image(root.require_group("images").require_group("image"))
    table_attrs = {"region": "image", "region_key": "region", "instance_key": "cell_id"}
    table = adata.copy()
    table.uns["spatialdata_attrs"] = table_attrs
    ad.io.write_elem(root.require_group("tables"), "table", table)
    root["tables/table"].attrs["spatialdata_attrs"] = table_attrs
    session.commit("SpatialData fixture")


if __name__ == "__main__":
    main()
