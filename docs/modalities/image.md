# Image Sources (Image-Only Modality And Image Pipeline)

This page covers two things:

- The **image-only** modality: a direct OME-TIFF, TIFF, QPTIFF, SVS, NDPI, or
  OME-Zarr URL loaded without any omics tables.
- The shared **image pyramid pipeline** used by every platform for morphology
  images (Xenium), SpatialData images, and custom image layers.

For usage of image-only sources and GeoJSON shapes see
[Image-only and GeoJSON](../image-only-and-geojson.md).

## Detection

`detectSpatialDataset` (`src/datasets/datasetFactory.ts`) recognizes images by
URL shape before any Xenium probe:

| URL pattern                                                                                                    | Check                                                                        | Result                                                                                |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Path ends in `.zarr`, `.ome.zarr`, `/zarr.json`, or `/.zattrs` (`isOmeZarrImageUrl`)                           | `HEAD` on the root's `zarr.json` and/or `.zattrs`                            | SpatialData if the root has `spatialdata_attrs`, else image (`imageKind: 'ome-zarr'`) |
| Ends in `.tif`, `.tiff`, `.ome.tif`, `.ome.tiff`, `.qptiff`, `.qptif`, `.svs`, or `.ndpi` (query/hash allowed) | One `HEAD` on the URL                                                        | Image (`imageKind: 'tiff'`, `'qptiff'`, `'svs'`, or `'ndpi'`)                         |
| Any other folder URL                                                                                           | After the `experiment.xenium` probe fails, `HEAD` on `zarr.json` / `.zattrs` | SpatialData, or image pointing at that metadata file                                  |
| Path ends in `.icechunk` (an [Icechunk](https://icechunk.io/) repository)                                      | Opens the repository's `repo` file and snapshot                              | AnnData, SpatialData, or, with root `multiscales`, image (`imageKind: 'ome-zarr'`)    |

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
the Cells and Transcripts sections, Magic Lens, and the cell cards, disables
cell-id annotations, and makes Box and Lasso selection open the New shape card,
which saves drawn shapes as GeoJSON annotations.

## ImagePyramidLoader

All images implement `ImagePyramidLoader` (`src/data/imagePyramid.ts`):
`url`, `units`, tile size, `numLevels`, image size, `channels`, plus
`bestLevel`, `tilesForBbox`, `tilesForLevel`, `tileBounds`, and
`tileSourceSize`. TIFF loaders add `fetchTileBytes`/`tileDecodeOptions`;
Zarr loaders add `loadTile`/`loadTilePixels`/`sampleTilePixels`.

`openImagePyramid` (`src/data/morphologyImage.ts`) sends Zarr-looking URLs to
`openOmeZarrImage` and everything else to `openTiff`.

## OME-TIFF / TIFF / NDPI

`openTiff` (`src/tiff/loader.ts`):

1. Opens the file with `geotiff` `fromUrl(url, { allowFullFile: false })`. A
   `#ifd=N` hash selects the base IFD. `.qptiff` and `.qptif` URLs go to the
   [QPTIFF](#qptiff) reader instead, and `.svs` URLs to the [SVS](#svs)
   reader.
2. Reads OME-XML from IFD 0's `ImageDescription` (`parseOmeTiffMetadata`,
   `src/tiff/omeMetadata.ts`). A `PerkinElmer-QPI-ImageDescription` there
   sends the file to the QPTIFF reader, and a description starting with
   `Aperio` to the SVS reader.
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
   Tile offsets come from `TileOffsets`/`TileByteCounts`; a stripped level
   (`StripOffsets`, no `TileWidth`) is cut into tiles instead (see
   [Stripped TIFFs](#stripped-tiffs)).

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

### Stripped TIFFs

A stripped level stores `RowsPerStrip` whole rows per strip, so a strip
cannot be read for part of a row (`src/tiff/strips.ts`). The loader shows it
as tiles of the size of the image's tiled levels, or 256 × 256 when no level
is tiled, cut from bands: runs of whole rows read once and shared by every
tile across them.

- **Bands.** A band aims for 8 MiB (at most 1,024 rows), so its read fits the
  byte-range cache. Uncompressed rows are read as they are needed, so a band
  can be part of a strip, even of a file stored as one strip; very wide images
  get bands of under one tile row. A compressed band holds whole strips, at
  least one.
- **Reads.** A band's strips, or rows of strips, that lie within 4 KiB of each
  other in the file are read in one request: one per band for most files, one
  per band and plane for separated (`PlanarConfiguration` 2) samples.
- **Decoding.** Compressed bands are decoded in a shared tile decode worker
  pool (`decodeTiffStripBand`, `src/codecs/tiffStrips.ts`). Tiles cut from
  bands are uncompressed samples, so they draw like uncompressed tiles.
- **Memory.** Decoded bands are kept for their tiles up to 256 MiB across all
  loaders, least recently used first. A band read is cancelled once every
  tile waiting on it is.
- **Limits.** 8- or 16-bit samples only. A level whose compressed strips
  decode to more than 256 MiB each fails to open with a message to save it
  tiled; an 8,192 × 8,192 16-bit image saved as one LZW strip (128 MiB)
  still opens.
- **No pyramid.** Most stripped files have no reduced levels. Zoomed out, the
  view then needs every band of the image, and the tile budget loads the
  tiles nearest the centre first, so a large image's edges stay empty until
  zoomed in.

### Requirements

- **SubIFD pyramids.** Pyramids stored as additional top-level IFDs are not
  read (QPTIFF and SVS excepted), so such files render at full resolution
  only. Stripped levels are read (see [Stripped TIFFs](#stripped-tiffs)),
  but tiled pyramids load faster. Most NDPI files store their pyramid as
  top-level IFDs and each level as one JPEG strip, too large to decode;
  convert them to pyramidal OME-TIFF.
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

### SVS

Aperio and Leica scanners, and others that copy the format (Grundium), write
SVS: a TIFF or BigTIFF whose pyramid levels are top-level IFDs. IFD 0 is the
full-resolution image, then come a stripped thumbnail, the reduced levels
(4× steps on Aperio AT2 and ScanScope, 2× on GT450), the label, and the macro
(slide overview). `openTiff` sends `.svs` URLs, and TIFFs whose first
`ImageDescription` starts with `Aperio`, to the SVS reader, which shares the
top-level IFD code with QPTIFF (`src/tiff/loader.ts`, layout and metadata in
`src/tiff/svs.ts`):

- **IFD walk.** Aperio writes each IFD after its image data, so the IFDs are
  spread through the file. The walk reads through a geotiff block cache of
  64 KiB blocks, which fetches each IFD together with its `JPEGTables` and
  tile offsets, and stops at the label (the first stripped IFD with
  `NewSubfileType` bit 0 set), so the macro IFD is not read. The slide below
  opens in 5 range requests (320 KB); reading exact ranges took 10.
- **Layout.** Every tiled IFD is a level, as OpenSlide reads SVS. A tiled IFD
  with another tile size or sample count than IFD 0, or no smaller than the
  level before it, is left out. The thumbnail, label, and macro are not shown.
- **Metadata.** The pixel size is `MPP` from the description (`|`-separated
  `key = value` fields, any spacing around `=`), else `XResolution` in
  `ResolutionUnit`, else 0.2125 µm. The slide is one channel, `RGB`, drawn as
  stored; a single-sample slide is one greyscale channel.
- **Per-level tags.** Each level is decoded with its own IFD's tags: Aperio
  writes different JPEG quantization tables for each level.
- **Tile offsets** of a level are read when its first tile is fetched, so
  level 0's offsets, the largest arrays, wait until the view zooms in.
- **Adjacent reads.** SVS tiles are small (240 or 256 px, a few KB) and stored
  back to back, row by row or in scan stripes. A tile fetch reads, in one
  request, the run of tiles stored next to it in the file that lie within 4
  tiles of it in the image (at most 16 tiles and 1 MiB). The others wait in
  memory, at most 512 of them, for their own fetch. A run is not cancelled
  when its tile leaves the view, since other tiles may be waiting on it.
- **Missing tiles.** A zero-length tile is drawn transparent without a
  request.
- `.zchunkstore` sidecars are not used. A sidecar named by the dataset
  manifest for an SVS adds a fallback notice.

Tiles are JPEG with RGB components (Aperio `JPEG/RGB`) or YCbCr components
(GT450 `JPEG/YCC`, Grundium), or JPEG 2000 with YCbCr (33003) or RGB (33005)
components; see [Codecs](#codecs).

Checked against:

| File                                                                                                                | Scanner                       | Tiles                                         | Levels                                     |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------- | ------------------------------------------ |
| BioImage Archive S-BSST129 `HR10036-BL117659-94605_N2.svs` (24 MB)                                                  | Aperio AT2                    | JPEG 2000 RGB, 240 px                         | 11,952 × 8,842 and 2,988 × 2,210; 0.503 µm |
| OpenSlide test data `CMU-1.svs` and `CMU-1-Small-Region.svs`                                                        | Aperio ScanScope              | JPEG RGB, `JPEGTables` per level, 256 px      | 46,000 × 32,914, three levels; 0.499 µm    |
| BioImage Archive S-BIAD2323 `component_C_leica_svs/c003_leica.svs` and `component_A_grundium_svs/c004_grundium.svs` | Leica GT450 DX, Grundium Ocus | JPEG YCbCr, BigTIFF, 256 px and 512 px        | five and four levels; 0.264 and 0.251 µm   |
| OpenSlide test data `JP2K-33003-1.svs`                                                                              | Aperio                        | JPEG 2000 YCbCr, chroma at half width, 256 px | 15,374 × 17,497, three levels              |

All but the last were opened in the app (the BioImage Archive ones directly
from EBI); for `JP2K-33003-1.svs`, tiles decoded by the app were compared with
tifffile (`imagecodecs`) decodes.

### Codecs

`decodeTiffTilePixels` (`src/codecs/tiffTile.ts`):

| Compression                                                | Decoder                                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 33003/33004/33005/34712 (JPEG 2000), or no Compression tag | OpenJPEG WASM (`@cornerstonejs/codec-openjpeg`, `src/codecs/jpeg2000.ts`)                                 |
| 1 (none)                                                   | Copy                                                                                                      |
| 5 (LZW, predictor 1 or 2)                                  | Built-in decoder                                                                                          |
| 7 (JPEG), 8-bit RGB                                        | The browser's decoder (`createImageBitmap`) in the decode worker (`src/codecs/jpeg.ts`); `geotiff` if not |
| Other (JPEG, Deflate, PackBits, LERC, Zstd, WebP)          | `geotiff` `getDecoder`                                                                                    |

JPEG-XR is not supported.

**LZW.** `geotiff`'s LZW decoder has room for codes up to 4,092. tifffile
(`imagecodecs`) uses codes up to 4,094 before a clear code, and on those
`geotiff` loops until the decode worker, and with it the tab, runs out of
memory. The built-in decoder handles every 12-bit code and undoes horizontal
differencing (Predictor 2) itself, in the file's byte order.

**JPEG colour.** A three-component JPEG tile holds RGB or YCbCr. An Adobe or
JFIF marker in the tile or `JPEGTables` decides; otherwise `Photometric`
does (2 RGB, 6 YCbCr), as tifffile reads Aperio SVS; otherwise the component
IDs do, as libjpeg guesses (`R`, `G`, `B` is RGB, anything else YCbCr).
Aperio's RGB tiles have IDs 0, 1, 2 and no marker, which browsers decode as
YCbCr (white background turns magenta), so the worker merges the tables into
the tile and adds an Adobe marker (transform 0) before decoding. The browser
decodes a 256-pixel tile in about 1 ms, against about 15 ms in JavaScript,
and the result is the bitmap the canvas draws, with no window or colour step.
`geotiff`'s decoder returns the components unconverted, so YCbCr tiles
decoded there are converted to RGB after it (JFIF coefficients).

**JPEG 2000 colour.** Aperio 33003 tiles hold YCbCr with chroma at half
width and no colour transform in the codestream; OpenJPEG converts such
subsampled images to RGB itself. 33005 tiles use the codestream's colour
transform.

### Fetching And Decoding

- Tile bytes go through the IndexedDB byte-range cache (namespace `tiff-tile`,
  `src/data/persistentByteRangeCache.ts`).
- Tile `Range` requests are sent with `cache: 'no-store'`. Chromium lets one
  request at a time use a URL's HTTP cache entry, so `Range` requests to one
  file waited for each other: four concurrent 1 s requests took 4.05 s, and
  1.02 s with `no-store`.
- A zero-length tile (one the file leaves out) is drawn transparent and
  skipped by auto-contrast.
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
  (`src/zarr/zarrStores.ts`). Metadata-key `403`s are treated as missing. An
  Icechunk repository is read with `icechunk-js`, its snapshot serving as the
  consolidated metadata (see
  [AnnData in Icechunk](./h5ad.md#anndata-in-icechunk)).
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
  channels. The initial request count (96), the tile cache, and the
  concurrency are sized for 512-pixel tiles; smaller tiles get
  proportionally more, up to 4× (an SVS slide in 240-pixel tiles with 4×
  level steps needs 130 tiles for the overview of the slide above, and up to
  300 when zoomed). Large uncompressed or LZW tiles (≥ 512 × 512) use a
  reduced "heavy" schedule (`src/rendering/morphologyTileScheduling.ts`).
- **Drawing.** While tiles load, the nearest ready level fills in. Multiple
  channels are composited additively (`lighter`) with per-channel alpha.
  Tile edges are snapped to whole pixels, so neighbouring tiles meet without
  a seam of background between them.
- **Contrast.** Changing a channel's window or colour starts a new tile cache,
  so tiles are decoded again.

### Auto-Contrast

`computeChannelAutoContrast` (`src/data/morphologyContrast.ts`) samples up to
250,000 values from the coarsest level and sets the window to the 0.5 and
99.8 percentiles, with a 32-bin histogram for the Image section. It reads at
most 64 of the level's tiles, from 8 evenly spaced rows (more per row when
there are fewer rows), so an image without a pyramid is not read whole. It
runs after an image loads and when a channel's `Auto` button is pressed.
Native RGB channels (H&E slides, RGB OME-TIFF and SpatialData images) are not
auto-contrasted when the image loads: they are drawn without a window, and
the coarsest level of an SVS slide can be over a hundred tiles.

An image with more than six channels auto-contrasts only the channels that are
on when it loads. Any other channel is auto-contrasted when it is first turned
on, if it still has its pixel type's default window and no histogram; native
RGB channels are left alone.

Tiles are decoded and sampled off the main thread (`src/data/tileSamples.ts`
picks the pixels). TIFF tile bytes go to a tile decode worker started for the
run (`src/workers/tileSamplesCore.ts`), which ends with the run or on abort.
OME-Zarr tiles are sampled by the Zarr decode worker that holds their chunk
(`sampleTilePixels`). Only the samples come back; the main thread sorts them
and builds the histogram. Where there is no `Worker`, or a Zarr decode worker
fails, tiles are decoded and sampled on the main thread.

## Custom Image Layers

`Custom image URL` → `Load Layer` in the Image section
(`useCustomMorphologyLayerWorkflow`, `src/features/morphology/`):

- Accepts `http`/`https` OME-TIFF, TIFF, QPTIFF, SVS, or OME-Zarr URLs; http
  URLs that fail are retried over https.
- Channels are prefixed with the layer name (the file name). A layer without
  channel metadata gets one white channel.
- Layers are saved in the share URL as repeated `customImageUrl` and
  `customImageOpacity` parameters.

## Constants

| Constant                   | Value                                                                               | File                                                           |
| -------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Default µm/px              | 0.2125 (TIFF), 1 (Zarr)                                                             | `omeMetadata.ts`, `omeZarrLoader.ts`                           |
| Default tile size          | 256                                                                                 | `loader.ts`, `omeZarrLoader.ts`                                |
| Level threshold            | 1.5 screen px per source px                                                         | `loader.ts`, `omeZarrLoader.ts`                                |
| Decode workers             | TIFF ≤ 4, plus 1 per auto-contrast run; OME-Zarr ≤ 3                                | `tileDecodePool.ts`, `zarrDecodePool.ts`                       |
| Tile cache / concurrency   | compact 72 / 2, balanced 120 / 4, expanded 180 / 6; up to 4× for tiles under 512 px | `src/data/performanceBudget.ts`, `morphologyTileScheduling.ts` |
| Auto-contrast              | 0.5 / 99.8 percentiles, 250,000 samples from ≤ 64 tiles, 32 bins                    | `morphologyContrast.ts`                                        |
| Stripped levels            | 256 px tiles; 8 MiB / 1,024-row bands; 256 MiB of bands; strips ≤ 256 MiB decoded   | `strips.ts`                                                    |
| IndexedDB byte-range cache | 256 MiB, 20,000 entries, 8 MiB per entry                                            | `persistentByteRangeCache.ts`                                  |

## Source Files

| File                                                                                                            | Role                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/datasets/imageOnlyDataset.ts`                                                                              | Image-only `SpatialDataset`                                            |
| `src/data/imagePyramid.ts`                                                                                      | `ImagePyramidLoader` interface                                         |
| `src/data/morphologyImage.ts`                                                                                   | Image opening, per-channel loaders, custom layers, Xenium image choice |
| `src/data/morphologyContrast.ts`, `tileSamples.ts`                                                              | Auto-contrast                                                          |
| `src/tiff/loader.ts`, `omeMetadata.ts`, `qptiff.ts`, `svs.ts`, `zchunkStore.ts`, `tileCache.ts`, `chunkKeys.ts` | TIFF, QPTIFF, and SVS loading                                          |
| `src/tiff/strips.ts`                                                                                            | Stripped levels: bands, reads, and tiles cut from them                 |
| `src/codecs/tiffTile.ts`, `tiffStrips.ts`, `jpeg.ts`, `jpeg2000.ts`                                             | Tile and strip decoding                                                |
| `src/workers/tileDecode.worker.ts`, `tileDecodePool.ts`, `tileDecodeMessages.ts`, `tileSamplesCore.ts`          | Decode workers                                                         |
| `src/zarr/omeZarrLoader.ts`, `zarrStores.ts`                                                                    | OME-Zarr loading                                                       |
| `src/workers/zarrDecode.worker.ts`, `zarrDecodePool.ts`, `zarrDecodeCore.ts`                                    | OME-Zarr chunk decoding and label tracing                              |
| `src/components/MorphologyCanvas.tsx`, `src/rendering/morphologyCanvas.ts`, `morphologyTileScheduling.ts`       | Drawing and scheduling                                                 |
| `src/features/morphology/*`                                                                                     | Channel controls and custom layers                                     |
| `src/features/annotations/geometricAnnotationModel.ts`                                                          | GeoJSON shapes (image-only ROI output)                                 |

## Known Limitations

- Top-level-IFD pyramids (other than QPTIFF and SVS) are not supported.
- Stripped TIFFs without reduced levels read every band of the image to show
  it whole, and compressed strips that decode to more than 256 MiB each are
  refused.
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
- SVS: the thumbnail, label, and macro images are not shown, and the minimap
  draws the coarsest level from its own tiles rather than the thumbnail, so
  it decodes that level a second time. Aperio's 4× level steps mean a view
  just past a level switch draws about 7 source pixels per screen pixel.
  Aperio fluorescence SVS files (one pyramid per channel) have not been
  tried. A JPEG 2000 33003 tile with full-width chroma would be shown as
  YCbCr; no such file has been seen.
