# SpatialData Modality

How the viewer detects and reads a [SpatialData](https://spatialdata.scverse.org/)
Zarr store. The table is read with the same AnnData code as
[H5AD](./h5ad.md), and the image uses the shared OME-Zarr loader described in
[Image sources](./image.md). For hosting requirements see
[Host your own data](../host-your-own-data.md#host-your-own-spatialdata-data).

## Detection

SpatialData is detected in one of two places in `detectSpatialDataset`
(`src/datasets/datasetFactory.ts`):

- **Zarr-looking URL** (path ends in `.zarr`, `.ome.zarr`, `/zarr.json`, or
  `/.zattrs`, or names a group inside a `.zarr` store, such as
  `sample.zarr/images/he`). The URL is reduced to the store root, and `zarr.json` and/or
  `.zattrs` are probed with `HEAD`. This happens before the Xenium probe.
- **Any other folder URL**, after the `experiment.xenium` probe fails. The
  same `zarr.json` / `.zattrs` probes run against the folder.

For each metadata file that answered, `probeZarrRootContent` downloads it and
calls `isSpatialDataRootMetadata` (`src/datasets/spatialDataCatalog.ts`). A
store is SpatialData when:

- `spatialdata_attrs` is present in `attributes` (Zarr v3) or at the top level
  (Zarr v2), and
- none of `coordinateTransformations`, `encoding-type`, `multiscales`, or
  `ome` is present. Those keys mark an element, not the root, so a URL pointing
  at `…/images/he` loads as a plain OME-Zarr image.

A Zarr store without `spatialdata_attrs` opens as [AnnData](./h5ad.md) when
its root says `encoding-type: anndata`, and otherwise falls through to the
[OME-Zarr image](./image.md) path.

A URL whose path ends in `.icechunk` is an [Icechunk](https://icechunk.io/)
repository; it is SpatialData when its root group has `spatialdata_attrs` (see
[AnnData in Icechunk](./h5ad.md#anndata-in-icechunk) for how it is opened).

A URL whose path ends in `.zip` (usually `.zarr.zip`) is a zipped store
(`detectZarrZip`). After a `HEAD` probe (a one-byte `GET` on hosts that
refuse `HEAD`, as for detection), the zip's central directory is read by
range (`openZippedZarrStore`, `src/zarr/zarrZipStore.ts`) and the store
root is the shallowest folder holding `zarr.json`, `.zgroup`, `.zattrs`, or
`zmetadata`: the top of the zip, or the `sample.zarr/` folder that zipping a
store folder keeps. Backslashes in entry names, as some Windows tools write
them, are read as `/`. `__MACOSX/` is ignored, and a zip with no store or with
two side by side is an error. The store is SpatialData when its root
metadata passes `isSpatialDataRootMetadata`, or, since some writers (for
example the STHELAR exports) leave root attributes out, when the root holds
`images`, `labels`, `points`, `shapes`, or `tables` groups and its attributes
do not mark an image or AnnData. A zipped OME-Zarr image (root
`multiscales` or `bioformats2raw.layout`) opens as an
[image](./image.md); a zip holding any other Zarr store is an error.

A [dataset manifest](../dataset-manifest.md) with `"platform": "spatialdata"`
names the store in `files.store` and skips the metadata check. Its
`options` (`table`, `coordinateSystem`, `image`, `micrometersPerUnit`) are the
starting selection: `spatialDataSelectionFor` returns them until a choice in the info
drawer's View options replaces them, once the reload that choice starts
replaces the view on screen.

## Store Access

`openSpatialDataStore` (`src/datasets/spatialDataCatalog.ts`) wraps the root in
stores from `src/zarr/zarrStores.ts`:

- **Consolidated metadata is required.** `readConsolidatedZarrMetadata` fetches
  `zarr.json` (v3, `consolidated_metadata`), `zmetadata`, and `.zmetadata` (v2,
  `zarr_consolidated_format: 1`) in parallel and uses the first valid one.
  Without it the load fails with `SpatialDataConsolidatedMetadataError`,
  because the browser cannot list object-store prefixes. An Icechunk
  repository's snapshot lists every node's metadata, so it stands in for
  consolidated metadata.
- **403 for missing metadata.** `createZarrFetchStore` treats `403` as missing
  only for metadata keys (`.zarray`, `.zgroup`, `.zattrs`, `.zmetadata`,
  `zmetadata`, `zarr.json`). Chunk `403`s are still errors.
- **Chunk cache.** `consolidatedZarrStore` answers metadata keys from memory
  and keeps every other `get` (matrix chunks, obs arrays, image tiles) in a
  256 MiB LRU (`CHUNK_CACHE_MAX_BYTES`). Range reads (`getRange`) bypass it.
- **Zipped stores.** For a `.zip` URL the base store is zarrita's
  `ZipFileStore` over `CachedHttpRangeReader` (`src/zarr/cachedZipStore.ts`),
  with keys relative to the store root inside the zip. Each entry is read with
  two ranges, its local header and its data; ranges up to 8 MiB go through
  the persistent byte-range cache. Range requests are sent with
  `cache: 'no-store'`: Chromium's HTTP cache lets one Range request to a URL
  through at a time, and every entry of a zip shares its URL, so image tiles
  and table chunks waited behind the shapes download. On the 460-plex at
  32 Mbit/s the cells were ready 11 s sooner (2026-11-18). Entries stored without compression are
  read by range; deflated entries are read and inflated whole. The opened zip
  is returned as `zip` and kept in a four-entry cache, so detection, the
  dataset, and diagnostics share one central-directory read; diagnostics
  check every table, image, and labels chunk and each `shapes.parquet`
  against the zip directory instead of with requests. Consolidated metadata
  is still required.

## Catalog And View Selection

`readSpatialDataCatalog` lists every group exactly `<kind>/<name>` deep, where
`kind` is `images`, `labels`, `points`, `shapes`, or `tables`, and reads each
element's coordinate transforms (`src/datasets/spatialDataTransforms.ts`).

`selectSpatialDataView` then chooses what to show:

1. **Table** (`primaryTable`): the first table by name whose `region` names a
   shapes element, else one that names a labels element, else the first table.
   Among Visium HD bin tables (named or annotating `square_NNNum`, as
   spatialdata-io writes them), only the coarsest bin counts, so a Visium HD
   store opens on `square_016um` rather than its millions of 2 µm bins. The
   `Table` select in the info drawer's View options overrides it (`sdTable` in
   the shareable URL); one table is read at a time, and the others are listed
   among the skipped elements. `region`, `region_key`, and `instance_key` come
   from `spatialdata_attrs`.
2. **Coordinate system** (`bestCoordinateSystem`): candidates are ranked by
   number of the table's region elements placed in the system, then whether it
   holds an image, then total elements, then whether it is named `global`, then
   declaration order. The `Coordinate system` select in the info drawer's View
   options overrides it (`sdCs` in the shareable URL).
3. **Region shapes / labels**: region elements placed in that system.
4. **Image**: images placed with an affine that only scales, flips, or swaps
   x and y (`axisPermutingAffine`); rotated and sheared images are skipped.
   Off-axis terms under 1e-4 of the scale are dropped first, so STHELAR's
   H&E, an x/y swap and flip with a 1.9e-5 rad registration turn, is shown.
   The one with the smallest pixel (highest resolution) wins unless the View
   options `Image` select picks another (`sdImage`).
5. **Boundary candidates**: non-region shapes whose name matches
   `/(?:^|[_-])cell[_-]?(?:boundar|segmentation|polygon)/i`, for example
   `cell_boundaries`.
6. **Nucleus candidates**: non-region shapes whose name matches
   `/(?:^|[_-])nucle(?:us|i)[_-]?(?:boundar|segmentation|polygon)/i`, for
   example spatialdata-io's Xenium `nucleus_boundaries`. A table that
   annotates the nuclei itself (STHELAR's `table_nuclei`) draws them as its
   cells instead.
7. Everything else, including images other than the one shown, is reported
   as `skippedElements` in the activity log.

### Supported Transforms

`transformationToAffine` converts each transform to a 2D affine:

| Type          | Notes                                                       |
| ------------- | ----------------------------------------------------------- |
| `identity`    |                                                             |
| `scale`       | Uses the x and y axis values                                |
| `translation` | Two values are read as (x, y); otherwise trailing (…, y, x) |
| `affine`      | Rows picked by output axes                                  |
| `mapAxis`     | x/y swaps only                                              |
| `sequence`    | Composed in order                                           |

Any other type, or a non-finite value, raises
`SpatialDataTransformUnsupportedError` and that element is dropped from that
coordinate system.

## Files Read

| Store path                               | Read by                                                         | Library                                              | Used for                                    |
| ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `zarr.json` / `.zattrs` (root)           | `probeZarrRootContent`                                          | fetch + JSON                                         | Detection                                   |
| `zarr.json` / `zmetadata` / `.zmetadata` | `readConsolidatedZarrMetadata`                                  | fetch + JSON                                         | Element discovery                           |
| `tables/<table>/obs`, `var`, `X`, `obsm` | `AnnDataH5adDataset` (`readAnnDataZarr`)                        | `zarrita` + decode worker (codecs)                   | Cells, genes, annotations, embeddings       |
| `shapes/<name>/shapes.parquet`           | `readSpatialDataShapes` (`src/datasets/spatialDataShapes.ts`)   | `hyparquet` in a worker (range reads, or zip slices) | Cell positions, cell and nucleus boundaries |
| `images/<name>/<level>/…`                | `openOmeZarrImageWithOptions` (`src/zarr/omeZarrLoader.ts`)     | `zarrita`                                            | Morphology layer                            |
| `labels/<name>/<level>/…`                | `SpatialDataLabelsReader` (`src/datasets/spatialDataLabels.ts`) | `zarrita` + decode worker                            | Cell outlines                               |

`points` (transcripts), extra images, and extra tables are not read. Label
chunks in view are decoded and traced into cell outlines in the Zarr decode
worker when you zoom in below `Boundary limit`.

## Table

`SpatialDataDataset.readState` (`src/datasets/spatialDataDataset.ts`) creates
an `AnnDataH5adDataset` with a `zarrSource` over the consolidated store. The
table's `obs`, `var`, `X`, and `obsm` follow exactly the
[H5AD layout rules](./h5ad.md#hdf5-layout-read): index and gene-name
selection, categorical annotations, dense/CSR/CSC expression, and obsm
embeddings.

Coordinates come from `resolveTableCoordinates` instead of `obsm` when the
table annotates regions in the chosen coordinate system:

- Each row's `instance_key` value (or obs name) and `region_key` value (or the
  single region) select a shape. The row is placed at the shape's centroid.
  Tables usually list rows in shape order, so the shape after the last match
  is tried first; an id `Map` is built only when that misses (`ShapeLookup`).
  A 64-bit integer `instance_key` is compared as an exact integer
  (`readObsInstanceIds`), so IDs above 2^53, such as spatialdata-io's MERSCOPE
  `EntityID`s, are not rounded together. Before 2026-11 they were, and such a
  table placed no row.
- Rows annotating a labels region use their `obsm` spatial point mapped through
  the labels element's affine.
- Rows that match nothing get `NaN` coordinates and are hidden. If no row is
  placed, the load fails.
- Without region elements in the chosen system, the H5AD `obsm` key order is
  used.

The Plots panel reads the table's `X` as for [AnnData over HTTP](./h5ad.md#feature-read-paths).
A store without a table says Plots have nothing to read. The Visium example's
CSR table (4,992 spots, 29.7 million stored values) is 227 MiB of values and
indices, so the panel asks before reading it; it downloads 16 MB and plots in
about 7 s.

## Shapes

`readSpatialDataShapes` reads the whole `shapes.parquet` with
`parquetReadObjects` and `hyparquet-compressors`, in a shapes worker started
by `readSpatialDataShapesInWorker` (`src/datasets/spatialDataShapesWorker.ts`).
The worker fetches a plain URL itself. In a zipped store the file is the zip
entry, read on the main thread and handed to the worker slice by slice; a
custom fetcher is handled the same way. Without a `Worker`, or if the worker
fails to start, the file is read on the main thread.

The shapes come back as transferred columns (`SpatialDataShapes`): per shape
an instance id, a kind (circle or polygon), centroid, radius, ring area, and
bounds, plus every outer ring in one `Float32Array` with offsets. The main
thread keeps no object or typed array per shape.

- Geometry column: `geo.primary_column`, else `geometry`. hyparquet's GeoJSON
  decoding is replaced (`WKB_PARSERS`) so the WKB bytes are read straight into
  typed rings (Point, Polygon, MultiPolygon; ISO and EWKB, 2D to 4D).
  GeoJSON-shaped values are still accepted.
- Instance ids: the first pandas `index_columns` entry, or a `RangeIndex`
  start/step.
- Points become circles with diameter from the `radius` column (default 1)
  times the affine scale.
- Polygons keep only the outer ring of their largest polygon, as interleaved
  x, y in the shared ring buffer. A 598,222-cell Xenium `cell_boundaries`
  (about 15 million vertices) holds about 120 MB.
- Centroid: area-weighted centroid of the transformed outer ring.

### Boundaries

`boundaryElement` chooses which shapes are drawn as cell boundaries:

- If every region shape is already a polygon, or no boundary candidate exists,
  the region shapes are drawn (circles as 32-segment polygons).
- Otherwise (for example Xenium `cell_circles` as the region) the first
  boundary candidate is drawn, matched to cells through the region instance
  ids. If no id matches, it falls back to the region geometry.
- A table that annotates labels instead has every labels region with rows
  traced, so a table over one labels element per field of view (spatialdata-io
  CosMx) is outlined in every field.

`readBoundaryIndex` keeps, per cell, the index of its shape in the shape
columns and its bounds in µm; `elements(bbox)` is a linear bounds filter over
them that builds polygon elements, scaled to µm, only for the cells it
returns, reusing the previous request's elements for cells still in view.

### Nucleus Boundaries

The first nucleus candidate is drawn as the nucleus layer behind the
`Nucleus boundaries` checkbox, which the Cells section offers only for a
store that has one. `segmentationElements('nucleus', bbox)` reads the whole
`shapes.parquet` the first time the checkbox is on, in the shapes worker, and
filters it by bounds like the cell outlines. Nuclei are matched to table
rows through the region shapes that share their index (spatialdata-io indexes
`cell_boundaries` and `nucleus_boundaries` by cell id), or by the table's
cell ids when the table annotates labels. A cell's first nucleus keeps its
id and later ones get `<id>#nucleus-N`, as on Xenium; each matched nucleus
names its cell (segmentation metadata `cellId`), so hovering it shows the
cell, a click selects it, and the Cell card lists the cell's nuclei in view.
Nuclei that match no row are left out; when none match, every nucleus is
drawn and the log says so. `meta().segmentations` lists the cell and nucleus
outlines. Cell and nucleus outlines are separate viewport requests, and cell
outlines are read only while `Cell boundaries` is on, so neither waits for
the other. On STHELAR bone marrow all 225,906 nuclei matched; in one run on
2026-11-17 the cell outlines were drawn 0.1 s after the view opened and the
nuclei 6.8 s later, most of it the 19.4 MB compressed zip entry from
the BioImage Archive.

## Image

The chosen image element is opened with `openOmeZarrImageWithOptions` using
the store and a planar transform from the element's affine. Per-level dataset
scales are kept; the affine supplies the base scale and origin. Extra channels
open as `#c=N` loaders through `openChannelLoader`, and other planes of a
z-stack as `#z=N` loaders.

A flipped or axis-swapped affine (`planarTransformFromAffine`) gives the
loader the absolute scales and a `placement`, an `ImageFramePlacement` in
`src/data/coords.ts`: a signed axis permutation and translation from the
loader's frame (x along image columns, y along rows) to the coordinate
system. Tiles keep their frame bounds. The morphology canvas
(`MorphologyCanvas`, the minimap included) selects and caches tiles for the
viewport mapped into the frame (`unplaceFrameBbox`), snaps each tile's placed
bounds to whole pixels, and draws the tile turned into place about its
centre. The extent uses the placed image bounds. STHELAR's `he` (37,252 ×
11,024 px) lands landscape over the DAPI `morpho` image, with nuclei on the
hematoxylin.

Native RGB images (exactly three channels with no omero metadata, or channels
labelled/coloured red, green, blue) keep their 0–255 window: the lifecycle
passes `skipNativeRgbAutoContrast` and enables all channels. Other images
start with their first six channels on.

## Units And Extent

- Coordinates are scaled to micrometers by a factor per coordinate system
  (`src/datasets/spatialDataUnits.ts`): the View options `µm per unit`
  override (`sdUm`), else the x/y axis unit the elements declare, else the
  Xenium pixel size, else an estimate (`cell_area` against segmentation areas,
  the Visium 100 µm spot pitch, or Visium HD `square_NNNum` bin names). When
  none applies the factor is 1 and distances are labelled as units.
  spatialdata-io stores usually declare `unit`, for example full-resolution
  pixels for Visium.
- spatialdata-io's Xenium reader copies the run's `experiment.xenium` into
  the table's `uns/xenium`. Its `pixel_size` (µm per morphology pixel),
  divided by the scale of the `morphology_focus` (or `morphology_mip`) image
  into the coordinate system, is the factor (`xeniumPixelSizeUnits`, source
  `declared`). It is read only when the consolidated metadata lists the
  array and that image is placed in the coordinate system.
- An override, declared units, or the pixel size are known before the
  table's rows are placed (`presetUnits`), so the image opens without waiting
  for the region shapes. Estimated units wait for the placement, and the image
  with them.
- `extent` is the union of the table points' bounding box and the image.
- `capabilities.cellBoundaries` is true when there is a table and at least one
  region shapes or labels element. Boundary loading reads `meta()` first, and
  `meta()` treats an image that fails to open as no image, so a broken image
  does not block outlines; its error is shown by the morphology layer.

## Load Sequence

`useDatasetLifecycle` (`src/features/app-shell/useDatasetLifecycle.ts`):

1. Sets the platform to `spatialdata`; cell boundaries default to on and
   nucleus boundaries to off, unless the link says otherwise
   (`nucleusBounds`).
2. If `Morphology image` is enabled, starts loading the image in the
   background, alongside the steps below: it needs the store's metadata and
   units, not the shapes that place the table's rows. When another dataset is
   open, the image is shown once the new cells replace it. On a first load it
   can show before the cells, and the view fits the image until they arrive.
3. Logs `summary()`: coordinate system, image, table, skipped elements.
4. Runs the shared `loadAnnDataOverview` (cells, gene panel, annotation sets,
   embedding options).

Gating is in `SPATIALDATA_PLATFORM_ADAPTER`
(`src/features/app-shell/platformAdapter.ts`): boundaries come from
`dataset.elements(bbox)` and nuclei from `segmentationElements`, with the
nucleus checkbox shown only when `summary().nuclei` names an element
(`nucleusBoundaryControlsVisibleFor`); transcripts and Magic Lens are off.

## Source Files

| File                                    | Role                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/datasets/datasetFactory.ts`        | Root probes, `probeZarrRootContent`                                                                                |
| `src/datasets/spatialDataCatalog.ts`    | Root check, store opening, catalog, view and table selection                                                       |
| `src/datasets/spatialDataTransforms.ts` | Transform parsing and affine maths                                                                                 |
| `src/datasets/spatialDataShapes.ts`     | GeoParquet / WKB shapes reader and shape columns, run in a worker by `spatialDataShapesWorker.ts` (`src/workers/`) |
| `src/datasets/spatialDataLabels.ts`     | Label outline tracing and caching (`spatialDataLabelTrace.ts`)                                                     |
| `src/datasets/spatialDataUnits.ts`      | µm-per-unit override, declared units, and estimates                                                                |
| `src/datasets/spatialDataDataset.ts`    | `SpatialDataDataset`: coordinates, boundaries, image, delegation to the table                                      |
| `src/datasets/h5adDataset.ts`           | AnnData table reader (`readAnnDataZarr`)                                                                           |
| `src/zarr/zarrStores.ts`                | Fetch store, consolidated store, chunk LRU                                                                         |
| `src/zarr/zarrZipStore.ts`              | Zipped stores: central directory, store root, Parquet entries                                                      |
| `src/zarr/omeZarrLoader.ts`             | Image pyramid                                                                                                      |
| `src/data/datasetDiagnostics.ts`        | Diagnostics: store, catalog, table chunks, image and labels chunks, drawn `shapes.parquet` and nucleus shapes      |

## Known Limitations

- An Icechunk repository holds only Zarr arrays and groups, so a SpatialData
  store copied into one keeps its images, labels, and tables but not its
  shapes and points, which are Parquet files. Copy every Zarr key
  (`zarr.json` and chunk keys) into the repository's store; tested with
  spatialdata's `blobs` example (labels, image, table).
- `points` (transcripts), additional images, and additional tables are not
  shown. Labels elements are shown only as traced cell outlines, not as a
  raster layer, and nucleus labels (`nucleus_labels`) are not traced.
- `points` could be read by viewport only coarsely. In the 460-plex example
  (503.5 million transcripts, 8.8 GB in 190 Parquet parts, stored in the zip)
  every row group carries x/y min/max: parts are x strips 250-1,000 µm wide
  and row groups are y bands of about a million rows within them. There is
  no page index, so a 100 µm view still reads 6 row groups (4.7 million
  rows, 23 MB of x, y, gene, and QV), a 500 µm view 45 MB, and the whole
  slide 2.35 GB. STHELAR's `points/st` is one deflated zip entry (156 MB)
  that would be read whole. Checked 2026-11-17 by reading every footer.
- Only one coordinate system and one image are shown at a time. They are
  chosen automatically; the `Coordinate system` and `Image` selects in View
  options override the choice and reload the store.
- Only one table is read at a time. Every table is offered in the `Table`
  select, including tables that annotate no region (such as STHELAR's
  `features_*` embeddings). Those place rows from `obsm` as an H5AD would, so
  they fail to load when `obsm` has none of the
  [coordinate keys](./h5ad.md#coordinates-obsm).
- Images placed with a rotated or sheared affine are skipped; they are
  listed only among the skipped elements in the activity log. Flips, x/y
  swaps, and turns by multiples of 90° are shown, and turns under 1e-4 rad
  are dropped.
- Labels read only `z = 0`, and neither images nor labels have a `t` choice.
  Images open on `omero.rdefs.defaultZ`, else the middle plane, and have the
  `Z plane` control like other z-stacks.
- Polygon holes, and every part of a MultiPolygon but the largest, are
  dropped.
- Shapes are read whole, not by viewport. spatialdata-io writes
  `shapes.parquet` as one row group with no per-shape bounding boxes (598,222
  rows in the 460-plex example), so a range read cannot skip cells out of
  view. The 97 MB download and decode run in a worker.
- A zipped store needs consolidated metadata like any other. Deflated zip
  entries are read whole, so a compressed `shapes.parquet` is downloaded in
  full before any of it is parsed.
- Over HTTP, diagnostics send a `HEAD` for the first 2,000 table chunks and
  check only the first chunk of the coarsest level of the image and of each
  labels region. A zipped store has every chunk checked against its
  directory; image and labels chunks absent only from finer levels pass with
  a note, as writers such as zarr-python 3 skip empty chunks (304 of 1,148 in
  the 460-plex image).
