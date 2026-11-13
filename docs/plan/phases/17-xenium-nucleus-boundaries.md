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
  turns it on.
- **DECISION:** On Xenium, the cell boundary query runs only while
  `Cell boundaries` is on. Both queries share the boundary DuckDB instance,
  which runs one query at a time. Without this, nuclei shown alone would wait
  for a cold cell query first (about 7 s on the demo). Atera and Visium HD
  keep loading cells with nuclei.
- Out of scope: nucleus picking, hover, or a nucleus card; nucleus shape
  metrics; and the polygons in Xenium's `cells.zarr.zip`.

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

- [ ] Cell and nucleus outlines are drawn together, once both queries finish.
      With both on and cold, the cells wait about 4 s for the nuclei. Drawing
      each as it arrives, or a second DuckDB instance for nuclei, would remove
      that wait.
- [ ] A failed nucleus read clears the cell outlines too, since one boundary
      request carries both (as on Atera and Visium HD).
- [ ] Ticking either checkbox requests both outline types again. Repeats come
      from DuckDB's file cache (about 0.5 s each on the demo), but they are
      not free.
- [ ] Nuclei cannot be picked or hovered, and there is no nucleus card.
- [ ] Files without `label_id` were not available to test against. The
      fallback is covered by a unit test only.

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Original-brief items with no outcome:

- [x] `nucleus_boundaries.parquet` overlay for Xenium. Shipped as
      [Phase 17](#phase-17--xenium-nucleus-boundaries) (2026-11-13).
