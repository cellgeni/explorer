# Updated Plan Notes

`PLAN.md` remains the source of truth for scope, sequencing, and definitions of
done. This file records execution-level additions requested after work began.

## Current Stage Assessment - 2026-06-04

- Current stage: Phase 5 complete and verified. Phases 1-5 are implemented per
  the execution notes below, with JPEG XR decoding and Z-stack plane selection
  still intentionally deferred by user request.
- Phase 4 is complete: gene picking, expression LOD, gene sets,
  built-in/custom annotations, ROI box/lasso workflow, ROI
  cell/gene/transcript export, annotation coloring, linked embeddings, and HDF5
  matrix fallback coverage are implemented.
- Phase 5 is complete: Magic Lens, URL/shareable state, adaptive performance
  budgets, keyboard/accessibility polish, dataset diagnostics, local telemetry,
  docs, and final verification are implemented.
- Current working sequence: feature-fix existing functionality first, then
  optimize. Do not start new Phase 5.1 transcript display work until that
  correctness pass is closed out.

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
      the viewport is close enough or has no more than 5,000 visible overview
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
      5,000 cells, so the cutoff can be tuned without code changes.
- [x] Boundary polygon queries now order vertices by DuckDB's `file_row_number`
      and use a minimum 150 µm fetch margin around the viewport. This fixes
      misordered or viewport-clipped rings being stitched into long triangle
      artifacts at intermediate zooms while preserving Parquet row-group
      pruning on boundary vertices.
- [x] Live smoke check on `http://127.0.0.1:5173/` loaded all 1,414,155 demo
      centroids by default in roughly 5 seconds with no morphology or boundary
      network requests at the top overview.
- [x] Removed the intermediate generated-hexagon boundary layer. The viewer now
      shows only loaded true cell-boundary polygons; cells without visible true
      boundaries remain represented by centroid points.
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
- [x] The intermediate hexagon-boundary mode was removed. Do not use
      centroid-generated pseudo-boundaries as a substitute for true segmentation
      geometry.

## Phase 2 Running TODO

- [x] S3/CORS playbook (§4); fail loudly if Range unsupported.
- [x] Range-read `cell_boundaries.parquet` (remove full-download path).
- [x] OPFS/IndexedDB cache for tiles + Parquet footers; persist the LRU.
- [x] `AbortController` cancellation per viewport version (extend existing
      versioning to all fetches).
- [x] Read `experiment.xenium` manifest to know which files exist (replace
      HEAD-guessing in `loadMorphologyImage`).
- [x] Structured error states surfaced to UI.
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
- [x] Optimized morphology tile loading: JPEG-2000 decode workers are now lazy
      and capped, visible tiles are requested center-first, and stale viewport
      tile fetches are aborted without leaving cached error entries.
- [x] Fixed viewport-edge morphology artifacts by drawing only ready tiles from
      the active pyramid level and requesting a small offscreen tile margin
      around the visible viewport.
- [x] Added an IndexedDB-backed persistent byte-range cache with LRU eviction.
      TIFF tile byte ranges are cached by URL/range before JPEG-2000 decode, and
      hyparquet footer-like slices are cached for warm metadata reads without
      caching large column pages.
- [x] Extended request-version cancellation with `AbortController`s. Dataset
      loads, gene panels, morphology candidate checks, TIFF opening, Range
      probes, hyparquet overview reads, boundary range probes, and expression
      range probes now receive abort signals; DuckDB/Zarr stages that do not
      expose abortable fetch internals are guarded between awaits so stale
      viewport requests stop before updating UI state.
- [x] Replaced morphology image `HEAD` probing with `experiment.xenium` manifest
      parsing. Image loading now reads the manifest once, opens only declared
      TIFF paths, prefers MIP/focus/full-resolution paths in that order when
      available, and shares the same selector through the dataset image API.
- [x] Added structured UI load errors with source, code, title, message, action,
      and optional detail fields. Dataset overview, gene panel, morphology image,
      image tile, boundary, and gene-expression failures now feed a compact
      alert section and the existing viewer/status messages.
- [x] Improved dataset overview Parquet decode diagnostics. Low-level browser
      `cells.parquet` reader failures now report the overview columns, file URL,
      likely unsupported Parquet page encoding/layout, and a parquet-specific UI
      action instead of the generic "Unexpected load error".
- [x] Added a DuckDB-WASM fallback for dataset overview loading when hyparquet
      cannot decode `cells.parquet` page encoding/layout. The normal hyparquet
      path remains first, and the fallback is loaded only after that specific
      decode failure.

## Phase 3 Running TODO

- [x] Parse multi-file `morphology_focus_000N.ome.tif` channel set from OME-XML;
      per-channel name/color/contrast.
- [x] Multi-channel compositing via Viv `XRLayer` (or custom shader) fed decoded
      tiles; per-channel color + min/max + on/off.
- [x] **Deferred by user:** JPEG XR decoder (WASM).
- [x] **Deferred by user:** Z-stack plane selector for `morphology.ome.tif`.
- [x] Per-channel histogram + auto-contrast.

## Phase 3 Notes

- [x] User explicitly asked to start Phase 3 while skipping the JPEG XR decoder
      and Z-stack plane selector. Do not implement those two tasks in this pass.
- [x] Added OME-XML parsing for Xenium morphology focus channels. TIFF loaders
      now expose channel id, index, name, focus-file name, purpose, RGB display
      color, and default contrast range from the OME pixel type; the real demo
      reports DAPI, ATP1A1/CD45/E-Cadherin, 18S, and alphaSMA/Vimentin.
- [x] Added per-channel `Auto` contrast controls. Auto contrast samples the
      coarsest pyramid level for that channel, crops padded edge tiles, computes
      robust percentiles, and writes the resulting min/max into the existing
      channel contrast inputs.
- [x] Auto contrast now also stores and renders a compact per-channel histogram
      from the same sampled pixels, so the histogram and min/max are based on the
      same pyramid-level data.
- [x] Implemented multi-channel morphology through the existing Canvas2D image
      underlay rather than introducing Viv in this slice. Each OME channel gets
      an independent TIFF loader/cache, decoded tiles are tinted and additively
      composited, and the UI exposes per-channel on/off, RGB color, and min/max
      contrast controls. This preserves the current custom J2K/decode pipeline
      and avoids a renderer architecture change.
- [x] Fixed multi-channel tinting so decoded grayscale intensity modulates both
      channel color and alpha. This prevents enabled channels from filling each
      tile with a solid color while preserving additive compositing.

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
      highlighting. The H5 feature-matrix backend is now covered as a Phase 4
      ROI gene fallback.
- [x] Expression loading is viewport-scoped and capped at 5,000 visible cells for
      now to avoid whole-slide feature-matrix work on million-cell datasets.
- [x] Added compact image-layer and cell-layer opacity controls to the layer
      stack. The image slider controls the morphology canvas opacity. Cell
      opacity is split into `Cell fill opacity` for polygon interiors and
      `Cell boundary opacity` for polygon strokes and point borders; zero fill
      opacity now keeps transparent polygon fills active so cell picking remains
      available while interiors are visually hidden.
- [x] Added selectable gene-expression color scales. Switching scales restyles
      the current expression overlay from loaded per-cell counts without
      refetching the expression matrix. Phase 4 closeout added Plasma, Cividis,
      Teal, Rose, and Glasbey palettes and made Plasma the default.

## Phase 4 Running TODO

- [x] Gene picker backed by full `gene_panel.json` (pick before drawing).
- [x] Whole-slide expression coloring with level-of-detail: low zoom density
      bins; medium zoom sampled cells; high zoom exact cells; ROI exact mode.
- [x] Gene sets: import/paste symbol lists; score cells by sum/mean/z-scored
      signature; color by score; save named sets.
- [x] Annotation import from `analysis.zarr.zip`, CSV, and JSON.
- [x] ROI annotations: box drawing, lasso drawing, true ROI cell lookup, summary
      stats, save-as-annotation, selected-cell CSV export, ROI gene stats,
      transcript CSV export, and exact polygon-aware lasso selection/export.
- [x] UMAP/tSNE panel linked to spatial selection.
- [x] HDF5 path for `cell_feature_matrix.h5`. The `h5wasm` reader is wired into
      ROI gene fallback, covered by ROI fallback tests, and now has a direct
      regression test that creates a tiny HDF5 feature matrix with `h5wasm` and
      reads it through `gexFromCellFeatureMatrixH5`. Recommendation captured:
      `jsfive` remains deferred unless a real dataset shows `h5wasm` cannot
      read a needed H5 matrix that `jsfive` can support.

## Phase 4 Notes

- [x] Phase 4 started only after Phase 3 was complete, with the user-requested
      JPEG XR decoder and Z-stack plane selector still deferred.
- [x] Gene sets now support pasted comma/whitespace/semicolon symbol lists,
      case-insensitive matching against the loaded gene panel, saved named sets,
      and sum/mean/z-score signature modes. Score-mode changes restyle the
      current expression batch without refetching `cell_feature_matrix.zarr.zip`.
- [x] Completed the first production whole-slide expression LOD pass without
      changing the matrix architecture. `Auto LOD` now uses a stable whole-slide
      sampled batch at overview zooms, padded viewport samples at medium zoom,
      exact viewport counts below 5,000 visible cells, and the explicit
      `Exact region` path up to 50,000 visible cells. Low-zoom expression bins
      use fixed data-space centers so marks do not drift while panning or
      crossing zoom buckets. A true all-cell whole-slide matrix scan remains a
      future optimization, not part of this slice.
- [x] Fixed the sampled expression regression against the demo dataset. The
      reader now supports feature-major `cell_features/indptr`, `indices`, and
      `data` Zarr matrices when `cell_features/csc/*` is absent, and expression
      request keys are based on quantized deck view state so viewport layout
      jitter does not refetch GEX in a loop.
- [x] Stabilized sampled expression rendering for pan/zoom interaction. Low-zoom
      expression now uses fixed data-space bins clipped to the viewport,
      sampled expression requests use coarser viewport keys, padded request
      bboxes, and deterministic row strides, and the expression overlay is
      non-pickable to reduce deck.gl pan cost.
- [x] Saved gene sets can now be removed from the Analysis panel, and the
      desktop control rail scrolls independently so an expanded sidebar cannot
      push the Spatial View below the viewport.
- [x] Added an `Expression detail` control. `Auto LOD` keeps the existing
      exact/sampled behavior, while `Exact region` uses the current viewport as
      the active region and loads exact selected-gene counts for up to 50,000
      visible cells. Larger regions enter a waiting state instead of silently
      falling back to sampled data.
- [x] Added user-triggered built-in annotation import from `analysis.zarr.zip`.
      Xenium cluster group CSR arrays are mapped through
      `cell_feature_matrix.zarr.zip` row-order cell ids, then shown as compact
      label/count rows in the sidebar. Local CSV (`cell_id,label`) and JSON
      label/cell-id files can be imported into the same annotation list.
- [x] Started ROI annotations with the first reviewable slice: rectangular
      box drawing in the spatial viewer, true ROI cell-id lookup through
      `cells.parquet`, cell-count/mean-observation summaries, save-as-annotation,
      and selected-cell CSV export. Polygon/lasso drawing and transcript export
      remain under the open ROI checkbox.
- [x] Added annotation palette management. Loaded/imported/ROI annotations get
      deterministic default categorical colors, editable color swatches, remove
      buttons, and a clear-all action. The static layer bullet list was removed
      from the sidebar, and the `Cell color` control now offers an `Annotations`
      mode when labels are loaded.
- [x] Gene expression now paints polygon geometry when possible. When true
      boundary polygons are visible and IDs match the expression batch,
      expression fills those polygons. Point-based expression remains the
      fallback when no suitable true polygon geometry is available.
- [x] Morphology channel auto-thresholding now runs automatically when an image
      load completes. The manual `Auto` buttons still use the same per-channel
      percentile/histogram path for later retuning.
- [x] Spatial viewer idle background is now solid black with only the grid
      overlay; the previous red radial glow was removed.
- [x] Spatial viewer empty state now shows a simple "Please load a dataset"
      legend instead of decorative colored cell placeholders.
- [x] Tightened Phase 4 interaction polish: annotation remove/clear no longer
      invalidates the full overview-cell styling unless annotation coloring is
      active or a non-default observation palette is selected, ROI box drawing uses
      the same raw data-space transform for display and selection, and
      gene-expression colors now use a stable per-gene-set max observed across
      loaded regions with numeric scale ticks in the UI.
- [x] Added grouped built-in annotation loading. The sidebar now exposes an
      `Annotation set` selector with `All` plus dataset-discovered analysis
      groups such as `graphclust`, `kmeans 3`, and `kmeans 9`; selected loads
      fetch only that grouping instead of flattening every group.
- [x] Added ROI gene distribution stats. Drawing an ROI now loads expression
      from `cell_feature_matrix.zarr.zip` for the ROI cells, reports the top 10
      expressed genes with total counts, detected-cell percentage, and mean
      counts per cell, and samples large ROIs to keep the sidebar responsive.
- [x] Fixed ROI gene stats fallback. If the cell-feature matrix path is not
      readable for the selected ROI, the loader now falls back to
      `transcripts.parquet` aggregation by ROI cell id instead of leaving the
      sidebar at "Genes unavailable".
- [x] Fixed annotation color rendering. Overview loads now keep true cell IDs,
      successful annotation imports/loads switch directly to annotation coloring,
      and visible true boundary geometry inherits the matching cell color instead
      of staying on the default boundary palette.
- [x] Disabled CPU-side overview point aggregation in the live viewer. The
      primary cell layer now renders all viewport-clipped centroids directly as
      points, which avoids rebuilding binned annotation-color averages during
      low-zoom pan/drag interactions. Expression LOD aggregation remains in
      place for gene overlays.
- [x] Changed the default overview centroid marks to low-alpha hollow point
      outlines and added a low-zoom pass-through path that reuses the full
      centroid array instead of re-filtering it during overview pan/drag. This
      keeps all cells visible as points while reducing visual occlusion and CPU
      work.
- [x] Added ROI transcript export. The ROI panel now has an `Export Transcripts`
      action that Range-checks `transcripts.parquet`, queries QV-filtered raw
      transcript rows inside the selected ROI selection, and downloads a CSV
      with cell id, feature name, x/y/z location, QV, nucleus overlap, and gene
      flag.
- [x] Added a compact UMAP/tSNE embedding panel. It loads standard secondary
      analysis projection CSVs when available, samples large projections for
      canvas rendering, highlights the active spatial ROI and selected cell, and
      lets an embedding point click reuse the existing cell info selection.
- [x] Captured the HDF5 fallback recommendation: keep `h5wasm` as the production
      H5 reader, defer `jsfive` because it is a slower compatibility fallback,
      and only add it if a concrete H5-only dataset fails under `h5wasm` but is
      readable through `jsfive`.
- [x] Added exact lasso ROI selection/export. Lasso selections render as polygon
      overlays, ROI cell lookup filters centroids with DuckDB spatial
      `ST_Within`, ROI gene stats use those exact selected cells, and transcript
      export filters transcript coordinates with the same polygon semantics.
- [x] Completed gene-scale control polish. The selector is narrower, the color
      ramp is wider, numeric ticks align under the ramp, and the UI/renderer
      expose additional continuous palettes: Plasma, Cividis, Teal, Rose, and
      Glasbey. Plasma is the default gene scale.
- [x] Completed layer opacity split. `Cell fill opacity` controls true polygon
      interiors, `Cell boundary opacity` controls true polygon outlines and
      point borders, and a zero fill value makes deck.gl polygon interiors
      transparent while keeping filled geometry active for picking.
- [x] Closed the HDF5 matrix fallback item. ROI gene stats already try
      `cell_feature_matrix.h5` via `h5wasm` when the Zarr matrix is unavailable;
      Phase 4 closeout added a direct production-reader regression test using a
      generated HDF5 feature matrix.
- [x] Updated the scaffold E2E smoke test to assert the current shell
      (`Hide Controls`, selected `Dataset` tab, dataset URL, and load button)
      instead of the removed `Xenium Explorer` heading.
- [x] Phase 4 verification passed after closeout: `npm run build`, `npm test`,
      `npm run typecheck`, `npm run lint`, and `npm run test:e2e`.

## Phase 5 Closeout - Product Hardening

- [x] Added Magic Lens panel and viewer behavior based on the old POC:
      cursor/viewport/ROI scopes, cursor radius and QV controls, debounced
      exact-circle transcript scans, cell/transcript/gene summaries, and an
      in-view lens HUD.
- [x] Added shareable URL hash state for dataset URL, active HUD tab, viewport,
      selected genes, ROI selection, gene scale/score/detail controls, cell
      color mode, coordinate unit, morphology toggle, and boundary limit. The
      app restores hash-provided dataset/control state on startup and preserves
      initial shared genes/ROI through the first matching dataset load.
- [x] Added adaptive performance budgeting. The app detects compact, balanced,
      or expanded device profiles and uses the selected budget for overview
      point rendering caps, default boundary limits, tile request concurrency,
      tile-cache capacity, and telemetry retention.
- [x] Added keyboard spatial navigation and accessibility polish. The spatial
      view is focusable with arrow-key pan, shifted arrow-key coarse pan,
      plus/minus zoom, Home reset, explicit `aria-keyshortcuts`, and a visible
      focus outline.
- [x] Added dataset diagnostics and a local diagnostic dump. The Dataset tab can
      probe the manifest plus required/optional byte-range assets, summarize the
      result, and download JSON containing controls, active errors, local
      telemetry, diagnostics, and the performance budget.
- [x] Added a React error boundary around the app shell so render-time failures
      land on an actionable fallback instead of a blank page.
- [x] Added privacy-respecting local telemetry for dataset loads, diagnostics,
      and tile-cache evictions. Events are retained in memory and exported only
      through the user-triggered diagnostics dump.
- [x] Added Phase 5 docs: `docs/user-guide.md` and
      `docs/host-your-own-data.md`.
- [x] Added the repository root `README.md` with the project overview, quick
      start commands, implementation layout, data expectations, and links to the
      existing `docs/` user/hosting/CORS/matrix-compatibility notes.
- [x] Phase 5 final verification passed: `npm test`, `npm run build`,
      `npm run typecheck`, `npm run lint`, and `npm run test:e2e`.

## Current Work Sequence - Feature Fixing Before Optimization

- [ ] Feature-fix pass: get current functionality correct before broad
      performance work. Record bug fixes and verification here as they close.
- [x] Fixed ROI cell summary hanging after Magic Lens scans. Transcript scans now
      use a separate cached Xenium dataset/DuckDB worker from ROI cell queries,
      and drawing a new ROI aborts/resets any active Magic Lens scan before
      querying ROI cells.
- [x] Fixed Magic Lens loading hang by changing interactive lens scans to reuse
      the bounded ROI cell query path first, filter cursor circles by cell
      centroid, and summarize genes through the ROI matrix-backed gene stats
      path instead of blocking on a spatial scan of `transcripts.parquet`.
- [x] Fixed the misleading first-ROI gene wait. Direct browser probes showed even
      a 1-cell cold Zarr gene read can take about 20 seconds, so the first cost
      is opening/warming the feature-matrix path rather than ROI sample size.
      Dataset warmup now stays metadata-only, viewport-specific ROI gene warmup
      starts as soon as the loaded viewport is known, and ROI draw controls stay
      disabled with a preparing state until that viewport warmup is ready or
      fails. After drawing, the demo dataset timing showed `Top ROI genes`
      appears within milliseconds of ROI cells being ready instead of sitting at
      `Querying ROI genes` for 20+ seconds.
- [x] Added detailed activity-log timings for the ROI path: dataset prep,
      viewport ROI-gene warmup cell query, viewport ROI-gene warmup stats,
      drawn ROI cell query, preview gene stats, and full gene refinement now log
      elapsed wall time in the UI.
- [x] Reconfirmed the ROI gene matrix fallback strategy: the app uses the
      original `cell_feature_matrix.zarr.zip` for native CSC Zarr reads, does
      not look for generated cell-major Zarr sidecars, and falls back to
      `cell_feature_matrix.h5` for older feature-major-only Zarr output.
- [x] Added selected-cell detail loading on the Cell tab. Selecting a spatial or
      embedding cell now loads all nonzero gene counts for that single cell via
      the same matrix/HDF5 fallback path as ROI gene stats, and shows searchable
      expression plus cell metadata and boundary-derived shape metrics such as
      equivalent diameter, perimeter, axes, eccentricity, and circularity when
      true boundary geometry is available.
- [x] Fixed selected-cell picking so it does not depend on visible cell fill.
      Boundary polygons remain pickable with transparent fills, DeckGL click
      handling maps picked boundary objects back to overview cells, and the
      viewer falls back to coordinate-based point-in-polygon/point-cell hit
      testing if no object is returned by deck.gl.
- [x] Fixed stale cell opacity updates. Cell fill and boundary opacity changes
      now declare deck.gl `updateTriggers` for color accessors so sliders update
      the active layers immediately without waiting for boundary data or other
      layer data to re-render.
- [ ] Optimization pass: after correctness is stable, tune interaction
      performance, memory pressure, fetch/decode concurrency, and rendering
      costs without changing product behavior.
- [ ] Only after those passes, begin Phase 5.1.

## Phase 5.1 Planned Spike - Transcript Display LOD

- [ ] Add a transcript-rendering spike over `transcripts.parquet`, gated by
      `capabilities.transcripts` and using existing DuckDB/Range, QV filter, and
      viewport-version cancellation patterns.
- [ ] At whole-slide and low zoom, show transcripts as clustered cell-level
      summaries or high-level FOV/tile aggregations rather than individual
      molecule points.
- [ ] At medium zoom, keep stable data-space aggregation with count summaries and
      feature/gene coloring so panning does not reshuffle the display.
- [ ] At close zoom, render all visible matching transcripts as exact points with
      hover/pick metadata.
- [ ] Verify the transcript LOD path with Magic Lens, ROI transcript export,
      selected gene overlays, annotation coloring, URL/shareable state, and the
      demo dataset.
