import json
import math
from itertools import product
from pathlib import Path

import numpy as np
import tifffile

ZARR_FORMAT = 3
ZARR_JSON = "zarr.json"

def zarr_endian(tiff, dtype):
    dtype = np.dtype(dtype)

    if dtype.itemsize == 1 or dtype.byteorder == "|":
        return "little"
    if dtype.byteorder == "<":
        return "little"
    if dtype.byteorder == ">":
        return "big"

    return "little" if tiff.byteorder == "<" else "big"


def create_arr_meta(tiff, level):
    first_page = level[0].aspage()
    compression = first_page.compression.name

    if compression == "ADOBE_DEFLATE":
        codecs = [
            {
                "name": "bytes",
                "configuration": {
                    "endian": zarr_endian(tiff, level.dtype),
                },
            },
            {
                "name": "numcodecs.zlib",
                "configuration": {
                    "level": 6,
                },
            },
        ]

    elif compression == "JPEG2000":
        codecs = [
            {
                # Requires a reader/plugin that understands this codec.
                # For example, a JPEG2000-capable Zarr codec backed by imagecodecs.
                "name": "imagecodecs_jpeg2k",
                "configuration": {},
            }
        ]

    else:
        raise ValueError(f"Compression {compression} not supported.")

    return {
        "zarr_format": ZARR_FORMAT,
        "node_type": "array",
        "shape": [int(x) for x in level.shape],
        "data_type": np.dtype(level.dtype).name,
        "chunk_grid": {
            "name": "regular",
            "configuration": {
                # Assumes 3D array: z, y, x
                "chunk_shape": [
                    int(first_page.tiledepth or 1),
                    int(first_page.tilelength),
                    int(first_page.tilewidth),
                ]
            },
        },
        "chunk_key_encoding": {
            "name": "default",
            "configuration": {
                "separator": "/",
            },
        },
        "codecs": codecs,
        "fill_value": 0,
        "attributes": {},
    }


def create_root_meta(nlevels):
    datasets = [{"path": str(i)} for i in range(nlevels)]

    return {
        "zarr_format": ZARR_FORMAT,
        "node_type": "group",
        "attributes": {
            "multiscales": [
                {
                    "datasets": datasets,
                    "version": "0.1",
                }
            ]
        },
    }


if __name__ == "__main__":
    project_dir = Path("/nfs/team172_spatial_genomics_imaging/2024_Requests/SGP190 Xenium 5K Fetal brain LEAP")
    run_dir = project_dir / "20240829__110301__SGP190_FBRA_run1"
    roi_path = run_dir / "output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328"
    morphology_focus = roi_path / "morphology_focus/morphology_focus_0000.ome.tif"

    offsets = {}

    with tifffile.TiffFile(morphology_focus, mode="r") as tiff:

        levels = tiff.series[0].levels
        offsets[ZARR_JSON] = {
            "zarr_format": ZARR_FORMAT,
            "node_type": "group",
            "attributes": {
                "multiscales": [
                    {
                        "datasets": [{"path": str(i)} for i in range(len(levels))],
                        "version": "0.1",
                    }
                ]
            },
        }

        for i in range(len(levels)):
            level = levels[i]
            offsets[f"{i}/{ZARR_JSON}"] = create_arr_meta(tiff, level)

            for z, page in enumerate(level):
                page = page.aspage()
                size_y, size_x = page.shape
                chunks_y = math.ceil(size_y / page.tilelength)
                chunks_x = math.ceil(size_x / page.tilewidth)

                for cy, cx in product(range(chunks_y), range(chunks_x)):
                    cindex = cy * chunks_x + cx
                    offsets[f"{i}/c/{z}/{cy}/{cx}"] = {
                        "offset": int(page.dataoffsets[cindex]),
                        "size": int(page.databytecounts[cindex]),
                    }

    outfile = roi_path.name + ".zchunkstore"

    with open(outfile, "w") as f:
        json.dump(offsets, f)

    print(f"Wrote {outfile}")
