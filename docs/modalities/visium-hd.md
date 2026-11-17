# Visium HD Modality

How the viewer detects and reads a 10x Space Ranger Visium HD output folder
(usually `outs/`). For hosting requirements see
[Host your own data](../host-your-own-data.md#host-your-own-visium-hd-data);
for the 2 µm design decision see
[Visium HD 2 µm strategy](../visium-hd-2um-strategy.md).

## Detection

Visium HD is the last platform `detectSpatialDataset`
(`src/datasets/datasetFactory.ts`) tries: after the `.h5ad`, Zarr, and TIFF
URL checks, the `experiment.xenium` probe, and the root Zarr metadata probes.

- **Bin tiers.** For each tier in `VISIUM_HD_BINS`, in the order 2, 8, 16 µm,
  three `HEAD` requests run in parallel. A tier counts as present only when all
  three succeed (`visiumHdRequiredBinPaths`):
  - `binned_outputs/square_XXXum/spatial/tissue_positions.parquet` for 8 and
    16 µm; for 2 µm, whose positions file is not read,
    `binned_outputs/square_002um/filtered_feature_bc_matrix/barcodes.tsv.gz`
  - `binned_outputs/square_XXXum/spatial/scalefactors_json.json`
  - `binned_outputs/square_XXXum/filtered_feature_bc_matrix.h5`

- **Segmented outputs.** Eight `HEAD` probes under `segmented_outputs/`
  (`VISIUM_HD_SEGMENTED_OUTPUT_PROBES`) record which segmentation files exist.
- The platform is `visium-hd` when at least one tier is present.

A [dataset manifest](../dataset-manifest.md) with `"platform": "visium-hd"`
skips the earlier probes. Its `files.bins` list replaces the tier probe (each
listed bin's three files, as above, are checked with `HEAD`, and a missing one
is an error), `files.segmentedOutputs` replaces the segmented-output probes, and
`options.binSize` sets the first tier shown. `featureSlice` and
`barcodeMappings` can also be relocated.

`createSpatialDataset` lazy-imports `VisiumHdDataset`
(`src/datasets/visiumHdDataset.ts`), a thin wrapper around
`VisiumHdDatasetReaderController` (`src/datasets/visiumHdDatasetReaders.ts`).

## Files Read

`T` is `binned_outputs/square_{002,008,016}um`.

| Path                                                                                                                                            | Required              | Read by                                                                                                                 | Library                                   | What is read                                                                                                                     | Used for                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `T/spatial/tissue_positions.parquet` (8, 16 µm)                                                                                                 | Yes (not for 2 µm)    | `readVisiumHdTissuePositions` (`visiumHdOverview.ts`)                                                                   | `hyparquet`, footer in IndexedDB          | `barcode`, `in_tissue`, `array_row`, `array_col`, `pxl_row_in_fullres`, `pxl_col_in_fullres`                                     | 8/16 µm bin grid                                                                  |
| `T/spatial/scalefactors_json.json`                                                                                                              | Yes                   | `readVisiumHdScalefactors`                                                                                              | fetch + JSON                              | `microns_per_pixel`, `tissue_hires_scalef`, `tissue_lowres_scalef`; optional image sizes, `bin_size_um`, `spot_diameter_fullres` | Units, image scaling, segmentation scaling                                        |
| `T/filtered_feature_bc_matrix.h5`                                                                                                               | Yes                   | `gexFromFeatureBarcodeMatrixH5` (`src/data/gex.ts`) in `h5File.worker.ts`                                               | `h5wasm`, range-read file in a worker     | `/matrix/barcodes`, `/matrix/features/{name,feature_type}`, `/matrix/indptr`; `indices`/`data` sliced                            | All-gene bin and cell profiles, ROI gene stats, Magic Lens without selected genes |
| `T/filtered_feature_bc_matrix/barcodes.tsv.gz` (2 µm)                                                                                           | For 2 µm              | `readVisiumHdFilteredMatrixBarcodes` (`visiumHdBarcodes.ts`)                                                            | fetch + `DecompressionStream`, streamed   | Barcodes parsed with `/^(?:s\|square)_(\d{3})um_(\d+)_(\d+)(?:-\d+)?$/`, a line at a time                                        | 2 µm bin grid                                                                     |
| `T/filtered_feature_bc_matrix/features.tsv.gz`                                                                                                  | Optional              | `readVisiumHdFeatureGenePanel`                                                                                          | fetch + gunzip                            | Columns 1 (name) and 2 (type), gene features only                                                                                | Gene search list                                                                  |
| `feature_slice.h5` (root)                                                                                                                       | For gene overlays     | `gexFromVisiumFeatureSliceH5` (`src/data/visiumFeatureSlice.ts`) in `h5File.worker.ts`                                  | `h5wasm`, range-read file in a worker     | Root `metadata_json` (`nrows`, `ncols`, `spot_pitch`), `/features/{name,feature_type}`, `/feature_slices/<i>/{row,col,data}`     | Selected-gene bin colouring                                                       |
| `feature_slice.h5` `metadata_json` `transform_matrices.spot_colrow_to_microscope_colrow`                                                        | With only a 2 µm tier | `readVisiumFeatureSliceH5Metadata`, in the worker that serves its gene reads                                            | `h5wasm`, range-read file in a worker     | The 3×3 spot (col, row) → full-resolution pixel transform                                                                        | 2 µm grid basis when there is no 8 or 16 µm tier                                  |
| `T/analysis/clustering/<clustering>/clusters.csv` (8, 16 µm)                                                                                    | Optional              | `readVisiumHdClusteringGroups`, `readVisiumHdClusterAnnotations` (`visiumHdClusters.ts`)                                | `HEAD`; fetch + CSV                       | `Barcode,Cluster` for `gene_expression_graphclust` and `gene_expression_kmeans_{2..10}_clusters`                                 | Annotation sets for the tier's bins                                               |
| `barcode_mappings.parquet` (root)                                                                                                               | Optional              | `readVisiumHdBarcodeMappings` (hyparquet); `readVisiumHdBarcodeMappingsForCellWithDuckDb`                               | `hyparquet` / DuckDB-WASM                 | `square_002um`, `square_008um`, `square_016um`, `cell_id`, `in_nucleus`, `in_cell`                                               | Bin→cell assignment, segmented-cell profiles, expression projection               |
| `T/spatial/tissue_hires_image.png`                                                                                                              | Optional              | `VisiumHdDatasetReaderController.image()`                                                                               | `HTMLImageElement`                        | Whole PNG                                                                                                                        | Tissue underlay                                                                   |
| `T/analysis/{umap,tsne}/…/projection.csv`, then root `analysis/…`                                                                               | Optional              | `loadDatasetAnalysisEmbeddings` (`src/data/analysisEmbeddings.ts`)                                                      | fetch + CSV                               | Barcode column plus two axis columns                                                                                             | Embedding view for the active tier                                                |
| `segmented_outputs/cell_segmentations.geojson`, else `graphclust_annotated_cell_segmentations.geojson`                                          | Optional              | `readVisiumHdSegmentationIndexInWorker` (`visiumHdSegmentationIndexWorker.ts`) in `visiumHdSegmentationIndex.worker.ts` | fetch; streaming JSON scanner in a worker | Polygon/MultiPolygon in full-res pixels, `cell_id`, label and colour properties                                                  | Cell boundaries                                                                   |
| `segmented_outputs/nucleus_segmentations.geojson`, else `graphclust_annotated_nucleus_segmentations.geojson`, else `nucleus_instance_mask.tiff` | Optional              | Same, or `readVisiumHdNucleusInstanceMaskRasterFromTiff` (`visiumHdSegmentations.ts`)                                   | JSON scanner / `geotiff` windowed read    | Polygons, or mask labels traced into polygons                                                                                    | Nucleus boundaries                                                                |

`T/spatial/tissue_lowres_image.png` is drawn instead of the high-res PNG when
that cannot be read (a `HEAD` decides), with a notice naming the skipped path.

Probed or diagnosed but **never read**: the 2 µm `tissue_positions.parquet`
(171 MB and 11.2 million rows on the reference dataset, read by no check),
`segmented_outputs/spatial/scalefactors_json.json`,
`segmented_outputs/filtered_feature_cell_matrix.h5`, and
`segmented_outputs/raw_feature_cell_matrix.h5`. Clustering CSVs, CytAssist
images, and full-resolution microscope images are not supported.

## Coordinates And Units

- `meta().units.micrometersPerPixel` is `microns_per_pixel` from the active
  tier's scalefactors.
- Data coordinates are full-resolution pixels × `microns_per_pixel`, origin
  top-left, y down.
- `extent` is the min/max of bin centres.
- Each tier is a `SpatialGrid` (`src/datasets/spatialGrid.ts`) with an origin,
  row step, and column step. Bins are drawn as grid-cell quads by
  `gridCellCorners` (`src/rendering/gridCellRenderer.ts`).

## Bin Grids

### Default Tier

`preferredDefaultBinSize` picks 16 µm, else 8 µm, else the first detected
tier.

### 8 µm And 16 µm

`readBinnedOverview(size)` → `readVisiumHdBinnedOverview`
(`src/datasets/visiumHdOverview.ts`):

1. Reads the tier's `tissue_positions.parquet` in full and keeps
   `in_tissue === 1` rows.
2. Fits the grid basis by least squares on up to 10,000 sampled bins
   (`fitGridBasis`).
3. For 16 µm when 8 µm exists, derives the 16 µm basis from the 8 µm one
   (`deriveNestedGridBasis`). Loading the default 16 µm tier therefore also
   reads the 8 µm positions file.
4. Emits a columnar `GridCellBatch` with grid id `visium-hd-square-016um` (or
   `008um`).

### 2 µm

`readTwoMicrometerOverviewFromFilteredBarcodes` builds the 2 µm grid without
the 2 µm positions file:

1. Loads the 8 µm overview (or 16 µm if 8 µm is missing), the 2 µm
   scalefactors, and the 2 µm `barcodes.tsv.gz` in parallel. The barcodes
   stream into columns (ids, `Int32Array` rows and columns) as they download:
   the reference file is 20 MB gzipped, 3,443,936 lines and 75 MB of text,
   and neither is held whole.
2. Halves the source basis down to 2 µm (`deriveSubdividedGridBasis`).
3. Places each barcode by its encoded row/column. All bins are treated as in
   tissue.

**With only a 2 µm tier** (2026-11-17), step 1 reads `feature_slice.h5`'s
metadata instead of a coarser tier. Its
`transform_matrices.spot_colrow_to_microscope_colrow` is the 3×3 projective
transform Space Ranger places every bin with; on the reference it reproduces
`tissue_positions.parquet` to 1e-11 pixels. The grid is affine, so
`visiumHdGridBasisFromFeatureSlice` fits a basis to the transform at 17 × 17
points over the slide; that places each 2 µm bin within 0.08 full-resolution
pixels of Space Ranger's position, as the 8 µm-derived basis does (0.075).
Without a readable `feature_slice.h5`, or one with no transform, the load
fails with `VisiumHdTwoMicrometerOverviewDisabledError`, naming the file.

### Zoom Level Of Detail

- **Grid.** With 2 µm selected and zoom below 3
  (`VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN`), `useVisiumHdGridLodWorkflow` shows the
  16 µm grid instead, when 16 µm exists. `viewerGridCellIndex.ts` also builds
  colour-averaged 16 µm aggregates for rendering 2 µm grids zoomed out. Those
  stand-in and aggregate cells cannot be clicked or hovered.
- **Gene expression.** `planGeneExpressionLod`
  (`src/data/geneExpressionLod.ts`) requests 16 µm data for a 2 µm selection
  below zoom 3, and for an 8 µm selection at zoom −1.25 or lower. At zoom
  −1.25 or lower the request covers the whole slide. A dataset with no 16 µm
  tier reads 16 µm expression for bins made from its finest tier
  (`coarsenVisiumHdBinnedOverview`): Feature Slice counts bin to any multiple
  of the spot pitch, and the bins are named as Space Ranger names 16 µm
  barcodes. On the 2 µm-only reference that is 54,000 bins rather than 3.4
  million.

## Feature Read Paths

| Feature                    | Path                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selected-gene overlay      | `geneExpression(bbox, genes)` reads `feature_slice.h5` in a worker, sums counts into the active bin size (`floor(row / (binSize / spot_pitch))`), and colours bins. There is no fallback to the filtered matrix.                                                                                                                                                  |
| Bin card: assignment       | `useGridCellAssignmentWorkflow` reads the row groups of `barcode_mappings.parquet` that can hold the bin and finds its segmented cell                                                                                                                                                                                                                             |
| Bin card: all-gene profile | `useVisiumHdExpressionProfileWorkflow` calls `matrix([barcode], binSize)` on the tier's filtered matrix                                                                                                                                                                                                                                                           |
| Segmented-cell profile     | DuckDB-WASM query on `barcode_mappings.parquet` for one `cell_id`, then `matrix()` over those bins at the active size. The segmented `filtered_feature_cell_matrix.h5` is not used.                                                                                                                                                                               |
| Cell/nucleus boundaries    | `elements(bbox)` / `segmentationElements('nucleus', bbox)`. Each GeoJSON is read once into a columnar index; each viewport selects the polygons whose bounds meet its box. A nucleus's `cell_id` is kept in its own index column, so nuclei name their cell. Loading is gated by the boundary viewport rule (see [Xenium](./xenium.md#viewport-cell-boundaries)). |
| Expression projection      | `useVisiumHdExpressionProjectionWorkflow` splits each bin's count across its mapped cells; the result feeds status text                                                                                                                                                                                                                                           |
| Tissue image               | The active tier's `tissue_hires_image.png`, drawn at `(px / tissue_hires_scalef) × microns_per_pixel`. No pyramid; `tissue_lowres_image.png` at `tissue_lowres_scalef` when the high-res PNG cannot be read.                                                                                                                                                      |
| Embeddings                 | Per-tier `projection.csv`, then root `analysis/`                                                                                                                                                                                                                                                                                                                  |
| ROI                        | `useVisiumHdRoiWorkflow` selects bins whose centre is inside the box/lasso (up to 50,000), then `matrix(barcodes, binSize)`; exports barcodes CSV and GeoJSON                                                                                                                                                                                                     |
| Magic Lens                 | `useVisiumHdMagicLensSummary`: up to 25,000 bins; `matrix()` when no genes are selected, otherwise selected-gene expression filtered to the lens                                                                                                                                                                                                                  |
| Annotations                | `annotationGroups(binSize)` lists the tier's clusterings by `HEAD`; `annotations({ groupId })` reads one `clusters.csv` into one annotation per cluster. Bins are coloured by their barcode, and hovering one names its cluster                                                                                                                                   |

Visium HD has no transcript records.

### Annotations

Space Ranger clusters each 8 and 16 µm tier's bins, graph-based and by k-means
for k = 2 to 10, and writes each clustering to
`analysis/clustering/<clustering>/clusters.csv`. The 2 µm tier has none. A
clustering's barcodes are one tier's bins, so:

- **Sets are per tier.** A set's id names its tier and clustering, as in
  `visium-hd-clusters:16:gene_expression_graphclust`, and its label is
  Xenium's (`graphclust`, `kmeans 10`); graph-based is chosen first.
  `useVisiumHdAnnotationSetsWorkflow` lists the active tier's sets whenever
  the tier changes.
- **A loaded set follows the tier.** After a bin-size switch, a set loaded for
  the old tier is read again for the new one when it has the same clustering,
  keeping the colour mode, and cleared when it does not (2 µm). Imported
  labels loaded with it are dropped.
- **Classes keep their colours.** Annotation ids are
  `analysis:<clustering>:<cluster>`, without the tier, so a class's colour and
  visibility carry across tiers. The panel lists them under the set name, as
  for Xenium and H5AD.
- **"All"** reads every clustering of the active tier: ten files, about 13 MB
  at 16 µm and 50 MB at 8 µm on the reference.

On the reference, listing a tier's sets is ten `HEAD` requests, and
`graphclust` loads 54,504 bins in 16 clusters at 16 µm (1.3 MB) and 215,196 in
16 at 8 µm (5.2 MB).

The Plots panel is shown, as for other datasets with annotations, and says
it is not available: Visium HD has no matrix it can read by gene.

## Load Sequence

`useDatasetLifecycle` (`src/features/app-shell/useDatasetLifecycle.ts`):

1. Sets the platform to `visium-hd`; cell and nucleus boundaries default to off.
2. Starts the gene panel (`features.tsv.gz`) without blocking.
3. Awaits `readBinnedOverview()` and `meta()`, renders the grid, and fills the
   bin-size control in Bins › Appearance.
4. If `Tissue image` is enabled, loads the hires PNG in the background.
5. Once the dataset is ready, lists the tier's annotation sets.

Changing the bin size runs `useVisiumHdBinWorkflow`. The drawn tier stays on
screen until the new one is ready, and the `Active bins` row names it, as in
"54,504 at 16 µm view; 2 µm selected"; after a failed load it still does. A
failed load leaves the dataset open on that tier: the bin control shows the
error, Diagnostics lists it under Fallbacks and in the activity log, and
selecting the size again retries it. After a failed load, selected-gene
overlays, ROI, Magic Lens and the Bin card read the drawn tier
(`visiumHdActiveBinSize`); while a tier loads they read the new size.

## Caching And Workers

- `VisiumHdDatasetReaderController` caches overviews per tier and one
  segmentation index per GeoJSON path/kind/scale. Viewports select from the
  index; elements are built only for the polygons returned, and polygons still
  in view keep their objects. The nucleus mask TIFF is still read per
  viewport. Gene panel and barcode reads are cached
  only when no `AbortSignal` is passed. Whole-file and per-cell barcode-mapping
  reads are shared loads (`waitForSharedLoad`): each caller passes its own
  signal, and the read is cancelled only once every caller has cancelled.
- Bin assignments read only the row groups of `barcode_mappings.parquet` that
  can hold the bins, after one HEAD and footer read per dataset (see
  [2 µm strategy](../visium-hd-2um-strategy.md#barcode-mapping-bridge)).
- Bins are styled where they are drawn or read: the viewer colours the ones
  it draws, and the Bin card and an ROI style their own. Until 2026-11-17 App
  copied every bin for each expression batch, which at 2 µm (3.4 million)
  blocked for about 10 s and ran the tab out of memory.
- Segmentation GeoJSON is fetched on the main thread, so custom fetchers and
  the full-file budget apply, and its body is piped chunk by chunk to a
  short-lived worker that parses each feature and transfers the columns back
  (ids, bounds, ring offsets, Float32 coordinates, interned metadata). The read
  is shared by every viewport request and not cancelled when one is; a failed
  read is retried by the next request.
- Feature Slice and filtered-matrix reads run in H5 file workers that keep
  their file open for the session and read it by range
  ([architecture](../architecture.md#workers)). A dropped connection is retried
  at once, a request still waiting for its worker is dropped when it is
  cancelled, and after a failed read the next one opens the file again.
- The filtered matrices' barcodes are not in spatial order, so a bin selection
  reads chunks from across the file: about 120 MB of the 122 MB 16 µm matrix
  for the first 1,005-bin selection on the reference dataset. Its blocks stay
  in the worker (up to 128 MiB), so later selections at 16 µm fetch almost
  nothing; the 8 µm (160 MB) and 2 µm (236 MB) matrices do not fit. A 2 µm
  matrix's 3.4 million barcodes are indexed again for each read rather than
  kept (about 283 MB).
- Parquet footers go through the IndexedDB byte-range cache
  (`src/data/persistentByteRangeCache.ts`).

## Source Files

| File                                                                                                                                                                                   | Role                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/datasets/datasetFactory.ts`                                                                                                                                                       | Tier and `segmented_outputs/` probes                                            |
| `src/datasets/visiumHdDataset.ts`                                                                                                                                                      | `SpatialDataset` facade                                                         |
| `src/datasets/visiumHdDatasetReaders.ts`                                                                                                                                               | Reader controller: tiers, caches, image, gene expression, matrix, segmentations |
| `src/datasets/visiumHdOverview.ts`                                                                                                                                                     | Positions and scalefactors parsing, overview batches, gene panel                |
| `src/datasets/visiumHdBarcodes.ts`                                                                                                                                                     | 2 µm barcode streaming and parsing                                              |
| `src/datasets/visiumHdClusters.ts`, `src/features/app-shell/useVisiumHdAnnotationSetsWorkflow.ts`                                                                                      | Cluster annotation sets per tier                                                |
| `src/datasets/visiumHdBarcodeMappings.ts`, `visiumHdBarcodeMappingDuckDb.ts`                                                                                                           | `barcode_mappings.parquet` readers                                              |
| `src/datasets/visiumHdSegmentations.ts`, `visiumHdSegmentationModel.ts`                                                                                                                | GeoJSON and nucleus-mask segmentation readers                                   |
| `src/datasets/visiumHdSegmentationIndex.ts`, `visiumHdSegmentationIndexWorker.ts`, `src/workers/visiumHdSegmentationIndex.worker.ts`                                                   | Segmentation index columns, viewport selection, and the GeoJSON parse worker    |
| `src/datasets/spatialGrid.ts`                                                                                                                                                          | Grid basis fitting and derivation                                               |
| `src/data/visiumFeatureSlice.ts`, `visiumFeatureSliceH5.ts`, `src/workers/h5FileCore.ts`                                                                                               | Feature Slice H5 reader                                                         |
| `src/data/gex.ts`, `featureBarcodeMatrixH5.ts`, `src/workers/h5FileCore.ts`                                                                                                            | Filtered feature-barcode matrix reader                                          |
| `src/data/visiumHdGridLod.ts`, `src/data/geneExpressionLod.ts`                                                                                                                         | Zoom LOD rules                                                                  |
| `src/features/app-shell/visiumHdAppController.ts`, `useVisiumHdBinWorkflow.ts`, `useVisiumHdGridLodWorkflow.ts`, `useVisiumHdExpressionProfileWorkflow.ts`, `visiumHdGridLayerData.ts` | App wiring                                                                      |
| `src/features/genes/useVisiumHdExpressionProjectionWorkflow.ts`, `visiumHdExpressionProjection.ts`                                                                                     | Bin→cell expression projection                                                  |
| `src/features/roi/useVisiumHdRoiWorkflow.ts`, `visiumHdRoiModel.ts`, `useVisiumHdMagicLensSummary.ts`                                                                                  | ROI and Magic Lens                                                              |
| `src/features/cells/GridCellInfoPanel.tsx`, `gridCellAssignmentModel.ts`                                                                                                               | Bin card details                                                                |
| `src/components/viewerGridCellIndex.ts`, `src/rendering/gridCellRenderer.ts`                                                                                                           | Grid picking index and rendering                                                |
| `src/data/datasetDiagnostics.ts`                                                                                                                                                       | `runVisiumHdDiagnostics`                                                        |

## Known Limitations

- `feature_slice.h5` is required for selected-gene overlays, and for a
  dataset with only a 2 µm tier; there is no fallback to the filtered matrix.
- 2 µm bins are heavy in the browser. Each is an object with its own corner
  polygon, and the viewer indexes and aggregates them as objects, so the
  reference's 3,443,936 bins take about 1.8 GB of heap. Measured 2026-11-17
  on a production build with GPU, opening the 2 µm-only reference: ready in
  10.9 s, with main-thread blocks of 2.1 and 2.9 s while the bins are built;
  colouring a gene took 6 s. A columnar grid, as cells have, would remove
  most of it.
- Diagnostics do not check the clustering files.
- With 2 µm selected below zoom 3, ROI and Magic Lens receive the 16 µm
  stand-in bins but query the 2 µm matrix (found by reading the code; not
  reproduced).
- While a tier loads, the old tier stays drawn but reads use the new size. Its
  bins have no selected-gene colour until the new tier is drawn, and an ROI,
  Magic Lens scan or Bin card on them reads the new tier's data, which does
  not hold their barcodes.
- Bins are drawn above cell and nucleus outlines and take the pointer, so
  outlines cannot be hovered or clicked where bins are drawn. Nuclei from
  `nucleus_segmentations.geojson` name their cell (`cell_id`), so a nucleus
  click would select its cell outline (2026-11-17).
