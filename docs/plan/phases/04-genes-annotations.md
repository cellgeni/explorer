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
  added.

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

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Other gaps found in the review:

- [x] Imported CSV/JSON annotations accept only Xenium cell IDs, so H5AD and
      SpatialData files are rejected. Since 2026-11-12 any non-empty ID is
      accepted. When none of the imported cells are on the map, the import
      fails with "Imported cells not found"; when some are not, a notice under
      the import controls says how many.
