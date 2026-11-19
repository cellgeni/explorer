"""Write image_cells.zarr in this folder: a small SpatialData store for Cell
Query's image measurements (plan 26, M2).

- images/stain: a 2-channel (DAPI, CD3) uint16 image, 128 x 96 pixels in
  32 x 32 chunks, with a second level at half the size.
- shapes/cells: 6 circles of radius 4 at the centres of 24 x 24 blocks.
  Each block is one value in each channel, so any disc inside it measures
  that value at either level; the rest of the image is 0.
- tables/table: 6 cells x 2 genes annotating the circles.

Every element is in the `global` coordinate system without a transform.
spatialdata 0.9.0 writes Zarr v3: zstd chunks, chunks of zeros left out,
and a table that anndata shards, so the server must answer byte ranges.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "spatialdata==0.9.0" \
        python src/test/fixtures/spatialdata/make_image_store.py
"""

import shutil
from pathlib import Path

import anndata as ad
import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point
from spatialdata import SpatialData
from spatialdata.models import Image2DModel, ShapesModel, TableModel

HERE = Path(__file__).resolve().parent
OUT = HERE / "image_cells.zarr"

WIDTH, HEIGHT = 128, 96
CENTRES = [(28, 28), (64, 28), (100, 28), (28, 68), (64, 68), (100, 68)]
DAPI = [500, 1500, 2500, 3500, 4500, 5500]
CD3 = [4000, 1000, 4000, 1000, 4000, 1000]


def main():
    pixels = np.zeros((2, HEIGHT, WIDTH), dtype=np.uint16)
    for (x, y), dapi, cd3 in zip(CENTRES, DAPI, CD3):
        pixels[0, y - 12 : y + 12, x - 12 : x + 12] = dapi
        pixels[1, y - 12 : y + 12, x - 12 : x + 12] = cd3

    image = Image2DModel.parse(
        pixels,
        dims=("c", "y", "x"),
        c_coords=["DAPI", "CD3"],
        scale_factors=[2],
        chunks=(1, 32, 32),
    )
    circles = gpd.GeoDataFrame(
        {"radius": np.full(len(CENTRES), 4.0)},
        geometry=[Point(x, y) for x, y in CENTRES],
        index=pd.Index(range(len(CENTRES))),
    )
    shapes = ShapesModel.parse(circles)

    obs = pd.DataFrame(
        {
            "region": pd.Categorical(["cells"] * len(CENTRES)),
            "instance_id": np.arange(len(CENTRES)),
        },
        index=[f"cell-{index}" for index in range(len(CENTRES))],
    )
    table = TableModel.parse(
        ad.AnnData(
            X=np.arange(len(CENTRES) * 2, dtype=np.float32).reshape(-1, 2),
            obs=obs,
            var=pd.DataFrame(index=["GeneA", "GeneB"]),
        ),
        region="cells",
        region_key="region",
        instance_key="instance_id",
    )

    if OUT.exists():
        shutil.rmtree(OUT)
    SpatialData(
        images={"stain": image}, shapes={"cells": shapes}, tables={"table": table}
    ).write(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
