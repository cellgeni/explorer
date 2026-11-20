# Phase 4 — Genes, Gene Sets, Annotations

- [x] Gene picker backed by the full `gene_panel.json`.
- [x] Whole-slide expression colouring with level of detail.
- [x] Gene sets: paste symbol lists; score by sum, mean, or z-score; colour by
      score; save named sets.
- [x] Annotation import from `analysis.zarr.zip`, CSV, and JSON.
- [x] ROI: box and lasso drawing, ROI cell lookup, summaries, save as
      annotation, cell CSV export, ROI gene stats, transcript CSV export, and
      exact polygon-aware lasso selection.
- [x] UMAP/t-SNE panel linked to spatial selection.
- [x] HDF5 path for `cell_feature_matrix.h5`.

Notes on genes and expression:

- Gene sets accept comma, whitespace, or semicolon lists, matched
  case-insensitively. Saved sets can be removed. Changing the score mode does
  not refetch.
- `Auto LOD`: a stable whole-slide sample at overview zoom, padded viewport
  samples at medium zoom, and exact counts below 5,000 visible cells.
  `Exact region` loads exact counts for up to 50,000 visible cells and shows a
  waiting state above that instead of silently sampling. Low-zoom bins use fixed
  data-space centres so marks do not drift. Request keys use quantized view
  state, padded bounding boxes, and deterministic row strides. The expression
  overlay is not pickable, to keep panning cheap. A true all-cell whole-slide
  matrix scan was left as future work.
  **Superseded (November 2026):** see
  [Expression and rendering rework](optimization-pass.md#expression-and-rendering-rework-november-2026).
- Feature-major `cell_features/{indptr,indices,data}` matrices are supported.
- Expression fills visible boundary polygons when IDs match, and falls back to
  points otherwise.
- The colour scale uses a stable maximum per gene set across loaded regions,
  with numeric ticks. Plasma (default), Cividis, Teal, Rose, and Glasbey were
  added. **Superseded (2026-11-16):** the range can be set, and Auto tops at
  the 99th percentile; see
  [Gene Scale And Annotation Classes](#gene-scale-and-annotation-classes-november-2026).

Notes on annotations:

- Built-in clusters come from `analysis.zarr.zip`. Cluster CSR arrays are mapped
  to cell IDs through the matrix row order.
- The `Annotation set` selector offers `All` plus the groups found in the
  dataset (for example `graphclust`, `kmeans 3`, `kmeans 9`), and loads only the
  chosen group.
- Local CSV (`cell_id,label`) and JSON files import into the same list.
- Each label gets a deterministic colour, an editable swatch, and remove and
  clear-all actions. `Cell color` gains an `Annotations` mode.
- Overview loads keep true cell IDs, and boundary polygons inherit annotation
  colours.

Notes on ROI and embeddings:

- ROI cells come from `cells.parquet`; lasso uses DuckDB `ST_Within`.
- ROI gene stats show the top 10 genes by total count, with detected-cell
  percentage and mean per cell. Large ROIs are sampled.
- A fallback to `transcripts.parquet` aggregation was added for ROI gene stats.
  The feature-fix pass later reconfirmed CSC Zarr → H5 as the strategy.
- `Export Transcripts` Range-checks `transcripts.parquet` and downloads QV-filtered
  rows (cell ID, feature, x/y/z, QV, nucleus overlap, gene flag), using the
  same polygon test as the lasso.
- The embedding panel loads projection CSVs, samples large projections,
  highlights the ROI and selected cell, and selects a cell on click.
- An HDF5 test builds a tiny feature matrix with h5wasm and reads it through
  `gexFromCellFeatureMatrixH5`.

Notes on the viewer:

- CPU-side overview aggregation is off. All viewport-clipped centroids render as
  low-alpha hollow points. At low zoom the full centroid array is reused instead
  of being re-filtered.
- The idle background is solid black with the grid only; the empty state reads
  "Please load a dataset".
- The desktop control rail scrolls independently.
- The E2E smoke test checks the current shell (`Hide Controls`, the `Dataset`
  tab, URL, and load button).

Definition of done: pick a marker panel, score a signature, import cell-type
labels, and export an ROI's expression, all client-side. Verified with build,
tests, typecheck, lint, and E2E.

## Gene Scale And Annotation Classes (November 2026)

Added from 2026-11-15 to 2026-11-16, mostly while browsing the SPCOX
collection ([Phase 20](20-dataset-collections.md)).

Gene scale (Cells › Cell color):

- [x] Set the range (#111): the ends under the gradient are number fields,
      each set on its own; scores outside take the end colours; one range for
      the view, the legend and the collection previews, kept across genes and
      datasets; `geneRange=min,max` in links. The middle label shows the
      score at the gradient's middle, a quarter of the way up, since colours
      follow the square root of the share.
- [x] Auto tops at the 99th percentile of the selected genes' scores above 0
      (nearest rank, by quickselect), not the highest score, so one outlier no
      longer washes out the rest; the highest top seen is kept while panning
      (#128). On the Xenium demo, SNAP25's top went from 11 to 4.
- [x] A percentile top in links (`geneRange=,p95`), manifests and collections
      (`[null, "p95"]`) follows each dataset (#128).
- [x] The ends are always fields, read as labels until pointed at; the cog
      added in #113 is gone, and `Reset` follows the label while a range is
      set (#128).

Annotation classes (Cells › Clusters and the legend):

- [x] AnnData classes in category order, so the same categories get the same
      colours in every dataset (#104).
- [x] Alt-click a class to show only it, and again to show all (#104).
- [x] Hidden classes, and cells in no shown class, fade to 15% opacity in the
      view and the previews instead of turning solid grey (#106).
- [x] Every class is listed, with the layer panel scrolling instead of an
      8-row list. The set's eye button turns its colouring off; an
      all-classes checkbox checks or unchecks them all. Unchecking every
      class fades every cell instead of falling back to transcript count
      (#110).
- [x] Sets with more than 8 classes get a search box, and the all-classes
      checkbox then acts on the matches. The Metadata tracks list shows
      every track; past about 15 it had shown an empty gap (#112).

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Other gaps found in the review:

- [x] Imported CSV/JSON annotations accept only Xenium cell IDs, so H5AD and
      SpatialData files are rejected. Since 2026-11-12 any non-empty ID is
      accepted. When none of the imported cells are on the map, the import
      fails with "Imported cells not found"; when some are not, a notice under
      the import controls says how many.

Found by the [2026-11-16 review](../open-items.md#found-by-the-2026-11-16-review):

- [x] CSV exports (`annotations.csv` and the ROI cells, transcripts and
      barcodes files) did not neutralise a leading `=`, `+`, `-` or `@`, so a
      cell ID or label from a remote dataset or an `annotationUrl=` import
      could run as a formula when the file was opened in a spreadsheet.
      Since 2026-11-16 the three copies of `csvEscape` are one `formatCsv`
      (`src/utils/csv.ts`), which puts a `'` before a field that starts with
      one of those, a tab or a line break, unless it is a number, so
      negative coordinates stay numbers. The annotation importer drops that
      `'`, so an exported file imports unchanged.
- [x] `annotationUrl=` and Import URL read the whole response with
      `response.text()`, with no byte limit, unlike the H5AD and segmentation
      loaders, and parse it on the main thread, so a link to a large file
      could stall or crash the tab. Since 2026-11-16 they stop at 100 MiB
      (`readAnnotationUrlText` in `annotationUrlText.ts`): before reading
      when Content-Length is over it, or as soon as the bytes read pass it,
      and say "Annotation file too large". Parsing stays on the main thread;
      it ran at about 40 MB/s here (2 million `cell_id,label` rows, 95 MB, in
      2.5 s). Imports from disk are not limited, since the user picks the
      file.
- [x] DuckDB extension failures were dropped: `createDuckDbClient` called
      `configureDuckDb(conn)` without `onHttpfsLoadError` or
      `onSpatialLoadError`, so when `LOAD spatial` failed nothing said so,
      and the lasso, the one spatial query, failed later with a catalog
      error. Since 2026-11-16 `spatial` loads on the first lasso query
      (`loadDuckDbSpatial` in `duckdb.ts`) instead of when a DuckDB client
      starts. It is 4.4 MB to download and 23.5 MB of WASM to compile, and
      loading it took about 1.4 s from every client in headless Chromium,
      though only the lasso uses it. If it does not load, the lasso shows
      "DuckDB extension did not load" under Issues, with the address that
      failed, and the next lasso tries again. `parquet` now loads when the
      client starts: left to load on the first query, a failed load
      reported only "function signature mismatch", then and on every later
      query. A failed `httpfs` load logs a console warning: reads still
      work without it, but counting `cells.parquet` took 3.7 s instead of
      0.5 s. The extensions still come from extensions.duckdb.org at run
      time, outside the lockfile and `npm audit`; the URL carries DuckDB's
      version, and DuckDB refuses unsigned extensions.
