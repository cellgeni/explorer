# TIFF Tile-Offset Sidecars (`.zchunkstore`)

A `.zchunkstore` is an optional JSON file hosted next to a pyramidal OME-TIFF.
It lists the byte offset and size of every tile at every pyramid level, so the
viewer can open the image without walking the TIFF's directory structure.
[`scripts/make_zchunkstore.py`](../scripts/make_zchunkstore.py) generates one.

Xenium Onboard Analysis output does not include this file, and no dataset
needs one: without it the viewer reads the same offsets from the TIFF.

## Do You Need One?

Usually not. To fetch a tile, the viewer needs its byte range, which a TIFF
keeps in each pyramid level's `TileOffsets` and `TileByteCounts` tags.
`openTiff` (`src/tiff/loader.ts`) reads them with Range requests. For a Xenium
focus channel file (88,404 × 51,294 px, 9 levels, 5,978 tiles) that took
16 requests, 105 KiB, and 190–450 ms against the Sanger S3 endpoint, and
channel files open in parallel.

A sidecar replaces the offset reads with one `GET`, shared by every channel
file; the viewer still reads the TIFF's first directory for the OME-XML and
compression tags. It helps most on high-latency connections, where the
sequential round trips of walking the TIFF's levels add up. It works with any
compression the viewer can decode (see [Codecs](./modalities/image.md#codecs)).

## Format

The file adapts the Observable "OME-TIFF File Chunk Store" pattern: one JSON
object that describes the TIFF as an in-memory Zarr v3 multiscale group whose
chunk values are byte ranges instead of bytes.

```json
{
  "zarr.json": {
    "zarr_format": 3,
    "node_type": "group",
    "attributes": {
      "multiscales": [
        { "datasets": [{ "path": "0" }, { "path": "1" }], "version": "0.1" }
      ]
    }
  },
  "0/zarr.json": {
    "zarr_format": 3,
    "node_type": "array",
    "shape": [4, 88404, 51294],
    "data_type": "uint16",
    "chunk_grid": {
      "name": "regular",
      "configuration": { "chunk_shape": [1, 1024, 1024] }
    },
    "chunk_key_encoding": { "name": "default", "configuration": { "separator": "/" } },
    "codecs": [{ "name": "imagecodecs_jpeg2k", "configuration": {} }],
    "fill_value": 0,
    "attributes": {}
  },
  "0/c/0/0/0": { "offset": 53680, "size": 322 },
  "0/c/2/0/1": { "offset": 53917, "size": 237 },
  "8/c/3/0/0": { "offset": 2782289216, "size": 52170 }
}
```

- `<level>` is the pyramid level; `0` is full resolution.
- Array shapes are `[channels, height, width]` and chunk shapes are
  `[1, tileHeight, tileWidth]`.
- Chunk keys are `<level>/c/<channel>/<row>/<col>`. Each value is the tile's
  byte range in the TIFF that holds that channel.
- In a multi-file OME-TIFF, such as Xenium's
  `morphology_focus/morphology_focus_000N.ome.tif`, channel `N` is file `N`, so
  `0/c/2/...` offsets are positions in `morphology_focus_0002.ome.tif`. One
  sidecar covers all the files.

The viewer reads the level list, `shape`, `chunk_shape`, and chunk entries
(`zchunkStoreToPyramidOptions`, `src/tiff/zchunkStore.ts`). It ignores
`data_type`, `codecs`, and `fill_value`: it decodes the TIFF tile bytes with
the `Compression`, `Predictor`, `BitsPerSample`, `SamplesPerPixel`, and
`JPEGTables` tags of the TIFF's selected IFD (IFD 0 unless the URL has
`#ifd=N`). The script writes the `codecs` name that matches the TIFF's
compression (`imagecodecs_jpeg2k`, `imagecodecs_zlib`, `imagecodecs_lzw`, …)
for other Zarr readers. It also accepts the Zarr v2 layout (`.zattrs`,
`<level>/.zarray`, keys `<level>/<channel>.<row>.<col>`).

Before using a sidecar, `openTiff` checks it against the TIFF: its level 0
width, height, and chunk width and height must match the selected IFD, and it
must list every tile of every level for the channel being opened. Otherwise it
ignores the sidecar, reads the TIFF instead, and adds a fallback notice to the
info drawer's Data access notes. A TIFF with no sidecar at all gets no notice.

## Where The Viewer Looks

For each TIFF it opens, the viewer requests these URLs at once and uses the
first in this order, most specific first, that returns `200`
(`zchunkStoreCandidateUrls`). `404` and `403` responses are skipped, so buckets
that answer `403` for missing keys work.

| TIFF URL                                                                                                                        | Candidates, in order                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `<root>/morphology_focus/morphology_focus_000N.ome.tif`                                                                         | `<root>/morphology_focus/morphology_focus_000N.ome.tif.zchunkstore`, `<root>/morphology_focus/.zchunkstore`, `<root>/.zchunkstore` |
| `<dir>/morphology*.tif` (`morphology.ome.tif`, `morphology_mip.ome.tif`, …)                                                     | `<dir>/morphology*.tif.zchunkstore`, `<dir>/.zchunkstore`                                                                          |
| `<dir>/<file>` of a multi-file OME-TIFF (OME-XML lists channels in other files, such as Atera `morphology_2d/ch000N_*.ome.tif`) | `<dir>/<file>.zchunkstore`, `<dir>/.zchunkstore`                                                                                   |
| Any other TIFF                                                                                                                  | `<file>.zchunkstore`                                                                                                               |

Each sidecar URL, found or missing, is requested once a minute at most and
shared by every channel file that looks it up, so a 4-channel focus image
downloads and parses its folder sidecar once. Network errors are not
remembered, so the next image open retries.

A dataset manifest can name the sidecar instead (`files.morphologyZchunkstore`
for Xenium and Atera, `files.zchunkstore` for `image`; see
[Dataset manifest](./dataset-manifest.md#files)). The viewer then fetches only
that URL and skips the locations above, so the sidecar can live in another
folder or bucket, under any name. Paths resolve like other manifest paths. One
sidecar for a multi-file OME-TIFF covers every channel file, as at
`morphology_focus/.zchunkstore`.

Recommended placement:

- **Xenium focus images (XOA 2 and later):** `morphology_focus/.zchunkstore`.
  A root `<root>/.zchunkstore` also works, but it is also a candidate for
  `morphology.ome.tif` and `morphology_mip.ome.tif` at the root. If either of
  those is opened (for example as a direct image URL) and has no
  `<file>.zchunkstore` of its own, the viewer ignores the focus sidecar only
  when the level 0 size or tile size differs. When they match, it uses the
  focus offsets against the wrong file.
- **Single-file TIFFs, including `morphology.ome.tif` and
  `morphology_mip.ome.tif`:** `<file>.zchunkstore`, next to the TIFF. It is
  tried first, so it wins over any folder or root sidecar.

The script picks these names by default: `<folder>/.zchunkstore` for a
multi-file OME-TIFF and `<file>.zchunkstore` otherwise. The viewer finds both
without a manifest.

## Generating One

Requirements: Python 3 with `tifffile` and `numpy`. All files of a multi-file
OME-TIFF must be local and in the same folder, as XOA writes them; only the
TIFF headers are read, not the pixel data.

```bash
pip install tifffile numpy
```

Xenium focus images: pass file `_0000`. `tifffile` reads the OME-XML, finds the
other channel files, and indexes all of them.

```bash
python scripts/make_zchunkstore.py /data/xenium_run/morphology_focus/morphology_focus_0000.ome.tif
```

This writes `/data/xenium_run/morphology_focus/.zchunkstore`. For a single-file
OME-TIFF:

```bash
python scripts/make_zchunkstore.py /data/slide.ome.tif
```

This writes `/data/slide.ome.tif.zchunkstore`. Use `-o PATH` to write
elsewhere.

How it works:

1. Opens the TIFF with `tifffile` and takes the first series. For a multi-file
   OME-TIFF, `tifffile` builds the series across all files from the OME-XML
   `TiffData`/`UUID` entries.
2. Writes the group `zarr.json` with one `multiscales` dataset per pyramid
   level (`series.levels`, from SubIFDs).
3. For each level, writes `<level>/zarr.json` from the level shape and the TIFF
   tile size.
4. For each channel page in the level, maps tile `(row, col)` to index
   `row * columns + col` in the page's `TileOffsets`/`TileByteCounts` (TIFF
   tiles are row-major) and writes `<level>/c/<channel>/<row>/<col>`.

The script accepts any TIFF compression. The viewer decodes sidecar tiles the
same way as without a sidecar, so the compression only has to be one the viewer
can decode at all (JPEG-XR cannot be). The script refuses input the viewer
cannot use through a sidecar:

- Untiled (stripped) TIFFs.
- More than one sample per pixel (RGB).
- Series with more than three axes.

A single-channel `(Y, X)` series is written with a channel axis of 1, so its
shape is `[1, height, width]`.

## Upload And Check

Upload the sidecar next to the TIFF, for example:

```bash
aws s3 cp /data/xenium_run/morphology_focus/.zchunkstore s3://bucket/xenium_run/morphology_focus/.zchunkstore
```

The sidecar is fetched whole, so the `Range` rules do not apply to it, and
transfer compression is fine: a 1.3 MB sidecar for a 4-channel 88k × 51k focus
image gzips to about 280 KB.

To check it is used, look for a `200` response for the `.zchunkstore` URL in
the browser's network tab, and no ".zchunkstore tile-offset sidecar was
missing, unreadable, or did not match the TIFF" notice in the info drawer's
Data access notes.

## Pitfalls

- **Regenerate when the TIFF changes.** The viewer compares only the level 0
  width, height, and tile size with the TIFF, and that the sidecar lists every
  tile of the channel, and ignores a sidecar that fails either check. A stale
  sidecar with the same sizes and tiles, for example after the TIFF is
  re-encoded or rewritten, loads without errors but fetches the wrong bytes, so
  tiles fail to decode or show the wrong image.
- **A new or fixed sidecar can take a minute to be used.** The viewer
  remembers each sidecar URL, found or missing, for a minute; reload the page
  to pick up a change sooner.
- **A sidecar that cannot be parsed is ignored.** The viewer falls back to
  reading the TIFF, with the notice above.
- **Pixel size is not stored.** It still comes from the TIFF's OME-XML
  `PhysicalSizeX`.
