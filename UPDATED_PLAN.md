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
- [ ] Port with types + tests: `coords.ts`, `cellid.ts`, `duckdb.ts`, `gex.ts`,
      `tiff/loader.ts`, `tiff/tileCache.ts`, `codecs/jpeg2000.ts`.
- [ ] Define `SpatialDataset`; implement `XeniumDataset`.
- [ ] Worker pool: J2K decode + windowing in workers; DuckDB in its own worker.
- [ ] Zustand store; React chrome around the deck.gl/canvas core.
- [ ] hyparquet first-paint scatter from `cells.parquet`.

## Current Port Subtasks

- [x] `coords.ts`
- [x] `cellid.ts`
- [x] `duckdb.ts`
- [x] `gex.ts`
- [ ] `tiff/loader.ts`
- [ ] `tiff/tileCache.ts`
- [ ] `codecs/jpeg2000.ts`
