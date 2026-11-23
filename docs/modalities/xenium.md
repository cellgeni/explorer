# Xenium Modality

How the viewer detects and reads a 10x Xenium Onboard Analysis (XOA) output
folder. For hosting requirements see
[Host your own data](../host-your-own-data.md#host-your-own-xenium-data); for
the cell-feature matrix decision see
[Cell-feature matrix compatibility](../cell-feature-matrix-compatibility.md).

## Detection

`detectSpatialDataset` (`src/datasets/datasetFactory.ts`) first rules out
`.h5ad`, Zarr, and TIFF/NDPI URLs by their shape. For any other URL, it first
reads the folder's index page (`GET <base>/`), which only some hosts serve; then
`GET <base>/explorer.json` and `HEAD <base>/experiment.xenium` run together
(15 s timeout), skipping any file the index page does not list (see
[Architecture](../architecture.md#1-detection)). A
[dataset manifest](../dataset-manifest.md) in `explorer.json` decides the
platform and can relocate every file below. Otherwise a `2xx` for
`experiment.xenium` means Xenium; its body is not read at detection time. Any
other status, a network error, or a timeout moves on to the other platforms'
probes, in the order [Architecture](../architecture.md#1-detection) lists.

The file names below are the standard ones. Readers ask for each file by role
(`datasetFileUrlFor(baseUrl, 'cells')`, `src/data/datasetFiles.ts`), which
returns the manifest's location when there is one.

Unlike the other platforms, the Xenium load path in `useDatasetLifecycle`
calls free functions in `src/data/` (`loadDatasetOverview`, `loadGenePanel`,
`loadMorphologyImage`, …) rather than going through one `SpatialDataset`
instance. Those functions share `XeniumDataset` instances from
`src/data/xeniumDatasetCache.ts`: `cachedXeniumDataset` for gene expression,
ROI cells and gene statistics, annotations and warm-up, and
`cachedXeniumTranscriptDataset` for transcripts. Viewport boundaries use the
factory's `cachedSpatialDataset` instance. Each instance has its own DuckDB
client, which runs one query at a time, so the split keeps one kind of query
from waiting behind another (see
[4.6](../plan/decisions.md#46-data-source-abstraction--capability-based)).

## Files Read

| File                                                                               | Required                        | Read by                                                                                             | Library                                               | What is read                                                                                                                                                         | Used for                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `experiment.xenium`                                                                | Yes, without a dataset manifest | Detection; `readXeniumExperimentMetadata`; `loadMorphologyImageCandidatesFromManifest`              | fetch + JSON                                          | Pixel size (`pixel_size`, `pixel_size_um`, …); morphology image paths (`*_filepath(s)` keys)                                                                         | Detection, `meta()` units, image choice                                          |
| `cells.parquet`                                                                    | Yes                             | `readCellsOverviewInWorker` (`cellsOverviewWorker.ts`); DuckDB in `xeniumDatasetReaders.ts`         | `hyparquet`; DuckDB-WASM                              | `cell_id`, `x_centroid`, `y_centroid`, `transcript_counts`, `cell_area`, optional `nucleus_count`, `segmentation_method`; `file_row_number` for matrix rows          | First paint, viewport cell sets, ROI cells, transcript estimates                 |
| `cell_boundaries.parquet`                                                          | Optional                        | `readXeniumBoundaryElements`                                                                        | DuckDB-WASM                                           | `cell_id`, `vertex_x`, `vertex_y`                                                                                                                                    | Cell polygons, selected-cell shape metrics                                       |
| `nucleus_boundaries.parquet`                                                       | Optional                        | `readXeniumNucleusBoundaryElements`                                                                 | DuckDB-WASM                                           | `cell_id`, `vertex_x`, `vertex_y`, `label_id`                                                                                                                        | Nucleus polygons                                                                 |
| `cell_feature_matrix.zarr.zip`                                                     | For expression                  | `src/data/gex.ts` (`gexFromCellFeatureMatrixZarrSelectedGenes`, `gexFromCellFeatureMatrixZarrRows`) | `zarrita` + `ZipFileStore` over a cached range reader | `cell_features` attrs (`feature_keys`, `feature_types`), `cell_id`, CSC `csc/{indptr,indices,data}`, feature-major `indptr/indices/data`                             | Gene overlay, ROI genes, cell details, Magic Lens, annotation row→cell mapping   |
| `cell_feature_matrix.h5`                                                           | Fallback                        | `gexFromCellFeatureMatrixH5`                                                                        | `h5wasm` in a worker, read by range                   | `/matrix/{barcodes,features/name,features/feature_type,indptr,indices,data}`; `data` integer or float                                                                | ROI genes, cell details, Magic Lens when Zarr has no CSC arrays                  |
| `transcripts.zarr.zip`                                                             | Optional                        | `src/data/transcriptZarr.ts`                                                                        | `zarrita` + `ZipFileStore`                            | Root `gene_names`, `codeword_gene_names`, `fov_names`; `grids` attrs and `grids/<level>/<tile>` arrays (`location`, `gene_identity`, `id`, `quality_score`, `valid`) | Density squares, exact points, selected-cell z distribution, gene-panel fallback |
| `transcripts.parquet`                                                              | Optional                        | `readXeniumTranscripts*` (`xeniumDatasetReaders.ts`)                                                | DuckDB-WASM                                           | `transcript_id`, `cell_id`, `feature_name`, `x/y/z_location`, `qv`, `fov_name`, `overlaps_nucleus`, `nucleus_distance`, `is_gene`                                    | Exact-point fallback, cell IDs for Zarr points, ROI transcript CSV               |
| `gene_panel.json`                                                                  | Optional                        | `loadGenePanel` (`src/data/genePanel.ts`)                                                           | fetch + JSON                                          | `targets`/`genes` entries, gene features only                                                                                                                        | Gene search list                                                                 |
| `analysis.zarr.zip`                                                                | Optional                        | `readAnalysisZarrAnnotation*` (`src/data/analysisAnnotations.ts`)                                   | `zarrita` + `ZipFileStore`                            | `cell_groups` attrs and `cell_groups/<i>/{indptr,indices}`                                                                                                           | Built-in clusterings                                                             |
| `analysis/{umap,tsne}/{gene_expression_2_components,2_components,}/projection.csv` | Optional                        | `loadDatasetAnalysisEmbeddings` (`src/data/analysisEmbeddings.ts`)                                  | fetch + CSV                                           | Barcode/cell-id column plus two axis columns                                                                                                                         | UMAP / t-SNE panel                                                               |
| Morphology OME-TIFF from `experiment.xenium` or the dataset manifest               | Optional                        | `loadMorphologyImage` (`src/data/morphologyImage.ts`) → `openTiff`                                  | `geotiff` + range tile reads                          | OME-XML, SubIFD pyramid, tiles                                                                                                                                       | Image layer, channels, viewer µm/px                                              |
| `.zchunkstore` sidecar                                                             | Optional                        | `loadZchunkStorePyramidOptions` (`src/tiff/zchunkStore.ts`)                                         | fetch + JSON                                          | Precomputed tile offsets                                                                                                                                             | Faster TIFF open                                                                 |

Not read: `analysis/clustering/*` CSVs, `metrics_summary.csv`,
`cells.zarr.zip`, and `aux_outputs/`.

XOA does not write `.zchunkstore` sidecars, and none is needed. One can save a
few requests when opening the focus images; see
[TIFF tile-offset sidecars](../zchunkstore.md).

## Coordinates And Units

- Data coordinates are the micrometre centroids and vertices from the Parquet
  files.
- The viewer's slide extent is the bounding box of the overview cells.
- The viewer's µm/px comes from the morphology image's OME-XML
  `PhysicalSizeX` (default 0.2125). `XeniumDataset.meta()` reads the pixel size
  from `experiment.xenium` instead, but nothing reads the units it returns:
  the outline loaders call `meta()` only for the platform, capabilities and
  segmentations.
- Cell IDs must match `/^[a-p]{8}-\d+$/` (`asCellId`, `src/data/cellid.ts`);
  integer cell IDs from very old output are rejected.

## Load Sequence

`useDatasetLifecycle` (`src/features/app-shell/useDatasetLifecycle.ts`) sets
the platform to `xenium` (cell boundaries on and nucleus boundaries off by
default), then:

1. Starts, without waiting:
   - dataset warmup (`warmDatasetForRoi`, `src/data/datasetWarmup.ts`): range
     probes, Parquet footer prefetch, DuckDB client start, and a check for CSC
     arrays in the matrix (a missing CSC group shows the Matrix Warning);
   - `loadGenePanel`;
   - `loadAnnotationGroups` (`analysis.zarr.zip` group names).
2. Awaits `loadDatasetOverview` (`src/data/datasetOverview.ts`): range probe on
   `cells.parquet`, then a cells overview worker reads every row's overview
   columns with `hyparquet` (`src/data/cellsOverviewWorker.ts`). Missing
   optional columns are retried without them; low-level decode errors fall
   back to DuckDB. A file without `x_centroid`, `y_centroid` or
   `transcript_counts` fails naming the column. Rows are counted from the row
   groups, not the footer's total, which some writers get wrong.
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
otherwise). A request covers the view plus up to a quarter of its width and
height on each side, less when the padded box would hold more cells than the
limit (`paddedBoundaryBbox`). `boundaryRequestCovers` reads nothing while the
view stays inside that box and is not zoomed in by a level or more, and reads
again otherwise; the box quantized to 50 µm only names the request. A reader
that finds the padded box over the limit (a label mask) while the view is
under it is asked for the view's own box. One DuckDB query selects cells whose
centroid is within the bbox ± 75 µm and their vertices within the bbox ±
max(5% of its width, 150 µm), then rings with fewer than 3 vertices are
dropped.

`vertex_x` and `vertex_y` are FLOAT, so the vertex bounds are cast to FLOAT
(`betweenSql`, `src/data/gexSelection.ts`). DuckDB casts a FLOAT column
compared with DOUBLE parameters and then cannot skip row groups by their
statistics. Measured on the demo on 2026-11-12 with DuckDB's file cache off,
the cast took a cold Cell-card boundary query from 103 requests, 96 MB of the
109 MB file and 25.1 s to 38 requests, 35 MB and 7.1 s. Queries on
`transcripts.parquet` cast their `x_location` and `y_location` bounds the same
way. `cells.parquet` centroids are DOUBLE and are compared as they are.

### Nucleus Boundaries

`Nucleus boundaries` reads `nucleus_boundaries.parquet` under the same load
rule, bbox, and margins as cell outlines, through
`XeniumDataset.segmentationElements('nucleus', bbox)` and
`readXeniumNucleusBoundaryElements`. The file has the same columns as
`cell_boundaries.parquet`, plus `label_id`, which tells apart the nuclei of
one cell (about 3.5% of the demo's cells have more than one). Rows are
grouped by `cell_id` and `label_id`. A cell's first nucleus keeps the cell
ID, and later ones are `<cell_id>#nucleus-N`; each nucleus also names its
cell (segmentation metadata `cellId`). A file without `label_id` (XOA 1.x;
the column came with XOA 2.0) is read again without it, and each cell's
vertices form one nucleus. Queries started before the first one finds the
column missing retry the same way. The file is Range-probed before the first
query, so a missing file shows a boundary error that names it.

Cell and nucleus outlines are separate requests (`useViewportDataWorkflow.ts`),
each with its own loading task, error, and log line (`Cell boundaries ready:`
and `Nucleus boundaries ready:`). Each layer is drawn when its query returns,
and a failed nucleus read leaves the cell outlines in place. Each checkbox
reads only its own outline type: with `Cell boundaries` off no cell query
runs (`cellBoundaryLoadingEnabled` in `platformAdapter.ts`). Unticking a
checkbox stops that layer's request but keeps the outlines it already read,
so ticking it again in the same area reads nothing. Both queries share the
viewport `XeniumDataset`, whose DuckDB instance runs one query at a time, so
with both on and cold the nuclei arrive after the cells.

Nuclei are drawn as a blue layer that can be hovered and clicked. The tooltip
shows the nucleus ID, its place among its cell's nuclei in view (`2 of 3`),
the cell ID, vertices, and area. A click selects the nucleus's cell, as a
click elsewhere in the cell does, and the Cell card then lists the cell's
nuclei in view with their area and circularity.

Measured on the demo on 2026-11-17 in headless Chromium with Metal WebGL, at
a 1280 × 800 view of about 4,560 cells and nuclei. Times run from the request
to the outlines being drawn:

| Case                           | Cells                       | Nuclei                      |
| ------------------------------ | --------------------------- | --------------------------- |
| Both, cold                     | 15.8 s (20 requests, 16 MB) | 21.9 s (19 requests, 15 MB) |
| Each checkbox off and on again | Not queried                 | Not queried                 |
| Nuclei only, cold              | Not queried                 | 13.7 s                      |

Before the split, measured on 2026-11-13 with the same setup at about 4,300
cells and nuclei, both outline types were drawn together once both queries
finished, and each checkbox read both again from DuckDB's file cache:

| Case              | Cells                      | Nuclei                       |
| ----------------- | -------------------------- | ---------------------------- |
| Cells only, cold  | 9.9 s (20 requests, 16 MB) | —                            |
| Nuclei added      | 0.45 s (cached)            | 4.0 s (19 requests, 15 MB)   |
| Cells turned off  | Not queried                | 0.46 s (cached)              |
| Nuclei only, cold | Not queried                | 13.0 s                       |
| Both, cold        | 12.9 s                     | 17.2 s (waits for the cells) |

The cold times include starting DuckDB and reading `cells.parquet` for the
centroid filter. A cold nucleus query reads 15 MB of the 99.6 MB file, since
the FLOAT-cast vertex bounds prune row groups.

### Selected-Gene Expression

1. `planGeneExpressionLod` (`src/data/geneExpressionLod.ts`) picks a mode from
   the `Expression detail` control and the viewport:
   - `all-cells`: whole slide, every cell.
   - `exact-region`: the padded viewport, when ≤ 50,000 cells are visible.
   - Auto: `all-cells` for datasets of up to 500,000 cells. Larger datasets
     use `overview-sampled` (whole slide) when zoomed far out or more than
     100,000 cells are visible, `exact` when ≤ 50,000 are visible, otherwise
     `sampled`. Only cells with expression are returned, so sampled requests
     read every cell in the box.
   - Auto on Visium HD (`planVisiumHdGeneExpressionLod`), at any size:
     `all-cells` at zoom −1.25 or lower, otherwise `exact` over the padded
     viewport, never sampled.
   - Viewport reads are padded: `exact` and `exact-region` by up to a quarter
     of the view on each side (less as the view nears 50,000 cells), `sampled`
     by a fifth. The box bounds the read, with no cell limit. The request key
     (`geneExpressionRequestKey`) leaves out the view's position, and
     `geneExpressionReadCovers` reads again only when the view leaves the box
     read.
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

Capabilities are checked lazily, when the overlay is on or the Transcripts
section is open (`loadDatasetTranscriptCapabilities`,
`src/data/datasetTranscripts.ts`). Once the check has read the
`transcripts.zarr.zip` metadata, the visible transcript estimate sums the
level-0 tile counts (`grid_number_objects`) in the viewport, weighting edge
tiles by the share of their area in view (`estimateTranscriptZarrViewportCount`).
It counts every transcript, whatever `Min QV` and `Gene-only calls` say.
Without a Zarr, or before its metadata loads, it is the sum of overview
`transcript_counts` in the viewport. `planTranscriptLod` then chooses density
or exact points.

- **Density, all transcripts.** With the All features filter, or no genes
  selected, `loadTranscriptZarrAggregates` picks the finest Zarr grid level
  with at most 1,500 visible tiles and draws one square per tile, using
  `grid_number_objects` from metadata (no chunk reads). Only level 0 counts
  every transcript: each coarser level keeps a sample (on the demo, level 1
  76% and level 7 0.95% of the 554.7 million), so its squares are labelled
  `Sampled count` with the level's share (`sampledShare`). Colours are scaled
  to the level's largest square, so they are unaffected. Without
  `transcripts.zarr.zip`, density falls back to cell-summary bins built from
  overview counts.
- **Density, selected genes.** With the Selected genes filter and genes
  chosen, the squares count only those genes, from `density/gene`: a CSR
  matrix over 10 µm cells (`rows`, `cols`, `grid_size`, `origin`,
  `gene_names`) stored gene by gene, so `indptr[gene × rows + row]` starts a
  gene's row. Each gene's entries for the whole slide are contiguous, so a
  gene is read once, whole, and kept in memory (up to 8 million entries,
  least recently used genes first out); later views of the same genes read
  nothing. The first use also reads `indptr` (one chunk, 10 MB compressed and
  75 MB in memory on the demo), which stays in memory.
  - Squares are the finest power-of-two multiple of 10 µm whose occupied
    squares number at most 1,500. Colours are scaled to the largest square
    on the slide at that size, so they do not change while panning. A square
    the view's edge cuts counts all its cells, so its count does not change
    either; the transcript count in view counts only the cells in view.
  - Each square keeps each gene's count and the count-weighted centre of its
    10 µm cells, for the hover card and gene markers.
  - A request whose new genes span more than 32 data chunks reads nothing and
    says so (`TRANSCRIPT_GENE_DENSITY_CHUNK_LIMIT`). Measured on the demo
    (whole slide, Node, Sanger bucket): 1 gene 0.2 s and 2.2 MB, 8 genes
    0.5 s and 11 MB, 25 genes 1.9 s and 56 MB; views from memory take 3–14
    ms. A chunk pair is about 2.3 MB, so the limit is about 75 MB, or about
    30 genes.
  - Outputs without `density/gene` show all-transcript squares and say so.
    A `density/gene` read that fails is an error, not a missing
    `density/gene`, and the next view reads it again.
  - Auto still switches to exact points on the all-transcript estimate,
    because exact reads scan every transcript in the view whatever the
    filter.
  - Before Phase 15.1-J (2026-11) the reader indexed `density/gene` row by
    row, so its selected-gene squares counted the wrong cells; that path was
    hidden in June 2026.
- **Exact.** `loadTranscriptZarrViewport` reads the level-0 tiles that
  intersect the viewport and filters by `valid`, `Min QV`, bbox,
  `Gene-only calls`, and the feature filter, stopping at the budget. A tile
  without `valid` or `codeword_identity` is read without them; a failed read
  of either fails the view. Cell IDs
  are then added from `transcripts.parquet` (1.5 s deadline), matching each
  point to the row in the same field of view whose `transcript_id` has the
  same low 32 bits. The Zarr's `id` holds those bits and the index of the
  field of view in `fov_names`; the high 32 bits are 0x10000 plus that index
  (checked on XOA 1.7.1 and the demo's newer output), and the point then shows
  the full `transcript_id`. Before 2026-11 the join compared the low bits
  with the full ID, so no Zarr point got its cell. Without the
  Zarr, DuckDB queries `transcripts.parquet` directly. If the estimate is ≥ 80%
  of `Exact budget`, the user must press `Load exact viewport`.

### Annotations And Embeddings

- `analysis.zarr.zip` groupings load on demand; matrix row indices are mapped
  to cell IDs through the matrix `cell_id` array. Labels drop the
  `gene_expression_` prefix and `_clusters` suffix.
- Embedding CSVs are tried in order; the first usable UMAP and t-SNE files win.
  A path is missing when it answers 404 or 403, the folder index leaves it
  out, or the request fails on a host that hides its error responses; any
  other error fails the load, so the panel offers to try again. A row with an
  empty coordinate is left out. A projection the dataset manifest names
  replaces the search for its kind, and a notice says when it is missing or
  has no usable rows.

### Plots Panel

- `geneValues(genes)` reads each gene's slice of the feature-major
  `cell_features/indices` and `data` in `cell_feature_matrix.zarr.zip`, four
  genes at a time, after reading `cell_features/indptr` once
  (`geneValuesFromCellFeatureMatrixZarr`, `src/data/gex.ts`). Gene names
  match in any case, as in the gene list. Where two gene features share a
  name, Plots and the map's gene colours both read the first.
- Row IDs are the `cell_features/cell_id` integer pairs, made text in the
  plot worker (`xeniumCellIdText`), so a selection's and a set's cell IDs
  join to matrix rows by ID. On the demo (1.4 million cells), SNAP25 by the
  graph clusters plots 0.7 s after the clusters load, with no main-thread
  task over 200 ms beyond the load's own.
- Without a readable `cell_feature_matrix.zarr.zip`, the panel fails with a
  message naming the file; the H5 is not read.

### Selected Cell

- Gene profile: `loadRoiGeneStats` for one cell (CSC Zarr, else H5).
- Boundary and shape metrics: a boundary query around the cell.
- Z-axis distribution: `loadDatasetCellTranscriptDistribution`
  (`src/data/datasetCellTranscripts.ts`) reads Zarr transcripts in the cell's bbox,
  keeps those inside the polygon, and builds 16 bins. Needs
  `transcripts.zarr.zip`.

### ROI

- Cells: DuckDB `cells()` query for the box or lasso, up to 50,000
  (`src/data/roiCells.ts`). It asks for 50,001, so a selection with more
  inside is marked as cut short and one with exactly 50,000 is not.
- Gene stats (`src/data/roiGeneStats.ts`): a 32-cell preview, then a stratified
  10,000-cell refinement. Uses CSC Zarr rows from `file_row_number`, falling
  back to `cell_feature_matrix.h5`. Without either, ROI gene stats are
  unsupported.
- Warm-up (`useRoiWorkflow`): after load, reads up to 5,000 cells in the view
  and a 32-cell gene sample, then the enriched-genes reference sample, so the
  first ROI is quicker. Without CSC arrays it reads both from the H5
  fallback by range (`h5Fallback: 'range-read'`): on the demo, 35 requests
  and 37 MB of the 433 MB file, after which the first ROI's genes took 0.8 s
  instead of 4.9 s. A host that ignores Range would send the whole file, so
  there the warm-up stops at the Zarr matrix and the first ROI reads the H5.
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
  keyed by URL, byte range, and the file's size and ETag (or Last-Modified), so
  a file replaced at the same URL misses the cache; see
  [Caching](../architecture.md#caching) for hosts that send neither.
- In-memory: range-probe results, Zarr matrix metadata and `cell_id` index,
  H5 matrices, transcript Zarr metadata, and `XeniumDataset` instances.
- DuckDB-WASM runs in a worker per client; each `XeniumDataset` creates its own
  client at its first query and keeps it until the page is reloaded. The H5
  fallback's file is fetched, opened and read in an H5 file worker, and the
  overview's `cells.parquet` columns in a cells overview worker. zarrita reads (matrix, transcripts, analysis) run on the main
  thread, with their chunks decompressed in the Zarr decode workers.

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
| `src/data/cellsOverviewWorker.ts`, `src/workers/cellsOverview*.ts`                  | Overview read in a worker                                      |
| `src/data/datasetBoundaries.ts`, `src/rendering/boundaryViewport.ts`                | Viewport boundary loading                                      |
| `src/features/app-shell/useViewportDataWorkflow.ts`                                 | Separate cell and nucleus boundary requests                    |
| `src/features/app-shell/platformAdapter.ts`                                         | Nucleus loader routing; cell query skipped while hidden        |
| `src/data/geneExpression.ts`, `geneExpressionLod.ts`, `gex.ts`                      | Expression LOD and matrix readers                              |
| `src/data/datasetTranscripts.ts`, `transcriptOverlay.ts`, `transcriptZarr.ts`       | Transcript capabilities, density, exact points                 |
| `src/data/datasetCellTranscripts.ts`, `cellTranscripts.ts`                          | Selected-cell z distribution                                   |
| `src/data/roiCells.ts`, `roiGeneStats.ts`, `roiTranscripts.ts`                      | ROI queries and exports                                        |
| `src/data/analysisAnnotations.ts`, `analysisEmbeddings.ts`, `datasetAnnotations.ts` | Clusterings and embeddings                                     |
| `src/data/genePanel.ts`, `geneFeatures.ts`                                          | Gene list                                                      |
| `src/data/morphologyImage.ts`, `src/tiff/*`                                         | Morphology image                                               |
| `src/data/datasetWarmup.ts`                                                         | Warmup and CSC capability check                                |
| `src/data/duckdb.ts`                                                                | DuckDB-WASM client                                             |
| `src/data/cellid.ts`                                                                | Cell ID parsing                                                |
| `src/features/transcripts/*`                                                        | Transcript workflow and status panel                           |
| `src/data/datasetDiagnostics.ts`                                                    | Xenium diagnostics                                             |

## Known Limitations

- With both outline types on and cold, the nuclei are drawn about 6 s after
  the cells on the demo, because both queries run one at a time on one
  DuckDB instance. A second instance for nuclei would run them side by side,
  at the cost of another DuckDB worker and file cache.
- The Magic Lens has no QV filter. A `Min QV` setting that had no effect on
  results was removed in Phase 15.5.
- The morphology image is the first `experiment.xenium` path the folder's
  index page lists, or the first path when the host serves no index page. A
  path that fails to open falls back to the next one, with a notice naming
  the paths passed over (2026-11-12).
- The XOA 2.0+ z-stack `morphology.ome.tif` does not render correctly (one
  tile at the wrong scale, or a JPEG-2000 decode error); the
  `morphology_focus/` images do. A dataset without `morphology_focus/`, such
  as some BioImage Archive deposits, falls back to it.
- ROI gene stats assume `cells.parquet` row order matches the matrix row order.
