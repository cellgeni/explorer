# Visium HD 2 µm Loading Strategy

The 2 µm Visium HD tier must not use the full
`binned_outputs/square_002um/spatial/tissue_positions.parquet` as the first-paint
source. The reference dataset exposes more than 11 million position rows, and
that file is too large for the same eager overview path used by 16 µm and 8 µm.

## Current Contract

- Dataset detection may still report the 2 µm tier when the Space Ranger files
  are present.
- The Dataset tab keeps 2 µm visible but disabled unless the dataset loader is
  created with an explicit filtered-barcode rendering budget from the UI or
  environment.
- `VisiumHdDataset.readBinnedOverview(2)` rejects by default before reading
  `tissue_positions.parquet`.
- When `maxTwoMicrometerFilteredBarcodes` is configured, the dataset can build a
  2 µm overview from `filtered_feature_bc_matrix/barcodes.tsv.gz` instead.

## Budgeted Barcode Path

The budgeted path reads only filtered matrix barcodes, parses Space Ranger square
barcode coordinates such as `s_002um_000001_000002-1`, derives the 2 µm affine
grid basis from a loaded 8 µm or 16 µm basis, and emits a columnar
`GridCellBatch`.

This path intentionally uses the filtered matrix sidecar because those barcodes
represent in-tissue bins and avoid materializing out-of-tissue positions. If the
barcode count exceeds the supplied budget, parsing fails with
`VisiumHdFilteredBarcodeBudgetExceededError`.

## UI Enablement

The app enables the 2 µm segmented control when the constructed
`VisiumHdDataset` exposes `maxTwoMicrometerFilteredBarcodes`. The default
production loader leaves this unset, so the public reference dataset remains
disabled with the explanatory reason.

The Dataset HUD exposes a `2 µm budget` numeric field. Leaving it blank uses the
build-time default. Entering a positive integer passes that runtime value to the
cached dataset loader as `visiumHdMaxTwoMicrometerFilteredBarcodes`, and dataset
cache entries are keyed by the effective budget so switching budgets rebuilds the
Visium HD dataset safely.

For controlled deployments or tests, set
`VITE_VISIUM_HD_MAX_TWO_MICROMETER_FILTERED_BARCODES` to a positive integer. The
constant `VISIUM_HD_TWO_MICROMETER_FILTERED_BARCODE_BUDGET_ENV` reads that key.
The UI value takes precedence when present; otherwise the loader passes the env
value into `VisiumHdDataset`, and the Dataset tab allows the 2 µm tier to be
selected. The current gzip reader still buffers
`barcodes.tsv.gz`, so do not enable this for large hosted datasets until a
streaming or viewport-scoped barcode path is available.

## Barcode Mapping Bridge

`barcode_mappings.parquet` is the bridge from 2 µm squares to coarser 8 µm and
16 µm squares and segmented cell assignments. The first Slice 8 reader projects
only `square_002um`, `square_008um`, `square_016um`, `cell_id`, `in_nucleus`,
and `in_cell`, and requires an explicit row budget. It is a foundation for
bin-to-cell workflows and is now used by the selected Bin Info panel when the
Dataset HUD has a `Mapping rows` budget. Default rendering still does not touch
`barcode_mappings.parquet`.
