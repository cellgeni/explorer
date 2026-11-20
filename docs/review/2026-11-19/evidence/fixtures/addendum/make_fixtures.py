"""Review fixtures for the 2026-11-20 addendum (sections of one table).

Written with anndata, independent of the viewer. Two 6-cell x 3-gene tables
with three registered sections, differing only in how obs `section` is
stored:

- sections-int.h5ad: `section` holds whole numbers (1, 2, 3), which anndata
  writes as a plain numeric array.
- sections-str.h5ad: `section` holds strings ("s1", "s2", "s3"), which
  anndata writes as a categorical.

Both have obs `z_um` (0, 10, 20 by section), a two-value categorical
`cell_type`, and a two-column obsm `spatial`. expected.json records each
column's on-disk encoding-type, read back with h5py.

- cells3d.h5ad: 3,000 cells x 3 genes whose obsm `spatial` has a third
  column (z from 0 to 100), for the 3D cell view in the browser
  (evidence/addendum/cell-view-contexts.add.mjs).

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "anndata>=0.12" \
        python docs/review/2026-11-19/evidence/fixtures/addendum/make_fixtures.py
"""

import json
from importlib.metadata import version
from pathlib import Path

import anndata as ad
import h5py
import numpy as np
import pandas as pd
import scipy.sparse as sp

OUT = Path(__file__).parent


def table(section):
    obs = pd.DataFrame(
        {
            "section": section,
            "z_um": np.array([0.0, 0.0, 10.0, 10.0, 20.0, 20.0]),
            "cell_type": ["a", "b", "a", "b", "a", "b"],
        },
        index=[f"cell-{i}" for i in range(6)],
    )
    X = sp.csr_matrix(np.arange(18, dtype=np.float32).reshape(6, 3))
    adata = ad.AnnData(X=X, obs=obs, var=pd.DataFrame(index=["g1", "g2", "g3"]))
    adata.obsm["spatial"] = np.array(
        [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], dtype=np.float64
    )
    return adata


expected = {}
for name, section in {
    "sections-int": np.array([1, 1, 2, 2, 3, 3], dtype=np.int64),
    "sections-str": ["s1", "s1", "s2", "s2", "s3", "s3"],
}.items():
    path = OUT / f"{name}.h5ad"
    table(section).write_h5ad(path)
    with h5py.File(path, "r") as f:
        expected[name] = {
            key: f["obs"][key].attrs["encoding-type"]
            for key in ("section", "z_um", "cell_type")
        }
    expected[name]["anndata"] = version("anndata")

rng = np.random.default_rng(20261120)
cells = 3000
section = np.repeat(np.arange(3), cells // 3)
cells3d = ad.AnnData(
    X=sp.random(cells, 3, density=0.3, format="csr", dtype=np.float32, random_state=rng),
    obs=pd.DataFrame(
        {"section": pd.Categorical([f"s{i}" for i in section])},
        index=[f"cell-{i}" for i in range(cells)],
    ),
    var=pd.DataFrame(index=["g1", "g2", "g3"]),
)
cells3d.obsm["spatial"] = np.column_stack(
    [rng.uniform(0, 1000, cells), rng.uniform(0, 1000, cells), section * 50 + rng.uniform(0, 1, cells)]
)
cells3d.write_h5ad(OUT / "cells3d.h5ad")

(OUT / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")
print(json.dumps(expected, indent=2))
