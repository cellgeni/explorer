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
- [x] Added an intermediate hexagon boundary layer for up to 6x the configured
      true-boundary limit. With the default 500-cell true-boundary limit, the
      viewer renders six-point centroid/area hexagons for up to 3,000
      visible cells, then switches to true segmentation below 500 visible cells.
- [x] Full boundary loading now expands the candidate centroid window by 75
      micrometers and keeps a minimum 150 micrometer vertex fetch margin around
      the viewport. This keeps partially visible edge cells from disappearing
      when their centroids sit just outside the current viewport.
- [x] The app chrome is more compact: the sidebar, toolbar, form controls,
      status text, and layer list use tighter spacing and smaller type while
      preserving visible focus states and labelled controls.

## Boundary Simplification Decision

- [x] Do not add a client-side "less than 5 points" simplified-boundary mode yet.
      It would not reduce network or DuckDB work because the app would still have
      to fetch the full boundary vertices first. Revisit this only if a separate
      precomputed simplified-boundary parquet/geometry pyramid is added.
- [x] The intermediate hexagon-boundary mode is not a simplified true boundary. It
      is generated locally from centroids and `cell_area`, so it adds no
      boundary-Parquet I/O and remains cheap enough for roughly 3,000 cells.

## Phase 2 Running TODO

- [x] S3/CORS playbook (§4); fail loudly if Range unsupported.
- [x] Range-read `cell_boundaries.parquet` (remove full-download path).
- [ ] OPFS/IndexedDB cache for tiles + Parquet footers; persist the LRU.
- [ ] `AbortController` cancellation per viewport version (extend existing
      versioning to all fetches).
- [ ] Read `experiment.xenium` manifest to know which files exist (replace
      HEAD-guessing in `loadMorphologyImage`).
- [ ] Structured error states surfaced to UI.
- [x] Use the dataset `.zchunkstore` image chunk index when present, falling
      back to GeoTIFF metadata parsing when it is missing or unsupported.

## Phase 2 Notes

- [x] Added `docs/s3-cors-playbook.md` with the required CORS policy, object
      serving rules, and a manual one-byte Range check.
- [x] Added a browser Range probe that requires HTTP 206 plus an exposed
      `Content-Range` header before reading `cells.parquet` or
      `cell_boundaries.parquet`, so S3/CORS misconfiguration stops with an
      actionable UI error instead of a downstream parser failure.
- [x] Rechecked the boundary path for the Phase 2 range-read task: the app uses
      DuckDB `read_parquet(?)` against the remote `cell_boundaries.parquet` URL
      and no longer has a full-download boundary path in `src/`.
- [x] Adapted the Observable OME-TIFF File Chunk Store pattern for the
      Xenium `.zchunkstore`: fetch a JSON manifest, map Zarr chunk keys to TIFF
      byte ranges, and reuse the existing range/decode tile pipeline.
- [x] Live browser smoke verified the manifest path: `.zchunkstore` returned
      HTTP 200, the first morphology tile fetched with HTTP 206 from the
      OME-TIFF byte range, and the canvas rendered non-transparent image pixels.
- [x] Fixed `.zchunkstore` overview alignment by tracking the true source pixel
      size of edge/overview tiles and cropping padded JPEG-2000 tile bitmaps
      before scaling them into the morphology canvas.

## Requested Analysis Features

These are product requirements requested after Phase 2 started. They align with
Phase 4 in `PLAN.md`; do not implement them before Phase 2 and Phase 3 are done
unless the phase order is explicitly changed.

- [x] Gene selection: search/pick genes from `gene_panel.json`, keep selected
      genes as URL/shareable state later, and avoid loading expression matrices
      until a gene or region workflow needs them.
- [x] Gene expression highlighting: color cells by selected gene expression,
      using low-zoom density/binning when needed and per-cell counts at close
      zoom or within a selected ROI.
- [x] Cell highlighting by observations: support coloring by loaded cell-level
      observations such as `transcript_counts`, `cell_area`, `nucleus_area`, and
      later imported annotation labels.
- [x] Cell information visualization: show selected/hovered cell metadata,
      observations, expression summaries for selected genes, and links between
      spatial, boundary, and future embedding views.

## Analysis Feature Notes

- [x] The user explicitly asked to make gene selection/expression visible before
      Phase 4, overriding the phase-order default for this narrow first slice.
- [x] Gene expression highlighting uses `cell_feature_matrix.zarr.zip` through
      `XeniumDataset.matrix()` after collecting viewport cell IDs from
      `cells.parquet`. Do not use `transcripts.parquet` for per-cell expression
      highlighting. The H5 feature-matrix backend remains a later Phase 4 task.
- [x] Expression loading is viewport-scoped and capped at 5,000 visible cells for
      now to avoid whole-slide feature-matrix work on million-cell datasets.
