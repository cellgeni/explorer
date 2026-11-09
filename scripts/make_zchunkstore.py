"""Write a `.zchunkstore` tile-offset sidecar for a tiled, pyramidal OME-TIFF.

The sidecar is a JSON object that describes the TIFF as a Zarr v3 multiscale
group. Array metadata sits under `zarr.json` and `<level>/zarr.json`, and each
chunk key `<level>/c/<channel>/<row>/<col>` maps to the byte range of that tile
in the TIFF: `{"offset": ..., "size": ...}`. The viewer reads the sidecar in
one request instead of walking the TIFF's IFDs and SubIFDs with many small
Range reads. See docs/zchunkstore.md.

Usage:
    python scripts/make_zchunkstore.py morphology_focus/morphology_focus_0000.ome.tif

Requires: pip install tifffile numpy
"""

import argparse
import json
import math
import sys
from itertools import product
from pathlib import Path

import numpy as np
import tifffile

ZARR_FORMAT = 3
ZARR_JSON = "zarr.json"

# imagecodecs codec names by TIFF Compression code, as in tifffile's fsspec
# export. The viewer ignores them: it decodes tiles with the TIFF's own
# Compression, Predictor, and JPEGTables tags.
TIFF_CODECS = {
    5: "imagecodecs_lzw",
    7: "imagecodecs_jpeg",
    8: "imagecodecs_zlib",
    32773: "imagecodecs_packbits",
    32946: "imagecodecs_zlib",
    33003: "imagecodecs_jpeg2k",
    33004: "imagecodecs_jpeg2k",
    33005: "imagecodecs_jpeg2k",
    34712: "imagecodecs_jpeg2k",
    34887: "imagecodecs_lerc",
    50000: "imagecodecs_zstd",
    50001: "imagecodecs_webp",
}


def check_series(series):
    keyframe = series.keyframe

    if not keyframe.is_tiled:
        raise ValueError("The TIFF is not tiled; convert it to a tiled pyramidal OME-TIFF.")
    if keyframe.samplesperpixel != 1:
        raise ValueError("Only one sample per pixel is supported (no RGB).")
    if len(series.shape) not in (2, 3):
        raise ValueError(f"Expected a (Y, X) or (C, Y, X) series, got axes {series.axes}.")


def level_shape(level):
    # A single-channel series is (Y, X); give it a channel axis so the shape,
    # the chunk shape, and the `c/<channel>/<row>/<col>` keys all have 3 axes.
    shape = [int(x) for x in level.shape]
    return [1, *shape] if len(shape) == 2 else shape


def create_arr_meta(level):
    keyframe = level.keyframe

    return {
        "zarr_format": ZARR_FORMAT,
        "node_type": "array",
        "shape": level_shape(level),
        "data_type": np.dtype(level.dtype).name,
        "chunk_grid": {
            "name": "regular",
            "configuration": {
                "chunk_shape": [1, int(keyframe.tilelength), int(keyframe.tilewidth)],
            },
        },
        "chunk_key_encoding": {
            "name": "default",
            "configuration": {
                "separator": "/",
            },
        },
        "codecs": create_codecs(keyframe.compression),
        "fill_value": 0,
        "attributes": {},
    }


def create_codecs(compression):
    # Requires a reader that understands this codec, such as imagecodecs'
    # numcodecs plugin. Uncompressed and unlisted codes get no codec entry.
    name = TIFF_CODECS.get(int(compression))
    return [] if name is None else [{"name": name, "configuration": {}}]


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


def chunk_offsets(level_index, level):
    offsets = {}
    keyframe = level.keyframe
    _, size_y, size_x = level_shape(level)
    chunks_y = math.ceil(size_y / keyframe.tilelength)
    chunks_x = math.ceil(size_x / keyframe.tilewidth)

    # Each page is one channel. In a multi-file OME-TIFF (Xenium
    # morphology_focus_000N.ome.tif) page N lives in file N, so its offsets
    # are positions in that file.
    for channel, page in enumerate(level.pages):
        if page is None:
            raise ValueError(
                f"Level {level_index} channel {channel} is missing; keep every file "
                "of a multi-file OME-TIFF in the same folder."
            )
        if len(page.dataoffsets) != chunks_y * chunks_x:
            raise ValueError(f"Level {level_index} channel {channel} has an unexpected tile count.")

        # TIFF tiles are stored row-major.
        for cy, cx in product(range(chunks_y), range(chunks_x)):
            cindex = cy * chunks_x + cx
            offsets[f"{level_index}/c/{channel}/{cy}/{cx}"] = {
                "offset": int(page.dataoffsets[cindex]),
                "size": int(page.databytecounts[cindex]),
            }

    return offsets


def build_chunk_store(tiff_path):
    with tifffile.TiffFile(tiff_path, mode="r") as tiff:
        series = tiff.series[0]
        check_series(series)
        levels = series.levels
        store = {ZARR_JSON: create_root_meta(len(levels))}

        for i, level in enumerate(levels):
            store[f"{i}/{ZARR_JSON}"] = create_arr_meta(level)
            store.update(chunk_offsets(i, level))

        files = {page.parent.filehandle.path for page in series.pages if page is not None}

    return store, len(files)


def default_output(tiff_path, nfiles):
    # A multi-file series covers every file in its folder, so it gets a
    # folder-level sidecar; a single file gets `<file>.zchunkstore`.
    if nfiles > 1:
        return tiff_path.parent / ".zchunkstore"
    return tiff_path.with_name(tiff_path.name + ".zchunkstore")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("tiff", type=Path, help="OME-TIFF to index (for Xenium focus images, file _0000)")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output path (default: <folder>/.zchunkstore for multi-file OME-TIFFs, else <tiff>.zchunkstore)",
    )
    args = parser.parse_args(argv)

    try:
        store, nfiles = build_chunk_store(args.tiff)
    except ValueError as error:
        sys.exit(f"{args.tiff}: {error}")

    outfile = args.output or default_output(args.tiff, nfiles)

    with open(outfile, "w") as f:
        json.dump(store, f)

    nchunks = sum(1 for key in store if "/c/" in key)
    print(f"Wrote {outfile} ({nchunks} chunks from {nfiles} file(s))")


if __name__ == "__main__":
    main()
