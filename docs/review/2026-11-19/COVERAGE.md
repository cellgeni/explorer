# Review coverage (2026-11-19)

Final, after stage 8 of 8, written 2026-11-20. Findings: `REVIEW_REPORT.md`; tasks: `REVIEW_TASKS.md`; stage plan and status: `notes/stages.md`. Finding IDs below are the final `EXP-` IDs; the stage notes use provisional IDs, mapped in the report's findings index.

## Reviewed version

| Item         | Value                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository   | `cellgeni/explorer`, Git worktree `.claude/worktrees/type-support-question-5174cf`, branch `claude/review-document-4602a9`                                            |
| Commit       | `6a9a736a26fc1b095ed7c1bbfbace97ab4eddf10`, origin/main on 2026-11-19 (merge of PR 197)                                                                               |
| Working tree | Clean apart from `docs/review/`; `coverage/` (gitignored) created by the coverage run                                                                                 |
| Host         | macOS 26.7.3, Apple silicon; Node 25.8.1, npm 11.11.1; Playwright 1.60.0 with Chromium build 1223. CI uses Node 24 on Ubuntu 24.04; Node 24 was not available locally |
| Review plan  | `REVIEW.md` supplied by the user, prepared 2026-11-19, updated 2026-11-20 with delegation limits                                                                      |

## Delegation ledger

Required: Sonnet, medium effort, one sub-agent at a time, at most four activations, one level deep, at most 12 turns each.

| #   | Date       | Stage                            | Requested model and effort                                                           | Observed model                                  | Observed effort                                                      | Scope                                    | Result                                                                                                    | Remaining   |
| --- | ---------- | -------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------- |
| —   | 2026-11-19 | first attempt, before the limits | none set (inherited)                                                                 | `claude-opus-5-5` in all 36 worker transcripts  | unknown                                                              | 16 coordinator launches, 20 nested       | Stopped by the user; output triaged in stage 1                                                            | not counted |
| —   | 2026-11-20 | stage 1                          | no worker                                                                            | —                                               | —                                                                    | —                                        | —                                                                                                         | 4 of 4      |
| 1   | 2026-11-20 | stage 2                          | `model: "sonnet"` explicit; medium via `CLAUDE_CODE_SUBAGENT_EFFORT`                 | `claude-sonnet-5-5` (all 42 transcript entries) | **xhigh** (transcript `effort` field; the env setting did not apply) | Claims in the 8 `docs/modalities/` pages | 86 matrix rows; 9 spot-checked, 6 corrected; 12 API turns, 30 tool calls, 287,019 tokens; no nested agent | 3 of 4      |
| —   | 2026-11-20 | stage 3                          | no worker (none planned; the user has not yet chosen how to handle the effort limit) | —                                               | —                                                                    | —                                        | —                                                                                                         | 3 of 4      |
| —   | 2026-11-20 | stage 4                          | no worker (one was planned for the image readers; effort still uncontrolled)         | —                                               | —                                                                    | —                                        | —                                                                                                         | 3 of 4      |
| —   | 2026-11-20 | stage 5                          | no worker (one was planned for failure injection; effort still uncontrolled)         | —                                               | —                                                                    | —                                        | —                                                                                                         | 3 of 4      |
| —   | 2026-11-20 | stage 6                          | no worker (the reserve was not used; effort still uncontrolled)                      | —                                               | —                                                                    | —                                        | —                                                                                                         | 3 of 4      |
| —   | 2026-11-20 | stage 7                          | no worker (effort still uncontrolled)                                                | —                                               | —                                                                    | —                                        | —                                                                                                         | 3 of 4      |
| —   | 2026-11-20 | stage 8                          | no worker (effort still uncontrolled; consolidation needs the coordinator)           | —                                               | —                                                                    | —                                        | —                                                                                                         | 3 of 4      |

Controls in place: an explicit `model: "sonnet"` on every launch; `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` and `CLAUDE_CODE_SUBAGENT_EFFORT=medium` in the session environment; Claude Code 2.1.289. Not set: `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`. The coordinator enforces those two by running one foreground worker at a time and forbidding nested launches in the prompt, then checks the transcript folder afterwards.

## Baseline (R1)

Run once by the coordinator on 2026-11-19 at `6a9a736`, each step logged separately (`evidence/baseline/`, script `baseline.sh`, summary `summary.tsv`).

| Check                | Command                                                                             | Result    | Notes                                                                                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked install       | `npm ci`                                                                            | passed    | `patch-package` applied `hyparquet@1.26.0`; 0 vulnerabilities reported                                                                                                                                                              |
| Formatting           | `npm run format:check`                                                              | passed    |                                                                                                                                                                                                                                     |
| Lint                 | `npm run lint`                                                                      | passed    | 0 warnings. Stage 7: two `eslint-disable` lines, both justified; type-aware promise rules are not enabled (run once in a review config: no floating promise)                                                                        |
| Types                | `npm run typecheck`                                                                 | passed    | Stage 7: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; branded units and IDs. `tests/e2e/` is in no tsconfig but passes a strict check                                                                        |
| Unit and integration | `npm test`                                                                          | passed    | 344 files, 3,049 tests, 0 skipped, 98.5 s. Stage 7: 20 files use `vi.mock` (mostly Deck, geotiff, DuckDB); h5wasm, hyparquet and the codecs run for real (EXP-037, EXP-038)                                                         |
| Build                | `npm run build`                                                                     | passed    | Rolldown warns of chunks over 500 kB                                                                                                                                                                                                |
| Chromium             | `npx playwright install --dry-run chromium`                                         | available | Build 1223 already installed                                                                                                                                                                                                        |
| Offline E2E          | `npx playwright test --config evidence/baseline/pw.review.config.mjs --grep @smoke` | passed    | 19 of 19 `@smoke` tests, review build served on port 4273 (4173 may belong to another worktree). Includes the axe-baseline check                                                                                                    |
| Coverage             | `npm run test:coverage`                                                             | passed    | Statements 88.96%, branches 78.28%, functions 90.53%, lines 89.24%; thresholds 85, 74, 88, 85 (`vitest.config.ts:34-37`). CI job is non-blocking                                                                                    |
| Production audit     | `npm audit --omit=dev`                                                              | passed    | 0 vulnerabilities                                                                                                                                                                                                                   |
| Full audit           | `npm audit --audit-level=critical`                                                  | passed    | 0 vulnerabilities at any level                                                                                                                                                                                                      |
| Live E2E             | `@live` (18 in `app.spec.ts`, 2 in `examples.spec.ts`)                              | not run   | Needs hosted datasets. Asked before stage 6; the user gave no agreement to the transfer cost, so they stay unrun. Stage 7 read GitHub's scheduled runs instead: failing on `main` since 2026-11-19 on the idr0054 example (EXP-022) |
| Git status after     | `git status --porcelain`                                                            | clean     | Only `docs/review/` untracked                                                                                                                                                                                                       |

## Subsystem ledger

Per-file rows with area, stage and depth are in `evidence/inventory/ledger.tsv` (first built by `evidence/inventory/ledger.sh`; statuses are edited in place, so do not rerun it). Statuses: `reviewed` (read in full for the stage's questions), `sampled` (the parts named in the notes were read), `surveyed` (scanned by pattern across the folder, not read file by file), `excluded` (with a reason), and `not reviewed`. Stage 8 closed every row still pending as `not reviewed` with its reason; no row is pending.

| Area (plan section 2)                 | Files | Lines  | Stages | Depth so far                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ----- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts and detection               | 6     | 4,224  | 2, 4   | `datasetFactory.ts` load path traced (`notes/load-trace.md`); sampled in stage 4 (zip detection, Visium HD probes)                                                                                                                                                                                                                                                                                                                                               |
| Dataset loading and state             | 30    | 14,951 | 5, 7   | `useDatasetLifecycle.ts` H5AD branch traced; `platformAdapter.ts` reviewed (stage 4); stage 5: cancel path and Visium view change sampled (`notes/io-stage5.md`); stage 7: `useDatasetLifecycle.ts` sampled for ownership of view-change state (EXP-002)                                                                                                                                                                                                         |
| Platform readers                      | 43    | 26,507 | 4      | Stage 4: reviewed `xeniumDatasetRows.ts`, `merscopeTableReader.ts`, `merscopeFormat.ts`; sampled `xeniumDatasetReaders.ts`, `merscopeDataset.ts`, `spatialDataDataset.ts`, `spatialDataShapes.ts`, `visiumHdDatasetReaders.ts`, `visiumFormat.ts`, `h5adDataset.ts`. Atera, Icechunk and reference readers: existing tests only (`notes/platforms-stage4.md`)                                                                                                    |
| Shared scientific operations          | 17    | 5,787  | 3      | Reviewed: `cellid.ts`, `coords.ts`, `roiGeneStats.ts`, `roiCells.ts`, `roiTranscripts.ts` (stage 4); sampled: `gex.ts`, `transcriptZarr.ts` (stage 4: grid levels, point IDs); not reviewed: `geneValues.ts` (unit-tested), `transcriptZarr.ts` QV and `valid` handling (stage 5)                                                                                                                                                                                |
| HTTP, HDF5, archives, workers, Zarr   | 79    | 14,463 | 5      | Stage 5: reviewed `persistentByteRangeCache.ts`, `h5RangeFile.ts`, `h5FileCore.ts` (error path); sampled `cachedZipStore.ts`, `zipArchive.ts`, `zarrStores.ts`, `icechunkStore.ts`, `rangeSupport.ts`, `tileDecodePool.ts`; reader and HTTP error matrix in `notes/io-stage5.md`. DuckDB-WASM `httpfs` not reviewed                                                                                                                                              |
| Images and rendering                  | 119   | 31,516 | 4, 6   | Stage 4: reviewed `transcriptOverlay.ts` (merge); sampled `src/tiff/loader.ts` (level tile size), `src/codecs/tiffTile.ts` (decoder choice); TIFF and OME-Zarr readers exercised by the first attempt's repros. Stage 6: sampled `ViewerCore.tsx` (Deck mount), `morphologyTileStore.ts`, `tileCache.ts`, `MorphologyChannelControls.tsx`; measured in a browser (`notes/ui-stage6.md`)                                                                          |
| Plots and Cell Query                  | 30    | 9,924  | 3      | Reviewed: `cellQuery.ts`; Plots sampled through the independent oracle repro; `useCellQueryModel.ts` async loads sampled in stage 5 (stale results dropped; no finding)                                                                                                                                                                                                                                                                                          |
| Collections and 3D                    | 13    | 3,295  | 3, 4   | Reviewed: `sectionStackModel.ts`; sampled: `collectionPreviewData.ts`; stage 4: parser refusals through existing tests and stage 2 probes                                                                                                                                                                                                                                                                                                                        |
| User state and exports                | 18    | 7,724  | 3, 6   | Sampled: ROI limit flags in `useRoiWorkflow.ts`, `useMagicLensWorkflow.ts`; stage 5: CSV export (`src/utils/csv.ts`) reviewed; recent datasets and share-link lists sampled                                                                                                                                                                                                                                                                                      |
| UI shell, sections and other features | 118   | 28,996 | 6, 7   | Stage 6: reviewed `floatingWindowModel.ts`; sampled `CollectionBar.tsx`, `collection.css`, `tokens.css`; exercised at 1440, 1024 and 390 px with axe, overflow and focus checks; smoke suite rerun at 1024 and 390 px; stage 7: `App.tsx` sampled (size, hooks, churn; EXP-002); `docLinks.ts` reviewed, `examplesIndex.ts` sampled (EXP-023). Stage 8: 110 rows of this area and 25 of "Dataset loading and state" not reviewed, only in repository-wide checks |
| Other `src/data` modules              | 17    | 4,413  | 3, 5   | Stage 5: sampled `datasetWarmup.ts`, `hyparquetCells.ts`, `gexSelection.ts`, `duckdbCells.ts`; stage 6: reviewed `performanceBudget.ts`                                                                                                                                                                                                                                                                                                                          |
| Public documentation                  | 26    | —      | 2      | Sampled: 8 modality pages (8–14 claims each); `ui-reference.md` (panels, availability, share table), `user-guide.md` (Plots), `architecture.md` (detection, budget), `deploy-to-s3.md` (reviewed against `release.yml`), manifest and collection guides (JSON blocks, Editor Support, paths), `README.md` (commands, limits). All: links and code references                                                                                                     |
| Plan records                          | 36    | —      | 1, 2   | `open-items.md` read in full; `PLAN.md` status table compared with open boxes in every phase file; phase 24 and 25 Known Gaps read                                                                                                                                                                                                                                                                                                                               |
| Schemas, examples, collections        | 23    | —      | 2      | Reviewed: both schemas against the parsers (66 probes), 20 example and collection files, `index.json` (`--check`)                                                                                                                                                                                                                                                                                                                                                |
| Scripts                               | 6     | —      | 2, 6   | `examples-index.ts` run with `--check`; stage 6: `profile-load.mjs` reviewed and run unchanged, `range-server.mjs` used; `review-tasks.mjs` not used                                                                                                                                                                                                                                                                                                             |
| Workflows, config, patch              | 21    | —      | 7      | Stage 7: 5 workflows, the TypeScript, ESLint, Vitest and Playwright configs, `package.json` and the patch reviewed; `package-lock.json` (install scripts) and `index.html` sampled; 5 formatting or packaging files excluded                                                                                                                                                                                                                                     |
| Tests                                 | 371   | —      | 7      | Stage 7: all surveyed by pattern (`vi.mock`, `fetch` and `Worker` stubs, bare `toThrow()`); 6 sampled where a finding pointed (`ateraDataset.test.ts`, `hyparquetBitPacked.test.ts`, `app.spec.ts`, `controls.ts`, `examples.spec.ts`, `h5Fixtures.ts`)                                                                                                                                                                                                          |
| Fixtures (data)                       | 286   | —      | 7      | Stage 7: surveyed; every folder has a generator script; generators not rerun                                                                                                                                                                                                                                                                                                                                                                                     |

Source totals: 490 files, 151,800 lines.

Final ledger counts (stage 8):

| Kind                           | Reviewed | Sampled | Surveyed | Excluded | Not reviewed |
| ------------------------------ | -------- | ------- | -------- | -------- | ------------ |
| Source                         | 25       | 52      | —        | —        | 413          |
| Public documentation           | 2        | 17      | —        | —        | 7            |
| Plan records                   | 4        | 2       | 28       | —        | 2            |
| Schemas, examples, collections | 23       | —       | —        | —        | —            |
| Scripts                        | 2        | —       | —        | —        | 4            |
| Workflows, config, patch       | 13       | 3       | —        | 5        | —            |
| Tests                          | 2        | 8       | 361      | —        | —            |
| Fixtures                       | —        | —       | 286      | —        | —            |

Source files not reviewed, by area: images and rendering 110, UI shell and other features 110, HTTP/HDF5/archives/workers/Zarr 64, platform readers 27, dataset loading and state 25, Plots and Cell Query 25, user state and exports 16, other `src/data` 14, collections and 3D 10, shared scientific operations 8, contracts and detection 4. They passed the baseline's types, lint and unit tests and are in the import graph and promise-lint scans, but were not read. The public pages not reviewed are `docs/README.md`, `cell-feature-matrix-compatibility.md`, `image-only-and-geojson.md`, `s3-cors-playbook.md`, `visium-hd-2um-strategy.md`, `zchunkstore.md` and `examples/README.md` (links and code references checked in stage 2).

## Modality and backend scenarios

Verified in stage 4; cases and evidence per row in `notes/platforms-stage4.md`. "Repro" is a review repro with hand-written or numpy expectations; "test" is an existing test whose assertion was read.

| Platform or backend | Success case                                            | Failure or unsupported case                                    | Findings                       |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| Xenium              | verified (repro, real DuckDB-WASM)                      | verified (repro: XOA 1.0.x `int32` IDs refused with a message) | EXP-001 (P1), EXP-006, EXP-007 |
| Atera               | sampled (test)                                          | sampled (test; asserts any error)                              | none                           |
| Standard Visium     | verified (repro, 11 hand-computed cases)                | verified (repro: barcode suffix mismatch error)                | EXP-019                        |
| Visium HD           | sampled (test, plus 3 matrix rows read in code)         | sampled (test: error names the file)                           | none new                       |
| H5AD                | verified (repro against numpy, whole and range-read)    | sampled (test: 350 MB refused without Range)                   | EXP-004, EXP-012, EXP-013      |
| AnnData Zarr        | verified (repro against numpy)                          | shared with H5AD                                               | EXP-013                        |
| Reference, Icechunk | sampled (tests)                                         | sampled (test: no repository)                                  | none                           |
| SpatialData         | verified (repro control case)                           | verified (repro: IDs above 2^53)                               | EXP-008                        |
| Images              | verified (repros: LZW, zstd, measurement oracle)        | verified (repro: float32 refused as documented)                | EXP-015                        |
| MERSCOPE            | verified (repros: 19-digit IDs, join, isotropic `.vzg`) | verified (repro: size message just above 300 MiB)              | EXP-017, EXP-018, EXP-016      |
| Collections         | verified (stage 2 probes, stage 3 model)                | sampled (tests and stage 2 probes)                             | EXP-031                        |

## Exclusions

- `node_modules/`, `dist/`, `coverage/` and other build or cache outputs: not authored source.
- Paths in logs and outputs under `evidence/` are repository-relative. `<scratch>` stands for the session's temporary folder outside the repository (builds, heap snapshots, Playwright output), and `~` for the home folder. The four scripts that had the checkout's absolute path now find the repository root from their own location; `evidence/baseline/baseline.sh` takes its scratch folder from `SP`.
- The first attempt's files under `evidence/` and raw tool output (`evidence/triage/repro-run.json`), 140 files, were formatted with Prettier when the review was committed, so the repository's `format:check` passes. The change is whitespace only; the repros give the same 181 passes and 12 failures afterwards. One unused `eslint-disable` line was removed from `evidence/repro/platforms/duckdbNode.ts`.
- Binary fixtures are data. Stage 7 checked that every fixture folder has a generator script; the generators were not rerun.
- `docs/plan/` records are history. They are reconciled, not reviewed as current behaviour.

## Rendering and performance (stage 6)

Measured in a browser on the reviewed build; details, numbers and evidence paths in `notes/ui-stage6.md`.

| Check                              | Result                                                                                                     | Findings           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------ |
| Subpath and cross-origin headers   | 3 serving setups x 5 datasets open; workers load from the subpath                                          | none               |
| Axe at 1440, 1024 and 390 px       | 7 states per width; violations only on image channel histograms and collection bar buttons                 | EXP-027, EXP-028   |
| Layout and focus                   | No horizontal scroll; Escape and focus return correct for every toggle tested; window under drawer at 1024 | EXP-029            |
| Smoke suite at 1024 and 390 px     | 17 of 19 and 3 of 19; the 390 px failures are helper limits                                                | EXP-029, EXP-038   |
| Decode workers over contrast edits | 1,140 live workers after 60 typed edits; renderer RSS up to 1.47 GB; no crash                              | EXP-003 (measured) |
| Dataset and section switches       | One Deck, WebGL device and its layers kept per switch; about 50 MiB per switch at 200,000 cells            | EXP-011            |
| Cold-load requests                 | Detection probes sent twice on folder sources                                                              | EXP-024            |
| Profile (SwiftShader and Metal)    | 200,000-cell load: 6.8 to 7.0 s software drawing versus 1.0 to 1.1 s on the GPU; app chunks under 190 ms   | none               |

Not exercised: `@live` datasets, DuckDB-WASM and OpenJPEG under the serving setups, the 3D stack, Z planes, transcripts, canvas picking beyond the smoke suite, and the narrow `Panels` menu.

## Maintainability, tests, CI and release (stage 7)

Details and evidence paths in `notes/quality-stage7.md`. GitHub was only read (`gh` read-only calls).

| Check                               | Result                                                                                                                                            | Findings         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Workflow gating                     | Pages deploys only after CI succeeds on a push; `main` has no branch protection or rulesets, so nothing blocks a merge; coverage job non-blocking | EXP-032          |
| Scheduled live suite                | Failing on `main` since 2026-11-19, only on the idr0054 example; its host refuses connections, the EBI mirror answers                             | EXP-022          |
| Release job                         | Write token in the environment of every step                                                                                                      | EXP-025          |
| Release metadata and runtime inputs | Release builds show no version; gallery and Help links follow `main`                                                                              | EXP-023          |
| Redeploy under an open tab          | Missing lazy chunk reported as a CORS or network error; a tile worker that fails to load leaves tiles pending                                     | EXP-021, EXP-020 |
| Orchestration and contracts         | No runtime import cycles; view-change state has no commit point; expression batches read three ways                                               | EXP-002, EXP-005 |
| Duplicated worker and abort code    | Six one-shot wrappers, 73 abort helpers, consistent today                                                                                         | EXP-036          |
| Types and promises                  | Strict settings; no floating promises (type-aware rules run once)                                                                                 | none             |
| Tests and mocks                     | Real decoders in unit tests; one test passes on the wrong error; no lifetime, narrow-layout or image-state axe tests                              | EXP-037, EXP-038 |
| hyparquet patch                     | Applied, still needed, guarded by a test                                                                                                          | none             |

## Stage 8 and remaining checks

Stage 8 (2026-11-20) rechecked every provisional finding against its code path, callers, tests and `open-items.md`, and reran the review repros: 26 files, 193 tests, 181 pass and 12 fail, each failure a finding's expected-behaviour case (`evidence/stage8/repro-rerun.log`). It merged the structural findings into their behaviour findings (EXP-002, EXP-005), closed the last first-attempt lead as EXP-009, assigned final IDs and severities (3 P1, 8 P2, 27 P3), mapped the matrix's `finding_id` column to final IDs and added one row (141 rows), and closed the ledger. `git status` and `git diff` show no change outside `docs/review/` (`evidence/stage8/git-status.log`).

Checks still open, in the order they would most change the report:

1. `@live` tests, with the user's agreement to the transfer cost: confirms EXP-001 by clicking `Export Transcripts` on the demo, reruns `evidence/repro/platforms/xenium-zarr-ids-live.repro.ts` (EXP-006), and the Xenium first-30-seconds stalls.
2. EXP-011 at 1M+ cells on a real GPU, to decide P1 or P2.
3. A browser check of EXP-009 on a real Visium HD dataset, and of EXP-010's Chromium trigger.
4. An independent oracle for Atera, kerchunk reference and Icechunk readers, and the DuckDB-WASM `httpfs` path.
5. Reading the 413 source files not reviewed, starting with images and rendering and the HTTP/HDF5/archives area.
6. Firefox and Safari; Node 24.
7. The hypotheses in `REVIEW_REPORT.md`.

Any further worker needs effort controlled at medium first; 3 of 4 activations are unused.

## Addendum (2026-11-20, main at `5b1cd9f`)

`ADDENDUM_2026-11-20.md` covers the four commits merged to main after the review (`6a9a736..5b1cd9f`, PRs 200 to 202). Main was merged into the review branch (`de29298`), so `src/` there is identical to main.

- **Baseline on the merged head:** format, lint, types, unit tests (347 files, 3,089 tests), build, the 19 smoke tests and coverage all pass. `npm ci` and the audits were not rerun, since dependencies are unchanged.
- **Earlier findings:** the review repros give the same 12 failures as at `6a9a736` (`evidence/addendum/repro-rerun.log`), and `evidence/addendum/anchors.tsv` maps the 47 cited lines in changed files to `5b1cd9f`. All 38 findings are still present.
- **Ledger:** 138 rows with stage `addendum`, one per changed path: source diffs and callers reviewed, docs traced, tests executed but not read, fixtures surveyed.
- **Matrix:** DOC-ADD-01 to -12 (153 rows in all): 7 match, 4 code defects, 1 ambiguous.
- **Browser checks:** `evidence/addendum/pw.addendum.config.mjs` serves the build on 4273 and the addendum fixtures on 4274, with no server reuse. Headless Chromium with SwiftShader.
- **Not executed:**
  - EXP-039 for the 3D stack, volume view and side by side.
  - Range-read and Icechunk sections.
  - Firefox and Safari.
  - Hosted data.
- **Delegation:** no worker; 3 of 4 activations unused.
