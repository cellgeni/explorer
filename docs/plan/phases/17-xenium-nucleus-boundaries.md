# Phase 17 — Xenium Nucleus Boundaries

Planned and shipped 2026-11-13. The original brief listed `nucleus_boundaries.parquet` as
an optional overlay, but no outcome was ever recorded (see
[Closed Open Items](#closed-open-items)). Visium HD and Atera already draw nuclei behind
the `Nucleus boundaries` checkbox. Xenium hides that checkbox
(`nucleusBoundaries: false` in `platformAdapter.ts`) and never reads the
file.

What the file holds on the Xenium demo (XOA 3.0), checked 2026-11-13 with
hyparquet:

- 99.6 MB, with 35,058,859 rows in 36 row groups of 1,000,000 rows. The
  columns are the same as in `cell_boundaries.parquet`: `cell_id` (string),
  `vertex_x` and `vertex_y` (FLOAT, µm), and `label_id` (INT64). The vertex
  and label columns carry row-group statistics.
- Each nucleus's rows are together in file order. Each ring repeats its first
  vertex at the end and has at most 25 vertices.
- A cell can have several nuclei, told apart by `label_id`. In the first row
  group, 1,366 of 38,810 cells (3.5%) have more than one.

## Product Decisions

- **DECISION:** Read the nucleus file with DuckDB, the same way as
  `cell_boundaries.parquet` ([4.9](../decisions.md#49-cell-boundaries)). Cell IDs come from
  the `cells.parquet` centroids in the padded viewport. Vertex bounds are cast
  to FLOAT so row groups are pruned, and vertices are ordered by
  `file_row_number`. The margins are the same as for cells, and no new engine
  is added.
- **DECISION:** Split nuclei by `cell_id` and `label_id`. A cell's first
  nucleus keeps the cell ID, and later ones get `<cell_id>#nucleus-N`, as on
  Atera. Older files without `label_id` are read again without that column
  and grouped by `cell_id` alone, the same retry the overview uses for
  optional `cells.parquet` columns.
- **DECISION:** The nucleus file gets its own manifest file role,
  `nucleusBoundaries`, defaulting to `nucleus_boundaries.parquet`.
  Diagnostics check it as an optional Range file. It is Range-probed before
  the first nucleus query, as the cell file is, so a missing file gives an
  error that names it.
- **DECISION:** Nuclei use the existing blue, non-pickable nucleus layer and
  the `Nucleus boundaries` checkbox. It stays off by default on Xenium.
  `nucleusBounds=1` in a link or the manifest default `nucleusBoundaries`
  turns it on. The layer is pickable since 2026-11-17 (**Superseded** in
  part; see [Closed Open Items](#closed-open-items)).
- **DECISION:** On Xenium, the cell boundary query runs only while
  `Cell boundaries` is on. Both queries share the boundary DuckDB instance,
  which runs one query at a time. Without this, nuclei shown alone would wait
  for a cold cell query first (about 7 s on the demo). Atera and Visium HD
  keep loading cells with nuclei. **Superseded** in part on 2026-11-17: every
  platform reads cell outlines only while they are shown (see
  [Closed Open Items](#closed-open-items)).
- Out of scope: nucleus picking, hover, or a nucleus card (**Superseded**
  2026-11-17); nucleus shape metrics beyond each nucleus's area and
  circularity; and the polygons in Xenium's `cells.zarr.zip`.

## Tasks

- [x] `nucleusBoundaries` file role: Xenium file defaults, manifest schema,
      and `docs/dataset-manifest.md`.
- [x] `readXeniumNucleusBoundaryElements` in `xeniumDatasetReaders.ts`,
      sharing the viewport query with the cell reader. Unit tests cover
      multi-nucleus cells, a file without `label_id`, rings with fewer than 3
      vertices, and the cast bounds.
- [x] `XeniumDataset.segmentationElements(kind, bbox)`, and
      `meta().segmentations` listing cell and nucleus outlines
      (`sourceKind: 'parquet'`). The nucleus file is Range-probed before the
      first query.
- [x] Xenium platform adapter: `nucleusBoundaries: true`. Boundaries load
      when either checkbox is on, the request key covers both checkboxes, and
      the nucleus loader reaches Xenium.
- [x] Skip the cell boundary query on Xenium while `Cell boundaries` is off
      (`cellBoundaryLoadingEnabled` on the platform adapter).
- [x] Diagnostics list `nucleus_boundaries.parquet` as an optional Range file.
- [x] Tests: platform adapter, diagnostics, and an App test where the Xenium
      nucleus checkbox loads and draws nuclei and sends no cell query once
      `Cell boundaries` is off. An `@live` E2E test opens the demo with only
      nuclei on and waits for `0 cells`, `N nuclei` in the log (52 s
      headless with software WebGL).
- [x] Docs: `xenium.md`, `host-your-own-data.md`, `ui-reference.md`,
      `user-guide.md`, and `architecture.md`; `PLAN_VS_DOCS.md`; and this
      plan's Xenium file table ([5.1](../data-contracts.md#51-xenium-output-read-as-is-never-require-preprocessing))
      and Open Items.
- [x] Checked against the Xenium demo. Nuclei line up with the DAPI channel
      and sit inside cell outlines. Timings are below.

## Delivered

- [x] Measured on the demo in headless Chromium with Metal WebGL (Playwright
      `channel: 'chromium'`, `--use-angle=metal`), at a 1280 × 800 view in
      brain tissue (`view=1303,-1920,0,2.5`): 4,292 cells and 4,297 nuclei
      in the padded request.
  - Cells only, cold: 9.9 s, with 20 requests and 16.4 MB of
    `cell_boundaries.parquet`.
  - Nuclei added: nuclei 4.0 s cold, with 19 requests and 14.6 MB of the
    99.6 MB file. The repeat cell query took 0.45 s from DuckDB's file cache.
  - Cells turned off: no cell query; nuclei 0.46 s from the cache.
  - Nuclei only, cold: 13.0 s. Both, cold: cells 12.9 s and nuclei 17.2 s,
    since the nucleus query waits behind the cell query.
  - The same steps in software WebGL took 15–19 s each, because each redraw
    of the 1.4 M-cell overview blocks the main thread for seconds. Use
    hardware WebGL for boundary timings.
- [x] The in-app Browser pane gave no viewport events while it was hidden, so
      no boundary request started there. That is the preview environment,
      not the app.

## Definition Of Done

- Ticking `Nucleus boundaries` on the Xenium demo draws nucleus outlines in
  the viewport, under the same load rule and `Boundary limit` as cells. Every
  nucleus of a multi-nucleus cell is drawn.
- Unticking `Cell boundaries` while nuclei are shown sends no cell boundary
  query.
- A dataset without the file shows the boundary error naming
  `nucleus_boundaries.parquet`, not an empty layer. Diagnostics list the file
  as an optional file that is missing.
- Shareable links and manifest defaults restore the checkbox on Xenium.
- `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` pass,
  and this plan and `docs/` are updated.

## Known Gaps

- [ ] With both outline types on and cold, the nuclei are drawn about 6 s
      after the cells on the demo, because one DuckDB instance runs both
      queries in turn. A second instance for nuclei would run them side by
      side, at the cost of another DuckDB worker and file cache.
- [ ] On Visium HD, bins are drawn above cell and nucleus outlines and take
      the pointer, so outlines cannot be hovered or clicked where bins are
      drawn. The nucleus-to-cell link is in place for when they can.

## Closed Open Items

Closed 2026-11-17, checked in headless Chromium (Metal WebGL) against the
Xenium demo and against BioImage Archive S-BIAD1426, an XOA 1.7.1 run whose
`nucleus_boundaries.parquet` has no `label_id`. See
[Xenium](../../modalities/xenium.md#nucleus-boundaries).

- [x] Cell outlines no longer wait for the nuclei (2026-11-17).
      **DECISION:** cell and nucleus outlines are separate viewport
      requests on every platform (`useViewportDataWorkflow.ts`), each with
      its own request refs, covered area, `BoundaryLoadState`, loading task
      (`Loading cell boundaries`, `Loading nucleus boundaries`) and log line,
      rather than a second DuckDB instance for nuclei. Each layer is drawn
      when its query returns. Both on, cold, at a 1280 × 800 view of about
      4,560 cells: cells in 15.8 s, nuclei in 21.9 s; before, both were drawn
      once the nuclei arrived.
- [x] A failed nucleus read leaves the cell outlines (2026-11-17). Its error
      has the source `Nucleus boundaries`; the viewport shows a cell outline
      error first, then a nucleus one (`viewerBoundaryLoadState`). With the
      demo's nucleus file answered 404, the cells were drawn and the
      viewport named `nucleus_boundaries.parquet`.
- [x] Each checkbox reads only its own outline type (2026-11-17). A hidden
      layer stops its request and drops its error but keeps the outlines it
      read, so showing it again in the same area reads nothing; the
      adapter's `boundaryLoadingEnabled` and `boundaryOverlayRequestKey`
      were removed. On the demo, unticking and ticking either checkbox made
      no request.
- [x] Nucleus hover and the nucleus card (2026-11-17). **DECISION:** a
      nucleus belongs to a cell, so a click on one selects its cell (the
      overview cell, else its drawn outline), and the Cell card, or the
      Visium HD cell outline card, lists the cell's nuclei in view with area
      and circularity. There is no nucleus selection of its own. The hover
      tooltip shows the nucleus ID, its place among its cell's nuclei
      (`2 of 3`), the cell, vertices and area. Readers name each nucleus's
      cell in its segmentation metadata (`cellId`): Xenium and Atera from the
      cell ID, SpatialData from the table row the nucleus matched (see
      [Phase 10](10-spatialdata.md#closed-open-items)), and Visium HD from
      the GeoJSON `cell_id`, kept in its own segmentation index column so
      shared metadata stays deduplicated. On SpatialData, hover, click, and
      the Cell card's nucleus rows were checked on STHELAR bone marrow
      (2026-11-17).
- [x] A file without `label_id`, checked (2026-11-17). S-BIAD1426's
      `nucleus_boundaries.parquet` (3.7 MB, 816,445 rows, one row group,
      string `cell_id`, 13-vertex rings, one nucleus per cell) exposed a
      race: zooming started several nucleus queries before the first found
      the column missing, and the later ones failed with DuckDB's
      `Binder Error` instead of retrying. Each query now retries on the
      setting it was made with. After the fix, 6,208 nuclei in view were
      drawn with no error.

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Original-brief items with no outcome:

- [x] `nucleus_boundaries.parquet` overlay for Xenium. Shipped as
      [Phase 17](#phase-17--xenium-nucleus-boundaries) (2026-11-13).
