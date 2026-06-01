# Updated Plan Notes

`PLAN.md` remains the source of truth for scope, sequencing, and definitions of
done. This file records execution-level additions requested after work began.

## Added Skill Requirements

- Use `frontend-design` for Phase 1 UI work, as already required by `PLAN.md`.
- Use `vercel-react-best-practices` when writing React code.
- Use `vercel-composition-patterns` when shaping reusable React components.
- Use `web-design-guidelines` for UI review. The latest guideline source was
  fetched from <https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md>.

## Phase 1 Running TODO

- [x] `npm create vite@latest` → React + TypeScript. Add ESLint, Prettier,
      Vitest, Playwright.
- [x] Bundle deck.gl (`deck.gl`, `@deck.gl/core`, `@deck.gl/layers`); remove the
      unpkg `<script>`.
- [x] `vite.config.ts`: `optimizeDeps.exclude` WASM packages;
      `assetsInclude: ['**/*.wasm']`; dev server COOP/COEP headers.
- [x] Port with types + tests: `coords.ts`, `cellid.ts`, `duckdb.ts`, `gex.ts`,
      `tiff/loader.ts`, `tiff/tileCache.ts`, `codecs/jpeg2000.ts`.
- [x] Define `SpatialDataset`; implement `XeniumDataset`.
- [x] Worker pool: J2K decode + windowing in workers; DuckDB in its own worker.
- [x] Zustand store; React chrome around the deck.gl/canvas core.
- [x] hyparquet first-paint scatter from `cells.parquet`.

## Current Port Subtasks

- [x] `coords.ts`
- [x] `cellid.ts`
- [x] `duckdb.ts`
- [x] `gex.ts`
- [x] `tiff/loader.ts`
- [x] `tiff/tileCache.ts`
- [x] `codecs/jpeg2000.ts`

## Phase 1 Follow-up Notes

- [x] `Load Dataset` now executes the first-paint path: read
      `cells.parquet` via hyparquet, decode ZSTD-compressed demo parquet with
      `hyparquet-compressors`, convert centroids to deck.gl coordinates, and
      render the overview scatter layer.
- [x] Demo dataset smoke check loaded 50,000 overview cells from the default
      dataset URL on `http://127.0.0.1:5173/`.
- [x] OME-TIFF morphology is now read after the cell overview loads. The loader
      falls back from the missing `morphology_mip.ome.tif` to
      `morphology_focus/morphology_focus_0000.ome.tif`, resolves GeoTIFF
      deferred tile offset/byte-count arrays, indexes 9 pyramid levels, fetches
      JPEG-2000 tile byte ranges, decodes them in workers, and draws the canvas
      underlay.
- [x] Tile decode failures are surfaced back to the viewport error state instead
      of being silently swallowed.
- [x] Live smoke check on `http://127.0.0.1:5173/` loaded 50,000 overview cells
      and verified the morphology canvas had non-transparent decoded pixels.
- [x] Morphology image loading is now opt-in from the dataset form. The default
      `Load Dataset` path loads overview cells only and does not start OME-TIFF
      metadata, range, or JPEG-2000 decode work unless `Morphology image` is
      selected.
- [x] Overview cell loading now requests all centroid points by default while
      skipping the expensive `cell_id` string column for overview-only drawing.
      The app reads `cell_area` and uses an area-derived radius for cell point
      size while keeping zoom-aware grouping for dense views.
- [x] True cell segmentation can now render as deck.gl polygons. The viewer
      debounces viewport changes and loads `cell_boundaries.parquet` only when
      the viewport is close enough or has no more than 500 visible overview
      cells.
- [x] Boundary loading uses the `SpatialDataset.elements(bbox)` range-read path
      and dynamically imports DuckDB only after the polygon threshold is met.
      DuckDB now uses the non-threaded MVP/EH worker bundles because the COI
      pthread bundle failed to load DuckDB extensions (`spatial`/`parquet`) in
      the browser with a shared-memory mismatch.
- [x] Overview cell rendering is now zoom-aware. The app keeps the existing fast
      centroid load path, bins cells into representative points at low zoom, and
      expands back to individual points once the bin size is cell-scale. When the
      viewport is known, point rendering is clipped to the current viewport so
      close zooms do not push off-screen cells through deck.gl.
- [x] Cell boundaries now load only when the visible overview-cell count is below
      the configured threshold. The UI exposes `Boundary limit`, defaulting to
      500 cells, so the cutoff can be tuned without code changes.
- [x] Boundary polygon queries now order vertices by DuckDB's `file_row_number`
      and use a minimum 150 µm fetch margin around the viewport. This fixes
      misordered or viewport-clipped rings being stitched into long triangle
      artifacts at intermediate zooms while preserving Parquet row-group
      pruning on boundary vertices.
- [x] Live smoke check on `http://127.0.0.1:5173/` loaded all 1,414,155 demo
      centroids by default in roughly 5 seconds with no morphology or boundary
      network requests at the top overview.
- [x] Added an intermediate hexagon boundary layer for up to 3x the configured
      true-boundary limit. With the default 500-cell true-boundary limit, the
      viewer renders six-point centroid/area hexagons for up to 1,500
      visible cells, then switches to true segmentation below 500 visible cells.

## Boundary Simplification Decision

- [x] Do not add a client-side "less than 5 points" simplified-boundary mode yet.
      It would not reduce network or DuckDB work because the app would still have
      to fetch the full boundary vertices first. Revisit this only if a separate
      precomputed simplified-boundary parquet/geometry pyramid is added.
- [x] The intermediate hexagon-boundary mode is not a simplified true boundary. It
      is generated locally from centroids and `cell_area`, so it adds no
      boundary-Parquet I/O and remains cheap enough for roughly 1,500 cells.
