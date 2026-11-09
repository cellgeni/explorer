# Image Sources (Image-Only Modality And Image Pipeline)

This page covers two things:

- The **image-only** modality: a direct OME-TIFF, TIFF, QPTIFF, NDPI, or
  OME-Zarr URL loaded without any omics tables.
- The shared **image pyramid pipeline** used by every platform for morphology
  images (Xenium), SpatialData images, and custom image layers.

For usage of image-only sources and GeoJSON shapes see
[Image-only and GeoJSON](../image-only-and-geojson.md).

## Detection

`detectSpatialDataset` (`src/datasets/datasetFactory.ts`) recognizes images by
URL shape before any Xenium probe:

| URL pattern                                                                                            | Check                                                                        | Result                                                                                |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Path ends in `.zarr`, `.ome.zarr`, `/zarr.json`, or `/.zattrs` (`isOmeZarrImageUrl`)                   | `HEAD` on the root's `zarr.json` and/or `.zattrs`                            | SpatialData if the root has `spatialdata_attrs`, else image (`imageKind: 'ome-zarr'`) |
| Ends in `.tif`, `.tiff`, `.ome.tif`, `.ome.tiff`, `.qptiff`, `.qptif`, or `.ndpi` (query/hash allowed) | One `HEAD` on the URL                                                        | Image (`imageKind: 'tiff'`, `'qptiff'`, or `'ndpi'`)                                  |
| Any other folder URL                                                                                   | After the `experiment.xenium` probe fails, `HEAD` on `zarr.json` / `.zattrs` | SpatialData, or image pointing at that metadata file                                  |

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
`morphologyImageFromPyramidLoader` and, unless a shared URL restores a channel
list, turns on the first six channels (`MAX_DEFAULT_ENABLED_CHANNELS` in
`src/features/morphology/morphologyChannels.ts`), which is every channel of
most images. It then queues auto-contrast (see [Auto-Contrast](#auto-contrast)).

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
   `#ifd=N` hash selects the base IFD. `.qptiff` and `.qptif` URLs go to the
   [QPTIFF](#qptiff) reader instead.
2. Reads OME-XML from IFD 0's `ImageDescription` (`parseOmeTiffMetadata`,
   `src/tiff/omeMetadata.ts`). A `PerkinElmer-QPI-ImageDescription` there
   sends the file to the QPTIFF reader.
3. Tries a `.zchunkstore` sidecar (`src/tiff/zchunkStore.ts`) for precomputed
   tile offsets. A sidecar named by the dataset manifest
   (`files.morphologyZchunkstore`, or `files.zchunkstore` for `image`) is the
   only one tried. Otherwise it requests `<file>.zchunkstore`,
   `<parent>/.zchunkstore` for `morphology*` files and for files of a
   multi-file OME-TIFF, and `<root>/.zchunkstore` for `morphology_focus/`
   paths, and uses the first found in that order.
   A sidecar is used only if its level 0 width, height, and tile size match
   the selected IFD and it lists every tile of the channel. Otherwise it
   indexes the TIFF itself, the usual path; a sidecar that was named or found
   but cannot be used adds a fallback notice. Either way, tiles are decoded
   with the selected IFD's `Compression`, `Predictor`, and related tags.
   See [TIFF tile-offset sidecars](../zchunkstore.md) for the format and how
   to generate one.
4. Builds levels: level 0 is the selected IFD; levels 1…n are its `SubIFDs`.
   Tile offsets come from `TileOffsets`/`TileByteCounts`.

The parsed file (header and IFD chain) is shared by loaders of the same file,
for the 4 most recently opened files, so opening another channel IFD or z plane
reads only the IFDs not yet walked. A file whose open fails is opened afresh
next time.

### Z-Stacks

An OME-TIFF with `SizeZ > 1` is a z-stack when the OME-XML locates every
channel's plane at each z for `t = 0` (`parseOmeTiffMetadata`):

- Planes are numbered in `DimensionOrder`, first letter after `XY` fastest.
- A `TiffData` stores `PlaneCount` planes from its `FirstC`/`FirstZ`/`FirstT`
  position in consecutive IFDs from `IFD` (default 0), in its `UUID@FileName`
  file or this one. `PlaneCount` defaults to 1 when `IFD` is given and to every
  remaining plane otherwise, so Xenium and Atera's `<TiffData PlaneCount="13"/>`
  maps z to IFD z.
- Without any `TiffData`, plane N is IFD N.

Each channel gets `zPlanes` (IFD and file per z) and the loader gets
`zStack` (`sizeZ`, and `micrometersPerPlane` from `PhysicalSizeZ`).
`createMorphologyImage` (`src/data/morphologyImage.ts`) opens the channels at
the middle plane, or the shared link's `z`, as `#ifd=N` loaders (or
`<file>#ifd=N` for multi-file stacks). `MorphologyImage.zStack.openPlane`
opens another plane; it keeps the channel loaders of the 8 most recent planes.
`useMorphologyZPlaneWorkflow` (`src/features/morphology/`) runs the `Z plane`
slider: the latest request wins, and channel colours and contrast windows carry
over (press `Auto` to fit the new plane). Each plane is read like a 2D image,
so each needs its own `SubIFDs` pyramid; a `.zchunkstore` for a single-channel
stack lists planes on its channel axis.

### Requirements

- **Tiled, with SubIFD pyramids.** Pyramids stored as additional top-level
  IFDs are not read (QPTIFF excepted), so such files render at full resolution
  only. Stripped TIFFs (`StripOffsets`) are not indexed: the file opens but no
  tiles load. Most NDPI files fall in one of these cases; convert them to
  pyramidal OME-TIFF.
- **8- or 16-bit samples**, 1, 3, or 4 samples per pixel. Float images fail.
- **Byte ranges.** Each tile is a `Range` `GET` that must return `206`.

### OME-XML

| Field                                          | Use                                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Pixels@PhysicalSizeX` (+ unit)                | µm/px; `PhysicalSizeY` is ignored. Without OME-XML the default is 0.2125 (the Xenium pixel size). TIFF resolution tags are ignored. |
| `Pixels@Type`                                  | Default contrast window (uint8 0–255, uint16 0–65535, float 0–1)                                                                    |
| `Channel@Name`, MapAnnotation `Purpose`        | Channel name                                                                                                                        |
| `Channel@Color`                                | Channel colour as signed 32-bit RGBA (alpha ignored); without it, keyword defaults (DAPI, boundary, RNA, protein) or a palette      |
| `TiffData` `FirstC`/`IFD`/`UUID@FileName`      | Per-channel IFD (`#ifd=N`) or sibling file (Xenium `morphology_focus_000N.ome.tif`)                                                 |
| `SizeZ`, `DimensionOrder`, `TiffData` `FirstZ` | Z-stack planes per channel (see [Z-Stacks](#z-stacks))                                                                              |
| `PhysicalSizeZ` (+ unit)                       | Depth shown beside the `Z plane` slider                                                                                             |
| `SamplesPerPixel ≥ 3` or `Interleaved="true"`  | Native RGB, drawn without colour or window                                                                                          |

### QPTIFF

Akoya PhenoCycler, PhenoImager, and Vectra scanners write QPTIFF, a BigTIFF in
which every image is a top-level IFD: one full-resolution IFD per channel, a
thumbnail, each pyramid level as one reduced-resolution IFD per channel, then
the slide overview and label. `openQptiff` (`src/tiff/loader.ts`) reads it
using the layout rules in `src/tiff/qptiff.ts`:

- **IFD walk.** Each loader needs IFDs from the whole chain, so the chain is
  read once per file and shared by every channel loader of the two most
  recently opened QPTIFFs. Akoya writes the IFDs together at the start of the
  file, so the walk reads through a geotiff block cache (1 MiB blocks, at most
  16 kept) instead of one request per IFD: the 61-channel, 81 GB PhenoCycler
  scan below opens with 8 range requests (8.4 MB) instead of 370.
- **Layout.** Channels are the leading IFDs the size of the first, with
  `ImageType` `FullResolution`. Each pyramid level is a later run of
  `ReducedResolution` IFDs with one IFD per channel; without QPI descriptions,
  `NewSubfileType` bit 0 marks reduced IFDs. A level that is stripped, has
  another tile size, or has the wrong IFD count is skipped. Akoya's smallest
  level is stripped, so the coarsest level shown is the one above it.
  Thumbnail, overview, and label images are not shown.
- **Channels.** Each channel's `ImageDescription` gives its name (`Biomarker`,
  or the fluorophore `Name` when the biomarker is empty or `--`) and colour
  (`Color` as `R,G,B`). Repeated names get ` (2)`, ` (3)`, and so on. A
  three-sample image is native RGB. Channel N opens as `#ifd=<its IFD>`.
- **Pixel size.** The first IFD's `XResolution` in `ResolutionUnit`
  (centimetre or inch). Without them, 0.2125 µm/px.
- **Tile offsets.** A channel's `TileOffsets` and `TileByteCounts` are read
  when its first tile is fetched, so channels that stay off use no memory.
- `.zchunkstore` sidecars are not used. A sidecar named by the dataset
  manifest for a QPTIFF adds a fallback notice.

Checked against
`https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/788/S-BIAD3788/Files/PostXeniumAkoya/MH_BCN_skin_X0072771_post-Xenium_Scan1.er.qptiff`
(PhenoCycler-Fusion 2.3.1; 61 channels of 24,960 × 48,960 16-bit LZW, 512 px
tiles, five levels shown, 0.505 µm/px).

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
- `TileRequestScheduler` (`src/tiff/tileRequestScheduler.ts`) loads the tiles
  in view, nearest first. When the view moves, tiles still in view keep
  loading and only those that left it are cancelled.

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
- Tile size is the x/y chunk shape (default 256). Chunks larger than 512 pixels
  are served as several virtual tiles of at most 512 pixels that share one
  decoded chunk.
- `omero.channels` gives names, `RRGGBB` colours, and windows (`start`/`end`,
  else `min`/`max`). Channels after the first open as `#c=N` loaders.
- Three channels with no omero data, or labelled/coloured R, G, B, are treated
  as native RGB.
- Chunk bytes are fetched on the main thread. Decoding and RGBA conversion run
  in the Zarr decode worker pool (`src/workers/zarrDecodePool.ts`, up to
  `min(3, hardwareConcurrency − 1)` workers). Each chunk is routed to one
  worker, which keeps it for all of its virtual tiles. If a worker fails, the
  tile is decoded on the main thread with `zarr.get`, through a 256 MiB
  decoded-chunk cache. Store errors (for example a `403` chunk) are not retried.
  No IndexedDB cache is used.

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

An image with more than six channels auto-contrasts only the channels that are
on when it loads. Any other channel is auto-contrasted when it is first turned
on, if it still has its pixel type's default window and no histogram; native
RGB channels are left alone.

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

| Constant                   | Value                                              | File                                     |
| -------------------------- | -------------------------------------------------- | ---------------------------------------- |
| Default µm/px              | 0.2125 (TIFF), 1 (Zarr)                            | `omeMetadata.ts`, `omeZarrLoader.ts`     |
| Default tile size          | 256                                                | `loader.ts`, `omeZarrLoader.ts`          |
| Level threshold            | 1.5 screen px per source px                        | `loader.ts`, `omeZarrLoader.ts`          |
| Decode workers             | TIFF ≤ 4; OME-Zarr ≤ 3                             | `tileDecodePool.ts`, `zarrDecodePool.ts` |
| Tile cache / concurrency   | compact 72 / 2, balanced 120 / 4, expanded 180 / 6 | `src/data/performanceBudget.ts`          |
| Auto-contrast              | 0.5 / 99.8 percentiles, 250,000 samples, 32 bins   | `morphologyContrast.ts`                  |
| IndexedDB byte-range cache | 256 MiB, 20,000 entries, 8 MiB per entry           | `persistentByteRangeCache.ts`            |

## Source Files

| File                                                                                                      | Role                                                                   |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/datasets/imageOnlyDataset.ts`                                                                        | Image-only `SpatialDataset`                                            |
| `src/data/imagePyramid.ts`                                                                                | `ImagePyramidLoader` interface                                         |
| `src/data/morphologyImage.ts`                                                                             | Image opening, per-channel loaders, custom layers, Xenium image choice |
| `src/data/morphologyContrast.ts`                                                                          | Auto-contrast                                                          |
| `src/tiff/loader.ts`, `omeMetadata.ts`, `qptiff.ts`, `zchunkStore.ts`, `tileCache.ts`, `chunkKeys.ts`     | TIFF and QPTIFF loading                                                |
| `src/codecs/tiffTile.ts`, `jpeg2000.ts`                                                                   | Tile decoding                                                          |
| `src/workers/tileDecode.worker.ts`, `tileDecodePool.ts`, `tileDecodeMessages.ts`                          | Decode workers                                                         |
| `src/zarr/omeZarrLoader.ts`, `zarrStores.ts`                                                              | OME-Zarr loading                                                       |
| `src/workers/zarrDecode.worker.ts`, `zarrDecodePool.ts`, `zarrDecodeCore.ts`                              | OME-Zarr chunk decoding and label tracing                              |
| `src/components/MorphologyCanvas.tsx`, `src/rendering/morphologyCanvas.ts`, `morphologyTileScheduling.ts` | Drawing and scheduling                                                 |
| `src/features/morphology/*`                                                                               | Channel controls and custom layers                                     |
| `src/features/annotations/geometricAnnotationModel.ts`                                                    | GeoJSON shapes (image-only ROI output)                                 |

## Known Limitations

- Top-level-IFD pyramids and stripped TIFFs are not supported.
- TIFFs without a `.zchunkstore` make one extra request per candidate sidecar
  URL before reading the TIFF's own offsets.
- A `.zchunkstore` is checked only against the TIFF's level 0 width, height,
  and tile size, and for a complete tile list. A stale sidecar with the same
  sizes, or a root sidecar for the focus images picked up by a same-sized
  `morphology.ome.tif`, fetches the wrong bytes.
- Only `t = 0`, `z = 0` of OME-Zarr images is shown, and only `t = 0` of
  OME-TIFFs.
- Custom image layers open a z-stack at its middle plane but have no `Z plane`
  control.
- Switching to a plane not opened recently reads its IFD, `SubIFDs`, and tile
  offset arrays (a few sequential range requests) before its tiles load.
- QPTIFF: the stripped smallest pyramid level is not shown. A QPTIFF whose
  IFDs are spread through the file, rather than together at the start, costs
  one 1 MiB block per IFD to open. Float (unmixed component) QPTIFFs fail like
  other float images.
