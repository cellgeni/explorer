# Visium HD 2 µm Loading Strategy

The 2 µm Visium HD tier must not use the full
`binned_outputs/square_002um/spatial/tissue_positions.parquet` as the first-paint
source. The reference dataset exposes more than 11 million position rows, and
that file is too large for the same eager overview path used by 16 µm and 8 µm.

## Current Contract

- Dataset detection reports the 2 µm tier when its
  `tissue_positions.parquet`, `scalefactors_json.json`, and
  `filtered_feature_bc_matrix.h5` all answer `HEAD`. The positions file must
  exist even though it is not read.
- The Dataset tab enables 2 µm when the tier is detected.
- `VisiumHdDataset.readBinnedOverview(2)` does not read the full
  `tissue_positions.parquet`.
- The 2 µm overview is built from
  `filtered_feature_bc_matrix/barcodes.tsv.gz`, the 2 µm
  `scalefactors_json.json`, and an affine grid basis derived from the 8 µm
  tier (or 16 µm when 8 µm is missing). The source tier's positions file is
  read in full to fit that basis. Without an 8 µm or 16 µm tier, 2 µm loading
  fails with `VisiumHdTwoMicrometerOverviewDisabledError`.
- Below zoom level 3 (`VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN`), a 2 µm selection
  renders and queries 16 µm bins instead when 16 µm exists
  (`src/data/visiumHdGridLod.ts`, `src/data/geneExpressionLod.ts`).
- Lower-level callers and tests may still pass
  `maxTwoMicrometerFilteredBarcodes` to impose an explicit barcode-count cap.

## Budgeted Barcode Path

The budgeted path reads only filtered matrix barcodes, parses Space Ranger square
barcode coordinates such as `s_002um_000001_000002-1`, derives the 2 µm affine
grid basis from a loaded 8 µm or 16 µm basis, and emits a columnar
`GridCellBatch`.

This path intentionally uses the filtered matrix sidecar because those barcodes
represent in-tissue bins and avoid materializing out-of-tissue positions. If a
caller supplies a barcode budget and the barcode count exceeds it, parsing fails
with `VisiumHdFilteredBarcodeBudgetExceededError`.

## UI Enablement

The app enables the 2 µm segmented control when the 2 µm binned output is
detected. The older `2 µm budget` Dataset HUD control was removed; normal app
loading uses the barcode-sidecar path without a UI budget field.

The current gzip barcode reader still buffers `barcodes.tsv.gz`. This is much
smaller than full 2 µm positions for typical filtered in-tissue bins, but very
large hosted deployments should still consider a streaming or viewport-scoped
barcode reader before treating 2 µm first paint as unbounded.

## Barcode Mapping Bridge

`barcode_mappings.parquet` is the bridge from 2 µm squares to coarser 8 µm and
16 µm squares and segmented cell assignments. Selected segmented-cell expression
profiles use an on-demand DuckDB-WASM query for one `cell_id`, projecting only
`square_002um`, `square_008um`, `square_016um`, `cell_id`, `in_nucleus`, and
`in_cell`; the profile counts then come from the active tier's binned
`filtered_feature_bc_matrix.h5`, not the segmented cell matrix.

First paint does not touch `barcode_mappings.parquet`. Selecting a bin (cell
assignment in `Bin Info`) and projecting expression onto cell boundaries read
it in bulk with hyparquet. The app passes no row budget, and these reads are
not cached because the workflows pass an `AbortSignal`, so each selection
reads the file again.
