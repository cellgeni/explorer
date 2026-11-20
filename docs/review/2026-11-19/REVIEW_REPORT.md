# Spatial Omics Explorer review report

Review of commit `6a9a736a26fc1b095ed7c1bbfbace97ab4eddf10`, carried out 2026-11-19 to 2026-11-20 against the plan `REVIEW.md` (R0–R7). Repair tasks: `REVIEW_TASKS.md`. Coverage, baseline and delegation ledger: `COVERAGE.md`. Documentation claims: `DOC_CODE_MATRIX.csv`. Working notes per stage: `notes/`.

Paths in this report are repository-relative. Paths starting `evidence/` or `notes/` are relative to `docs/review/2026-11-19/`. Repros run from the repository root with:

```sh
npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts <file>
```

A repro that **fails** asserts the expected behaviour, so it fails while the defect is present. A repro that **records** passes while asserting the current behaviour, with the expected value in its comments.

## Snapshot

| Item         | Value                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Repository   | `cellgeni/explorer`, worktree `.claude/worktrees/type-support-question-5174cf`, branch `claude/review-document-4602a9`           |
| Commit       | `6a9a736` (origin/main, merge of PR 197, 2026-11-19 20:28 UTC); also the commit deployed on GitHub Pages during the review       |
| Working tree | Unchanged apart from `docs/review/` (checked with `git status` and `git diff` at the end of stage 8)                             |
| Host         | macOS 26.7.3 (Apple silicon), Node 25.8.1, npm 11.11.1, Playwright 1.60.0 (Chromium build 1223). CI uses Node 24 on Ubuntu 24.04 |
| Browsers     | Chromium only, headless, SwiftShader unless marked GPU (Metal). Firefox and Safari not run                                       |
| Live data    | No `@live` test was run: the user did not agree to the transfer cost. GitHub's scheduled live runs were read instead             |
| Delegation   | One Sonnet worker (stage 2), which ran at xhigh effort instead of medium; no worker after that. Details in `COVERAGE.md`         |

## Summary

The baseline is green: formatting, lint, types, 3,049 unit tests, the build, 19 offline smoke tests, coverage above its thresholds, and both audits (`COVERAGE.md`). Types are strict, there are no runtime import cycles and no floating promises, unit tests use the real HDF5, Parquet and image decoders, and SQL, CSV export, HTML rendering and links handle external data safely.

The review found 38 findings: no P0, 3 P1, 8 P2 and 27 P3.

The three P1 findings:

- **EXP-001:** `Export Transcripts` fails for almost any ROI on current Xenium output, including the registered demo, because transcripts outside cells carry the cell ID `UNASSIGNED`.
- **EXP-002:** After a cancelled or failed Visium library or SpatialData view change, the app keeps showing the old view but reads from the new one, and the view control stays disabled.
- **EXP-003:** Every contrast edit on an image starts a new pool of tile decode workers that is never ended: 1,140 live workers after 60 typed edits.

The P2 findings are mostly silent value errors on narrower inputs:

- negative values dropped from AnnData multi-gene and ROI reads (EXP-004);
- z-scores computed against a population that changes by platform and view (EXP-005);
- Zarr transcripts never matched to their cell (EXP-006);
- sampled transcript density shown as counts (EXP-007);
- SpatialData tables with 64-bit IDs refused (EXP-008);
- the Visium HD gene scale carried across bin sizes (EXP-009);
- a short range body cached for good (EXP-010);
- the previous deck.gl instance and WebGL context kept on every dataset switch (EXP-011).

Most P3 findings are documentation, rare input layouts, accessibility, release metadata and test gaps.

The scheduled live suite has failed on `main` since 2026-11-19 because one gallery example's host refuses connections (EXP-022). The fix is one line.

Coverage is partial (see "Coverage and remaining uncertainty"):

- **Source:** 77 of 490 source files were read (25 in full, 52 in part). The rest were covered only by repository-wide checks.
- **Platforms:** every platform has one success case and one failure case. Atera, Icechunk and kerchunk reference stores rely on existing tests only.

## Findings index

Confidence: **exec** confirmed by execution, **static** supported by static proof, **hyp** hypothesis. Status is `new` unless stated.

| ID      | Sev | Confidence    | Category        | Title                                                                                 | Notes ID                       | Task                         |
| ------- | --- | ------------- | --------------- | ------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------- |
| EXP-001 | P1  | exec          | correctness     | ROI transcript export fails on current Xenium output (`UNASSIGNED` cell IDs)          | PLT-01                         | T01                          |
| EXP-002 | P1  | exec + static | correctness     | A cancelled or failed view change leaves the hidden view in charge                    | LIF-01, MNT-01                 | T02, T39                     |
| EXP-003 | P1  | exec          | reliability     | Tile decode worker pools are never ended; each contrast value starts one              | IO-02                          | T03                          |
| EXP-004 | P2  | exec          | correctness     | AnnData reads drop negative values except for a single gene                           | SCI-01                         | T04                          |
| EXP-005 | P2  | exec + static | correctness     | "Z-score" compares a cell with a population that depends on platform and view         | SCI-02, MNT-02                 | T05, T40                     |
| EXP-006 | P2  | exec          | correctness     | Exact transcripts from the Zarr never get their cell                                  | PLT-02                         | T06                          |
| EXP-007 | P2  | static        | correctness     | Zoomed-out transcript density shows sampled counts as "Count"                         | PLT-03                         | T07                          |
| EXP-008 | P2  | exec          | correctness     | SpatialData tables with 64-bit instance IDs above 2^53 do not load                    | PLT-04                         | T08                          |
| EXP-009 | P2  | static        | correctness     | Visium HD Auto gene scale keeps the 16 µm top after zooming into 2 µm or 8 µm bins    | first-attempt lead             | T09                          |
| EXP-010 | P2  | exec          | reliability     | A short range body is cached and served to every later load                           | IO-01                          | T10                          |
| EXP-011 | P2  | exec          | performance     | Every dataset or section switch keeps the previous deck.gl instance and WebGL context | PERF-01                        | T11                          |
| EXP-012 | P3  | exec          | correctness     | One non-finite stored value breaks z-score colouring and Plots summaries              | SCI-03                         | T12                          |
| EXP-013 | P3  | exec          | correctness     | Generated suffixes for repeated names can collide with existing names                 | SCI-04                         | T13                          |
| EXP-014 | P3  | exec          | correctness     | AnnData ROIs are complete but labelled as cut short at 50,000 cells                   | SCI-05                         | T14                          |
| EXP-015 | P3  | exec          | correctness     | The TIFF reader mis-reads four uncommon layouts without saying so                     | PLT-09                         | T15, T16                     |
| EXP-016 | P3  | exec          | correctness     | Anisotropic MERSCOPE `.vzg` transforms are averaged                                   | PLT-07                         | T17                          |
| EXP-017 | P3  | exec          | correctness     | MERSCOPE CSVs with quoted commas are refused                                          | PLT-05                         | T18                          |
| EXP-018 | P3  | exec          | reliability     | A gzipped MERSCOPE CSV is inflated whole before its size is checked                   | PLT-06                         | T20                          |
| EXP-019 | P3  | exec          | correctness     | A gzipped `.h5` named in a Visium manifest fails                                      | PLT-08                         | T19                          |
| EXP-020 | P3  | exec          | reliability     | A tile decode worker that fails to load leaves later tiles pending forever            | IO-03                          | T21                          |
| EXP-021 | P3  | exec          | reliability     | A lazy chunk missing after a redeploy is reported as a dataset network error          | REL-01                         | T22                          |
| EXP-022 | P3  | exec          | reliability     | The tonsil gallery example's host refuses connections; the live suite fails on `main` | CI-01                          | T23                          |
| EXP-023 | P3  | static        | reliability     | Release builds show no version; their gallery and Help follow `main`                  | REL-02                         | T24                          |
| EXP-024 | P3  | exec          | performance     | Detection probes run twice on a cold folder load                                      | PERF-02                        | T25                          |
| EXP-025 | P3  | static        | security        | The release job exposes a write token to every step                                   | CI-03                          | T26                          |
| EXP-026 | P3  | static        | security        | Signed URLs are kept in the recent list and share links                               | TRUST-01                       | T27                          |
| EXP-027 | P3  | exec          | accessibility   | Image channel histograms carry `aria-label` on an element with no role                | UI-01                          | T28                          |
| EXP-028 | P3  | exec          | accessibility   | Collection bar buttons are 22 px targets                                              | UI-02                          | T29                          |
| EXP-029 | P3  | exec          | accessibility   | At about 1024 px, Plots and Cell Query open under the Dataset info drawer             | UI-03                          | T30                          |
| EXP-030 | P3  | exec          | documentation   | The docs disagree on Plots for Visium HD                                              | DOC-01                         | T31                          |
| EXP-031 | P3  | exec          | documentation   | The public schemas pass files the app refuses                                         | DOC-04                         | T32                          |
| EXP-032 | P3  | exec          | documentation   | Stale wording about which CI checks block (partly known-open)                         | CI-02                          | T33                          |
| EXP-033 | P3  | static        | documentation   | 300 MB written for 300 MiB limits                                                     | DOC-05                         | T34                          |
| EXP-034 | P3  | static        | documentation   | Reference pages lag the code in four places                                           | DOC-02, DOC-03, DOC-07, PLT-10 | T35                          |
| EXP-035 | P3  | static        | documentation   | `open-items.md` out of step with phases 24 and 25                                     | DOC-06                         | T36                          |
| EXP-036 | P3  | static        | maintainability | Six copies of the one-shot worker wrapper and 73 local abort helpers                  | MNT-03                         | T41                          |
| EXP-037 | P3  | exec          | tests           | A test named for the Atera feature-count check never reaches it                       | TEST-01                        | T37                          |
| EXP-038 | P3  | exec          | tests           | No test guards resource lifetime, narrow layouts or image states in the axe scan      | TEST-02                        | T01, T03, T11, T28, T29, T38 |

Merged root causes: MNT-01 (no commit point for load and view-change state) is the cause of EXP-002 and is recorded there. MNT-02 (the expression-batch contract read three ways) is the cause of EXP-005. Linked, not merged: EXP-001 and EXP-006 share a parser (EXP-001 also breaks EXP-006's enrichment query); EXP-003, EXP-020 and EXP-036 share the tile pool; EXP-020 and EXP-021 share a trigger (a redeploy under an open tab).

## P1 findings

### EXP-001 ROI transcript export fails on current Xenium output

- **Severity:** P1. **Confidence:** confirmed by execution (real DuckDB-WASM on a fixture) and static proof; the live demo holds the triggering input. **Status:** new. **Category:** correctness.
- **Affected and trigger:** Xenium datasets from XOA 1.3 and later, which write `cell_id = "UNASSIGNED"` for transcripts outside every cell. Triggered by `Export Transcripts` on an ROI that holds one such row. Also affected: the Parquet exact-point fallback and the cell-ID enrichment of Zarr points (EXP-006).
- **Expected:** the ROI transcript CSV lists the ROI's transcripts, unassigned ones with no cell (`docs/modalities/xenium.md:50`, `docs/ui-reference.md:658`).
- **Actual:** the export rejects with "Invalid Xenium cell ID: UNASSIGNED." and writes nothing. When the view holds such a row, the enrichment of Zarr points stops with the notice "Parquet metadata enrichment failed".
- **Code:**
  - `loadDatasetRoiTranscripts` (`src/data/roiTranscripts.ts:22-53`) calls `readXeniumTranscriptsInBbox` or `readXeniumTranscriptsForSelection` (`src/datasets/xeniumDatasetReaders.ts:476-540`), whose SQL filters by position and `qv` only.
  - Each row goes through `parseTranscriptExportRow` (`src/datasets/xeniumDatasetRows.ts:124-149`). It keeps `null` but passes any string to `asCellId` (`src/data/cellid.ts:41-46`), which throws on anything not matching `/^[a-p]{8}-\d+$/`.
  - `parseTranscriptPointRow` (`xeniumDatasetRows.ts:264-300`) does the same.
- **Reproduction:** `evidence/repro/platforms/xenium-duckdb.repro.ts`. Two of its 6 cases fail: "ROI transcript export returns both transcripts, the unassigned one with no cell" and "exact transcripts from transcripts.parquet mark the unassigned one as unassigned". The demo's first row group holds 2,330 `UNASSIGNED` rows out of 262,144; 1,808 of them are gene calls with QV ≥ 20 (`evidence/platforms/xenium-demo-transcripts-unassigned.log`).
- **Impact:** at about 0.7% of rows, almost any ROI with more than a few hundred transcripts contains one. The export therefore fails on the registered demo and on all current Xenium output. There is no in-app workaround.
- **Existing reference:** not in `open-items.md`. Unit fixtures use `null` for unassigned rows. The live Xenium ROI test checks that `Export Transcripts` is enabled (`tests/e2e/app.spec.ts:1950-1952`) but clicks only `Export Cells`.
- **Smallest correction:** map `UNASSIGNED` to `null` in both row parsers, counting any other non-ID string, or use `NULLIF(cell_id, 'UNASSIGNED')` in the SQL.
- **Acceptance:** a fixture with an `UNASSIGNED` row exports both rows, the unassigned one with an empty `cell_id`. Both repro cases pass. The live ROI test clicks `Export Transcripts` and finds rows in the CSV.
- **Remaining uncertainty:** the export was not clicked on the live demo (no `@live` run). Other sentinel strings in other Xenium versions were not surveyed.

### EXP-002 A cancelled or failed view change leaves the hidden view in charge

- **Severity:** P1. **Confidence:** confirmed by execution for the state mismatch (4 failing cases with the production `App` and lifecycle, only dataset I/O faked). Static proof that later reads use the hidden view. Wrong values on screen were not shown with a real reader. **Status:** new. **Category:** correctness.
- **Affected and trigger:** a Visium library switch, or a change of SpatialData table, coordinate system or image. Each reloads the same URL. The defect appears when the user presses Cancel during that reload or the reload fails.
- **Expected:** "a cancelled dataset load keeps the dataset already open" (`docs/user-guide.md:118-121`). The view on screen, its controls, its link and its reads stay consistent.
- **Actual:**
  - The library or coordinate-system control shows the new value and stays disabled, so the user cannot choose again without reloading the page.
  - The share link names the hidden view (`sdCs=pixels`).
  - Later reads go to the hidden view. SpatialData annotations are read from `pixels`. The shared Visium instance answers for library B while library A is on screen, so an ROI drawn on library A returns library B's spots: `cells` reads through the switched view (`src/datasets/h5adDataset.ts:1066-1072`, `1458-1466`).
- **Code:** before the reload commits, three changes are made:
  - `handleVisiumViewChange` writes the share state (`src/features/app-shell/useVisiumControlsWorkflow.ts:150-176`).
  - `handleSpatialDataSelectionChange` registers the selection that keys the dataset cache (`src/App.tsx:3670-3676`, `src/datasets/datasetFactory.ts:1717-1724`).
  - `setVisiumView` switches the cached instance in place (`h5adDataset.ts:750-762`).

  `cancelDatasetLoad` (`src/features/app-shell/useDatasetLifecycle.ts:2312-2323`) and the failure path undo none of them.

- **Root cause (MNT-01):** load and view-change state has no single commit point. `App.tsx` (5,339 lines, 73 `useRef`s, 92 commits in 30 days), the Visium workflow, the factory's selection registry and the dataset instance each hold part of the pending view. The lifecycle cannot undo what it does not own.
- **Reproduction:** `evidence/repro/lifecycle/visium-library-cancel.repro.ts` (2 fail) and `evidence/repro/lifecycle/spatialdata-view-cancel.repro.ts` (2 fail, cancel and failure).
- **Impact:** ROI statistics, annotations, Plots and gene reads for the section on screen can come from another library or coordinate system. The visible clue is a disabled control showing the other value. Opening a different URL and cancelling works (`src/App.test.tsx:2869`).
- **Existing reference:** plan 15.1-F (cancel keeps the open dataset). The open item "Cancelling a load does not stop the old dataset's reads" is a different defect.
- **Smallest correction:** restore the three changes in `cancelDatasetLoad` and on failure (T02). Separately, make one pending-load record, owned by `useDatasetLifecycle`, that applies on commit (T39), and give Visium libraries their own instances, as SpatialData selections already have.
- **Acceptance:** the 4 repro cases pass. An `App` test cancels and fails both a library switch and a coordinate-system switch, then asserts that the control is enabled on the value shown, the hash is unchanged, and reads use the shown view.
- **Remaining uncertainty:** other same-URL reloads (for example OME-Zarr Z planes) were not surveyed for the same pattern.

### EXP-003 Tile decode worker pools are never ended; each contrast value starts one

- **Severity:** P1. **Confidence:** confirmed by execution (unit repro and production build in Chromium) and static proof. **Status:** new. **Category:** reliability.
- **Affected and trigger:** every TIFF-family image (OME-TIFF, QPTIFF, SVS, NDPI, Xenium and Atera morphology). Each new contrast value of a channel triggers a new pool, including each keystroke typed into a contrast field.
- **Expected:** a bounded set of decode workers. Workers are released when their tiles are dropped or the dataset closes.
- **Actual:**
  - `TileCache` calls `createWorkerTileDecoder()` (`src/tiff/tileCache.ts:103`), which makes a new `TileDecodeWorkerPool` of up to 4 workers (`src/workers/tileDecodePool.ts:303-307`) and keeps only a closure over it.
  - Nothing can reach `terminate()` (`:166`).
  - `MorphologyTileStore` makes one `TileCache` per channel spec key, which includes contrast, and drops caches without ending their pools (`src/rendering/morphologyTileStore.ts:64-96`).
  - `tileCacheMaxTiles` bounds tiles, not pools.
- **Measured** (production build, 2-channel OME-TIFF, `evidence/ui-stage6/io02-workers.swiftshader.log`, `io02-stress.swiftshader.log`):
  - 10 workers at load.
  - Each committed edit adds 5 (160 after 30 edits); each typed five-digit value adds 20 (260 after five values).
  - 1,140 live workers after 60 typed edits. None ends on a dataset switch.
  - Renderer RSS rose from 317 MiB to 902 MiB over 30 edits, and ranged from 740 to 1,466 MiB in the stress run.
  - Frames at the check points took 14 to 195 ms. No crash occurred within 53 s.
  - Unit repro: `evidence/repro/imaging/tilePoolLifetime.repro.ts` records 28 workers created and 0 ended.
- **Severity rationale:** the growth follows an ordinary control, has no bound, survives dataset switches, and reaches hundreds of threads and about 1 GB within a minute of use. That makes it a severe, reproducible resource failure, although no crash was reached.
- **Existing reference:** not in `open-items.md`, whose "never released" list covers per-URL caches. `sharedStripDecodePool` and the contrast pool (`morphologyContrast.ts:284`) are already owned correctly.
- **Smallest correction:** one shared tile decode pool, as strips already have. Alternatively, a pool owned by `TileCache` and ended when the store drops the cache or disposes.
- **Acceptance:** the repro shows at most one pool's workers alive after edits and a switch. A smoke test counts `Worker` constructions and terminations over ten contrast edits on the OME-TIFF fixture and finds at most 8 live tile workers.
- **Remaining uncertainty:** the point at which a tab crashes was not measured.

## P2 findings

### EXP-004 AnnData reads drop negative values except for a single gene

- **Severity:** P2. **Confidence:** confirmed by execution (CSR and dense fixtures) and static proof. **Status:** new. **Category:** correctness.
- **Affected and trigger:** H5AD, AnnData Zarr, reference and Icechunk stores, and SpatialData tables, when `/X` holds negative values (scaled or centred data). Atera and MERSCOPE matrices are counts and are not affected in practice. The Magic Lens is unavailable on the affected platforms (`platformAdapter.ts:236-239, 267-270, 298-301, 330-333`).
- **Expected:**
  - "Mean per cell" is the sum over the sampled cells divided by their number (`docs/ui-reference.md:645-647`).
  - Matrices with negative values are acknowledged (`ui-reference.md:762`).
  - Plots, which keep negative values, should agree with the ROI panel.
- **Actual:** `cellFromCountsByColumn` (`src/datasets/h5adDataset.ts:4369-4389`) skips every value `<= 0` unless `includeZeroCounts` is set. `h5adMatrixForCells` sets that only when exactly one gene is requested (`:3861`). Consequences:
  - Two or more genes combined with Sum, Mean or Z-score add only positive values (`geneExpression`, `:834-836`).
  - ROI gene statistics, which read all genes, give wrong "Mean per cell", total and "% of total".
- **Reproduction:** `evidence/repro/AD/values.repro.ts` records the defect: two cells storing −1 and 3 give a mean per cell of 1.5 (expected 1) and a sum of 3 (expected 2).
- **Impact:** silent wrong numbers in ROI statistics and multi-gene colouring on scaled AnnData. Single-gene colouring and Plots are right, so the panels disagree on the same cells.
- **Smallest correction:** keep non-zero values (`!== 0`) in `cellFromCountsByColumn`. Detection in `roiGeneStats.ts` stays `> 0`.
- **Acceptance:** `roiGeneStats` and `h5adMatrixForCells` tests with a negative value and two or more genes give sum 2 and mean 1 for the repro's cells. The ROI panel and Plots agree.
- **Remaining uncertainty:** how common scaled `/X` is among users' files.

### EXP-005 "Z-score" compares a cell with a population that depends on platform and view

- **Severity:** P2. **Confidence:** execution of the scoring function, plus static proof of each reader's population. **Status:** new. **Category:** correctness.
- **Affected and trigger:** `Combine genes: Z-score` on every platform. The population changes with the platform, the zoom and the cell count.
- **Expected:** Z-score shows "how far each cell's mean is above or below the average cell" (`src/features/shell/helpText.ts:21`).
- **Actual:** `geneExpressionScores` (`src/rendering/geneExpressionRenderer.ts:307`) takes the mean and standard deviation of whatever batch it gets:
  - Xenium batches leave out every cell with count `<= 0` (`src/datasets/xeniumDatasetReaders.ts:623-625, 706-708, 831-834`) and ignore `sampleStride`.
  - H5AD and Atera batches keep zero cells, every Nth one when `sampleStride` is above 1 (`h5adDataset.ts:829-845`, `ateraDataset.ts:320-341`).
  - Visium HD keeps every Nth bin whether it expresses or not (`visiumHdDatasetReaders.ts:1330-1350`).
  - Above the all-cells limit, batches cover the view only.
- **Root cause (MNT-02):** `GeneExpressionBatch` and `GeneExpressionQueryOptions` are shared by every platform but defined in `src/datasets/xeniumDataset.ts:147-171`. The documented `sampleStride` contract is implemented three ways, and nothing states a batch's population.
- **Reproduction:** `evidence/repro/shell-shared/geneZScorePopulation.repro.ts` records the defect: a cell 0.19 SD above the population mean is −0.53 SD when non-expressing cells are left out, and 0.80 SD for one view.
- **Impact:** the same cell can change sign between platforms or as the user pans, so the colouring cannot be compared across views.
- **Smallest correction:** compute the mean and SD over the dataset's cells, zeros included (or over a fixed sample stated in the legend). Otherwise, say in the help text and legend which cells it compares against. The decision belongs to the product owner.
- **Acceptance:** a contract test runs each platform's batch reader on one small layout, and the z-score of a fixed cell is the same at two zooms and on two platforms. Alternatively, the help text names the population.
- **Remaining uncertainty:** whether Visium HD's stride drops expressing bins at any zoom where it applies was not checked.

### EXP-006 Exact transcripts from the Zarr never get their cell

- **Severity:** P2. **Confidence:** confirmed by execution on live data (the first attempt's run on 2026-11-19, with the arithmetic rechecked) and static proof of the join. **Status:** new. **Category:** correctness.
- **Affected and trigger:** Xenium datasets with `transcripts.zarr.zip`, which is all XOA output. Zoomed in far enough for exact points.
- **Expected:** `transcripts.parquet` provides "cell IDs for Zarr points" (`docs/modalities/xenium.md:50`).
- **Actual:**
  - `mergeTranscriptPointMetadata` (`src/data/transcriptOverlay.ts:373-409`) joins on `fovName + transcriptId` (`transcriptPointMetadataKey`, `:643`).
  - The Zarr reader takes `transcriptId` from the uint32 `id[row, 0]` (`src/data/transcriptZarr.ts:262`), while Parquet's `transcript_id` is a uint64. For the demo point at (220.70, 1464.42), Parquet holds 281668250306971 = 65581 × 2^32 + 67995, and the Zarr gives 67995.
  - The keys never match, so no point gets its cell ID, nucleus overlap or distance, and the Transcript card shows no cell.
- **Evidence:** `evidence/platforms/xenium-zarr-ids-live.log` (the live repro `evidence/repro/platforms/xenium-zarr-ids-live.repro.ts` was not rerun). Tests use the same small ID on both sides (`transcriptOverlay.test.ts:176-210`).
- **Impact:** a documented attribute is missing from every exact transcript on current Xenium data.
- **Smallest correction:** compare on the low 32 bits of the Parquet ID, or rebuild the Zarr ID with its high word, after checking the layout on a second XOA version.
- **Acceptance:** a fixture with a 64-bit Parquet ID and the matching Zarr `id` pair merges and shows the cell. A fixture from a second XOA version agrees.
- **Remaining uncertainty:** whether the Zarr's second `id` column holds the high word was not confirmed in XOA documentation.

### EXP-007 Zoomed-out transcript density shows sampled counts as "Count"

- **Severity:** P2. **Confidence:** static proof, plus the first attempt's live totals per level. **Status:** new. **Category:** correctness.
- **Affected and trigger:** Xenium transcript density (all features) at any zoom that uses a grid level above 0.
- **Expected:** a square's "Count" is the number of transcripts in it.
- **Actual:**
  - Squares come from the grid level that fits the view (`chooseTranscriptGridLevel`, `src/data/transcriptZarr.ts:462-490`), with that level's `grid_number_objects` (`readGridLevels`, `:1342-1365`).
  - The code notes that coarser levels hold a sample, "level 1 holds 76% and level 7 1%" (`:544-546`).
  - The hover and the Transcript card print the number as "Count" (`src/components/viewerHoverTooltips.tsx:300-303`, `src/features/transcripts/TranscriptStatusPanel.tsx:250-253`).
  - Demo totals: 554,699,029 at level 0, 423,752,521 at level 1 and 5,292,443 at level 7.
- **Impact:** numbers are low by up to 100× when zoomed out. Colours are normalised per square size, so the picture itself is right.
- **Smallest correction:** scale counts by the level's ratio to level 0, or label them as sampled.
- **Acceptance:** at level 7 on a fixture, the hover either shows level-0-scaled counts or says "sampled"; a unit test covers both levels.
- **Remaining uncertainty:** not seen in a browser this review; the totals come from the first attempt's live read.

### EXP-008 SpatialData tables with 64-bit instance IDs above 2^53 do not load

- **Severity:** P2. **Confidence:** confirmed by execution (the real shapes reader on a pyarrow-written file) and static proof. **Status:** new. **Category:** correctness.
- **Affected and trigger:** SpatialData stores whose instance key holds integers above 2^53. spatialdata-io keeps MERSCOPE `EntityID`s (19 digits) as the instance key, so its MERSCOPE stores are affected.
- **Expected:** table rows join to their shapes.
- **Actual:**
  - `readObsColumnValues` turns a `BigInt64Array` into numbers (`numericArrayToNumbers`, `src/datasets/h5adDataset.ts:3498-3530`, line 3521), so the IDs round.
  - The shapes side keeps exact `bigint` text (`instanceIdString`, `src/datasets/spatialDataShapes.ts:396-408`).
  - The join (`spatialDataDataset.ts:773-782`) matches nothing, and the load fails with "rows did not match any … instances" (`:869`).
- **Reproduction:** `evidence/repro/AD/spatialdata-int64.repro.ts` records the defect: three distinct IDs round to one. The control case with small IDs places every row.
- **Impact:** a supported platform cannot open these stores. Workaround: open the native MERSCOPE output.
- **Smallest correction:** read integer instance keys as `bigint` text, as the shapes side does.
- **Acceptance:** the repro's large-ID store places every row, and a unit test joins three IDs above 2^53.

### EXP-009 Visium HD Auto gene scale keeps the 16 µm top after zooming into 2 µm or 8 µm bins

- **Severity:** P2. **Confidence:** static proof, with the production LOD and scale functions executed. Not seen in a browser. **Status:** new; a first-attempt lead closed here. **Category:** correctness (display).
- **Affected and trigger:** Visium HD with 2 µm selected (16 µm data below zoom 3) or 8 µm selected (16 µm data at zoom −1.25 or below), on the `Auto` gene scale, after any zoomed-out view, which is the usual starting view.
- **Expected:** a colour scale on the bins drawn. A 16 µm bin sums up to 64 2 µm bins, so its counts are on another scale.
- **Actual:**
  - `planGeneExpressionLod` requests 16 µm bins when zoomed out (`src/data/geneExpressionLod.ts:276-290`).
  - The remembered Auto top is keyed by dataset URL, `Combine genes` mode and genes only (`geneExpressionScaleKeyFor`, `src/features/genes/geneControlsModel.ts:257-263`).
  - `rememberGeneExpressionScaleMax` keeps the larger top (`src/App.tsx:1968-1997`), and the Auto top is the larger of the stored and current tops (`src/features/app-shell/useViewerLayerData.ts:236-245`).
  - After zooming in, 2 µm bins are therefore coloured against the 16 µm top. The documented "keeps the highest percentile seen … so it does not shrink as the view moves" (`docs/ui-reference.md:384`) does not separate bin tiers.
- **Reproduction:** `evidence/repro/shell-shared/visiumHdScaleKeyAcrossLod.repro.ts` records the defect (`evidence/stage8/visiumHdScaleKey.log`). On synthetic counts, the 16 µm top is 48 and the 2 µm top is 3. With colours following the square root of each score's share, a 2 µm bin at its own top draws a quarter of the way up the gradient.
- **Impact:** the zoomed-in 2 µm or 8 µm view looks faint, and the legend's top is a 16 µm number. Workaround: type a maximum, or change the gene and come back while zoomed in.
- **Smallest correction:** include the bin size read in the scale key (or keep one remembered top per tier).
- **Acceptance:** after a zoomed-out and then a zoomed-in batch, the Auto top equals the 2 µm batch's top; a unit test covers the key across tiers.
- **Remaining uncertainty:** the real ratio on Visium HD data was not measured.

### EXP-010 A short range body is cached and served to every later load

- **Severity:** P2. **Confidence:** confirmed by execution against stub hosts; static proof that nothing checks the length. The browser trigger was not reproduced. **Status:** new. **Category:** reliability.
- **Affected and trigger:** TIFF tiles and Parquet footers read through the persistent byte-range cache, when a host or Chromium's HTTP cache returns a 206 body shorter than requested.
- **Expected:** a short body is refused and not stored, as the zip reader does (`cachedZipStore.ts`).
- **Actual:**
  - `fetchByteRangeWithCache` (`src/data/persistentByteRangeCache.ts:116-133`) stores whatever `fetchRange` returns.
  - TIFF tiles check only the status (`src/tiff/loader.ts:2499-2526`). Parquet footers (`cacheFooterByteRanges`, `:136-178`, over hyparquet) also check only the status.
  - The recorded trigger is that Chromium's HTTP cache "can get a truncated body" when two Range requests for the same bytes run at once (`src/zarr/zarrStores.ts:54-58`), which is why Zarr and TIFF ranges use `cache: 'no-store'`.
  - The warm-up (`src/data/datasetWarmup.ts:125-143`) and the overview reader (`src/data/hyparquetCells.ts:189-210`) fetch the same footer bytes without `no-store`.
- **Reproduction:** `evidence/repro/io/byteRangeCacheShortBody.repro.ts` records the defect in 3 cases. A host that returns half of each range poisons the footer. The next load, from a fixed host, fails with "parquet file invalid" without contacting the host. A TIFF tile keeps 40 bytes for a 100-byte range. The zip control case caches nothing.
- **Impact:** the dataset fails on every reload of that file version until the user clears site data.
- **Smallest correction:** check `bytes.byteLength === end - start` in `fetchByteRangeWithCache` before storing and returning; use `no-store` for footer ranges.
- **Acceptance:** the repro's short body is refused and not stored, and a later load from a good host succeeds.
- **Remaining uncertainty:** how often Chromium produces a truncated body for these overlapping requests. The first attempt's browser check (`evidence/repro/io/chromiumSameRange.repro.mjs`) never completed.

### EXP-011 Every dataset or section switch keeps the previous deck.gl instance and WebGL context

- **Severity:** P2. **Confidence:** confirmed by execution (heap snapshots, instance counts, heap after garbage collection) and static proof of the retaining path. **Status:** new. **Category:** performance.
- **Affected and trigger:** every dataset switch through the Open dataset form and every collection section switch.
- **Expected:** switching replaces the dataset. Nothing in `docs/` says earlier views stay in memory.
- **Actual:**
  - `ViewerCore` unmounts the Deck while a dataset loads (`src/components/ViewerCore.tsx:2193-2195`).
  - `@deck.gl/react` calls `Deck.finalize()`, which does not destroy its WebGL device. luma.gl's `CanvasContext.destroy()` is never called, so a `matchMedia` listener keeps the device alive.
  - The retaining path runs from the `MediaQueryList` listener through `CanvasObserver`, `WebGLCanvasContext`, `WebGLDevice` and `Deck.props` to `layers` and their data (`evidence/ui-stage6/heap-retainers.log`).
- **Measured:**
  - **Instance counts:** `Deck`, `WebGLDevice` and `LayerManager` went from 10 to 28 between snapshots after 9 and 27 switches, one per switch. Dataset instances stayed bounded at 2 (`heap-count.log`).
  - **Section switches:** the main-thread heap after garbage collection grew from 12 to 47 MiB over 30 switches between 2,500-cell sections. GPU process RSS grew from 189 to 928 MiB under SwiftShader.
  - **Dataset switches:** each visit to a 200,000-cell H5AD left about 50 MiB (92.8 → 142.6 → 192.0 MiB). Each visit to a 20,000-cell file left 5.3 to 5.9 MiB.
  - No crash or lost context occurred in the bounded runs.
- **Impact:** a session that flips through a large collection keeps every section it has shown. The SPCOX and GBM-space collections have 18 and 97 sections.
- **Severity rationale:** P2 because no failure was reached. It becomes P1 if a crash or lost context is shown at realistic sizes.
- **Smallest correction:** keep one Deck mounted across switches, rendering empty layers while loading. Alternatively, destroy the canvas context and lose the WebGL context when the canvas unmounts.
- **Acceptance:** a smoke test wraps `getContext` and counts live WebGL contexts over ten collection switches: at most 2. The retained heap after garbage collection does not grow with the number of switches.
- **Remaining uncertainty:** behaviour on a real GPU at 1M+ cells was not measured.

## P3 findings

Each P3 finding gives the same fields in short form. Full details are in the notes named in the index.

### EXP-012 One non-finite stored value breaks z-score colouring and Plots summaries

- Confidence: exec (`evidence/repro/AD/values.repro.ts`, `evidence/repro/analysis/plotOracle.repro.ts`). Status: new. Category: correctness.
- Trigger: one NaN or infinite value in a dense `/X` column. Expected: non-finite values kept apart from numbers (plan R3); no page says what NaN does.
- Actual: the batch mean becomes NaN, so no cell gets a z-score (`geneExpressionScores`, `src/rendering/geneExpressionRenderer.ts:307`). In Plots, the gene's mean and maximum become NaN and the value axis ends at NaN; the median ignores it.
- Impact: a whole gene's colouring or summary is lost silently. Correction: skip non-finite values in z-scores and Plots summaries and report how many were skipped.
- Acceptance: a fixture with one NaN gives finite z-scores for the other cells and a finite Plots mean, with a skipped count. Uncertainty: none material.

### EXP-013 Generated suffixes for repeated names can collide with existing names

- Confidence: exec (`evidence/repro/AD/values.repro.ts`, `evidence/repro/AD/axes.repro.ts:200-264`). Status: new. Category: correctness.
- Trigger: repeated obs or var names alongside an existing name ending in `-2` (for example `c0, c0, c0-2`). Docs: "duplicates get `-2`, `-3`, … suffixes" (`docs/modalities/h5ad.md:172,181`).
- Actual: `uniqueNames` (`src/datasets/h5adDataset.ts:4586-4600`) renames the second `c0` to `c0-2` without checking, so two rows share `c0-2` and maps keyed by ID return one row's values for the other. With genes, the map reads the last such column and Plots the first, and the result differs by backend (CSR, dense, in-memory CSC, dense Zarr).
- Correction: skip suffixes already taken. Acceptance: `c0, c0, c0-2` gives three distinct names, and every backend returns the same profile. Uncertainty: how often real files trigger it.

### EXP-014 AnnData ROIs are complete but labelled as cut short at 50,000 cells

- Confidence: exec (`evidence/repro/analysis/roiLimit.repro.ts`). Status: new. Category: correctness.
- Trigger: an ROI with 50,000 or more cells on H5AD, Visium, SpatialData, Atera or MERSCOPE.
- Expected: `Export Cells` writes up to 50,000 cells (`docs/ui-reference.md:658`), and the "first cells only" note appears only when cells were dropped.
- Actual: `loadActiveRoiCells` (`src/App.tsx:2204-2222`) passes no limit, so every cell comes back. Even so, `useRoiWorkflow.ts:476,481` and `useSelectionCells.ts:81` show "50,000+" with the note, and the export records `hit_cell_limit: true` (`useRoiWorkflow.ts:799`).
- Correction: pass the limit on the AnnData path, or set the flag from what the reader reports, and align the docs. Acceptance: a 60,000-cell ROI is labelled by what was returned, and the export flag matches.
- Uncertainty: a latent second issue, where a limited lasso returns short (hypotheses section).

### EXP-015 The TIFF reader mis-reads four uncommon layouts without saying so

- Confidence: exec on synthetic files (`evidence/repro/imaging/tiffFormats.repro.ts`, `evidence/imaging/tiffFormats.out.txt`, `evidence/imaging/cellImageMeasureOracle.out.txt`). Status: new. Category: correctness.
- (a) Every SubIFD level takes level 0's tile size (`src/tiff/loader.ts:412-438`), so 1,520 of 1,536 pixels differ on a level tiled differently.
- (b) `PhysicalSizeY` is not read, so 0.5 × 1.0 µm pixels draw half height, and per-cell measurement disagrees with the oracle for 64 of 67 cells.
- (c) Signed 16-bit samples are read as unsigned (−500 becomes 65036). `docs/modalities/image.md:172` says 8- or 16-bit, without the signed case.
- (d) A tile with no `Compression` tag goes to the JPEG 2000 decoder (`src/codecs/tiffTile.ts:60-65`) and the open fails. The TIFF default is 1, no compression.
- Impact: (a) and (b) give a wrong image with no error. The writers named in the docs do not produce these layouts. Correction: per-level tile size; read `PhysicalSizeY` or refuse unequal sizes; handle or refuse signed samples; default a missing tag to 1.
- Acceptance: the repro's four cases decode correctly or are refused with a message. Uncertainty: real files with these layouts were not found.

### EXP-016 Anisotropic MERSCOPE `.vzg` transforms are averaged

- Confidence: exec (`evidence/repro/platforms/merscope-vzg-placement.repro.ts`, fails). Status: new. Category: correctness.
- Actual: `parseMerscopeTransform` (`src/datasets/merscopeFormat.ts:149-174`) refuses shear but returns one `micronsPerPixel = 2 / (scaleX + scaleY)`. With scales 2 and 4, x ends at 1066.7 instead of 1100 and y at 3053.3 instead of 3040.
- Impact: misplaced image if such files exist; public Vizgen transforms seen were isotropic. Correction: refuse unequal scales with a message, or carry the scale per axis.
- Acceptance: the repro case passes, or a clear refusal is shown. Uncertainty: real-world occurrence.

### EXP-017 MERSCOPE CSVs with quoted commas are refused

- Confidence: exec (`evidence/repro/platforms/merscope-csv-join.repro.ts`, 2 of 7 fail). Status: new. Category: correctness.
- Actual: the CSV reader splits on every comma and strips quotes only from whole fields (`splitHeader`, `src/datasets/merscopeFormat.ts:734-739`; `forEachRow`). A value such as `"T cell, CD4+"` stops the load with "row 1 has 5 fields; the header has 4.", and a doubled quote stays doubled.
- Impact: annotation columns written by pandas stop the load; Vizgen's own numeric columns are unaffected. Correction: RFC 4180 field parsing, or say in `merscope.md` which CSVs are accepted.
- Acceptance: both repro cases pass. Uncertainty: none.

### EXP-018 A gzipped MERSCOPE CSV is inflated whole before its size is checked

- Confidence: exec (`evidence/repro/platforms/merscope-size-limit.repro.ts`, 1 of 2 fails). Status: new. Category: reliability.
- Actual: `src/datasets/merscopeTableReader.ts:79-98` checks the compressed size, then decodes the whole text and checks its length. Files between 300 MiB and about 512 MiB inflated are fully decoded before they are refused. Above that, the user sees "Cannot create a string longer than 0x1fffffe8 characters" instead of the documented message (`docs/modalities/merscope.md:65-66`).
- Correction: count inflated bytes while streaming and stop at the limit. Acceptance: the 520 MiB case gives the documented message. Uncertainty: none.

### EXP-019 A gzipped `.h5` named in a Visium manifest fails

- Confidence: exec (`evidence/repro/platforms/visium-h5-gzip.repro.ts`, 1 of 2 fails). Status: new. Category: correctness, or documentation if the docs change instead.
- Expected: every standard Visium file "is read whole … and gzipped copies (`.gz`) work" (`docs/dataset-manifest.md:176-177`, `docs/modalities/visium.md:62-64`).
- Actual: `filtered_feature_bc_matrix.h5.gz` fails with "The file is not a readable HDF5 file." The `.mtx.gz`, `.csv.gz`, `.json.gz` and image `.gz` files work.
- Correction: gunzip the `.h5` before opening it, since it is read whole anyway, or name the exception in both pages. Acceptance: the repro case passes, or both pages name the exception. Uncertainty: none.

### EXP-020 A tile decode worker that fails to load leaves later tiles pending forever

- Confidence: exec (`evidence/repro/quality/tilePoolWorkerLoadFailure.repro.ts`, `evidence/quality-stage7/tilePoolWorkerLoadFailure.log`). Status: new. Category: reliability.
- Trigger: a worker script that fails to load, for example after a redeploy (EXP-021), a `worker-src` policy on a self-hosted deployment, or a dropped connection.
- Actual: `TileDecodeWorkerPool` rejects the requests pending at the `error` event but keeps the dead worker (`src/workers/tileDecodePool.ts:274-276`). Later requests posted to it never settle: the repro shows the first request rejected and the next two still pending. The Zarr pool drops its workers on the same event (`zarrDecodePool.ts:328-332`), and the six one-shot readers fall back to the main thread. TIFF tiles have no fallback (`tileCache.ts:103`).
- Impact: image tiles stay blank with no error. Correction: reset the pool on `error`, as the Zarr pool does, and decode on the main thread after a failed start.
- Acceptance: in the repro, later requests reject or decode. Uncertainty: not reproduced in a browser.

### EXP-021 A lazy chunk missing after a redeploy is reported as a dataset network error

- Confidence: exec of the classifier (`evidence/repro/quality/staleChunkError.repro.ts`, records 3 of 3). Static proof for the rest. Status: new. Category: reliability.
- Trigger: a tab opened before a Pages deploy (9 deploys on 2026-11-19) opens a dataset type whose reader chunk it has not loaded yet. The app has 76 dynamic imports.
- Actual: the Chromium, Firefox and Safari messages for a failed dynamic import are all classified as `network`: "Check dataset URL, CORS, and network access" (`createStructuredLoadError`, `src/features/errors/loadErrorModel.ts:81`). There is no `vite:preloadError` handler.
- Impact: the user is told to check their hosting when a reload would fix it. Correction: recognise chunk-load failures and say "The app was updated; reload the page".
- Acceptance: the repro's three messages map to the new code. Uncertainty: not reproduced in a browser.

### EXP-022 The tonsil gallery example's host refuses connections; the live suite fails on `main`

- Confidence: exec (GitHub run logs; one 15 KB request to each host). Status: new. Category: reliability.
- Actual: `E2E full (live data)` failed on 2026-11-19 (run 44511097930) and 2026-11-20 (run 44722739362), only on `loads the idr/idr0054-tonsil example @live` (`tests/e2e/examples.spec.ts:37`), timing out at 180 s.
  - The example reads `https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0054A/5025551.zarr` (`examples/idr/idr0054-tonsil.json:15`), which refused connections from the runners and from this Mac.
  - `https://livingobjects.ebi.ac.uk/idr/zarr/v0.4/idr0054A/5025551.zarr/.zattrs` answers 200.
  - PR #181 moved the idr0062 example to that mirror for the same reason.
- Impact: users whose network cannot reach Embassy S3 see a failed gallery card. The failure surfaces only through GitHub's notification for a failed scheduled run.
- Correction: point the example at the mirror and regenerate `examples/index.json`; optionally open an issue when the live suite fails twice in a row.
- Acceptance: the live example test passes on the next scheduled run. Uncertainty: whether Embassy S3 refuses every client.

### EXP-023 Release builds show no version; their gallery and Help follow `main`

- Confidence: static. Status: new. Category: reliability.
- Actual: `release.yml:46` builds without `VITE_COMMIT_SHA`, so Help shows no commit (`src/features/shell/docLinks.ts:31-35`) and `index.html` has no `build-commit` meta (`vite.config.ts:42-51`). The tag is only in `version.json`, which the app does not read. Release builds read the example index from `main` (`src/features/start/examplesIndex.ts:7-8`) and link Help to `main` (`docLinks.ts:3`). `docs/deploy-to-s3.md:92-97` says this only under "Build Locally".
- Impact: an older self-hosted release can list examples it cannot open and links to docs for features it lacks.
- Correction: set `VITE_COMMIT_SHA` and the tag in `release.yml`. Either pin the release's gallery and doc links to the tag, or document that they follow `main`.
- Acceptance: a release zip's Help shows its tag and commit, and the release docs state where the gallery comes from. Uncertainty: none.

### EXP-024 Detection probes run twice on a cold folder load

- Confidence: exec (`evidence/ui-stage6/detection-requests.log`). Status: new. Category: performance.
- Actual: `startDatasetLoad` and `createSpatialDataset` (`src/datasets/datasetFactory.ts:1540`) both call `detectSpatialDataset`, which has no memo. A Space Ranger folder sends 42 requests, 27 of them distinct: the listing, `explorer.json` and 13 HEAD probes each go out twice. A MERSCOPE folder sends 33 requests, 18 distinct.
- Impact: one extra round of probes per load, which matters on high-latency hosts. Correction: pass the detected layout to the factory, or memoise detection per URL for the load.
- Acceptance: each probe URL is requested once per cold load. Uncertainty: none.

### EXP-025 The release job exposes a write token to every step

- Confidence: static; no exposure demonstrated. Status: new. Category: security (hardening).
- Actual: `release.yml` grants `contents: write` (`:17-18`) and sets `GH_TOKEN` for the whole job (`:30-32`), so `npm ci`, the tests and Playwright all run with it. `actions/checkout` also persists the token. Only the two `gh` steps need it. Install scripts today come from `patch-package` and `fsevents` only.
- Impact: a compromised dev dependency running during tests could write to the repository. Correction: set `GH_TOKEN` only on the `gh` steps with `persist-credentials: false`, or split the job into a read-only build and a small upload job.
- Acceptance: no step other than the upload steps has the token or write permission. Uncertainty: none.

### EXP-026 Signed URLs are kept in the recent list and share links

- Confidence: static. Status: new. Category: security.
- Actual: presigned and token-bearing URLs are accepted with their query string (`docs/h5ad-reference.md:459-461`). The access-denied message suggests "a public or presigned address" (`src/features/errors/loadErrorModel.ts:705`). The full URL goes into `localStorage` (`src/features/start/recentDatasets.ts`, 8 entries, no expiry) and into the share link's `dataset=`.
- Impact: the token is the user's own, and sharing it is how presigned links work, but nothing tells the user the recent list keeps it. Correction: drop query strings from the recent list (or mark such entries), and say in the docs that share links carry the token.
- Acceptance: a presigned URL's query is absent from `localStorage`, and the docs say what share links contain. Uncertainty: none.

### EXP-027 Image channel histograms carry `aria-label` on an element with no role

- Confidence: exec (axe `aria-prohibited-attr`, serious, at 1440, 1024 and 390 px; `evidence/ui-stage6/a11y-widths.log`). Status: new. Category: accessibility.
- Actual: `div[aria-label="… histogram"]` on OME-TIFF and `.vzg` channels (`src/features/morphology/MorphologyChannelControls.tsx:200-202`). The axe smoke test scans only the H5AD fixture, which has no channels (`tests/e2e/app.spec.ts:486-582`).
- Correction: `role="img"` with the label, or `aria-hidden`. Acceptance: axe on the OME-TIFF channel state reports no violation. Uncertainty: none.

### EXP-028 Collection bar buttons are 22 px targets

- Confidence: exec (axe `target-size`, WCAG 2.2 AA 2.5.8, at 1440 and 1024 px; `evidence/ui-stage6/a11y-widths-collection.log`). Status: new. Category: accessibility.
- Actual: `Previews`, `Stack in 3D` and `Show Sn beside` are 22 px (`.collection-bar-action`, `src/styles/collection.css:44-49`; `src/features/collection/CollectionBar.tsx:230, 245, 415`). No smoke test opens a collection.
- Correction: 24 px minimum or spacing that meets 2.5.8. Acceptance: axe on an open collection reports no `target-size`. Uncertainty: none.

### EXP-029 At about 1024 px, Plots and Cell Query open under the Dataset info drawer

- Confidence: exec (`evidence/ui-stage6/drawer-window-overlap.log`, `out/w1024-drawer-Query.png`, `smoke-1024.log`). Status: new. Category: accessibility.
- Actual: at 1024 × 768 with Dataset info open, Cell Query opens at x = 132 and Plots at x = 172, under the 380 px drawer, which is drawn on top (`--z-drawer: 14` over `--z-panel: 12`, `src/styles/tokens.css:89-90`). Windows are placed from the canvas's right edge (`src/features/shell/floatingWindowModel.ts:11-28`). The unchanged smoke suite fails 2 of 19 at that width for this reason. No overlap occurs at 1280 or 1440 px.
- Workaround: close the drawer or drag the window. Correction: keep a new window clear of an open left drawer.
- Acceptance: the smoke suite passes at 1024 × 768 with the drawer open. Uncertainty: none.

### EXP-030 The docs disagree on Plots for Visium HD

- Confidence: exec (`evidence/repro/docs-core/plotsVisiumHd.repro.ts`, fails) and static. Status: new. Category: documentation.
- Actual: `docs/ui-reference.md:195-196, 1405` and `docs/user-guide.md:433-434` say there is no Plots panel on Visium HD. `docs/modalities/visium-hd.md:191-192` and the code show the toggle (`src/App.tsx:4593-4594`), and the panel then says Plots are not available (`src/features/plots/usePlotsWorkflow.ts:40-45`).
- Correction: a product decision. Hide the toggle, as Cell Query does, or correct the two pages. The message's "no expression matrix" is loose either way.
- Acceptance: the docs and the toggle agree, and the repro is updated to the decision. Uncertainty: none.

### EXP-031 The public schemas pass files the app refuses

- Confidence: exec (66 inert probes, `evidence/fixtures/docs-formats/probes.json`; 19 schema-valid files refused). Status: new. Category: documentation.
- Actual: `docs/dataset-manifest.md:450-458` and `docs/dataset-collections.md:488-497` say editors with `$schema` "flag errors as you type". Yet files with whitespace-only names, invalid `geneRange` values, options without their file, unknown segmentation extensions, a missing or duplicated Visium HD bin, duplicate collection entries or mixed `z` all pass the schema and stop the load.
- Correction: add the constraints JSON Schema can express (`pattern`, `dependentRequired`, `if`/`then`), and say that the viewer checks more. Acceptance: the expressible probes fail the schema, and both guides carry the note. Uncertainty: none.

### EXP-032 Stale wording about which CI checks block

- Confidence: exec (GitHub API: `main` "Branch not protected", no rulesets). Status: partly known-open (`docs/plan/engineering.md:242-247`). Category: documentation.
- Actual: no check blocks a merge. Pages deploys only after CI succeeds on a push (`.github/workflows/pages.yml:22-26`). Even so, `README.md:44-46` says "`npm test` is the required check", and `vitest.config.ts:31-32` says the thresholds are set "so a drop fails CI", while the coverage job has `continue-on-error: true` (`ci.yml:53`).
- Correction: reword both, or protect `main` and require `check` and `e2e-smoke` (an owner's decision). Acceptance: the wording matches the repository settings. Uncertainty: none.

### EXP-033 300 MB written for 300 MiB limits

- Confidence: static. Status: new. Category: documentation.
- Actual: the limits are `300 * 1024 * 1024` and `100 * 1024 * 1024` (`src/datasets/visiumFormat.ts:81`, `src/datasets/merscopeFormat.ts:30,35,40`), but `README.md:143`, `docs/dataset-manifest.md:183`, `docs/host-your-own-data.md:210,245`, `docs/modalities/visium.md:287-288` and `docs/modalities/merscope.md` say MB. The H5AD pages say MiB for the same number.
- Correction: say MiB. Acceptance: all pages use MiB for binary limits. Uncertainty: none.

### EXP-034 Reference pages lag the code in four places

- Confidence: static (code reference checks plus reading). Status: new. Category: documentation.
- Stale names: `csrZarrRowBatches` (`docs/modalities/h5ad.md:262`), `openQptiff` (`image.md:218`, now `readQptiffFile`), `probeSpatialDataRoot` (`spatialdata.md:21,152,334`, removed in `404043e`), `readVisiumPlacement` (`visium.md:48`, removed in `d6634fb`).
- Missing share keys: `aimg` and `sectionView` are read and written (`src/data/shareableState.ts:136,197,489,685`) but are missing from the `docs/ui-reference.md` "Shareable URL" table (1413-1492).
- Incomplete detection order: `docs/modalities/xenium.md:19-21` omits Atera, Zarr roots, standard Visium and MERSCOPE (`detectSpatialDatasetLayout`, `src/datasets/datasetFactory.ts:444-500`). `docs/architecture.md:92-112` has the full order.
- Zips: `docs/modalities/spatialdata.md:48-49` says only SpatialData is read from zips, but zipped OME-Zarr images open too (`datasetFactory.ts:644-653`, `image.md:24`).
- Correction: update each sentence. Acceptance: `evidence/docs-formats/check-code-refs.mjs` finds the four names, the table lists both keys, and the two statements match the code. Uncertainty: none.

### EXP-035 `open-items.md` out of step with phases 24 and 25

- Confidence: static. Status: new (plan record). Category: documentation.
- Actual: `docs/plan/open-items.md:139-144` still lists "no registered test dataset" for the 3D section stack, which phase 24 checked off on 2026-11-18. Phase 25's six unchecked known gaps (`docs/plan/phases/25-imported-segmentations.md:78-86`) are missing, although the file says it lists every unchecked item.
- Correction: update the two entries. Acceptance: every phase file's unchecked boxes appear in `open-items.md`. Uncertainty: none.

### EXP-036 Six copies of the one-shot worker wrapper and 73 local abort helpers

- Confidence: static. Status: new. Category: maintainability.
- Actual: `merscopeTableWorker.ts`, `featureBarcodeMexWorker.ts`, `vectorSegmentationWorker.ts`, `zipEntryWorker.ts`, `cellsOverviewWorker.ts` and `spatialDataShapesWorker.ts` (113 to 186 lines each) repeat the same request, abort, error, fallback and terminate logic. After renaming, the MERSCOPE and MEX copies differ by 11 lines. There are 31 `abortError`, 31 `throwIfAborted` and 11 `isAbortError` local definitions; they agree today. Pool ownership is uneven (EXP-003, EXP-020).
- Benefit: the uneven ownership is how EXP-003 and EXP-020 arose. Correction: after T03 and T21, one `runWorkerOnce` helper and one abort module, as a behaviour-preserving refactor.
- Acceptance: the existing wrapper tests pass unchanged. Uncertainty: none.

### EXP-037 A test named for the Atera feature-count check never reaches it

- Confidence: exec (`evidence/quality-stage7/ateraCscProbe.log`). Status: new. Category: tests.
- Actual: "rejects a CSC matrix whose feature count differs from the matrix" (`src/datasets/ateraDataset.test.ts:530-538`) points the CSC matrix at `cells.zarr.zip`, which holds no matrix. It passes on `NotFoundError: Not found: v2 array`, so the check it is named for (`src/datasets/ateraDataset.ts:786-790`) runs in no test. Thirteen other `rejects.toThrow()` assertions accept any error; five are abort tests.
- Correction: build a store whose `indptr` has the wrong length and assert the message; name the error in the other 13. Acceptance: the test fails if the feature-count check is removed. Uncertainty: the 13 were not checked one by one.

### EXP-038 No test guards resource lifetime, narrow layouts or image states in the axe scan

- Confidence: exec (stage 6 measurements; test inventory). Status: new. Category: tests.
- Actual: EXP-003 and EXP-011 were found only by measurement. Five unit files mock `@deck.gl/react`, and `TileCache` tests inject `decodeTile`. Playwright runs one Desktop Chrome project. The smoke helpers assume the wide layout (3 of 19 pass at 390 px). The axe test scans only the H5AD fixture, which is how EXP-027 and EXP-028 were missed. The live Xenium ROI test never clicks `Export Transcripts` (EXP-001).
- Correction: the smallest tests are attached to the fixes. These are WebGL-context and worker counters (T11, T03), image and collection states in the axe test (T28, T29), one 390 × 844 smoke test with layout-aware helpers (T38), and the Export Transcripts click (T01).
- Acceptance: each test fails on the current commit and passes after its fix. Uncertainty: none.

## Hypotheses and follow-ups (not findings)

| Lead                                                                                                                                                                                   | Why it is not a finding                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `AnnDataH5adDataset.cells` applies a limit before the lasso test, so a limited lasso can come back short (`evidence/repro/analysis/roiLimit.repro.ts`, second case)                    | The callers that pass a limit appear to pass boxes; no user path shown |
| Cell Query "Is not one of" also matches cells with no class in the set (`src/features/query/cellQuery.ts:315-321`); `docs/ui-reference.md:912-925` does not say so                     | Documentation gap; behaviour is reasonable                             |
| Visium HD's every-Nth-bin stride may drop expressing bins (`visiumHdDatasetReaders.ts:1330-1350`)                                                                                      | Not checked against the zooms where the stride applies (EXP-005)       |
| EXP-011 may crash a tab at 1M+ cells after a few switches                                                                                                                              | Extrapolated from 50 MiB per switch at 200,000 cells; not run          |
| Gzipped text other than MERSCOPE CSVs inflates without a decoded-size limit (`readMaybeGzipText.ts`)                                                                                   | Exhausts only the user's own tab; no supported file comes near         |
| `byteRangeFileVersion` falls back to file size when CORS hides validators (`persistentByteRangeCache.ts:186-200`), so a file rewritten in place with the same size serves stale ranges | Documented in the code comment                                         |
| Duplicate barcode rows in a Visium positions file resolve to the last row (`evidence/repro/platforms/visium-readers.repro.ts:374`)                                                     | Space Ranger does not write duplicates                                 |
| A gene name with a comma would split a share-link list                                                                                                                                 | No such gene seen                                                      |
| `handleDatasetSubmit` passed as a void callback (`src/App.tsx:4101`, type-aware lint)                                                                                                  | Harmless: its errors are handled inside                                |

Clean-up candidates with no finding:

- `visiumHdMaxTwoMicrometerFilteredBarcodes` is wired through the factory but set by no production caller (`src/datasets/datasetFactory.ts:181-186, 1700-1730, 2090-2094`).
- The Polars bit-packing behaviour could be reported upstream so the hyparquet patch can go. External issues are outside this review.

## Existing items reconciled

The review plan's leads:

| Lead                                                        | Status                     | Current evidence                                                                                                                                                                  |
| ----------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeout and retry coverage differs by reader                | still present (known-open) | Only the H5 worker (120 s × 3) and detection have them; reader matrix in `notes/io-stage5.md`                                                                                     |
| Cancellation suppresses stale updates without stopping work | still present (known-open) | `cachedSpatialDataset` and `createSpatialDataset` take no signal (`datasetFactory.ts:1712-1740`); not measured. New related defect: EXP-002                                       |
| Instance eviction exists; other caches may be unbounded     | partly resolved            | Dataset instances stay bounded (2 in heap snapshots). Per-URL caches still unbounded (known-open). New unbounded holders: EXP-003, EXP-011                                        |
| Optional reads treat transient failures as absent           | still present (known-open) | For example `transcriptZarr.ts:1337-1339`; `visiumHdClusters.test.ts:80` asserts the design                                                                                       |
| H5AD range reads, Plots, Cell Query, 3D stack are recent    | reviewed                   | H5AD values match numpy whole and range-read; Plots match an independent oracle; Cell Query rules match the docs; the 3D stack model matches its docs. 3D not opened in a browser |
| Historical phase sections describe pre-implementation gaps  | reconciled                 | One stale plan record (EXP-035); no historical statement reported as a current defect                                                                                             |
| Main-thread work, rendering cost, duplication               | partly resolved            | App chunks under 190 ms per load phase; the rest is software drawing (`docs/profiling.md`). Duplication: EXP-036. Xenium demo stalls not measured (no live data)                  |

`open-items.md` and `engineering.md` items:

| Item                                                                                                                          | Status                     | Evidence                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| Per-URL caches never released, H5AD tissue image blob URLs not revoked                                                        | still present (known-open) | `h5adDataset.ts:1370,1638` create blob URLs; `dispose()` does not revoke |
| Coverage job not required; `main` unprotected                                                                                 | still present (known-open) | GitHub API; EXP-032                                                      |
| E2E gaps (SpatialData, OME-Zarr, collections, narrow widths and others); live tests fail rather than skip when a host is down | still present              | Test inventory; the live suite failed on EXP-022 instead of skipping     |
| hyparquet pinned at 1.26.0 for its patch; no Dependabot; audit at critical only                                               | still present, by design   | Patch still needed and guarded by a test; `audit.yml:3-6`                |
| Toast covering an open card at 1024 px                                                                                        | not verified               | Not exercised in stage 6                                                 |
| Xenium demo main-thread stalls in the first 30 s                                                                              | not verified               | Needs live data                                                          |
| Unit coverage gaps (`gridBinLayer.ts`, `viewerPicking.ts`, others)                                                            | not verified individually  | Coverage thresholds pass                                                 |
| Manifest feature gaps and feature gaps listed as open                                                                         | consistent with the docs   | Stage 2 matrix rows; not exercised one by one                            |
| Deploy previews, golden fixture bundle, `metrics_summary.csv`                                                                 | not verified               | Record only                                                              |

Leads from the first attempt: each became a finding (EXP-001, 008, 016 to 019, 010, 030, 005, 012, 014, 021, 034, 024, 009) or was discarded with a reason (`notes/docs-stage2.md` "Discarded leads"; `cellShapeTranslation` passes).

## Validation results

| Check                                | Result                                                                                                                                                                                                                                                          | Evidence                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Baseline (12 steps)                  | All passed: format, lint, types, 344 files and 3,049 unit tests, build, 19 of 19 offline smoke tests, coverage above thresholds, both audits                                                                                                                    | `COVERAGE.md`, `evidence/baseline/`         |
| `@live` tests                        | Not run (transfer cost not agreed). GitHub's scheduled runs: 48 of 49 pass, failing on EXP-022                                                                                                                                                                  | `notes/quality-stage7.md`                   |
| Review repros, final rerun (stage 8) | 26 files, 193 tests: 181 pass, 12 fail. Every failure is a finding's expected-behaviour case (EXP-001 ×2, EXP-002 ×4, EXP-016, EXP-017 ×2, EXP-018, EXP-019, EXP-030)                                                                                           | `evidence/stage8/repro-rerun.log`           |
| Documentation claims                 | 141 rows: 111 matches, 14 code defects, 13 doc defects, 3 ambiguous, 0 not verified                                                                                                                                                                             | `DOC_CODE_MATRIX.csv`                       |
| Schemas and examples                 | 20 of 20 example and collection files valid; 66 probes, 19 schema-valid but refused (EXP-031); index current                                                                                                                                                    | `notes/docs-stage2.md`                      |
| Links                                | 612 internal links, 0 broken; 22 external not checked                                                                                                                                                                                                           | `evidence/docs-formats/`                    |
| Browser (Chromium, review build)     | Subpath and isolation headers, axe at three widths, focus return, layout, profile, memory and worker counts                                                                                                                                                     | `notes/ui-stage6.md`, `evidence/ui-stage6/` |
| Import graph, promises, E2E types    | No runtime cycles, no floating promises, E2E specs type-check                                                                                                                                                                                                   | `evidence/quality-stage7/`                  |
| Repository unchanged                 | No tracked file changed; HEAD is still `6a9a736`; only `docs/review/` added (466 files). Generated, gitignored outputs: `coverage/` (baseline), `dist/` (review builds), `test-results/` and `.claude/` (both dated before the reviewed commit was checked out) | `evidence/stage8/git-status.log`            |

## Coverage and remaining uncertainty

- **Source:** 77 of 490 source files were read: 25 in full and 52 in part. The other 413 were covered only by repository-wide checks: types, lint, unit tests, import graph and type-aware promise lint. The least-read areas are images and rendering (110 files not read), UI shell (110), HTTP/HDF5/archives (64) and platform readers (27). The full list is in `evidence/inventory/ledger.tsv`.
- **Platforms:** every platform and backend has one success and one failure case (`COVERAGE.md`). Atera, kerchunk reference and Icechunk stores rely on existing tests, with no independent oracle. DuckDB-WASM `httpfs` and the OpenJPEG module were not exercised under the serving setups.
- **Not exercised in a browser:** the 3D stack, Z planes, transcripts, canvas picking beyond the smoke suite, the narrow `Panels` menu, and every `@live` dataset.
- **Other gaps:**
  - Firefox, Safari and Node 24 were not run.
  - Fixture generators were not rerun.
  - 22 external links were not checked.
  - Eight public docs had only their links and code references checked: `PLAN.md`, `docs/README.md`, `cell-feature-matrix-compatibility.md`, `image-only-and-geojson.md`, `s3-cors-playbook.md`, `visium-hd-2um-strategy.md`, `zchunkstore.md` and `examples/README.md`.
- **Findings relying on the first attempt:** EXP-006 and EXP-007 rely on its live reads, rechecked arithmetically but not rerun.
- **Delegation:** the one worker ran at xhigh effort instead of medium. Its 86 matrix rows were spot-checked (9 rows, 6 corrected).

This is a partial review in the sense of the plan's completion criteria. The application is not claimed to be correct or fully reviewed.

## Review artifacts

| Path                                       | Contents                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `REVIEW_TASKS.md`                          | Ordered repair tasks with acceptance criteria                                     |
| `COVERAGE.md`                              | Version, delegation ledger, baseline, area ledger, scenario matrix, exclusions    |
| `DOC_CODE_MATRIX.csv`                      | 141 documentation claims with code, tests, method and result                      |
| `notes/stages.md`                          | Stage plan and outcomes                                                           |
| `notes/*-stage*.md`, `notes/load-trace.md` | Working notes per stage, with provisional IDs mapped in the index above           |
| `evidence/repro/`                          | Review repros (`*.repro.ts`), run by the config above                             |
| `evidence/`                                | Logs, fixtures, browser specs and outputs, inventory, triage of the first attempt |
