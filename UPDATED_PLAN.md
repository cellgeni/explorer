# Updated Plan Notes

`PLAN.md` remains the source of truth for scope, sequencing, and definitions of
done. This file records execution-level additions requested after work began.

## Current Stage Assessment - 2026-06-07

- Current stage: Phase 5.1 complete and verified. Phases
  1-5.1 are implemented per the execution notes below. JPEG XR decoding has
  been permanently dropped by user request; Z-stack plane selection remains
  deferred for eventual implementation.
- Phase 4 is complete: gene picking, expression LOD, gene sets,
  built-in/custom annotations, ROI box/lasso workflow, ROI
  cell/gene/transcript export, annotation coloring, linked embeddings, and HDF5
  matrix fallback coverage are implemented.
- Phase 5 is complete: Magic Lens, URL/shareable state, adaptive performance
  budgets, keyboard/accessibility polish, dataset diagnostics, local telemetry,
  docs, and final verification are implemented.
- Current working sequence: feature-fix existing functionality first, then
  optimize. The correctness pass needed before Phase 5.1 is closed; the broader
  optimization pass remains a future follow-up.

## App Refactor Decisions - 2026-06-07

- [x] Refactor goal: reduce `App.tsx` by extracting coherent feature/domain
      boundaries, not by splitting randomly by line count. `App.tsx` remains the
      application orchestration root for cross-feature request flow, effects,
      and top-level state wiring.
- [x] Do not move state into Zustand just to make `App.tsx` shorter. The current
      pass keeps existing React state ownership in place unless a feature has a
      clear shared-state reason to move later. The existing viewer store remains
      the only Zustand boundary touched by this refactor.
- [x] Do not combine the refactor with behavior changes. Model/component moves
      must preserve product behavior and existing UI copy unless a later task
      explicitly requests a behavior change.
- [x] Do not create generic catch-all hooks such as `useAppState`. Extract
      focused feature models, view components, or small domain helpers instead.
- [x] Avoid extracting components with very large prop bags. When a UI section
      needs many values, either keep it in `App.tsx` for now or extract a
      coherent view/model boundary alongside the component.
- [x] Component extraction decisions completed so far:
      `AppStatusPanels`, control HUD panels (`DatasetHudPanel`, `LayerHudPanel`,
      `CellHudPanel`, `RoiHudPanel`), `EmbeddingPanel`,
      `CellInfoPanel`, `MorphologyChannelControls`, `MagicLensPanel`,
      `RoiGeneStatsPanel`, and `TranscriptStatusPanel`. These are concrete UI
      sections, not arbitrary line-count cuts.
- [x] Domain/model extraction decisions completed so far:
      `cellDetailModel`, `morphologyChannels`, `magicLensModel`, `roiModel`,
      `transcriptLayerModel`, `transcriptLabels`, `geneControlsModel`,
      `annotationModel`, `diagnosticsDump`, `loadErrorModel`, and shared
      `slug`. These modules own pure calculations, labels, state unions, and
      serialization/parsing helpers close to their feature.
- [x] Shared state model decision: feature state unions can live in feature
      model modules with generic narrow error bounds. `App.tsx` supplies
      `StructuredLoadError` where full diagnostics are needed, while panels can
      depend on narrower display/error shapes.
- [x] Error handling decision: structured load-error typing and classification
      are centralized in `features/errors/loadErrorModel.ts`; feature code
      should reuse that instead of recreating source/code/action mapping.
- [x] ROI/Magic Lens decision: ROI state, summaries, gene-stat labels, warmup
      keys, CSV export formatting, Magic Lens summaries, query keys, limits, and
      normalization are feature-domain concerns. Async request orchestration and
      cancellation remain in `App.tsx`.
- [x] Transcript decision: transcript capability/layer state, retained-layer
      derivation, density labels, detail/filter parsing, budget messages, and
      cell-summary fallback bins live in `transcriptLayerModel`. Transcript
      request effects and cross-feature coordination remain in `App.tsx`.
- [x] Checkpoint commits so far:
      `a22c90e Refactor app panels and feature models` and
      `8cdfea2 Extract ROI and load error models`.
- [x] Verification after the latest checkpoint passed `npm run typecheck`,
      `npm run lint`, `npm test`, targeted Prettier checks, and
      `git diff --check`. The Vitest jsdom canvas warning is known and unchanged.

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
- [x] Morphology image loading is enabled by default from the dataset form.
      Users can still disable `Morphology image` before loading when they want
      the overview-only path without OME-TIFF metadata, range, or JPEG-2000
      decode work.
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
- [x] **Permanently dropped by user:** JPEG XR decoder (WASM).
- [x] **Deferred by user for future implementation:** Z-stack plane selector for
      `morphology.ome.tif`.
- [x] Per-channel histogram + auto-contrast.

## Phase 3 Notes

- [x] User explicitly asked to start Phase 3 while skipping the JPEG XR decoder
      and Z-stack plane selector. On 2026-06-07 the user clarified that JPEG XR
      should be permanently dropped, while Z-stack plane selection remains
      deferred for eventual implementation.
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
- [x] Changed ROI gene warmup from viewport-keyed to dataset-keyed. The app now
      prewarms ROI gene stats once per loaded dataset from the first eligible
      viewport sample, and later camera movement no longer aborts/restarts the
      warmup or repeatedly surfaces `Preparing ROI genes`.
- [x] Fixed imported annotation labels that slug to the same id. Custom CSV/JSON
      annotations now keep unique ids when labels such as `CD16+ NK cells` and
      `CD16- NK cells` collide after slugging, preventing duplicate React keys
      and corrupted annotation rows after removals.
- [x] Added selected-cell annotation membership to the Cell Info panel. When a
      cell is selected, the metadata list now includes an `Annotations` row
      derived from currently loaded/imported annotation cell-id membership.
- [x] Added custom image layers from remote OME-TIFF URLs. The Layers tab now
      accepts a custom image URL, opens it through the existing TIFF/channel
      loader path, prefixes custom channel IDs to avoid collisions with dataset
      morphology channels, renders the custom channels through the existing
      morphology canvas, and lets users remove loaded custom layers. Browser
      smoke verified the default dataset can load
      `Sob23-BRA-0-FFPE-5-S30-i.ome.tif` as a custom layer with three channels
      and no active load errors.
- [x] Fixed custom image tile decoding for LZW-compressed OME-TIFF layers. TIFF
      loaders now pass compression/sample metadata through the tile cache to the
      worker, LZW/uncompressed grayscale tiles decode through GeoTIFF.js, and
      invalid JPEG-2000 decodes now fail with an explicit dimension error
      instead of surfacing as `ImageData` width/height failures.
- [x] Fixed renderer crashes when displaying large LZW custom image layers. The
      common no-predictor LZW path now decodes into a preallocated byte buffer
      instead of expanding through a large temporary JS number array, and large
      raw/LZW tiles use a lower initial tile/cache/concurrency budget so custom
      OME-TIFFs render progressively without overwhelming the tab.
- [ ] Optimization pass: after correctness is stable, tune interaction
      performance, memory pressure, fetch/decode concurrency, and rendering
      costs without changing product behavior.
- [x] Only after those passes, begin Phase 5.1.

## Phase 5.1 New Phase - Transcript Visualization

User-added requirement: show individual transcript locations, group transcripts
when zoomed out, show all visible transcripts in the viewport at the closest
detail tier, and show transcript information on hover. The scale target is
hundred-million transcript datasets, so the overlay must be designed as a
windowed/LOD system rather than a simple point layer over `transcripts.parquet`.

Keep `PLAN.md` unchanged; record this new phase only in `UPDATED_PLAN.md`.

### Product Decisions

- [x] Official 10x assessment: `transcripts.parquet` contains `feature_name`,
      `fov_name`, physical x/y/z locations, QV, nucleus/cell assignment fields,
      and one row per decoded transcript. `transcripts.zarr.zip` contains a
      native transcript density view and `/grids` pyramid used for downsampled
      transcript visualization in Xenium Explorer. Therefore, the best
      production visual LOD source is the official `transcripts.zarr.zip`
      density/grid structure, not a custom sidecar as the first choice.
- [x] Grouping the current viewport by `feature_name` and `fov_name` is useful
      for summaries, QC, and hover/sidebar context because both fields are
      official transcript metadata. It is not the best spatial grouping primitive
      for low-zoom rendering because FOVs are acquisition tiles with overlap and
      can be much larger than the visual detail needed in dense tissue.
- [x] Treat transcripts as their own visualization modality, not as a variant of
      cell expression coloring. Add a new `Transcripts` HUD tab and keep the
      current `Layers` tab focused on global image/cell opacity and morphology
      channel controls.
- [x] Place the `Transcripts` tab after `Genes` and before `Magic Lens`, because
      transcript visibility depends on gene/feature filters but uses separate
      data, LOD, opacity, and hover controls.
- [x] Do not scan or fetch raw hundred-million-row transcript data for low-zoom
      overviews. Low/medium zoom needs native Xenium Zarr LOD or an explicitly
      degraded raw-only fallback.
- [x] Support two data modes. `Raw exact` queries `transcripts.parquet` or native
      level-0 grids by viewport bbox, QV, gene filter, and projected columns
      only when the visible transcript estimate is inside the exact render
      budget. `Native Xenium LOD` reads official `transcripts.zarr.zip` density
      and grid-pyramid data for whole-slide and medium-zoom transcript
      density/gene bins.
- [x] If native LOD is missing, the tab should make that visible. The app can
      still show exact transcripts after the user zooms far enough, but low zoom
      should show a cell-level transcript-count hint or an unavailable state
      rather than silently scanning the raw transcript file.

### LOD And Grouping Options

- [ ] Option A: raw DuckDB `GROUP BY` over `transcripts.parquet` for the current
      viewport. This is useful for small fixtures and narrow close-zoom regions,
      but it is not the production low-zoom strategy unless the transcript
      parquet is spatially sorted with row-group statistics that prune tightly.
- [x] Option B: cell-derived `transcript_counts` from `cells.parquet`. This is
      cheap and already loaded, but it only approximates transcript density and
      cannot support feature/gene-level hover. Use only as a fallback hint.
- [x] Option C, recommended: official `transcripts.zarr.zip`. Use
      `/density/gene` for selected-feature binned count density and `/grids` as
      the transcript pyramid for downsampled all-transcript views. The verified
      demo zip did not expose a separate `/density/codeword` group, so codeword
      details remain exact/metadata-driven until a dataset with that group is
      available.
- [ ] Option D: browser/GPU screen aggregation after loading raw transcript
      points. This helps visual density once points are already loaded, but it
      does not solve the hundred-million fetch problem and should not be used as
      the low-zoom data strategy.
- [ ] Option E: server-side tiles/API. This would be operationally useful later
      but does not match the current no-application-server data path. Keep this
      out of Phase 5.1 unless the product direction changes.

### Data Architecture

- [x] Add transcript-specific model types, separate from ROI export:
      `TranscriptPoint`, `TranscriptAggregateBin`, `TranscriptLodLevel`,
      `TranscriptViewportEstimate`, and `TranscriptLayerState`.
- [x] Extend dataset capability discovery to distinguish raw
      `transcripts.parquet` exact rendering from native `transcripts.zarr.zip`
      LOD availability. Keep the existing boolean compatibility path, but let
      the UI know whether exact-only or full LOD is available.
- [x] Read native transcript Zarr metadata from root attributes, `/density`
      attributes, and `/grids` attributes: total transcript count, FOV names,
      gene names, density grid size/origin, grid pyramid levels, grid keys, and
      per-grid transcript counts.
- [x] Raw exact queries should project only columns needed for rendering and
      hover: `cell_id`, `feature_name`, `x_location`, `y_location`,
      `z_location`, `qv`, `overlaps_nucleus`, `is_gene`, and `transcript_id` if
      present. Avoid `ORDER BY` in overlay point queries.
- [x] Add a viewport summary query grouped by `feature_name` and `fov_name` for
      the Transcripts tab. Keep it bounded and filtered by bbox/QV/feature so it
      supports exact-mode context without becoming a low-zoom rendering strategy.
- [x] Load DuckDB-WASM `httpfs` during bootstrap before remote Parquet reads,
      keeping a non-fatal fallback for older bundles. Browser verification on
      DuckDB v1.5.1 read 100 remote default-dataset transcript rows in about 1.2s
      after client initialization, but exact bbox scans can still exceed the
      interactive timeout when Parquet row groups do not prune tightly.
- [x] Exact transcript viewport loading now prefers the official
      `transcripts.zarr.zip` level-0 `/grids/[grid_position]` records when the
      Zarr file is range-readable, falling back to raw `transcripts.parquet` only
      when the Zarr file is unavailable. This matches 10x's scaled transcript
      visualization layout and fixes close-zoom cases where the visible
      transcript count is tiny but raw Parquet scans still time out.
- [x] Zarr exact transcript coordinates are decoded with Zarrita ndarray strides
      instead of assuming row-major `[x,y,z]` storage. This fixes the erroneous
      horizontal-band rendering caused by reading all X values, then all Y
      values, as interleaved coordinate rows. Exact mode now also refuses to draw
      partial point-budget results; if a viewport exceeds the exact budget, it
      shows a budget message rather than a misleading tile strip.
- [x] Use viewport-version cancellation, `AbortController`, and a transcript
      query queue so transcript overlay work cannot block ROI export or Magic
      Lens. Reuse current Range checks and DuckDB worker patterns, but avoid
      sharing a busy transcript scan with interactive cell/ROI actions.
- [x] Add a transcript count/LOD estimate path before exact loading. The first
      pass estimates visible transcript count from already-loaded
      `cells.parquet` transcript-count summaries; native Zarr density counts
      remain the next accuracy improvement.
- [x] Native transcript aggregate implementation decision: use
      `grids.grid_keys` plus `grids.grid_number_objects` for all-transcript
      low/medium zoom bins, and use `density/gene` sparse rows for
      selected-feature bins. Keep cell-summary bins only as a degraded fallback
      when native Zarr LOD is missing and the feature filter is `All`.
- [x] Superseded 10x-style selected-gene density decision: keep `Exact` mode as the
      record-level transcript view, and use the 10x-like feature-circle overlay
      only for explicit low/medium zoom selected-gene `Density` from
      `density/gene`. `Auto` remains an all-transcript density overview: it
      colors stable density grid squares by transcript count and does not switch
      to selected-gene feature circles. Emit one feature-circle glyph per
      `(bin, gene)` for the top genes in each bin, offset those glyphs
      deterministically within the bin, and cap visible genes per bin at eight
      with omitted counts exposed in hover metadata.
- [x] 2026-06-06 transcript LOD UX decision: supersede the selected-gene
      10x-style feature-circle path for the user-facing transcript overlay.
      Keep only `Auto`, `Density`, and `Exact` in the transcript detail control.
      `Density` always uses native `/grids` transcript-count squares with the
      former `Bins` budget of 1,500 squares. `Auto` uses that Density overview
      until the visible transcript estimate is inside the exact budget, then
      switches to exact transcript records. Feature filters are applied by
      `Exact`, not by the aggregate density overview.

### Rendering Behavior

- [x] Add transcript layers to the deck.gl composition without changing the
      morphology canvas path. Keep aggregate bins and exact transcript points as
      distinct layer data so updates do not rebuild cell layers.
- [x] Whole-slide/low zoom: draw stable aggregate bins or tile clusters. Encode
      count by area/opacity and color by selected feature/gene when a filter is
      active; otherwise use a neutral density color that does not fight cell
      annotation or morphology colors.
- [x] Initial low-zoom fallback: Density/Auto can render stable all-gene
      aggregate bins from loaded cell transcript counts when native
      `transcripts.zarr.zip` LOD is unavailable. Native grid/density parsing is
      now the preferred path when the zip is present.
- [x] Medium zoom: use smaller fixed data-space bins. Hover shows aggregate
      count, selected-gene count, top features, bin size, and whether the data is
      exact or aggregated.
- [x] Closest detail tier: render every visible matching transcript in the
      viewport as an exact point. Do not sample in exact mode. If the viewport
      still exceeds the exact budget, stay in aggregate mode and show an
      explicit "zoom or filter for exact transcripts" status instead of dropping
      rows.
- [x] Exact transcript points should be pickable. Hover copy should include
      feature/gene, cell id when present, x/y/z location, QV, nucleus overlap,
      gene/control status, and transcript id when present.
- [x] Verified native exact `transcripts.zarr.zip` grid tile schema on the demo
      dataset: level-0 tiles expose location, gene/codeword identity, id,
      quality score, validity/status, uuid, and gene offset arrays, but no
      per-transcript cell assignment array. Hover must omit the Cell row when no
      cell ID is present instead of labeling native grid records as unassigned.
- [x] Official 10x source decision for transcript hover cell assignment:
      `transcripts.parquet` is the source of truth for transcript-level
      `cell_id`, `overlaps_nucleus`, `nucleus_distance`, `is_gene`, FOV, QV, and
      coordinates. `transcripts.zarr.zip` remains the fast visualization source
      for native grids/density. `cells.zarr.zip` and `cell_feature_matrix.*`
      cannot provide per-transcript assignment; they contain segmentation/cell
      IDs and assigned Q20 cell-feature counts respectively.
- [x] Native exact transcript points now keep a separate display
      `transcriptId`, then enrich matching points from `transcripts.parquet` by
      `(fov_name, transcript_id)` so transcript hover can show both transcript ID
      and confirmed cell ID without per-hover network work.
- [x] Keep point sizing in screen pixels with a small radius and configurable
      opacity. Panning and zooming should not shift aggregate bin membership
      because bins are anchored in data coordinates.
- [x] Selected-gene native aggregate rendering was removed from the
      user-facing transcript modes. Exact transcript points remain the selected
      feature path; aggregate Density and Auto show all-transcript count squares.
- [x] Transcript density square color normalization uses a global native LOD
      count domain instead of the maximum count in the current viewport. This
      prevents density squares from becoming unexpectedly brighter while panning
      or zooming into lower-count regions. Feature-circle gene colors remain
      categorical, and exact transcript points remain unchanged.
- [x] `Density` now uses the native `/grids` pyramid instead of scanning every
      gene through `density/gene` at close zoom. This avoids the horizontal
      banding seen in all-feature density squares while preserving exact
      transcript behavior.

### Transcripts Tab UX

- [x] Controls:
      `Show transcripts` toggle, `Detail` segmented control (`Auto`, `Density`,
      `Exact`), `Min QV`, `Gene-only` toggle, feature filter
      (`All genes`, `Selected genes`, search/pick feature), color mode,
      opacity, point size, and aggregate scale.
- [x] Initial status readout:
      active data source (`Raw exact` or `Native Xenium LOD`), current LOD tier,
      estimated visible transcripts, rendered point/bin count, exact eligibility,
      and last query timing. Use the existing status-chip/loading-dot pattern.
- [x] Interaction model:
      hover shows a compact floating tooltip; click or keyboard focus can pin
      the hovered transcript/aggregate into the tab for copying and inspection.
      Aggregate hover should not imply individual transcript identity.
- [x] Query behavior:
      auto-refresh in `Auto` mode after debounced viewport changes, with visible
      loading state and cancellation. Exact mode may require an explicit
      `Load exact viewport` action when the estimate is near the budget.
- [x] Shareable state:
      include transcript overlay enabled, detail mode, min QV, feature filter,
      color mode, opacity, and point size in the URL hash. Keep hashes compact
      and omit defaults.
- [x] Diagnostics:
      include transcript capability, native LOD availability, transcript query
      timings, exact-budget decisions, and last hover/query errors in the local
      diagnostics dump.

### Implementation Slices

- [x] Slice 1: transcript capability/manifest detection, LOD planner, state
      types, tests, and tab shell with disabled/unavailable states.
- [x] Slice 2: raw exact viewport query and exact transcript point rendering at
      close zoom, including hover tooltip and exact-budget status.
- [x] Slice 3: native `transcripts.zarr.zip` density/grid reader, aggregate bin
      rendering, and aggregate hover summaries.
      Aggregate bin rendering and hover now use native Zarr grid metadata for
      all-transcript views and native `density/gene` sparse counts for
      selected-feature views. Cell-summary bins remain only as a degraded
      fallback when native Zarr is unavailable.
- [x] Slice 4: gene/feature filters, QV controls, color/opacity/point-size
      controls, URL/shareable state, diagnostics, and loading indicators.
- [x] Slice 5: integration verification against Magic Lens, ROI transcript
      export, selected-gene expression overlays, annotation coloring, and
      morphology channels.

### Definition Of Done

- [x] At low and medium zoom, the viewer never attempts to materialize
      hundred-million raw transcript rows. It either uses native Xenium Zarr
      aggregate levels or shows a clear unavailable/fallback state.
- [x] At the closest exact tier, every visible matching transcript is rendered
      when the visible estimate is within budget, and hover shows record-level
      transcript metadata.
- [x] Exact mode does not silently sample. If the viewport is too dense, or the
      raw exact query exceeds the interactive timeout, the UI explains the
      budget/timeout decision and how to reach exact rendering.
- [x] Aggregate bins are stable while panning and zooming across LOD thresholds.
- [x] Transcript overlay work is abortable and does not block ROI cell lookup,
      ROI transcript export, Magic Lens, or selected-cell detail loading.
- [x] Unit tests cover LOD planning, raw SQL/query options, native Zarr metadata
      parsing, layer-data conversion, hover copy, shareable state, and budget
      decisions.
- [x] E2E/browser verification covers the Transcripts tab shell and controls.
      Vitest integration tests cover aggregate selection, exact rendering,
      near-budget `Load exact viewport`, and transcript click/hover inspection.
- [x] Final verification passes `npm test`, `npm run build`,
      `npm run typecheck`, `npm run lint`, and `npm run test:e2e`.

## Phase 6 New Phase - Visium HD Visualization

User-added requirement: extend the viewer beyond Xenium so it can visualize
Visium HD Space Ranger output directly from a hosted `outs/` directory.
`PLAN.md` already anticipated Visium through the capability-based
`SpatialDataset` interface; record the concrete Visium HD work here.

### Reference Dataset

- [x] Use this public Visium HD fixture for development and smoke tests:
      `https://mp33.cog.sanger.ac.uk/public/visiumhd/spaceranger401_count_50314_48d90238006ebffe73177a68c2b4f48f`
- [x] Fixture top-level files/directories supplied by the user:
      `binned_outputs/`, `segmented_outputs/`, `spatial/`,
      `barcode_mappings.parquet`, `feature_slice.h5`, `metrics_summary.csv`,
      `molecule_info.h5`, `probe_set.csv`, and `web_summary.html`.
- [x] HTTP probes confirmed binned Visium HD outputs are byte-range readable.
      Key observed sizes:
      16 µm `tissue_positions.parquet` 3.3 MB, 8 µm 11.3 MB, 2 µm 171.2 MB;
      16 µm `filtered_feature_bc_matrix.h5` 121.6 MB, 8 µm 160.3 MB,
      2 µm 236.5 MB; root `molecule_info.h5` 989.0 MB; high-res tissue PNG
      37.6 MB; low-res tissue PNG 230.7 KB.
- [x] 2026-06-15 re-probe after fixture update: root `feature_slice.h5` is
      present and byte-range readable at 503.2 MB, root
      `barcode_mappings.parquet` is present and byte-range readable at
      109.8 MB, root `spatial/tissue_hires_image.png` and
      `spatial/tissue_lowres_image.png` are present, and root
      `spatial/scalefactors_json.json` still returns 404. Continue to use
      binned or segmented `spatial/scalefactors_json.json` for image/bin or
      image/cell alignment.
- [x] Root `barcode_mappings.parquet` schema:
      `square_002um`, `square_008um`, `square_016um`, `cell_id`,
      `in_nucleus`, `in_cell`; 11,222,500 rows across 1,123 row groups. This is
      the bridge for relating 2 µm bins to 8/16 µm bins and segmented cell
      assignments.
- [x] Position Parquet schema is consistent across 16/8/2 µm:
      `barcode`, `in_tissue`, `array_row`, `array_col`,
      `pxl_row_in_fullres`, `pxl_col_in_fullres`. Each file currently has one
      Parquet row group, so viewport row-group pruning is not available for
      these position files.
- [x] Filtered matrix barcode counts from TSV sidecars:
      54,504 at 16 µm, 215,320 at 8 µm, and 3,443,936 at 2 µm, with 18,085
      gene-expression features. These matrix barcodes are the in-tissue bin set
      and should be preferred over all-grid 2 µm position rows when possible.
- [x] Scalefactors paths are present at
      `binned_outputs/square_002um/spatial/scalefactors_json.json`,
      `binned_outputs/square_008um/spatial/scalefactors_json.json`,
      `binned_outputs/square_016um/spatial/scalefactors_json.json`, and
      `segmented_outputs/spatial/scalefactors_json.json`. Binned
      `scalefactors_json.json` reports
      `microns_per_pixel = 0.22133875377751464`; `spot_diameter_fullres` is
      72.287 px at 16 µm, 36.144 px at 8 µm, and 9.036 px at 2 µm. The tissue
      image is 6000 x 5143 at high resolution and 600 x 514 at low resolution.
      Segmented scalefactors report the same image scale fields but do not
      include `bin_size_um` or `spot_diameter_fullres`.
- [x] The array-row/array-column to full-resolution image coordinate transform
      is affine with a small residual when derived from the first row/column
      samples. For 16 µm the approximate deltas are:
      column step `(row_px +0.2023, col_px -72.2784)` and row step
      `(row_px +72.2785, col_px +0.2035)`. Use `tissue_positions.parquet` as
      the source of truth for 16/8 µm, and consider deriving the 2 µm transform
      from a small position sample plus filtered barcodes to avoid materializing
      all 11.2M grid positions.

### Product Decisions

- [ ] Implement a real `VisiumHdDataset` rather than adding Visium branches
      inside `XeniumDataset`.
- [ ] Add a dataset factory/detector so app dependencies can resolve a generic
      `SpatialDataset` from a URL. The current URL helpers and caches should
      stop assuming Xenium file names such as `cells.parquet`,
      `cell_feature_matrix.zarr.zip`, `transcripts.parquet`, and
      `experiment.xenium`.
- [ ] Treat Visium HD renderable units as square bins, not cells. Use barcode
      IDs as element IDs and expose bin size as a first-class dataset setting.
- [ ] Represent Visium HD bins as an indexed affine grid, not as per-bin
      polygons and not as axis-aligned squares in image/render space. Add a
      dataset-level grid basis with `origin`, `rowStep`, and `colStep`; the
      axis-aligned square is only the degenerate basis where the steps align
      with the render axes.
- [ ] Keep `ElementGeometry` as the logical/addressing view for picking,
      tooltip, selection, and inspected elements only. Do not use an array of
      `{ kind: 'grid-cell', gridId, row, col }` objects as the bulk storage for
      a Visium HD tier. Grid-tier payloads must stay columnar, for example
      `Int32Array` rows, `Int32Array` cols, and one interned `gridId`, with
      logical elements reconstructed on demand.
- [ ] Define `SpatialGrid` invariants up front: `origin` is the center of bin
      `(0, 0)`; `rowStep` and `colStep` are center-to-center pitches in the
      same render coordinate space as polygon rings and image alignment;
      `row`/`col` match Space Ranger `array_row`/`array_col`; grid-cell corners
      use the contiguous-square `±0.5` rule in array space. Occupancy is not
      part of the grid basis; it comes from emitted/loaded bins, with optional
      row/col bounds only for cheap culling.
- [ ] Separate nominal and measured geometry. `binSizeMicrometers` is the
      declared tier size used for labels, tier selection, and scale logic;
      `rowStep`/`colStep` are the measured render geometry after registration.
      Small differences between nominal size and measured step length are
      expected and should not be treated as bugs.
- [ ] Fit or read the finest reliable grid basis once, then derive coarser
      binned tiers by integer scaling of the same origin and step vectors when
      possible. Avoid independently fitting 2/8/16 µm tiers in a way that
      introduces slightly different orientations and breaks exact cross-tier
      nesting needed by `barcode_mappings.parquet`.
- [ ] Start with binned output visualization (`square_016um` and
      `square_008um`) before Feature Slice H5 and segmented-output support.
      The 2 µm layer is valuable but must be handled as a high-density mode with
      explicit budgets.
- [ ] Hide or disable Xenium-only workflows for Visium HD until equivalent data
      exists: transcript overlay, raw transcript hover, Magic Lens transcript
      scans, Xenium cell boundaries, and Xenium `analysis.zarr.zip`
      annotations.
- [ ] Use binned `tissue_hires_image.png`/`tissue_lowres_image.png` plus
      `scalefactors_json.json` for the image underlay. This requires finishing
      the existing `ImageSource.kind === 'flat'` path in the viewer.
- [ ] Keep coordinates internally in micrometers where possible, but explicitly
      model Visium HD full-resolution image pixels and scalefactors. Do not
      assume Xenium's OME-TIFF pyramid units or Y-axis handling in shared code.

### Implementation Slices

- [ ] Slice 1: dataset detection and capability plumbing.
      Add `VisiumHdDataset`, generic dataset cache helpers, and platform-aware
      diagnostics. Detect Visium HD from `binned_outputs/square_*um` and binned
      `spatial/tissue_positions.parquet`/`scalefactors_json.json`; detect Xenium
      from `experiment.xenium` as today. In the same slice, add the generic
      `SpatialElementId`/barcode-keyed expression contract and the indexed
      affine-grid contract before implementing Visium readers.
- [ ] Slice 2: binned overview reader.
      Read 16 µm `tissue_positions.parquet`, filter `in_tissue = 1`, convert
      full-resolution pixel coordinates through `microns_per_pixel`, and return
      columnar grid-cell payloads with barcode IDs, bin size, array row/column,
      and tissue position metadata. Add 8 µm support behind a bin-size selector.
- [ ] Slice 3: square-bin rendering.
      Extend renderer layer data so indexed affine grid cells draw through a
      dedicated grid layer instead of being dropped by the current polygon-only
      boundary conversion. Compute corners from the shared basis, keep winding
      correct for left-handed image-space bases, and reconstruct logical
      `ElementGeometry` only for hovered, clicked, or selected bins. Hover and
      selection should show barcode, bin size, array row/column, full-res pixel
      coordinate, and any loaded expression summary.
- [ ] Slice 4: flat tissue image underlay.
      Implement `ImageSource.kind === 'flat'` in the viewer with PNG loading,
      scale-factor alignment, opacity, and fallback from high-res to low-res.
      Verify visual alignment against 16 µm and 8 µm bins.
- [ ] Slice 5: binned gene panel and expression.
      Add a generic feature-barcode matrix reader for Visium HD barcodes. Use
      `filtered_feature_bc_matrix/features.tsv.gz` for the gene panel first, and
      evaluate whether `filtered_feature_bc_matrix.h5` can serve interactive
      selected-gene counts without downloading unacceptable amounts of data.
      Avoid the Xenium cell-id integer codec in all Visium paths.
- [ ] Slice 6: ROI and embedding compatibility.
      Reuse ROI geometry for bin selection and export selected barcodes. Load
      binned `analysis/umap/gene_expression_2_components/projection.csv` when
      present, keyed by barcode rather than cell ID.
- [ ] Slice 7: 2 µm strategy.
      Do not load all 11.2M position rows for first paint. Prefer filtered
      matrix barcodes plus the derived affine array-to-image transform, or a
      separate viewport/tiled strategy, before enabling 2 µm rendering.
- [ ] Slice 8: Feature Slice and segmented outputs.
      After the binned MVP is stable, use available root `feature_slice.h5` and
      `barcode_mappings.parquet` for Feature Slice gene/UMI image slices and
      bin-to-cell mapping. Re-probe `segmented_outputs/` geometry paths before
      segmented cell/nucleus rendering; the fixture currently exposes
      `segmented_outputs/filtered_feature_cell_matrix.h5`, but common GeoJSON
      segmentation paths still return 404.

### Phase 6 Execution Notes

- [x] Foundation pass started Slice 1: added generic `SpatialElementId`
      plumbing, generic `GexResult<ElementId>`, `SpatialGrid`/`SpatialGridBasis`,
      columnar `GridCellBatch`, and logical `grid-cell` element geometry while
      keeping existing Xenium behavior typed as `SpatialDataset<CellId>`.
- [x] Added affine-grid helper coverage for center/corner derivation, winding
      normalization, least-squares basis fitting, and nested coarser-tier basis
      derivation. This keeps the render contract aligned with the 2 µm scaling
      plan instead of materializing per-bin quadrilateral objects.
- [x] Added Visium HD detection/cache scaffolding and a `VisiumHdDataset` stub.
      Detection recognizes Xenium through `experiment.xenium` and Visium HD
      through binned `tissue_positions.parquet`, `scalefactors_json.json`, and
      `filtered_feature_bc_matrix.h5`, with optional segmented scalefactors.
- [x] Added platform-aware diagnostics. Diagnostics now run dataset detection
      first, keep the Xenium manifest/range checks on Xenium datasets, and
      check Visium HD binned positions, binned scalefactors, binned filtered
      matrices, binned tissue images, root `feature_slice.h5`, root
      `barcode_mappings.parquet`, and segmented scalefactors when present.
- [x] Added app-dependency routing scaffolding for `detectSpatialDataset` and
      `getSpatialDataset` through the generic detector/cache. `App.tsx` still
      follows the existing Xenium-specific load lifecycle until the Visium HD
      binned reader and UI capability gating are ready.
- [x] Added the first Visium HD binned-overview payload contract: nominal bin
      size, measured `SpatialGrid`, columnar `GridCellBatch`, full-resolution
      position columns, tissue flags, and source-path provenance.
- [x] Added the first executable Visium HD binned overview reader. It parses
      Space Ranger scalefactors, reads `tissue_positions.parquet` through a
      projected hyparquet object-row path, filters out-of-tissue rows by
      default, converts full-resolution row/column centers into micrometer
      render coordinates, fits the shared affine grid basis, and exposes
      `VisiumHdDataset.meta()`/`elements(bbox)` over columnar grid-cell batches.
- [x] Remaining Slice 1 integration work: wire the app lifecycle through
      generic dataset detection/capabilities without regressing existing Xenium
      loaders.
- [x] Current dev state before checkpoint commit: the foundation contracts,
      affine-grid helpers, detector scaffolding, `VisiumHdDataset` stub, and
      focused tests are implemented locally. The app still loads through the
      existing Xenium-specific dependency path; Visium HD detection is not wired
      into the UI lifecycle yet. Pre-existing untracked `PLAN.md` and `old/`
      remain outside this Phase 6 change.
- [x] Current dev state after diagnostics/dependency pass: TypeScript, ESLint,
      focused Phase 6 tests, full Vitest, and production build pass locally.
      The Visium HD reader, flat tissue image layer, grid-cell renderer, and
      platform capability gating remain the next implementation work.
- [x] Current dev state after binned-reader pass: scalefactor parsing,
      tissue-position parsing, in-tissue filtering, affine basis fitting,
      dataset metadata, and bbox-filtered `GridCellBatch` emission are covered
      by focused unit tests. The reader is not connected to the app UI yet.
- [x] Added rendering primitives for Visium HD bins and flat tissue PNGs.
      Columnar `GridCellBatch` data can now be reconstructed into deck.gl
      grid-cell polygons at the render boundary, `ViewerCore` renders
      grid-cell-only scenes without requiring Xenium overview points, and
      `VisiumHdDataset.image()` returns the high-resolution binned tissue PNG
      as a flat `ImageSource`. Added canvas projection math for drawing a
      downsampled flat image across its full-resolution micrometer extent.
- [x] Added the first app-lifecycle integration for Visium HD. Dataset loading
      now probes platform before starting Xenium warmup/gene/annotation work,
      routes Visium HD through `getSpatialDataset()`, reads the default binned
      overview as affine grid cells, renders the flat high-resolution tissue
      PNG through `MorphologyCanvas`, and disables Xenium-only viewport
      boundary/expression, transcript, ROI, Magic Lens, annotation, and cell
      detail workflows while Visium HD is loaded. Focused tests cover the
      Visium lifecycle branch, disabled viewport detail loaders, and grid-only
      viewer fitting.
- [x] Browser-smoked the supplied Space Ranger 4.0.1 Visium HD reference URL
      through the local app. The dataset loaded 54,504 16 µm bins and the
      high-resolution tissue PNG rendered under the grid. The smoke exposed
      that this dataset omits `tissue_hires_image_width`/height in
      `scalefactors_json.json`; the flat image contract now treats dimensions
      as optional and falls back to the browser image's natural size.
- [x] Current dev state after app-integration pass: `tsc -b`, ESLint, full
      Vitest, production build, `git diff --check`, and a local browser smoke
      of the supplied Visium HD URL all pass. Build still reports the existing
      browser-externalized dependency and large chunk warnings.

### Definition Of Done For The First Visium HD MVP

- [ ] Loading the reference URL renders a tissue image plus aligned 16 µm square
      bins without requiring any Xenium files.
- [ ] The user can switch between 16 µm and 8 µm binned outputs; 2 µm is either
      explicitly unavailable with a reason or enabled through a budgeted path.
- [ ] The UI clearly labels the dataset as Visium HD and disables transcript,
      Magic Lens, and Xenium cell-boundary controls instead of surfacing
      misleading errors.
- [ ] Hover/click on a bin shows barcode, bin size, tissue status, array
      row/column, image coordinate, and expression details once expression
      loading is implemented.
- [ ] Dataset diagnostics check the Visium HD files that actually matter for
      the selected mode: binned positions, binned scalefactors, binned tissue
      image, filtered feature-barcode matrix, and optional analysis projection.
- [ ] Unit tests cover Visium HD path detection, scalefactor parsing,
      tissue-position parsing, affine transform derivation, square-bin layer
      conversion, and platform capability gating.
- [ ] Browser/E2E smoke covers the reference dataset through at least image plus
      16 µm bins.
- [ ] Final verification passes `npm test`, `npm run build`,
      `npm run typecheck`, `npm run lint`, and `npm run test:e2e`.
