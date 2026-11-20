# Visium HD 2 µm Loading Strategy

The 2 µm Visium HD tier must not use the full
`binned_outputs/square_002um/spatial/tissue_positions.parquet` as the first-paint
source. The reference dataset exposes more than 11 million position rows, and
that file is too large for the same eager overview path used by 16 µm and 8 µm.

## Current Contract

- Dataset detection reports the 2 µm tier when its
  `filtered_feature_bc_matrix/barcodes.tsv.gz`, `scalefactors_json.json`, and
  `filtered_feature_bc_matrix.h5` all answer `HEAD`. Its
  `tissue_positions.parquet` is neither read nor needed.
- The `Visium HD dataset` panel (Bins › Appearance) enables 2 µm when the
  tier is detected.
- `VisiumHdDataset.readBinnedOverview(2)` does not read the full
  `tissue_positions.parquet`.
- The 2 µm overview is built from
  `filtered_feature_bc_matrix/barcodes.tsv.gz`, the 2 µm
  `scalefactors_json.json`, and an affine grid basis derived from the 8 µm
  tier (or 16 µm when 8 µm is missing). The source tier's positions file is
  read in full to fit that basis. Without an 8 µm or 16 µm tier, the basis is
  fitted to `feature_slice.h5`'s spot-to-pixel transform
  (`transform_matrices.spot_colrow_to_microscope_colrow`), which places each
  bin within 0.08 full-resolution pixels of its Space Ranger position on the
  reference dataset. Without that either, 2 µm loading fails with
  `VisiumHdTwoMicrometerOverviewDisabledError`.
- Below zoom level 3 (`VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN`), a 2 µm selection
  renders 16 µm bins instead when 16 µm exists (`src/data/visiumHdGridLod.ts`),
  and queries 16 µm expression (`src/data/geneExpressionLod.ts`). With no
  16 µm tier the 2 µm bins are drawn, and the 16 µm expression is read for
  bins made from them.
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
detected. The older `2 µm budget` dataset control was removed; normal app
loading uses the barcode-sidecar path without a UI budget field.

The barcode reader streams `barcodes.tsv.gz` (since 2026-11-17): each line is
parsed into columns as it arrives, so neither the file nor its 75 MB of text
on the reference is held whole, and a barcode budget stops the download once
it is passed. The parse, about 0.6 s for 3.4 million lines, runs between
network reads rather than in one task. A viewport-scoped read is not
possible: the file is gzipped text, and the filtered matrix's barcodes are
not in spatial order.

## Barcode Mapping Bridge

`barcode_mappings.parquet` is the bridge from 2 µm squares to coarser 8 µm and
16 µm squares and segmented cell assignments. Selected segmented-cell expression
profiles use an on-demand DuckDB-WASM query for one `cell_id`, projecting only
`square_002um`, `square_008um`, `square_016um`, `cell_id`, `in_nucleus`, and
`in_cell`; the profile counts then come from the active tier's binned
`filtered_feature_bc_matrix.h5`, not the segmented cell matrix.

First paint does not touch `barcode_mappings.parquet`. Selecting a bin (cell
assignment in the Bin card) and projecting expression onto cell boundaries read
it with hyparquet, but only the row groups that can hold the requested bins.
Space Ranger sorts the file by 2 µm barcode, so row groups whose `square_002um`,
`square_008um` or `square_016um` min/max statistics rule out every bin are
skipped. On the reference (1,123 row groups of 10,000 rows) one 16 µm bin is
about 300 KB in one range request. The file's size and footer (704 KB) are read
once per dataset. The app passes no row budget; a budget caps the rows in the
row groups read.

hyparquet reads each column chunk with its own range request and starts them
all at once. A whole-file read sent 6,738, and Chromium failed them with
`net::ERR_INSUFFICIENT_RESOURCES`, taking other reads in flight with them.
The reader's URL buffer (`coalescingAsyncBuffer`, `src/data/`) merges the
slices asked for together into ranges of up to 8 MiB and keeps at most four
requests in flight.
