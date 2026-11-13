# Phase 6 — Visium HD

The original brief's Phase 6 covered both standard Visium and Visium HD.

| Original Phase 6 task                                              | Outcome                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `VisiumHDDataset` implementing `SpatialDataset`                    | Done (`VisiumHdDataset`)                                    |
| `VisiumDataset` (spots, `tissue_positions.csv`, `circle` geometry) | Done in [Phase 14](14-standard-visium.md)                   |
| `scalefactors_json.json` + tissue PNGs → `image()` as `flat`       | Done for Visium HD                                          |
| `filtered_feature_bc_matrix.h5` → `matrix()` via h5wasm            | Done, through a lazy-range worker                           |
| `analysis/` → `annotations()`                                      | Embeddings only; Visium HD cluster annotations not recorded |
| `capabilities.transcripts = false`, `pyramidImage = false`         | Done                                                        |
| Spot/square render layer                                           | Done as an affine grid layer                                |
| `binned_outputs/` resolution switcher (2/8/16 µm)                  | Done                                                        |

Original definition of done: a Visium dataset renders spots over its tissue
image with gene colouring, gene sets, annotations, and ROI export, reusing the
Xenium UI unchanged.

## Product Decisions

- [x] A real `VisiumHdDataset`, not Visium branches inside `XeniumDataset`.
- [x] A dataset factory/detector. URL helpers and caches must stop assuming
      Xenium file names.
- [x] Bins, not cells, are the renderable unit. Barcodes are element IDs. Bin
      size is a dataset setting.
- [x] **Affine grid.** Bins are an indexed affine grid with a dataset-level
      basis (`origin`, `rowStep`, `colStep`). An axis-aligned square is just a
      special case.
- [x] **Columnar storage.** `ElementGeometry` is only for picking, tooltips, and
      selection. Grid tiers are stored as columns (`Int32Array` rows and
      columns, one interned `gridId`).
- [x] **Grid invariants.** `origin` is the centre of bin (0, 0). `rowStep` and
      `colStep` are centre-to-centre pitches in the same render space as
      polygons and images. `row`/`col` match Space Ranger `array_row`/
      `array_col`. Corners use the ±0.5 rule in array space. Occupancy is not
      part of the basis.
- [x] **Nominal vs measured.** `binSizeMicrometers` is the declared tier size
      for labels and logic. `rowStep`/`colStep` are the measured geometry. Small
      differences are expected.
- [x] **One basis.** Fit the finest reliable basis once and derive coarser tiers
      by integer scaling, so tiers nest exactly for `barcode_mappings.parquet`.
- [x] Start with 16 and 8 µm before Feature Slice and segmented outputs. Treat
      2 µm as a high-density mode with explicit handling.
- [x] Hide Xenium-only workflows: transcripts, raw transcript hover, Magic Lens
      transcript scans, Xenium cell boundaries, and `analysis.zarr.zip`
      annotations.
- [x] Use binned tissue PNGs and `scalefactors_json.json` for the image
      underlay, through `ImageSource.kind === 'flat'`.
- [x] Keep coordinates in micrometres, but model full-resolution pixels and
      scalefactors explicitly. Do not assume Xenium's pyramid units or Y-axis
      handling in shared code.

## Slices

- [x] 1. Detection and capability plumbing: `VisiumHdDataset`, generic caches,
     platform-aware diagnostics, the generic element-ID contract, and the
     affine-grid contract. Visium HD is detected from binned
     `tissue_positions.parquet`, `scalefactors_json.json`, and
     `filtered_feature_bc_matrix.h5`.
- [x] 2. Binned overview reader: 16 µm `tissue_positions.parquet`, filtered to
     `in_tissue = 1`, converted through `microns_per_pixel`, returned as
     columnar grid cells. 8 µm behind a selector.
- [x] 3. Grid rendering through a dedicated layer, with correct winding for
     left-handed image bases. Hover and selection show barcode, bin size,
     array row/column, full-res pixel, and expression.
- [x] 4. Flat tissue image with scale-factor alignment and opacity.
  - [x] **Reopened (2026-11-08), fixed 2026-11-12:** fallback from high-res
        to low-res. `image()` sends a `HEAD` for `tissue_hires_image.png`; if
        it cannot be read (or a folder listing leaves it out), the viewer
        draws `tissue_lowres_image.png` at `tissue_lowres_scalef` and a
        notice names the skipped path, on the first load and after a bin
        switch. With neither image it fails as before.
- [x] 5. Binned gene panel (`features.tsv.gz`) and expression. Never use the
     Xenium cell-ID codec for Visium.
- [x] 6. ROI over bins with barcode export; embeddings from binned
     `analysis/umap/gene_expression_2_components/projection.csv`, keyed by
     barcode.
- [x] 7. 2 µm without loading all 11.2M position rows: filtered matrix barcodes
     plus a derived affine transform.
- [x] 8. Feature Slice and segmented outputs:
  - [x] Feature Slice H5 selected-gene reader, budget error classification, and
        lazy-range worker backend.
  - [x] Budgeted `barcode_mappings.parquet` reader and bin-to-cell bridge.
  - [x] Segmented-output detection and diagnostics (feature-cell matrices,
        cell/nucleus GeoJSON, annotated GeoJSON, nucleus mask TIFF).
  - [x] Cell GeoJSON polygons through the existing boundary layer.
  - [x] Annotated nucleus GeoJSON styling.
  - [x] Nucleus instance-mask TIFF through a viewport-scoped reader.
  - [x] Viewport-scoped streaming of oversized GeoJSON.

## Execution Notes

Foundation:

- Generic `SpatialElementId`, `GexResult<ElementId>`, `SpatialGrid`,
  `SpatialGridBasis`, columnar `GridCellBatch`, and logical `grid-cell`
  geometry. Affine helpers cover centres, corners, winding, least-squares
  fitting, and nested tiers.
- Diagnostics run detection first, then check each platform's files. For Visium
  HD they check the active tier's positions, scalefactors, matrix, images, and
  optional UMAP, plus root `feature_slice.h5` and `barcode_mappings.parquet`.

Rendering and lifecycle:

- Dataset loading detects the platform before any Xenium warmup, then routes
  Visium HD through `getSpatialDataset()`. It reads the default binned overview
  and draws the high-res PNG through `MorphologyCanvas`.
- The Dataset tab labels the dataset type, renames the image toggle
  `Tissue image`, disables `Boundary limit`, and offers bin tiers. Switching
  tiers reuses the cached dataset.
- Clicking a bin opens `Bin Info` without starting Xenium cell loaders.

Expression (in order):

1. Selecting a gene hung the UI because the whole H5 matrix was read. The path
   was paused.
2. A `HEAD` size check now rejects full-file reads over 64 MB before importing
   h5wasm. The reference 16 and 8 µm matrices exceed it.
3. A Feature Slice H5 reader parses `metadata_json`, `/features/name`, and
   `/features/feature_type`, reads `/feature_slices/{i}/{row,col,data}`, bins 2
   µm coordinates to 8/16 µm, and returns per-barcode counts.
4. A lazy-range worker backend lets hosted `feature_slice.h5` reads fetch only
   the ranges they need. Selected-gene overlays were enabled.
5. Bin and cell all-gene profiles read `filtered_feature_bc_matrix.h5` through a
   lazy-range worker, with no default 64 MB limit. Clicking a bin loads its
   profile automatically; the button refreshes it. Worker requests are queued
   and transient XHR errors are retried.
6. Selected-gene scores and all-gene profiles are labelled separately in Bin and
   Cell Info.

2 µm tier (in order):

1. 2 µm could not become the default first paint, and direct 2 µm overview reads
   were rejected.
2. Square barcodes (`s_002um_*_*`) are parsed from
   `filtered_feature_bc_matrix/barcodes.tsv.gz`. The 2 µm grid is derived from a
   coarser basis.
3. 2 µm was enabled only with an explicit barcode budget, first from
   `VITE_VISIUM_HD_MAX_TWO_MICROMETER_FILTERED_BARCODES`, then from a runtime
   `2 µm budget` field.
4. **Final:** the `2 µm budget` and `Mapping rows` fields were removed. 2, 8,
   and 16 µm reads use all rows unless a lower-level caller sets a cap.
   `docs/visium-hd-2um-strategy.md` records the contract.

Shared grid basis: 16 µm is derived from 8 µm when both exist; 2 µm prefers 8
µm, then 16 µm.

Segmented outputs:

- Detection records which Space Ranger 4.1 segmentation files are present.
- Cell GeoJSON (`FeatureCollection` polygons and multipolygons) is converted
  from full-res pixels to micrometres. It sets `capabilities.cellBoundaries`.
  Numeric `cell_id`s are normalized. Graphclust-annotated GeoJSON is used when
  the plain file is missing, keeping labels and colours.
- `segmentationElements(kind, bbox)` loads cell or nucleus geometry.
  `elements(bbox)` stays cell-only.
- The default 64 MB GeoJSON limit was removed. GeoJSON is streamed by
  bounding box and cached per bounding box.
- When cell polygons are loaded, the bin grid is hidden but kept for ROI and
  export. Segmented cells are pickable and have hover tooltips.
- Nuclei are drawn as a separate blue, non-pickable layer. The nucleus TIFF
  mask is read in a viewport window, and nonzero labels become polygons.
  GeoJSON is preferred over the TIFF.
- Bin and boundary layers no longer flicker while a boundary request is
  pending, and density estimates use stable grid counts (`c4674c1`).

Other:

- `barcode_mappings.parquet` has a budgeted, column-projected reader exposed
  through `VisiumHdDataset`.
- ROI selection is scoped to the active dataset and tier, and exports barcodes
  as CSV. Embeddings prefer the active tier's projection.
- The reference dataset lacks image size fields in `scalefactors_json.json`,
  so image size is optional.

Shipped but not recorded at the time (from commits):

- Segmented-cell profiles query `barcode_mappings.parquet` with DuckDB for one
  `cell_id`, then read those bins from the active tier's filtered matrix
  (`baac653`, 2026-06-22). Bin expression is projected onto mapped cells for
  boundary colouring (`5d53124`, 2026-06-19).
- Zoom LOD for grids: with 2 µm selected below zoom 3, the 16 µm grid is shown,
  and colour-averaged 16 µm aggregates stand in for zoomed-out 2 µm bins. They
  cannot be picked (`157efdf`, 2026-06-29).
- Zoom LOD for expression: 2 µm requests use 16 µm data below zoom 3, and 8 µm
  requests use 16 µm at zoom −1.25 or lower, over the whole slide (`32d1c47`).
- Edge bins colour correctly (`83d5036`); the Transcripts tab is hidden for
  Visium HD (`99d002a`); bin opacity controls apply to grids (`25c17f6`).
- Bins draw through an instanced layer (`bf6ebc8`).

Known gaps (2026-11-08 review):

- Segmentation GeoJSON is re-streamed for each new viewport; the bbox cache
  only helps when the same box is requested again.
- Barcode-mapping reads are not cached when an `AbortSignal` is passed, and the
  app always passes one, so each bin selection re-reads
  `barcode_mappings.parquet`. Fixed 2026-11-12: they are shared loads, and a
  bin selection reads only the row groups that can hold the bin (see
  [Closed Open Items](#closed-open-items)).
- 16 µm first paint also reads the whole 8 µm positions file to derive the
  basis. The 2 µm positions file must exist for detection, though it is never
  read. With only a 2 µm tier, the default load fails.

## Definition Of Done (MVP)

- [x] The reference URL renders a tissue image with aligned 16 µm bins, with no
      Xenium files.
- [x] Users can switch between 16 and 8 µm. 2 µm is either unavailable with a
      reason or enabled through a budgeted path.
- [x] The UI labels the dataset as Visium HD and disables transcript, Magic
      Lens, and Xenium boundary controls without misleading errors.
- [x] Hover and click on a bin show barcode, size, tissue status, array
      row/column, image coordinate, and expression.
- [x] Diagnostics check the files that matter for the selected mode.
  - [x] **Reopened (2026-11-08), fixed 2026-11-12:** the high-res PNG was
        marked required, segmentation GeoJSON was fetched in full, and
        `barcodes.tsv.gz` and `features.tsv.gz` were not checked. Both tissue
        images are now optional `HEAD` checks, with a required check that one
        of them can be read; the GeoJSONs get a `HEAD`; `features.tsv.gz` is
        required on every tier and `barcodes.tsv.gz` on 2 µm. Checks that read
        only the status, and the Range probe, cancel the body, so a host that
        ignores Range no longer starts a whole-file download.
- [x] Unit tests cover detection, scalefactors, tissue positions, the affine
      transform, grid layer conversion, and capability gating.
- [x] Browser smoke covers image plus 16 µm bins (54,504 bins).
- [x] Full verification passed.

## Post-MVP Hardening

- [x] First pass at broader browser coverage: 16/8 µm switching, 2 µm
      enablement, Feature Slice overlay, ROI barcode export, segmentation
      controls, and Bin Info.
- [ ] Optimize hosted Visium HD datasets: interaction profiling, segmentation
      streaming cost, Feature Slice worker ranges, memory, and bundle splitting.
- [x] Vendor chunk groups (see [Optimization Pass](optimization-pass.md)).
- [x] Transition helpers, the platform adapter, and the viewer split (see
      [the refactor record](../engineering.md#application-structure-and-refactor-record)).

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Reopened by the 2026-11-08 review (marked done before, found incomplete):

- [x] Visium HD: low-res tissue image fallback (2026-11-12). Without a
      readable high-res PNG the viewer draws the low-res one, with a notice.
- [x] Visium HD diagnostics: treat the high-res PNG as optional, avoid fetching
      whole GeoJSON files, and check `barcodes.tsv.gz` and `features.tsv.gz`
      (2026-11-12; see [Phase 6](#phase-6--visium-hd)).

Other gaps found in the review:

- [x] Visium HD: cache barcode-mapping reads across bin selections
      (2026-11-12). Whole-file and per-cell reads are shared loads
      (`waitForSharedLoad`) that callers' signals no longer bypass. A bin
      selection reads only the row groups that can hold the bin, and the file's
      size and footer are read once per dataset, so a later selection is one
      range request (about 300 KB for a 16 µm bin on the reference).

Testing:

- [x] The Bin card's cell assignment fails on the Visium HD reference with
      "Network request failed: Failed to fetch". Reading the 110 MB
      `barcode_mappings.parquet` (`readVisiumHdBarcodeMappings`, hyparquet
      `parquetReadObjects` on a URL buffer) sends about 6,700 range requests
      within a second, and Chromium rejects them with
      `net::ERR_INSUFFICIENT_RESOURCES`; other reads in flight, such as
      `feature_slice.h5`, can fail with them. Found by the live tests on
      2026-11-12. Fixed 2026-11-12:
  - Cause: given `columns`, hyparquet's `parquetPlan` makes one range per
    column chunk without merging neighbours, and `prefetchAsyncBuffer` starts
    them all at once: 1,123 row groups × 6 columns = 6,738 requests.
  - The reader's URL buffer (`coalescingAsyncBuffer`) merges slices asked for
    together into ranges of up to 8 MB and keeps at most 4 in flight. A
    whole-file read is now 14 data requests (24 s in Node, 3.6 GB of heap).
  - The card and expression projection read only the row groups whose
    `square_0XXum` statistics can hold the bins: about 3 of 1,123 for one
    16 µm bin. Bin reads decode at most 262,144 rows per hyparquet read, two
    at a time.
  - The live test passes without `test.fail()`, and the Bin card and 2 µm
    live tests no longer block the file.
