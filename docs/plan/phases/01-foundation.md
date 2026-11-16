# Phase 1 — Foundation And Migration

Goal: POC parity, but typed, modular, bundled, and with decode off the main
thread.

- [x] `npm create vite@latest` with React and TypeScript. Add ESLint, Prettier,
      Vitest, and Playwright.
- [x] Bundle deck.gl (`deck.gl`, `@deck.gl/core`, `@deck.gl/layers`) and remove
      the unpkg `<script>`.
- [x] `vite.config.ts`: exclude WASM packages from `optimizeDeps`,
      `assetsInclude: ['**/*.wasm']`, and dev-server COOP/COEP headers.
- [x] Port with types and tests: `coords.ts`, `cellid.ts`, `duckdb.ts` (was
      `quack.js`), `gex.ts` (Parquet and cell-feature-matrix Zarr only;
      transcript-Zarr GEX deleted), `tiff/loader.ts`, `tiff/tileCache.ts`, and
      `codecs/jpeg2000.ts`.
- [x] Define `SpatialDataset` and implement `XeniumDataset`.
- [x] Worker pool for JPEG-2000 decode and windowing; DuckDB in its own worker.
- [x] Zustand store and React chrome around the deck.gl/canvas core.
- [x] hyparquet first-paint scatter from `cells.parquet`.

Notes:

- First paint reads every centroid but skips the `cell_id` string column. (Phase
  4 later kept true cell IDs so annotations could color cells.) The demo loaded
  all 1,414,155 centroids in about 5 s, with no morphology or boundary requests
  at the top-level overview.
- Point radius comes from `cell_area`.
- Morphology loads after the overview and is on by default. Users can turn it
  off before loading.
- Tile decode failures reach the viewport error state.
- Boundaries load only when the visible overview-cell count is at or below
  `Boundary limit` (5,000 at the time). DuckDB is imported only when that
  threshold is met. See [4.9](../decisions.md#49-cell-boundaries) for margins and ordering.
- Low-zoom overview points were binned into representative points. Phase 4
  turned this off.
- The chrome was made more compact while keeping visible focus states and
  labelled controls.
- The brief's "immediate next steps" were all completed in Phases 1–2: scaffold
  and reproduce the POC; test `cellid` and `coords` first; move decode to a
  worker; refactor `gex.js` behind `XeniumDataset`; fix `httpfs` usage; add the
  S3 diagnostic check.

Definition of done: feature parity with the POC; 60 fps pan/zoom with the image
on; zero `any` in the data layer; deck.gl pinned; `cellid`, `coords`, and `gex`
unit-tested; runs against the demo dataset.

## Closed Open Items

Moved from [Open Items](../open-items.md) on 2026-11-14.

Other gaps found in the review:

- [x] Xenium still loads through free functions in `src/data/` instead of one
      `XeniumDataset` instance; the viewer's µm/px comes from OME-XML while
      `meta()` reads the manifest. Closed without a code change: the
      instances stay split by purpose, and both points are recorded as
      amendments to
      [4.6](../decisions.md#46-data-source-abstraction--capability-based).
      Checking this found that dataset instances are never released, now an
      open item.

Moved from [Open Items](../open-items.md) on 2026-11-16.

Original-brief items with no outcome:

- [x] `tilesForBbox` returned edge tiles for a bbox wholly outside the image
      (fixed 2026-11-16). It clamped tile indices to the tile grid, not to the
      image: on a 250 × 180 px level at 1 µm/px with 100 × 80 px tiles,
      `{minX: -500, maxX: -100, minY: 0, maxY: 200}` gave column 0 of rows
      0–2, and `{minX: 260, maxX: 280, minY: 0, maxY: 50}` gave
      `{col: 2, row: 0}`, whose bounds stop at x 250. The TIFF and OME-Zarr
      loaders had their own copies, so a view panned off the left or top of
      an image requested that edge's tiles. Both loaders now call
      `tilesForBboxOnAxes` in `coords.ts`, which `tilesForBbox` also uses.
      A bbox that misses the image, only touches its edge, or only meets the
      unused part of a partial last tile gets no tiles, and both examples now
      give none. The `it.todo` in `coords.property.test.ts` is now two
      properties, one for bboxes that miss the image and one for bboxes that
      touch an edge. Example tests cover `coords.ts` and both loaders.
      `coords.ts` now measures a level that has no full-resolution size from
      its own pixels. Before, `tileBounds` measured it in level-0 pixels.
