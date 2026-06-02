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
      highlighting. The H5 feature-matrix backend remains a later Phase 4 task.
- [x] Expression loading is viewport-scoped and capped at 5,000 visible cells for
      now to avoid whole-slide feature-matrix work on million-cell datasets.
- [x] Added compact image-layer and gene-expression-layer opacity controls to the
      layer stack. The image slider controls the morphology canvas opacity; the
      gene slider controls the deck.gl gene-expression overlay opacity.
- [x] Added selectable gene-expression color scales. Switching scales restyles
      the current expression overlay from loaded per-cell counts without
      refetching the expression matrix.

## Phase 4 Running TODO

- [x] Gene picker backed by full `gene_panel.json` (pick before drawing).
- [x] Whole-slide expression coloring with level-of-detail: low zoom density
      bins; medium zoom sampled cells; high zoom exact cells; ROI exact mode.
- [x] Gene sets: import/paste symbol lists; score cells by sum/mean/z-scored
      signature; color by score; save named sets.
- [x] Annotation import from `analysis.zarr.zip`, CSV, and JSON.
- [ ] ROI annotations: draw polygon/box/lasso; compute summary stats; export
      selected cells/transcripts.
- [ ] UMAP/tSNE panel linked to spatial selection.
- [ ] HDF5 path for `cell_feature_matrix.h5` with `h5wasm` and `jsfive`
      fallback.

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
- [x] Gene expression now paints polygon geometry when possible. At intermediate
      zooms the expression overlay fills centroid hexagons; when true boundary
      polygons are visible and IDs match the expression batch, expression fills
      those polygons. Point-based expression remains the fallback when no
      suitable polygon geometry is available.
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
      and visible hex/true boundary geometry inherits the matching cell color
      instead of staying on the default boundary palette.
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
- [x] Optimized annotation coloring for pan/drag. Annotation mode now builds a
      stable cell-id color lookup instead of cloning every overview cell, passes
      that lookup to point, hexagon, and true-boundary styling, and disables
      overview picking until the visible cell count is small enough for precise
      cell selection. Empty expression overlays now reuse a stable empty array
      so pan-only viewport changes do not recreate deck layers. Low-zoom
      annotation activation leaves the million-point deck layer stack unchanged;
      full per-cell annotation coloring is applied once the visible set is small
      enough for precise interaction. Viewport cell clipping is deferred until
      close zoom so overview and medium-zoom pans reuse the stable full centroid
      array instead of scanning every cell on each drag event. The base
      million-point layer uses stable accessor functions to prevent unnecessary
      position/radius/color attribute invalidation.
- [x] Fixed the spatial-view blink introduced by the navigation optimization.
      The overview point layer now remains visible during pan, drag, and zoom;
      annotation coloring is still deferred until close zoom to avoid full-slide
      recoloring at overview scale.
