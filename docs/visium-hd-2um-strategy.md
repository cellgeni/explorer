# Visium HD 2 µm Loading Strategy

The 2 µm Visium HD tier must not use the full
`binned_outputs/square_002um/spatial/tissue_positions.parquet` as the first-paint
source. The reference dataset exposes more than 11 million position rows, and
that file is too large for the same eager overview path used by 16 µm and 8 µm.

## Current Contract

- Dataset detection may still report the 2 µm tier when the Space Ranger files
  are present.
- The Dataset tab keeps 2 µm visible but disabled unless a later UI path supplies
  an explicit rendering budget.
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

## Next Enablement Step

To expose 2 µm in the UI, add an explicit budget control or viewport-scoped mode
that passes `maxTwoMicrometerFilteredBarcodes` and keeps large reference datasets
disabled with the current explanatory reason.
