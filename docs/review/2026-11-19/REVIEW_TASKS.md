# Repair tasks

Tasks for the findings in `REVIEW_REPORT.md`, reviewed at commit `6a9a736`. Each task can be reviewed as one pull request. Each behaviour fix carries its regression test and documentation update. Refactors that should not change behaviour are kept separate, in wave 4.

Tasks T42 to T45, for the findings of the 2026-11-20 addendum at `5b1cd9f`, are in `ADDENDUM_2026-11-20.md`. T42 (wave 1) shares its mechanism with T11; do them together.

## Order

The tasks run in four waves:

1. **Wave 1:** the P1 findings.
2. **Wave 2:** the P2 findings.
3. **Wave 3:** the P3 findings.
4. **Wave 4:** structural changes that should not change behaviour.

Within each wave the plan's order applies: scientific and data correctness first, then reliability and resource control, then performance, then security and accessibility, then documentation, then tests.

Quick wins that can land at any time:

- T23: a one-line example URL, which turns the live suite green.
- T33 and T34: wording only.

Paths starting `evidence/` are relative to `docs/review/2026-11-19/`. "Repro" means a file in `evidence/repro/`, run with:

```sh
npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts <file>
```

A fix should turn a failing repro green. For a repro that records the defect, the fix should flip its recorded expectation. In both cases, add the case to the project's own tests; the review repros are not part of `npm test`.

Effort is rough and assumes one developer who knows the codebase:

- **S:** under half a day.
- **M:** one to two days.
- **L:** more than two days.

Every task's broader checks include `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and the `@smoke` E2E suite. Only extra checks are listed below.

| Task | Wave | Findings         | Title                                                          | Depends on | Effort |
| ---- | ---- | ---------------- | -------------------------------------------------------------- | ---------- | ------ |
| T01  | 1    | EXP-001, EXP-038 | Treat `UNASSIGNED` transcript cell IDs as no cell              | —          | S      |
| T02  | 1    | EXP-002          | Undo a pending view change on cancel and on failure            | —          | M      |
| T03  | 1    | EXP-003, EXP-038 | One owned tile decode pool                                     | —          | M      |
| T04  | 2    | EXP-004          | Keep negative values in AnnData multi-gene and ROI reads       | —          | S      |
| T05  | 2    | EXP-005          | Give z-scores a fixed, stated population                       | decision   | M      |
| T06  | 2    | EXP-006          | Match Zarr transcript points to Parquet rows on the full ID    | T01        | M      |
| T07  | 2    | EXP-007          | Show zoomed-out transcript density as scaled or sampled        | —          | S      |
| T08  | 2    | EXP-008          | Read SpatialData integer instance keys exactly                 | —          | S      |
| T09  | 2    | EXP-009          | Key the remembered gene scale by Visium HD bin size            | —          | S      |
| T10  | 2    | EXP-010          | Refuse short range bodies before caching                       | —          | S      |
| T11  | 2    | EXP-011, EXP-038 | Release the deck.gl device on every switch                     | —          | M      |
| T12  | 3    | EXP-012          | Skip non-finite values in z-scores and Plots summaries         | —          | S      |
| T13  | 3    | EXP-013          | Collision-free suffixes for repeated names                     | —          | S      |
| T14  | 3    | EXP-014          | Report ROI truncation from what the reader returned            | —          | S      |
| T15  | 3    | EXP-015 (a, b)   | TIFF: per-level tile size and `PhysicalSizeY`                  | —          | M      |
| T16  | 3    | EXP-015 (c, d)   | TIFF: signed samples and a missing `Compression` tag           | —          | S      |
| T17  | 3    | EXP-016          | Refuse or honour anisotropic `.vzg` transforms                 | —          | S      |
| T18  | 3    | EXP-017          | RFC 4180 fields in MERSCOPE CSVs                               | —          | S      |
| T19  | 3    | EXP-019          | Gzipped `.h5` in a Visium manifest                             | —          | S      |
| T20  | 3    | EXP-018          | Stop inflating a MERSCOPE CSV at the size limit                | T18        | S      |
| T21  | 3    | EXP-020          | Reset the tile pool when a worker fails                        | T03        | S      |
| T22  | 3    | EXP-021          | Recognise stale chunks after a redeploy                        | —          | S      |
| T23  | 3    | EXP-022          | Move the tonsil example to the livingobjects mirror            | —          | S      |
| T24  | 3    | EXP-023          | Version and pin release builds                                 | —          | S      |
| T25  | 3    | EXP-024          | Detect a dataset once per load                                 | —          | S      |
| T26  | 3    | EXP-025          | Scope the release job's write token                            | —          | S      |
| T27  | 3    | EXP-026          | Keep tokens out of the recent list                             | —          | S      |
| T28  | 3    | EXP-027, EXP-038 | Histogram role, and image states in the axe test               | —          | S      |
| T29  | 3    | EXP-028, EXP-038 | 24 px collection bar targets, and a collection in the axe test | —          | S      |
| T30  | 3    | EXP-029          | Open floating windows clear of the left drawer                 | —          | S      |
| T31  | 3    | EXP-030          | Settle Plots on Visium HD                                      | decision   | S      |
| T32  | 3    | EXP-031          | Tighten the public schemas and say the viewer checks more      | —          | M      |
| T33  | 3    | EXP-032          | Say which CI checks block                                      | decision   | S      |
| T34  | 3    | EXP-033          | MiB for binary limits                                          | —          | S      |
| T35  | 3    | EXP-034          | Bring four reference statements up to date                     | —          | S      |
| T36  | 3    | EXP-035          | Sync `open-items.md` with phases 24 and 25                     | —          | S      |
| T37  | 3    | EXP-037          | Make the Atera feature-count test reach its check              | —          | S      |
| T38  | 3    | EXP-038          | One narrow-layout smoke test                                   | T30        | M      |
| T39  | 4    | EXP-002 (MNT-01) | Pending-load record owned by the lifecycle                     | T02        | L      |
| T40  | 4    | EXP-005 (MNT-02) | Move the expression-batch contract and test it per platform    | T05        | M      |
| T41  | 4    | EXP-036          | One worker-once helper and one abort module                    | T03, T21   | M      |

## Wave 1: P1

### T01 Treat `UNASSIGNED` transcript cell IDs as no cell

- **Findings:** EXP-001; part of EXP-038.
- **Priority and dependencies:** wave 1; none. T06 builds on it.
- **Target:**
  - `src/datasets/xeniumDatasetRows.ts`: `parseTranscriptExportRow` and `parseTranscriptPointRow`.
  - Their fixtures, and `tests/e2e/app.spec.ts` (live Xenium ROI test).
- **Correction:**
  - Map `cell_id = "UNASSIGNED"` to `null` in both row parsers.
  - For any other string that is not a Xenium cell ID, return `null` and count it, so the export can report how many rows had no usable cell.
  - Alternatively, `NULLIF(cell_id, 'UNASSIGNED')` in the SQL of `readXeniumTranscriptsInBbox` and `readXeniumTranscriptsForSelection`. In that case, the point parser still needs the same rule.
- **Scope boundaries:**
  - `asCellId` stays strict.
  - Atera's own unassigned encoding (`ateraFormat.ts:499-502`) is not touched.
- **Acceptance criteria:**
  - An ROI over a fixture holding one assigned and one `UNASSIGNED` transcript exports both rows, the second with an empty `cell_id`.
  - Exact points from Parquet keep the unassigned row with no cell.
  - The Parquet enrichment of Zarr points no longer fails when the view holds such a row.
- **Focused regression checks:**
  - Both failing cases in `evidence/repro/platforms/xenium-duckdb.repro.ts` pass.
  - New unit cases in the row parser tests.
  - The live ROI test clicks `Export Transcripts` and finds data rows (runs in `e2e-live.yml`).
- **Broader checks:** the `@live` Xenium tests.
- **Risk and decisions:** whether the CSV marks unassigned rows with an empty field or with `UNASSIGNED`. An empty field matches the current `null` handling.
- **Effort:** S.

### T02 Undo a pending view change on cancel and on failure

- **Findings:** EXP-002 (behaviour fix; the structural fix is T39).
- **Priority and dependencies:** wave 1; none.
- **Target:**
  - `src/features/app-shell/useDatasetLifecycle.ts`: `cancelDatasetLoad` and the failure path.
  - `src/features/app-shell/useVisiumControlsWorkflow.ts`: `handleVisiumViewChange`.
  - `src/App.tsx`: `handleSpatialDataSelectionChange`.
  - `src/datasets/datasetFactory.ts`: the SpatialData selection registry.
  - `src/datasets/h5adDataset.ts`: `setVisiumView`.
- **Correction:**
  - Before a same-URL view reload starts, record the view on screen: Visium library and off-tissue choice, SpatialData selection, share state.
  - On cancel or failure, put back all three changes: the share-state ref, the registered SpatialData selection, and the instance's Visium view.
  - Apply the instance's Visium view only once the load commits, or restore it after.
- **Scope boundaries:**
  - No new ownership model (T39).
  - Loads of a different URL are unchanged.
  - Stopping the old reads is the separate known-open item.
- **Acceptance criteria:** after Cancel, and after a failed reload, of a Visium library switch and of a SpatialData coordinate-system change:
  - the control is enabled and shows the view on screen;
  - the URL hash is unchanged;
  - `cells`, `annotations` and gene reads use the view on screen.
- **Focused regression checks:**
  - The 4 failing cases in `evidence/repro/lifecycle/visium-library-cancel.repro.ts` and `spatialdata-view-cancel.repro.ts` pass.
  - The same scenarios are added to `src/App.test.tsx`, beside the existing cancel test at line 2869.
- **Broader checks:** the `App.test.tsx` load tests, which are timing-sensitive (see `notes/load-trace.md`).
- **Risk and decisions:** none.
- **Effort:** M.

### T03 One owned tile decode pool

- **Findings:** EXP-003; part of EXP-038.
- **Priority and dependencies:** wave 1; none. T21 and T41 build on it.
- **Target:** `src/workers/tileDecodePool.ts`, `src/tiff/tileCache.ts`, `src/rendering/morphologyTileStore.ts`.
- **Correction:** pick one of two designs.
  - **Shared pool (preferred):** use one shared tile decode pool, as `sharedStripDecodePool` already does, and have `createWorkerTileDecoder` return a decoder over it.
  - **Owned pool:** have `TileCache` own its pool, and have `MorphologyTileStore.drop` and `dispose` end it.
- **Scope boundaries:**
  - Pool size and the per-cache tile limit stay as they are.
  - Contrast caching is not redesigned.
- **Acceptance criteria:**
  - After ten contrast edits and a dataset switch on the 2-channel OME-TIFF fixture, at most 8 tile decode workers are alive.
  - Tiles still decode in parallel.
- **Focused regression checks:**
  - `evidence/repro/imaging/tilePoolLifetime.repro.ts`: workers started minus workers ended stays at most one pool's size.
  - A new `@smoke` test wraps `Worker` in `addInitScript`, counts constructions and `terminate` calls over ten edits, and asserts the bound. The fixture script is `evidence/ui-stage6/make_ome_tiff.py`; a smaller fixture is enough.
- **Broader checks:** auto-contrast and the Cell Query image thumbnails, which share tile stores.
- **Risk and decisions:** a shared pool serialises decodes from different caches. Check that the minimap and the main view stay responsive.
- **Effort:** M.

## Wave 2: P2

### T04 Keep negative values in AnnData multi-gene and ROI reads

- **Findings:** EXP-004.
- **Priority and dependencies:** wave 2; none.
- **Target:** `src/datasets/h5adDataset.ts`: `cellFromCountsByColumn`, `h5adMatrixForCells`.
- **Correction:** keep every non-zero value (`!== 0`) rather than every positive one. Detection in `src/data/roiGeneStats.ts` stays `> 0`.
- **Scope boundaries:** do not change Atera or MERSCOPE readers.
- **Acceptance criteria:**
  - Two cells storing −1 and 3 for one gene give sum 2 and mean per cell 1 in ROI statistics and in two-gene Sum or Mean colouring.
  - The ROI panel and Plots agree.
- **Focused regression checks:**
  - `roiGeneStats.test.ts` and `h5adDataset.test.ts` cases with a negative value and two genes, on CSR and dense `/X`.
  - Flip the expectation in `evidence/repro/AD/values.repro.ts`.
- **Broader checks:** the Plots oracle repro.
- **Risk and decisions:** sparse batches carry more entries on centred data. Measure the batch size on a scaled fixture.
- **Effort:** S.

### T05 Give z-scores a fixed, stated population

- **Findings:** EXP-005; the root cause goes to T40.
- **Priority and dependencies:** wave 2. Needs a product decision.
- **Target:** `src/rendering/geneExpressionRenderer.ts` (`geneExpressionScores`), `src/features/shell/helpText.ts:21`, the legend, and `docs/ui-reference.md` (Combine genes).
- **Correction:** pick one of two options.
  - **Fixed population (preferred):** compute the mean and SD over a fixed population independent of the view: all cells with zeros, from a per-dataset summary or a fixed sample.
  - **Stated population:** keep the batch population, but name it in the help text and legend ("relative to cells in view that express a selected gene").
- **Scope boundaries:** Sum and Mean modes are unchanged.
- **Acceptance criteria:**
  - **Fixed population:** a fixed cell's z-score is identical at two zooms and on an H5AD and a Xenium fixture with the same values.
  - **Stated population:** the help text, legend and docs state which cells form the population.
- **Focused regression checks:** flip the expectations in `evidence/repro/shell-shared/geneZScorePopulation.repro.ts`; add a renderer unit test.
- **Broader checks:** collection previews, which use the same scores.
- **Risk and decisions:** the fixed population needs a dataset-wide mean and SD per gene. It may cost a read of the whole gene on platforms that load by viewport.
- **Effort:** M for the fixed population, S for stating it.

### T06 Match Zarr transcript points to Parquet rows on the full ID

- **Findings:** EXP-006.
- **Priority and dependencies:** wave 2; after T01, so enrichment does not fail on `UNASSIGNED` rows while testing.
- **Target:** `src/data/transcriptZarr.ts:262` (point ID) and `src/data/transcriptOverlay.ts` (`transcriptPointMetadataKey`, `mergeTranscriptPointMetadata`).
- **Correction:**
  - Check on two XOA versions whether the Zarr `id` second column is the high 32 bits of `transcript_id`.
  - Then either rebuild the 64-bit ID from both columns, or key the merge on `transcript_id & 0xffffffff` together with `fov_name`.
- **Scope boundaries:** no new reads; the join stays per view.
- **Acceptance criteria:**
  - On a fixture whose Parquet ID is 65581 × 2^32 + 67995 and whose Zarr row holds 67995 (and 65581 if present), the point gets its cell, nucleus overlap and distance.
  - The Transcript card shows the cell.
- **Focused regression checks:** a `transcriptOverlay.test.ts` case with a 64-bit ID; the live repro `evidence/repro/platforms/xenium-zarr-ids-live.repro.ts` (needs the user's agreement to network use).
- **Broader checks:** `@live` Xenium transcript tests.
- **Risk and decisions:** if the Zarr does not hold the high word, matching on the low 32 bits within a field of view could collide. Measure collisions on the demo first.
- **Effort:** M.

### T07 Show zoomed-out transcript density as scaled or sampled

- **Findings:** EXP-007.
- **Priority and dependencies:** wave 2; none.
- **Target:**
  - `src/data/transcriptZarr.ts` (`chooseTranscriptGridLevel`, `readGridLevels`).
  - `src/components/viewerHoverTooltips.tsx:300-303`.
  - `src/features/transcripts/TranscriptStatusPanel.tsx:250-253`.
- **Correction:** pick one of two options.
  - **Estimate:** scale each square's `grid_number_objects` by the ratio of level-0 to level-n totals, and label it "≈ count".
  - **Label:** keep the raw number and label it "sampled count (level n, x% of transcripts)".
- **Scope boundaries:** colours are already normalised and stay as they are.
- **Acceptance criteria:** at level 7 on a fixture with known totals, the hover shows either the scaled estimate or the sampled label; level 0 is unchanged.
- **Focused regression checks:** unit tests for the label or scale at levels 0 and 7.
- **Broader checks:** none.
- **Risk and decisions:** scaling assumes the sample is uniform across the slide. The label is the safer default.
- **Effort:** S.

### T08 Read SpatialData integer instance keys exactly

- **Findings:** EXP-008.
- **Priority and dependencies:** wave 2; none.
- **Target:** `src/datasets/h5adDataset.ts` (`readObsColumnValues`, `numericArrayToNumbers`) and `src/datasets/spatialDataDataset.ts` (instance join).
- **Correction:** read `BigInt64Array` and `BigUint64Array` instance-key columns as exact decimal strings for the join, matching `instanceIdString` on the shapes side.
- **Scope boundaries:** numeric obs columns used as metadata may stay numbers. Only the instance key changes.
- **Acceptance criteria:** a store with three distinct IDs above 2^53 places every row; the small-ID control is unchanged.
- **Focused regression checks:** flip `evidence/repro/AD/spatialdata-int64.repro.ts`; add a unit test.
- **Broader checks:** the SpatialData dataset tests.
- **Risk and decisions:** none.
- **Effort:** S.

### T09 Key the remembered gene scale by Visium HD bin size

- **Findings:** EXP-009.
- **Priority and dependencies:** wave 2; none.
- **Target:**
  - `src/features/genes/geneControlsModel.ts` (`geneExpressionScaleKeyFor`).
  - `src/features/app-shell/useViewerLayerData.ts`.
  - `src/App.tsx` (`rememberGeneExpressionScaleMax`).
  - `src/features/app-shell/useViewportDataWorkflow.ts`.
  - `docs/ui-reference.md:384`.
- **Correction:**
  - Include the batch's bin size (from `GeneExpressionBatch` or the LOD plan) in the scale key, so each tier remembers its own top.
  - Add one sentence to the `Gene scale` row saying that Visium HD keeps one top per bin size.
- **Scope boundaries:** platforms without tiers are unchanged.
- **Acceptance criteria:** with 2 µm selected, after a zoomed-out 16 µm batch and then a zoomed-in 2 µm batch, the Auto top equals the 2 µm batch's top. Zooming back out restores the 16 µm top.
- **Focused regression checks:** flip `evidence/repro/shell-shared/visiumHdScaleKeyAcrossLod.repro.ts`; add a `geneControlsModel` unit test.
- **Broader checks:** the Visium HD bin card score tests.
- **Risk and decisions:** none.
- **Effort:** S.

### T10 Refuse short range bodies before caching

- **Findings:** EXP-010.
- **Priority and dependencies:** wave 2; none.
- **Target:**
  - `src/data/persistentByteRangeCache.ts` (`fetchByteRangeWithCache`, `cacheFooterByteRanges`).
  - `src/data/datasetWarmup.ts:125-143`.
  - `src/data/hyparquetCells.ts:189-210`.
- **Correction:**
  - Throw when `bytes.byteLength !== end - start` before storing or returning.
  - Fetch Parquet footer ranges with `cache: 'no-store'`, as Zarr and TIFF ranges already are.
- **Scope boundaries:** no retry policy (that is the known-open timeout and retry item).
- **Acceptance criteria:** a host that returns half of each range gives a clear error and stores nothing. A later load from a good host succeeds.
- **Focused regression checks:** flip `evidence/repro/io/byteRangeCacheShortBody.repro.ts`; add cases to `persistentByteRangeCache.test.ts`.
- **Broader checks:** TIFF and Xenium unit tests.
- **Risk and decisions:** any host that relies on returning less than requested at the end of a file now fails. Clamp `end` to the known file size first.
- **Effort:** S.

### T11 Release the deck.gl device on every switch

- **Findings:** EXP-011; part of EXP-038.
- **Priority and dependencies:** wave 2; none.
- **Target:** `src/components/ViewerCore.tsx:2193-2195`.
- **Correction:** pick one of two options.
  - **Keep one Deck mounted (preferred):** keep `MemoDeckGL` mounted across switches and pass empty layers while a dataset loads.
  - **Destroy on unmount:** on unmount, call the device's `destroy()` and lose the WebGL context with `WEBGL_lose_context`.
- **Scope boundaries:** layer construction is unchanged.
- **Acceptance criteria:**
  - Over ten collection switches, at most 2 WebGL contexts are live.
  - The main-thread heap after garbage collection does not grow with the number of switches; within 10% between 10 and 30 switches is a suitable bound.
- **Focused regression checks:** a `@smoke` test wraps `HTMLCanvasElement.prototype.getContext` in `addInitScript` and counts contexts not lost over ten switches of the small collection fixture.
- **Broader checks:** `App.test.tsx` tests that mock `@deck.gl/react`; the viewport report timing (`notes/load-trace.md`).
- **Risk and decisions:**
  - A Deck kept mounted keeps its view state across datasets. Reset it explicitly.
  - Measure with `evidence/ui-stage6/` specs before and after.
- **Effort:** M.

## Wave 3: P3

### T12 Skip non-finite values in z-scores and Plots summaries

- **Findings:** EXP-012.
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/rendering/geneExpressionRenderer.ts` (`geneExpressionScores`) and the Plots summary functions in `src/features/plots/`.
- **Correction:** leave non-finite values out of means, standard deviations and maxima, and report the count in the legend or summary.
- **Scope boundaries:** stored values are not rewritten.
- **Acceptance criteria:** one NaN in a dense column leaves the other cells' z-scores finite and the Plots mean and axis finite, with "1 non-finite value skipped".
- **Focused regression checks:** cases in the renderer and Plots tests; `evidence/repro/AD/values.repro.ts` (NaN case flipped).
- **Broader checks:** the Plots oracle repro.
- **Risk and decisions:** none.
- **Effort:** S.

### T13 Collision-free suffixes for repeated names

- **Findings:** EXP-013.
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/datasets/h5adDataset.ts` (`uniqueNames`) and `docs/modalities/h5ad.md:172,181`.
- **Correction:** when generating `name-n`, skip any `n` whose result is already in the input or already generated.
- **Scope boundaries:** names without duplicates keep their spelling.
- **Acceptance criteria:**
  - Obs names `c0, c0, c0-2` become three distinct names.
  - Genes `G, G, G-2` give one column per name, and every backend returns the same profile.
- **Focused regression checks:** `uniqueNames` unit cases; `evidence/repro/AD/axes.repro.ts` lines 200-264 agree across backends.
- **Broader checks:** share links that name genes with suffixes.
- **Risk and decisions:** links that already name a suffixed gene may point at another column after the fix. This is rare; mention it in the release notes.
- **Effort:** S.

### T14 Report ROI truncation from what the reader returned

- **Findings:** EXP-014.
- **Priority and dependencies:** wave 3; none.
- **Target:**
  - `src/App.tsx` (`loadActiveRoiCells`).
  - `src/features/roi/useRoiWorkflow.ts:476,481,799`.
  - `src/features/plots/useSelectionCells.ts:81`.
  - `docs/ui-reference.md:658`.
- **Correction:** pass the 50,000 limit on the AnnData path as the Xenium path does, or set the "cut short" flag only when the reader says it stopped early. Align the docs with the choice.
- **Scope boundaries:** the limit value is unchanged.
- **Acceptance criteria:** a 60,000-cell ROI on H5AD is either cut at 50,000 and flagged, or complete and not flagged, and `hit_cell_limit` in the export matches.
- **Focused regression checks:** `evidence/repro/analysis/roiLimit.repro.ts` (first case flipped); a `useRoiWorkflow` test.
- **Broader checks:** Magic Lens and Plots selection tests.
- **Risk and decisions:** which behaviour is wanted. Complete ROIs are more useful, but exports grow.
- **Effort:** S.

### T15 TIFF: per-level tile size and `PhysicalSizeY`

- **Findings:** EXP-015 (a) and (b), the silent wrong images.
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/tiff/loader.ts:412-438` (SubIFD levels), the OME-XML pixel-size reading, and image placement.
- **Correction:**
  - Read each SubIFD level's own tile width and height.
  - Read `PhysicalSizeY`. When it differs from `PhysicalSizeX`, either place the image with per-axis scale or refuse it with a message naming both sizes.
- **Scope boundaries:** no change for files with one tile size and square pixels.
- **Acceptance criteria:**
  - The repro's level tiled differently decodes with 0 differing pixels.
  - A 0.5 × 1.0 µm image is drawn full height or refused with a message.
  - The per-cell measurement oracle agrees for all 67 cells, or the image is refused.
- **Focused regression checks:** the two cases in `evidence/repro/imaging/tiffFormats.repro.ts`; `evidence/repro/imaging/cellImageMeasureOracle.repro.ts`.
- **Broader checks:** QPTIFF, SVS and NDPI unit tests.
- **Risk and decisions:** per-axis placement touches every image consumer. Refusing is the smaller change.
- **Effort:** M.

### T16 TIFF: signed samples and a missing `Compression` tag

- **Findings:** EXP-015 (c) and (d).
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/codecs/tiffTile.ts:60-65`, sample-format handling, and `docs/modalities/image.md:172`.
- **Correction:**
  - Default a missing `Compression` tag to 1 (none).
  - Handle `SampleFormat` 2 (signed) by offsetting into the contrast range, or refuse it with a message, and say which in `image.md`.
- **Scope boundaries:** float images stay refused, as documented.
- **Acceptance criteria:** the repro's untagged tile decodes; an int16 tile shows −500 as −500 or is refused with a message.
- **Focused regression checks:** the two cases in `evidence/repro/imaging/tiffFormats.repro.ts`.
- **Broader checks:** codec tests.
- **Risk and decisions:** none.
- **Effort:** S.

### T17 Refuse or honour anisotropic `.vzg` transforms

- **Findings:** EXP-016.
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/datasets/merscopeFormat.ts:149-174` (`parseMerscopeTransform`).
- **Correction:** refuse unequal x and y scales with a message naming both, as shear already is, or carry per-axis scale into placement.
- **Scope boundaries:** isotropic transforms are unchanged.
- **Acceptance criteria:** the repro's scale 2 and 4 transform is placed with x ending at 1100 and y at 3040, or refused with a message.
- **Focused regression checks:** `evidence/repro/platforms/merscope-vzg-placement.repro.ts`.
- **Broader checks:** MERSCOPE dataset tests.
- **Risk and decisions:** none.
- **Effort:** S.

### T18 RFC 4180 fields in MERSCOPE CSVs

- **Findings:** EXP-017.
- **Priority and dependencies:** wave 3; none. T20 touches the same reader.
- **Target:** `src/datasets/merscopeFormat.ts` (`splitHeader`, `forEachRow`).
- **Correction:** parse quoted fields per RFC 4180: commas and newlines inside quotes, and `""` as an escaped quote.
- **Scope boundaries:** keep the streaming row reader.
- **Acceptance criteria:** `"T cell, CD4+"` reads as one field; `a ""b""` reads as `a "b"`.
- **Focused regression checks:** the two failing cases in `evidence/repro/platforms/merscope-csv-join.repro.ts`.
- **Broader checks:** the 19-digit ID and BOM cases in the same repro.
- **Risk and decisions:** parsing speed on large `cell_by_gene.csv`. Measure on the MERSCOPE fixture.
- **Effort:** S.

### T19 Gzipped `.h5` in a Visium manifest

- **Findings:** EXP-019.
- **Priority and dependencies:** wave 3; none.
- **Target:** the standard Visium matrix open path, and `docs/dataset-manifest.md:176-177`, `docs/modalities/visium.md:62-64`.
- **Correction:** inflate a `.h5.gz` matrix before opening it, since it is read whole anyway, or name the exception in both pages.
- **Scope boundaries:** H5AD files are not covered by this task.
- **Acceptance criteria:** a manifest naming `filtered_feature_bc_matrix.h5.gz` loads, or both pages say `.h5` must not be gzipped.
- **Focused regression checks:** `evidence/repro/platforms/visium-h5-gzip.repro.ts`.
- **Broader checks:** Visium reader tests.
- **Risk and decisions:** none.
- **Effort:** S.

### T20 Stop inflating a MERSCOPE CSV at the size limit

- **Findings:** EXP-018.
- **Priority and dependencies:** wave 3; after T18, since both change the same reader.
- **Target:** `src/datasets/merscopeTableReader.ts:79-98`.
- **Correction:** count inflated bytes while streaming and stop with the documented message once past `MERSCOPE_CSV_MAX_BYTES`.
- **Scope boundaries:** the limit value is unchanged.
- **Acceptance criteria:** a gzipped CSV inflating to 520 MiB gives the documented size message without decoding the whole text.
- **Focused regression checks:** `evidence/repro/platforms/merscope-size-limit.repro.ts`.
- **Broader checks:** MERSCOPE reader tests.
- **Risk and decisions:** none.
- **Effort:** S.

### T21 Reset the tile pool when a worker fails

- **Findings:** EXP-020.
- **Priority and dependencies:** wave 3; after T03, since both change the same pool.
- **Target:** `src/workers/tileDecodePool.ts:274-276`.
- **Correction:** on a worker `error`, reject its pending requests, end the worker and drop it, as `zarrDecodePool.ts:328-332` does. If no worker can start, decode on the main thread, as the one-shot readers do.
- **Scope boundaries:** no retry loop of worker starts.
- **Acceptance criteria:** with a worker that fails to load, every later tile request either rejects with a clear error or decodes; none stays pending.
- **Focused regression checks:** flip `evidence/repro/quality/tilePoolWorkerLoadFailure.repro.ts`.
- **Broader checks:** TIFF tile cache tests.
- **Risk and decisions:** main-thread fallback can stall frames on large tiles. A clear error is acceptable instead.
- **Effort:** S.

### T22 Recognise stale chunks after a redeploy

- **Findings:** EXP-021.
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/features/errors/loadErrorModel.ts` (`createStructuredLoadError`), plus a `vite:preloadError` listener at startup.
- **Correction:** classify failed dynamic imports by their message. The Chromium, Firefox and Safari forms are listed in the repro. Show "The app was updated. Reload the page." with a reload action.
- **Scope boundaries:** do not reload automatically.
- **Acceptance criteria:** the three messages map to the new kind, and real network errors keep the current advice.
- **Focused regression checks:** flip `evidence/repro/quality/staleChunkError.repro.ts`; add cases to the load error tests.
- **Broader checks:** none.
- **Risk and decisions:** a genuine CDN outage would also be read as "updated". The reload advice still fits.
- **Effort:** S.

### T23 Move the tonsil example to the livingobjects mirror

- **Findings:** EXP-022.
- **Priority and dependencies:** wave 3; quick win, no dependency.
- **Target:** `examples/idr/idr0054-tonsil.json:15`, `examples/index.json` (regenerated), and optionally `.github/workflows/e2e-live.yml`.
- **Correction:**
  - Replace `https://uk1s3.embassy.ebi.ac.uk/idr/` with `https://livingobjects.ebi.ac.uk/idr/`, as PR #181 did for idr0062.
  - Run `node scripts/examples-index.ts`.
  - Optionally open or update an issue when the scheduled suite fails twice in a row.
- **Scope boundaries:** the other IDR examples are already on the mirror.
- **Acceptance criteria:** `node scripts/examples-index.ts --check` passes; the next scheduled live run passes the tonsil test.
- **Focused regression checks:** `loads the idr/idr0054-tonsil example @live`.
- **Broader checks:** none.
- **Risk and decisions:** the mirror's long-term availability.
- **Effort:** S.

### T24 Version and pin release builds

- **Findings:** EXP-023.
- **Priority and dependencies:** wave 3; none.
- **Target:** `.github/workflows/release.yml:46`, `src/features/shell/docLinks.ts`, `src/features/start/examplesIndex.ts`, `docs/deploy-to-s3.md`.
- **Correction:**
  - Pass `VITE_COMMIT_SHA` and the tag to the release build.
  - Either point release builds' Help links and gallery index at the tag, or state in the release section of `deploy-to-s3.md` that they follow `main`.
- **Scope boundaries:** the Pages build is unchanged.
- **Acceptance criteria:**
  - A release zip's Help shows its tag and commit, and its `index.html` has the `build-commit` meta.
  - The docs or the links match the chosen behaviour.
- **Focused regression checks:** a smoke test on the zipped `dist/` in the release job checks the meta.
- **Broader checks:** release job dry run on a pre-release tag.
- **Risk and decisions:** pinning the gallery to a tag hides later fixes to examples. Which to prefer is the owner's call.
- **Effort:** S.

### T25 Detect a dataset once per load

- **Findings:** EXP-024.
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/features/app-shell/useDatasetLifecycle.ts` (`startDatasetLoad`) and `src/datasets/datasetFactory.ts:1540` (`createSpatialDataset`).
- **Correction:** pass the layout detected by `startDatasetLoad` into the factory, or memoise `detectSpatialDataset` per URL for the duration of one load.
- **Scope boundaries:** detection order and probes are unchanged.
- **Acceptance criteria:** on the Space Ranger folder fixture, each probe URL is requested once per cold load (27 requests instead of 42).
- **Focused regression checks:** a factory unit test that counts fetches; `evidence/ui-stage6/` request-count spec.
- **Broader checks:** detection tests in `datasetFactory.test.ts`.
- **Risk and decisions:** a memo must not outlive the load, since a folder can change between loads.
- **Effort:** S.

### T26 Scope the release job's write token

- **Findings:** EXP-025.
- **Priority and dependencies:** wave 3; none.
- **Target:** `.github/workflows/release.yml`.
- **Correction:**
  - Set `persist-credentials: false` on checkout.
  - Move `GH_TOKEN` from the job's `env` to the two `gh` steps.
  - Alternatively, split into a read-only build-and-test job and an upload job with `contents: write`.
- **Scope boundaries:** release contents are unchanged.
- **Acceptance criteria:** only the upload steps can see a token with write access.
- **Focused regression checks:** a pre-release run succeeds.
- **Broader checks:** none.
- **Risk and decisions:** none.
- **Effort:** S.

### T27 Keep tokens out of the recent list

- **Findings:** EXP-026.
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/features/start/recentDatasets.ts`, plus the share-link section of `docs/ui-reference.md` and `docs/h5ad-reference.md:459-461`.
- **Correction:** store recent entries without their query string, or with a marker that the address carried one. Say in the docs that a share link of a presigned dataset carries its token.
- **Scope boundaries:** share links keep the full URL, since presigned links need it.
- **Acceptance criteria:** after opening a URL with `?X-Amz-Signature=…`, `localStorage` holds no signature, and the docs say what share links contain.
- **Focused regression checks:** a `recentDatasets` unit test.
- **Broader checks:** the start screen tests.
- **Risk and decisions:** reopening a presigned dataset from the recent list will need the full URL again.
- **Effort:** S.

### T28 Histogram role, and image states in the axe test

- **Findings:** EXP-027; part of EXP-038.
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/features/morphology/MorphologyChannelControls.tsx:200-202` and `tests/e2e/app.spec.ts` (axe test).
- **Correction:**
  - Give the histogram `role="img"` with its label, or `aria-hidden="true"`.
  - Scan an OME-TIFF channel state in the axe smoke test. The offline fixtures need a small OME-TIFF; `evidence/ui-stage6/make_ome_tiff.py` shows one way.
- **Scope boundaries:** do not regenerate `tests/e2e/axe-baseline.json`; it should stay empty.
- **Acceptance criteria:** axe reports no `aria-prohibited-attr` on the channel controls at 1440, 1024 and 390 px.
- **Focused regression checks:** the extended axe smoke test.
- **Broader checks:** none.
- **Risk and decisions:** none.
- **Effort:** S.

### T29 24 px collection bar targets, and a collection in the axe test

- **Findings:** EXP-028; part of EXP-038.
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/styles/collection.css:44-49` and `tests/e2e/app.spec.ts`.
- **Correction:**
  - Make `.collection-bar-action` at least 24 × 24 px, or space the buttons to meet WCAG 2.5.8.
  - Scan an open collection in the axe smoke test.
- **Scope boundaries:** same as T28.
- **Acceptance criteria:** axe reports no `target-size` on an open collection at 1440 and 1024 px.
- **Focused regression checks:** the extended axe smoke test.
- **Broader checks:** layout at 390 px (the section strip).
- **Risk and decisions:** none.
- **Effort:** S.

### T30 Open floating windows clear of the left drawer

- **Findings:** EXP-029.
- **Priority and dependencies:** wave 3; none. T38 builds on it.
- **Target:** `src/features/shell/floatingWindowModel.ts:11-28`.
- **Correction:** when the left drawer is open, place a new window to the right of it. If the canvas is too narrow for that, close the drawer as the window opens.
- **Scope boundaries:** windows the user has dragged keep their place.
- **Acceptance criteria:** at 1024 × 768 with Dataset info open, Plots and Cell Query open fully visible, and the smoke suite passes 19 of 19 at that size.
- **Focused regression checks:** a `floatingWindowModel` unit test; the smoke suite at 1024 × 768 (`evidence/ui-stage6/pw.stage6.config.mjs` shows how).
- **Broader checks:** focus return on close.
- **Risk and decisions:** none.
- **Effort:** S.

### T31 Settle Plots on Visium HD

- **Findings:** EXP-030.
- **Priority and dependencies:** wave 3. Needs a product decision.
- **Target:**
  - `src/App.tsx:4593-4594`.
  - `src/features/plots/usePlotsWorkflow.ts:40-45`.
  - `docs/ui-reference.md:195-196, 1405`.
  - `docs/user-guide.md:433-434`.
  - `docs/modalities/visium-hd.md:191-192`.
- **Correction:** pick one of two options.
  - **Hide the toggle:** hide `Plots` on Visium HD, as Cell Query is hidden, and correct `visium-hd.md`.
  - **Keep the toggle:** correct the other two pages, and make the message say what is missing ("cannot read a gene across every bin").
- **Scope boundaries:** no Plots support for Visium HD.
- **Acceptance criteria:** all three pages and the UI agree.
- **Focused regression checks:** update `evidence/repro/docs-core/plotsVisiumHd.repro.ts` to the decision; add an `App` test of toggle availability.
- **Broader checks:** none.
- **Risk and decisions:** the decision itself.
- **Effort:** S.

### T32 Tighten the public schemas and say the viewer checks more

- **Findings:** EXP-031.
- **Priority and dependencies:** wave 3; none.
- **Target:** `public/schemas/` (manifest and collection), `docs/dataset-manifest.md:450-458`, `docs/dataset-collections.md:488-497`.
- **Correction:**
  - Add `pattern` for non-blank names, `dependentRequired` for options that need a file, and `if`/`then` for the Visium HD `binSize` and the image kinds.
  - In both guides, say that the viewer also checks duplicates, ranges and mixed `z`.
- **Scope boundaries:** schema `$id` and version stay; nothing the app accepts may become schema-invalid.
- **Acceptance criteria:** the expressible probes in `evidence/fixtures/docs-formats/probes.json` fail the schema. Every example and collection still validates.
- **Focused regression checks:** `evidence/repro/docs-formats/schemaParserProbes.repro.ts`; `evidence/docs-formats/schema_validate.py`.
- **Broader checks:** `node scripts/examples-index.ts --check`.
- **Risk and decisions:** editors may flag files users already have. They are files the app refuses anyway.
- **Effort:** M.

### T33 Say which CI checks block

- **Findings:** EXP-032.
- **Priority and dependencies:** wave 3; quick win. Branch protection is the owner's decision.
- **Target:** `README.md:44-46`, `vitest.config.ts:31-32`, and optionally the repository settings.
- **Correction:** pick one of two options.
  - **Reword:** README says CI must pass before Pages deploys, and that merging is protected by convention. The config comment says a drop shows in the coverage job without failing CI.
  - **Protect `main`:** require `check` and `e2e-smoke`, and leave the README as it is.
- **Scope boundaries:** do not make the coverage job blocking as part of this task.
- **Acceptance criteria:** both texts match the repository settings.
- **Focused regression checks:** none (wording).
- **Broader checks:** none.
- **Risk and decisions:** branch protection.
- **Effort:** S.

### T34 MiB for binary limits

- **Findings:** EXP-033.
- **Priority and dependencies:** wave 3; quick win.
- **Target:** `README.md:143`, `docs/dataset-manifest.md:183`, `docs/host-your-own-data.md:210,245`, `docs/modalities/visium.md:287-288`, `docs/modalities/merscope.md`.
- **Correction:** write MiB wherever the limit is `n * 1024 * 1024`.
- **Scope boundaries:** limits unchanged.
- **Acceptance criteria:** `grep -n "[0-9] MB"` over `docs/` and `README.md` finds no binary limit.
- **Focused regression checks:** none.
- **Broader checks:** `npm run format:check`.
- **Risk and decisions:** none.
- **Effort:** S.

### T35 Bring four reference statements up to date

- **Findings:** EXP-034.
- **Priority and dependencies:** wave 3; none.
- **Target:**
  - `docs/modalities/h5ad.md:262`, `image.md:218`, `spatialdata.md:21,48-49,152,334`, `visium.md:48`, `xenium.md:19-21`.
  - `docs/ui-reference.md` (Shareable URL table).
- **Correction:**
  - Name the current functions (`csrLazyRowBatches` or `csrRowBatches`, `readQptiffFile`, and the replacements for the two removed functions after reading each sentence).
  - Add `aimg` and `sectionView` to the share table.
  - Link `xenium.md`'s fallback to `architecture.md`'s detection order.
  - Say zipped OME-Zarr images open too.
- **Scope boundaries:** no other rewording.
- **Acceptance criteria:** `evidence/docs-formats/check-code-refs.mjs` reports none of the four names. The share table lists every key in `shareableState.ts`.
- **Focused regression checks:** `evidence/docs-core/url-keys.mjs`.
- **Broader checks:** link checks.
- **Risk and decisions:** none.
- **Effort:** S.

### T36 Sync `open-items.md` with phases 24 and 25

- **Findings:** EXP-035.
- **Priority and dependencies:** wave 3; none.
- **Target:** `docs/plan/open-items.md:139-144`, plus a new entry linking `docs/plan/phases/25-imported-segmentations.md#known-gaps`.
- **Correction:** drop "no registered test dataset" from the 3D stack entry, and add the six phase 25 gaps.
- **Scope boundaries:** plan records only.
- **Acceptance criteria:** every unchecked box in `docs/plan/phases/` is linked from `open-items.md`.
- **Focused regression checks:** a one-off grep of unchecked boxes per phase.
- **Broader checks:** none.
- **Risk and decisions:** none.
- **Effort:** S.

### T37 Make the Atera feature-count test reach its check

- **Findings:** EXP-037.
- **Priority and dependencies:** wave 3; none.
- **Target:** `src/datasets/ateraDataset.test.ts:530-538`, plus the 13 other bare `rejects.toThrow()` listed in `notes/quality-stage7.md`.
- **Correction:**
  - Build a CSC store whose `indptr` length disagrees with the feature count, and assert the message from `ateraDataset.ts:786-790`.
  - Give the other 13 an error name or message.
- **Scope boundaries:** tests only; do not change the checks.
- **Acceptance criteria:** the Atera test fails when the feature-count check is removed, and passes with it.
- **Focused regression checks:** `evidence/quality-stage7/ateraCscProbe.setup.ts` shows the error each test currently gets.
- **Broader checks:** none.
- **Risk and decisions:** none.
- **Effort:** S.

### T38 One narrow-layout smoke test

- **Findings:** EXP-038.
- **Priority and dependencies:** wave 3; after T30.
- **Target:** `tests/e2e/controls.ts` and `tests/e2e/app.spec.ts`.
- **Correction:**
  - Give the helpers a narrow mode: the `Panels` menu for window toggles, and the layer bottom sheet for sections.
  - Add one `@smoke` test at 390 × 844 that opens the H5AD fixture, picks a gene, opens one window from `Panels`, and closes it with focus returned.
- **Scope boundaries:**
  - Do not run the whole suite at 390 px.
  - Do not add a second Playwright project unless the owner wants one.
- **Acceptance criteria:** the test passes on the fixed app and fails if the `Panels` menu loses a toggle.
- **Focused regression checks:** the new test.
- **Broader checks:** the existing `@smoke` suite.
- **Risk and decisions:** none.
- **Effort:** M.

## Wave 4: structural, behaviour-preserving

### T39 Pending-load record owned by the lifecycle

- **Findings:** EXP-002, root cause (MNT-01).
- **Priority and dependencies:** wave 4; after T02, whose tests must keep passing.
- **Target:** `src/features/app-shell/useDatasetLifecycle.ts`, `src/App.tsx`, `src/features/app-shell/useVisiumControlsWorkflow.ts`, `src/datasets/datasetFactory.ts` (selection registry), `src/datasets/h5adDataset.ts` (`setVisiumView`).
- **Correction:**
  - Introduce one pending-load record in `useDatasetLifecycle`, holding the requested view (Visium library, SpatialData selection) and its share state. Apply it when the load commits and drop it on cancel or failure.
  - Give Visium libraries their own dataset instances, keyed like SpatialData selections, so no instance changes in place.
- **Scope boundaries:** no change in behaviour beyond T02; no new features.
- **Acceptance criteria:**
  - T02's tests and the existing `App.test.tsx` load tests pass unchanged.
  - `setVisiumView` is no longer called on a shared instance before commit.
  - `cancelDatasetLoad` needs no knowledge of view kinds.
- **Focused regression checks:** T02's tests.
- **Broader checks:** the full `App.test.tsx`, which has known timing flakes (record a run's timing beside a main checkout).
- **Risk and decisions:** a large change to the busiest file (92 commits in 30 days). Land it in a quiet period.
- **Effort:** L.

### T40 Move the expression-batch contract and test it per platform

- **Findings:** EXP-005, root cause (MNT-02).
- **Priority and dependencies:** wave 4; after T05's decision.
- **Target:**
  - Move `GeneExpressionBatch` and `GeneExpressionQueryOptions` from `src/datasets/xeniumDataset.ts:147-171` to `src/datasets/spatialDataset.ts`.
  - Readers: `xeniumDatasetReaders.ts`, `h5adDataset.ts`, `ateraDataset.ts`, `visiumHdDatasetReaders.ts`.
- **Correction:**
  - Move the types.
  - Add a `population` field (`'all'`, `'expressing'` or `'sampled'`) that each reader sets.
  - Add one contract test that runs each platform's batch reader on the same small layout and checks the field and the cells returned.
- **Scope boundaries:** readers' outputs do not change in this task. Differences found by the contract test become their own fixes.
- **Acceptance criteria:**
  - The type-only import cycle through `GeneExpressionBatch` disappears from `evidence/quality-stage7/import-graph.log` when rerun.
  - The contract test passes on every reader.
- **Focused regression checks:** the new contract test.
- **Broader checks:** typecheck.
- **Risk and decisions:** none.
- **Effort:** M.

### T41 One worker-once helper and one abort module

- **Findings:** EXP-036.
- **Priority and dependencies:** wave 4; after T03 and T21, so the pools are settled first.
- **Target:**
  - The six one-shot wrappers: `merscopeTableWorker.ts`, `featureBarcodeMexWorker.ts`, `vectorSegmentationWorker.ts`, `zipEntryWorker.ts`, `cellsOverviewWorker.ts`, `spatialDataShapesWorker.ts`.
  - The 73 local `abortError`, `throwIfAborted` and `isAbortError` definitions.
- **Correction:**
  - Extract `runWorkerOnce(request, { signal, fallback })` with the shared abort, error, fallback and terminate logic.
  - Extract one `src/utils/abort.ts` with the three functions. Keep `xeniumDataset.ts:739`'s `DOMException` check only if a caller needs it.
- **Scope boundaries:** no change in behaviour; existing wrapper tests pass unchanged.
- **Acceptance criteria:** existing tests pass unmodified; each wrapper is under 40 lines; one definition of each abort helper.
- **Focused regression checks:** the wrapper tests.
- **Broader checks:** typecheck, lint.
- **Risk and decisions:** a refactor across many files. Review it as one mechanical change.
- **Effort:** M.

## Not tasked

- **Remove the unused option `visiumHdMaxTwoMicrometerFilteredBarcodes`** (`datasetFactory.ts:181-186, 1700-1730, 2090-2094`), or wire it to the device profile. This is clean-up with no finding; it can join T39.
- **Hypotheses in `REVIEW_REPORT.md`:** each needs a check before any task is written.
- **Known-open items reconfirmed by the review:** timeouts and retries, reads that continue after Cancel, per-URL caches, and optional reads treated as absent. They remain tracked in `docs/plan/open-items.md`.
