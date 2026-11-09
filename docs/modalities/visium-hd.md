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
  three succeed:
  - `binned_outputs/square_XXXum/spatial/tissue_positions.parquet`
  - `binned_outputs/square_XXXum/spatial/scalefactors_json.json`
  - `binned_outputs/square_XXXum/filtered_feature_bc_matrix.h5`

  This means the 2 µm `tissue_positions.parquet` must exist for 2 µm to be
  offered, even though it is never read.

- **Segmented outputs.** Eight `HEAD` probes under `segmented_outputs/`
  (`VISIUM_HD_SEGMENTED_OUTPUT_PROBES`) record which segmentation files exist.
- The platform is `visium-hd` when at least one tier is present.

A [dataset manifest](../dataset-manifest.md) with `"platform": "visium-hd"`
skips the earlier probes. Its `files.bins` list replaces the tier probe (each
listed bin's three files are checked with `HEAD`, and a missing one is an
error), `files.segmentedOutputs` replaces the segmented-output probes, and
`options.binSize` sets the first tier shown. `featureSlice` and
`barcodeMappings` can also be relocated.

`createSpatialDataset` lazy-imports `VisiumHdDataset`
(`src/datasets/visiumHdDataset.ts`), a thin wrapper around
`VisiumHdDatasetReaderController` (`src/datasets/visiumHdDatasetReaders.ts`).

## Files Read

`T` is `binned_outputs/square_{002,008,016}um`.

| Path                                                                                                                                            | Required                  | Read by                                                                                                | Library                                      | What is read                                                                                                                     | Used for                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `T/spatial/tissue_positions.parquet` (8, 16 µm)                                                                                                 | Yes (probed for 2 µm too) | `readVisiumHdTissuePositions` (`visiumHdOverview.ts`)                                                  | `hyparquet`, footer in IndexedDB             | `barcode`, `in_tissue`, `array_row`, `array_col`, `pxl_row_in_fullres`, `pxl_col_in_fullres`                                     | 8/16 µm bin grid                                                                  |
| `T/spatial/scalefactors_json.json`                                                                                                              | Yes                       | `readVisiumHdScalefactors`                                                                             | fetch + JSON                                 | `microns_per_pixel`, `tissue_hires_scalef`, `tissue_lowres_scalef`; optional image sizes, `bin_size_um`, `spot_diameter_fullres` | Units, image scaling, segmentation scaling                                        |
| `T/filtered_feature_bc_matrix.h5`                                                                                                               | Yes                       | `gexFromFeatureBarcodeMatrixH5LazyRangeWorker` (`src/data/gex.ts`) in `featureBarcodeMatrix.worker.ts` | `h5wasm` lazy file (range reads) in a worker | `/matrix/barcodes`, `/matrix/features/{name,feature_type}`, `/matrix/indptr`; `indices`/`data` sliced                            | All-gene bin and cell profiles, ROI gene stats, Magic Lens without selected genes |
| `T/filtered_feature_bc_matrix/barcodes.tsv.gz` (2 µm)                                                                                           | For 2 µm                  | `readVisiumHdFilteredMatrixBarcodes` (`visiumHdBarcodes.ts`)                                           | fetch + `DecompressionStream` (whole file)   | Barcodes parsed with `/^(?:s\|square)_(\d{3})um_(\d+)_(\d+)(?:-\d+)?$/`                                                          | 2 µm bin grid                                                                     |
| `T/filtered_feature_bc_matrix/features.tsv.gz`                                                                                                  | Optional                  | `readVisiumHdFeatureGenePanel`                                                                         | fetch + gunzip                               | Columns 1 (name) and 2 (type), gene features only                                                                                | Gene search list                                                                  |
| `feature_slice.h5` (root)                                                                                                                       | For gene overlays         | `gexFromVisiumFeatureSliceH5` (`src/data/visiumFeatureSlice.ts`) in `visiumFeatureSlice.worker.ts`     | `h5wasm` lazy file in a worker               | Root `metadata_json` (`nrows`, `ncols`, `spot_pitch`), `/features/{name,feature_type}`, `/feature_slices/<i>/{row,col,data}`     | Selected-gene bin colouring                                                       |
| `barcode_mappings.parquet` (root)                                                                                                               | Optional                  | `readVisiumHdBarcodeMappings` (hyparquet); `readVisiumHdBarcodeMappingsForCellWithDuckDb`              | `hyparquet` / DuckDB-WASM                    | `square_002um`, `square_008um`, `square_016um`, `cell_id`, `in_nucleus`, `in_cell`                                               | Bin→cell assignment, segmented-cell profiles, expression projection               |
| `T/spatial/tissue_hires_image.png`                                                                                                              | Optional                  | `VisiumHdDatasetReaderController.image()`                                                              | `HTMLImageElement`                           | Whole PNG                                                                                                                        | Tissue underlay                                                                   |
| `T/analysis/{umap,tsne}/…/projection.csv`, then root `analysis/…`                                                                               | Optional                  | `loadDatasetAnalysisEmbeddings` (`src/data/analysisEmbeddings.ts`)                                     | fetch + CSV                                  | Barcode column plus two axis columns                                                                                             | Embedding view for the active tier                                                |
| `segmented_outputs/cell_segmentations.geojson`, else `graphclust_annotated_cell_segmentations.geojson`                                          | Optional                  | `readVisiumHdSegmentationElements` (`visiumHdSegmentations.ts`)                                        | fetch + streaming JSON scanner               | Polygon/MultiPolygon in full-res pixels, `cell_id`, label and colour properties                                                  | Cell boundaries                                                                   |
| `segmented_outputs/nucleus_segmentations.geojson`, else `graphclust_annotated_nucleus_segmentations.geojson`, else `nucleus_instance_mask.tiff` | Optional                  | Same, or `readVisiumHdNucleusInstanceMaskRasterFromTiff`                                               | JSON scanner / `geotiff` windowed read       | Polygons, or mask labels traced into polygons                                                                                    | Nucleus boundaries                                                                |

Probed or diagnosed but **never read**: `T/spatial/tissue_lowres_image.png`,
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
   scalefactors, and the 2 µm `barcodes.tsv.gz` in parallel.
2. Halves the source basis down to 2 µm (`deriveSubdividedGridBasis`).
3. Places each barcode by its encoded row/column. All bins are treated as in
   tissue.

Without an 8 or 16 µm tier, 2 µm loading fails with
`VisiumHdTwoMicrometerOverviewDisabledError`.

### Zoom Level Of Detail

- **Grid.** With 2 µm selected and zoom below 3
  (`VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN`), `useVisiumHdGridLodWorkflow` shows the
  16 µm grid instead, when 16 µm exists. `viewerGridCellIndex.ts` also builds
  colour-averaged 16 µm aggregates for rendering 2 µm grids zoomed out. Those
  stand-in and aggregate cells cannot be clicked or hovered.
- **Gene expression.** `planGeneExpressionLod`
  (`src/data/geneExpressionLod.ts`) requests 16 µm data for a 2 µm selection
  below zoom 3, and for an 8 µm selection at zoom −1.25 or lower. At zoom
  −1.25 or lower the request covers the whole slide.

## Feature Read Paths

| Feature                    | Path                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Selected-gene overlay      | `geneExpression(bbox, genes)` reads `feature_slice.h5` in a worker, sums counts into the active bin size (`floor(row / (binSize / spot_pitch))`), and colours bins. There is no fallback to the filtered matrix.                     |
| Bin Info: assignment       | `useGridCellAssignmentWorkflow` reads `barcode_mappings.parquet` and finds the segmented cell for the bin                                                                                                                            |
| Bin Info: all-gene profile | `useVisiumHdExpressionProfileWorkflow` calls `matrix([barcode], binSize)` on the tier's filtered matrix                                                                                                                              |
| Segmented-cell profile     | DuckDB-WASM query on `barcode_mappings.parquet` for one `cell_id`, then `matrix()` over those bins at the active size. The segmented `filtered_feature_cell_matrix.h5` is not used.                                                  |
| Cell/nucleus boundaries    | `elements(bbox)` / `segmentationElements('nucleus', bbox)`. The GeoJSON is streamed in full for each new viewport and filtered; loading is gated by the boundary viewport rule (see [Xenium](./xenium.md#viewport-cell-boundaries)). |
| Expression projection      | `useVisiumHdExpressionProjectionWorkflow` splits each bin's count across its mapped cells; the result feeds status text                                                                                                              |
| Tissue image               | The active tier's `tissue_hires_image.png`, drawn at `(px / tissue_hires_scalef) × microns_per_pixel`. No pyramid and no lowres fallback.                                                                                            |
| Embeddings                 | Per-tier `projection.csv`, then root `analysis/`                                                                                                                                                                                     |
| ROI                        | `useVisiumHdRoiWorkflow` selects bins whose centre is inside the box/lasso (up to 50,000), then `matrix(barcodes, binSize)`; exports barcodes CSV and GeoJSON                                                                        |
| Magic Lens                 | `useVisiumHdMagicLensSummary`: up to 25,000 bins; `matrix()` when no genes are selected, otherwise selected-gene expression filtered to the lens                                                                                     |

Annotations from the dataset are not supported (`annotations()` rejects and
`VISIUM_HD_PLATFORM_ADAPTER.capabilities.annotations` is `false`), and
Visium HD has no transcript records.

## Load Sequence

`useDatasetLifecycle` (`src/features/app-shell/useDatasetLifecycle.ts`):

1. Sets the platform to `visium-hd`; cell and nucleus boundaries default to off.
2. Starts the gene panel (`features.tsv.gz`) without blocking.
3. Awaits `readBinnedOverview()` and `meta()`, renders the grid, and fills the
   Dataset tab bin-size control.
4. If `Tissue image` is enabled, loads the hires PNG in the background.

Changing the bin size runs `useVisiumHdBinWorkflow`.

## Caching And Workers

- `VisiumHdDatasetReaderController` caches overviews per tier and segmentation
  elements per path/kind/scale/bbox. Gene panel, barcodes, and barcode-mapping
  reads are cached only when no `AbortSignal` is passed; the app's assignment,
  projection, and profile workflows always pass one, so each bin selection
  re-reads `barcode_mappings.parquet`.
- Feature Slice and filtered-matrix reads run in short-lived workers created
  per request. Matrix reads are queued and retried up to 3 times on network
  errors.
- Parquet footers go through the IndexedDB byte-range cache
  (`src/data/persistentByteRangeCache.ts`).

## Source Files

| File                                                                                                                                                                                   | Role                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/datasets/datasetFactory.ts`                                                                                                                                                       | Tier and `segmented_outputs/` probes                                            |
| `src/datasets/visiumHdDataset.ts`                                                                                                                                                      | `SpatialDataset` facade                                                         |
| `src/datasets/visiumHdDatasetReaders.ts`                                                                                                                                               | Reader controller: tiers, caches, image, gene expression, matrix, segmentations |
| `src/datasets/visiumHdOverview.ts`                                                                                                                                                     | Positions and scalefactors parsing, overview batches, gene panel                |
| `src/datasets/visiumHdBarcodes.ts`                                                                                                                                                     | 2 µm barcode parsing                                                            |
| `src/datasets/visiumHdBarcodeMappings.ts`, `visiumHdBarcodeMappingDuckDb.ts`                                                                                                           | `barcode_mappings.parquet` readers                                              |
| `src/datasets/visiumHdSegmentations.ts`, `visiumHdSegmentationModel.ts`                                                                                                                | GeoJSON and nucleus-mask segmentation readers                                   |
| `src/datasets/spatialGrid.ts`                                                                                                                                                          | Grid basis fitting and derivation                                               |
| `src/data/visiumFeatureSlice.ts`, `src/workers/visiumFeatureSlice.worker.ts`                                                                                                           | Feature Slice H5 reader                                                         |
| `src/data/gex.ts`, `src/workers/featureBarcodeMatrix.worker.ts`                                                                                                                        | Filtered feature-barcode matrix reader                                          |
| `src/data/visiumHdGridLod.ts`, `src/data/geneExpressionLod.ts`                                                                                                                         | Zoom LOD rules                                                                  |
| `src/features/app-shell/visiumHdAppController.ts`, `useVisiumHdBinWorkflow.ts`, `useVisiumHdGridLodWorkflow.ts`, `useVisiumHdExpressionProfileWorkflow.ts`, `visiumHdGridLayerData.ts` | App wiring                                                                      |
| `src/features/genes/useVisiumHdExpressionProjectionWorkflow.ts`, `visiumHdExpressionProjection.ts`                                                                                     | Bin→cell expression projection                                                  |
| `src/features/roi/useVisiumHdRoiWorkflow.ts`, `visiumHdRoiModel.ts`, `useVisiumHdMagicLensSummary.ts`                                                                                  | ROI and Magic Lens                                                              |
| `src/features/cells/GridCellInfoPanel.tsx`, `gridCellAssignmentModel.ts`                                                                                                               | Bin Info panel                                                                  |
| `src/components/viewerGridCellIndex.ts`, `src/rendering/gridCellRenderer.ts`                                                                                                           | Grid picking index and rendering                                                |
| `src/data/datasetDiagnostics.ts`                                                                                                                                                       | `runVisiumHdDiagnostics`                                                        |

## Known Limitations

- `feature_slice.h5` is required for selected-gene overlays; there is no
  fallback to the filtered matrix.
- With only a 2 µm tier detected, the default load fails.
- The 2 → 16 µm gene LOD does not check that 16 µm exists.
- With 2 µm selected below zoom 3, ROI and Magic Lens receive the 16 µm
  stand-in bins but query the 2 µm matrix (found by reading the code; not
  reproduced).
- Segmentation GeoJSON is re-streamed for each new viewport.
- Diagnostics mark `tissue_hires_image.png` as required, fetch segmentation
  GeoJSON in full, and do not check `barcodes.tsv.gz` or `features.tsv.gz`.
