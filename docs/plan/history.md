# Plan History

How the plan came to be, and the records it was reconciled from.

## How The Plan Was Assembled

The plan began as `UNIFIED_PLAN.md`, which merged three planning records into
one. The originals were removed after the merge; they are in git history up to
commit `096ef46`.

- `PLAN.md`: the original production brief (scope, conventions, architecture
  decisions, Xenium data contract, phases 1–6, hosting, testing, risks). It is
  not today's `PLAN.md`, which is the index of this plan. Where these records
  say `PLAN.md`, they mean the brief.
- `UPDATED_PLAN.md`: execution notes for phases 1–5, plus the later phases 5.1
  (transcripts), 6 (Visium HD), 7 (H5AD), and 8 (image-only).
- `OPTIMIZATIONS.md`: the structural refactor recommendations and their progress.

The planning files stopped at 2026-07-09. On 2026-11-08 this plan was brought
up to date with the work shipped since then (through commit `0ed880d`), using the
git history, the code, and the current `docs/`. Work recorded only from git is
marked with its commit. Items the plan had marked done but the 2026-11-08 review
found incomplete are marked **Reopened**.

On 2026-11-11, [Phase 15](phases/15-interface-redesign.md) was added. It plans
an interface redesign that follows a UI review.

Closed since the merge: Phase 8 (image-only and GeoJSON), and the "true all-cell
whole-slide expression scan" from Phase 4 (`Auto LOD` and `All cells` load every
cell up to 500,000 cells).

On 2026-11-13 `UNIFIED_PLAN.md`, then 4,711 lines, was split into
[`PLAN.md`](../../PLAN.md) and the files in `docs/plan/`, with no change to the
records except these:

- Ticked items in Open Items moved under Closed Open Items in their phase or
  track file, and the worker-move measurements from the main-thread item moved
  to the [optimization pass](phases/optimization-pass.md#worker-moves-2026-11-13).
- The status table gained its missing Phase 13 row.
- Section numbers 1–3 and 6–12 were dropped. Decisions (4.x) and data contracts
  (5.x) keep theirs. The section numbers in the source map below are those of
  `UNIFIED_PLAN.md`.
- Code comments that cited `UNIFIED_PLAN.md, 15.2-A` now cite `plan 15.2-A`.

## Starting Point: The Proof Of Concept

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

## Reconciliation Notes

Where the sources conflicted, and what the plan keeps.

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
| 20  | `OPTIMIZATIONS.md` item numbers  | Progress notes mix the 4-step sequence numbers with the 14-item list numbers               | The plan uses names and the 14-item numbering                                               |
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

## Source Map

| Section in `UNIFIED_PLAN.md` | Source                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Purpose, POC              | `PLAN.md` intro, §0; reference URLs from `PLAN.md` and `UPDATED_PLAN.md`                                                            |
| 2. Working rules             | `PLAN.md` "How to use", conventions, DoD, skills; `UPDATED_PLAN.md` skills, refactor decisions, current sequence                    |
| 3. Status                    | `UPDATED_PLAN.md` stage assessment and phase checklists; `OPTIMIZATIONS.md`                                                         |
| 4. Architecture decisions    | `PLAN.md` §1; amendments from `UPDATED_PLAN.md` Phases 1–7 and boundary decision                                                    |
| 5. Data contracts            | `PLAN.md` §2; `UPDATED_PLAN.md` Phase 5.1, 6, 7, 8 facts                                                                            |
| 6. Phase records             | `PLAN.md` §3; `UPDATED_PLAN.md` running TODOs, notes, closeouts, feature-fix pass, Phases 5.1–8                                     |
| 7. Refactor record           | `UPDATED_PLAN.md` app refactor decisions; `OPTIMIZATIONS.md`                                                                        |
| 8. Hosting                   | `PLAN.md` §4                                                                                                                        |
| 9. Testing                   | `PLAN.md` §5; `UPDATED_PLAN.md` test coverage assessment; 2026-11-08 repository count                                               |
| 10. Tech stack               | `PLAN.md` §6, with outcomes from `UPDATED_PLAN.md`                                                                                  |
| 11. Risks                    | `PLAN.md` §7                                                                                                                        |
| 12. Open items               | Every unchecked item in all three files, plus the 2026-11-08 review                                                                 |
| Phases 8–10, November work   | Commits `f7ff9c5` to `0ed880d` (2026-07-09 to 2026-11-08), the code, and `docs/`                                                    |
| Reopened items, known gaps   | The 2026-11-08 review ([plan vs docs](plan-vs-docs.md)), checked against the code                                                   |
| Phase 15                     | The 2026-11-10 UI review, the 2026-11-11 layout comparison (Vitessce, CELLxGENE Explorer, TissUUmaps, 10x Explorer), and a code map |
