# Phase 2 — Robust I/O, Caching, S3 Hardening

- [x] S3/CORS playbook; fail loudly if Range is unsupported.
- [x] Range-read `cell_boundaries.parquet`, with no full-download path left.
- [x] Persistent cache for tiles and Parquet footers, with a persisted LRU.
      Implemented with IndexedDB (not OPFS).
- [x] `AbortController` cancellation per viewport version for every fetch.
- [x] Read the `experiment.xenium` manifest instead of guessing image paths with
      `HEAD`.
- [x] Structured error states in the UI.
- [x] Use the dataset's `.zchunkstore` image chunk index when present, falling
      back to GeoTIFF metadata parsing.

Notes:

- `docs/s3-cors-playbook.md` documents the CORS policy, serving rules, and a
  one-byte Range check.
- A browser Range probe requires HTTP 206 and an exposed `Content-Range` before
  reading `cells.parquet` or `cell_boundaries.parquet`.
- `.zchunkstore` adapts the Observable "OME-TIFF File Chunk Store" pattern: a
  JSON manifest maps Zarr chunk keys to TIFF byte ranges. Edge and overview
  tiles are cropped to their true source size.
- Morphology tiles: decode workers start lazily and are capped; visible tiles
  are requested centre-first; stale requests are aborted without caching an
  error; a small offscreen margin is requested; only ready tiles from the active
  level are drawn.
- The IndexedDB byte-range cache stores TIFF tile ranges (before decode) and
  Parquet footer slices, with LRU eviction. Large column pages are not cached.
- Abort signals reach dataset loads, gene panels, image candidate checks, TIFF
  opening, Range probes, hyparquet reads, and boundary and expression probes.
  DuckDB and Zarr stages that cannot be aborted are checked between awaits.
- Image loading reads the manifest once, opens only declared TIFF paths, and
  prefers MIP, then focus, then full-resolution.
  **Reopened (2026-11-08), fixed (2026-11-12):** only the first candidate path
  was tried. Now an image that fails to open falls back to the next declared
  path, a cancelled load stops, and a notice names the paths passed over
  (`morphologyImage.ts`).
- Structured errors carry source, code, title, message, action, and optional
  detail.
- `cells.parquet` decode failures name the columns, URL, and likely encoding
  problem, then fall back to DuckDB.

Definition of done: a multi-GB dataset loads from a real S3 bucket; the second
visit is warm; the app degrades gracefully on a flaky network; boundaries are
never fully downloaded.

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Reopened by the 2026-11-08 review (marked done before, found incomplete):

- [x] Xenium image choice: fall back to the next `experiment.xenium` path when
      the first fails (2026-11-12). A notice names the paths passed over.
