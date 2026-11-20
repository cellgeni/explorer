# Review stages and checkpoint

The first attempt ran out of tokens. The review now runs in eight stages. The coordinator stops before each stage and waits for the user to say go. Every stage ends by updating this file and `../COVERAGE.md` so a new session can resume from disk.

Reviewed version: `6a9a736a26fc1b095ed7c1bbfbace97ab4eddf10` (origin/main, PR 197 merge). See `README.md` in this folder for host details.

## Delegation controls

- Every sub-agent is launched with an explicit `model: "sonnet"`. The session environment also sets `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` and `CLAUDE_CODE_SUBAGENT_EFFORT=medium`. The running Claude Code is 2.1.289, which supports the forced-model option.
- `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` are not set. The coordinator enforces one foreground worker at a time, and each worker prompt forbids spawning agents. The subagent transcript folder is checked after each activation for nested launches.
- The model is checked after each activation from the worker transcript. Effort is recorded as requested (medium) unless the transcript shows it.
- Budget: four activations, at most 12 turns each, one level deep.
- First attempt (before the limits were added): 16 coordinator launches and 20 nested launches, all on `claude-opus-5-5`. Their output is unverified and is triaged in stage 1. They are not counted against the four-activation budget.

| #   | Stage | Activation                   | Model observed        | Effort               | Scope                           | Result      |
| --- | ----- | ---------------------------- | --------------------- | -------------------- | ------------------------------- | ----------- |
| —   | 1     | no worker                    | —                     | —                    | stage 1 done by the coordinator | 4 of 4 left |
| 1   | 2     | Sonnet (`claude-sonnet-5-5`) | **xhigh**, not medium | modality page claims | 86 rows, 12 turns               | 3 of 4 left |

## Stages

| Stage                                               | Plan steps                                 | Status          | Worker            |
| --------------------------------------------------- | ------------------------------------------ | --------------- | ----------------- |
| 1. Resume and close R0/R1                           | R0, R1                                     | done 2026-11-20 | none              |
| 2. Documentation, schemas, examples                 | R2                                         | done 2026-11-20 | activation 1 used |
| 3. Shared scientific invariants and recent features | R3 (cross-platform, plots, Cell Query, 3D) | done 2026-11-20 | none planned      |
| 4. Platform and backend matrix                      | R3 (modality and storage matrix)           | done 2026-11-20 | none (1 planned)  |
| 5. I/O, cancellation, caches, trust boundaries      | R4                                         | done 2026-11-20 | none (1 planned)  |
| 6. Rendering, interaction, performance              | R5                                         | done 2026-11-20 | none (reserve)    |
| 7. Maintainability, tests, CI and release           | R6                                         | done 2026-11-20 | none              |
| 8. Consolidation                                    | R7                                         | done 2026-11-20 | none              |

### 1. Resume and close R0/R1

- Write `COVERAGE.md` v1: version identity, the R1 baseline table from `evidence/baseline/` (test and skip counts, coverage against thresholds, audit output), this delegation ledger, and a file ledger built from `evidence/inventory/` with every area pending.
- Triage the first attempt's output (about 340 files, 4.6 MB under `evidence/`): list it, run the isolated repro config once, and mark each repro as reproduces, fails, or lead only. Nothing is deleted.
- Read `docs/plan/open-items.md`, `plan-vs-docs.md`, `decisions.md` and `engineering.md`, and list the existing leads to reconcile in later stages.
- Trace one complete load (input URL to rendering) and record the shared boundaries.
- Refresh `README.md` in this folder (its reviewer brief still says the baseline is running).

### 2. Documentation, schemas, examples

- Coordinator: parse every local example and collection through the runtime parsers in an isolated repro, compare the two public schemas with the parsers, and check local links, anchors and referenced paths with a script.
- Worker: claim inventory for `docs/modalities/` and the format guides, giving `DOC_CODE_MATRIX.csv` rows with code and test pointers. The coordinator spot-checks consequential rows.

### 3. Shared scientific invariants and recent features

- `src/data/coords.ts`, `cellid.ts`, `gex.ts`, `geneValues.ts`, `roiGeneStats.ts`, `transcriptZarr.ts`, then plots, Cell Query and the 3D stack, using small fixtures with independently computed answers.

### 4. Platform and backend matrix

- Xenium, Atera, Visium, Visium HD, H5AD, AnnData Zarr, reference and Icechunk, SpatialData, images, MERSCOPE, collections. One success case and one failure or unsupported case per row, reusing stage 1's triaged repros. The worker takes a bounded subset (likely the image readers).

### 5. I/O, cancellation, caches, trust boundaries

- Range and HTTP failure injection with `scripts/range-server.mjs` or intercepted fetches, HDF5 error propagation, ZIP and Zarr, load races, cache identity, resource ownership, escaping of external names, the hyparquet patch. The worker takes the failure-injection matrix.

### 6. Rendering, interaction, performance

- Own `vite preview` of the review build on port 4273, the user-journey checklist at desktop, about 1024 px and about 390 px, axe smoke and keyboard journey, bounded profiling of two or three scenarios, subpath and cross-origin-header serving. Live `@live` cases only after the user agrees to the transfer cost.

### 7. Maintainability, tests, CI and release

- Orchestration boundaries, duplicated abort and worker-session code, mocks that bypass real WASM, HTTP or codecs, CI and release workflows.

### 8. Consolidation

- `REVIEW_REPORT.md`, `REVIEW_TASKS.md`, final `DOC_CODE_MATRIX.csv` and `COVERAGE.md`, and a `git diff` check that only review artifacts changed.

## Stage 1 outcome (2026-11-20)

- `../COVERAGE.md` v1: version identity, baseline table (all 12 steps passed), delegation ledger, area ledger (`../evidence/inventory/ledger.tsv`, 490 source files, all pending), scenario table.
- `../evidence/triage/README.md`: the first attempt's 25 repros rerun offline (180 of 192 tests pass; the 12 failures are candidate defects) and every other item mapped to a stage.
- `existing-leads.md`: open items and the plan's leads, each with its stage.
- `load-trace.md`: one `.h5ad` load from URL to rendering, with shared boundaries and two leads.
- No worker launched; 4 activations left.

## Stage 2 outcome (2026-11-20)

- `../DOC_CODE_MATRIX.csv`: 105 rows (19 coordinator, 86 from activation 1): 77 matches, 11 doc defect, 3 ambiguous, 14 not verified (carried to stage 4).
- `docs-stage2.md`: provisional findings DOC-01 to DOC-07, all P3; discarded leads; the worker's corrected rows.
- Activation 1 ran on Sonnet but at xhigh effort. The coordinator session runs with `--effort xhigh`, which overrode `CLAUDE_CODE_SUBAGENT_EFFORT=medium`. No further worker until effort is controlled.

## Stage 3 outcome (2026-11-20)

- `science-stage3.md`: provisional findings SCI-01 to SCI-05 (two P2, three P3), hypotheses, matches recorded, depth per file.
- `../DOC_CODE_MATRIX.csv`: 9 DOC-SCI rows (114 rows in all).
- No worker (none was planned). The user has not yet answered how to handle the effort limit; the coordinator continues without agents meanwhile. 3 activations left.

## Stage 4 outcome (2026-11-20)

- `platforms-stage4.md`: scenario matrix (one success and one failure case per platform or backend), provisional findings PLT-01 to PLT-10 (one P1, three P2, six P3), additions to SCI-01 and SCI-04, the 14 carried matrix rows resolved.
- `../DOC_CODE_MATRIX.csv`: 121 rows; the 14 not-verified rows resolved (10 matches, 4 code defects) and 7 DOC-PLT rows added. No row is left not verified.
- `science-stage3.md`: SCI-01 corrected (the Magic Lens is unavailable on the affected platforms); SCI-04 extended.
- Repro rerun: `../evidence/platforms-stage4/repro-run.log`, the same 7 failures as stage 1. The live Xenium repro was not rerun.
- No worker. The image-reader worker was not launched because effort is still uncontrolled; the coordinator sampled the TIFF loader and decoder choice instead. 3 activations left.

## Stage 5 outcome (2026-11-20)

- `io-stage5.md`: reader and HTTP error matrix; provisional findings LIF-01 (P1), IO-01 and IO-02 (P2), TRUST-01 (P3); four known open items reconfirmed; checks with no finding (HDF5 error path, SQL, HTML, links, CSV, ZIP, dataset cache, Cell Query column loads, third-party loading).
- `../DOC_CODE_MATRIX.csv`: 3 DOC-IO rows (124 rows in all).
- Evidence is static reading plus the first attempt's repros, reread against the code; no new browser run. IO-02's memory cost is left to stage 6.
- No worker. The failure-injection worker was not launched because effort is still uncontrolled. 3 activations left.

## Stage 6 outcome (2026-11-20)

- `ui-stage6.md`: provisional findings PERF-01 (P2, candidate P1), PERF-02, UI-01, UI-02 and UI-03 (P3); IO-02 measured (stays P2, candidate P1); measurements without a finding; user-journey coverage; depth.
- Evidence in `../evidence/ui-stage6/`: review-only Playwright config and specs on ports 4273 to 4276, a subpath server, the OME-TIFF fixture script, heap snapshot tools, logs and `out/` (JSON and screenshots). Heap snapshots (190 MB) and builds stayed in the scratchpad.
- `../DOC_CODE_MATRIX.csv`: 9 DOC-UI rows (133 rows in all), all matches.
- `@live` tests not run: the user did not agree to the transfer cost.
- No worker. The reserve was not used because effort is still uncontrolled. 3 activations left.

## Stage 7 outcome (2026-11-20)

- `quality-stage7.md`: provisional findings CI-01, CI-02 (partly known-open), CI-03, REL-01, REL-02, IO-03, MNT-01, MNT-02, MNT-03, TEST-01 and TEST-02, all P3; checks with no finding; clean-up candidates; the carried leads closed.
- Evidence in `../evidence/quality-stage7/`: import-graph script and logs, a review-only tsconfig for `tests/e2e/`, a review-only ESLint config for type-aware promise rules and its output, the Atera test probe and its log. New repro `../evidence/repro/quality/tilePoolWorkerLoadFailure.repro.ts` (passes, recording the hang).
- GitHub read only: run history, live-suite logs, branch protection, rulesets, releases. The live suite has failed on `main` since 2026-11-19 (CI-01). No `@live` test was run locally.
- `../DOC_CODE_MATRIX.csv`: 7 DOC-QA rows (140 rows in all): 6 matches, 1 doc defect.
- Ledger: workflows, configs and the patch reviewed; tests and fixtures surveyed by pattern; 135 source rows of stages 5 to 7 still pending, left for stage 8 to close as not reviewed.
- No worker. Effort is still uncontrolled. 3 activations left.

## Stage 8 outcome (2026-11-20)

- `../REVIEW_REPORT.md`: 38 findings with final IDs (3 P1, 8 P2, 27 P3, no P0), a findings index mapping each to its provisional ID and task, existing items reconciled, validation results, coverage and remaining uncertainty, hypotheses kept apart.
- Severity decisions: EXP-001 (was PLT-01) stays P1. EXP-002 (LIF-01) stays P1: the ROI read path through the switched Visium view (`h5adDataset.ts:1066-1072`, `1458-1466`) completes the static proof of cross-section reads. EXP-003 (IO-02) is raised to P1: hundreds of live workers and about 1 GB from an ordinary control, with no bound. EXP-011 (PERF-01) stays P2: no failure was reached.
- Merged: MNT-01 into EXP-002 and MNT-02 into EXP-005, as root causes with their own wave 4 tasks. DOC-02, DOC-03, DOC-07 and PLT-10 into EXP-034 (four reference statements behind the code).
- New: EXP-009, the first attempt's last open lead (`visiumHdScaleKeyAcrossLod`). The Auto gene scale key ignores the Visium HD bin size, so the 16 µm top is kept after zooming into 2 µm or 8 µm bins. Static proof, with the production functions executed.
- `../REVIEW_TASKS.md`: 41 tasks in four waves (P1, P2, P3, then behaviour-preserving refactors), each with acceptance criteria and its regression test.
- Repros rerun: 26 files, 193 tests, 181 pass, 12 fail, each failure a finding's expected-behaviour case (`../evidence/stage8/repro-rerun.log`).
- `../DOC_CODE_MATRIX.csv`: `finding_id` mapped to final IDs; one row added (DOC-REV-01); 141 rows.
- Ledger closed: 460 pending rows set to `not reviewed` (413 source, 7 docs, 2 plan records, 4 scripts) or to the depth the earlier stages recorded (plan records, `PLAN.md`).
- `../COVERAGE.md` final, with the remaining checks in order.
- No worker. 3 of 4 activations unused.
