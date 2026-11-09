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
  `/.zattrs`). The URL is reduced to the store root, and `zarr.json` and/or
  `.zattrs` are probed with `HEAD`. This happens before the Xenium probe.
- **Any other folder URL**, after the `experiment.xenium` probe fails. The
  same `zarr.json` / `.zattrs` probes run against the folder.

For each metadata file that answered, `probeSpatialDataRoot` downloads it and
calls `isSpatialDataRootMetadata` (`src/datasets/spatialDataCatalog.ts`). A
store is SpatialData when:

- `spatialdata_attrs` is present in `attributes` (Zarr v3) or at the top level
  (Zarr v2), and
- none of `coordinateTransformations`, `encoding-type`, `multiscales`, or
  `ome` is present. Those keys mark an element, not the root, so a URL pointing
  at `…/images/he` loads as a plain OME-Zarr image.

A Zarr store without `spatialdata_attrs` falls through to the
[OME-Zarr image](./image.md) path.

A [dataset manifest](../dataset-manifest.md) with `"platform": "spatialdata"`
names the store in `files.store` and skips the metadata check. Its
`options` (`coordinateSystem`, `image`, `micrometersPerUnit`) are the starting
selection: `spatialDataSelectionFor` returns them until a choice in the Dataset
tab replaces them.

## Store Access

`openSpatialDataStore` (`src/datasets/spatialDataCatalog.ts`) wraps the root in
stores from `src/zarr/zarrStores.ts`:

- **Consolidated metadata is required.** `readConsolidatedZarrMetadata` fetches
  `zarr.json` (v3, `consolidated_metadata`), `zmetadata`, and `.zmetadata` (v2,
  `zarr_consolidated_format: 1`) in parallel and uses the first valid one.
  Without it the load fails with `SpatialDataConsolidatedMetadataError`,
  because the browser cannot list object-store prefixes.
- **403 for missing metadata.** `createZarrFetchStore` treats `403` as missing
  only for metadata keys (`.zarray`, `.zgroup`, `.zattrs`, `.zmetadata`,
  `zmetadata`, `zarr.json`). Chunk `403`s are still errors.
- **Chunk cache.** `consolidatedZarrStore` answers metadata keys from memory
  and keeps every other `get` (matrix chunks, obs arrays, image tiles) in a
  256 MiB LRU (`CHUNK_CACHE_MAX_BYTES`). Range reads (`getRange`) bypass it.

## Catalog And View Selection

`readSpatialDataCatalog` lists every group exactly `<kind>/<name>` deep, where
`kind` is `images`, `labels`, `points`, `shapes`, or `tables`, and reads each
element's coordinate transforms (`src/datasets/spatialDataTransforms.ts`).

`selectSpatialDataView` then chooses what to show:

1. **Table** (`primaryTable`): the first table whose `region` names a shapes
   element, else one that names a labels element, else the first table. Other
   tables are ignored. `region`, `region_key`, and `instance_key` come from
   `spatialdata_attrs`.
2. **Coordinate system** (`bestCoordinateSystem`): candidates are ranked by
   number of the table's region elements placed in the system, then whether it
   holds an image, then total elements, then whether it is named `global`, then
   declaration order. The Dataset tab's `Coordinate system` select overrides
   it (`sdCs` in the shareable URL).
3. **Region shapes / labels**: region elements placed in that system.
4. **Image**: images placed with an axis-aligned, positive-scale affine
   (rotated, sheared, and flipped images are skipped); the one with the
   smallest x scale (highest resolution) wins unless the Dataset tab's `Image`
   select picks another (`sdImage`).
5. **Boundary candidates**: non-region shapes whose name matches
   `/(?:^|[_-])cell[_-]?(?:boundar|segmentation|polygon)/i`, for example
   `cell_boundaries`.
6. Everything else is reported as `skippedElements` in the Dataset tab log.

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

| Store path                               | Read by                                                         | Library                            | Used for                              |
| ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------- | ------------------------------------- |
| `zarr.json` / `.zattrs` (root)           | `probeSpatialDataRoot`                                          | fetch + JSON                       | Detection                             |
| `zarr.json` / `zmetadata` / `.zmetadata` | `readConsolidatedZarrMetadata`                                  | fetch + JSON                       | Element discovery                     |
| `tables/<table>/obs`, `var`, `X`, `obsm` | `AnnDataH5adDataset` (`readAnnDataZarr`)                        | `zarrita`                          | Cells, genes, annotations, embeddings |
| `shapes/<name>/shapes.parquet`           | `readSpatialDataShapes` (`src/datasets/spatialDataShapes.ts`)   | `hyparquet` (`HEAD` + range reads) | Cell positions and boundaries         |
| `images/<name>/<level>/…`                | `openOmeZarrImageWithOptions` (`src/zarr/omeZarrLoader.ts`)     | `zarrita`                          | Morphology layer                      |
| `labels/<name>/<level>/…`                | `SpatialDataLabelsReader` (`src/datasets/spatialDataLabels.ts`) | `zarrita` + decode worker          | Cell outlines                         |

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
- Rows annotating a labels region use their `obsm` spatial point mapped through
  the labels element's affine.
- Rows that match nothing get `NaN` coordinates and are hidden. If no row is
  placed, the load fails.
- Without region elements in the chosen system, the H5AD `obsm` key order is
  used.

## Shapes

`readSpatialDataShapes` reads the whole `shapes.parquet` with
`parquetReadObjects` and `hyparquet-compressors`:

- Geometry column: `geo.primary_column`, else `geometry`. WKB is decoded by
  hyparquet when GeoParquet `geo` metadata exists, otherwise by
  `geometryFromWkb` (Point, Polygon, MultiPolygon; ISO and EWKB).
- Instance ids: the first pandas `index_columns` entry, or a `RangeIndex`
  start/step.
- Points become circles with diameter from the `radius` column (default 1)
  times the affine scale.
- MultiPolygons keep only their largest polygon; holes are dropped.
- Centroid: area-weighted centroid of the transformed outer ring.

### Boundaries

`boundaryElement` chooses which shapes are drawn as cell boundaries:

- If every region shape is already a polygon, or no boundary candidate exists,
  the region shapes are drawn (circles as 32-segment polygons).
- Otherwise (for example Xenium `cell_circles` as the region) the first
  boundary candidate is drawn, matched to cells through the region instance
  ids. If no id matches, it falls back to the region geometry.

`readBoundaryIndex` precomputes outer rings for every cell; `elements(bbox)` is
a linear bbox filter over them.

## Image

The chosen image element is opened with `openOmeZarrImageWithOptions` using
the store and a planar transform from the element's affine. Per-level dataset
scales are kept; the affine supplies the base scale and origin. Extra channels
open as `#c=N` loaders through `openChannelLoader`.

Native RGB images (exactly three channels with no omero metadata, or channels
labelled/coloured red, green, blue) keep their 0–255 window: the lifecycle
passes `skipNativeRgbAutoContrast` and enables all channels.

## Units And Extent

- Coordinates are scaled to micrometers by a factor per coordinate system
  (`src/datasets/spatialDataUnits.ts`): the Dataset tab's `µm per unit`
  override (`sdUm`), else the x/y axis unit the elements declare, else an
  estimate (`cell_area` against segmentation areas, the Visium 100 µm spot
  pitch, or Visium HD `square_NNNum` bin names). When none applies the factor
  is 1 and distances are labelled as units. spatialdata-io stores usually
  declare `unit`, for example full-resolution pixels for Visium.
- `extent` is the union of the table points' bounding box and the image.
- `capabilities.cellBoundaries` is true when there is a table and at least one
  region shapes or labels element. `meta()` waits for the image to open, so a broken
  image also blocks boundary loading.

## Load Sequence

`useDatasetLifecycle` (`src/features/app-shell/useDatasetLifecycle.ts`):

1. Sets the platform to `spatialdata`; cell boundaries default to on.
2. Logs `summary()`: coordinate system, image, table, skipped elements.
3. Runs the shared `loadAnnDataOverview` (cells, gene panel, annotation sets,
   embedding options).
4. If `Morphology image` is enabled, loads the image in the background.

Gating is in `SPATIALDATA_PLATFORM_ADAPTER`
(`src/features/app-shell/platformAdapter.ts`): boundaries come from
`dataset.elements(bbox)`; transcripts, nucleus boundaries, and Magic Lens are
off.

## Source Files

| File                                    | Role                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/datasets/datasetFactory.ts`        | Root probes, `probeSpatialDataRoot`                                                                                      |
| `src/datasets/spatialDataCatalog.ts`    | Root check, store opening, catalog, view and table selection                                                             |
| `src/datasets/spatialDataTransforms.ts` | Transform parsing and affine maths                                                                                       |
| `src/datasets/spatialDataShapes.ts`     | GeoParquet / WKB shapes reader                                                                                           |
| `src/datasets/spatialDataLabels.ts`     | Label outline tracing and caching (`spatialDataLabelTrace.ts`)                                                           |
| `src/datasets/spatialDataUnits.ts`      | µm-per-unit override, declared units, and estimates                                                                      |
| `src/datasets/spatialDataDataset.ts`    | `SpatialDataDataset`: coordinates, boundaries, image, delegation to the table                                            |
| `src/datasets/h5adDataset.ts`           | AnnData table reader (`readAnnDataZarr`)                                                                                 |
| `src/zarr/zarrStores.ts`                | Fetch store, consolidated store, chunk LRU                                                                               |
| `src/zarr/omeZarrLoader.ts`             | Image pyramid                                                                                                            |
| `src/data/datasetDiagnostics.ts`        | Diagnostics: store, catalog, table presence and every table chunk, one image chunk, region `shapes.parquet` range checks |

## Known Limitations

- `points` (transcripts), additional images, and additional tables are not
  shown. Labels elements are shown only as traced cell outlines, not as a
  raster layer.
- Only one coordinate system and one image are shown at a time. They are
  chosen automatically; the Dataset tab's `Coordinate system` and `Image`
  selects override the choice and reload the store.
- Shapes are read whole, not by viewport.
- Boolean `obs` columns in the table are expected to fail the load (see
  [H5AD known limitations](./h5ad.md#known-limitations)).
- Imported CSV/JSON annotations must use Xenium-format cell IDs, so they do
  not match SpatialData obs names.
- Diagnostics send a `HEAD` for every table chunk but check only the first
  chunk of the image's coarsest level, not every image chunk.
