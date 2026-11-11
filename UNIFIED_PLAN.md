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

On 2026-11-11, [Phase 15](#phase-15--interface-redesign) was added. It plans
an interface redesign that follows a UI review.

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
| QPTIFF image   | Direct Akoya `.qptiff` URL; also custom layers and manifests   | Phase 13                     | Done (2026-11-09)                           |
| OME-Zarr image | Direct OME-Zarr URL; also custom layers and SpatialData images | Phase 9 (recorded from git)  | Done (2026-07-10)                           |
| SpatialData    | Zarr store root with `spatialdata_attrs`                       | Phase 10 (recorded from git) | Done (2026-10-13 to 2026-11-06)             |
| Visium (spots) | Space Ranger `outs/` folder, or `.h5ad` with `uns/spatial`     | Phase 14 (original Phase 6)  | Done (2026-11-10)                           |

### Reference Datasets

| Platform              | URL                                                                                                                                                | Notes                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Xenium                | `https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328`                                  | Demo dataset; 1,414,155 cells                                                                                                 |
| Visium HD             | `https://mp33.cog.sanger.ac.uk/public/visiumhd/spaceranger401_count_50314_48d90238006ebffe73177a68c2b4f48f`                                        | Space Ranger 4.0.1; 54,504 bins at 16 µm                                                                                      |
| H5AD                  | `https://mp33.cog.sanger.ac.uk/public/h5ad/pbmc3k.h5ad`                                                                                            | 32,080,465 bytes; Range and CORS enabled                                                                                      |
| SpatialData (shapes)  | `https://webatlasdataprod.cog.sanger.ac.uk/public/visium_associated_xenium_io/a5652917-ebb4-4d4c-ba90-6e8845c6f370.sdata.zarr`                     | Visium CytAssist, Zarr v2; 4,992 circle spots; H&E images; consolidated metadata at `zmetadata`                               |
| SpatialData (labels)  | `https://cellgeni.cog.sanger.ac.uk/vento/reproductivecellatlas/ovaries/spatialdata_xenium/AU14_S14_final.zarr`                                     | spatialdata-io Xenium; table annotates `labels/xenium_segmentations`; 73,579 cells × 480 genes; true scale 0.2125 µm per unit |
| Atera                 | `https://mp33.cog.sanger.ac.uk/public/test/50170325_WSI_KID_04_region1/50170325_WSI_KID_04_region1`                                                | Human WTA kidney; 93,864 cells × 24,674 features (18,050 genes); 4 morphology channels; 667 M transcripts                     |
| Visium (H5AD)         | `https://cellxgene-census-public-us-west-2.s3.us-west-2.amazonaws.com/cell-census/2025-11-08/h5ads/60d5175f-f477-48b2-8396-ad76be2c3310.h5ad`      | CELLxGENE Census copy of GEO GSM6592057 (Visium v1); 8.9 MB; 370 spots under tissue of 4,992; 0.3236 µm/px from the spot grid |
| Visium (Space Ranger) | `https://ftp.ncbi.nlm.nih.gov/geo/samples/GSM6592nnn/GSM6592057/suppl/` through a manifest ([example](./docs/dataset-manifest.md#standard-visium)) | The same sample's GEO files, gzipped; same spots and scale as the H5AD                                                        |

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

| Track                           | Scope                                                    | Status                                                              |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| Phase 1                         | Foundation and migration                                 | Done                                                                |
| Phase 2                         | Robust I/O, caching, S3 hardening                        | Done; image-path fallback **Reopened**                              |
| Phase 3                         | Multi-channel imaging                                    | Done. JPEG XR **Dropped**; Z-stack done 2026-11-09                  |
| Analysis slice (before Phase 4) | Gene selection, expression highlighting, cell info       | Done                                                                |
| Phase 4                         | Genes, gene sets, annotations, ROI, embeddings, HDF5     | Done; expression LOD redesigned in November                         |
| Phase 5                         | Production polish                                        | Done; Magic Lens QV and Xenium diagnostics **Reopened**             |
| Feature-fix pass                | Correctness before optimization                          | Ongoing; individual fixes recorded                                  |
| Optimization pass               | Interaction, memory, fetch/decode concurrency, rendering | Open. November rendering and expression work done                   |
| Phase 5.1                       | Transcript visualization with LOD                        | Done                                                                |
| Phase 6                         | Visium HD                                                | MVP done; low-res fallback and diagnostics **Reopened**             |
| Structural refactor             | 14 recommendations from `OPTIMIZATIONS.md`               | All closed by 2026-06-28                                            |
| Phase 7                         | AnnData H5AD                                             | MVP done; hardening open                                            |
| Phase 8                         | Image-only viewer and GeoJSON annotations                | Done (2026-07-09)                                                   |
| Phase 9                         | OME-Zarr image pyramids                                  | Done (2026-07-10)                                                   |
| Phase 10                        | SpatialData stores                                       | Done (2026-11-06)                                                   |
| Phase 11                        | Dataset manifest (`explorer.json`)                       | Done (2026-11-09)                                                   |
| Phase 12                        | 10x Atera output                                         | Done, with selected-gene transcripts (2026-11-09)                   |
| Phase 14                        | Standard Visium spots (original Phase 6 `VisiumDataset`) | Done (2026-11-10)                                                   |
| Phase 15                        | Interface redesign: layout, dark theme, legend, colours  | In progress: M1 and M2 done (2026-11-11); M3 (15.2) started, A done |

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
| `morphology_mip.ome.tif` / `morphology.ome.tif`  | geotiff + OpenJPEG | DAPI MIP / Z-stack (`Z plane` selector)                                                              |
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
  on every backend.
- `/var`: gene names.
- `/X`: expression, `n_obs × n_vars`. Dense, CSR, or CSC.
- `/obsm`: coordinates. The first present key of `X_spatial`, `spatial`,
  `X_umap`, `umap`, `X_tsne`, `X_tSNE`, `tsne`, `X_pca` is used, as
  micrometres. Fail with a schema error if none is usable or a value is not
  finite. Every valid numeric 2D `obsm` matrix is offered as an embedding.
- Duplicate or missing obs/var names are normalized deterministically.
- **Size gate.** Files up to 300 MiB (314,572,800 bytes) are downloaded whole
  and opened with h5wasm. Larger files need a sibling `DATASET.h5ad.json`
  reference, read with the Zarrita `ReferenceStore`, or a sibling
  `DATASET.h5ad.icechunk` repository, read with `icechunk-js`, so `/X` data
  and indices stay lazy. `scripts/make_h5ad_reference.py` writes either. The
  H5AD URL's query string is carried to the reference URL, so presigned URLs
  need a matching presigned reference.
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
- [x] Z-stack plane selector for OME-TIFF z-stacks such as `morphology.ome.tif`
      (`Layers` → `Z plane`, share link `z`; deferred, then done 2026-11-09).
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
- **Done** (2026-11-11): selected-feature density from `/density/gene`
  returned in [Phase 15](#phase-15--interface-redesign), task 15.1-J, read
  gene by gene. The feature-circle glyphs stay removed.

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
| `VisiumDataset` (spots, `tissue_positions.csv`, `circle` geometry) | Done in [Phase 14](#phase-14--standard-visium-spots)        |
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
  - [x] **Reopened (2026-11-08), fixed (2026-11-09):** numeric columns
        reach Cell Info ("Observations") and, via `metadataTracks()` at load,
        the `Cell color` → `Metadata` tracks.
  - [x] **Reopened (2026-11-08), fixed (2026-11-09):** boolean columns
        failed on the reference backend and in SpatialData tables; Zarr
        `BoolArray` values now read as 0/1, as on h5wasm.
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
- [x] Read boolean `obs` columns on the reference backend (2026-11-09).
- [x] Read `nullable-string-array` obs and var indexes, which anndata 0.13
      writes under pandas 3, plus nullable string, integer, and boolean `obs`
      columns, on every backend including SpatialData tables (2026-11-10).
- [x] Find reference keys with spaces, such as an obs column named
      `Cancer Epithelial`; `ReferenceStore` looks keys up percent-encoded
      (2026-11-10).
- [x] Document generating the `.h5ad.json` reference and add
      `scripts/make_h5ad_reference.py`, built on VirtualiZarr 2.8: kerchunk
      is in maintenance mode (fsspec/kerchunk#589, 2026-09-15), and its zarr 3
      releases fail on AnnData strings (2026-11-10).
- [x] Read Icechunk repositories as well as kerchunk JSON, the format
      VirtualiZarr and kerchunk now recommend (2026-11-10). `icechunk-js` 0.6.1
      (pure TypeScript; the official `@earthmover/icechunk` runs as WASM that
      needs COOP/COEP headers on the app's host). Large H5AD files use a
      `DATASET.h5ad.icechunk` companion when there is no `.h5ad.json`, and
      `make_h5ad_reference.py --icechunk` writes one. `.icechunk` URLs open
      AnnData, SpatialData (images, labels, tables), and OME-Zarr images.
      Manifests of arrays read at load are read ahead: heart file ready in
      63.7 s against 56.4 s for the JSON at 150 ms per request.
- [ ] Name Icechunk repositories in dataset manifests (`files.h5ad` must be
      an `.h5ad`; a SpatialData `files.store` or image `files.image` can
      already be an `.icechunk` URL).

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
      multi-channel TIFFs get colour channels (`89e99cf`). Since Phase 13,
      only the first six channels start on, and images with more than six
      auto-contrast only those.

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
- [ ] Imported CSV/JSON annotations must use Xenium cell IDs (shared with
      [Phase 7](#phase-7--anndata-h5ad)). Boolean `obs` columns were fixed on
      2026-11-09.
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
- [x] A `404`, or a `403` from a bucket that denies listing, on a byte-range
      file is titled "File not found or not readable", and a `5xx` "Host server
      error", instead of "Byte-range requests blocked" (`assertHttpRangeSupport`,
      `createStructuredLoadError`).

#### Known Gaps

- [ ] Files cannot be declared absent, so optional standard names are still
      probed.
- [ ] Not configurable yet: H5AD coordinate key, annotation set to select,
      channel colours and contrast, initial camera.
- [ ] No E2E test; the hosted fixtures are folders without manifests.

### Phase 12 — 10x Atera Output

Shipped 2026-11-09; selected-gene transcripts followed the same day (see
[Transcripts](#transcripts) below). Requested to support 10x Atera, the
Xenium successor, using the reference run in [1](#reference-datasets).

#### Product Decisions

- **DECISION:** A separate `atera` platform rather than a Xenium variant. The
  bundle has no Parquet files, so none of the Xenium DuckDB readers apply; the
  matrices are AnnData Zarr, so the AnnData readers do.
- **DECISION:** `AteraDataset` wraps `AnnDataH5adDataset` over the zipped
  CSR matrix, like `SpatialDataDataset` wraps a table. Cells, genes,
  annotations, tracks, embeddings, ROI cells, and cell profiles come from it.
- **DECISION:** Selected-gene overlays read whole columns from
  `csc_cell_feature_matrix.zarr.zip`, not CSR rows: a whole-slide CSR read
  would touch the full 236 M-value matrix.
- **DECISION:** The matrix zip has no consolidated metadata. Only the needed
  nodes' metadata is fetched, in parallel, and served from memory; opening
  every node in turn would mean about 600 sequential range requests.
- **DECISION:** Boundaries come from `cells.zarr.zip`
  `gridded_polygon_sets`, read by viewport tile and level, not the
  full-precision `polygon_sets` or the label masks.
- **DECISION:** `morphology_2d` opens through the Xenium morphology loader,
  since it is the same multi-file OME-TIFF layout as `morphology_focus`.

#### Delivered

- [x] Detection from `experiment.spatial`, probed alongside `explorer.json`
      and `experiment.xenium`; manifest platform `atera` with its own file
      roles; files located by manifest, then `experiment.spatial`, then
      standard name.
- [x] Overview with transcript counts, areas, nucleus counts, and
      segmentation methods; gene list limited to `Gene Expression` features.
- [x] Cell and nucleus boundaries (`<barcode>#nucleus-N` for extra nuclei).
- [x] Four-channel morphology; Leiden and Azimuth annotations; UMAP and PCA;
      metadata tracks; ROI with means; cell profile.
- [x] Diagnostics for the experiment file, both matrices, cells, and the
      image.
- [x] `docs/modalities/atera.md`; unit tests with an in-memory AnnData
      fixture; an `@live` E2E test against the reference run.
- [x] Checked in the browser against the reference run: ready in about 4 s;
      UMOD overlay about 0.85 s; 5,805 cell and 5,703 nucleus polygons in
      view in under 2 s.

#### Transcripts

Atera stores transcripts per gene, so the Transcripts tab shows selected
genes only.

- **DECISION:** Transcripts route by platform like selected-gene expression:
  `loadPlatformTranscriptCapabilities`, `…Aggregates`, and `…Viewport` in
  `platformAdapter.ts` send Atera to `AteraDataset` and leave every other
  platform on the Xenium loaders. A `geneRanges` capability marks per-gene
  outputs for the workflow; Xenium capabilities are unchanged.
- **DECISION:** Selected-gene density comes from
  `binned_transcripts.zarr.zip`: one nested `gene/<index>.zip` (about
  50–190 KB) per gene, read once and opened in memory. Its 5 µm counts are
  summed into squares that double in size until the view has at most 1,500.
- **DECISION:** The same pass counts the selected genes' transcripts in the
  view, and that count, not the all-transcript cell estimate, decides between
  density and exact points. On the reference run the count matched the exact
  QV ≥ 20 points (1,031 of 1,031 in a 600 × 400 µm box).
- **DECISION:** Exact points read each selected gene's `gene_offset` row
  range in the visible 2,000 µm tiles of `transcripts.zarr.zip`. Rows within a
  gene are not spatially sorted, so the whole range is read (at most about
  175,000 rows per gene per tile on the reference run); cell ids and nucleus
  overlap are read only for rows inside the box and above the minimum QV.
  `quality_score` is float16 and is read as uint16 bits, since zarrita needs
  `Float16Array`.
- **DECISION:** With no gene filter (no genes, or Feature filter set to All
  features), the layer is cell-summary squares from `obs/transcript_counts`
  with a message asking for a gene filter; Exact with no genes waits with the
  same request. All-gene native density or points would mean reading every
  gene.

Delivered:

- [x] Transcripts tab and overlay for Atera: per-gene density squares,
      selected-gene estimate, exact points with cell ids, QV, z, and nucleus
      overlap; gene-only filter disabled; no FOV column or hover row.
- [x] Diagnostics range-check both transcript zips, warning when missing.
- [x] Unit tests with in-memory stores, including a stored nested zip, delta
      and Fortran-order arrays, and float16 quality scores; workflow tests for
      the per-gene branch; the `@live` E2E test covers density, cell-summary,
      and exact points.
- [x] Checked in the browser against the reference run: UMOD whole-slide
      density 165 squares (640 µm) summing to the stored 1,914,072; at 4 px/µm
      7,645 exact points against an estimate of 7,689, about 5 s cold and
      1.4 s with the range cache warm.

#### Known Gaps

- [ ] Transcripts: no ROI transcript export or cell z histogram; density
      always counts QV ≥ 20 (the binned store's threshold), whatever `Min QV`
      says.
- [ ] Magic Lens is unavailable.
- [ ] Azimuth category colours (`obs/<column>/color`, packed RGBA) are not
      used.
- [ ] The 3D DAPI stack (`morphology_3d/`) is not shown with the dataset; it
      opens as an image URL with a `Z plane` slider.

### Phase 13 — QPTIFF Images

Shipped 2026-11-09. Requested to view Akoya PhenoCycler scans, using the
post-Xenium skin scan in BioImage Archive `S-BIAD3788`
(`PostXeniumAkoya/MH_BCN_skin_X0072771_post-Xenium_Scan1.er.qptiff`: 81 GB,
61 channels of 24,960 × 48,960 16-bit LZW, 0.505 µm/px).

#### Product Decisions

- **DECISION:** Read QPTIFF in the TIFF loader rather than a new platform.
  It is an image-only source, a custom layer, or a manifest `image` like any
  TIFF; only the IFD layout and metadata differ. See
  [image.md](./docs/modalities/image.md#qptiff).
- **DECISION:** Walk the IFD chain once per file through a geotiff block
  cache (1 MiB blocks) and share it between channel loaders. Akoya writes all
  369 IFDs in the first 7.5 MB, so opening takes 8 range requests instead of
  370 sequential ones (about 63 s to EBI).
- **DECISION:** Read a channel's tile offsets on its first tile fetch. All
  channels' offsets as maps would cost about 35 MB here, and several hundred
  MB for whole-slide scans with 100 channels.
- **DECISION:** Images with more than six channels start with the first six
  on and auto-contrast only those; other channels are auto-contrasted when
  first turned on. Enabling and auto-contrasting all 61 would fetch about
  1,500 coarse tiles at load.

#### Delivered

- [x] `.qptiff`/`.qptif` detection, plus QPI image descriptions in files
      with a `.tif` name.
- [x] Channels named by biomarker (fluorophore when blank) in scanner
      colours; pyramid from reduced-resolution IFDs; pixel size from
      `XResolution`.
- [x] Unit tests with an in-memory QPTIFF served by range requests.
- [x] Checked in the browser against the scan above: the IFD walk took about
      4.5 s (8 sequential 1 MiB reads); nuclei and Keratin 14 line up at full
      resolution with no tile seams.

#### Known Gaps

- [ ] The stripped smallest pyramid level is not shown.
- [ ] Auto-contrast reads the coarsest level's tiles one at a time: about
      15 s per channel against EBI.
- [ ] QPTIFF placement over Xenium (registration) is not supported.

### Phase 14 — Standard Visium Spots

Shipped 2026-11-10. Standard Visium (v1/v2, 55 µm spots) is the most common
public spatial assay. Requested: Space Ranger output with its H&E images, and
AnnData with `uns/spatial/<library>/images` and the scale factors. Checked
against GEO `GSM6592057` in both forms: the Space Ranger files on GEO (through
a manifest) and the CELLxGENE Census `.h5ad` of the same sample. See
[visium.md](./docs/modalities/visium.md).

#### Product Decisions

- **DECISION:** One `visium` platform for both sources, read through the
  AnnData reader. A Space Ranger folder is turned into an in-memory AnnData
  table with scanpy's `read_visium` layout (`memorySource`), so spots, genes,
  clusters, embeddings, ROI, and expression use the H5AD paths unchanged. Not
  a third Visium class beside `VisiumHdDataset`: standard Visium is a few
  thousand spots, not a grid of millions of bins.
- **DECISION:** An `.h5ad` stays detected by its suffix and becomes `visium`
  after it is read, when `uns/spatial/<library>` exists and coordinates come
  from `obsm/spatial`. Detection cannot see inside the file without reading
  it.
- **DECISION:** Micrometres per pixel come from an affine fit of spot pixels
  against `array_row`/`array_col` (100 µm pitch), not from
  `spot_diameter_fullres`, which 10x documents as a 60-70 µm visualization
  estimate. Fallbacks: declared `microns_per_pixel`, nearest-neighbour spot
  spacing, then the spot diameter as 65 µm with a notice.
- **DECISION:** Draw spots at the 55 µm capture size, not the 65 µm
  visualization diameter, and keep that size at every zoom (`trueSizePoints`
  on the platform adapter) instead of the usual screen-pixel cap.
- **DECISION:** Hide `in_tissue` 0 spots. CELLxGENE keeps all 4,992 array
  spots; Space Ranger's filtered matrix already drops them.
- **DECISION:** Tissue images stay `flat` images. `uns` arrays are written to
  an uncompressed BMP object URL (no canvas needed, testable); GEO's
  `.png.gz` images are decompressed into object URLs.
- **DECISION:** Read the Space Ranger matrix whole (300 MB limit, as `.h5ad`),
  not through the Visium HD lazy-range worker: selected-gene overlays scan
  every spot, and standard Visium matrices are small (1-50 MB typically).

#### Delivered

- [x] Folder detection (Space Ranger 2.0+ and 1.x positions names) before
      the Visium HD tiers; `visium` manifest platform with every file
      relocatable and gzip allowed; JSON Schema updated.
- [x] 10x HDF5 matrix reader (Cell Ranger 3+ `/matrix` and Cell Ranger 2
      per-genome groups); `library_ids`, chemistry, and software version.
- [x] `uns/spatial` placement: units, off-tissue spots, several libraries,
      scale factors, `hires`/`lowres` arrays (uint8 or 0-1 float).
- [x] Spot outlines from `elements(bbox)`; true-size points and expression
      dots; Dataset tab panel with library, spots, chemistry, scale, and a
      `Tissue image` select (High-res, Low-res, None).
- [x] Diagnostics for Space Ranger folders (no Range support needed).
- [x] Unit tests for parsing, units, BMP encoding, the Space Ranger reader,
      `uns/spatial`, detection, manifests, the adapter, the lifecycle, and the
      Dataset tab; Playwright smoke with a routed Space Ranger folder and a
      live test against the Census `.h5ad`.

#### Known Gaps

- [ ] `spaceranger aggr` output (per-library `spatial/<library>/`) is not
      detected.
- [ ] The full-resolution microscope image is not shown.
- [ ] k-means clusterings and `spatial_enrichment.csv` are not read.

#### Follow-Up (2026-11-10)

- [x] `Show off-tissue spots` and a `Library` select for multi-library
      `.h5ad` files. Both re-place spots from data read once
      (`setVisiumView`) and reload through the normal load path, keeping
      genes and colours; a library change clears the ROI.
- [x] Share link: `vimg`, `vlib`, and `voff`, restored on open.
- [x] Categorical `var/feature_name` gene symbols landed separately on `main`
      (`05c4092`, with Ensembl IDs kept as search aliases); nothing more was
      needed for CELLxGENE Visium files.
- [x] The CELLxGENE heart example now opens as Visium; its description says
      2,913 spots under tissue of 4,992.

### Phase 15 — Interface Redesign

Planned 2026-11-11. Milestone M1 (15.0 and 15.1 A, B, C, D, E, G, H, K, M)
and M2 (15.1 F, I, J, L) done 2026-11-11; M3, the new shell (15.2), started
with A (section models) done. The
user asked for a usability review of the
interface and then a plan for the changes. The plan rests on:

- The UI review of 2026-11-10. It walked through eight tasks on the hosted
  Xenium demo (1,414,155 cells) and the Census Visium H5AD, checked them
  against Nielsen's heuristics, and took screenshots at 1440×900, 1024×700 and
  390 px.
- A layout comparison with Vitessce, CELLxGENE Explorer, TissUUmaps 3/4 and
  10x Explorer. The 10x Explorer web viewer was checked hands-on on 2026-11-11.
- A code map of the shell, viewer, tests and docs made on 2026-11-11. It is
  cited below as `file:line`; line numbers drift as the code changes.

The user decided on 2026-11-11:

- a dark theme (D11);
- no transition period for the old tabs (D12);
- examples fetched from GitHub at runtime (D9);
- selected-gene transcript density reopened (D13);
- Magic Lens keeps its name but leaves its tab (D14);
- `@axe-core/playwright` as a dev dependency (D10).

Sizes are for one developer: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

#### Goals And Non-Goals

Goals:

- Fix every High and Medium finding in
  [the findings](#findings-from-the-ui-review),
  confirmed by re-running the eight review tasks.
- Move to the 10x Explorer layout model: a top bar, a layer panel organised by
  data type, floating result cards, and canvas tools and legend.
- Meet WCAG 2.2 AA contrast for all text, with no control text below 12 px.
- Keep every feature unless a decision below removes it, on all seven
  platforms: Xenium, Atera, Visium, Visium HD, H5AD, SpatialData and Image.
- Keep existing share links and dataset manifest `defaults` working.

Non-goals:

- A user-arranged multi-view grid like Vitessce's.
- New analysis beyond ranking ROI genes against the rest of the tissue (see
  15.4-B). No differential expression between arbitrary groups and no
  clustering.
- A mobile-first design. Screens under 860 px stay usable but are not
  optimised.
- Data-path performance work, which belongs to the existing optimization pass.

#### Findings From The UI Review

| ID  | Finding                                                                                                                                                                          | Severity | Fixed in       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------- |
| F1  | A selected gene silently overrides `Cell color`. Loading clusters while a gene is selected changes nothing on the map (`rendering/cellPointStyle.ts:26–43`).                     | High     | 15.1-A         |
| F2  | There is no legend on the canvas. The colour scale exists only inside the Genes tab.                                                                                             | High     | 15.1-C         |
| F3  | Clicking a cell shows no highlight and does not open its details (`App.tsx:2181–2193`; nothing in `rendering/` draws a selection).                                               | High     | 15.1-D, 15.2   |
| F4  | A failed load wipes the dataset already on screen (`useDatasetLifecycle.ts:912–1030` runs before detection).                                                                     | High     | 15.1-F         |
| F5  | 404, 403 and CORS failures are reported as "Unsupported spatial dataset layout" (`useDatasetLifecycle.ts:1594`).                                                                 | High     | 15.1-E         |
| F6  | The see-through panel over the dark canvas gives text a contrast of 2.2–2.3:1.                                                                                                   | High     | 15.0-A, 15.1-K |
| F7  | 106 of the 116 font sizes are under 11 px, and 48 rules force uppercase.                                                                                                         | High     | 15.1-K         |
| F8  | Developer information sits in the user UI: the deck.gl layer and budget lines, the zoom number, the Log, and the matrix and fallback notices.                                    | Medium   | 15.1-H, 15.2-F |
| F9  | Selecting a second gene silently sums the two into one score, and the colour bar names neither gene nor unit.                                                                    | Medium   | 15.1-A, 15.1-C |
| F10 | Gene search is not ranked (NIPSNAP1 comes before SNAP25), gene chips have no ×, and "No matching genes" appears straight after a pick.                                           | Medium   | 15.1-B         |
| F11 | With genes selected, the transcript layer still shows density for all transcripts, at 85% opacity (`useTranscriptWorkflow.ts:511`).                                              | Medium   | 15.1-J         |
| F12 | Esc does nothing. Tools are three separate flags that only partly exclude each other, and nothing shows that drawing mode is on.                                                 | Medium   | 15.1-G         |
| F13 | Only one ROI at a time. Its top genes are ranked by raw count, and the gene rows can't be clicked.                                                                               | Medium   | 15.4-A, 15.4-B |
| F14 | The Xenium default annotation set "All" stacks 10 clusterings. Clusters are listed twice. H5AD shows raw ID columns, and spot counts include hidden off-tissue spots.            | Medium   | 15.1-I         |
| F15 | There is no start screen and no examples. The demo URL is prefilled with no explanation.                                                                                         | Medium   | 15.3-A         |
| F16 | There is no Copy link button. The URL hash is about 650 characters because it includes defaults. Cluster sets are not shared, and typing in the URL box rewrites the share link. | Medium   | 15.1-L         |
| F17 | Clear and Remove can't be undone, and long queries can't be cancelled.                                                                                                           | Medium   | 15.3-C, 15.3-D |
| F18 | Fit to view assumes a 720 px viewport and ignores the panel (`rendering/overviewViewState.ts:15–60`). At 1024 px wide the panel covers 41% of the canvas.                        | Medium   | 15.2-E         |
| F19 | The page title is "viewer" and there is no favicon.                                                                                                                              | Low      | 15.1-M         |
| F20 | Units are written inconsistently (um, um^2, um2, µm), and some controls are styled differently (a native select, a default-blue slider).                                         | Low      | 15.0-B, 15.1-K |
| F21 | Magic Lens `Min QV` does nothing. This is an existing [open item](#12-open-items).                                                                                               | Low      | 15.2-D         |
| F22 | There is no in-app help, and keyboard shortcuts are mentioned only in screen-reader text.                                                                                        | Low      | 15.3-B         |
| F23 | The embedding is a 300 px scatter plot placed above the Cell info.                                                                                                               | Low      | 15.2-G         |

#### Target Design

##### Layout (1024 px and wider)

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ Explorer │ Sob23 brain ▾  Xenium · 1.41 M cells · 5,001 genes  ⓘ │ ✋ ▭ ◯ ⟷ ◎ │ ⧉ Share ? ⚙ │ 48 px
├───────────────────────────────────────────────────────────────┬─────────────────────────┤
│ ┌ Selection 1 ──────────── × ┐                                 │ ☑ Image               › │
│ │ 6,229 cells · 0.94 mm²      │                                │ ☑ Cells    graphclust ⌄ │
│ │ Genes │ Cells │ Transcripts │                                │   Colour by [Clusters ▾]│
│ └─────────────────────────────┘                                │   ■ Cluster 1   149,084 │
│                                                                │   ■ Cluster 2   128,390 │
│                         canvas                                 │ ☐ Transcripts         › │
│ ┌ graphclust ─────────────┐                        [−][+][⤢]   │ ☐ Annotations         › │
│ │ ■ 1  ■ 2  ■ 3  … +9      │                        ├─ 2 mm ─┤  │                         │
│ └─────────────────────────┘    X 3,375 µm  Y 5,522 µm          │ 360 px, opaque          │
└───────────────────────────────────────────────────────────────┴─────────────────────────┘
```

- **Top bar** (48 px), left to right:
  - The dataset name. It opens a menu: Open dataset…, Examples, Recent.
  - A summary chip with platform and counts.
  - ⓘ, which opens the dataset info drawer.
  - The tool group: Pan `P`, Box `R`, Lasso `L`, Measure `M`, Magic Lens `O`.
  - Share (copy link), Help `?`, Settings.
- **Layer panel** (right, 360 px, opaque), with sections Image, Cells (titled
  Spots or Bins on those platforms), Transcripts and Annotations.
  - Each header holds a visibility checkbox, the name, a one-line state such
    as "graphclust" or "4 genes · points", and an arrow.
  - Sections stay mounted while collapsed, as HUD panels do today, so local
    state such as a gene search survives.
  - The whole panel collapses to a 40 px strip with `\`.
- **Cards** (top left, 360 px): Selection, Cell or Bin, Transcript, Magic Lens. Each
  card can be closed and has Go to.
- **Canvas furniture:**
  - Bottom left: the legend, plus the progress and notification stack.
  - Bottom right: zoom −, +, Fit, and the scale bar.
  - Bottom centre: the cursor coordinates.
  - The zoom number appears only in debug mode.
- **Info drawer** (left, 380 px, over the canvas) with these sections:
  - Dataset: platform, counts, gene panel, µm/px and where it came from, image.
  - About: the manifest's name, description and source.
  - View options: SpatialData coordinate system, image and scale; Visium
    library.
  - Open another dataset.
  - Diagnostics.
- **Start screen** when no dataset is loaded: a URL field and Open button, an
  example gallery, recent datasets, and a link to the supported formats.
- **Under 860 px:**
  - The tools fold into an overflow menu.
  - The layer panel becomes a bottom sheet that peeks 56 px.
  - Cards become sheets.

##### Visual System

- **Tokens** live in `src/styles/tokens.css`:
  - Colour roles: `--surface-0…3`, `--text-1…3`, `--accent`,
    `--accent-contrast`, `--border`, `--focus`, `--danger`, `--warning`,
    `--success`, `--canvas`.
  - Type scale: 11 caption, 12 control, 13 body, 15 title, 18 heading.
  - A 4-point spacing scale, plus radius and shadow tokens.
  - z-index layers: canvas 0–6, legend 8, cards 10, panel 12, drawer 14,
    popover 16, toast 18.
- **Dark theme (D11).**
  - Every surface is near-black or dark grey and opaque. Panel, cards, legend,
    drawer, popovers and start screen all match the black canvas, so they look
    the same over fluorescence, H&E and density layers.
  - Text runs from near-white to mid-grey.
  - The current green and magenta stay as the accent and focus colours,
    lightened until they pass contrast on dark surfaces.
  - `color-scheme: dark` makes native controls and scrollbars match.
  - There is no light theme for now. The tokens leave room to add one later.
- Surfaces are opaque. No backdrop blur behind text.
- Labels and headings use sentence case. Buttons keep their current Title Case
  names, which 160 test queries depend on. No CSS uppercase anywhere.
- One length and area formatter produces µm and µm² everywhere.
- Icons are inline SVG, pinned in the repo. No icon fonts and no CDN.

#### Product Decisions

- **DECISION D1 — Layout model.** Use 10x Explorer's model. It is the closest
  match in domain, it groups controls by data type, and it leaves about 75% of
  a 1440 px screen to the canvas. CELLxGENE's two fixed side panels leave about
  49%.
- **DECISION D2 — One source for cell colour.** `Colour by` has six options:
  Clusters (an annotation set), Gene expression, Metadata, Transcript count,
  Cell area, and None.
  - Gene expression is one of these options, never an override.
  - Picking genes in the Cells section switches `Colour by` to Gene
    expression. Picking genes in Transcripts does not.
  - Removing the last gene restores the previous mode.
- **DECISION D3 — One shared gene list** (the URL's `genes=`). Cells use it
  when `Colour by` is Gene expression, and Transcripts use it when the filter
  is Selected genes.
- **DECISION D4 — Clusters belong to Cells**, as 10x Explorer's "Groups" do.
  The Annotations section holds selections and GeoJSON shapes. Choosing a set
  loads it; there is no separate Load button.
- **DECISION D5 — Casing.** Buttons keep Title Case and labels use sentence
  case. The CSS uppercase rules go.
- **DECISION D6 — Developer information** moves to Diagnostics in the info
  drawer. The deck.gl layer and budget lines and the zoom number appear only
  with `?debug=1` or Settings › Show debug info.
- **DECISION D7 — Share URL version 2.**
  - Default values are left out.
  - `panel=`, `card=` and `tool=` replace `tab=`, and version 1 links are
    mapped.
  - `dataset=` follows the loaded dataset, not the text box.
  - Dataset cluster sets are shared through `groups=`.
- **DECISION D8 — Tools are one `activeTool` value.** Esc returns to Pan, and
  finishing a shape returns to Pan.
- **DECISION D9 — Examples are fetched from GitHub at runtime** (user,
  2026-11-11). New examples appear without a new release.
  - The source is the raw `examples/index.json` on `main`. A build can point
    it elsewhere.
  - Gallery links are built from `manifestUrl`, so self-hosted deployments
    link to themselves.
  - If the fetch fails, the start screen still offers the demo dataset.
- **DECISION D10 — No new runtime dependencies for the UI.** Popovers,
  drawers and tooltips are built in-house. The one new dev dependency is
  `@axe-core/playwright`, pinned, for accessibility checks (user,
  2026-11-11).
- **DECISION D11 — Dark theme** (user, 2026-11-11). It ships in 15.0-A, and
  [Visual System](#visual-system) describes it.
- **DECISION D12 — No transition period** (user, 2026-11-11). No tutorials
  depend on the current tabs. The old shell is deleted when the new one
  becomes the default (15.2-J), and old `tab=` links are still mapped.
- **DECISION D13 — Selected-gene transcript density is reopened** (user,
  2026-11-11). This reverses [Appendix A](#appendix-a-reconciliation-notes) row 10. Density
  follows the gene filter; see 15.1-J.
- **DECISION D14 — Magic Lens keeps its name and leaves its tab** (user,
  2026-11-11).
  - The cursor lens becomes the Magic Lens tool in the top bar (`O`), with its
    results in a Magic Lens card.
  - The viewport scope becomes "Summarise view" in the tool's popover.
  - The ROI scope becomes the Selection card's Transcripts tab.

#### Where Each Control Goes

| Today: tab › control                                                 | New home                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Dataset › URL, Morphology/Tissue image, Load Dataset                 | Start screen; Info drawer › Open another dataset                                         |
| Dataset › Boundary limit                                             | Open another dataset › Advanced; Settings                                                |
| Dataset › Bin size (Visium HD)                                       | Bins section                                                                             |
| Dataset › Coordinate system, Image, µm per unit (SpatialData)        | Info drawer › View options (the image choice is also in the Image section)               |
| Dataset › Tissue image, Show off-tissue spots (Visium)               | Image section; Spots section                                                             |
| Dataset › Library (Visium)                                           | Info drawer › View options                                                               |
| Dataset › Diagnose, download, Matrix warning, Fallbacks, Issues, Log | Info drawer › Diagnostics (warnings and fallbacks as one "Data access notes (n)" item)   |
| Dataset › About this dataset                                         | Info drawer › About                                                                      |
| Layers › Layer stack line                                            | Diagnostics, debug mode only                                                             |
| Layers › Cell/Nucleus boundaries, fill and boundary opacity          | Cells › Appearance                                                                       |
| Layers › Hover tooltips, Mouse coordinates unit                      | Settings                                                                                 |
| Layers › Image opacity, Z plane, channels, custom image layers       | Image section                                                                            |
| Layers › Distance measure, Measure unit, Clear Measurement           | Measure tool and its popover                                                             |
| Genes › Search, list, chips, gene sets                               | Cells › Colour by › Gene expression (gene picker)                                        |
| Genes › Signature score, Gene scale                                  | Cells › Gene expression ("Combine genes" when there are 2 or more; colour scale); legend |
| Genes › Expression detail                                            | Cells › Advanced                                                                         |
| Genes › Cell color, Metadata track                                   | Cells › Colour by                                                                        |
| Genes › status line                                                  | Legend footer ("231,404 of 1,414,155 cells express SNAP25")                              |
| Transcripts › all controls                                           | Transcripts section: Display, Genes, Appearance, Filters, and Advanced (budget meter)    |
| Transcripts › status panel, pinned transcript                        | Section header summary; Transcript card                                                  |
| Magic Lens › cursor lens, radius                                     | Magic Lens tool and its popover; Magic Lens card                                         |
| Magic Lens › Viewport scope                                          | Magic Lens popover › Summarise view                                                      |
| Magic Lens › ROI scope                                               | Selection card › Transcripts tab                                                         |
| Magic Lens › Min QV                                                  | Hidden until it changes results                                                          |
| Annotations › set, load/clear, labels, set sizes                     | Cells › Colour by › Clusters (one list: swatch, visibility, name, count, %)              |
| Annotations › Import file/URL, Export                                | Cells › Clusters ⋯ menu                                                                  |
| Annotations › Metadata tracks                                        | Cells › Colour by › Metadata                                                             |
| Annotations › GeoJSON import, export, shapes                         | Annotations section                                                                      |
| ROI › Draw Box, Draw Lasso, Clear                                    | Top-bar tools; Esc; the card's Delete                                                    |
| ROI › name, summary, top genes, Save, exports                        | Selection card                                                                           |
| Cell › Embeddings                                                    | Embedding panel (Cells › Show embedding)                                                 |
| Cell › Cell/Bin info, gene expression, Clear                         | Cell or Bin card                                                                         |
| Shell › Hide Controls                                                | Panel collapse button and `\`                                                            |

#### Work Rules

From [§2](#2-working-rules):

- One checkbox is one reviewable PR, with tests and docs in the same PR.
- A refactor PR does not change behaviour, and a behaviour PR does not
  restructure.
- Every PR passes `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build` and the E2E smoke tests.
- PRs that change UI also go through this **platform checklist**:
  - the Xenium demo;
  - Atera kidney;
  - Census Visium H5AD;
  - the Visium HD reference;
  - PBMC3K H5AD;
  - the SpatialData Visium store;
  - an OME-TIFF and a QPTIFF image.

#### 15.0 Foundations

These change almost nothing on screen, but every later step depends on them.

- [x] **A. Dark tokens.** Add `tokens.css` with the dark theme in
      [Visual System](#visual-system), then convert the 12 stylesheets one file at
      a time, replacing about 440 hard-coded colours. (M)
  - This is where the theme changes: the panel, inputs, chips and status
    panels go dark and opaque.
  - Layout, sizes and copy stay as they are.
  - Set `color-scheme: dark` and a dark `theme-color` in `index.html`, so
    native controls and scrollbars match.
  - Done 2026-11-11. All 413 colour literals in the 11 other stylesheets now
    use tokens, and none are left outside `tokens.css`. The five
    `backdrop-filter` blurs are gone and every surface is opaque.
  - Colour roles: four surfaces, three text levels, `--border` and
    `--border-strong`, and `--accent` (green), `--focus` and `--highlight`
    (magenta), `--danger`, `--warning`, with `-soft`/`-border` tints made with
    `color-mix()`. Canvas marks have their own `--overlay-*` tokens.
  - Every text token is at least 5.4:1 on every surface, and each role colour
    on its own tint at least 5.4:1. `--border-strong` is 3:1 against the
    panel, for form controls.
  - Mapping rules: errors and Remove buttons take `--danger`, selected genes
    and transcript hover take `--highlight`, pressed segments become solid
    accent, and hover fills switch their text to `--accent-contrast` or
    `--danger-contrast`.
  - The type, spacing, radius, shadow and z-index tokens are defined but not
    used yet; 15.1-K moves the sizes to them.
  - Not converted: the embedding plot draws on its own canvas with fixed
    colours (`EmbeddingPanel.tsx`). It was already dark.
- [x] **B. Primitives** in `src/components/ui/`: Button, IconButton,
      Segmented, Select, Checkbox, Switch, Slider, NumberField, Chip (removable),
      Disclosure, Popover, Tooltip, Kbd, Card, Drawer, Sheet. (M)
  - Each one requires `title` in its props type.
  - Extend `nativeTitleAudit.test.ts` to check these components and
    `<summary>`; it currently checks only native elements.
  - No existing UI is migrated in this PR.
  - Done 2026-11-11: the 16 primitives, styled in `src/styles/ui.css` with
    tokens only and the new type scale, and exported from
    `components/ui/index.ts`. `title` is the native tooltip on controls, the
    heading of Card and Drawer, the handle text of Sheet, the bubble text of
    Tooltip and the key's meaning on Kbd.
  - Behaviour: NumberField commits on Enter or blur and clamps; Escape
    reverts it. Popover moves focus in and closes on Escape (focus back to
    the trigger) or an outside click. Drawer is not modal, stays mounted
    while closed and returns focus when it closes. Disclosure and Sheet keep
    their content mounted. Tooltip shows after 400 ms of hover or at once on
    focus.
  - `primitives.test.tsx` covers each one, and a line per primitive with
    `@ts-expect-error` makes `tsc` fail if `title` ever becomes optional.
  - The audit now also checks `<summary>` and every component exported from
    `components/ui`. A native control that is the direct child of a Tooltip
    counts as titled, because a native title would show a second tooltip.
- [x] **C. One source for colour scales.** Generate gradient CSS from the
      stops in `rendering/deckLayerColors.ts` with `colorScaleGradient(scale)`.
      Replace the hand-copied gradients in `transcript-controls.css:212–398`. (S)
  - Done 2026-11-11 as two functions, because both families have scales
    called magma, viridis, cividis and teal with different stops:
    `geneExpressionScaleGradient(scale)` and
    `transcriptDensityScaleGradient(scale)`. The 13 CSS rules are gone.
  - The previews now show the map's own opacity (about 0.5 at the low end for
    genes and 0.38 for density). The CSS copies used 0.82 and 0.62. A test
    checks each scale against `geneExpressionColor` and
    `transcriptDensityColor` at 0, 0.5 and 1.
- [x] **D. Test indirection.** Replace `openHudTab`
      (`src/test/appTestHarness.ts:171`) with `openControls(area)`. Area names
      follow the new homes and map to today's tabs, and E2E gets the same helper.
      This touches 75 calls and changes no assertions, so the later shell swap only
      has to edit the helper. (S)
  - Done 2026-11-11. `src/test/controlAreas.ts` maps 20 areas, such as
    `color-by`, `cell-appearance` and `tissue-image`, to today's tabs.
    `openControls` in `appTestHarness.ts` and `tests/e2e/controls.ts` reads it;
    the E2E version returns the panel.
  - Tests that read controls from two future homes now open each area in turn,
    for example `image` and then `cell-appearance` on today's Layers tab.
  - Not covered: tests that use the Dataset tab without clicking it, because
    it is open by default. 15.2-J must add `openControls` calls there.
- [x] **E. Defaults constant.** Add `DEFAULT_SHAREABLE_STATE`, taken from the
      same defaults that `useAppDomainState.ts` uses, plus a test that checks they
      agree. 15.1-L needs it. (S)
  - Done 2026-11-11 in `features/app-shell/shareableDefaults.ts`.
    `useAppDomainState` now reads its starting values from it, and
    `shareableDefaults.test.tsx` checks that the hook starts with exactly these
    values and keeps them when a link spells them all out.
  - Settings that depend on the dataset have no default. Neither does the
    boundary limit, which comes from the device's performance budget, so
    15.1-L must keep writing it.
- [x] **F. Accessibility check.** Add `@axe-core/playwright` (pinned, dev
      only) and run axe in the E2E smoke tests on the main states: the empty
      viewer, a loaded fixture, and each tab open. (S)
  - Today's violations go in a baseline file, `tests/e2e/axe-baseline.json`,
    keyed by rule and target.
  - A new violation fails the test, and the baseline only shrinks.
  - Done 2026-11-11 with `@axe-core/playwright` 4.14.0. A new smoke test,
    "has no accessibility violations beyond the axe baseline", opens every
    tab on the empty viewer and again with the tiny H5AD fixture loaded and a
    gene selected, and runs the WCAG 2.2 A and AA rules each time
    (`tests/e2e/axe.ts`). The other smoke tests do not run axe, so that one
    walk defines the baseline.
  - A listed violation that no state shows any more also fails, so fixes
    must shrink the file. `UPDATE_AXE_BASELINE=1` rewrites it. React `useId`
    values are left out of targets because they change with render order.
  - The baseline has five entries and no colour-contrast entries:
    `aria-allowed-attr` on two gene buttons, `aria-prohibited-attr` on the
    density scale preview, `label-content-name-mismatch` on one button, and
    `scrollable-region-focusable` on a list.
  - The old light theme also had no contrast violations, but only because
    axe cannot work out contrast through a see-through panel over the
    canvas. With opaque surfaces, axe checks 25–43 text nodes per tab and
    finds none below AA, leaving 1–5 per tab unresolved, such as text over
    a gradient. The contrast test in 15.1-K covers what axe cannot.

#### 15.1 Behaviour Fixes In The Current Layout

These go into the existing tabs first, so users benefit before the re-layout.
They are independent unless a note says otherwise.

- [x] **A. `Colour by` (F1, F9).** Add `'gene-expression'` to
      `ObservationColorMode` (`rendering/cellStyling.ts:5`). (M)
  - These places should follow the mode instead of `geneExpressionActive`:
    - `cellPointStyle.ts:26–43`
    - the boundary styling (`ViewerCore.tsx:689–718`, `App.tsx:754–761`)
    - the grid styling (`ViewerCore.tsx:627–633`, `App.tsx:773–779`)
    - the fill-opacity boost (`deckLayers.ts:237–245`)
  - Picking a gene sets the mode. Removing the last gene restores the previous
    mode. `Cell color` shows "Gene expression".
  - The manifest's `colorCellsBy` enum gains `gene-expression`
    (`public/schemas/explorer-manifest.v1.json:408`, parser, schema test).
  - Version 1 links that have `genes=` resolve to gene mode, which matches the
    old behaviour.
  - The score select appears only with 2 or more genes, labelled "Combine
    genes".
  - Done 2026-11-11. App.tsx passes the gene expression elements and
    `geneExpressionActive` to the viewer only in Gene expression mode, which
    covers the points, boundaries, grid and the fill-opacity boost in one
    place; `createObservationColorizer` returns null for the mode. With
    SNAP25 selected on the demo, loading clusters now shows the clusters.
  - `colorModeAfterGeneChange` (`genes/geneColorModeModel.ts`) holds the
    rule. Adding a gene in the Genes tab, or applying symbols or a saved
    set, switches to Gene expression; removing the last gene from either
    tab goes back to the last other mode; adding a transcript feature keeps
    the mode.
  - Links and manifests differ. A link always carries `cellColor`, so a link
    with genes opens in Gene expression (`sharedObservationColorMode`). A
    manifest names `colorCellsBy` only on purpose, so it wins, and genes
    without it mean Gene expression (`manifestObservationColorMode`). No
    manifest in `examples/` sets both.
  - Hover details for cells now carry gene counts only in Gene expression
    mode; Cell info still shows them in every mode.
- [x] **B. Gene search (F10).** (S)
  - Rank matches exact, then prefix, then alias prefix, then substring, in
    `filterGeneOptions` (`genes/geneControlsModel.ts:268–300`).
  - Give chips an × with `title="Remove {gene}"`, which E2E already looks for.
  - Clear the query after a pick.
  - Show "{gene} is already selected" rather than "No matching genes"
    (`GeneOptionList.tsx:21`).
  - Apply the same to the transcript feature search
    (`AppTranscriptHudPanel.tsx:157`).
  - Done 2026-11-11. `filterGeneOptions` ranks matches into exact (name or
    alias), name prefix, alias prefix, name substring and alias substring,
    keeping panel order within each rank; "snap" now lists SNAP25 before
    NIPSNAP1. The transcript feature search uses the same function.
  - Selected genes and transcript features are `Chip` primitives (15.0-B)
    whose × is named "Remove {gene}" (or "… from transcript features").
    Tests that clicked a chip by gene name now click its ×.
  - `geneSearchEmptyMessage` names the selected genes a search matches
    ("SNAP25 is already selected", up to three names and "and n more").
    Picking from the Genes list clears the search; the Transcripts search
    already did.
- [x] **C. Canvas legend (F2, F9; needs A).** `ViewerLegend` sits in the
      bottom-left stack as a sibling of `MemoDeckGL`, never inside it. (M)
  - Inputs: colour mode; gene names, score mode, scale and
    `geneExpressionScaleMax`; annotation colours, counts and visibility; the
    metadata track's min and max; the density scale and maximum; the point
    colour mode (`useViewerLayerData.ts:150–246`).
  - Continuous scales show a title, a gradient, and min/max with units.
  - Categories show the first 12 with visibility toggles, then "+k more".
  - It can be collapsed.
  - Extend the no-redraw test (`ViewerCore.test.tsx:1939–1962`) to cover it.
  - Done 2026-11-11. App builds the sections with `viewerLegendSections`
    (`app-shell/viewerLegendModel.ts`); `ViewerLegend` (memoised) only draws
    them, so collapsing it keeps its state local and the deck does not
    redraw. The no-redraw test covers collapsing and a category toggle.
  - Sections: gene expression, annotations (set prefix dropped from labels;
    the checkboxes call the same handler as the Annotations tab), metadata,
    cell area, transcript density, and transcript quality. Transcript count
    is the plain default and has no legend. Feature colours wait for 15.4-C.
  - The bottom-left stack now renders beside the viewport frame, not inside
    it: the frame has `role="img"`, and the axe check flagged the legend's
    checkboxes as nested interactive content.
  - Category lists go after the scales. On the demo, graphclust's 24 labels
    pushed the density scale out of the legend's scroll area.
  - New gradients for the legend share `colorsGradient`
    (`deckLayerColors.ts`): `cellAreaScaleGradient`, `metadataScaleGradient`
    and `transcriptQualityGradient`.
- [x] **D. Selected-cell highlight (F3).** (S–M)
  - For points, spots and bins, draw an SVG ring positioned with
    `rawDataPointToScreen` (`viewerMeasurements.ts:38`), so the deck does not
    redraw.
  - Add a memoised outline layer only while boundaries are drawn, keyed by
    cell ID.
  - A click opens the Cell tab until the cards arrive in 15.2. Esc clears the
    selection.
  - Done 2026-11-11. App describes the selection (`viewerSelectionHighlight`)
    and ViewerCore draws it as SVG next to the deck
    (`ViewerSelectionOverlay`), so selecting never redraws the map. The
    no-redraw test covers it.
  - Instead of a deck outline layer, boundaries are outlined in the same
    SVG: a cell picked as a point is outlined when its boundary is drawn,
    looked up by cell ID, and bins use their polygon. Points without a
    boundary get a ring at least 7 px across.
  - Esc on the canvas clears the selection (Esc for tools comes in 15.1-G).
  - ViewerCore's empty-array defaults are now constants. A parent re-render
    that left those props out used to hand deck.gl new layers.
- [x] **E. Load errors (F5).** At `useDatasetLifecycle.ts:1594`, use
      `detection.checked` (`datasetFactory.ts:1181–1214`) to raise specific
      errors. (M)
  - The kinds are:
    - not found (404, or 403 from a bucket that hides listings);
    - access denied;
    - blocked by CORS (a TypeError on HEAD);
    - unsupported layout, listing what was found.
  - Add these kinds to `errors/loadErrorModel.ts:1–10`, each with a title and
    a next step.
  - The error card offers Run diagnostics.
  - Done 2026-11-11. `classifyDatasetDetection`
    (`datasets/datasetDetectionError.ts`) reads the probes: any readable file
    means "unsupported" (listing what was found); a 401 means access denied;
    all 5xx means a server error; 403 or 404 means not found; no response at
    all means blocked, unless a folder listing ruled every file out. Both
    throw sites (`useDatasetLifecycle`, `createSpatialDataset`) raise a
    `DatasetDetectionError`.
  - `loadErrorModel` adds the codes `not-found`, `access-denied` and
    `blocked`. Each kind has a title and a next step, and the detail lists
    the first six files checked with their answers.
  - Checked in the browser: a missing folder on the Sanger bucket now says
    "Dataset not found" (28 files, HTTP 404), and example.com, which has no
    CORS, says "Request blocked". Both said "Unsupported spatial dataset
    layout" before. The Issues card offers Run Diagnostics.
- [x] **F. Keep the current dataset until the new one loads (F4).** This is its
      own PR and carries the most test work. (L)
  - Add a pending-load slot next to `loadState`.
  - Move the wipe (`useDatasetLifecycle.ts:912–1030`) and
    `onBeforeDatasetLoad` (`App.tsx:1924–1934`) to the success points (about
    :1123, :1462, :1540, :1677).
  - Tie `viewResetKey` (`App.tsx:827`) and the platform adapter to the loaded
    dataset.
  - On failure (:1705–1745), keep the old dataset and show an error toast.
  - Done 2026-11-11, on its own branch for its own PR. `startDatasetLoad`
    gives each load its own `AbortController`. With nothing ready on screen
    it commits at once, as before. With a dataset ready, that dataset stays,
    with its requests running, until the new one reaches its ready point;
    what the load would set before then (platform, boundary toggles, gene
    panel, annotation sets, Visium and SpatialData panels, manifest
    defaults, fallback notices, the Xenium warmup) is queued.
  - Committing aborts the old dataset's `datasetAbortRef` signal, moves
    `loadRequestIdRef` on, runs `onBeforeDatasetLoad` and the old reset,
    then applies the queue and the new data in one render. `viewResetKey`
    and the platform adapter follow, since `loadState` and the platform only
    change then.
  - The reset is rendered on its own first (`flushSync`). Without it a
    Visium library switch, which reloads the same URL, went from ready to
    ready in one render, effects keyed on the dataset's status and URL did
    not rerun, and gene expression stayed cleared (caught by the E2E
    library test).
  - A failure before the commit leaves the screen alone:
    `pendingDatasetLoadState` holds the error, shown by the Issues card and
    a `DatasetLoadToast` ("Dataset not found: missing could not be opened;
    output-XETG… is still open.", with `Dismiss`). While pending it is
    `loading`: the loading list shows the new name and `Load Dataset` is
    disabled, as before. A stalled load cannot be replaced until Cancel
    (15.3-D).
  - The Visium loading state carries the requested library and off-tissue
    choice (`requestedView`), so those controls show it while the old spots
    stay.
  - Checked in the browser on the live demo: a missing folder on the Sanger
    bucket left the demo on screen with the toast; PBMC3K replaced it when
    ready. Unit tests cover the failure, the queue order, a newer load
    dropping a pending one, and the same-URL render; all 20 E2E tests pass.
- [x] **G. Tools (F12).** (M)
  - Replace `magicLensActive`, `measurementEnabled` and `roiMode`
    (`useAppDomainState.ts:238, 366, 395`) with
    `activeTool: 'pan' | 'box' | 'lasso' | 'measure' | 'magic-lens'`.
  - One setter enforces that only one is on. It replaces the logic in
    `App.tsx:2993–3062`, `AppLayerHudPanel.tsx:230–240` and
    `useMagicLensWorkflow.ts:407–420`.
  - Esc cancels an unfinished shape and returns to Pan.
  - Add `onPointerCancel` to the ROI layer.
  - Clear `roiDraft` when the tool changes.
  - Add an `is-drawing` cursor class.
  - Return to Pan after a shape is finished.
  - Keep reading `lens=` from URLs.
  - Done 2026-11-11. `useAppDomainState` holds one `activeTool`
    (`app-shell/activeToolModel.ts`). `magicLensActive`,
    `measurementEnabled` and `roiMode` are derived from it, and their old
    setters are stable adapters over it. The workflows keep their
    interfaces, but turning one tool on turns the others off. The manual
    switching in App, the Layers panel and the Magic Lens workflow is gone.
  - Esc anywhere except a text field returns to Pan (a listener in App).
    Esc on the canvas clears the selection only when no tool is on.
  - ViewerCore drops a half-drawn shape when the ROI tool changes and on
    `pointercancel`, adds `is-drawing` to the frame, and shows a hint at the
    top of the canvas ("Drag to draw a box. Esc cancels."). That hint is what
    tells users a drawing mode is on (F12).
  - Finishing a box or lasso already returned to idle, which is now Pan.
- [x] **H. Developer information (F8).** (S)
  - Show the Layers header lines (`LayerHudPanel.tsx:152–161`) and the zoom
    number (`ViewerCore.tsx:1773–1787`) only in debug mode.
  - Merge Matrix warning and Fallbacks into one "Data access notes (n)" item.
  - Collapse the Log by default.
  - Show "HUD tab:" log lines only in debug mode.
  - Done 2026-11-11. Debug mode is `?debug=1` or `#debug=1`
    (`readDebugModeFromLocation`), read once at start; Settings › Show debug
    info comes with Settings in 15.2.
  - Matrix warning and Fallbacks are one closed `Disclosure`, "Data access
    notes (n)", and the Log is a closed "Log (n)". Both stay mounted.
  - The log held the only "Dataset ready" and "… image ready" lines, which
    15 E2E checks waited for. They now use `expectLogEntry`
    (`tests/e2e/controls.ts`), which opens the log first. A clearer "loaded"
    signal comes with the top bar summary in 15.2-B.
- [x] **I. Annotation sets (F14).** (M)
  - The Xenium default becomes `graphclust` (or the first group), not All.
  - Show one list per set, with the size bars merged into the rows: swatch,
    visibility, name without the set prefix, count and %.
  - For H5AD and SpatialData, put columns that look like IDs
    (`*_ontology_term_id`, `observation_joinid`, or more than 500 categories)
    under "More columns".
  - Leave hidden off-tissue spots out of the counts.
  - Done 2026-11-11. When a Xenium or Atera dataset's sets are listed,
    `defaultAnnotationGroupId` selects graphclust, or the first set, instead
    of All. A link's `groups=` still wins.
  - The Annotations tab shows one list per set (`AnnotationSetLists`): the
    set heading has its total and visibility, and each row has swatch,
    visibility, the name without the set prefix, a size bar, count, % and
    ×. The separate Set sizes plots are gone. Accessible names keep the full
    label ("Remove kmeans 3: Cluster 1").
  - `isIdLikeAnnotationGroup` moves `*_ontology_term_id`,
    `observation_joinid` and sets with more than 500 categories under a
    "More columns" group in the select.
  - With Visium off-tissue spots hidden, `annotationSizePlots` counts only
    placed spots (`placedCellIds`).
  - The set heading is an `h4`, not a `<label>`: the default set for
    imported labels is called "Loaded annotations", and a label would have
    named its checkbox the same as the list.
- [x] **J. Selected-gene transcript density (F11).** This reopens
      [Appendix A](#appendix-a-reconciliation-notes) row 10, by user decision on 2026-11-11.
      (M–L)
  - When the filter is Selected genes and at least one gene is chosen, request
    density from `/density/gene`. The reader already does this
    (`data/transcriptZarr.ts:300–325`); the workflow switches it off by
    passing `EMPTY_GENE_LIST` (`useTranscriptWorkflow.ts:511`). The request
    key already includes the gene names.
  - With All features, or with no genes chosen, keep the `/grids` density for
    all transcripts, labelled "All transcripts".
  - Normalise the colour to the selected genes' maximum (`scaleMax`). The
    legend reads, for example, "SNAP25 transcripts per 50 µm bin", and the
    hover card shows selected-gene counts.
  - Base Auto's switch from density to points on the selected genes'
    count in view, as Atera already does.
  - Measure time and memory on the demo (5,001 genes) with 1, 8 and 25 genes.
    Set a gene limit from those numbers. Above the limit, say why, and keep
    showing the points.
  - Show the point budget as a meter ("28,724 of 100,000 points", with Edit
    max) instead of number fields.
  - Update `docs/modalities/xenium.md`, and resolve the **Reopened** marks on
    Appendix A row 10 and on the Phase 5.1 note.
  - Done 2026-11-11. With Selected genes and genes chosen, Xenium density
    counts those genes from `density/gene`; with All features, or no genes,
    it stays the `/grids` density. The layer state carries the genes
    (`featureNames`), so the legend reads "SNAP25 transcripts per 320 µm
    bin" (or "All transcripts per …", "Transcripts in cells per …"), and the
    hover card names the gene, or lists each gene's count.
  - **`density/gene` is stored gene by gene**, `indptr[gene × rows + row]`,
    not row by row as the June reader assumed. On the demo, row 1100's
    pointer for SNAP25 sat at the end of the data. So the old selected-gene
    squares counted the wrong cells, which may be why they were hidden in
    June. A first timing run with the row-by-row reader (13 s and 363 MB for
    the whole slide, whatever the gene count) was measuring that bug.
  - Because each gene's whole-slide entries are contiguous, a gene is read
    once, whole, and kept (8 million entries at most, least recently used
    first out). Measured on the demo, whole slide, Node: 1 gene 0.2 s and
    2.2 MB, 8 genes 0.5 s and 11 MB, 25 genes 1.9 s and 56 MB, plus a
    one-off `indptr` read (10 MB compressed, 75 MB in memory). Later views
    take 3–14 ms. In the browser, SNAP25 over the whole slide took 6.2 s
    while the dataset was still loading, then 46 ms per view.
  - The gene limit is `TRANSCRIPT_GENE_DENSITY_CHUNK_LIMIT`, 32 data chunks
    of new genes per request (about 75 MB, about 30 genes), because gene
    sizes vary. Over it nothing is read, and the panel says to select fewer
    genes or zoom in until exact points load.
  - Squares are the finest 10 µm × 2ⁿ size whose occupied squares fit 1,500
    (320 µm for the whole demo slide, not 1,280 µm from the box alone).
    Colours scale to the largest square on the slide at that size, so they
    hold while panning.
  - **Not done as written:** Auto still switches to points on the
    all-transcript estimate. Xenium exact reads scan every transcript in
    the view (level-0 tiles or Parquet) whatever the filter, so the
    selected-gene count would let a whole-slide view try to read every
    transcript. Atera reads exact points per gene and keeps its
    selected-gene switch.
  - The point budget is a meter, "Exact points: 28,724 of 100,000 points"
    (`TranscriptPointBudget`); `Edit Max` shows the `Exact budget` field.
    The status panel lost its Estimate and Exact budget rows.
  - The reader no longer makes feature-circle glyphs; their renderer code
    is now unused and is left for a cleanup.
- [x] **K. Type and contrast (F6, F7, F20).** (M)
  - Remove the 48 `text-transform: uppercase` rules.
  - Use 12 px for control text and 11 px for captions.
  - Replace the native Visium select and the default slider with the
    primitives.
  - Use the unit formatter in tooltips (`viewerHoverTooltips.tsx`), Cell info
    and the ROI summary.
  - Add a unit test checking every dark token pair used for text and UI parts:
    at least 4.5:1 for text and 3:1 for UI parts.
  - Keep the axe baseline free of colour-contrast entries (15.0-F found
    none after the dark theme).
  - Done 2026-11-11. All 40 `text-transform: uppercase` rules are gone (and
    the `none` overrides that undid them). Every font size uses the type
    scale: 40 sizes from 8.3 to 9.6 px became 11 px captions, 73 from 9.9 to
    12.2 px became 12 px controls, and three became 13 px body text. The HUD
    still fits at 1440 px without overflow.
  - The Visium tissue image select is the `Select` primitive, laid out
    inline. Every slider takes the accent colour from one rule in `base.css`
    instead of the browser's blue; the opacity sliders move from magenta to
    the same accent. The other sliders keep their markup until 15.2 rebuilds
    the panels.
  - `data/units.ts` writes µm and µm² with the micro sign. It is used in the
    hover tooltips, Cell info, Bin info, the ROI summary and the Magic Lens
    radius, replacing "um", "um2" and "um^2". The 11 Greek-mu strings now use
    the micro sign too.
  - `styles/tokens.test.ts` reads `tokens.css` and checks 49 pairs: every
    text and role colour on every surface (4.5:1), role text on its tint
    (4.5:1), text on bright fills (4.5:1), and borders, accent and focus
    against the panel (3:1). The axe baseline still has no contrast
    entries.
- [x] **L. Sharing (F16; needs 15.0-E).** (M)
  - Add a Copy link button (in the Dataset tab now, the top bar later) and a
    "Link copied" toast.
  - Leave defaults out and set `xv=2`.
  - Take `dataset=` from the loaded dataset, not from the box
    (`AppDatasetHudPanel.tsx:126`).
  - Add `groups=`.
  - Version 1 links still parse unchanged; test this.
  - Done 2026-11-11. Links are version 2: `withoutShareableDefaults` drops
    every value equal to `DEFAULT_SHAREABLE_STATE`, keeping a measure unit
    that differs from the mouse unit. The parser records `linkVersion`. For
    version 2 `cellColor` is taken as written; version 1 links keep the
    genes-mean-gene-expression rule from 15.1-A.
  - A loaded Xenium view's link went from about 650 characters to under 200;
    the App test checks this.
  - `dataset=` is the loaded dataset, or the link's own dataset until one
    loads. A failed load no longer rewrites the link.
  - `groups=` carries the loaded dataset annotation set. `AnnotationState`
    records `groupId`, which imports and saved ROIs keep. A link with
    `groups=` loads that set once the dataset's sets are listed
    (`loadAnnotationGroup`).
  - `Copy Link` sits under Load Dataset. It is enabled once a dataset is
    loaded, says "Link copied" for 2.5 s, or says to copy the address bar
    when the clipboard refuses.
  - Known gap: a manifest's `defaults` fill in fields a link leaves out. A
    value that the user set back to the app default is left out of the link,
    so the link reopens with the manifest's value instead. Fix by omitting
    values equal to the manifest-merged defaults of the loaded dataset.
- [x] **M. Title and favicon (F19).** Set the page title to "{dataset} ·
      Spatial Omics Explorer" and add an SVG favicon in `public/`. (S)
  - Done 2026-11-11 (`app-shell/documentTitle.ts`). The name comes from the
    manifest's `name`, or else the URL's last segment, skipping `outs`,
    `explorer.json` and `experiment.xenium`. The title changes only when a
    load finishes. Before any load it is "Spatial Omics Explorer".

#### 15.2 Shell Re-Layout

The new shell is built behind `?shell=2` so the app keeps working after every
PR. That flag is for development only. No tutorials depend on the current tabs,
so step J makes the new shell the default and deletes the old one in the same
release, with no transition period. Old `tab=` links keep working through the
mapping in H.

- [x] **A. Section models.** Split the eight HUD panels into blocks that each
      take a view model, all built in App: `useImageSectionModel`,
      `useCellsSectionModel`, `useTranscriptsSectionModel`,
      `useAnnotationsSectionModel` and `useDatasetInfoModel`. (L)
  - The new shell then takes about five models instead of 30–43 separate
    props (Layers 43, Transcripts 43, Annotations 35).
  - This is a refactor only.
  - Done 2026-11-11. `src/features/sections/` holds six models, each built by
    a hook in `App.tsx`:
    - the five above. The cells model has appearance, gene selection and
      colour parts; the annotations model has sets, metadata tracks and
      shapes;
    - `useViewSettingsModel`, a sixth, for hover tooltips, coordinate units
      and the measure tool, which move to Settings and the Measure popover
      in B.
  - The Dataset, Layers, Genes, Transcripts and Annotations tabs now arrange
    blocks (`*Blocks.tsx`) that each take one model or sub-model, so a tab
    takes one to four models. The four `App*HudPanel` wrappers are gone;
    their logging and input normalising moved into the hooks.
  - Magic Lens, ROI and Cell keep their props: D replaces them with cards and
    defines card models.
  - Platform view options (Visium HD bin size; Visium image, library and
    off-tissue spots; SpatialData) stay in the dataset info model. C moves
    bin size, the tissue image and off-tissue spots to their sections.
  - The gene search, gene set drafts and saved sets, and the transcript
    feature search stay in their blocks, so typing does not re-render `App`.
    The annotation URL import flag moved into the model, because the
    Annotations tab unmounts its blocks while hidden.
  - On screen, only `Combine genes` moved: it now sits below the saved gene
    sets, where `docs/ui-reference.md` already listed it.
  - Blocks make their own label IDs; `useAppControlIds` keeps the five that
    Magic Lens, ROI and Cell use.
- [ ] **B. Top bar.** (M)
  - The dataset name with its menu, the summary chip and ⓘ.
  - Tools are tied to `activeTool`, and their tooltips show the shortcut.
  - Share, Help and Settings sit on the right.
- [ ] **C. Layer panel.** (L)
  - An accordion of Image, Cells/Spots/Bins, Transcripts and Annotations.
  - Each header holds a visibility checkbox and a one-line state.
  - Sections stay mounted.
  - Platform gating moves from `App.tsx:1152–1168` into `platformAdapter.ts`
    as capabilities.
  - Loading tasks are tagged by section instead of by tab
    (`appRuntimeModel.ts:103–310`).
  - The panel can collapse to a 40 px strip.
- [ ] **D. Cards.** (L)
  - Cards stack at the top left:
    - Selection: cells, Visium HD bins, and the image-geometry variant.
    - Cell or Bin: `CellInfoPanel`, `GridCellInfoPanel`.
    - Transcript: the pinned transcript.
    - Magic Lens: the cursor summary.
  - Magic Lens moves as D14 describes. The tool takes the cursor scope,
    "Summarise view" in its popover takes the viewport scope, and the
    Selection card's Transcripts tab takes the ROI scope. `MagicLensHudPanel`
    is retired.
  - `Min QV` is hidden until it changes results (F21).
- [ ] **E. Fit and navigation (F18).** (M)
  - `createOverviewViewState` takes the real viewport size and the space taken
    by the top bar and open panel, instead of 720 px.
  - Add `zoomToBbox`, which the cards' Go to buttons need.
  - Add zoom −, + and Fit buttons. `F` fits; Home still returns to the initial
    view.
- [ ] **F. Info drawer.** (M)
  - Sections: Dataset summary, About, View options, Open another dataset (with
    boundary limit under Advanced), and Diagnostics.
  - An issue count badge shows on ⓘ.
- [ ] **G. Embedding (F23).** A floating, resizable panel opened from Cells ›
      Show embedding, using the existing `EmbeddingPanel`. Selection sync stays as
      it is. (M)
- [ ] **H. URL panel state.** Add `panel=`, `card=` and `tool=`, and map
      version 1 `tab=` values. (S)
  - dataset → info drawer
  - layers → image
  - genes → cells
  - transcripts → transcripts
  - annotations → cells
  - roi → `tool=box`
  - cell → `card=cell`
  - magic-lens → `tool=magic-lens`
- [ ] **I. Narrow screens.** Under 860 px: the overflow menu, the bottom sheet,
      and cards as sheets. (M)
- [ ] **J. Switch over.** (M)
  - Make the new shell the default.
  - Delete `ControlHudShell`, `AppControlHud`, `CONTROL_HUD_TABS`,
    `control-hud.css` and the `?shell=` flag.
  - Rewrite `docs/ui-reference.md`.

#### 15.3 Start Screen, Help, Recovery

- [ ] **A. Start screen with examples fetched from GitHub (F15).** (M)
  - A URL field and an Open button.
  - **Example gallery.** Fetch the index when the start screen opens, from
    `EXAMPLES_INDEX_URL`.
    - The default is
      `https://raw.githubusercontent.com/cellgeni/explorer/main/examples/index.json`.
    - A build can override it with `VITE_EXAMPLES_INDEX_URL`. This is the
      app's first use of `import.meta.env`, so add the type declaration.
    - Give the request a 5 s timeout and parse it with
      `parseExamplesIndex`. That parser accepts `version: 1`, skips invalid
      entries, ignores unknown fields, and renders text only, never HTML.
    - Keep the result for the session in `sessionStorage`, wrapped in
      try/catch.
    - Each card shows name, platform, description and source/licence.
    - A card opens `?dataset=<manifestUrl>` on the current origin, never the
      entry's `viewerUrl`, so self-hosted copies stay on their own host.
    - If the fetch fails, show "Examples couldn't be loaded from GitHub" with
      Retry, plus the built-in demo dataset (`DEMO_DATASET_URL`). The start
      screen is never empty.
  - Up to 8 recent datasets, which can be removed. They are stored in
    `localStorage`, wrapped in try/catch.
  - A "What can I open?" link.
  - The demo is no longer prefilled in the URL box.
  - `?dataset=` links skip the start screen.
- [ ] **B. Help (F22).** (S)
  - A `?` popover listing the shortcuts and linking to the user guide and
    dataset docs.
  - The list comes from the same `SHORTCUTS` table the key handlers use.
  - Add info tooltips for LOD, QV, Boundary limit and Combine genes.
- [ ] **C. Undo (F17).** (M)
  - Show an Undo toast for 8 s after: Clear selection; delete a selection,
    shape or class; remove an annotation set; Clear GeoJSON; remove a gene
    set.
  - Opening another dataset adds a browser history entry so that Back returns
    to the previous one. Today `useShareableUrlHash` only replaces the entry.
- [ ] **D. Cancel (F17).** (M)
  - Add a Cancel button to tasks that can be cancelled: ROI genes, exact
    transcripts, embeddings, Magic Lens, cell details, diagnostics.
  - Each task maps to its abort ref (`App.tsx:512–532`) and resets its state
    to idle, so it leaves the list.
  - Show a percentage where it is known.

#### 15.4 Selections And Analysis

Can be skipped after 15.3 ships if time is short.

- [ ] **A. Multiple selections (F13).** (L)
  - List selections in Annotations by class, each with rename, colour,
    visibility, delete and Go to.
  - A new drawing adds a selection, and the card shows the active one.
  - `roi=` stores the active selection.
- [ ] **B. Enriched genes (F13).** (L, with a method note in the docs)
  - The Selection card's Genes tab ranks genes by log2 fold change of mean
    expression inside the selection versus a matched sample outside it, reusing
    the ROI warm-up sample.
  - It shows the % of cells expressing inside and outside, with a minimum %
    filter. "Most abundant" stays as a second sort.
  - Clicking a gene sets `Colour by` to Gene expression.
- [ ] **C. Transcript gene legend.** Each gene gets a colour swatch, an eye
      toggle and its count, in the Transcripts section and in the legend, as in 10x
      Explorer. Colours can be edited. (M)
- [ ] **D. Minimap.** (M)
  - Draw the coarsest image pyramid level with a small `TileCache` and
    `drawMorphologyTileChannels` (`rendering/morphologyCanvas.ts:62`).
  - Use `flatImage` for Visium, and the cell extent when there is no image.
  - Draw the viewport rectangle from `viewportBbox`. Click or drag to move the
    view.
- [ ] **E. µm axes.** An optional setting. (S)

#### 15.5 Close-Out

- [ ] Re-run the eight review tasks on the Xenium demo and Census Visium at
      1440, 1024 and 390 px, and record the results in the phase record.
- [ ] Accessibility pass:
  - the axe baseline from 15.0-F is empty;
  - a keyboard-only run of tasks 1–5;
  - focus order;
  - ARIA for the accordion, drawer and cards.
- [ ] Record the outcome in this phase, and update the out-of-date test
      inventory in [§9](#9-testing-and-ci).

#### Testing

- **Unit tests.** Each new model gets pure tests: colour-mode resolution, gene
  ranking, error classification, version 1 → version 2 share state, `tab=`
  mapping, the shortcut table, fit with panel space, and contrast across token
  pairs.
- **Component tests.** Sections and cards are rendered directly, as the
  current panel tests already do. Those tests break only when a label changes.
- **`App.test.tsx`.** 45 of its 57 tests open tabs. After 15.0-D they all go
  through `openControls()`, so the shell swap only edits that helper.
- **E2E.**
  - All 13 tests in `app.spec.ts` click tabs. The 7 smoke tests stay in CI.
  - Add one test per review task (tasks 1–5) on fixtures. The axe check from
    15.0-F runs in every smoke test.
  - Live tests stay nightly.
  - `examples.spec.ts` keeps its status-text checks.
  - Smoke tests serve the examples index from the local
    `examples/index.json` through `page.route`. They also cover the "couldn't
    be loaded" fallback, so CI never depends on GitHub. One nightly live test
    fetches the real index.
  - A live Xenium test checks that selected-gene density names the gene in
    its legend and hover card.
- **Redraw guard.** Every new canvas overlay goes in the no-redraw test.
- **Screenshots.** Take them for review in PRs: start screen, each section,
  and each card at 1440×900. Use headless Chromium with
  `--use-angle=metal --enable-gpu`, which gets the real GPU on Apple Silicon.
  They are not pixel baselines, because GPU output varies.

#### Docs To Update

Each PR updates the docs it affects. The full list:

- `docs/ui-reference.md`: rewrite by area (top bar, sections, cards, canvas,
  info drawer, start screen, settings, URL parameters) in 15.2-J. Edit it
  piece by piece before then.
- `docs/user-guide.md`: rewrite the task walkthroughs for the new layout.
- `docs/dataset-manifest.md`, plus `public/schemas/explorer-manifest.v1.json`
  ("Dataset tab" at :26, :146, :381; control names at :409–426; the
  `colorCellsBy` enum).
- `docs/architecture.md`: shell structure and platform gating.
- Control names in `docs/modalities/*.md`, `docs/host-your-own-data.md`,
  `docs/image-only-and-geojson.md` and `docs/zchunkstore.md`.
- `README.md:135`, `docs/README.md:10`, and `examples/README.md:29`. The
  examples README should also say that the app reads `index.json` from `main`
  at runtime.
- `docs/deploy-to-s3.md`: the start screen fetches from
  raw.githubusercontent.com, and `VITE_EXAMPLES_INDEX_URL` can change that.
- `docs/modalities/xenium.md`: selected-gene density.
- This plan: the phase record, plus Appendix A row 10 and the Phase 5.1 note
  once 15.1-J ships.

#### Risks

| Risk                                                                 | Effect                                                                | Mitigation                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| New overlay props make `DeckGL` redraw                               | About 9 s per interaction in headless tests, and stutter on real GPUs | Put overlays next to `MemoDeckGL`, not inside it; memoise `controller` and `layers`; extend the no-redraw test   |
| Moving panels makes prop lists even longer                           | `App.tsx` gets harder to change                                       | Build the section models (15.2-A) before the new shell                                                           |
| Test churn (about 96 assertions depend on tabs, 228 on button names) | Slow PRs                                                              | Add the `openControls` helper first; keep button names; change casing only in CSS                                |
| Breaking share links or manifests                                    | Saved views stop working                                              | Keep the version 1 parser; add mapping tests; only add to the manifest enum                                      |
| 15.1-F changes how datasets load                                     | Load regressions                                                      | Its own PR, with tests on each platform and a live E2E run                                                       |
| Seven platforms with different controls                              | A platform's control gets missed                                      | Run the platform checklist on each PR; gate on capabilities                                                      |
| 15.4 grows                                                           | The redesign is delayed                                               | 15.4 is optional after 15.3                                                                                      |
| Wrapper components dodge `nativeTitleAudit`                          | Unlabelled controls get through                                       | Extend the audit to the primitives (15.0-B)                                                                      |
| The examples fetch fails (GitHub down, offline, blocked network)     | The start screen has no examples                                      | 5 s timeout; offer the demo dataset and a Retry; keep the result for the session; CI routes the request locally  |
| GitHub's raw cache (about 5 min) or a bad `index.json` on `main`     | New examples appear late, or the gallery breaks                       | A tolerant parser that skips bad entries; `npm run examples -- --check` stays in CI                              |
| Selected-gene density is slow with many genes                        | Slow panning with large gene sets                                     | Done in 15.1-J: each gene is read once and kept; over 32 new chunks (about 30 genes) nothing is read, with a why |

#### Order And Size

| Milestone                  | Contents                                 | Size            | Fixes                                          |
| -------------------------- | ---------------------------------------- | --------------- | ---------------------------------------------- |
| M1 — Honest canvas         | 15.0 A–F; 15.1 A, B, C, D, E, G, H, K, M | about 7 weeks   | All High except F4; F8, F9, F10, F12, F19, F20 |
| M2 — Safe loading, sharing | 15.1 F, I, J, L                          | about 4 weeks   | F4, F11, F14, F16                              |
| M3 — New shell             | 15.2 A–J                                 | about 8–9 weeks | F3 (cards), F8 (drawer), F18, F21, F23         |
| M4 — Getting started       | 15.3 A–D                                 | about 2 weeks   | F15, F17, F22                                  |
| M5 — Selections            | 15.4 A–E                                 | about 4 weeks   | F13                                            |

- **Critical path:** 15.0-D → 15.1-A → 15.1-C → 15.2-A → 15.2-C → 15.2-J.
- **Can run in parallel:** 15.1-E and F (loading) alongside 15.1-A to D
  (colour and legend). 15.1-J (density) can start at any time, but its legend
  text needs 15.1-C.
- **Dark theme timing:** the dark theme arrives with the tokens in 15.0-A, so
  users see it in the first release, before the layout changes.
- **Releases:** tag a release after each milestone. M1 alone fixes most of
  what the review found.
- **Effort:** these sizes add up to about 6 months for one developer working
  without help. M1 and M2 together are about 40% of the effort.

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
- [ ] Interface redesign, [Phase 15](#phase-15--interface-redesign): 41 tasks
      in five milestones. Milestones M1 (15 tasks) and M2 (4 tasks) are done;
      M3, the new shell (15.2), has started: A is done, B and C are next.

Reopened by the 2026-11-08 review (marked done before, found incomplete):

- [x] H5AD and SpatialData: offer numeric `obs` columns as `Metadata` colour
      tracks (`metadataTracks()` is called at load, 2026-11-09).
- [ ] H5AD: read HDF5 in a worker (h5wasm runs on the main thread).
- [x] H5AD and SpatialData: read boolean `obs` columns on the reference backend
      (0/1 tracks, 2026-11-09).
- [ ] Visium HD: low-res tissue image fallback.
- [ ] Magic Lens: make `Min QV` change results, or hide it. Phase 15.2-D
      hides it until it works.
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
- [x] Remove `'visium'` from the `Platform` union or implement it
      (implemented in Phase 14).
- [ ] Dataset manifest: declare files absent; set the H5AD coordinate key,
      annotation set, channel colours and contrast, and initial camera (see
      [Phase 11](#phase-11--dataset-manifest)).

Features:

- [ ] `t`/`z` selection for OME-Zarr, and a `Z plane` control for custom image
      layers (OME-TIFF dataset images have one).
- [ ] H5AD: worker-backed lazy Range reads, `/layers/*` and `/raw/X`, and richer
      schema diagnostics.
- [ ] SpatialData: `points` (transcripts), extra images and tables, and
      viewport-scoped shape reads.
- [ ] Atera: ROI transcript export, the cell z histogram, Magic Lens, and
      Azimuth colours (see [Phase 12](#phase-12--10x-atera-output)).
- [x] Standard Visium (spots) from the original Phase 6
      ([Phase 14](#phase-14--standard-visium-spots), 2026-11-10).
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

| #   | Topic                            | Earlier record                                                                             | Later record (kept)                                                                         |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1   | DuckDB `httpfs`                  | `PLAN.md`: `LOAD httpfs` is redundant; don't rely on it                                    | Phase 5.1: load `httpfs` at bootstrap, non-fatal on older bundles                           |
| 2   | `transcripts.zarr.zip`           | `PLAN.md`: drop it; `density/` is only an optional accelerator                             | Phase 5.1: it is the native LOD and exact-point source                                      |
| 3   | Multi-channel compositing        | `PLAN.md`: Viv `XRLayer`                                                                   | Phase 3: Canvas2D additive compositing                                                      |
| 4   | Zustand scope                    | `PLAN.md`: shared store for React and the deck.gl loop                                     | Refactor: viewer store only; React domain state                                             |
| 5   | Request orchestration location   | Refactor decisions: async orchestration stays in `App.tsx`                                 | `OPTIMIZATIONS.md`: workflow hooks own requests                                             |
| 6   | Phase order around 5.1           | "Begin Phase 5.1 only after" the feature-fix and optimization passes                       | Phase 5.1 began after the correctness pass; the optimization pass was deferred              |
| 7   | Overview points                  | Phase 1: bin points at low zoom                                                            | Phase 4: no CPU aggregation; all viewport-clipped centroids; Phase 5 budget caps            |
| 8   | Expression limits                | Analysis slice: 5,000 visible cells                                                        | Phase 4: `Auto LOD` exact below 5,000; `Exact region` up to 50,000                          |
| 9   | Boundary limit default           | Phase 1: 5,000                                                                             | Phase 5: set by the performance budget (values not recorded)                                |
| 10  | Transcript selected-gene density | Option C: `/density/gene` for selected features; feature circles                           | 2026-06-06: only `/grids` density. 2026-11-11 (15.1-J): `/density/gene` density, no circles |
| 11  | Magic Lens data path             | Phase 5: exact-circle transcript scans                                                     | Feature-fix: ROI cell query plus matrix gene stats                                          |
| 12  | ROI gene warmup                  | Per viewport                                                                               | Once per dataset                                                                            |
| 13  | ROI gene fallback                | Phase 4: `transcripts.parquet` aggregation                                                 | Feature-fix: CSC Zarr, then H5; nothing else by default                                     |
| 14  | Visium HD expression             | Paused, then 64 MB H5 budget guard                                                         | Feature Slice lazy-range worker for overlays; lazy-range matrix worker for profiles         |
| 15  | 2 µm tier                        | Disabled → env-var budget → runtime `2 µm budget` field                                    | Budget fields removed; all rows unless a caller caps                                        |
| 16  | `Mapping rows` field             | `UPDATED_PLAN.md` says it was added, in an entry placed _after_ the one that removes it    | Removed. The file is not in date order; the removal is the final state                      |
| 17  | Segmentation GeoJSON budget      | 64 MB full-file limit                                                                      | No default limit; streaming by bounding box                                                 |
| 18  | Status header vs sequence        | "Phase 5.1 complete" (dated 2026-06-07) and "optimization pass remains a future follow-up" | Both kept: 5.1 done, optimization open                                                      |
| 19  | "Keep `PLAN.md` unchanged"       | Phases 5.1 and 7 asked for new phases to go only in `UPDATED_PLAN.md`                      | Moot after this merge                                                                       |
| 20  | `OPTIMIZATIONS.md` item numbers  | Progress notes mix the 4-step sequence numbers with the 14-item list numbers               | This document uses names and the 14-item numbering                                          |
| 21  | Persistent cache medium          | `PLAN.md`: OPFS or IndexedDB                                                               | IndexedDB only                                                                              |
| 22  | H5AD remote reads                | Product decision: worker-backed Range reader                                               | Not done; 300 MiB whole-file gate plus kerchunk reference (still open)                      |
| 23  | Expression LOD                   | Phase 4: `Auto LOD` exact below 5,000 visible cells; samples thin all cells                | November 2026: every cell up to 500,000 cells; samples keep every expressing cell           |
| 24  | `Exact region` above the limit   | Phase 4: wait instead of sampling                                                          | November 2026: sample, keeping every expressing cell                                        |
| 25  | Low-zoom expression marks        | Phase 4: fixed data-space bins                                                             | `0ed880d`: every expressing cell drawn at every zoom                                        |
| 26  | Overview points                  | Phase 4: all viewport-clipped centroids                                                    | `bf6ebc8`: GPU-resident cells with a fixed-rank sample capped by the budget                 |
| 27  | Boundary limit values            | Phase 5: "set by the performance budget"                                                   | 2,500 (compact) or 50,000; range 1–100,000; also loads at zoom ≥ −0.25                      |
| 28  | Phase 8 status                   | Merged plan: nothing checked                                                               | Shipped in `f7ff9c5` on 2026-07-09; closed                                                  |
| 29  | COOP/COEP in production          | Docs disagreed (required vs only for threaded WASM)                                        | Recommended for parity; not required by the current build                                   |
| 30  | Items marked done in the records | H5AD tracks and workers, Visium HD low-res, Magic Lens QV, diagnostics, image fallback     | **Reopened** after the 2026-11-08 review                                                    |

## Appendix B: Source Map

| Section in this document   | Source                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Purpose, POC            | `PLAN.md` intro, §0; reference URLs from `PLAN.md` and `UPDATED_PLAN.md`                                                            |
| 2. Working rules           | `PLAN.md` "How to use", conventions, DoD, skills; `UPDATED_PLAN.md` skills, refactor decisions, current sequence                    |
| 3. Status                  | `UPDATED_PLAN.md` stage assessment and phase checklists; `OPTIMIZATIONS.md`                                                         |
| 4. Architecture decisions  | `PLAN.md` §1; amendments from `UPDATED_PLAN.md` Phases 1–7 and boundary decision                                                    |
| 5. Data contracts          | `PLAN.md` §2; `UPDATED_PLAN.md` Phase 5.1, 6, 7, 8 facts                                                                            |
| 6. Phase records           | `PLAN.md` §3; `UPDATED_PLAN.md` running TODOs, notes, closeouts, feature-fix pass, Phases 5.1–8                                     |
| 7. Refactor record         | `UPDATED_PLAN.md` app refactor decisions; `OPTIMIZATIONS.md`                                                                        |
| 8. Hosting                 | `PLAN.md` §4                                                                                                                        |
| 9. Testing                 | `PLAN.md` §5; `UPDATED_PLAN.md` test coverage assessment; 2026-11-08 repository count                                               |
| 10. Tech stack             | `PLAN.md` §6, with outcomes from `UPDATED_PLAN.md`                                                                                  |
| 11. Risks                  | `PLAN.md` §7                                                                                                                        |
| 12. Open items             | Every unchecked item in all three files, plus the 2026-11-08 review                                                                 |
| Phases 8–10, November work | Commits `f7ff9c5` to `0ed880d` (2026-07-09 to 2026-11-08), the code, and `docs/`                                                    |
| Reopened items, known gaps | The 2026-11-08 review (`PLAN_VS_DOCS.md`), checked against the code                                                                 |
| Phase 15                   | The 2026-11-10 UI review, the 2026-11-11 layout comparison (Vitessce, CELLxGENE Explorer, TissUUmaps, 10x Explorer), and a code map |
