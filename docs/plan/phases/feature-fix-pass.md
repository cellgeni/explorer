# Feature-Fix Pass (After Phase 5)

- [ ] The pass stays open. Record fixes here as they close.

Fixes recorded:

- [x] ROI summary hung after Magic Lens scans. Transcript scans now use a
      separate DuckDB worker, and drawing an ROI aborts any lens scan.
- [x] Magic Lens hung. Lens scans now reuse the bounded ROI cell query, filter
      the cursor circle by centroid, and summarize genes through the matrix
      path instead of scanning `transcripts.parquet`.
- [x] The first ROI waited 20+ s for genes. Dataset warmup stays metadata-only;
      a separate ROI-gene warmup runs per dataset (first per viewport, then
      changed to once per dataset), and ROI drawing shows a preparing state
      until it is ready.
- [x] The activity log records timings for every ROI step.
- [x] Selected-cell detail loads all nonzero genes through the matrix/H5 path,
      and shows metadata and shape metrics (equivalent diameter, perimeter,
      axes, eccentricity, circularity) when boundary geometry exists.
- [x] Picking no longer depends on visible fill, with a point-in-polygon
      fallback.
- [x] Opacity sliders update immediately (`updateTriggers`).
- [x] Imported labels that collide after slugging keep unique IDs.
- [x] Cell Info lists the selected cell's annotation membership.
- [x] Custom image layers from remote OME-TIFF URLs, with prefixed channel IDs
      and removal. LZW and uncompressed tiles decode through geotiff.js; large
      LZW tiles use a preallocated buffer and lower budgets.
- [x] Exact transcript colours are deterministic per feature, with QV colouring
      as an explicit mode.
- [x] Visium HD ROIs load genes for all selected barcodes and label the panel
      `ROI genes`.
- [x] Transcripts stayed loading after a rerun for the same view. Selecting a
      gene with Feature filter set to All, or ViewerCore reporting the same
      view again as a new object, stopped the read, and the rerun skipped its
      unchanged request key. The effect cleanup now clears the key of a read it
      stops while that read is still running, so the rerun starts it again; a
      cancelled read (15.3-D) keeps its key.
- [x] Images placed at a negative origin (MERSCOPE mosaics, SpatialData
      translations) did not load the tiles left of x = 0 or above y = 0
      (fixed 2026-11-16). The morphology canvas clamped its prefetch bbox to
      x, y ≥ 0, so a view over x −400 to −200 of an image at x −600 requested
      only a tile at x 0–200, and a view whose prefetch bbox still ended left
      of 0 became an inverted bbox with no tiles. The bbox is no longer
      clamped: since the loaders' tile selection clips to the image itself
      (`tilesForBboxOnAxes`), the clamp only hid negative-origin tiles. Large
      raw LZW or uncompressed tiles have no prefetch margin and were not
      affected.
- [x] A failed Visium HD bin-size switch closed the dataset (2026-11-16).
      `useVisiumHdBinWorkflow` set the dataset load state to failed, so the
      start screen covered the tier still drawn. Now the dataset stays open:
      the bin control shows the error, a Fallbacks notice and the activity log
      record it, and selecting the size again retries it. A tissue image that
      fails during the switch is reported as a morphology error, not as a
      failed tier. Only a dataset's first load fails it.

## Code Review (2026-11-19 To 2026-11-24)

A code and documentation review in ten passes read every source file in
full. Each finding was shown by a failing test or browser check, and the
repair tasks were done almost all one PR each, with regression tests. Findings are
numbered EXP-001 to EXP-332 and tasks T01 to T207; each fix PR's description
gives its finding, the change and its tests. The first pass's report is on
branch `claude/review-document-4602a9`
([#199](https://github.com/cellgeni/explorer/pull/199), closed without
merging and kept as the record). The later passes' reports were not
committed.

| Pass | Date       | Scope                                                    | Findings    | P1  | P2  | P3  | Tasks     | Fix PRs      |
| ---- | ---------- | -------------------------------------------------------- | ----------- | --- | --- | --- | --------- | ------------ |
| 1    | 2026-11-19 | The whole repository, and 141 docs claims traced to code | EXP-001–042 | 4   | 9   | 29  | T01–T45   | #203 to #252 |
| 2    | 2026-11-21 | Images and rendering                                     | EXP-043–061 | 0   | 2   | 17  | T46–T57   | #255 to #267 |
| 3    | 2026-11-21 | HTTP, HDF5, archives, workers and Zarr                   | EXP-062–094 | 0   | 3   | 30  | T58–T76   | #269 to #287 |
| 4    | 2026-11-21 | Platform readers                                         | EXP-095–112 | 1   | 5   | 12  | T77–T90   | #289 to #302 |
| 5    | 2026-11-22 | Dataset loading and state                                | EXP-113–141 | 1   | 7   | 21  | T91–T105  | #304 to #318 |
| 6    | 2026-11-22 | Plots, Cell Query and shared scientific code             | EXP-142–172 | 0   | 5   | 26  | T106–T125 | #320 to #339 |
| 7    | 2026-11-22 | User state and exports, data contracts and detection     | EXP-173–220 | 0   | 7   | 41  | T126–T147 | #340 to #361 |
| 8    | 2026-11-23 | Other dataset code, collections and 3D                   | EXP-221–249 | 1   | 4   | 24  | T148–T165 | #363 to #380 |
| 9    | 2026-11-23 | UI shell logic and components, and the HDF5 file browser | EXP-250–294 | 0   | 10  | 35  | T166–T186 | #382 to #402 |
| 10   | 2026-11-24 | Stylesheets, an accessibility sweep, and sampled files   | EXP-295–332 | 0   | 4   | 34  | T187–T207 | #404 to #424 |

In all, 332 findings (no P0, 7 P1, 56 P2, 269 P3) and 207 tasks, all merged
by 2026-11-24 (`24f0fd2`). The PR ranges hold a few PRs that are not review
fixes.

Not covered: no pass read hosted data or ran a `@live` test, so Xenium,
Atera and Visium HD, which have no offline fixture, were checked in code
and unit tests but not in a browser, nor were the Magic Lens, the
transcript and bin cards or the Transcripts section; no screen reader was
used; and only Chromium was run. Each pass also listed
leads, suspicions with no trigger shown; only the single-key shortcut lead
became an [open item](../open-items.md).
