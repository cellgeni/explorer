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

| URL pattern                                                                                                                   | Check                                                                        | Result                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Path ends in `.zarr`, `.ome.zarr`, `/zarr.json`, or `/.zattrs`, or names a group inside a `.zarr` store (`isOmeZarrImageUrl`) | `HEAD` on the root's `zarr.json` and/or `.zattrs`                            | SpatialData if the root has `spatialdata_attrs`, else image (`imageKind: 'ome-zarr'`) |
| Ends in `.tif`, `.tiff`, `.ome.tif`, `.ome.tiff`, `.qptiff`, `.qptif`, `.svs`, or `.ndpi` (query/hash allowed)                | One `HEAD` on the URL                                                        | Image (`imageKind: 'tiff'`, `'qptiff'`, `'svs'`, or `'ndpi'`)                         |
| Any other folder URL                                                                                                          | After the `experiment.xenium` probe fails, `HEAD` on `zarr.json` / `.zattrs` | SpatialData, or image pointing at that metadata file                                  |
| Path ends in `.icechunk` (an [Icechunk](https://icechunk.io/) repository)                                                     | Opens the repository's `repo` file and snapshot                              | AnnData, SpatialData, or, with root `multiscales`, image (`imageKind: 'ome-zarr'`)    |
| Path ends in `.zip` (a zipped Zarr store, such as `image.ome.zarr.zip`)                                                       | `HEAD`, then the zip's central directory and root metadata                   | SpatialData, or, with root `multiscales` or `bioformats2raw.layout`, image            |

A group inside a store is a path below a folder named `.zarr` whose last part
has no dot, such as a SpatialData store's `sample.zarr/images/he` or a
`bioformats2raw` series `image.zarr/0`; a last part with a dot
(`sample.zarr/he.ome.tif`) is a file and keeps its own type. The group opens
as its own OME-Zarr image; the enclosing store is not read.

`omeZarrImageRootUrl` strips a trailing `/zarr.json` or `/.zattrs` to find the
store root. `createSpatialDataset` builds an `ImageOnlyDataset`
(`src/datasets/imageOnlyDataset.ts`). NDPI files open in the TIFF loader's
[NDPI](#ndpi) reader.

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
Zarr loaders add `loadTile`/`loadTilePixels`/`sampleTilePixels`. A caller
passes `fetchTileBytes` the tiles it will fetch next (`upcoming`), and is told
(`onSharedRead`) when a tile's bytes come from another tile's request (see
[Fetching And Decoding](#fetching-and-decoding)). An SVS loader also has an
`overview`, the thumbnail the minimap draws, and `associatedImages`, which
lists the label, macro, and thumbnail.

`openImagePyramid` (`src/data/morphologyImage.ts`) sends Zarr-looking URLs to
`openOmeZarrImage` and everything else to `openTiff`.

## OME-TIFF / TIFF

`openTiff` (`src/tiff/loader.ts`):

1. Opens the file with `geotiff` `fromUrl(url, { allowFullFile: false })`. A
   `#ifd=N` hash selects the base IFD. `.qptiff` and `.qptif` URLs go to the
   [QPTIFF](#qptiff) reader instead, `.svs` URLs to the [SVS](#svs) reader,
   and `.ndpi` URLs without `#ifd=N` to the [NDPI](#ndpi) reader.
2. Reads OME-XML from IFD 0's `ImageDescription` (`parseOmeTiffMetadata`,
   `src/tiff/omeMetadata.ts`). A `PerkinElmer-QPI-ImageDescription` there
   sends the file to the QPTIFF reader, a description starting with
   `Aperio` to the SVS reader, and the NDPI format tag (65420) on IFD 0 to
   the NDPI reader.
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
   [Stripped TIFFs](#stripped-tiffs)). Every level is shown in level 0's tile
   size, so a SubIFD level stored in tiles of another size has each tile cut
   from the stored tiles under it, decoded once and kept as strip bands are
   (`src/tiff/retiledLevels.ts`). That needs 8- or 16-bit samples and fails
   for JPEG 2000 tiles, with a message naming the level's tile size.

The parsed file (header and IFD chain) is shared by loaders of the same file,
for the 4 most recently opened files, so opening another channel IFD or z plane
reads only the IFDs not yet walked. A file whose open fails is opened afresh
next time.

### Z-Stacks

An OME-TIFF with `SizeZ > 1` is a z-stack when the OME-XML locates every
channel's plane at each z for `t = 0` (`parseOmeTiffMetadata`). The same rules
locate each channel's plane in a 2D image:

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

- **SubIFD pyramids.** OME-TIFF pyramids are read from SubIFDs. Pyramids
  stored as additional top-level IFDs are read for QPTIFF, SVS, NDPI, and
  [page pyramids](#page-pyramids); other such files render at full
  resolution only. Stripped levels are read (see
  [Stripped TIFFs](#stripped-tiffs)), but tiled pyramids load faster.
- **Unsigned 8- or 16-bit samples**, 1, 3, or 4 samples per pixel. An image
  whose `SampleFormat` is 2 (signed) is refused when it opens, with a message;
  label images read signed IDs. Float images fail.
- **Compression.** A tile without a `Compression` tag is read as uncompressed,
  the TIFF default.
- **Byte ranges.** Each tile is a `Range` `GET` that must return `206`.

### Page Pyramids

A non-OME TIFF without SubIFDs whose IFD 1 is tiled with IFD 0's tile size
and sample count, but smaller, is read as a pyramid of pages (`isPagePyramid`
and `readPagePyramidFile` in `src/tiff/loader.ts`): IFD 0 at full resolution
and each later tiled IFD that shrinks as the next level, the layout SVS uses
(`svsLayout`). tifffile writes the MERSCOPE `.vzg` pyramids this way. Levels
whose tile size differs from IFD 0's are left out (the two smallest MERSCOPE
levels use 32 px tiles). The pixel size comes from `XResolution`, or from
the opener; MERSCOPE passes 0.108 µm from the run's transform.

### In-Memory Files And Placement

`OpenImagePyramidOptions` (`src/data/imagePyramid.ts`) lets a dataset open a
TIFF it already holds and place it:

- `bytes`: the whole file in memory, such as an entry inflated from a zip.
  geotiff reads the IFDs from the buffer (`fromArrayBuffer`), tiles are
  sliced from it (`memoryRangeFetcher`), and the byte-range cache and
  `.zchunkstore` probe are skipped.
- `origin`: the image's top-left corner in data micrometres. `tilesForBbox`
  subtracts it and `tileBounds` adds it, as the OME-Zarr loader does with a
  SpatialData translation.
- `micrometersPerPixel` and `channelName` replace the file's.

### OME-XML

| Field                                          | Use                                                                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Pixels@PhysicalSizeX` (+ unit)                | µm/px, from any length unit (Å to km, inches, feet; `src/data/lengthUnits.ts`). Without OME-XML the default is 0.2125 (the Xenium pixel size). TIFF resolution tags are ignored. |
| `Pixels@PhysicalSizeY` (+ unit)                | Checked only: pixels must be square, so an image whose size differs from `PhysicalSizeX` fails with both sizes, unless a pixel size is given with it                             |
| `Pixels@Type`                                  | Default contrast window (uint8 0–255, uint16 0–65535, float 0–1)                                                                                                                 |
| `Channel@Name`, MapAnnotation `Purpose`        | Channel name                                                                                                                                                                     |
| `Channel@Color`                                | Channel colour as signed 32-bit RGBA (alpha ignored); without it, keyword defaults (DAPI, boundary, RNA, protein) or a palette                                                   |
| `TiffData` `FirstC`/`IFD`/`UUID@FileName`      | Per-channel IFD (`#ifd=N`) or sibling file (Xenium `morphology_focus_000N.ome.tif`); channels count in element order, not by ID                                                  |
| `SizeZ`, `DimensionOrder`, `TiffData` `FirstZ` | Z-stack planes per channel (see [Z-Stacks](#z-stacks))                                                                                                                           |
| `PhysicalSizeZ` (+ unit)                       | Depth shown beside the `Z plane` slider                                                                                                                                          |
| `SamplesPerPixel ≥ 3` or `Interleaved="true"`  | Native RGB, drawn without colour or window                                                                                                                                       |

### QPTIFF

Akoya PhenoCycler, PhenoImager, and Vectra scanners write QPTIFF, a BigTIFF in
which every image is a top-level IFD: one full-resolution IFD per channel, a
thumbnail, each pyramid level as one reduced-resolution IFD per channel, then
the slide overview and label. `readQptiffFile` (`src/tiff/loader.ts`) reads it
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
  `NewSubfileType` bit 0 set), so the macro IFD is read only when the slide
  images are listed. The slide below opens in 5 range requests (320 KB);
  reading exact ranges took 10.
- **Layout.** Every tiled IFD is a level, as OpenSlide reads SVS. A tiled IFD
  with another tile size or sample count than IFD 0, or no smaller than the
  level before it, is left out.
- **Slide images.** Stripped IFDs are named as OpenSlide names them: IFD 1 is
  the thumbnail; another is named by the first word of its description's
  second line (`label 387x463`, `macro 1280x431`), or else by
  `NewSubfileType` (1 label, 9 macro). Each opens as a one-level loader of a
  [stripped level](#stripped-tiffs) in its own pixels (1 µm per pixel, since
  the label and macro have no scale): the info drawer's
  [Slide images](../ui-reference.md#info-drawer) section draws them whole,
  label first, and `#ifd=N` on the slide's URL opens one as an image of its
  own. The list is read when the section opens, once per loader; reading it
  costs the macro IFD's block.
- **Minimap.** An RGB slide's thumbnail, stretched over the slide's extent,
  is the loader's `overview`, which the [minimap](../ui-reference.md#minimap)
  draws instead of the coarsest level: one strip read and decode (132 KB for
  the slide below) rather than every tile of that level (130). A thumbnail
  that cannot be read leaves the minimap to the coarsest level, with a
  notice.
- **Metadata.** The pixel size is `MPP` from the description (`|`-separated
  `key = value` fields, any spacing around `=`), else `XResolution` in
  `ResolutionUnit`, else 0.2125 µm. The slide is one channel, `RGB`, drawn as
  stored; a single-sample slide is one channel with the window of its bit
  depth.
- **Fluorescence.** Aperio FL scanners write one SVS per channel (16-bit,
  uncompressed 256-pixel tiles, with an RGB thumbnail, label, and macro) and
  an `.afi` XML file that lists a scan's channel files. A channel file's
  channel is named by `Dye` and drawn in `DisplayColor` (a packed `0xRRGGBB`
  integer). `Acquisition Bit Depth` (10) is the camera's: the samples span
  the full 16 bits, so it does not set the window. Open one channel file as
  the image and the others as [custom layers](#custom-image-layers); `.afi`
  files are not read.
- **Per-level tags.** Each level is decoded with its own IFD's tags: Aperio
  writes different JPEG quantization tables for each level.
- **Tile offsets** of a level are read when its first tile is fetched, so
  level 0's offsets, the largest arrays, wait until the view zooms in.
- **Adjacent reads.** SVS tiles are small (240 or 256 px, a few KB) and stored
  back to back, row by row or in scan stripes, so tiles in view are read in
  runs, as for every tiled TIFF (see
  [Fetching And Decoding](#fetching-and-decoding)).
- **Missing tiles.** A zero-length tile is drawn transparent without a
  request.
- `.zchunkstore` sidecars are not used. A sidecar named by the dataset
  manifest for an SVS adds a fallback notice.

Tiles are JPEG with RGB components (Aperio `JPEG/RGB`) or YCbCr components
(GT450 `JPEG/YCC`, Grundium), or JPEG 2000 with YCbCr (33003) or RGB (33005)
components; see [Codecs](#codecs).

Checked against:

| File                                                                                                                                           | Scanner                                 | Tiles                                         | Levels                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------- | ------------------------------------------ |
| BioImage Archive S-BSST129 `HR10036-BL117659-94605_N2.svs` (24 MB)                                                                             | Aperio AT2                              | JPEG 2000 RGB, 240 px                         | 11,952 × 8,842 and 2,988 × 2,210; 0.503 µm |
| OpenSlide test data `CMU-1.svs` and `CMU-1-Small-Region.svs`                                                                                   | Aperio ScanScope                        | JPEG RGB, `JPEGTables` per level, 256 px      | 46,000 × 32,914, three levels; 0.499 µm    |
| BioImage Archive S-BIAD2323 `component_C_leica_svs/c003_leica.svs` and `component_A_grundium_svs/c004_grundium.svs`                            | Leica GT450 DX, Grundium Ocus           | JPEG YCbCr, BigTIFF, 256 px and 512 px        | five and four levels; 0.264 and 0.251 µm   |
| OpenSlide test data `JP2K-33003-1.svs`                                                                                                         | Aperio                                  | JPEG 2000 YCbCr, chroma at half width, 256 px | 15,374 × 17,497, three levels              |
| Zenodo [10.5281/zenodo.841835](https://zenodo.org/records/841835) `Papadeno_L34_MS1_Tumor3_DAPI.tif` and `…_Alexa Fluor 568.tif` (858 MB each) | Aperio ScanScope FL (ImageScope export) | Uncompressed 16-bit, one channel, 256 px      | 18,417 × 21,256 and two levels; 0.463 µm   |

All but `JP2K-33003-1.svs` were opened in the app (the BioImage Archive ones
directly from EBI, the Zenodo ones through a local mirror, since Zenodo's
CORS-enabled `/api/records/…/content` URLs do not end in a file name the app
detects); for `JP2K-33003-1.svs`, tiles decoded by the app were compared with
tifffile (`imagecodecs`) decodes. The slide images of CMU-1-Small-Region, the
BioImage Archive Aperio slide, and the Zenodo channel files were drawn in the
app.

### NDPI

Hamamatsu NanoZoomer scanners write NDPI: a classic TIFF whose pyramid
levels are top-level IFDs, each holding the whole level as one baseline JPEG
in a single strip, followed by the macro image (slide overview) and a map of
the scanned area. `openTiff` sends `.ndpi` URLs, and TIFFs whose IFD 0 has
the NDPI format tag (65420), to the NDPI reader (`src/tiff/loader.ts`;
layout, blocks, and tiles in `src/tiff/ndpi.ts`):

- **Restart intervals.** A level's JPEG is far too large to decode whole
  (68,096 × 37,632 RGB is 7.7 GB) and wider than the 65,535 pixels a JPEG
  header can state, so the scanner writes a width of 0. It ends every few
  MCUs with a restart marker and lists where each restart interval starts
  in a private tag (McuStarts, 65426), which is how OpenSlide reads regions
  of a level. Intervals run along MCU rows: 19 per row at every level of the
  slides below, 3,584 pixels wide at full resolution.
- **IFD walk.** As for SVS, through 64 KiB blocks, stopping at the macro
  (magnification tag 65421 of −1), so the map's IFD is not read. The Sanger
  slide below opens in 8 range requests.
- **Layout.** The images with a positive magnification in the focal plane
  nearest the focus (Z offset tag 65424), largest first, each smaller than
  the one before. A level with McuStarts is read by block. One without, such
  as the 2,128 × 1,176 smallest level of the Sanger slide, is read whole as
  a [stripped level](#stripped-tiffs). A level that can be read neither way
  is left out, unless it is the first.
- **Bands.** A level's McuStarts tag and JPEG header (660 bytes) are read
  with its first tile. MCU rows lie back to back in the file, so a band of
  whole rows is one `Range` request. Bands start at the tile height (512 px)
  and halve until they average 2 MiB or less: 16 MCU rows (128 px) at full
  resolution, 1.5 to 2.5 MB of JPEG. Bands are kept in memory (64 MiB) while
  the blocks across them decode, and in the IndexedDB byte-range cache.
- **Blocks.** A block is a run of whole restart intervals across a band,
  about 2,048 px wide (one 3,584-px interval at full resolution). It decodes
  as a JPEG of its own: the level's header with the block's size written in,
  the intervals' entropy-coded data, and restart markers numbered afresh
  from RST0. Blocks decode in the strip-band decode workers with `geotiff`'s
  decoder and are kept with stripped bands (256 MiB). Tiles of 512 px are
  cut from them.
- **DC level.** When the smallest level is over 2,048 px wide or tall, a
  level an eighth its size is added. Its blocks decode only each 8 × 8 JPEG
  block's DC term, one pixel per block (the block's mean), with the built-in
  sequential decoder (`jpegDcOnly`). The whole-slide view of the BioImage
  Archive slide below, whose smallest level is 5,704 × 4,880, then draws
  from 4 tiles instead of 120.
- **Scheduling.** The tiles are uncompressed 512-pixel tiles, which the
  scheduler would hold to 18 tiles and one request at a time as large raw
  tiles. Each is a cut from shared blocks, so the loader sets
  `tilesFromSharedReads` and gets the normal budget.
- **Metadata.** The pixel size is `XResolution` in `ResolutionUnit`
  (centimetres). The slide is one channel, `RGB`, drawn as stored.
- **Not read.** Files over 4 GB keep the upper 32 bits of their offsets
  outside the TIFF fields: in 8-byte IFD offsets, an array after each IFD,
  and the McuStartsHighBytes tag (65432). They are refused with a message
  when the file size is readable from `Content-Range` or the IFDs parse far
  enough to show that tag; otherwise, as on Zenodo, which hides
  `Content-Range`, the open fails with a parse error. See
  [Phase 19](../plan/phases/19-ndpi.md#64-bit-ndpi-files-over-4-gb) for the
  layout, test files, and what support needs. Other focal planes, the macro
  image, and the map are not shown; `#ifd=N` opens one IFD on its own as a
  plain TIFF, so `#ifd=6` shows the Sanger slide's macro. Fluorescence NDPI
  has not been tried.

Checked against:

| File                                                                                             | Scanner           | Levels                                                                          |
| ------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------- |
| Sanger kidney section `mp33.cog.sanger.ac.uk/public/ndpi/STAN-FC34A - … 11.34.23.ndpi` (604 MB)  | NanoZoomer C13210 | 68,096 × 37,632, six 2× levels, the smallest without restart markers; 0.2212 µm |
| BioImage Archive S-BIAD2323 `component_B_hamamatsu_ndpi/c003_hamamatsu.ndpi` (609 MB, CC BY 4.0) | NanoZoomer        | 91,264 × 78,080 (both over 65,535), five 2× levels, all with restart markers    |

A tile at each level of the Sanger slide, edge tiles included, was compared
with tifffile's decode (libjpeg-turbo): at most 3 levels apart, 0.15 on
average. In headless Chromium at 1,400 × 900, from a cold cache (on
2026-11-15, from a network where Sanger S3 answered in about 0.4 s):

| View                         | Sanger slide               | BioImage Archive slide     |
| ---------------------------- | -------------------------- | -------------------------- |
| Whole slide                  | 0.8 s, 12 requests, 1.0 MB | 3.3 s, 22 requests, 3.1 MB |
| Full resolution, over tissue | 4.2 s, 26 requests, 31 MB  | 2.7 s, 30 requests, 17 MB  |

Whole-row bands make a full-resolution view read every interval of its
rows, though it shows one or two of each row's 19: the 31 MB above, against
about 1.5 MB for the intervals in view. Reading only those intervals would
cost a request per 8-pixel MCU row in view, about 85 to 170 for that view,
at 0.4 s each on that network.

### Codecs

`decodeTiffTilePixels` (`src/codecs/tiffTile.ts`):

| Compression                                                | Decoder                                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 33003/33004/33005/34712 (JPEG 2000), or no Compression tag | OpenJPEG WASM (`@cornerstonejs/codec-openjpeg`, `src/codecs/jpeg2000.ts`)                                 |
| 1 (none)                                                   | Copy                                                                                                      |
| 5 (LZW, predictor 1 or 2)                                  | Built-in decoder                                                                                          |
| 7 (JPEG), 8-bit RGB                                        | The browser's decoder (`createImageBitmap`) in the decode worker (`src/codecs/jpeg.ts`); `geotiff` if not |
| 7 (JPEG), more than 8 bits per sample                      | Built-in sequential decoder (`src/codecs/jpegSequential.ts`), 16-bit samples                              |
| 7 (JPEG), NDPI blocks                                      | `geotiff`, in the strip-band decode workers; the DC level the built-in decoder's `dcOnly` mode            |
| Other (JPEG, Deflate, PackBits, LERC, Zstd, WebP)          | `geotiff` `getDecoder`                                                                                    |

JPEG-XR is not supported.

**12-bit JPEG.** geotiff's JPEG decoder clips samples to 8 bits, and browsers
decode only 8-bit JPEG. Tiles with `BitsPerSample` above 8 (MERSCOPE `.vzg`
pyramids: SOF1, 12-bit) go to a built-in baseline and extended sequential
Huffman decoder with a floating-point IDCT, which returns 16-bit samples
within one level of libjpeg-turbo's and decodes a 384 px tile in about 5 ms.
Progressive, lossless, and arithmetic-coded JPEG are refused. The channel's
default window is 0 to 4,095.

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
  A worker that fails, such as one whose script no longer loads after a
  redeploy, ends the pool: its pending tiles fail with the error, and the next
  tile starts a new worker, as the OME-Zarr pool does.
- `TileCache` (`src/tiff/tileCache.ts`) is an LRU of decoded bitmaps keyed by
  `level:col:row`.
- `TileRequestScheduler` (`src/tiff/tileRequestScheduler.ts`) loads the tiles
  in view, nearest first. When the view moves, tiles still in view keep
  loading and only those that left it are cancelled.
- **Runs of tiles.** Each tile fetch is told which tiles the scheduler still
  has queued at its level. A tiled TIFF level (OME-TIFF, QPTIFF, SVS, page
  pyramids) reads, in one request, the queued tiles stored back to back with
  the requested one (gaps up to 4 KB), growing both ways in file order, up to
  16 tiles and 1 MiB. Tiles are mostly stored row by row, so a run is a
  stretch of a row in view, or whole rows when the view spans the image. The
  others wait in memory, at most 512, for their own fetch, and no other run
  reads them. Tiles not in view are never read ahead, and a run is cancelled
  once every tile waiting for it has left the view. Xenium's 1,024-pixel
  JPEG 2000 tiles (400–670 KB) are too large to pair under 1 MiB, so they
  are read one per request as before.
- **Slots.** The concurrency limit counts requests rather than tiles: a tile
  whose bytes turn out to come from another tile's run gives up its slot
  (`onSharedRead`), so the scheduler starts another request instead of
  holding a slot until the run arrives.

## OME-Zarr

`openOmeZarrImage` (`src/zarr/omeZarrLoader.ts`):

- Opens Zarr v2 or v3 with `zarrita`, using consolidated metadata when present
  (`src/zarr/zarrStores.ts`). Metadata-key `403`s are treated as missing. An
  Icechunk repository is read with `icechunk-js`, its snapshot serving as the
  consolidated metadata (see
  [AnnData in Icechunk](./h5ad.md#anndata-in-icechunk)). A zipped store
  (`.zip`) is read from the zip's directory by byte range
  (`src/zarr/zarrZipStore.ts`); its root may sit in a folder inside the zip,
  and macOS `__MACOSX/` entries are ignored. Deflated entries are fetched and
  inflated whole, so each chunk costs its compressed size.
- Reads `multiscales[0]` from `attrs.ome` (OME-Zarr 0.5) or `attrs`. Each
  `datasets[].path` is a level.
- Axes come from `axes`, else array dimension names, else positional
  `…, c, y, x`. `x` and `y` are required. `z` starts at
  `omero.rdefs.defaultZ`, else the middle plane, and other planes open as
  `#z=N` loaders; `t` is `defaultT`, else 0.
- µm/px is the product of multiscale and dataset `scale` values for x, and
  for y when the pixels are not square (`units.yMicrometersPerPixel`, used for
  the image's extent and fit). Units are converted from any length the
  specification names, from angstrom to kilometre, inch and foot
  (`src/data/lengthUnits.ts`, shared with OME-TIFF). Unknown units count as
  µm; a missing scale gives 1 µm/px. `translation` is ignored except for
  SpatialData placement.
- Tile size is the x/y chunk shape (default 256). Chunks larger than 512 pixels
  are served as several virtual tiles of at most 512 pixels that share one
  decoded chunk.
- `omero.channels` gives names, `RRGGBB` colours, and windows (`start`/`end`,
  else `min`/`max`). Channels after the first open as `#c=N` loaders. An
  image without a `c` axis is one channel, white unless omero gives a colour,
  so a `z, y, x` volume gets the `Z plane` control.
- Three channels with no omero data, or labelled/coloured R, G, B, are treated
  as native RGB.
- Chunk bytes are fetched on the main thread. Decoding and RGBA conversion run
  in the Zarr decode worker pool (`src/workers/zarrDecodePool.ts`, up to
  `min(3, hardwareConcurrency − 1)` workers). Each chunk is routed to one
  worker, which keeps it for all of its virtual tiles. If a worker fails, the
  tile is decoded on the main thread with `zarr.get`, through a 256 MiB
  decoded-chunk cache. Store errors (for example a `403` chunk) are not retried.
  No IndexedDB cache is used.
- Range reads (a sharded array's chunks and shard indexes) are sent with
  `cache: 'no-store'`, like TIFF tiles. Chromium's HTTP cache gave a
  truncated body to one of two Range requests for the same bytes at once:
  opening the 3D view while the 2D view was loading the same chunks of the
  SciVis `engine.ome.zarr` failed to decode in 5 of 6 runs (2026-11-18).

### 3D View

An OME-Zarr z-stack opened as the dataset image can be shown in 3D: `View` ›
`3D` in the Image section (2026-11-18).

- **Level.** `volumeLevels()` lists each level's size and voxel size.
  `chooseVolumeLevel` (`src/data/imageVolume.ts`) takes the finest level
  whose sides are at most 2,048 voxels (the 3D texture size of desktop GPUs)
  and whose enabled channels together hold at most 64 Mi voxels. The SciVis
  `engine.ome.zarr` (256 × 256 × 128) is read at full resolution; S-BIAD493
  (8,781 × 2,253 × 41, 3 channels) at level 4 of 7, 1,097 × 281 × 41.
- **Reading.** `loadVolume` reads the loader's channel at every plane of the
  level with `zarr.get`, in slabs one chunk deep so each chunk is decoded
  once, four slabs at a time, and reports planes read. Codecs run in the Zarr
  decode workers, as for other zarrita reads. Up to six enabled channels are
  read, each once while the 3D view stays open; moving the `Z plane` slider
  does not read them again. Leaving 3D drops them.
- **Textures.** An 8-bit volume is uploaded as it is (`r8unorm`). Other dtypes
  are divided by their largest magnitude and uploaded as half floats
  (`r16float`), so the contrast window still applies to raw values.
- **Drawing.** `VolumeViewer` (`src/components/VolumeViewer.tsx`) is a second
  deck.gl canvas with an `OrbitView`, drawn over the 2D view, which stays
  mounted. `VolumeLayer` (`src/rendering/volumeLayer.ts`) draws the box's back
  faces and marches a ray through one 3D texture per channel, about one sample
  per voxel crossed. `Max intensity` adds each channel's colour times its
  brightest windowed value along the ray, like the 2D view adds channels.
  `Translucent` composites front to back; a voxel's opacity grows with the
  square of its windowed value, so faint background does not fog the volume,
  and `Opacity` sets how many full-intensity voxels hide what is behind.
- **Depth.** Planes are spaced by the z scale when `z` has a length unit, or
  when no spatial axis has a unit (the store's own units). Otherwise the
  spacing is unknown, and a plane is drawn as thick as a voxel of the level
  is wide. `Depth` stretches z from ×0.25 to ×16.
- **Link and manifest.** The share link carries `imageView=3d` while the 3D
  view is open, and a dataset manifest's `"imageView": "3d"` default opens it
  (`imageView=2d` in a link undoes that). Either applies once the image is
  read; an image that is not an OME-Zarr z-stack opens in 2D.

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
  a seam of background between them. A tile drawn at under half its size in
  device pixels (a single-level image zoomed out, or in the minimap) uses
  `imageSmoothingQuality = 'high'`, which filters through mipmaps; with the
  default filter, thin lines drop out.
- **Contrast.** Changing a channel's window or colour starts a new tile cache,
  so tiles are decoded again. An image without channels (a plain TIFF) has no
  window: its cache takes the first decoded tile's, and other tiles wait for
  that decode instead of each stretching its own contrast.

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
  URLs that fail are retried over https. If both fail, the error shown is the
  http read's (a 404, or not a TIFF), unless that read got no response, as
  from an HTTPS page, and the https retry did.
- Channels are prefixed with the layer name (the file name, decoded unless it
  holds a `%` that is not an escape). A layer without channel metadata gets one
  white channel.
- Layers are saved in the share URL as repeated `customImageUrl` and
  `customImageOpacity` parameters.

## Constants

| Constant                   | Value                                                                                | File                                                           |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Default µm/px              | 0.2125 (TIFF), 1 (Zarr)                                                              | `omeMetadata.ts`, `omeZarrLoader.ts`                           |
| Default tile size          | 256                                                                                  | `loader.ts`, `omeZarrLoader.ts`                                |
| Level threshold            | 1.5 screen px per source px                                                          | `loader.ts`, `omeZarrLoader.ts`                                |
| Decode workers             | TIFF ≤ 4, plus 1 per auto-contrast run; OME-Zarr ≤ 3                                 | `tileDecodePool.ts`, `zarrDecodePool.ts`                       |
| Tile cache / concurrency   | compact 72 / 2, balanced 120 / 4, expanded 180 / 6; up to 4× for tiles under 512 px  | `src/data/performanceBudget.ts`, `morphologyTileScheduling.ts` |
| Auto-contrast              | 0.5 / 99.8 percentiles, 250,000 samples from ≤ 64 tiles, 32 bins                     | `morphologyContrast.ts`                                        |
| Stripped levels            | 256 px tiles; 8 MiB / 1,024-row bands; 256 MiB of bands; strips ≤ 256 MiB decoded    | `strips.ts`                                                    |
| NDPI                       | 512 px tiles; 2 MiB bands; ~2,048 px blocks; 64 MiB of bands; DC level over 2,048 px | `ndpi.ts`, `loader.ts`                                         |
| IndexedDB byte-range cache | 256 MiB, 20,000 entries, 8 MiB per entry                                             | `persistentByteRangeCache.ts`                                  |

## Source Files

| File                                                                                                            | Role                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/datasets/imageOnlyDataset.ts`                                                                              | Image-only `SpatialDataset`                                            |
| `src/data/imagePyramid.ts`                                                                                      | `ImagePyramidLoader` interface                                         |
| `src/data/morphologyImage.ts`                                                                                   | Image opening, per-channel loaders, custom layers, Xenium image choice |
| `src/data/morphologyContrast.ts`, `tileSamples.ts`                                                              | Auto-contrast                                                          |
| `src/tiff/loader.ts`, `omeMetadata.ts`, `qptiff.ts`, `svs.ts`, `zchunkStore.ts`, `tileCache.ts`, `chunkKeys.ts` | TIFF, QPTIFF, and SVS loading                                          |
| `src/tiff/ndpi.ts`                                                                                              | NDPI layout, restart-interval bands and blocks, tiles cut from them    |
| `src/tiff/strips.ts`                                                                                            | Stripped levels: bands, reads, and tiles cut from them                 |
| `src/codecs/tiffTile.ts`, `tiffStrips.ts`, `jpeg.ts`, `jpeg2000.ts`                                             | Tile and strip decoding                                                |
| `src/workers/tileDecode.worker.ts`, `tileDecodePool.ts`, `tileDecodeMessages.ts`, `tileSamplesCore.ts`          | Decode workers                                                         |
| `src/zarr/omeZarrLoader.ts`, `zarrStores.ts`                                                                    | OME-Zarr loading                                                       |
| `src/workers/zarrDecode.worker.ts`, `zarrDecodePool.ts`, `zarrDecodeCore.ts`                                    | OME-Zarr chunk decoding and label tracing                              |
| `src/components/MorphologyCanvas.tsx`, `src/rendering/morphologyCanvas.ts`, `morphologyTileScheduling.ts`       | Drawing and scheduling                                                 |
| `src/features/morphology/*`                                                                                     | Channel controls and custom layers                                     |
| `src/features/annotations/geometricAnnotationModel.ts`                                                          | GeoJSON shapes (image-only ROI output)                                 |

## Known Limitations

- Top-level-IFD pyramids (other than QPTIFF, SVS, NDPI, and page pyramids)
  are not supported.
- Stripped TIFFs without reduced levels read every band of the image to show
  it whole, and compressed strips that decode to more than 256 MiB each are
  refused.
- TIFFs without a `.zchunkstore` make one extra request per candidate sidecar
  URL before reading the TIFF's own offsets.
- A `.zchunkstore` is checked only against the TIFF's level 0 width, height,
  and tile size, and for a complete tile list. A stale sidecar with the same
  sizes, or a root sidecar for the focus images picked up by a same-sized
  `morphology.ome.tif`, fetches the wrong bytes.
- Only one time point of OME-Zarr images (`defaultT`, else 0) is shown, and
  only `t = 0` of OME-TIFFs.
- Custom image layers open a z-stack at its middle plane but have no `Z plane`
  control.
- The 3D view shows OME-Zarr dataset images only, not OME-TIFF z-stacks or
  custom layers, and only the image: cells, outlines, transcripts, ROI and
  measurement are 2D. It assumes the GPU takes 3D textures of 2,048 voxels a
  side; WebGL2 only promises 256. The link keeps only whether the 3D view is
  open, not its camera, rendering, depth or opacity.
- Switching to a plane not opened recently reads its IFD, `SubIFDs`, and tile
  offset arrays (a few sequential range requests) before its tiles load.
- QPTIFF: the stripped smallest pyramid level is not shown. A QPTIFF whose
  IFDs are spread through the file, rather than together at the start, costs
  one 1 MiB block per IFD to open. Float (unmixed component) QPTIFFs fail like
  other float images.
- SVS: Aperio's 4× level steps mean a view just past a level switch draws
  about 7 source pixels per screen pixel. An Aperio FL scan's `.afi` file is
  not read, so its channels open one file at a time (the first as the image,
  the others as custom layers). The minimap of a single-channel or
  fluorescence slide draws the coarsest level, not the thumbnail. A JPEG 2000
  33003 tile with full-width chroma would be shown as YCbCr; no such file has
  been seen.
- NDPI: files over 4 GB are not read, and on hosts that hide
  `Content-Range` (Zenodo) they fail with a parse error rather than the
  over-4-GB message. An NDPI URL without a `.ndpi` suffix (Zenodo's
  CORS-enabled `/files/<name>/content` form) is not detected as an image.
  Only the focal plane nearest the focus
  is shown, without a `Z plane` control, and the macro image and map only
  through `#ifd=N`. Full-resolution views read whole MCU rows, many times
  the bytes of the intervals in view. Blocks decode in JavaScript (`geotiff`),
  not with the browser's JPEG decoder that SVS tiles use. A level whose
  restart intervals do not divide its MCU rows fails when its tiles load,
  not at open.
