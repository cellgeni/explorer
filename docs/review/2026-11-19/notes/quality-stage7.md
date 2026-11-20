# Stage 7: maintainability, tests, CI and release (R6)

Coordinator notes, 2026-11-20, commit `6a9a736`. No worker was used. Evidence: `../evidence/quality-stage7/`; repro `../evidence/repro/quality/tilePoolWorkerLoadFailure.repro.ts`. Matrix rows: DOC-QA in `../DOC_CODE_MATRIX.csv`.

GitHub was read, never written: workflow runs, run logs, branch protection, rulesets and releases through `gh` (read-only calls), plus one metadata request (15 KB) to each of the two IDR hosts. No `@live` test was run locally.

## Scope and depth

| Area                                                                                                | Depth    | Notes                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/*.yml` (5)                                                                       | reviewed | Triggers, gating, permissions, concurrency; cross-checked with the last 40 runs on `main` and the live-suite history                             |
| Branch protection and rulesets                                                                      | reviewed | GitHub API: `main` "Branch not protected", rulesets `[]`                                                                                         |
| Release path (`release.yml`, `vite.config.ts` `buildCommitMeta`, `docLinks.ts`, `examplesIndex.ts`) | reviewed | One pre-release (`v0.1.0-rc.1`), its run passed; Pages `build-commit` meta equals the reviewed commit; schemas served as JSON                    |
| Import graph of `src/` (468 non-test files)                                                         | reviewed | `evidence/quality-stage7/import-graph.mjs`, with and without type-only imports                                                                   |
| Orchestration (`App.tsx`, `useDatasetLifecycle.ts`, `ViewerCore.tsx`)                               | sampled  | Size, hooks, churn; connected to LIF-01, PERF-01, PERF-02                                                                                        |
| Worker wrappers and pools (13 `new Worker` sites, 3 pools)                                          | reviewed | Abort, error and load-failure paths; ownership                                                                                                   |
| Abort helpers                                                                                       | reviewed | 31 `abortError`, 31 `throwIfAborted`, 11 `isAbortError` definitions compared                                                                     |
| Type strictness and lint                                                                            | reviewed | `tsconfig.*.json`, `eslint.config.js`; type-aware promise rules run once in a review-only config; E2E specs type-checked in a review-only config |
| Unit tests (343 files)                                                                              | surveyed | Pattern scan for `vi.mock`, `fetch` and `Worker` stubs and bare `toThrow()`; six files read where a finding pointed                              |
| E2E (`tests/e2e/`)                                                                                  | sampled  | Fixture routing, axe scope, live Xenium ROI test, viewport                                                                                       |
| Fixtures (11 folders, 286 files)                                                                    | surveyed | Every folder has a generator script; generators not rerun (they need Python packages and pinned writers)                                         |
| hyparquet patch                                                                                     | reviewed | Applied, still needed (upstream `readBitPacked` unchanged on master), guarded by `src/data/hyparquetBitPacked.test.ts`                           |

## Provisional findings

### CI-01 The scheduled live suite has failed on `main` since 2026-11-19: the tonsil gallery example's host refuses connections (P3, user-visible)

- Confidence: confirmed by execution (CI logs; one request from this Mac).
- `E2E full (live data)` failed on 2026-11-19 (run 44511097930) and 2026-11-20 (run 44722739362), both times only on `loads the idr/idr0054-tonsil example @live` (`tests/e2e/examples.spec.ts:37`), both attempts timing out at 180 s waiting for "ready". 48 of 49 tests passed on 2026-11-20.
- The example reads `https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0054A/5025551.zarr` (`examples/idr/idr0054-tonsil.json:15`). From this Mac the host refuses the connection (`curl: (7) Failed to connect … after 50 ms`). The EBI mirror `https://livingobjects.ebi.ac.uk/idr/zarr/v0.4/idr0054A/5025551.zarr/.zattrs` answers 200 in 0.12 s with the same path. PR #181 moved the idr0062 example to that mirror for the same reason.
- The gallery lists the card to every user (`examples/index.json:117-120`), so users whose network cannot reach Embassy S3 get a failed load.
- Surfacing: nothing beyond GitHub's own notification for a failed scheduled run. No issue is opened and no other workflow reads the result. The 2026-11-10 and 2026-11-11 failures (Atera) were also only visible there.
- Correction: point the example at the livingobjects mirror (as PR #181 did) and regenerate the index; optionally have the live workflow open or update an issue when it fails twice in a row.
- Uncertainty: whether Embassy S3 refuses all clients or only some networks; it refused GitHub's runners and this Mac.

### CI-02 Stale wording about which checks block (P3, documentation; partly known-open)

- Confidence: confirmed (GitHub API, YAML).
- GitHub reports `main` as "Branch not protected" with no rulesets, so no check blocks a merge. Pages deploys only after the whole CI workflow succeeds on a push (`pages.yml:22-26`), so CI blocks deployment, not merging.
- `docs/plan/engineering.md:242-247` already records this ("required" means "required by convention"); it is known-open.
- Still misleading: `README.md:44-46` ("`npm test` is the required check") gives no such caveat, and `vitest.config.ts:31-32` says the thresholds are set "so a drop fails CI", but the coverage job has `continue-on-error: true` (`ci.yml:53`), so a drop leaves CI green.
- Correction: reword the README sentence and the config comment, or protect `main` requiring `check` and `e2e-smoke` (an owner's decision, as the plan says).

### CI-03 The release job exposes a write token to every step (P3, security hardening)

- Confidence: static proof; no exposure demonstrated.
- `release.yml` grants `contents: write` (`:17-18`) and sets `GH_TOKEN` in the job environment (`:31-32`), so `npm ci`, `npm test` and the Playwright run all execute with it. `actions/checkout` also persists the token in `.git/config` by default. Only the two `gh` steps need it.
- Install scripts today: the project's own `patch-package` and `fsevents` (dev, macOS only), from `package-lock.json` `hasInstallScript`. The exposure would come from a compromised dev dependency running during tests.
- Correction: move `GH_TOKEN` to the two `gh` steps and set `persist-credentials: false`, or split the job into a read-only build-and-test job and a small upload job with `contents: write`.

### REL-01 A lazy chunk missing after a redeploy is reported as a dataset network or CORS error (P3)

- Confidence: confirmed by execution of the classifier (`evidence/repro/quality/staleChunkError.repro.ts`, 3 of 3) and static proof; not reproduced in a browser.
- The app has 76 dynamic imports (dataset readers, codecs). A Pages deploy replaces every hashed asset; there were 9 deploys on 2026-11-19. A tab opened before a deploy that then opens a dataset type it has not loaded yet gets a failed dynamic import. Chromium, Firefox and Safari messages are all classified as `network`, "Check dataset URL, CORS, and network access" (`src/features/errors/loadErrorModel.ts`, `createStructuredLoadError`). There is no `vite:preloadError` handler and no check of the message.
- Effect: the user is told to check their data hosting when a reload would fix it. Self-hosted release zips have the same problem when a deployment is upgraded in place.
- Correction: recognise chunk-load failures (the three messages plus `vite:preloadError`) and say "The app was updated; reload the page", optionally with a reload button.
- Regression: the repro's three messages must map to the new code.

### REL-02 A release build does not show its version, and its gallery and help links follow `main` (P3)

- Confidence: static proof.
- `release.yml:46` builds without `VITE_COMMIT_SHA`, so Help shows no commit (`docLinks.ts:31-35`) and `index.html` has no `build-commit` meta (`vite.config.ts:42-51`). The tag and commit are only in `version.json`, which the app does not read.
- Release builds read the example index from `main` (`examplesIndex.ts:7-8`) and link Help to `main`'s docs (`docLinks.ts:3`). An older release can list examples that need a newer reader, and its Help describes features it may not have. `deploy-to-s3.md:92-97` says the gallery is read from `main` only under "Build Locally", not for release zips.
- Correction: set `VITE_COMMIT_SHA` (and a release tag) in `release.yml`; either point release builds' gallery and doc links at the tag, or say in the release section that they follow `main`.

### IO-03 A tile decode worker that fails to load leaves later tiles pending forever (P3, reliability)

- Confidence: confirmed by execution (`evidence/repro/quality/tilePoolWorkerLoadFailure.repro.ts`: the first request rejects "Tile decode worker failed.", the next two stay pending, one worker created) and static proof.
- `TileDecodeWorkerPool` (`src/workers/tileDecodePool.ts:274-276`) rejects the requests pending at the `error` event but keeps the worker. A worker whose script did not load never answers, so every later request posted to it hangs. The Zarr pool drops its workers on the same event (`zarrDecodePool.ts:328-332`, `reset`), and the six one-shot readers fall back to the main thread. TIFF tiles have no fallback: `TileCache` always uses a worker decoder (`tileCache.ts:103`).
- Trigger: a worker script that fails to load, for example after a redeploy changed the worker's hash (REL-01), a `worker-src` policy on a self-hosted deployment, or a dropped connection. IO-02 makes it more likely, because every contrast edit starts a new pool.
- Effect: image tiles stay blank with no error after the first failure.
- Correction: reset the pool on `error` as the Zarr pool does, and fall back to main-thread decoding after a failed start.
- Regression: the repro's fake worker; later requests must reject or decode.

### MNT-01 Load and view-change state has no single commit point (P3, maintainability)

- Confidence: static proof, from LIF-01's trace.
- `App.tsx` is 5,339 lines with 144 imports, 73 `useRef`s and 45 `useCallback`s; it changed in 92 commits in the last 30 days, more than any other file. `useDatasetLifecycle.ts` is 2,461 lines and `ViewerCore.tsx` 2,442.
- A view change writes shared state in three places before the load commits: the share-state ref (`useVisiumControlsWorkflow.ts:150-176`), the global SpatialData selection that keys the dataset cache (`App.tsx:3670-3676`, `datasetFactory.ts:1717-1724`), and the shared dataset instance (`h5adDataset.ts:750-762`). `cancelDatasetLoad` (`useDatasetLifecycle.ts:2312-2323`) cannot undo what it does not own. This is the structural cause of LIF-01. Detection also runs in both the lifecycle and the factory (PERF-02).
- Recommendation (separate from LIF-01's behaviour fix): one pending-load record owned by `useDatasetLifecycle`, holding the view selection and share state, applied on commit and dropped on cancel or failure.

### MNT-02 The shared expression-batch contract is defined in the Xenium module and read three ways (P3, maintainability)

- Confidence: static proof.
- `GeneExpressionBatch` and `GeneExpressionQueryOptions` live in `src/datasets/xeniumDataset.ts:147-171` and are shared by every platform. Their comment says `sampleStride` "keeps every Nth cell without expression; cells with expression are always kept".
- H5AD and Atera do that (`h5adDataset.ts:829-845`, `ateraDataset.ts:320-341`). Xenium returns only expressing cells and ignores the option (`xeniumDatasetReaders.ts:623-625`). Visium HD has its own plan (`planVisiumHdGeneExpressionLod`) and keeps every Nth bin whether it expresses or not (`visiumHdDatasetReaders.ts:1330-1350`).
- Consequence: a batch's population depends on the platform, which is the root of SCI-02 (z-score against a different population). Whether Visium HD's sampling drops expressing bins at any zoom where it applies was not checked.
- Recommendation: move the types to `spatialDataset.ts`, state each batch's population (for example a `population` field), and add one contract test that runs each platform's batch reader on the same small layout.

### MNT-03 Six copies of the one-shot worker wrapper and 73 local abort helpers (P3, maintainability)

- Confidence: static proof.
- `merscopeTableWorker.ts`, `featureBarcodeMexWorker.ts`, `vectorSegmentationWorker.ts`, `zipEntryWorker.ts`, `cellsOverviewWorker.ts` and `spatialDataShapesWorker.ts` (113 to 186 lines each) repeat the same request, abort, error, fallback and terminate logic. After renaming, the MERSCOPE and MEX wrappers differ in 11 lines.
- 31 `abortError`, 31 `throwIfAborted` and 11 `isAbortError` functions are defined locally. They agree today (all test `name === 'AbortError'`), except `xeniumDataset.ts:739`, which also requires a `DOMException`; that is equivalent in practice because aborts carry the signal's `DOMException` reason.
- Ownership is uneven: `morphologyContrast.ts:284` terminates its pool, `TileCache` never does (IO-02), and only the Zarr pool recovers from a dead worker (IO-03).
- Recommendation, after the IO-02 and IO-03 fixes: one `runWorkerOnce` helper and one `abort.ts` module, as a behaviour-preserving refactor with the existing wrapper tests unchanged.

### TEST-01 A test named for the Atera feature-count check never reaches it (P3, tests)

- Confidence: confirmed by execution (`evidence/quality-stage7/ateraCscProbe.log`, a probe that logs the rejection without editing the test).
- `src/datasets/ateraDataset.test.ts:530-538`, "rejects a CSC matrix whose feature count differs from the matrix", points the CSC matrix at `cells.zarr.zip`, which holds no matrix, and asserts `rejects.toThrow()`. It passes on `NotFoundError: Not found: v2 array`. The check it is named for (`ateraDataset.ts:786-790`) runs in no test.
- 13 other assertions accept any error (`rejects.toThrow()` in `loader.test.ts` ×3, `strips.test.ts` ×2, and one each in `svs`, `spatialDataShapesWorker`, `workerZarrCodecs`, `readMaybeGzipText`, `persistentByteRangeCache`, `parquetStructure`, `parquetRows` and `geneValues` tests). They were not checked one by one; five are abort tests that would also pass on an unrelated error.
- Correction: build a CSC store whose `indptr` has the wrong length and assert the message; give the other 13 an error name or message.

### TEST-02 No test guards resource lifetime, narrow layouts or image states in the axe scan (P3, tests)

- Confidence: confirmed (stage 6 measurements; test inventory).
- PERF-01 and IO-02 were found by measurement only. No test counts WebGL contexts, Deck instances or decode workers. Five unit test files mock `@deck.gl/react`, and `TileCache` tests inject `decodeTile`, so the default worker decoder and the Deck lifecycle are not reachable from unit tests.
- Playwright runs one Desktop Chrome project. The smoke helpers assume the wide layout (3 of 19 pass at 390 px, stage 6), and the axe smoke test scans only the H5AD fixture, so it missed UI-01 and UI-02.
- The live Xenium ROI test checks that `Export Transcripts` is enabled (`app.spec.ts:1950-1952`) but clicks only `Export Cells`; one more click on the demo would have shown PLT-01.
- Smallest useful tests:
  - A smoke test that counts live WebGL contexts (wrap `getContext` and `WEBGL_lose_context` in `addInitScript`) over ten collection switches. Live contexts must stay at most 2, whichever PERF-01 fix is chosen.
  - A smoke test that counts `Worker` constructions and terminations over ten contrast edits on the OME-TIFF fixture. Live tile workers must stay at most 8.
  - The OME-TIFF and `.vzg` channel states added to the axe smoke test.
  - One smoke test at 390×844 with layout-aware helpers: Panels menu, layer sheet, one window.
  - In the live Xenium ROI test, click `Export Transcripts` and check the CSV has rows.

## Checks with no finding

| Check                       | Result                                                                                                                                                                                                                                                                                                                                 | Evidence                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Runtime import cycles       | None among 468 files. Eight cycles exist only through `import type` (largest: 28 files across `data/` and `datasets/`, through shared types such as `GeneExpressionBatch`). Upward runtime edges: `data → datasets` 13, `workers → datasets` 10 (workers host dataset parsers), `workers → features` 2, `rendering → features/genes` 1 | `import-graph.log`, `import-graph-runtime.log` |
| Type strictness             | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; 23 `as unknown as`, no `@ts-ignore` or `@ts-expect-error`, 2 `eslint-disable` (both justified). Units and IDs are branded (`coords.ts`, `cellid.ts`)                                                                                                               | grep counts                                    |
| Promise handling            | Type-aware `no-floating-promises` and `no-misused-promises` over production code: no floating promise; one async form handler passed as a void callback (`App.tsx:4101`), harmless                                                                                                                                                     | `eslint-promises.json`                         |
| E2E type checking           | `tests/e2e/` is in no project tsconfig, but passes the node tsconfig's strict settings with DOM types (0 errors)                                                                                                                                                                                                                       | `tsc-e2e.log`, `tsconfig.e2e.json`             |
| Worker message versions     | Workers and chunks are content-hashed per build, so a page and its workers cannot run different versions; only a missing file is possible (REL-01, IO-03)                                                                                                                                                                              | static                                         |
| Real decoders in unit tests | h5wasm writes HDF5 fixtures (`src/test/h5Fixtures.ts`); hyparquet, JPEG, JPEG 2000 and Zarr codecs run on generated files. Only 20 test files use `vi.mock`, mostly for Deck, geotiff and DuckDB. Worker wrappers are tested with cloning fakes                                                                                        | pattern scan                                   |
| Offline E2E data            | Answered by `page.route` with ranges, suffix ranges and HEAD (`app.spec.ts:920-967`), as `architecture.md:59-61` says. This skips Chromium's HTTP cache, so IO-01's trigger is not exercised offline                                                                                                                                   | static                                         |
| Fixture provenance          | Each of the 11 fixture folders has a `make_fixtures.py` (or `make_image_store.py`). The variants that broke later (`UNASSIGNED`, 64-bit IDs, negative and NaN values, quoted commas, colliding suffixes) are missing; each goes with its own finding's regression test                                                                 | folder listing                                 |
| hyparquet patch             | Applied (`node_modules/hyparquet/src/encoding.js:89`), reaches the browser build (exports map to `src/`), still needed (upstream master's `readBitPacked` still loops on `count`), guarded by a test, listed in `open-items.md:262-265`. No matching upstream issue among the last 100                                                 | `evidence/quality/hyparquet-patch-repro.log`   |
| Deploy order                | CI on `main` is serialised by its concurrency group, so Pages deploys follow push order (two pushes 17 s apart on 2026-11-19 deployed in order). A manual rerun of an older CI run would redeploy its commit                                                                                                                           | run list                                       |
| Deployed version            | Pages `build-commit` meta is `6a9a736…`, the reviewed commit; `schemas/explorer-manifest.v1.json` is served as JSON                                                                                                                                                                                                                    | `curl`                                         |
| Release run                 | One pre-release (`v0.1.0-rc.1`); its release run passed. Typecheck, unit tests and smoke tests run on the zipped `dist/`, as `deploy-to-s3.md:42-45` says                                                                                                                                                                              | `gh release list`, `gh run list`               |
| Audit                       | Non-blocking by design and documented (`audit.yml:3-6`); `--omit=dev` fails on any advisory                                                                                                                                                                                                                                            | static                                         |

## Clean-up candidates (no finding)

- `visiumHdMaxTwoMicrometerFilteredBarcodes` (`datasetFactory.ts:181-186, 1700-1730, 2090-2094`): wired through the factory, the readers and the cache key, but no production caller sets it; only tests do. The docs say no 2 µm budget applies (stage 4, VHD-11). Remove it, or wire it to the device profile if a budget is wanted.
- The scheduled live runs started between 10:27 and 11:26 UTC although the cron is 03:00 UTC (`e2e-live.yml:8`). This is GitHub's scheduling; results arrive mid-morning.
- Report the Polars bit-packing behaviour upstream so the patch can go (outside this review: no external issues).

## Leads closed

- Stale lazy-chunk error: REL-01.
- Unused Visium HD option: clean-up candidate above.
- Atera test accepting any error: TEST-01.
- hyparquet patch: no finding.
- Axe scan's single fixture, no narrow-layout E2E, no lifetime test: TEST-02.
- Orchestration boundaries: MNT-01 and MNT-02; duplicated abort and worker code: MNT-03.
