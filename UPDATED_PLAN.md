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
- [x] Overview cell loading keeps the fast 50,000-cell first-paint path by
      default after a full-read smoke check exceeded 60 seconds. `All cells` is
      now an explicit opt-in that removes the hyparquet row limit.
- [x] True cell segmentation can now render as deck.gl polygons. The viewer
      debounces viewport changes and loads `cell_boundaries.parquet` only when
      the viewport is close enough or has no more than 500 visible overview
      cells.
- [x] Boundary loading uses the `SpatialDataset.elements(bbox)` range-read path
      and dynamically imports DuckDB only after the polygon threshold is met.
      DuckDB now uses the non-threaded MVP/EH worker bundles because the COI
      pthread bundle failed to load DuckDB extensions (`spatial`/`parquet`) in
      the browser with a shared-memory mismatch.
