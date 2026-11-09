# Spatial Omics Explorer — Unified Plan

This document merges three planning records into one. The originals were
removed after the merge; they are in git history up to commit `096ef46`.

- `PLAN.md`: the original production brief (scope, conventions, architecture
  decisions, Xenium data contract, phases 1–6, hosting, testing, risks).
- `UPDATED_PLAN.md`: execution notes for phases 1–5, plus the later phases 5.1
  (transcripts), 6 (Visium HD), 7 (H5AD), and 8 (image-only).
- `OPTIMIZATIONS.md`: the structural refactor recommendations and their progress.

The planning files stopped at 2026-07-09. On 2026-11-08 this plan was brought
up to date with the work shipped since then (through commit `0ed880d`), using the
git history, the code, and the current `docs/`. Work recorded only from git is
marked with its commit. Items the plan had marked done but the 2026-11-08 review
found incomplete are marked **Reopened**.

Where records disagree, the later decision is kept and the earlier one is marked
**Superseded**. [Appendix A](#appendix-a-reconciliation-notes) lists every
conflict and how it was resolved. `PLAN_VS_DOCS.md` records the review that
compared this plan with `docs/`. For current behaviour, the pages in `docs/` are
authoritative; this plan records intent, decisions, and history.

Legend: `[x]` done · `[ ]` open · **Deferred** · **Dropped** · **Superseded** ·
**Reopened**

## Contents

1. [Purpose And Scope](#1-purpose-and-scope)
2. [Working Rules](#2-working-rules)
3. [Status At A Glance](#3-status-at-a-glance)
4. [Architecture Decisions](#4-architecture-decisions)
5. [Data Contracts](#5-data-contracts)
6. [Phase Records](#6-phase-records)
7. [Application Structure And Refactor Record](#7-application-structure-and-refactor-record)
8. [Dataset Hosting Requirements](#8-dataset-hosting-requirements)
9. [Testing And CI](#9-testing-and-ci)
10. [Tech Stack](#10-tech-stack)
11. [Risks And Mitigations](#11-risks-and-mitigations)
12. [Open Items](#12-open-items)
13. [Appendix A: Reconciliation Notes](#appendix-a-reconciliation-notes)
14. [Appendix B: Source Map](#appendix-b-source-map)

---

## 1. Purpose And Scope

A client-side, browser-based viewer for spatial-omics output. It reads data **as
it comes off the instrument** directly from S3-compatible storage, with no
application server in the data path. deck.gl renders the data, and the browser
parses everything: DuckDB-WASM and hyparquet for Parquet, zarrita for Zarr and
OME-Zarr, h5wasm for HDF5, and geotiff.js plus OpenJPEG-WASM for OME-TIFF and
JPEG-2000 tiles.

The brief started as Xenium-only, with seams for Visium. Scope grew by user
request:

| Platform       | Input                                                          | Planned in                   | Status                                      |
| -------------- | -------------------------------------------------------------- | ---------------------------- | ------------------------------------------- |
| Xenium         | XOA output folder                                              | Phases 1–5.1                 | Done                                        |
| Visium HD      | Space Ranger `outs/` folder                                    | Phase 6                      | MVP done; hardening open                    |
| AnnData H5AD   | Direct `.h5ad` file URL                                        | Phase 7                      | MVP done; hardening open; one item reopened |
| Image-only     | Direct OME-TIFF/TIFF/NDPI URL, plus GeoJSON annotations        | Phase 8                      | Done (2026-07-09)                           |
| OME-Zarr image | Direct OME-Zarr URL; also custom layers and SpatialData images | Phase 9 (recorded from git)  | Done (2026-07-10)                           |
| SpatialData    | Zarr store root with `spatialdata_attrs`                       | Phase 10 (recorded from git) | Done (2026-10-13 to 2026-11-06)             |
| Visium (spots) | Space Ranger output with `tissue_positions.csv` and PNGs       | Original Phase 6 (`PLAN.md`) | Not started                                 |

### Reference Datasets

| Platform             | URL                                                                                                                            | Notes                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Xenium               | `https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328`              | Demo dataset; 1,414,155 cells                                                                                                 |
| Visium HD            | `https://mp33.cog.sanger.ac.uk/public/visiumhd/spaceranger401_count_50314_48d90238006ebffe73177a68c2b4f48f`                    | Space Ranger 4.0.1; 54,504 bins at 16 µm                                                                                      |
| H5AD                 | `https://mp33.cog.sanger.ac.uk/public/h5ad/pbmc3k.h5ad`                                                                        | 32,080,465 bytes; Range and CORS enabled                                                                                      |
| SpatialData (shapes) | `https://webatlasdataprod.cog.sanger.ac.uk/public/visium_associated_xenium_io/a5652917-ebb4-4d4c-ba90-6e8845c6f370.sdata.zarr` | Visium CytAssist, Zarr v2; 4,992 circle spots; H&E images; consolidated metadata at `zmetadata`                               |
| SpatialData (labels) | `https://cellgeni.cog.sanger.ac.uk/vento/reproductivecellatlas/ovaries/spatialdata_xenium/AU14_S14_final.zarr`                 | spatialdata-io Xenium; table annotates `labels/xenium_segmentations`; 73,579 cells × 480 genes; true scale 0.2125 µm per unit |

The SpatialData stores are for manual testing; there is no E2E coverage for them
yet.

### Starting Point: The Proof Of Concept

The POC in `old/` (vanilla JS and CDN deck.gl: `main.js`, `gex.js`, `quack.js`,
`tiff-loader.js`, `tile-cache.js`, `j2k-decoder.js`, `index.html`) was the
reference implementation for Phase 1. It was removed from the repository on
2026-07-22 (`017b0fb`); `old/` is now git-ignored. It had already solved the hard
problems:

- **Spatial Parquet querying** with DuckDB-WASM and the `spatial` extension.
  `selectionToSQL` filters by bounding box first and only then runs the exact
  test. It avoids `ST_DWithin`, so Parquet row-group statistics can still prune.
  This is the non-obvious trick to keep.
- **Per-cell gene expression** from `transcripts.parquet` and
  `cell_feature_matrix.zarr.zip` (CSC per-cell slicing), behind one return shape.
  The Xenium cell-ID codec (`intToCellId`/`cellIdToInt`, integer ↔ shifted hex)
  is correct and easy to get wrong. Keep it verbatim and test it.
- **16-bit JPEG-2000 OME-TIFF tiling.** geotiff.js parses the IFD/SubIFD
  structure, HTTP Range requests fetch raw tile bytes, OpenJPEG-WASM decodes them,
  and percentile windowing sets contrast. This path is needed because Viv and
  geotiff.js cannot decode JPEG-2000 above 8 bits, and Xenium morphology is
  16-bit grayscale JPEG-2000.
- **Cluster annotations** from `analysis.zarr.zip`: `cell_groups` CSR
  `indptr`/`indices`, mapped through `file_row_number` order.
- **Remote-first loading** from a public HTTPS URL, with streamed progress.

What the POC lacked, and what this plan set out to close:

1. A single-file, global-state design that was untestable and hard to extend.
2. Image decode on the main thread, which caused pan/zoom jank.
3. deck.gl loaded from a CDN script, so it was unbundled and unversioned.
4. Inconsistent `httpfs` use: boundaries were fully downloaded and there was no
   metadata cache.
5. No JPEG XR and no multi-channel morphology.
6. No HDF5 path.
7. No gene-set scoring, annotation import, or shareable view state.
8. No tests, CI, error boundaries, S3/CORS hardening, or persistent caching.

---

## 2. Working Rules

### How To Use This Document

- This document is the source of truth for scope and sequencing. Work phase by
  phase. Do not start a phase until the previous phase's definition of done is
  met, unless the user explicitly changes the order. The user did this twice:
  to pull the first gene-expression slice ahead of Phase 4, and to start Phase 3
  without JPEG XR and Z-stack.
- Each task is a checkbox and a small, reviewable PR.
- **DECISION** marks a default that has already been chosen. Deviate only on a
  concrete blocker, and record why in the PR.
- Where the POC already solves something, port and harden it. Do not
  reimplement it.
- Prefer small, pure, unit-tested modules over large stateful files.
- **Current sequence (2026-06-07):** fix existing functionality first, then
  optimize. The correctness pass needed before Phase 5.1 is closed. The broader
  optimization pass is still open.
- Phases 9 and 10 and the November 2026 rendering work were not planned in
  advance. They are recorded from commits, and their task lists describe what
  shipped.
- When a feature ships, update this plan and the matching page in `docs/` in the
  same PR.

### Conventions For Every Task

- **TypeScript in strict mode, with zero `any` in the data layer.** Model Arrow
  `bigint` vs `number`, cell-ID string vs integer pair, and µm vs px as distinct
  (branded) types, so the compiler catches conversions.
- **One coordinate module.** All screen↔data, µm↔px, and tile-bounds maths lives
  in `coords.ts`. It reads a `units` descriptor from the dataset.
- **Heavy data stays out of the global store.** The store holds descriptors,
  selection geometry, gene picks, view state, and UI flags. Arrow tables, typed
  arrays, and `ImageBitmap`s live in modules or caches, referenced by ID.
- **Decode and bulk parsing run in Web Workers.** The main thread schedules and
  draws. Transfer `ArrayBuffer`s and `ImageBitmap`s instead of copying them.
  Known exceptions (2026-11): hyparquet reads, zarrita reads for the Xenium
  matrix, H5AD references, and SpatialData tables, h5wasm for H5AD and the
  Xenium H5 fallback, and auto-contrast run on the main thread. See
  [Open Items](#12-open-items).
- **Every error reaches the UI.** No silent `console.warn`. A failed fetch, a
  403, a decode error, or a corrupt Zarr must be shown to the user.
- **Tests go in the same PR as the code.** A module without tests is not done.
- **Pin dependency versions.** No CDN `<script>` tags in the app bundle.

### Refactor Rules (2026-06-07)

- Shrink `App.tsx` by extracting coherent feature or domain boundaries, not by
  line count. `App.tsx` stays the orchestration root.
- Do not move state into Zustand just to make `App.tsx` shorter.
- Do not combine a refactor with behaviour changes. Keep product behaviour and UI
  copy unless a task explicitly asks for a change.
- No generic catch-all hooks such as `useAppState`.
- Avoid components with very large prop bags. Extract a view/model boundary
  together with the component, or leave the section in `App.tsx`.

### Global Definition Of Done

A task or phase is done when the code is typed and lint-clean, its unit and
integration tests pass in CI, it works against the demo dataset, and the phase's
exit criteria have not regressed. In practice, each phase closed after
`npm test`, `npm run build`, `npm run typecheck`, `npm run lint`, and
`npm run test:e2e` passed.

### Skills

| Skill                         | Use for                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `frontend-design`             | Building or styling any UI: components, panels, controls, layout. Primary skill for Phases 1, 3, 4, and 5   |
| `vercel-react-best-practices` | Writing React code                                                                                          |
| `vercel-composition-patterns` | Shaping reusable React components                                                                           |
| `web-design-guidelines`       | UI review. Source: <https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md> |

If the environment auto-discovers `SKILL.md` files, read the relevant one before
writing UI code.

### Required Competencies

1. Strict TypeScript and Vite, including WASM asset handling and dev-server
   COOP/COEP headers.
2. deck.gl and WebGL: `OrthographicView`, `ScatterplotLayer`, `PolygonLayer`,
   custom layers, `updateTriggers`, and picking.
3. DuckDB SQL over HTTP: predicate pushdown, Parquet row-group statistics, the
   `spatial` extension (`ST_Within`, `ST_Point`, `ST_GeomFromText`), and
   duckdb-wasm specifics (web filesystem, `enable_http_metadata_cache`).
4. Columnar and array formats: Parquet internals, Zarr (chunking, CSC/CSR
   sparse layouts, `.zarr.zip` over Range), and the 10x HDF5 feature-barcode
   matrix.
5. Bioimage formats: OME-TIFF (IFD/SubIFD pyramids, `TileOffsets`,
   `TileByteCounts`, OME-XML) and 16-bit JPEG-2000.
6. Web Workers and performance: worker pools, transferables, `AbortController`,
   persistent caches, LRU eviction, and memory budgets.
7. Spatial-omics domain knowledge: Xenium, Visium HD, and AnnData output
   contracts; microns vs pixels; cells vs spots vs bins; QV filtering; genes vs
   control probes; clustering and UMAP outputs.
8. Testing: Vitest, Playwright, and golden-data fixtures.

---

## 3. Status At A Glance

| Track                           | Scope                                                    | Status                                                  |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Phase 1                         | Foundation and migration                                 | Done                                                    |
| Phase 2                         | Robust I/O, caching, S3 hardening                        | Done; image-path fallback **Reopened**                  |
| Phase 3                         | Multi-channel imaging                                    | Done. JPEG XR **Dropped**; Z-stack **Deferred**         |
| Analysis slice (before Phase 4) | Gene selection, expression highlighting, cell info       | Done                                                    |
| Phase 4                         | Genes, gene sets, annotations, ROI, embeddings, HDF5     | Done; expression LOD redesigned in November             |
| Phase 5                         | Production polish                                        | Done; Magic Lens QV and Xenium diagnostics **Reopened** |
| Feature-fix pass                | Correctness before optimization                          | Ongoing; individual fixes recorded                      |
| Optimization pass               | Interaction, memory, fetch/decode concurrency, rendering | Open. November rendering and expression work done       |
| Phase 5.1                       | Transcript visualization with LOD                        | Done                                                    |
| Phase 6                         | Visium HD                                                | MVP done; low-res fallback and diagnostics **Reopened** |
| Structural refactor             | 14 recommendations from `OPTIMIZATIONS.md`               | All closed by 2026-06-28                                |
| Phase 7                         | AnnData H5AD                                             | MVP done; hardening open; metadata tracks **Reopened**  |
| Phase 8                         | Image-only viewer and GeoJSON annotations                | Done (2026-07-09)                                       |
| Phase 9                         | OME-Zarr image pyramids                                  | Done (2026-07-10)                                       |
| Phase 10                        | SpatialData stores                                       | Done (2026-11-06)                                       |
| Phase 11                        | Dataset manifest (`explorer.json`)                       | Done (2026-11-09)                                       |
| Visium spots                    | Original Phase 6 `VisiumDataset`                         | Not started                                             |

---

## 4. Architecture Decisions

### 4.1 React And TypeScript — DECISION: Yes

The POC's global state was already strained. React components and a small store
keep the growing UI manageable, and TypeScript catches the bugs that matter
here. deck.gl does not depend on a framework, so keep the imperative deck.gl and
canvas core and wrap only the chrome (panels and controls) in React.
TypeScript and modules are non-negotiable; React is the recommended default.

### 4.2 State — DECISION: Zustand, Kept Small

- **Original:** Zustand, because it is small and can be used outside React, so
  the deck.gl loop can share the store. Heavy data stays out of it.
- **Amended (2026-06-07):** the existing viewer store stays the only Zustand
  boundary. Feature state stays in React. Domain state is grouped into bundles
  by `useAppDomainState` (refactor item 1, closed 2026-06-27).

### 4.3 Parquet Engine — DECISION: DuckDB-WASM Primary, hyparquet For First Paint

- DuckDB-WASM is needed for `ST_Within` polygons, bounding-box predicates with
  row-group skipping, and joins. It costs about 40 MB of WASM and seconds of
  start-up time.
- hyparquet (about 10 KB, with `hyparquet-compressors` for ZSTD) reads
  `cells.parquet` centroids for a fast first paint. DuckDB is imported
  dynamically, only when a query needs it.
- If hyparquet cannot decode the `cells.parquet` page encoding, the overview
  falls back to DuckDB.
- Use the non-threaded MVP/EH DuckDB bundles. The cross-origin-isolated pthread
  bundle failed to load the `spatial` and `parquet` extensions because of a
  shared-memory mismatch.
- Run `SET enable_http_metadata_cache=true` at boot. Without it, the Parquet
  footer and a `HEAD` request are fetched again for every query.
- **`httpfs` — Superseded.** The original brief said `LOAD httpfs` was
  redundant in duckdb-wasm. Phase 5.1 changed this: load `httpfs` during
  bootstrap before remote Parquet reads, and continue if loading fails on older
  bundles. On DuckDB v1.5.1 this read 100 remote transcript rows in about 1.2 s.
  `LOAD spatial` is still required.
- Range-read `cell_boundaries.parquet` and `transcripts.parquet` with the
  bounding-box pattern. Buffer only small files such as `cells.parquet`.
- Use separate DuckDB clients for transcript scans and interactive cell or ROI
  queries, so a busy scan cannot block them.
- Keep row groups reasonably sized in any data you control, so bounding-box
  pruning fetches few chunks.
- Not recorded as done: evaluating DuckDB's ExternalFileCache.

### 4.4 Image Layer — DECISION: Custom JPEG-2000 Path; Canvas2D Compositing

- Keep the custom JPEG-2000 tile pipeline for 16-bit Xenium morphology.
- **Viv `XRLayer` — Superseded.** The brief planned Viv for multi-channel
  blending. Phase 3 implemented compositing in the existing Canvas2D underlay
  instead: one TIFF loader and cache per channel, tinted tiles, and additive
  compositing. This avoided a renderer architecture change.
- **JPEG XR — Dropped** by the user on 2026-06-07.
- LZW and uncompressed custom image layers decode through geotiff.js. The common
  no-predictor LZW path decodes into a preallocated buffer.

### 4.5 Rendering — DECISION: Two Canvases, Decode Off The Main Thread

deck.gl (orthographic) draws points, polygons, grids, and transcripts. A
Canvas2D underlay draws image tiles. Image decode runs in a worker pool and
returns transferables. The main thread schedules and draws. This was the single
biggest UX improvement over the POC.

Later additions:

- **Zarr decode workers (Phase 10, `92defed`).** OME-Zarr image chunks are
  decoded and converted to RGBA in a pool of up to three module workers
  (`zarrDecodePool.ts`). Each chunk is routed to one worker, which keeps it for
  all of its virtual tiles. SpatialData label chunks are traced into outlines in
  the same workers. Chunk bytes are still fetched on the main thread so store
  errors behave the same, and decoding falls back to the main thread if a worker
  fails.
- **GPU-resident overview (`bf6ebc8`).** Every overview cell is uploaded once as
  packed arrays. The GPU draws a fixed-rank sample capped by the performance
  budget (75k / 150k / 250k), hides outlined cells with a GPU filter, and
  styles the hovered cell on demand. Panning no longer filters, re-samples, or
  restyles cells on the CPU. Viewport counts come from a bucket index.
- **Instanced Visium HD bins (`bf6ebc8`).** One shared bin shape per bin size is
  uploaded once and instanced per bin, instead of re-tessellating visible
  polygons on every pan. Grids over 1M bins (2 µm) are clipped to a snapped box
  that moves every half view.
- **Tile scheduling (`bf6ebc8`).** When the view moves, morphology tiles still in
  view keep loading; only tiles that left the view are cancelled.

### 4.6 Data-Source Abstraction — Capability-Based

Do not assume every dataset has every modality. The interface exposes
capabilities and tags geometry. It does not hardcode a platform.

Original interface:

```ts
type Platform = 'xenium' | 'visium' | 'visium-hd'
type ElementGeometry =
  | { kind: 'polygon'; rings: number[][][] } // Xenium cells
  | { kind: 'circle'; center: [number, number]; diameter: number } // Visium spots
  | { kind: 'square'; origin: [number, number]; size: number } // Visium HD bins

interface DatasetMeta {
  platform: Platform
  units: UnitsDescriptor // µm + origin (Xenium) | px + scalefactors (Visium)
  extent: BBox
  capabilities: {
    transcripts: boolean
    cellBoundaries: boolean
    pyramidImage: boolean
    multiChannel: boolean
  }
  channels?: ChannelInfo[]
}

interface SpatialDataset {
  meta(): Promise<DatasetMeta>
  elements(bbox: BBox): Promise<ElementBatch> // geometry-tagged: cell | spot | bin
  matrix(ids: string[]): Promise<GexResult> // feature-barcode matrix
  annotations(): Promise<Annotation[]> // clusters, UMAP, custom labels
  image(): Promise<ImageSource | null> // pyramid | flat + scalefactor
  // Capability-gated. Absent on Visium.
  transcripts?(sel: Selection, scope: TranscriptScope, minQv: number): Promise<GexResult>
}

type ImageSource =
  | { kind: 'pyramid'; loader: TiffPyramidLoader }
  | { kind: 'flat'; url: string; scaleFactor: number; size: [number, number] }
```

Rules:

- The renderer picks the layer from the geometry `elements()` returns, not from
  the platform.
- The image component branches on `ImageSource.kind`.
- `transcripts` is optional. Gate transcript UI on `capabilities.transcripts`.
- `coords.ts` reads `meta().units`. No platform conditionals elsewhere.

Amendments made in later phases:

- **Generic element IDs (Phase 6).** The interface became
  `SpatialDataset<ElementId>`, with `SpatialElementId` and
  `GexResult<ElementId>`. Xenium is typed `SpatialDataset<CellId>`.
- **Affine grid instead of `square` (Phase 6).** Visium HD bins are an indexed
  affine grid (`SpatialGrid`/`SpatialGridBasis`), not per-bin polygons and not
  axis-aligned squares. Grid payloads are columnar (`GridCellBatch`: `Int32Array`
  rows and columns with one interned `gridId`). A logical `grid-cell`
  `ElementGeometry` is rebuilt only for picking, tooltips, and selection. See
  [Phase 6 product decisions](#product-decisions-1) for the invariants.
- **Segmentation descriptors (Phase 6).** `DatasetMeta` has optional
  segmentation descriptors: cell or nucleus, GeoJSON or TIFF, path, label, and
  annotation metadata.
- **New platforms.** `h5ad` (Phase 7), `image` (Phase 8), and `spatialdata`
  (Phase 10). The union is now `'xenium' | 'visium' | 'visium-hd' | 'h5ad' |
'spatialdata' | 'image'`; `'visium'` has no implementation.
- **SpatialData reuses AnnData (Phase 10).** `SpatialDataDataset` reads its table
  through `AnnDataH5adDataset` over a Zarr source, so H5AD and SpatialData share
  obs, var, `X`, and `obsm` handling.
- **Shared image pyramid interface (Phase 9).** TIFF and OME-Zarr loaders both
  implement `ImagePyramidLoader` (`src/data/imagePyramid.ts`); `openImagePyramid`
  picks the loader from the URL.
- **Geometric annotations (Phase 8).** GeoJSON shapes are a separate model
  (`geometricAnnotationModel.ts`), not cell-ID annotations.
- **Detection.** A dataset factory resolves a `SpatialDataset` from a URL. It
  accepts both directory roots and direct file URLs. Current order: `.h5ad` URL,
  Zarr-looking URL (SpatialData or OME-Zarr), TIFF/NDPI URL,
  `experiment.xenium`, root Zarr metadata, then Visium HD tiers. Every probe is
  a `HEAD` with a 15 s timeout, so hosts must allow `HEAD`.
- **Platform adapter (refactor).** App-level platform branching is centralized
  in `platformAdapter.ts`.
- **Naming (refactor).** The shared expression contract uses `elements`, not
  `cells`, because Visium HD bins flow through it (2026-06-28).
- **Flat images (Phase 6).** `ImageSource.kind === 'flat'` is implemented for
  Visium HD PNGs. Image dimensions are optional; the browser image's natural
  size is the fallback.

### 4.7 Transcript Source

- **Original — Superseded in part:** drop `transcripts.zarr.zip` because
  `transcripts.parquet` has `cell_id` and the Zarr does not. The POC's
  `gexFromTranscriptsZarr` per-cell path stays deleted.
- **Phase 5.1:** `transcripts.zarr.zip` is the native level-of-detail source.
  Its `/grids` pyramid drives density squares, and its level-0 grid tiles drive
  exact points. `transcripts.parquet` is the source of truth for per-transcript
  `cell_id`, `overlaps_nucleus`, `nucleus_distance`, `is_gene`, FOV, QV, and
  coordinates. It is also the exact-point fallback when the Zarr is missing.
- Per-cell expression highlighting uses the cell-feature matrix, never
  `transcripts.parquet`.

### 4.8 Cell-Feature Matrix

- Prefer native CSC Zarr (`cell_features/csc/{indptr,indices,data}`, XOA 3.1
  and later).
- Support the older feature-major arrays (`cell_features/{indptr,indices,data}`)
  for selected-gene reads.
- For ROI gene statistics and selected-cell profiles on older output, fall back
  to `cell_feature_matrix.h5` through h5wasm.
- Do not look for or generate cell-major Zarr sidecars.
- **jsfive — Deferred.** Add it only if a real H5-only dataset fails in h5wasm
  but works in jsfive.

### 4.9 Cell Boundaries

- Range-read through DuckDB. Order vertices by `file_row_number`. Fetch
  vertices with at least a 150 µm margin around the viewport, and expand the
  candidate centroid window by 75 µm so partly visible edge cells are kept.
- Do not add a client-side simplified-boundary mode (fewer than 5 points). It
  would still fetch every vertex. Revisit only if a precomputed simplified
  geometry pyramid is added.
- Do not draw centroid-generated pseudo-boundaries. The hexagon layer was
  removed.
- **Current load rule (2026-11).** Boundaries load when zoom is −0.25 or closer,
  or when fewer visible cells than `Boundary limit` are in view. The limit is
  1–100,000, defaulting to 2,500 on compact devices and 50,000 otherwise.
  Requests are keyed by the bounding box rounded to 50 µm.
- **SpatialData outlines (Phase 10).** Label outlines are traced only for cells
  overlapping the requested area, cached per label while their chunks stay
  loaded, and simplified with Douglas–Peucker at 0.25 label pixels. Requests
  cover the viewport plus up to 25% per side, and no new request is made while
  the padded area still covers the view at a similar zoom.

### 4.10 Zarr Store Access (Phases 9–10)

- Object stores that deny listing answer `403` for missing keys. Treat `403` as
  missing **only** for metadata keys (`.zarray`, `.zgroup`, `.zattrs`,
  `.zmetadata`, `zmetadata`, `zarr.json`); chunk `403`s stay errors
  (`9c0d221`).
- SpatialData requires consolidated metadata (`zarr.json` v3,
  `zmetadata`/`.zmetadata` v2), because the browser cannot list prefixes. OME-Zarr
  images use it when present.
- Non-range chunk reads go through a 256 MiB LRU per SpatialData store. Decoded
  OME-Zarr chunks share a separate 256 MiB cache.
- Absent chunks read as fill values, so an interrupted upload loads silently with
  empty data. Diagnostics therefore send a `HEAD` for every table chunk, and
  missing string chunks fail fast.

### 4.11 Units For Stores Without Declared Scale (Phase 10)

SpatialData coordinates are converted to micrometres by a factor per coordinate
system: a user override (`µm per unit`), else the declared axis unit, else an
estimate (`cell_area` against segmentation area, the Visium 100 µm spot pitch,
or Visium HD `square_NNNum` bin names). If none applies, the factor is 1 and the
scale bar, measurements, and coordinate readout say "units" instead of µm.
H5AD `obsm` values are used directly as micrometres.

---

## 5. Data Contracts

### 5.1 Xenium Output (Read As-Is; Never Require Preprocessing)

Reference: 10x "Understanding Xenium Outputs".

| File                                             | Reader             | Use                                                                                                  |
| ------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `experiment.xenium`                              | fetch JSON         | Panel, chemistry, pixel size (0.2125 µm), software version, and the file manifest (morphology paths) |
| `cells.parquet`                                  | hyparquet, DuckDB  | Centroids, `cell_area`, `nucleus_area`, `transcript_counts`, `file_row_number`                       |
| `cell_boundaries.parquet`                        | DuckDB (Range)     | Polygon vertices per `cell_id`                                                                       |
| `nucleus_boundaries.parquet`                     | DuckDB             | Optional nucleus overlay (no implementation recorded)                                                |
| `transcripts.parquet`                            | DuckDB (Range)     | Per-transcript `cell_id`, `feature_name`, x/y/z, `qv`, `overlaps_nucleus`, `is_gene`                 |
| `transcripts.zarr.zip`                           | zarrita            | Native transcript LOD: `/grids` pyramid and level-0 tiles; `/density/gene` (not used by the UI)      |
| `cell_feature_matrix.zarr.zip`                   | zarrita            | Per-cell sparse counts (CSC or feature-major)                                                        |
| `cell_feature_matrix.h5`                         | h5wasm             | Same matrix; fallback                                                                                |
| `analysis.zarr.zip`                              | zarrita            | Clustering                                                                                           |
| `analysis/{umap,tsne}/…/projection.csv`          | fetch CSV          | UMAP / t-SNE                                                                                         |
| `gene_panel.json`                                | fetch JSON         | Full gene list, so genes can be picked before any selection                                          |
| `morphology_focus/morphology_focus_000N.ome.tif` | geotiff + OpenJPEG | Multi-channel focus images                                                                           |
| `morphology_mip.ome.tif` / `morphology.ome.tif`  | geotiff + OpenJPEG | DAPI MIP / Z-stack (Z-stack selector deferred)                                                       |
| `.zchunkstore`                                   | fetch JSON         | Precomputed TIFF tile byte ranges                                                                    |
| `metrics_summary.csv`                            | papaparse          | QC display (no implementation recorded)                                                              |

Rules to encode once:

- **Coordinates.** Micrometres, origin top-left, Y down (px = µm / 0.2125).
  deck.gl `OrthographicView` with `flipY: false` is Y-up, so Y is negated. All
  conversions live in `coords.ts`.
- **Cell IDs.** Parquet uses a shifted-hex string; the matrix Zarr uses a
  `[prefix, suffix]` uint32 pair. The codec must round-trip, tested against a
  real pair.
- **Scope.** `cells-only` and `spatial` transcript scopes differ by design
  (extracellular transcripts). Keep both and label them clearly.
- **Features.** Exclude `NegControlProbe`, `NegControlCodeword`, `BLANK`,
  `UnassignedCodeword`, `antisense`, and `Deprecated` from genes. Keep them for
  QC.
- **Sizes.** Buffer `cells.parquet`. Range-read `cell_boundaries.parquet` and
  `transcripts.parquet`.

Facts verified on the demo dataset:

- `morphology_mip.ome.tif` is missing; the loader uses
  `morphology_focus/morphology_focus_0000.ome.tif`, which has 9 pyramid levels.
- OME-XML channels: DAPI, ATP1A1/CD45/E-Cadherin, 18S, and alphaSMA/Vimentin.
- `cells.parquet` is ZSTD-compressed.
- The cell-feature matrix may expose only feature-major arrays, without the
  `csc` group.
- Level-0 `transcripts.zarr.zip` tiles expose location, gene/codeword identity,
  ID, quality score, validity/status, UUID, and gene offsets. They have no
  per-transcript cell assignment. There is no `/density/codeword` group.
- A cold Zarr read for even one cell can take about 20 s, because the cost is
  opening the feature-matrix path, not the sample size.
- `cells.zarr.zip` and `cell_feature_matrix.*` cannot give per-transcript cell
  assignment.

### 5.2 Visium HD Output (Space Ranger `outs/`)

10x references:

- [Understanding Space Ranger outputs](https://www.10xgenomics.com/support/software/space-ranger/latest/analysis/outputs/output-overview)
- [Segmented outputs](https://www.10xgenomics.com/support/software/space-ranger/latest/analysis/outputs/segmented-outputs)
- [Feature Slice H5](https://www.10xgenomics.com/support/software/space-ranger/latest/analysis/outputs/space-ranger-feature-slice-h5)

The binned `filtered_feature_bc_matrix.h5` is a standard matrix output, but
interactive selected-gene overlays should use `feature_slice.h5`. 10x documents
it as the Visium HD path for fast single- or multi-gene 2 µm slices that can be
binned to 8 or 16 µm.

Facts probed on the reference dataset:

| Item                                                 | Value                                                                                                                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top-level entries                                    | `binned_outputs/`, `segmented_outputs/`, `spatial/`, `barcode_mappings.parquet`, `feature_slice.h5`, `metrics_summary.csv`, `molecule_info.h5`, `probe_set.csv`, `web_summary.html` |
| `tissue_positions.parquet` size (16 / 8 / 2 µm)      | 3.3 MB / 11.3 MB / 171.2 MB; one row group each, so no row-group pruning                                                                                                            |
| Position schema                                      | `barcode`, `in_tissue`, `array_row`, `array_col`, `pxl_row_in_fullres`, `pxl_col_in_fullres`                                                                                        |
| `filtered_feature_bc_matrix.h5` size (16 / 8 / 2 µm) | 121.6 MB / 160.3 MB / 236.5 MB                                                                                                                                                      |
| Filtered barcodes (16 / 8 / 2 µm)                    | 54,504 / 215,320 / 3,443,936; 18,085 gene features                                                                                                                                  |
| `feature_slice.h5`                                   | 503.2 MB, Range-readable                                                                                                                                                            |
| `barcode_mappings.parquet`                           | 109.8 MB; 11,222,500 rows in 1,123 row groups; `square_002um`, `square_008um`, `square_016um`, `cell_id`, `in_nucleus`, `in_cell`                                                   |
| `molecule_info.h5`                                   | 989.0 MB                                                                                                                                                                            |
| Tissue images                                        | High-res 6000 × 5143 (37.6 MB); low-res 600 × 514 (230.7 KB)                                                                                                                        |
| Root `spatial/scalefactors_json.json`                | Returns 404. Use the binned or segmented scalefactors                                                                                                                               |
| Binned `scalefactors_json.json`                      | `microns_per_pixel = 0.22133875377751464`; `spot_diameter_fullres` 72.287 / 36.144 / 9.036 px                                                                                       |
| Segmented `scalefactors_json.json`                   | Same image scale fields; no `bin_size_um` or `spot_diameter_fullres`                                                                                                                |
| Missing scalefactor fields                           | This dataset omits `tissue_hires_image_width`/`height`                                                                                                                              |
| 16 µm array → full-res transform                     | Affine with a small residual: column step (row px +0.2023, col px −72.2784); row step (row px +72.2785, col px +0.2035)                                                             |

Matrix Market sidecars are larger than the H5 files, so they are not a usable
interactive fallback.

Segmented-output files named by Space Ranger 4.1: `cell_segmentations.geojson`,
`nucleus_segmentations.geojson`, `nucleus_instance_mask.tiff`,
`graphclust_annotated_cell_segmentations.geojson`,
`graphclust_annotated_nucleus_segmentations.geojson`, and the feature-cell
matrices.

### 5.3 AnnData H5AD

- `/obs`: cell IDs and observations. Categorical and string columns are
  annotation tracks. Numeric columns are parsed as continuous tracks and shown
  as Cell Info values (not yet as colour tracks; see Phase 7). Category sidecars
  such as `/obs/__categories/leiden` are supported. Boolean columns load as 0/1
  with h5wasm but are expected to fail on the reference backend.
- `/var`: gene names.
- `/X`: expression, `n_obs × n_vars`. Dense, CSR, or CSC.
- `/obsm`: coordinates. The first present key of `X_spatial`, `spatial`,
  `X_umap`, `umap`, `X_tsne`, `X_tSNE`, `tsne`, `X_pca` is used, as
  micrometres. Fail with a schema error if none is usable or a value is not
  finite. Every valid numeric 2D `obsm` matrix is offered as an embedding.
- Duplicate or missing obs/var names are normalized deterministically.
- **Size gate.** Files up to 300 MiB (314,572,800 bytes) are downloaded whole
  and opened with h5wasm. Larger files need a sibling `DATASET.h5ad.json`
  reference generated by `SingleHdf5ToZarr`, read with the Zarrita
  `ReferenceStore`, so `/X` data and indices stay lazy. The H5AD URL's query
  string is carried to the reference URL, so presigned URLs need a matching
  presigned reference.
- Planned, not done: `/layers/*` and `/raw/X` as selectable expression sources.

### 5.4 Image-Only Sources (Phase 8)

- Direct `.ome.tif`, `.ome.tiff`, `.tif`, and `.tiff` URLs, plus `.ndpi`
  through the same TIFF loader (no NDPI-specific code).
- TIFFs must be tiled, with pyramid levels as `SubIFDs` of the base image, and
  8- or 16-bit samples with 1, 3, or 4 samples per pixel. Stripped TIFFs and
  top-level-IFD pyramids are not indexed; most NDPI files fall in these cases
  and should be converted to pyramidal OME-TIFF.
- µm/px comes from OME-XML `PhysicalSizeX` (default 0.2125). `Channel@Color` is
  a signed 32-bit RGBA integer with red in the high byte (`3e1a8d5`).
- Extent is image dimensions × microns per pixel.
- Codecs: JPEG 2000 through OpenJPEG; uncompressed and no-predictor LZW built
  in; everything else (LZW with predictor, JPEG, Deflate, PackBits, LERC, Zstd,
  WebP) through geotiff.js decoders. Planar (separate-plane) tiles are supported
  (`0d67e06`).

### 5.5 OME-Zarr Images (Phase 9)

- Zarr v2 or v3; `multiscales[0]` from `attrs.ome` (OME-Zarr 0.5) or `attrs`.
  `x` and `y` axes are required; only `t = 0` and `z = 0` are shown.
- µm/px is the product of multiscale and dataset `scale` values for `x`, with
  unit conversion; a missing scale gives 1 µm/px.
- `omero.channels` gives names, colours, and windows. Three channels with no
  omero data, or labelled or coloured red, green, and blue, are native RGB.
- Tile size is the x/y chunk shape; chunks over 512 px are served as virtual
  tiles that share one decoded chunk.

### 5.6 SpatialData Stores (Phase 10)

- The root is SpatialData when `spatialdata_attrs` is present and none of
  `coordinateTransformations`, `encoding-type`, `multiscales`, or `ome` is (so a
  URL to `…/images/<name>` opens as a plain OME-Zarr image).
- Consolidated metadata is required.
- Elements are `<kind>/<name>` groups under `images`, `labels`, `points`,
  `shapes`, and `tables`. Supported transforms: `identity`, `scale`,
  `translation`, `affine`, `mapAxis` (x/y swaps), and `sequence`.
- One table is shown: the first annotating a shapes element, else a labels
  element, else the first table. `region`, `region_key`, and `instance_key` come
  from `spatialdata_attrs`.
- One coordinate system is shown: ranked by table regions placed in it, then
  whether it holds an image, then element count, then the name `global`.
- One image is shown: axis-aligned, positive-scale, highest resolution.
- Shapes: `shapes.parquet` (GeoParquet or WKB; Point, Polygon, MultiPolygon).
  Points become circles from the `radius` column. MultiPolygons keep their
  largest polygon.
- Labels: rows are placed from `obsm` through the labels transform, and cell
  outlines are traced from the label raster on demand.
- Not read: `points` (transcripts), extra images, and extra tables.

### 5.7 Dataset Manifest (Phase 11)

- Optional `explorer.json` in the dataset folder, or any `.json` URL entered
  directly (except Zarr `zarr.json`). Full reference:
  [`docs/dataset-manifest.md`](./docs/dataset-manifest.md); schema:
  [`public/schemas/explorer-manifest.v1.json`](./public/schemas/explorer-manifest.v1.json).
- Required: `version: 1` and `platform`. Optional: `name`, `description`,
  `root`, `files`, `options`, `defaults`.
- `files` maps each standard file to another relative path or http(s) URL;
  files left out keep their standard names. H5AD, SpatialData, and image
  manifests must name their one source file.
- `options`: Visium HD `binSize`; SpatialData `coordinateSystem`, `image`,
  `micrometersPerUnit`.
- `defaults`: genes, cell colour, gene scale and score, boundary toggles, image
  channels, three opacities, and the transcript overlay. A shared link's own
  fields take precedence.
- Validation is strict: unknown fields and wrong types are errors. A probed
  file that is missing, not JSON, or has neither `platform` nor `version` means
  no manifest.

---

## 6. Phase Records

### Phase 1 — Foundation And Migration

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
  threshold is met. See [4.9](#49-cell-boundaries) for margins and ordering.
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

### Phase 2 — Robust I/O, Caching, S3 Hardening

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
  **Reopened (2026-11-08):** only the first candidate path is tried; there is no
  fallback to the next one if it fails (`morphologyImage.ts`).
- Structured errors carry source, code, title, message, action, and optional
  detail.
- `cells.parquet` decode failures name the columns, URL, and likely encoding
  problem, then fall back to DuckDB.

Definition of done: a multi-GB dataset loads from a real S3 bucket; the second
visit is warm; the app degrades gracefully on a flaky network; boundaries are
never fully downloaded.

### Phase 3 — Imaging: Multi-Channel

- [x] Parse the multi-file `morphology_focus_000N.ome.tif` channel set from
      OME-XML, with per-channel name, colour, and contrast.
- [x] Multi-channel compositing with per-channel colour, min/max, and on/off
      (Canvas2D; see [4.4](#44-image-layer--decision-custom-jpeg-2000-path-canvas2d-compositing)).
- [x] **Dropped** by the user: JPEG XR decoder (WASM).
- [ ] **Deferred** by the user: Z-stack plane selector for `morphology.ome.tif`.
- [x] Per-channel histogram and auto-contrast.

Notes:

- Channel metadata: ID, index, name, focus-file name, purpose, RGB colour, and a
  default contrast range from the OME pixel type.
- Auto-contrast samples the coarsest pyramid level, crops padded edge tiles,
  computes robust percentiles, and draws a histogram from the same samples. It
  runs automatically when an image finishes loading; the `Auto` buttons rerun it.
- Grayscale intensity drives both channel colour and alpha, so enabled channels
  do not fill tiles with solid colour.

Definition of done: DAPI, boundary, and interior stains composited with
independent controls.

### Analysis Slice (Pulled Ahead Of Phase 4 By The User)

- [x] Gene selection from `gene_panel.json`, without loading matrices until a
      workflow needs them.
- [x] Gene-expression highlighting.
- [x] Colour cells by observations (`transcript_counts`, `cell_area`,
      `nucleus_area`, and later imported labels).
- [x] Cell information: metadata, observations, and selected-gene expression.

Notes:

- Expression reads `cell_feature_matrix.zarr.zip` through
  `XeniumDataset.matrix()` after collecting viewport cell IDs from
  `cells.parquet`. At first it was capped at 5,000 visible cells.
- `Cell fill opacity` and `Cell boundary opacity` are separate. Zero fill keeps
  transparent polygons pickable.
- Changing the colour scale restyles loaded counts without refetching.

### Phase 4 — Genes, Gene Sets, Annotations

- [x] Gene picker backed by the full `gene_panel.json`.
- [x] Whole-slide expression colouring with level of detail.
- [x] Gene sets: paste symbol lists; score by sum, mean, or z-score; colour by
      score; save named sets.
- [x] Annotation import from `analysis.zarr.zip`, CSV, and JSON.
- [x] ROI: box and lasso drawing, ROI cell lookup, summaries, save as
      annotation, cell CSV export, ROI gene stats, transcript CSV export, and
      exact polygon-aware lasso selection.
- [x] UMAP/t-SNE panel linked to spatial selection.
- [x] HDF5 path for `cell_feature_matrix.h5`.

Notes on genes and expression:

- Gene sets accept comma, whitespace, or semicolon lists, matched
  case-insensitively. Saved sets can be removed. Changing the score mode does
  not refetch.
- `Auto LOD`: a stable whole-slide sample at overview zoom, padded viewport
  samples at medium zoom, and exact counts below 5,000 visible cells.
  `Exact region` loads exact counts for up to 50,000 visible cells and shows a
  waiting state above that instead of silently sampling. Low-zoom bins use fixed
  data-space centres so marks do not drift. Request keys use quantized view
  state, padded bounding boxes, and deterministic row strides. The expression
  overlay is not pickable, to keep panning cheap. A true all-cell whole-slide
  matrix scan was left as future work.
  **Superseded (November 2026):** see
  [Expression and rendering rework](#expression-and-rendering-rework-november-2026).
- Feature-major `cell_features/{indptr,indices,data}` matrices are supported.
- Expression fills visible boundary polygons when IDs match, and falls back to
  points otherwise.
- The colour scale uses a stable maximum per gene set across loaded regions,
  with numeric ticks. Plasma (default), Cividis, Teal, Rose, and Glasbey were
  added.

Notes on annotations:

- Built-in clusters come from `analysis.zarr.zip`. Cluster CSR arrays are mapped
  to cell IDs through the matrix row order.
- The `Annotation set` selector offers `All` plus the groups found in the
  dataset (for example `graphclust`, `kmeans 3`, `kmeans 9`), and loads only the
  chosen group.
- Local CSV (`cell_id,label`) and JSON files import into the same list.
- Each label gets a deterministic colour, an editable swatch, and remove and
  clear-all actions. `Cell color` gains an `Annotations` mode.
- Overview loads keep true cell IDs, and boundary polygons inherit annotation
  colours.

Notes on ROI and embeddings:

- ROI cells come from `cells.parquet`; lasso uses DuckDB `ST_Within`.
- ROI gene stats show the top 10 genes by total count, with detected-cell
  percentage and mean per cell. Large ROIs are sampled.
- A fallback to `transcripts.parquet` aggregation was added for ROI gene stats.
  The feature-fix pass later reconfirmed CSC Zarr → H5 as the strategy.
- `Export Transcripts` Range-checks `transcripts.parquet` and downloads QV-filtered
  rows (cell ID, feature, x/y/z, QV, nucleus overlap, gene flag), using the
  same polygon test as the lasso.
- The embedding panel loads projection CSVs, samples large projections,
  highlights the ROI and selected cell, and selects a cell on click.
- An HDF5 test builds a tiny feature matrix with h5wasm and reads it through
  `gexFromCellFeatureMatrixH5`.

Notes on the viewer:

- CPU-side overview aggregation is off. All viewport-clipped centroids render as
  low-alpha hollow points. At low zoom the full centroid array is reused instead
  of being re-filtered.
- The idle background is solid black with the grid only; the empty state reads
  "Please load a dataset".
- The desktop control rail scrolls independently.
- The E2E smoke test checks the current shell (`Hide Controls`, the `Dataset`
  tab, URL, and load button).

Definition of done: pick a marker panel, score a signature, import cell-type
labels, and export an ROI's expression, all client-side. Verified with build,
tests, typecheck, lint, and E2E.

### Phase 5 — Production Polish

- [x] Shareable state in the URL hash: dataset URL, active tab, viewport,
      selected genes, ROI, gene scale/score/detail, cell colour mode, coordinate
      unit, morphology toggle, and boundary limit. Shared genes and ROI survive
      the first matching dataset load. (Phase 5.1 added transcript fields.)
- [x] Adaptive performance budget: compact, balanced, or expanded profiles that
      set overview point caps, default boundary limits, tile request
      concurrency, tile-cache size, and telemetry retention.
- [x] Accessibility and keyboard navigation: focusable view, arrow-key pan,
      Shift for coarse pan, `+`/`-` zoom, `Home` reset, `aria-keyshortcuts`, and
      a visible focus outline.
- [x] React error boundary, dataset diagnostics (manifest plus required and
      optional byte-range assets), and a downloadable JSON dump (controls,
      errors, telemetry, diagnostics, budget).
- [ ] **Reopened (2026-11-08):** Xenium diagnostics check a hard-coded
      `morphology.ome.tif` instead of the manifest's image, and skip
      `analysis.zarr.zip`, `gene_panel.json`, the H5 matrix, and embedding CSVs.
      The dump is always named `xenium-diagnostics.json`.
- [x] Privacy-respecting local telemetry (loads, diagnostics, tile-cache
      evictions), kept in memory and exported only through the dump.
- [x] Docs: `docs/user-guide.md`, `docs/host-your-own-data.md`, and the root
      `README.md`.
- [x] Magic Lens, ported from the POC: cursor, viewport, and ROI scopes; radius
      and QV controls; debounced scans; an in-view HUD.
- [ ] **Reopened (2026-11-08):** the lens `Min QV` is part of the query key but
      is not passed to the readers, so it does not change results. (Since the
      feature-fix pass, lens totals come from cell `transcript_counts`, which
      have no QV.)

### Feature-Fix Pass (After Phase 5)

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

### Optimization Pass

- [ ] Tune interaction performance, memory pressure, fetch/decode concurrency,
      and rendering cost without changing product behaviour.

Work recorded so far: vendor chunk groups (React, deck.gl, DuckDB-WASM, spatial
I/O, codecs) cut the entry chunk from about 1.26 MB to about 427 kB; heavy
readers are lazy-loaded; and the structural refactor in
[section 7](#7-application-structure-and-refactor-record) is complete.

#### Expression And Rendering Rework (November 2026)

Recorded from commits. This changed expression behaviour on purpose: sampling
had hidden rare marker cells.

- [x] `Auto LOD` loads every cell, like the new `All cells` mode, for datasets of
      up to 500,000 cells. Larger datasets: whole-slide sample when zoom ≤ −1.25
      or more than 100,000 cells are visible, exact viewport at ≤ 50,000
      visible, padded-viewport sample otherwise (`8d21186`).
- [x] Samples keep every expressing cell and thin only cells without
      expression. Native Xenium returns only expressing cells, so its cell query
      no longer filters by a cell-ID hash. `Exact region` above 50,000 cells
      samples the same way instead of waiting (`af73e5d`).
- [x] Dense Zarr matrices read selected genes by column for large requests, so
      each row chunk is read once (`af73e5d`).
- [x] Native Xenium above 500,000 cells reads the selected genes' expressing
      rows from the feature-major matrix and joins them to the cells in view by
      row (up to 32 genes). Row alignment between `cells.parquet` and the matrix
      is checked once per dataset, with a fallback to per-cell reads. SNAP25 on
      a 1.4M-cell slide went from 20.8 s to 2.1 s cold (`bf6ebc8`).
- [x] The expression overlay is computed once per gene and draws every cell
      scoring above zero at every zoom, highest scores on top. The 220 µm
      low-zoom bins were removed because they averaged rare genes away (605 PAX8
      cells of 63,410 vanished on one slide) and drew dots off the tissue
      (`0ed880d`).
- [x] GPU-resident overview cells, instanced Visium HD bins, and in-view tile
      scheduling (see
      [4.5](#45-rendering--decision-two-canvases-decode-off-the-main-thread)).
      Cell-area colours now scale to the whole slide (`bf6ebc8`).
- [x] The expression status counts only cells with expression above zero as
      positive (`8d21186`).

### Phase 5.1 — Transcript Visualization

Goal: show individual transcript locations, group them when zoomed out, show
every visible transcript at the closest tier, and show details on hover. The
target is datasets with hundreds of millions of transcripts, so the overlay is a
windowed level-of-detail system, not one point layer over
`transcripts.parquet`.

#### Product Decisions

- [x] Transcripts are their own modality, with their own `Transcripts` tab
      between `Genes` and `Magic Lens`. `Layers` stays focused on image and
      cell opacity and channels.
- [x] Never scan or fetch raw transcript rows for low- or medium-zoom views.
- [x] **Detail modes** (2026-06-06): `Auto`, `Density`, `Exact`.
  - `Density` draws native `/grids` transcript-count squares, at most 1,500 in
    view, coloured against a global native count domain so colours stay stable
    while panning.
  - `Auto` shows Density until the visible estimate fits the exact budget, then
    exact records.
  - `Exact` draws every visible matching transcript. Feature filters apply here
    only. It never samples. Over budget, it shows a message instead of partial
    results. Near the budget, it waits for `Load exact viewport`.
- [x] Exact mode reads level-0 `/grids` tiles from `transcripts.zarr.zip` when
      the Zarr is Range-readable, and falls back to `transcripts.parquet`.
      Points are matched to Parquet rows by `(fov_name, transcript_id)` to add
      cell IDs.
- Current values (2026-11): `Exact budget` 1–1,000,000, default 100,000;
  `Load exact viewport` is required at 80% of the budget; the feature filter
  defaults to `Selected genes`; Parquet cell-ID enrichment has a 1.5 s deadline.
- [x] Without native LOD, the tab says so. All-feature views can show
      cell-summary transcript-count bins; otherwise the state is unavailable.
      The app never silently scans the raw file.
- [x] Grouping by `feature_name` and `fov_name` is for summaries and QC only.
      FOVs overlap and are too coarse for rendering.
- **Superseded:** selected-feature density from `/density/gene`, and 10x-style
  feature-circle glyphs (one per bin and gene, top 8 per bin). Both were removed
  from the user-facing modes on 2026-06-06.

#### Level-Of-Detail Options

| Option                                                   | Verdict                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| A. DuckDB `GROUP BY` over `transcripts.parquet` per view | Not pursued for low zoom unless the file is spatially sorted |
| B. Cell `transcript_counts` from `cells.parquet`         | Used only as a degraded fallback hint                        |
| C. Official `transcripts.zarr.zip` `/grids` and density  | **Chosen**                                                   |
| D. GPU screen aggregation of loaded raw points           | Not pursued; does not solve the fetch problem                |
| E. Server-side tiles or API                              | Out of scope; conflicts with the no-server data path         |

#### Data Architecture

- [x] Model types: `TranscriptPoint`, `TranscriptAggregateBin`,
      `TranscriptLodLevel`, `TranscriptViewportEstimate`,
      `TranscriptLayerState`.
- [x] Capability discovery separates "exact only" (Parquet) from "full LOD"
      (Zarr), keeping the boolean for compatibility.
- [x] Read Zarr metadata from root, `/density`, and `/grids` attributes: total
      count, FOV names, gene names, density grid size and origin, pyramid
      levels, grid keys, and per-grid counts.
- [x] Raw exact queries project only the columns needed for rendering and hover,
      with no `ORDER BY`.
- [x] A bounded viewport summary grouped by `feature_name` and `fov_name`.
- [x] Load `httpfs` at bootstrap (see [4.3](#43-parquet-engine--decision-duckdb-wasm-primary-hyparquet-for-first-paint)).
- [x] Decode Zarr coordinates with zarrita ndarray strides. Assuming row-major
      `[x,y,z]` caused horizontal banding.
- [x] Viewport-version cancellation, `AbortController`, a query queue, and a
      separate worker, so transcript work cannot block ROI export or Magic Lens.
- [x] The visible-count estimate uses `cells.parquet` transcript counts. Native
      Zarr counts are the next accuracy improvement.

#### Rendering

- [x] Transcript layers are separate deck.gl layers, so updates do not rebuild
      cell layers. The morphology path is unchanged.
- [x] Aggregate bins are anchored in data coordinates, so panning and zooming
      do not change bin membership.
- [x] Points are sized in screen pixels, with configurable size and opacity.
- [x] Exact points are pickable. Hover shows feature, cell ID (when present),
      x/y/z, QV, nucleus overlap, gene/control status, and transcript ID. The
      Cell row is omitted when there is no cell ID.
- [x] Aggregate hover shows counts, bin size, and whether data is exact or
      aggregated, without implying individual identity.

#### Transcripts Tab

- [x] Controls: `Show transcripts`, `Detail` (`Auto`, `Density`, `Exact`),
      `Min QV`, `Gene-only`, feature filter (all, selected, search), colour mode,
      opacity, point size, and aggregate scale.
- [x] Status: source (`Raw exact` or `Native Xenium LOD`), LOD tier, estimate,
      rendered count, exact eligibility, and last query time.
- [x] Hover tooltip; click or keyboard focus pins the item in the tab.
- [x] `Auto` refreshes after debounced viewport changes, with a loading state
      and cancellation.
- [x] The URL hash stores overlay on/off, detail, min QV, feature filter, colour
      mode, opacity, and point size, omitting defaults.
- [x] The diagnostics dump includes capabilities, native LOD availability, query
      timings, budget decisions, and the last hover or query errors.

#### Slices

- [x] 1. Capability and manifest detection, LOD planner, state types, tests,
     and the tab shell with unavailable states.
- [x] 2. Raw exact viewport query and exact points, with hover and budget status.
- [x] 3. Native Zarr reader, aggregate bins, and aggregate hover.
- [x] 4. Filters, QV, colour, opacity, point size, URL state, diagnostics, and
     loading indicators.
- [x] 5. Integration with Magic Lens, ROI transcript export, gene overlays,
     annotation colouring, and morphology channels.

#### Definition Of Done

- [x] Low and medium zoom never materialize raw rows; they use native LOD or
      show a clear fallback state.
- [x] The exact tier renders every visible matching transcript when within
      budget, with record-level hover.
- [x] Exact mode never samples silently. Over budget or timeout, the UI explains
      why and how to reach exact rendering.
- [x] Aggregate bins are stable across pans and LOD thresholds.
- [x] Transcript work is abortable and does not block ROI lookup, ROI export,
      Magic Lens, or selected-cell detail.
- [x] Unit tests cover LOD planning, query options, Zarr metadata parsing, layer
      data, hover copy, shareable state, and budget decisions.
- [x] E2E covers the tab shell and controls. Vitest integration tests cover
      aggregates, exact rendering, near-budget loading, and pinning.
- [x] Full verification passed.

### Phase 6 — Visium HD

The original brief's Phase 6 covered both standard Visium and Visium HD.

| Original Phase 6 task                                              | Outcome                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `VisiumHDDataset` implementing `SpatialDataset`                    | Done (`VisiumHdDataset`)                                    |
| `VisiumDataset` (spots, `tissue_positions.csv`, `circle` geometry) | Not started                                                 |
| `scalefactors_json.json` + tissue PNGs → `image()` as `flat`       | Done for Visium HD                                          |
| `filtered_feature_bc_matrix.h5` → `matrix()` via h5wasm            | Done, through a lazy-range worker                           |
| `analysis/` → `annotations()`                                      | Embeddings only; Visium HD cluster annotations not recorded |
| `capabilities.transcripts = false`, `pyramidImage = false`         | Done                                                        |
| Spot/square render layer                                           | Done as an affine grid layer                                |
| `binned_outputs/` resolution switcher (2/8/16 µm)                  | Done                                                        |

Original definition of done: a Visium dataset renders spots over its tissue
image with gene colouring, gene sets, annotations, and ROI export, reusing the
Xenium UI unchanged.

#### Product Decisions

- [x] A real `VisiumHdDataset`, not Visium branches inside `XeniumDataset`.
- [x] A dataset factory/detector. URL helpers and caches must stop assuming
      Xenium file names.
- [x] Bins, not cells, are the renderable unit. Barcodes are element IDs. Bin
      size is a dataset setting.
- [x] **Affine grid.** Bins are an indexed affine grid with a dataset-level
      basis (`origin`, `rowStep`, `colStep`). An axis-aligned square is just a
      special case.
- [x] **Columnar storage.** `ElementGeometry` is only for picking, tooltips, and
      selection. Grid tiers are stored as columns (`Int32Array` rows and
      columns, one interned `gridId`).
- [x] **Grid invariants.** `origin` is the centre of bin (0, 0). `rowStep` and
      `colStep` are centre-to-centre pitches in the same render space as
      polygons and images. `row`/`col` match Space Ranger `array_row`/
      `array_col`. Corners use the ±0.5 rule in array space. Occupancy is not
      part of the basis.
- [x] **Nominal vs measured.** `binSizeMicrometers` is the declared tier size
      for labels and logic. `rowStep`/`colStep` are the measured geometry. Small
      differences are expected.
- [x] **One basis.** Fit the finest reliable basis once and derive coarser tiers
      by integer scaling, so tiers nest exactly for `barcode_mappings.parquet`.
- [x] Start with 16 and 8 µm before Feature Slice and segmented outputs. Treat
      2 µm as a high-density mode with explicit handling.
- [x] Hide Xenium-only workflows: transcripts, raw transcript hover, Magic Lens
      transcript scans, Xenium cell boundaries, and `analysis.zarr.zip`
      annotations.
- [x] Use binned tissue PNGs and `scalefactors_json.json` for the image
      underlay, through `ImageSource.kind === 'flat'`.
- [x] Keep coordinates in micrometres, but model full-resolution pixels and
      scalefactors explicitly. Do not assume Xenium's pyramid units or Y-axis
      handling in shared code.

#### Slices

- [x] 1. Detection and capability plumbing: `VisiumHdDataset`, generic caches,
     platform-aware diagnostics, the generic element-ID contract, and the
     affine-grid contract. Visium HD is detected from binned
     `tissue_positions.parquet`, `scalefactors_json.json`, and
     `filtered_feature_bc_matrix.h5`.
- [x] 2. Binned overview reader: 16 µm `tissue_positions.parquet`, filtered to
     `in_tissue = 1`, converted through `microns_per_pixel`, returned as
     columnar grid cells. 8 µm behind a selector.
- [x] 3. Grid rendering through a dedicated layer, with correct winding for
     left-handed image bases. Hover and selection show barcode, bin size,
     array row/column, full-res pixel, and expression.
- [x] 4. Flat tissue image with scale-factor alignment and opacity.
  - [ ] **Reopened (2026-11-08):** fallback from high-res to low-res. Only
        `tissue_hires_image.png` is loaded; the low-res path is recorded but
        never read.
- [x] 5. Binned gene panel (`features.tsv.gz`) and expression. Never use the
     Xenium cell-ID codec for Visium.
- [x] 6. ROI over bins with barcode export; embeddings from binned
     `analysis/umap/gene_expression_2_components/projection.csv`, keyed by
     barcode.
- [x] 7. 2 µm without loading all 11.2M position rows: filtered matrix barcodes
     plus a derived affine transform.
- [x] 8. Feature Slice and segmented outputs:
  - [x] Feature Slice H5 selected-gene reader, budget error classification, and
        lazy-range worker backend.
  - [x] Budgeted `barcode_mappings.parquet` reader and bin-to-cell bridge.
  - [x] Segmented-output detection and diagnostics (feature-cell matrices,
        cell/nucleus GeoJSON, annotated GeoJSON, nucleus mask TIFF).
  - [x] Cell GeoJSON polygons through the existing boundary layer.
  - [x] Annotated nucleus GeoJSON styling.
  - [x] Nucleus instance-mask TIFF through a viewport-scoped reader.
  - [x] Viewport-scoped streaming of oversized GeoJSON.

#### Execution Notes

Foundation:

- Generic `SpatialElementId`, `GexResult<ElementId>`, `SpatialGrid`,
  `SpatialGridBasis`, columnar `GridCellBatch`, and logical `grid-cell`
  geometry. Affine helpers cover centres, corners, winding, least-squares
  fitting, and nested tiers.
- Diagnostics run detection first, then check each platform's files. For Visium
  HD they check the active tier's positions, scalefactors, matrix, images, and
  optional UMAP, plus root `feature_slice.h5` and `barcode_mappings.parquet`.

Rendering and lifecycle:

- Dataset loading detects the platform before any Xenium warmup, then routes
  Visium HD through `getSpatialDataset()`. It reads the default binned overview
  and draws the high-res PNG through `MorphologyCanvas`.
- The Dataset tab labels the dataset type, renames the image toggle
  `Tissue image`, disables `Boundary limit`, and offers bin tiers. Switching
  tiers reuses the cached dataset.
- Clicking a bin opens `Bin Info` without starting Xenium cell loaders.

Expression (in order):

1. Selecting a gene hung the UI because the whole H5 matrix was read. The path
   was paused.
2. A `HEAD` size check now rejects full-file reads over 64 MB before importing
   h5wasm. The reference 16 and 8 µm matrices exceed it.
3. A Feature Slice H5 reader parses `metadata_json`, `/features/name`, and
   `/features/feature_type`, reads `/feature_slices/{i}/{row,col,data}`, bins 2
   µm coordinates to 8/16 µm, and returns per-barcode counts.
4. A lazy-range worker backend lets hosted `feature_slice.h5` reads fetch only
   the ranges they need. Selected-gene overlays were enabled.
5. Bin and cell all-gene profiles read `filtered_feature_bc_matrix.h5` through a
   lazy-range worker, with no default 64 MB limit. Clicking a bin loads its
   profile automatically; the button refreshes it. Worker requests are queued
   and transient XHR errors are retried.
6. Selected-gene scores and all-gene profiles are labelled separately in Bin and
   Cell Info.

2 µm tier (in order):

1. 2 µm could not become the default first paint, and direct 2 µm overview reads
   were rejected.
2. Square barcodes (`s_002um_*_*`) are parsed from
   `filtered_feature_bc_matrix/barcodes.tsv.gz`. The 2 µm grid is derived from a
   coarser basis.
3. 2 µm was enabled only with an explicit barcode budget, first from
   `VITE_VISIUM_HD_MAX_TWO_MICROMETER_FILTERED_BARCODES`, then from a runtime
   `2 µm budget` field.
4. **Final:** the `2 µm budget` and `Mapping rows` fields were removed. 2, 8,
   and 16 µm reads use all rows unless a lower-level caller sets a cap.
   `docs/visium-hd-2um-strategy.md` records the contract.

Shared grid basis: 16 µm is derived from 8 µm when both exist; 2 µm prefers 8
µm, then 16 µm.

Segmented outputs:

- Detection records which Space Ranger 4.1 segmentation files are present.
- Cell GeoJSON (`FeatureCollection` polygons and multipolygons) is converted
  from full-res pixels to micrometres. It sets `capabilities.cellBoundaries`.
  Numeric `cell_id`s are normalized. Graphclust-annotated GeoJSON is used when
  the plain file is missing, keeping labels and colours.
- `segmentationElements(kind, bbox)` loads cell or nucleus geometry.
  `elements(bbox)` stays cell-only.
- The default 64 MB GeoJSON limit was removed. GeoJSON is streamed by
  bounding box and cached per bounding box.
- When cell polygons are loaded, the bin grid is hidden but kept for ROI and
  export. Segmented cells are pickable and have hover tooltips.
- Nuclei are drawn as a separate blue, non-pickable layer. The nucleus TIFF
  mask is read in a viewport window, and nonzero labels become polygons.
  GeoJSON is preferred over the TIFF.
- Bin and boundary layers no longer flicker while a boundary request is
  pending, and density estimates use stable grid counts (`c4674c1`).

Other:

- `barcode_mappings.parquet` has a budgeted, column-projected reader exposed
  through `VisiumHdDataset`.
- ROI selection is scoped to the active dataset and tier, and exports barcodes
  as CSV. Embeddings prefer the active tier's projection.
- The reference dataset lacks image size fields in `scalefactors_json.json`,
  so image size is optional.

Shipped but not recorded at the time (from commits):

- Segmented-cell profiles query `barcode_mappings.parquet` with DuckDB for one
  `cell_id`, then read those bins from the active tier's filtered matrix
  (`baac653`, 2026-06-22). Bin expression is projected onto mapped cells for
  boundary colouring (`5d53124`, 2026-06-19).
- Zoom LOD for grids: with 2 µm selected below zoom 3, the 16 µm grid is shown,
  and colour-averaged 16 µm aggregates stand in for zoomed-out 2 µm bins. They
  cannot be picked (`157efdf`, 2026-06-29).
- Zoom LOD for expression: 2 µm requests use 16 µm data below zoom 3, and 8 µm
  requests use 16 µm at zoom −1.25 or lower, over the whole slide (`32d1c47`).
- Edge bins colour correctly (`83d5036`); the Transcripts tab is hidden for
  Visium HD (`99d002a`); bin opacity controls apply to grids (`25c17f6`).
- Bins draw through an instanced layer (`bf6ebc8`).

Known gaps (2026-11-08 review):

- Segmentation GeoJSON is re-streamed for each new viewport; the bbox cache
  only helps when the same box is requested again.
- Barcode-mapping reads are not cached when an `AbortSignal` is passed, and the
  app always passes one, so each bin selection re-reads
  `barcode_mappings.parquet`.
- 16 µm first paint also reads the whole 8 µm positions file to derive the
  basis. The 2 µm positions file must exist for detection, though it is never
  read. With only a 2 µm tier, the default load fails.

#### Definition Of Done (MVP)

- [x] The reference URL renders a tissue image with aligned 16 µm bins, with no
      Xenium files.
- [x] Users can switch between 16 and 8 µm. 2 µm is either unavailable with a
      reason or enabled through a budgeted path.
- [x] The UI labels the dataset as Visium HD and disables transcript, Magic
      Lens, and Xenium boundary controls without misleading errors.
- [x] Hover and click on a bin show barcode, size, tissue status, array
      row/column, image coordinate, and expression.
- [x] Diagnostics check the files that matter for the selected mode.
  - [ ] **Reopened (2026-11-08):** the high-res PNG is marked required,
        segmentation GeoJSON is fetched in full, and `barcodes.tsv.gz` and
        `features.tsv.gz` are not checked.
- [x] Unit tests cover detection, scalefactors, tissue positions, the affine
      transform, grid layer conversion, and capability gating.
- [x] Browser smoke covers image plus 16 µm bins (54,504 bins).
- [x] Full verification passed.

#### Post-MVP Hardening

- [x] First pass at broader browser coverage: 16/8 µm switching, 2 µm
      enablement, Feature Slice overlay, ROI barcode export, segmentation
      controls, and Bin Info.
- [ ] Optimize hosted Visium HD datasets: interaction profiling, segmentation
      streaming cost, Feature Slice worker ranges, memory, and bundle splitting.
- [x] Vendor chunk groups (see [Optimization Pass](#optimization-pass)).
- [x] Transition helpers, the platform adapter, and the viewer split (see
      [section 7](#7-application-structure-and-refactor-record)).

### Phase 7 — AnnData H5AD

The user asked for `5AD` support; this was read as H5AD. Scope: point-based
cells with per-cell expression and `obs` observations, both categorical and
continuous.

#### Product Decisions

- [x] A new `AnnDataH5adDataset` platform, not a branch of Xenium or Visium HD.
      Extend `Platform` and `AppPlatformAdapter`.
- [x] Accept a direct `.h5ad` URL. Do not append Xenium or Visium file names.
- [x] Point-only MVP. No image, boundaries, nuclei, or transcripts; those
      controls are hidden or disabled.
- [x] Require a 2D coordinate matrix (see [5.3](#53-anndata-h5ad)). Never fall
      back to row order.
- [x] Categorical `obs` columns become annotations; numeric and boolean columns
      become continuous tracks and Cell Info fields.
  - [ ] **Reopened (2026-11-08):** numeric columns reach Cell Info
        ("Observations") but not the `Cell color` → `Metadata` tracks;
        `metadataTracks()` exists but nothing in the app calls it. Boolean
        columns are expected to fail on the reference backend and in
        SpatialData tables.
- [x] `/X` first; `/layers/*` and `/raw/X` later.
- [ ] Read remote files through a worker-backed, Range-capable h5wasm reader,
      avoiding full-file fetches except for tiny fixtures or budgeted paths.
- [x] Do not regress Xenium or Visium HD.

#### Slices

- [x] 1. Detection and file-URL plumbing.
- [x] 2. Schema reader: groups, encoding attributes, indexes, `obsm` keys,
     matrix layout, optional `layers` and `raw`, and a schema summary.
- [x] 3. Point overview with stable IDs, extent, and observation summaries.
- [x] 4. Observation tracks: lazy `obs` reads, categorical vs continuous,
     colours and domains, wired into cell colour, hover, Cell Info, and
     annotations.
- [x] 5. Gene panel and expression: selected genes, ROI summaries, and
     selected-cell profiles from dense, CSR, or CSC `/X`, with budgets and
     abortable requests.
  - [ ] **Reopened (2026-11-08):** "worker reads". H5AD h5wasm reads run on the
        main thread; see Remaining Hardening.
- [x] 6. Platform adapter and lifecycle: reset, URL state, ROI, selection, and
     overlays per platform.
- [x] 7 (partial). Diagnostics and structured errors for unsupported encodings,
      missing coordinates, missing genes, oversized reads, and HDF5 failures.
- [x] 8 (partial). Tests with tiny h5wasm-generated fixtures, app-level
      regression tests, and a browser smoke test.

#### Execution Notes

- H5AD skips the directory-style probes. The factory passes custom fetchers to
  H5AD instances for tests.
- `/obs`, `/var`, `/obsm/X_spatial` or `/obsm/spatial` (falling back to
  embeddings), and dense, CSR, or CSC `/X` are parsed.
- Category sidecars (`/obs/__categories/<column>`) make PBMC-style columns
  categorical.
- Cells render as pickable points with obs IDs, extent fitting, categorical
  annotations, numeric tracks, hover and Cell Info values, gene overlays, ROI
  gene summaries, and selected-cell profiles.
- The Cell tab lists every valid 2D `obsm` matrix as an embedding.
- Gating: transcripts, boundaries, nuclei, and transcript Magic Lens are off;
  point ROI, annotations, metadata colouring, and gene expression are on.
- Diagnostics check the H5AD URL instead of Xenium files.
- Size gate and kerchunk reference: see [5.3](#53-anndata-h5ad).
- Cell Info shows `obs` values as "Observations" (`6fe02be`, 2026-07-09).
- Imported CSV/JSON annotation files are parsed with the Xenium cell-ID rule
  (`/^[a-p]{8}-\d+$/`), so files keyed by H5AD obs names are rejected.

#### Definition Of Done (MVP)

- [x] A direct `.h5ad` URL with `obs`, `var`, `/X`, and a 2D `obsm` matrix loads
      and renders pickable points.
- [x] Categorical `obs` tracks colour cells as annotations.
- [ ] **Reopened (2026-11-08):** continuous `obs` tracks colour cells on a
      numeric scale. They appear in Cell Info only.
- [x] Selected-gene colouring, ROI gene summaries, and selected-cell profiles
      work from dense, CSR, and CSC `/X` within explicit budgets.
- [x] Gating is clear; unsupported controls start no network or matrix work.
- [x] Oversized files use the kerchunk path when the `.h5ad.json` exists, and
      fail with a structured error when it does not.
- [x] Unit, integration, typecheck, lint, build, and browser smoke pass.

#### Remaining Hardening

- [ ] Move remote HDF5 reads to a worker-backed lazy Range path.
- [ ] Add `/layers/*` and `/raw/X` as selectable expression sources.
- [ ] Add richer schema diagnostics, including a check of the `.h5ad.json`
      reference.
- [ ] Offer numeric `obs` columns as `Metadata` colour tracks.
- [ ] Accept obs names in imported CSV/JSON annotation files.
- [ ] Read boolean `obs` columns on the reference backend.

### Phase 8 — Image-Only Viewer And GeoJSON Annotations

Goal: load direct OME-TIFF (and later validated NDPI) URLs without
transcriptomics data, and add geometric annotations as their own overlay model
instead of extending cell-ID annotations. Shipped on 2026-07-09 (`f7ff9c5`,
`89e99cf`).

#### Product Decisions

- [x] Add an `image` platform (`ImageOnlyDataset`). It uses the tiled image
      renderer and computes extent from image size and microns per pixel. Other
      platforms are unchanged.
- [x] Detect `.ome.tif`, `.ome.tiff`, `.tif`, `.tiff`, and `.ndpi` URLs. NDPI goes
      through the TIFF loader and renders only when it is tiled with `SubIFD`
      pyramids (see [5.4](#54-image-only-sources-phase-8)).
- [x] Disable transcripts, gene expression, cell details, cell annotations,
      boundaries, Magic Lens, ROI gene stats, and ROI transcript export. The
      Genes, Transcripts, Magic Lens, and Cell tabs are hidden.
- [x] Use the image extent for the initial camera when there are no cells,
      grid cells, or boundaries.
- [x] Rename `Dataset URL` to `Dataset or image URL`, keeping the load action.
- [x] Enable every channel on load and run auto-contrast on all of them;
      multi-channel TIFFs get colour channels (`89e99cf`).

#### Geometric Annotations

- [x] A model separate from cell-ID annotations
      (`geometricAnnotationModel.ts`): Polygon or MultiPolygon geometry, label,
      colour, visibility, and source metadata.
- [x] On image-only sources the ROI tab becomes `Geometry`: box and lasso
      drawings are saved as shapes, with an optional `Shape name`.
- [x] Import and export GeoJSON. Import accepts a `Feature` or
      `FeatureCollection` of Polygon or MultiPolygon; `null` geometries are
      skipped and any other geometry rejects the file. Labels come from `label`,
      `name`, or `title`; colours from `color`, `stroke`, or `fill`
      (`#rrggbb`). Image-only imports default to pixels and other platforms to
      micrometres; `coordinate_unit` overrides. Export always writes
      micrometres to `geometric-annotations.geojson`.
- [x] Render as deck.gl overlays with colour, visibility, label, remove, clear,
      and export controls. GeoJSON shapes are available on every platform, not
      only image-only.
- [x] Document converting unsupported NDPI to pyramidal OME-TIFF
      (`docs/image-only-and-geojson.md`).

#### Test Plan

- [x] URL detection for OME-TIFF, TIFF, and NDPI (`datasetFactory.test.ts`).
- [x] `ImageOnlyDataset.meta()` extent and capabilities, and `image()`
      (`imageOnlyDataset.test.ts`).
- [x] Image platform adapter gating (`platformAdapter.test.ts`).
- [x] Initial fit from image extent (`ViewerCore.test.tsx`).
- [x] GeoJSON import: Polygon, MultiPolygon, empty files, invalid geometry,
      pixel and micrometre coordinates (`geometricAnnotationModel.test.ts`).
- [x] Component test: an image-only source loads and enables GeoJSON shape
      annotations (`App.test.tsx`).
- [x] Xenium, Visium HD, and H5AD tests still pass.

#### Image Pipeline Fixes After Phase 8

- [x] Custom RGB OME-TIFF layers render as native RGB (`94527ce`, 2026-08-25).
- [x] Planar (separate-plane) TIFF tiles and pyramid level scaling
      (`0d67e06`, 2026-08-28).
- [x] OME `Channel@Color` decoded as signed RGBA with red in the high byte;
      opaque red had been rendering as blue (`3e1a8d5`, 2026-11-07).

#### Known Gaps

- [ ] A failed GeoJSON import logs "GeoJSON annotation import failed" without
      the reason.
- [ ] `id` and `visible` properties are not imported, and shapes are not saved
      in the shareable URL.
- [ ] No E2E coverage for image-only sources.

### Phase 9 — OME-Zarr Image Pyramids (Recorded From Git)

Shipped on 2026-07-10 (`f9560ee`) with later fixes. Not planned in advance.

- [x] Open OME-Zarr images (Zarr v2 or v3) as image-only sources, from a
      `.zarr`/`.ome.zarr` URL, a `zarr.json` or `.zattrs` URL, or a folder whose
      root metadata holds OME multiscales (see [5.5](#55-ome-zarr-images-phase-9)).
- [x] A shared `ImagePyramidLoader` interface for TIFF and OME-Zarr, so the
      morphology canvas, channel controls, and auto-contrast work unchanged.
- [x] OME-Zarr custom image layers in the Layers tab, next to OME-TIFF. HTTP
      URLs that fail are retried over HTTPS.
- [x] Treat `403` as "missing" for metadata keys only, for buckets that deny
      listing; use consolidated metadata when present (`9c0d221`, 2026-10-13).
- [x] Render index-labelled 8-bit three-channel images as RGB; split chunks over
      512 px into virtual tiles backed by a shared decoded-chunk cache
      (`10e3470`, 2026-11-06).
- [x] Decode chunks in the Zarr decode worker pool, with a main-thread fallback
      (`92defed`, 2026-11-06).

Known gaps:

- [ ] Only `t = 0` and `z = 0` are shown.
- [ ] No IndexedDB caching of OME-Zarr chunks.
- [ ] No E2E coverage.

### Phase 10 — SpatialData Stores (Recorded From Git)

Shipped from 2026-10-13 to 2026-11-06 (`66d44de`, `10e3470`, `92defed`). Not
planned in advance.

#### Delivered

- [x] Detect SpatialData from `spatialdata_attrs` in root metadata, both for
      Zarr-looking URLs (before the Xenium probe) and for plain folder URLs
      (after it).
- [x] Read the element catalog from consolidated metadata and place images,
      shapes, labels, and tables in a shared coordinate system through their
      transforms (see [5.6](#56-spatialdata-stores-phase-10)).
- [x] Read the table through the AnnData reader, so genes, annotation sets,
      embeddings, selected-cell profiles, and ROI summaries work as for H5AD.
- [x] Place table rows on their annotated shapes (centroids) or, for labels
      regions, from `obsm` through the labels transform. Rows that match
      nothing are hidden; the load fails if no row is placed.
- [x] Shapes from GeoParquet or WKB (`shapes.parquet`). Circles and polygons
      appear as cell boundaries. When the region is circles (for example
      Xenium `cell_circles`), a `cell_boundaries`-style shapes element is drawn
      instead, matched through instance IDs.
- [x] spatialdata-io Xenium stores whose table annotates a labels element: map
      label IDs from the instance key or a `cell_labels`-style column, and trace
      outlines from the label raster on demand, joining cells that span chunks
      (`10e3470`).
- [x] Units: µm-per-unit from an override, declared axis units, or an estimate;
      unknown scales are labelled as units (see
      [4.11](#411-units-for-stores-without-declared-scale-phase-10)).
- [x] Dataset tab controls: `Coordinate system`, `Image`, and `µm per unit`
      (`Set`/`Auto`), saved in the shareable URL as `sdCs`, `sdImage`, and
      `sdUm`. Changing them reloads the store and releases the previous dataset
      instance.
- [x] Incomplete stores are reported: chunks read as fill values are tracked,
      missing string chunks fail fast, `403` chunk errors are typed, optional
      obs columns that cannot be read are skipped, and Diagnose Dataset sends a
      `HEAD` for every table chunk and checks one image chunk.
- [x] Panning performance: label tracing and OME-Zarr decoding in workers,
      outlines cached per label and simplified, and padded boundary requests
      (`92defed`; see [4.9](#49-cell-boundaries)).
- [x] Platform gating (`SPATIALDATA_PLATFORM_ADAPTER`): boundaries from
      `elements(bbox)`; transcripts, nucleus boundaries, and Magic Lens off.

#### Known Gaps

- [ ] `points` (transcripts), extra images, and extra tables are not shown.
- [ ] Shapes are read whole, not by viewport.
- [ ] `meta()` waits for the image, so a broken image also blocks boundaries.
- [ ] Numeric `obs` columns are not offered as `Metadata` colour tracks, boolean
      columns are expected to fail, and imported CSV/JSON annotations must use
      Xenium cell IDs (shared with [Phase 7](#phase-7--anndata-h5ad)).
- [ ] Diagnostics check only one image chunk.
- [ ] No E2E coverage; the reference stores in
      [1](#reference-datasets) are used for manual testing.

### Phase 11 — Dataset Manifest

Shipped 2026-11-09. Requested so that renaming a file such as `cells.parquet`
no longer breaks loading, and so a dataset can say how it should be shown.

#### Product Decisions

- **DECISION:** One manifest file, `explorer.json`, read from the entered
  folder alongside the `experiment.xenium` probe; any other `.json` URL can be
  entered directly. Without one, detection is unchanged.
- **DECISION:** Readers keep receiving the entered URL. Detection registers the
  manifest for that URL (`setDatasetManifest`, `src/data/datasetFiles.ts`) and
  readers ask for files by role (`datasetFileUrlFor`), instead of threading a
  file map through every reader and workflow.
- **DECISION:** `defaults` reuse the share-URL fields, so they follow the
  shared-link restore path and a shared link wins field by field.
- **DECISION:** Strict validation with field-level messages; a typo must not
  silently fall back to a standard name. A JSON Schema ships with the app for
  editors, and a test keeps it in step with the parser.

#### Delivered

- [x] `parseDatasetManifest` (`src/datasets/datasetManifest.ts`): version,
      platform, `root`, per-platform `files`, `options`, `defaults`; relative
      paths resolve against the manifest folder or `root`.
- [x] Detection from a manifest for all five platforms; Visium HD bins listed
      in the manifest are checked with `HEAD`.
- [x] Every hard-coded Xenium and Visium HD root file name goes through
      `datasetFileUrlFor`; messages name the manifest path
      (`datasetFileLabelFor`).
- [x] Xenium without `experiment.xenium` when the manifest names the image;
      manifest UMAP/t-SNE paths; Visium HD bin paths for projections.
- [x] Display defaults applied by `useDatasetLifecycle`
      (`src/features/dataset/datasetManifestModel.ts`); image channels by name
      or ID; unknown values reported under Fallbacks.
- [x] SpatialData `options` as the starting selection; Visium HD `binSize` as
      the default tier.
- [x] `DatasetManifestError` classified as "Dataset manifest is invalid";
      Diagnose Dataset adds a `Dataset manifest` check and checks manifest
      locations; `experiment.xenium` becomes a warning.
- [x] `public/schemas/explorer-manifest.v1.json` and
      `docs/dataset-manifest.md`.
- [x] Checked in the browser against the hosted Xenium demo (folder manifest
      with `root`, relocated `experiment.xenium`, defaults), a SpatialData
      manifest with `options`, and invalid and missing-file manifests.

#### Known Gaps

- [ ] Files cannot be declared absent, so optional standard names are still
      probed.
- [ ] Not configurable yet: H5AD coordinate key, annotation set to select,
      channel colours and contrast, initial camera.
- [ ] A `404` for a byte-range file is titled "Byte-range requests blocked".
- [ ] No E2E test; the hosted fixtures are folders without manifests.

---

## 7. Application Structure And Refactor Record

### 7.1 Extractions (2026-06-07)

Checkpoint commits: `a22c90e Refactor app panels and feature models` and
`8cdfea2 Extract ROI and load error models`.

- **Components:** `AppStatusPanels`, the HUD panels (`DatasetHudPanel`,
  `LayerHudPanel`, `CellHudPanel`, `RoiHudPanel`), `EmbeddingPanel`,
  `CellInfoPanel`, `MorphologyChannelControls`, `MagicLensPanel`,
  `RoiGeneStatsPanel`, and `TranscriptStatusPanel`.
- **Models:** `cellDetailModel`, `morphologyChannels`, `magicLensModel`,
  `roiModel`, `transcriptLayerModel`, `transcriptLabels`, `geneControlsModel`,
  `annotationModel`, `diagnosticsDump`, `loadErrorModel`, and `slug`.
- Feature state unions live in feature model modules with narrow error types.
  `App.tsx` supplies `StructuredLoadError` where full diagnostics are needed.
- Error classification lives in `features/errors/loadErrorModel.ts`.
- ROI, Magic Lens, and transcript calculations, labels, keys, limits, and CSV
  formatting live in their feature models. (Request orchestration first stayed
  in `App.tsx`; the refactor below moved it into workflow hooks.)

### 7.2 Structural Recommendations (`OPTIMIZATIONS.md`)

Goal: keep product behaviour while reducing coupling in the app shell, platform
workflows, and rendering. All 14 recommendations are closed.

| #   | Recommendation                           | Closed     | Outcome                                                                                                         |
| --- | ---------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Domain state bundles for `App.tsx`       | 2026-06-27 | `useAppDomainState` owns the domain groups                                                                      |
| 2   | Grouped hook option objects              | 2026-06-26 | Workflow hooks take `callbacks`, `controls`, `data`, `loaders`, `refs`, `requests`, and `setters`               |
| 3   | Shared latest-request runner             | 2026-06-24 | Abortable workflows use shared helpers; non-abortable sequencing and cleanup-only aborts stay outside by design |
| 4   | Transition helpers for async states      | 2026-06-26 | Workflows call named constructors; model tests cover them                                                       |
| 5   | Platform adapter layer                   | 2026-06-26 | `platformAdapter.ts` owns gates, labels, visibility, and routing                                                |
| 6   | Visium HD orchestration out of `App.tsx` | 2026-06-25 | Hooks own expression profiles, ROI, Magic Lens summaries, bin controls, and the app controller                  |
| 7   | Split `ViewerCore` by interaction        | 2026-06-27 | Types, navigation, ROI, measurement, Magic Lens, hover, picking, and status in focused modules                  |
| 8   | Split `deckLayers.ts` into renderers     | 2026-06-27 | `deckLayers.ts` is a facade and `createOverviewLayers` assembly point                                           |
| 9   | Reader modules for dataset files         | 2026-06-27 | `xeniumDatasetReaders.ts` and `visiumHdDatasetReaders.ts`; facades keep the public API                          |
| 10  | Platform-neutral names                   | 2026-06-28 | `GeneExpressionBatch.elements`; cell-named aliases removed                                                      |
| 11  | Split global CSS                         | 2026-06-27 | `src/index.css` imports files under `src/styles`                                                                |
| 12  | Reusable test harnesses                  | 2026-06-27 | `src/test/appTestHarness.ts`                                                                                    |
| 13  | Grouped app dependency injection         | 2026-06-27 | `App` takes one `dependencies` object with grouped defaults and overrides                                       |
| 14  | Lazy heavy capabilities                  | 2026-06-27 | Xenium and Visium HD readers behind statically analysable dynamic imports; constructor-injected seams for tests |

### 7.3 Progress Timeline

| Date       | Work                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-24 | Latest-request runner extended to Visium HD bin assignment, expression projection, Magic Lens scans, custom image layers, diagnostics, transcripts, selected-cell detail, ROI cells/genes, ROI export, dataset load/warmup, and Visium HD profiles. Option grouping started with `useDatasetLifecycle`, then `useTranscriptWorkflow`, `useCellDetailWorkflow`, and `useRoiWorkflow` |
| 2026-06-25 | `useVisiumHdExpressionProfileWorkflow`, `useVisiumHdRoiWorkflow`, and `useVisiumHdMagicLensSummary` extracted, with focused tests                                                                                                                                                                                                                                                   |
| 2026-06-26 | Option grouping finished across the remaining workflows. Transition helpers added for every runtime async state. Platform adapter added. `ViewerCore` and `deckLayers` split                                                                                                                                                                                                        |
| 2026-06-27 | Lazy imports hardened for Visium HD and Xenium. Re-audit closed items 1, 7, 8, 11, 12, 13, and 14. Item 9 closed                                                                                                                                                                                                                                                                    |
| 2026-06-28 | Item 10 closed (`cells` → `elements`)                                                                                                                                                                                                                                                                                                                                               |

The progress notes in `OPTIMIZATIONS.md` number items two ways: the
four-step "Recommended Sequence" and the 14-item list. This table uses names
and the 14-item numbering.

---

## 8. Dataset Hosting Requirements

The app depends on cross-origin HTTP Range requests. Without them nothing loads.
The playbook is in `docs/s3-cors-playbook.md`; the app also probes Range support
and has `Diagnose Dataset`.

- **CORS:** allow `GET` and `HEAD`; allow the `Range` request header; expose
  `Content-Length`, `Content-Range`, `Accept-Ranges`, and `ETag`. Restrict
  `AllowedOrigin` in production.
- **Check Range:** `curl -r 0-99 -I https://bucket/.../transcripts.parquet`
  should return `206` with `Content-Range`. DuckDB sends a `HEAD` per file
  handle, so `HEAD` must be allowed and fast.
- **Zipped Zarr:** `ZipFileStore.fromUrl` Range-reads the central directory and
  then member offsets. Offering unzipped `.zarr/` too avoids the directory
  seeks.
- **No transfer compression** (`Content-Encoding`) on Parquet, Zarr, TIFF, or
  HDF5. They are already compressed, and gzip breaks Range offsets.
- **Caching:** long `Cache-Control` plus `ETag`, on immutable dataset paths.
- **HTTP/2 or HTTP/3** on the CDN, because the app makes many small requests.
- **Cross-origin isolation:** the app does not need it today. Nothing uses
  `SharedArrayBuffer`, and DuckDB uses its non-threaded bundles (see
  [4.3](#43-parquet-engine--decision-duckdb-wasm-primary-hyparquet-for-first-paint)).
  The dev and preview servers send `COOP: same-origin` and
  `COEP: require-corp`, and `docs/deploy-to-s3.md` recommends the same in
  production for parity. Every dataset read is a CORS request, so dataset hosts
  need the CORS policy above but not `CORP`. (Settled 2026-11-08; the docs had
  disagreed.)
- **`HEAD` must work.** Platform detection is a series of `HEAD` probes with a
  15 s timeout; a host that rejects `HEAD` makes every source undetectable.
- **Zarr stores (Phases 9–10):** publish consolidated metadata, because the
  browser cannot list prefixes. Buckets that answer `403` for missing keys are
  tolerated for metadata keys only.
- **H5AD over 300 MiB:** host the kerchunk `.h5ad.json` reference next to the
  file.
- **Replacing files in place:** the IndexedDB byte-range cache is keyed by URL
  and range without the `ETag`, so a file replaced at the same URL can serve
  stale bytes until site data is cleared. Keep dataset paths immutable.

---

## 9. Testing And CI

### Planned

- **Unit (Vitest):** cell-ID codec round trip, coordinate conversions, CSC
  slicing, `selectionToSQL`, gene/control filtering, and percentile windowing.
- **Golden fixtures:** a tiny synthetic Xenium-shaped bundle (few cells, one
  tile) committed for offline, deterministic tests.
- **Integration:** duckdb-wasm against fixture Parquet, zarrita against a
  fixture `.zarr.zip`, and a JPEG-2000 decode of a known tile checked by pixel
  checksum.
- **E2E (Playwright):** load the demo, draw a circle, check cell count and top
  gene, toggle the image, and apply cluster colours.
- **CI (GitHub Actions):** typecheck, lint, unit and integration tests per PR;
  build; deploy preview; cache WASM artefacts.

### Recorded State (Assessment Of 2026-06-26)

- Verification passed: `npm test` (127 Vitest files, 671 tests),
  `npm run test:e2e` (4 Chromium tests, about 4.4 minutes), typecheck, lint, and
  build.
- Inventory: 128 test files, about 675 cases, against 153 source files. Thirty
  source files have no colocated test; most are entrypoints, small UI leaves,
  type or message modules, worker wrappers, or glue covered by integration
  tests.
- E2E covers the public Xenium dataset (load, channels, transcript density, ROI
  box and cell export, Cell Info) and the public Visium HD dataset.
- Tests generate small fixtures in code (for example HDF5 files built with
  h5wasm).
- Known noise: a Vitest jsdom canvas warning; build warnings about
  browser-externalized optional Node imports and large spatial/HDF5/codec
  chunks. In the desktop environment the Playwright `webServer` command
  expects `npm` on `PATH`, so smoke runs used a manually started preview.
- Coverage was judged good enough to continue the feature-fix and optimization
  sequence.

### Inventory (2026-11-08, Static Count)

Counted from the repository, not from a test run:

- 149 colocated unit test files with about 821 `it`/`test` cases, against 209
  non-test source files under `src/`.
- 7 Playwright tests in `tests/e2e/app.spec.ts`: the viewer shell, transcript
  controls, a local H5AD fixture, the hosted PBMC3K H5AD, the live Xenium
  dataset (morphology, transcripts, ROI, Cell), the Visium HD reference (image
  and 16 µm bins), and Visium HD tiers (16/8 µm switching, 2 µm enabled,
  Feature Slice gene, Magic Lens, ROI).
- Phase 8 test-plan items each have a matching unit or component test.
- No E2E covers SpatialData, OME-Zarr, or image-only sources.
- There is still no `.github/` workflow and no coverage configuration.

### Open

- [ ] Add a coverage reporter and thresholds before using the suite as a release
      gate. `vitest.config.ts` has no coverage provider and `package.json` has
      no coverage script.
- [ ] Deeper Visium HD browser coverage: segmentation controls, Bin Info
      inspection, and loading the 2 µm tier when the environment allows.
- [ ] Direct tests for small helpers and leaf components if they gain behaviour
      (assignment/status helpers, cell expression panels, worker messages).
- [ ] CI pipeline and the committed golden fixture bundle (no completion
      recorded; no `.github/` directory).
- [ ] E2E smoke tests for SpatialData (shapes and labels stores), OME-Zarr, and
      image-only TIFF sources.

---

## 10. Tech Stack

| Concern             | Planned                                         | Outcome                                                                                                 |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Build               | Vite + strict TypeScript                        | As planned; vendor chunk groups added                                                                   |
| UI and state        | React + Zustand                                 | React state in domain bundles; Zustand for the viewer store only                                        |
| Rendering           | deck.gl 9 (orthographic) + Canvas2D underlay    | As planned; GPU-resident overview and instanced Visium HD bins (November 2026)                          |
| Parquet             | DuckDB-WASM (`spatial`) + hyparquet             | As planned; non-threaded bundles; `httpfs` loaded at bootstrap; hyparquet also reads SpatialData shapes |
| Zarr                | zarrita + `@zarrita/storage`                    | Matrix, analysis, transcript LOD, H5AD references, OME-Zarr images, SpatialData stores                  |
| HDF5                | h5wasm, jsfive fallback                         | h5wasm (including lazy-range workers for Visium HD); jsfive deferred                                    |
| OME-TIFF            | geotiff.js (IFD/SubIFD + Range)                 | As planned; `.zchunkstore` sidecar; geotiff.js decoders for non-JPEG-2000 codecs                        |
| JPEG-2000           | OpenJPEG-WASM (`@cornerstonejs/codec-openjpeg`) | In decode workers                                                                                       |
| Multi-channel blend | Viv `XRLayer`                                   | **Superseded** by Canvas2D additive compositing                                                         |
| JPEG XR             | WASM decoder                                    | **Dropped**                                                                                             |
| CSV                 | papaparse                                       | Not adopted; not a dependency. CSV parsing is hand-written; `metrics_summary.csv` is not read           |
| Workers             | Decode pool                                     | TIFF decode pool (≤ 4), Zarr decode pool (≤ 3), DuckDB, Visium HD matrix and Feature Slice              |
| State sharing       | URL hash                                        | As planned                                                                                              |
| Tests               | Vitest + Playwright, golden fixtures            | Vitest + Playwright; fixtures generated in tests                                                        |
| Persistent cache    | OPFS or IndexedDB                               | IndexedDB byte-range LRU (256 MiB, 20,000 entries, 8 MiB per entry)                                     |

---

## 11. Risks And Mitigations

| Risk                                      | Planned mitigation                                              | Outcome                                                                       |
| ----------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| JPEG XR immaturity                        | Spike early; JPEG-2000-only fallback; optional server transcode | JPEG XR dropped                                                               |
| Main-thread decode jank                   | Worker pool as a Phase 1 exit criterion                         | Tile decode in workers                                                        |
| S3 misconfiguration breaks Range silently | "Diagnose dataset" check (CORS, Range, key files)               | Range probes and `Diagnose Dataset` shipped                                   |
| DuckDB 40 MB start-up                     | hyparquet first paint and lazy DuckDB                           | Shipped                                                                       |
| Coordinate and unit bugs                  | One tested `coords` module; property-test round trips           | One module; property tests not recorded                                       |
| Memory blow-up on huge slides             | Adaptive point caps, tile LRU, memory telemetry and eviction    | Performance budget and tile-cache eviction telemetry                          |
| Large hosted H5 and GeoJSON files         | (Added in Phase 6/7)                                            | Lazy-range workers, streaming GeoJSON, H5AD size gate with kerchunk reference |
| Sampling hides rare cells                 | (Found November 2026)                                           | Samples keep every expressing cell; overlay draws every expressing cell       |
| Partially uploaded Zarr stores load empty | (Found in Phase 10)                                             | Fill-value tracking and per-chunk `HEAD` checks in diagnostics                |
| Plan and docs drift apart                 | (Found in the 2026-11-08 review)                                | Update this plan and `docs/` in the same PR                                   |

---

## 12. Open Items

Every unchecked item in this plan, updated 2026-11-09.

Sequencing:

- [ ] Feature-fix pass: keep recording fixes until correctness is stable.
- [ ] Optimization pass: interaction, memory, fetch/decode concurrency, and
      rendering cost, without behaviour changes.
- [ ] Hosted Visium HD optimization: profiling, segmentation streaming, Feature
      Slice ranges, memory, and bundles.

Reopened by the 2026-11-08 review (marked done before, found incomplete):

- [ ] H5AD and SpatialData: offer numeric `obs` columns as `Metadata` colour
      tracks (`metadataTracks()` has no caller).
- [ ] H5AD: read HDF5 in a worker (h5wasm runs on the main thread).
- [ ] H5AD and SpatialData: read boolean `obs` columns on the reference backend.
- [ ] Visium HD: low-res tissue image fallback.
- [ ] Magic Lens: make `Min QV` change results, or hide it.
- [ ] Xenium diagnostics: check the image chosen from `experiment.xenium`
      instead of `morphology.ome.tif` (a dataset manifest's image is already
      checked), plus `analysis.zarr.zip`, `gene_panel.json`, the H5 matrix, and
      embedding CSVs.
- [ ] Visium HD diagnostics: treat the high-res PNG as optional, avoid fetching
      whole GeoJSON files, and check `barcodes.tsv.gz` and `features.tsv.gz`.
- [ ] Xenium image choice: fall back to the next `experiment.xenium` path when
      the first fails.

Other gaps found in the review:

- [ ] Imported CSV/JSON annotations accept only Xenium cell IDs, so H5AD and
      SpatialData files are rejected.
- [ ] Visium HD: cache barcode-mapping reads across bin selections, and avoid
      re-streaming segmentation GeoJSON for every viewport.
- [ ] Byte-range cache keys omit the `ETag`.
- [ ] Main-thread exceptions to the worker convention: hyparquet, zarrita
      reads, h5wasm for H5AD and the Xenium H5 fallback, and auto-contrast.
- [ ] Xenium still loads through free functions in `src/data/` instead of one
      `XeniumDataset` instance; the viewer's µm/px comes from OME-XML while
      `meta()` reads the manifest.
- [ ] The diagnostics dump is named `xenium-diagnostics.json` on every platform.
- [ ] A failed GeoJSON import does not show the reason.
- [ ] Visium HD: with only a 2 µm tier the default load fails, and 2 µm
      detection needs a positions file that is never read.
- [ ] Remove `'visium'` from the `Platform` union or implement it.
- [ ] Dataset manifest: declare files absent; set the H5AD coordinate key,
      annotation set, channel colours and contrast, and initial camera; title
      `404`s on byte-range files as missing files (see
      [Phase 11](#phase-11--dataset-manifest)).

Features:

- [ ] Z-stack plane selector for `morphology.ome.tif` (**Deferred**), and
      `t`/`z` selection for OME-Zarr.
- [ ] H5AD: worker-backed lazy Range reads, `/layers/*` and `/raw/X`, and richer
      schema diagnostics.
- [ ] SpatialData: `points` (transcripts), extra images and tables, and
      viewport-scoped shape reads.
- [ ] Standard Visium (spots) `VisiumDataset` from the original Phase 6.
- [ ] Visium HD dataset annotations from `analysis/` (original Phase 6).
- [ ] Transcript estimate from native Zarr counts instead of `cells.parquet`.
- [ ] Codeword-level density (needs a dataset with `/density/codeword`).
- [ ] Streaming or viewport-scoped 2 µm barcode reads for very large deployments
      (`barcodes.tsv.gz` is still buffered).

Original-brief items with no outcome:

- [ ] `nucleus_boundaries.parquet` overlay for Xenium (not read).
- [ ] `metrics_summary.csv` QC display (not read; papaparse not adopted).
- [ ] DuckDB ExternalFileCache evaluation.
- [ ] Property tests for coordinate round trips.
- [ ] Memory ceiling with eviction telemetry beyond tile caches.

Testing:

- [ ] Coverage reporter and thresholds.
- [ ] Deeper Visium HD browser coverage.
- [ ] E2E for SpatialData, OME-Zarr, and image-only sources.
- [ ] Direct tests for small helpers.
- [ ] CI pipeline, deploy previews, and the golden fixture bundle.

Closed since the merge: Phase 8 (image-only and GeoJSON), and the "true all-cell
whole-slide expression scan" from Phase 4 (`Auto LOD` and `All cells` load every
cell up to 500,000 cells).

Not pursued (recorded as such): transcript LOD options A, D, and E;
client-side simplified boundaries; centroid pseudo-boundaries; JPEG XR; jsfive
until needed; cell-major matrix sidecars; papaparse.

---

## Appendix A: Reconciliation Notes

Where the sources conflicted, and what this document keeps.

| #   | Topic                            | Earlier record                                                                             | Later record (kept)                                                                 |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1   | DuckDB `httpfs`                  | `PLAN.md`: `LOAD httpfs` is redundant; don't rely on it                                    | Phase 5.1: load `httpfs` at bootstrap, non-fatal on older bundles                   |
| 2   | `transcripts.zarr.zip`           | `PLAN.md`: drop it; `density/` is only an optional accelerator                             | Phase 5.1: it is the native LOD and exact-point source                              |
| 3   | Multi-channel compositing        | `PLAN.md`: Viv `XRLayer`                                                                   | Phase 3: Canvas2D additive compositing                                              |
| 4   | Zustand scope                    | `PLAN.md`: shared store for React and the deck.gl loop                                     | Refactor: viewer store only; React domain state                                     |
| 5   | Request orchestration location   | Refactor decisions: async orchestration stays in `App.tsx`                                 | `OPTIMIZATIONS.md`: workflow hooks own requests                                     |
| 6   | Phase order around 5.1           | "Begin Phase 5.1 only after" the feature-fix and optimization passes                       | Phase 5.1 began after the correctness pass; the optimization pass was deferred      |
| 7   | Overview points                  | Phase 1: bin points at low zoom                                                            | Phase 4: no CPU aggregation; all viewport-clipped centroids; Phase 5 budget caps    |
| 8   | Expression limits                | Analysis slice: 5,000 visible cells                                                        | Phase 4: `Auto LOD` exact below 5,000; `Exact region` up to 50,000                  |
| 9   | Boundary limit default           | Phase 1: 5,000                                                                             | Phase 5: set by the performance budget (values not recorded)                        |
| 10  | Transcript selected-gene density | Option C: `/density/gene` for selected features; feature circles                           | 2026-06-06: only `/grids` density; filters apply in Exact                           |
| 11  | Magic Lens data path             | Phase 5: exact-circle transcript scans                                                     | Feature-fix: ROI cell query plus matrix gene stats                                  |
| 12  | ROI gene warmup                  | Per viewport                                                                               | Once per dataset                                                                    |
| 13  | ROI gene fallback                | Phase 4: `transcripts.parquet` aggregation                                                 | Feature-fix: CSC Zarr, then H5; nothing else by default                             |
| 14  | Visium HD expression             | Paused, then 64 MB H5 budget guard                                                         | Feature Slice lazy-range worker for overlays; lazy-range matrix worker for profiles |
| 15  | 2 µm tier                        | Disabled → env-var budget → runtime `2 µm budget` field                                    | Budget fields removed; all rows unless a caller caps                                |
| 16  | `Mapping rows` field             | `UPDATED_PLAN.md` says it was added, in an entry placed _after_ the one that removes it    | Removed. The file is not in date order; the removal is the final state              |
| 17  | Segmentation GeoJSON budget      | 64 MB full-file limit                                                                      | No default limit; streaming by bounding box                                         |
| 18  | Status header vs sequence        | "Phase 5.1 complete" (dated 2026-06-07) and "optimization pass remains a future follow-up" | Both kept: 5.1 done, optimization open                                              |
| 19  | "Keep `PLAN.md` unchanged"       | Phases 5.1 and 7 asked for new phases to go only in `UPDATED_PLAN.md`                      | Moot after this merge                                                               |
| 20  | `OPTIMIZATIONS.md` item numbers  | Progress notes mix the 4-step sequence numbers with the 14-item list numbers               | This document uses names and the 14-item numbering                                  |
| 21  | Persistent cache medium          | `PLAN.md`: OPFS or IndexedDB                                                               | IndexedDB only                                                                      |
| 22  | H5AD remote reads                | Product decision: worker-backed Range reader                                               | Not done; 300 MiB whole-file gate plus kerchunk reference (still open)              |
| 23  | Expression LOD                   | Phase 4: `Auto LOD` exact below 5,000 visible cells; samples thin all cells                | November 2026: every cell up to 500,000 cells; samples keep every expressing cell   |
| 24  | `Exact region` above the limit   | Phase 4: wait instead of sampling                                                          | November 2026: sample, keeping every expressing cell                                |
| 25  | Low-zoom expression marks        | Phase 4: fixed data-space bins                                                             | `0ed880d`: every expressing cell drawn at every zoom                                |
| 26  | Overview points                  | Phase 4: all viewport-clipped centroids                                                    | `bf6ebc8`: GPU-resident cells with a fixed-rank sample capped by the budget         |
| 27  | Boundary limit values            | Phase 5: "set by the performance budget"                                                   | 2,500 (compact) or 50,000; range 1–100,000; also loads at zoom ≥ −0.25              |
| 28  | Phase 8 status                   | Merged plan: nothing checked                                                               | Shipped in `f7ff9c5` on 2026-07-09; closed                                          |
| 29  | COOP/COEP in production          | Docs disagreed (required vs only for threaded WASM)                                        | Recommended for parity; not required by the current build                           |
| 30  | Items marked done in the records | H5AD tracks and workers, Visium HD low-res, Magic Lens QV, diagnostics, image fallback     | **Reopened** after the 2026-11-08 review                                            |

## Appendix B: Source Map

| Section in this document   | Source                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1. Purpose, POC            | `PLAN.md` intro, §0; reference URLs from `PLAN.md` and `UPDATED_PLAN.md`                                         |
| 2. Working rules           | `PLAN.md` "How to use", conventions, DoD, skills; `UPDATED_PLAN.md` skills, refactor decisions, current sequence |
| 3. Status                  | `UPDATED_PLAN.md` stage assessment and phase checklists; `OPTIMIZATIONS.md`                                      |
| 4. Architecture decisions  | `PLAN.md` §1; amendments from `UPDATED_PLAN.md` Phases 1–7 and boundary decision                                 |
| 5. Data contracts          | `PLAN.md` §2; `UPDATED_PLAN.md` Phase 5.1, 6, 7, 8 facts                                                         |
| 6. Phase records           | `PLAN.md` §3; `UPDATED_PLAN.md` running TODOs, notes, closeouts, feature-fix pass, Phases 5.1–8                  |
| 7. Refactor record         | `UPDATED_PLAN.md` app refactor decisions; `OPTIMIZATIONS.md`                                                     |
| 8. Hosting                 | `PLAN.md` §4                                                                                                     |
| 9. Testing                 | `PLAN.md` §5; `UPDATED_PLAN.md` test coverage assessment; 2026-11-08 repository count                            |
| 10. Tech stack             | `PLAN.md` §6, with outcomes from `UPDATED_PLAN.md`                                                               |
| 11. Risks                  | `PLAN.md` §7                                                                                                     |
| 12. Open items             | Every unchecked item in all three files, plus the 2026-11-08 review                                              |
| Phases 8–10, November work | Commits `f7ff9c5` to `0ed880d` (2026-07-09 to 2026-11-08), the code, and `docs/`                                 |
| Reopened items, known gaps | The 2026-11-08 review (`PLAN_VS_DOCS.md`), checked against the code                                              |
