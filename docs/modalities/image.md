# Image Sources (Image-Only Modality And Image Pipeline)

This page covers two things:

- The **image-only** modality: a direct OME-TIFF, TIFF, NDPI, or OME-Zarr URL
  loaded without any omics tables.
- The shared **image pyramid pipeline** used by every platform for morphology
  images (Xenium), SpatialData images, and custom image layers.

For usage of image-only sources and GeoJSON shapes see
[Image-only and GeoJSON](../image-only-and-geojson.md).

## Detection

`detectSpatialDataset` (`src/datasets/datasetFactory.ts`) recognizes images by
URL shape before any Xenium probe:

| URL pattern                                                                          | Check                                                                        | Result                                                                                |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Path ends in `.zarr`, `.ome.zarr`, `/zarr.json`, or `/.zattrs` (`isOmeZarrImageUrl`) | `HEAD` on the root's `zarr.json` and/or `.zattrs`                            | SpatialData if the root has `spatialdata_attrs`, else image (`imageKind: 'ome-zarr'`) |
| Ends in `.tif`, `.tiff`, `.ome.tif`, `.ome.tiff`, or `.ndpi` (query/hash allowed)    | One `HEAD` on the URL                                                        | Image (`imageKind: 'tiff'` or `'ndpi'`)                                               |
| Any other folder URL                                                                 | After the `experiment.xenium` probe fails, `HEAD` on `zarr.json` / `.zattrs` | SpatialData, or image pointing at that metadata file                                  |

`omeZarrImageRootUrl` strips a trailing `/zarr.json` or `/.zattrs` to find the
store root. `createSpatialDataset` builds an `ImageOnlyDataset`
(`src/datasets/imageOnlyDataset.ts`). There is no NDPI-specific code: NDPI
files go through the TIFF loader.

## ImageOnlyDataset

- `meta()`: platform `image`; units from the loader; extent from `0` to image
  width/height × µm/px; capabilities `pyramidImage: true`,
  `multiChannel` when there is more than one channel.
- `image()` returns `{ kind: 'pyramid', loader }`.
- `elements()`, `matrix()`, and `annotations()` return nothing.

The lifecycle opens per-channel loaders with
`morphologyImageFromPyramidLoader`, enables every channel (unless a shared URL
restores a channel list), and queues auto-contrast for all channels.

`IMAGE_PLATFORM_ADAPTER` (`src/features/app-shell/platformAdapter.ts`) hides
Genes, Transcripts, Magic Lens, and Cell, disables cell-id annotations, and
switches the ROI tab to the `Geometry` panel, which saves drawn shapes as
GeoJSON annotations.

## ImagePyramidLoader

All images implement `ImagePyramidLoader` (`src/data/imagePyramid.ts`):
`url`, `units`, tile size, `numLevels`, image size, `channels`, plus
`bestLevel`, `tilesForBbox`, `tilesForLevel`, `tileBounds`, and
`tileSourceSize`. TIFF loaders add `fetchTileBytes`/`tileDecodeOptions`;
Zarr loaders add `loadTile`/`loadTilePixels`.

`openImagePyramid` (`src/data/morphologyImage.ts`) sends Zarr-looking URLs to
`openOmeZarrImage` and everything else to `openTiff`.

## OME-TIFF / TIFF / NDPI

`openTiff` (`src/tiff/loader.ts`):

1. Opens the file with `geotiff` `fromUrl(url, { allowFullFile: false })`. A
   `#ifd=N` hash selects the base IFD.
2. Reads OME-XML from IFD 0's `ImageDescription` (`parseOmeTiffMetadata`,
   `src/tiff/omeMetadata.ts`).
3. Tries a `.zchunkstore` sidecar (`src/tiff/zchunkStore.ts`) for precomputed
   tile offsets: `<root>/.zchunkstore` for `morphology_focus/` paths,
   `<parent>/.zchunkstore` for `morphology*` files, then `<file>.zchunkstore`.
   If none is found, it logs a fallback notice and indexes the TIFF itself.
4. Builds levels: level 0 is the selected IFD; levels 1…n are its `SubIFDs`.
   Tile offsets come from `TileOffsets`/`TileByteCounts`.

### Requirements

- **Tiled, with SubIFD pyramids.** Pyramids stored as additional top-level
  IFDs are not read, so such files render at full resolution only. Stripped
  TIFFs (`StripOffsets`) are not indexed: the file opens but no tiles load.
  Most NDPI files fall in one of these cases; convert them to pyramidal
  OME-TIFF.
- **8- or 16-bit samples**, 1, 3, or 4 samples per pixel. Float images fail.
- **Byte ranges.** Each tile is a `Range` `GET` that must return `206`.

### OME-XML

| Field                                         | Use                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Pixels@PhysicalSizeX` (+ unit)               | µm/px; `PhysicalSizeY` is ignored. Without OME-XML the default is 0.2125 (the Xenium pixel size). TIFF resolution tags are ignored.  |
| `Pixels@Type`                                 | Default contrast window (uint8 0–255, uint16 0–65535, float 0–1)                                                                     |
| `Channel@Name`, MapAnnotation `Purpose`       | Channel name                                                                                                                         |
| `Channel@Color`                               | Channel colour as signed 32-bit RGBA (alpha ignored); without it, keyword defaults (DAPI, boundary, RNA, protein) or a palette       |
| `TiffData` `FirstC`/`IFD`/`UUID@FileName`     | Per-channel IFD (`#ifd=N`) or sibling file (Xenium `morphology_focus_000N.ome.tif`)                                                  |
| `SamplesPerPixel ≥ 3` or `Interleaved="true"` | Native RGB, drawn without colour or window                                                                                           |

### Codecs

`decodeTiffTilePixels` (`src/codecs/tiffTile.ts`):

| Compression                                                           | Decoder                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 33003/33004/33005/34712 (JPEG 2000), or no Compression tag            | OpenJPEG WASM (`@cornerstonejs/codec-openjpeg`, `src/codecs/jpeg2000.ts`) |
| 1 (none)                                                              | Copy                                                                      |
| 5 (LZW, predictor 1)                                                  | Built-in decoder                                                          |
| Other (LZW with predictor, JPEG, Deflate, PackBits, LERC, Zstd, WebP) | `geotiff` `getDecoder`                                                    |

JPEG-XR is not supported.

### Fetching And Decoding

- Tile bytes go through the IndexedDB byte-range cache (namespace `tiff-tile`,
  `src/data/persistentByteRangeCache.ts`).
- Decoding runs in `TileDecodeWorkerPool` (`src/workers/tileDecodePool.ts`,
  up to `min(4, hardwareConcurrency)` workers). The worker decodes, applies the
  channel window and colour (`normaliseToRgba`), and returns an `ImageBitmap`.
- `TileCache` (`src/tiff/tileCache.ts`) is an LRU of decoded bitmaps keyed by
  `level:col:row`.

## OME-Zarr

`openOmeZarrImage` (`src/zarr/omeZarrLoader.ts`):

- Opens Zarr v2 or v3 with `zarrita`, using consolidated metadata when present
  (`src/zarr/zarrStores.ts`). Metadata-key `403`s are treated as missing.
- Reads `multiscales[0]` from `attrs.ome` (OME-Zarr 0.5) or `attrs`. Each
  `datasets[].path` is a level.
- Axes come from `axes`, else array dimension names, else positional
  `…, c, y, x`. `x` and `y` are required; `t` and `z` are fixed at index 0.
- µm/px is the product of multiscale and dataset `scale` values for x, with
  unit conversion (nm, µm, mm, m). Unknown units count as µm; a missing scale
  gives 1 µm/px. `translation` is ignored except for SpatialData placement.
- Tile size is the x/y chunk shape (default 256).
- `omero.channels` gives names, `RRGGBB` colours, and windows (`start`/`end`,
  else `min`/`max`). Channels after the first open as `#c=N` loaders.
- Three channels with no omero data, or labelled/coloured R, G, B, are treated
  as native RGB.
- Chunks are read with `zarr.get` and converted to RGBA on the main thread; no
  worker or IndexedDB cache is used.

## Rendering

`MorphologyCanvas` (`src/components/MorphologyCanvas.tsx`) draws images on a
2D canvas under the deck.gl layers:

- **Level choice.** `bestLevel` returns the coarsest level whose source pixel
  is at most 1.5 screen pixels.
- **Scheduling.** For each enabled channel, tiles intersecting the viewport
  plus a 256-screen-pixel margin are requested nearest-centre first
  (`selectCenteredTiles`, `src/rendering/morphologyCanvas.ts`). Concurrency is
  `maxConcurrentTileRequests` from the performance budget divided across
  channels. Large uncompressed or LZW tiles (≥ 512 × 512) use a reduced "heavy"
  schedule (`src/rendering/morphologyTileScheduling.ts`).
- **Drawing.** While tiles load, the nearest ready level fills in. Multiple
  channels are composited additively (`lighter`) with per-channel alpha.
- **Contrast.** Changing a channel's window or colour starts a new tile cache,
  so tiles are decoded again.

### Auto-Contrast

`computeChannelAutoContrast` (`src/data/morphologyContrast.ts`) samples up to
250,000 values from the coarsest level and sets the window to the 0.5 and
99.8 percentiles, with a 32-bin histogram for the Layers tab. It runs after an
image loads and when a channel's `Auto` button is pressed. SpatialData native
RGB images skip it.

## Custom Image Layers

`Custom image URL` → `Load Layer` in the Layers tab
(`useCustomMorphologyLayerWorkflow`, `src/features/morphology/`):

- Accepts `http`/`https` OME-TIFF, TIFF, or OME-Zarr URLs; http URLs that fail
  are retried over https.
- Channels are prefixed with the layer name (the file name). A layer without
  channel metadata gets one white channel.
- Layers are saved in the share URL as repeated `customImageUrl` and
  `customImageOpacity` parameters.

## Constants

| Constant                   | Value                                              | File                                 |
| -------------------------- | -------------------------------------------------- | ------------------------------------ |
| Default µm/px              | 0.2125 (TIFF), 1 (Zarr)                            | `omeMetadata.ts`, `omeZarrLoader.ts` |
| Default tile size          | 256                                                | `loader.ts`, `omeZarrLoader.ts`      |
| Level threshold            | 1.5 screen px per source px                        | `loader.ts`, `omeZarrLoader.ts`      |
| Decode workers             | ≤ 4                                                | `tileDecodePool.ts`                  |
| Tile cache / concurrency   | compact 72 / 2, balanced 120 / 4, expanded 180 / 6 | `src/data/performanceBudget.ts`      |
| Auto-contrast              | 0.5 / 99.8 percentiles, 250,000 samples, 32 bins   | `morphologyContrast.ts`              |
| IndexedDB byte-range cache | 256 MiB, 20,000 entries, 8 MiB per entry           | `persistentByteRangeCache.ts`        |

## Source Files

| File                                                                                                      | Role                                                                   |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/datasets/imageOnlyDataset.ts`                                                                        | Image-only `SpatialDataset`                                            |
| `src/data/imagePyramid.ts`                                                                                | `ImagePyramidLoader` interface                                         |
| `src/data/morphologyImage.ts`                                                                             | Image opening, per-channel loaders, custom layers, Xenium image choice |
| `src/data/morphologyContrast.ts`                                                                          | Auto-contrast                                                          |
| `src/tiff/loader.ts`, `omeMetadata.ts`, `zchunkStore.ts`, `tileCache.ts`, `chunkKeys.ts`                  | TIFF loading                                                           |
| `src/codecs/tiffTile.ts`, `jpeg2000.ts`                                                                   | Tile decoding                                                          |
| `src/workers/tileDecode.worker.ts`, `tileDecodePool.ts`, `tileDecodeMessages.ts`                          | Decode workers                                                         |
| `src/zarr/omeZarrLoader.ts`, `zarrStores.ts`                                                              | OME-Zarr loading                                                       |
| `src/components/MorphologyCanvas.tsx`, `src/rendering/morphologyCanvas.ts`, `morphologyTileScheduling.ts` | Drawing and scheduling                                                 |
| `src/features/morphology/*`                                                                               | Channel controls and custom layers                                     |
| `src/features/annotations/geometricAnnotationModel.ts`                                                    | GeoJSON shapes (image-only ROI output)                                 |

## Known Limitations

- Top-level-IFD pyramids and stripped TIFFs are not supported.
- Generic TIFFs (no `.zchunkstore`) always add one fallback notice and an
  extra request for the sidecar.
- Only `t = 0`, `z = 0` of OME-Zarr images is shown.
