# Existing items to reconcile

Indexed in stage 1 from `docs/plan/open-items.md` (321 lines), `docs/plan/engineering.md` "Testing And CI → Open" (7 unchecked items), and the leads table in section 2 of the review plan. `plan-vs-docs.md` is a dated record (2026-11-08, resolved the same day). `decisions.md` has no open boxes. Neither needs reconciling item by item; stage 2 uses them as background.

Status is **not verified** for every row until its stage records current evidence. Each row ends as still present, partly resolved, resolved, superseded, or not verified.

## The review plan's leads

| Lead                                                        | Matching record                                                                                                                                                                              | Stage |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Timeout and retry coverage differs by reader                | `open-items.md` "Range reads have no timeout or retry": H5 worker has 120 s × 3 and detection has `fetchWithTimeout`; `cachedZipStore.ts`, `hyparquetCells.ts`, `zarrStores.ts` have neither | 5     |
| Cancellation suppresses stale updates without stopping work | `open-items.md` "Cancelling a load… does not stop the old dataset's reads"; triage: `lifecycle/*-cancel` repros fail                                                                         | 5     |
| Instance eviction exists; other caches may be unbounded     | `open-items.md` "Per-URL caches that are never released"; triage: `imaging/tilePoolLifetime` (decode workers +8 per contrast edit)                                                           | 5     |
| Optional reads turn transient failures into "absent"        | `open-items.md` "Optional reads treat any failure as absent" (`transcriptZarr.ts`, `openOptionalZarrArray`, `ateraDataset.ts`)                                                               | 5     |
| H5AD range reads, plots, Cell Query, 3D stack are recent    | Phases 07 (range reads 2026-11-17), 22, 23, 24, 25, 26                                                                                                                                       | 3, 4  |
| Historical phase sections describe pre-implementation gaps  | Read each phase's dates and close-out before classifying                                                                                                                                     | 2     |
| Main-thread work, rendering cost, duplication               | `open-items.md` main-thread exceptions, `packCellPointColors`, `onTranscriptHover`, `startDatasetLoad` size, copied helpers, `handleDatasetSubmit` misused promise                           | 6, 7  |

## Other open items by stage

| Item (open-items.md unless noted)                                                                                                                                                                           | Stage                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Dataset manifest: declare files absent, H5AD coordinate key, annotation set, channel colours and contrast, initial camera                                                                                   | 2                              |
| Feature gaps listed as open (OME-Zarr `t`, H5AD `/layers` and `/raw/X`, AnnData Zarr variants, SpatialData gaps, collections gaps, 3D gaps, store browser, SVS, NDPI, Zarr transcript estimate ignoring QV) | 2 (docs agree?), 4 (behaviour) |
| Known gaps from phase files (GeoJSON, OME-Zarr IDB cache, QPTIFF, standard Visium, nucleus boundaries, MERSCOPE)                                                                                            | 2, 4                           |
| Toast covering an open card at 1024 px                                                                                                                                                                      | 6                              |
| Xenium demo main-thread stalls in the first 30 s                                                                                                                                                            | 6                              |
| Memory ceiling with eviction telemetry                                                                                                                                                                      | 5                              |
| Coverage job not required; `main` unprotected (`engineering.md` Open)                                                                                                                                       | 7                              |
| E2E gaps: SpatialData, OME-Zarr, image-only, collections, Browse Store, SVS, NDPI, GeoJSON, load errors, narrow widths; live tests fail rather than skip when Sanger is down                                | 6, 7                           |
| Unit coverage gaps: `gridBinLayer.ts`, `viewerPicking.ts`, `zarrDecode.worker.ts` chunk cache, `visiumHdOverview.ts`, `omeZarrPixels.ts`, `zarrFolderLister.ts` pagination                                  | 7                              |
| hyparquet pinned at 1.26.0 for its patch; no Dependabot; `audit.yml` at critical only                                                                                                                       | 7                              |
| Deploy previews, golden fixture bundle, `metrics_summary.csv`                                                                                                                                               | 7 (record only)                |

## New leads from the first attempt (see `../evidence/triage/README.md`)

Not in any plan record yet, unless a later stage finds them there:

- Xenium `UNASSIGNED` transcript cell IDs reject ROI transcript export and exact transcripts (stage 4).
- SpatialData int64 instance IDs above 2^53 place no rows (stage 4).
- MERSCOPE CSV quoting, gzipped-size message, anisotropic `.vzg` placement (stage 4).
- Gzipped Visium `.h5` named in a manifest fails although the docs say `.gz` copies work (stages 2 and 4).
- Persistent byte-range cache keeps a short 206 body (stage 5).
- Plots toggle shown on Visium HD against the docs (stage 2).
- Z-score population and NaN handling, ROI "cut short" flag on AnnData platforms (stage 3).
- Stale lazy chunk after a redeploy reported as a dataset network error (stage 7).
- Share keys `aimg` and `sectionView` undocumented; `debug` and `lensQv` documented but absent from code (stage 2).
- Detection runs twice per cold load (stage 6, from `load-trace.md`).
