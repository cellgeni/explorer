# Xenium Modality

How the viewer detects and reads a 10x Xenium Onboard Analysis (XOA) output
folder. For hosting requirements see
[Host your own data](../host-your-own-data.md#host-your-own-xenium-data); for
the cell-feature matrix decision see
[Cell-feature matrix compatibility](../cell-feature-matrix-compatibility.md).

## Detection

`detectSpatialDataset` (`src/datasets/datasetFactory.ts`) first rules out
`.h5ad`, Zarr, and TIFF/NDPI URLs by their shape. For any other URL, the
first network probes are `GET <base>/explorer.json` and
`HEAD <base>/experiment.xenium`, run together (15 s timeout). A
[dataset manifest](../dataset-manifest.md) in `explorer.json` decides the
platform and can relocate every file below. Otherwise a `2xx` for
`experiment.xenium` means Xenium; its body is not read at detection time. Any
other status, a network error, or a timeout moves on to the SpatialData,
OME-Zarr, and Visium HD probes.

The file names below are the standard ones. Readers ask for each file by role
(`datasetFileUrlFor(baseUrl, 'cells')`, `src/data/datasetFiles.ts`), which
returns the manifest's location when there is one.

Unlike the other platforms, the Xenium load path in `useDatasetLifecycle`
calls free functions in `src/data/` (`loadDatasetOverview`, `loadGenePanel`,
`loadMorphologyImage`, …) rather than going through one `SpatialDataset`
instance. Those functions share `XeniumDataset` instances from
`src/data/xeniumDatasetCache.ts` (`cachedXeniumDataset`,
`cachedXeniumTranscriptDataset`). Viewport boundaries use the factory's
`cachedSpatialDataset` instance.

## Files Read

| File                                                                               | Required                        | Read by                                                                                             | Library                                               | What is read                                                                                                                                                         | Used for                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `experiment.xenium`                                                                | Yes, without a dataset manifest | Detection; `readXeniumExperimentMetadata`; `loadMorphologyImageCandidatesFromManifest`              | fetch + JSON                                          | Pixel size (`pixel_size`, `pixel_size_um`, …); morphology image paths (`*_filepath(s)` keys)                                                                         | Detection, `meta()` units, image choice                                          |
| `cells.parquet`                                                                    | Yes                             | `readCellsOverview` (`src/data/hyparquetCells.ts`); DuckDB queries in `xeniumDatasetReaders.ts`     | `hyparquet`; DuckDB-WASM                              | `cell_id`, `x_centroid`, `y_centroid`, `transcript_counts`, `cell_area`, optional `nucleus_count`, `segmentation_method`; `file_row_number` for matrix rows          | First paint, viewport cell sets, ROI cells, transcript estimates                 |
| `cell_boundaries.parquet`                                                          | Optional                        | `readXeniumBoundaryElements`                                                                        | DuckDB-WASM                                           | `cell_id`, `vertex_x`, `vertex_y`                                                                                                                                    | Cell polygons, selected-cell shape metrics                                       |
| `cell_feature_matrix.zarr.zip`                                                     | For expression                  | `src/data/gex.ts` (`gexFromCellFeatureMatrixZarrSelectedGenes`, `gexFromCellFeatureMatrixZarrRows`) | `zarrita` + `ZipFileStore` over a cached range reader | `cell_features` attrs (`feature_keys`, `feature_types`), `cell_id`, CSC `csc/{indptr,indices,data}`, feature-major `indptr/indices/data`                             | Gene overlay, ROI genes, cell details, Magic Lens, annotation row→cell mapping   |
| `cell_feature_matrix.h5`                                                           | Fallback                        | `gexFromCellFeatureMatrixH5`                                                                        | `h5wasm` (whole file)                                 | `/matrix/{barcodes,features/name,features/feature_type,indptr,indices,data}`                                                                                         | ROI genes, cell details, Magic Lens when Zarr has no CSC arrays                  |
| `transcripts.zarr.zip`                                                             | Optional                        | `src/data/transcriptZarr.ts`                                                                        | `zarrita` + `ZipFileStore`                            | Root `gene_names`, `codeword_gene_names`, `fov_names`; `grids` attrs and `grids/<level>/<tile>` arrays (`location`, `gene_identity`, `id`, `quality_score`, `valid`) | Density squares, exact points, selected-cell z distribution, gene-panel fallback |
| `transcripts.parquet`                                                              | Optional                        | `readXeniumTranscripts*` (`xeniumDatasetReaders.ts`)                                                | DuckDB-WASM                                           | `transcript_id`, `cell_id`, `feature_name`, `x/y/z_location`, `qv`, `fov_name`, `overlaps_nucleus`, `nucleus_distance`, `is_gene`                                    | Exact-point fallback, cell IDs for Zarr points, ROI transcript CSV               |
| `gene_panel.json`                                                                  | Optional                        | `loadGenePanel` (`src/data/genePanel.ts`)                                                           | fetch + JSON                                          | `targets`/`genes` entries, gene features only                                                                                                                        | Gene search list                                                                 |
| `analysis.zarr.zip`                                                                | Optional                        | `readAnalysisZarrAnnotation*` (`src/data/analysisAnnotations.ts`)                                   | `zarrita` + `ZipFileStore`                            | `cell_groups` attrs and `cell_groups/<i>/{indptr,indices}`                                                                                                           | Built-in clusterings                                                             |
| `analysis/{umap,tsne}/{gene_expression_2_components,2_components,}/projection.csv` | Optional                        | `loadDatasetAnalysisEmbeddings` (`src/data/analysisEmbeddings.ts`)                                  | fetch + CSV                                           | Barcode/cell-id column plus two axis columns                                                                                                                         | UMAP / t-SNE panel                                                               |
| Morphology OME-TIFF from `experiment.xenium` or the dataset manifest               | Optional                        | `loadMorphologyImage` (`src/data/morphologyImage.ts`) → `openTiff`                                  | `geotiff` + range tile reads                          | OME-XML, SubIFD pyramid, tiles                                                                                                                                       | Image layer, channels, viewer µm/px                                              |
| `.zchunkstore` sidecar                                                             | Optional                        | `loadZchunkStorePyramidOptions` (`src/tiff/zchunkStore.ts`)                                         | fetch + JSON                                          | Precomputed tile offsets                                                                                                                                             | Faster TIFF open                                                                 |

Not read: `nucleus_boundaries.parquet`, `analysis/clustering/*` CSVs,
`metrics_summary.csv`, `cells.zarr.zip`, and `aux_outputs/`.

## Coordinates And Units

- Data coordinates are the micrometre centroids and vertices from the Parquet
  files.
- The viewer's slide extent is the bounding box of the overview cells.
- The viewer's µm/px comes from the morphology image's OME-XML
  `PhysicalSizeX` (default 0.2125). `XeniumDataset.meta()` reads the pixel size
  from `experiment.xenium` instead, but only the boundary loader uses it.
- Cell IDs must match `/^[a-p]{8}-\d+$/` (`asCellId`, `src/data/cellid.ts`);
  integer cell IDs from very old output are rejected.

## Load Sequence

`useDatasetLifecycle` (`src/features/app-shell/useDatasetLifecycle.ts`) sets
the platform to `xenium` (cell boundaries on by default), then:

1. Starts, without waiting:
   - dataset warmup (`warmDatasetForRoi`, `src/data/datasetWarmup.ts`): range
     probes, Parquet footer prefetch, DuckDB client start, and a check for CSC
     arrays in the matrix (a missing CSC group shows the Matrix Warning);
   - `loadGenePanel`;
   - `loadAnnotationGroups` (`analysis.zarr.zip` group names).
2. Awaits `loadDatasetOverview` (`src/data/datasetOverview.ts`): range probe on
   `cells.parquet`, then `hyparquet` reads every row. Missing optional columns
   are retried without them; low-level decode errors fall back to DuckDB.
3. Renders the overview. Every cell is uploaded to the GPU once
   (`createCellPointLayer` with packed arrays, `src/rendering/cellPointStyle.ts`)
   and the GPU draws a fixed-rank sample of them, sized to the performance
   budget's `overviewRenderCellLimit` (75k / 150k / 250k) against the cells in
   view, so panning does not rebuild the layer.
4. If `Morphology image` is enabled, loads the image in the background.

## Feature Read Paths

### Viewport Cell Boundaries

`shouldLoadBoundaryPolygons` (`src/rendering/boundaryViewport.ts`) loads
polygons when zoom ≥ −0.25 or the visible overview cell count is below
`Boundary limit` (1–100,000; default 2,500 on compact devices, 50,000
otherwise). Requests are keyed by the bbox quantized to 50 µm. One DuckDB
query selects cells whose centroid is within the bbox ± 75 µm and their
vertices, then rings with fewer than 3 vertices are dropped.

### Selected-Gene Expression

1. `planGeneExpressionLod` (`src/data/geneExpressionLod.ts`) picks a mode from
   the `Expression detail` control and the viewport:
   - `all-cells`: whole slide, every cell.
   - `exact-region`: the viewport, when ≤ 50,000 cells are visible.
   - Auto: `all-cells` for datasets of up to 500,000 cells. Larger datasets
     use `overview-sampled` (whole slide) when zoomed far out or more than
     100,000 cells are visible, `exact` when ≤ 50,000 are visible, otherwise
     `sampled` (padded viewport). Only cells with expression are returned, so
     sampled requests read every cell in the box.
2. `loadDatasetGeneExpression` (`src/data/geneExpression.ts`) range-probes the
   matrix. For up to 32 genes it first lists the genes' expressing rows from
   the feature-major arrays (`selectedGeneRowsFromCellFeatureMatrixZarr`), then
   reads the numeric columns of the cells in the box with DuckDB and joins them
   by row. A few rows are checked by `cell_id` once per dataset; if
   `cells.parquet` and the matrix do not list cells in the same order, it falls
   back to step 3.
3. Otherwise it selects the cells in the box with DuckDB and calls
   `gexFromCellFeatureMatrixZarrSelectedGenes`, which uses the CSC group when
   it exists and the request has ≤ 2,000 cells or > 32 genes, and per-gene
   feature-major slices otherwise. Byte ranges are coalesced and fetched 8 at a
   time.
4. A cell's score is the sum of the selected genes' counts.

`cell_feature_matrix.h5` is never used for the overlay.

### Transcripts

Capabilities are checked lazily, when the overlay is on or the Transcripts tab
is open (`loadDatasetTranscriptCapabilities`, `src/data/transcriptOverlay.ts`).
The visible transcript estimate is the sum of overview `transcript_counts` in
the viewport. `planTranscriptLod` then chooses density or exact points.

- **Density.** `loadTranscriptZarrAggregates` picks the finest Zarr grid level
  with at most 1,500 visible tiles and draws one square per tile, using
  `grid_number_objects` from metadata (no chunk reads). Without
  `transcripts.zarr.zip`, density falls back to cell-summary bins built from
  overview counts. Density always shows all features; the selected-gene
  density path in `transcriptZarr.ts` is not used by the UI.
- **Exact.** `loadTranscriptZarrViewport` reads the level-0 tiles that
  intersect the viewport and filters by `valid`, `Min QV`, bbox,
  `Gene-only calls`, and the feature filter, stopping at the budget. Cell IDs
  are then added from `transcripts.parquet` (1.5 s deadline). Without the
  Zarr, DuckDB queries `transcripts.parquet` directly. If the estimate is ≥ 80%
  of `Exact budget`, the user must press `Load exact viewport`.

### Annotations And Embeddings

- `analysis.zarr.zip` groupings load on demand; matrix row indices are mapped
  to cell IDs through the matrix `cell_id` array. Labels drop the
  `gene_expression_` prefix and `_clusters` suffix.
- Embedding CSVs are tried in order; the first usable UMAP and t-SNE files win.

### Selected Cell

- Gene profile: `loadRoiGeneStats` for one cell (CSC Zarr, else H5).
- Boundary and shape metrics: a boundary query around the cell.
- Z-axis distribution: `loadDatasetCellTranscriptDistribution`
  (`src/data/cellTranscripts.ts`) reads Zarr transcripts in the cell's bbox,
  keeps those inside the polygon, and builds 16 bins. Needs
  `transcripts.zarr.zip`.

### ROI

- Cells: DuckDB `cells()` query for the box or lasso, up to 50,000
  (`src/data/roiCells.ts`).
- Gene stats (`src/data/roiGeneStats.ts`): a 32-cell preview, then a stratified
  10,000-cell refinement. Uses CSC Zarr rows from `file_row_number`, falling
  back to `cell_feature_matrix.h5`. Without either, ROI gene stats are
  unsupported.
- Exports: cells CSV (from memory), GeoJSON, and transcripts CSV (DuckDB on
  `transcripts.parquet`, up to 100,000 rows, QV ≥ 20).

### Magic Lens

`useMagicLensWorkflow` loads ROI cells inside the lens (up to 25,000), then
`loadRoiGeneStats`. The transcript total is the sum of the cells'
`transcript_counts`. The lens `Min QV` control is part of the query key but is
not passed to the readers, so it does not change the result.

## Caching And Workers

- IndexedDB byte-range cache (`src/data/persistentByteRangeCache.ts`): Parquet
  footers, `cell_feature_matrix.zarr.zip` ranges, and TIFF tiles. Entries are
  keyed by URL and byte range without an ETag, so replacing a file at the same
  URL can serve stale bytes until the cache is cleared.
- In-memory: range-probe results, Zarr matrix metadata and `cell_id` index,
  H5 matrices, transcript Zarr metadata, and `XeniumDataset` instances.
- DuckDB-WASM runs in a worker per client; each `XeniumDataset` creates its own
  client. hyparquet, zarrita, and the H5 fallback run on the main thread.

## Source Files

| File                                                                                | Role                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/datasets/datasetFactory.ts`                                                    | `experiment.xenium` and dataset manifest probes                |
| `src/datasets/datasetManifest.ts`, `src/data/datasetFiles.ts`                       | Dataset manifest parsing; file lookup by role                  |
| `src/datasets/xeniumDataset.ts`                                                     | `XeniumDataset`: meta, DuckDB client, dataset methods          |
| `src/datasets/xeniumDatasetReaders.ts`                                              | DuckDB SQL for cells, boundaries, transcripts, gene expression |
| `src/datasets/xeniumDatasetRows.ts`                                                 | Row parsing, SQL helpers, manifest pixel size                  |
| `src/data/xeniumDatasetCache.ts`                                                    | Shared `XeniumDataset` instances                               |
| `src/data/datasetOverview.ts`, `hyparquetCells.ts`, `duckdbCells.ts`                | First-paint overview                                           |
| `src/data/datasetBoundaries.ts`, `src/rendering/boundaryViewport.ts`                | Viewport boundary loading                                      |
| `src/data/geneExpression.ts`, `geneExpressionLod.ts`, `gex.ts`                      | Expression LOD and matrix readers                              |
| `src/data/transcriptOverlay.ts`, `transcriptZarr.ts`                                | Transcript capabilities, density, exact points                 |
| `src/data/cellTranscripts.ts`                                                       | Selected-cell z distribution                                   |
| `src/data/roiCells.ts`, `roiGeneStats.ts`, `roiTranscripts.ts`                      | ROI queries and exports                                        |
| `src/data/analysisAnnotations.ts`, `analysisEmbeddings.ts`, `datasetAnnotations.ts` | Clusterings and embeddings                                     |
| `src/data/genePanel.ts`, `geneFeatures.ts`                                          | Gene list                                                      |
| `src/data/morphologyImage.ts`, `src/tiff/*`                                         | Morphology image                                               |
| `src/data/datasetWarmup.ts`                                                         | Warmup and CSC capability check                                |
| `src/data/duckdb.ts`                                                                | DuckDB-WASM client                                             |
| `src/data/cellid.ts`                                                                | Cell ID parsing                                                |
| `src/features/transcripts/*`                                                        | Transcript workflow and HUD                                    |
| `src/data/datasetDiagnostics.ts`                                                    | Xenium diagnostics                                             |

## Known Limitations

- The Magic Lens `Min QV` control has no effect on results.
- Only the first morphology image path in `experiment.xenium` is tried.
- Diagnostics check `morphology.ome.tif` unless a dataset manifest names the
  image, rather than the image chosen from `experiment.xenium`, and do not
  check `analysis.zarr.zip`, `gene_panel.json`, the H5 matrix, or embedding
  CSVs.
- ROI gene stats assume `cells.parquet` row order matches the matrix row order.
