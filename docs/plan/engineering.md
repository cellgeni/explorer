# Engineering Record

Application structure, dataset hosting, testing and CI, the tech stack, and risks.

## Application Structure And Refactor Record

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

## Dataset Hosting Requirements

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
  seeks. For a zipped SpatialData store, store entries uncompressed (`zip -0`)
  so `shapes.parquet` can be read in parts; deflated entries are downloaded
  whole.
- **No transfer compression** (`Content-Encoding`) on Parquet, Zarr, TIFF, or
  HDF5. They are already compressed, and gzip breaks Range offsets.
- **Caching:** long `Cache-Control` plus `ETag`, on immutable dataset paths.
- **HTTP/2 or HTTP/3** on the CDN, because the app makes many small requests.
- **Cross-origin isolation:** the app does not need it today. Nothing uses
  `SharedArrayBuffer`, and DuckDB uses its non-threaded bundles (see
  [4.3](decisions.md#43-parquet-engine--decision-duckdb-wasm-primary-hyparquet-for-first-paint)).
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

## Testing And CI

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

### Inventory (2026-11-12)

From a run of `npm test` and the repository:

- `npm test`: 211 Vitest files with 1,617 tests (1,516 `it`/`test` calls
  before `.each` expands them), against 308 non-test source files under
  `src/`. After the S-sized open items (2026-11-12): 234 files with 1,820
  tests and one `it.todo`, including fast-check property tests
  (`*.property.test.ts`). Under full-suite load a few `App.test.tsx` tests that load 50,000
  cells can time out; they pass when the file runs alone.
- 25 Playwright tests: 12 smoke tests, offline, and 13 live ones. Four live
  Visium HD tests were added on 2026-11-12, making 29.
  - Smoke (`tests/e2e/app.spec.ts`): the shell; the start screen's examples
    and their offline fallback; a link that names a dataset; the axe walk;
    review tasks 1–5 by keyboard alone; transcript controls; an H5AD fixture
    with obs tracks and genes; a shared H5AD link coloured by a metadata
    track; AnnData from Icechunk; Visium libraries and off-tissue spots; and
    a Space Ranger Visium folder. Fixtures are built in the test or served
    from `src/test/fixtures` through `page.route`, and the examples index
    from `examples/index.json`.
  - Live: a CELLxGENE Visium H5AD, PBMC3K, the Atera kidney run, the Xenium
    demo (morphology, transcripts, ROI, Cell), and the Visium HD reference and
    its tiers. `tests/e2e/examples.spec.ts` loads every example in
    `examples/` (Xenium, QPTIFF, OME-Zarr and three H5AD) and the index from
    GitHub.
- CI (`.github/workflows`): `ci.yml` runs on every PR and push to `main`:
  format check, lint, typecheck, unit tests and build, then the smoke tests in
  Chromium. A separate job runs `npm run test:coverage` and uploads the report
  without blocking. `e2e-live.yml` runs every Playwright test at 03:00 UTC on
  weekdays and on demand. `release.yml` runs typecheck, unit tests and the
  smoke tests before it attaches the app zip; `pages.yml` deploys GitHub
  Pages.
- The eight review tasks run live with `scripts/review-tasks.mjs` (15.5-E),
  by hand against the dev server, not in CI.

### Open

- [x] Coverage reporter and thresholds (2026-11-12). `npm run test:coverage`
      runs V8 coverage over `src/` and fails below 85% of statements, 74% of
      branches, 88% of functions and 85% of lines; the baseline was 86.1%,
      75.3%, 89.4% and 86.1%. CI runs it in a separate job that uploads the
      HTML and lcov report but does not block. Running the required unit tests
      under coverage (CI #94, #97 and #98) failed each time in different
      `App.test.tsx` tests: under coverage the runner is slow enough for their
      1 s waits, and for checks read straight after an async load, to fail.
      `npm test` stays the required check. A coverage run now gives each test
      30 s and `waitFor`/`findBy` 5 s (`vitest.config.ts`, `src/test/setup.ts`);
      `npm test` keeps the 5 s and 1 s defaults. Two checks that read the image
      channels and the linked annotation set before they loaded now wait.
- [ ] Make the coverage job required once it has passed on the runner for a
      while; if another `App.test.tsx` check fails there, make it wait for the
      state it reads. The native density-squares check failed in the required
      job (CI #126 and #138, 2026-11-13): it showed transcripts before the
      viewer reported its fitted view, so one 1 s wait held the 180 ms report
      and the renders after it. It now waits for the Exact points meter, then
      the density read. The three checks that wait for `loadGeneExpression`
      (CI #128) had the same shape; since 2026-11-14 they wait for the meter,
      mounted while Transcripts is closed, before they pick a gene. The App
      tests still read the demo dataset's morphology image from
      `mp33.cog.sanger.ac.uk` by default, and decode its JPEG 2000 tiles on the
      test thread, carrying on after the test's App unmounts; locally that
      held one of those waits for up to 0.9 s.
- [x] Deeper Visium HD browser coverage: segmentation controls, Bin Info
      inspection, and loading the 2 µm tier when the environment allows.
      Done 2026-11-12; see [Closed Open Items](#closed-open-items).
- [x] Direct tests for small helpers and leaf components if they gain behaviour
      (assignment/status helpers, cell expression panels, worker messages).
      Done 2026-11-12 for 16 helpers and three cell panels, with property
      tests for coordinate, affine and cell-ID round trips.
- [x] CI pipeline: `ci.yml` gates every PR (see the inventory).
- [ ] Deploy previews for pull requests. `pages.yml` deploys only pushes to
      `main`. See [Open Items](open-items.md) for what a preview would need.
- [ ] A committed Xenium-shaped golden fixture bundle. Unit tests build their
      Xenium data in code, and the smoke tests have no Xenium dataset.
- [ ] E2E for SpatialData (shapes and labels stores), and smoke tests for
      OME-Zarr and image-only TIFF. Only the nightly examples load an OME-Zarr
      and a QPTIFF image.

### Closed Open Items

Moved from [Open Items](open-items.md) when the plan was split (2026-11-13).

Original-brief items with no outcome:

- [x] Property tests for coordinate round trips (2026-11-12, fast-check
      4.10.2): `coords.ts` (µm↔px, screen↔data, `viewportBbox`, tile cover),
      the SpatialData affines, and cell-ID integer pairs.

Testing:

- [x] Coverage reporter and thresholds (2026-11-12): `npm run test:coverage`,
      run by CI in a job that does not block; see
      [Testing And CI](#testing-and-ci).
- [x] Deeper Visium HD browser coverage. Partly done: the live test covers the
      8 and 16 µm tiers, a Feature Slice gene, Summarise View, a box ROI and
      barcode export. Segmentation boundaries, the Bin card and the 2 µm tier
      are not covered. Since 2026-11-12 four more live tests (`@live`, run
      nightly) open the reference at 1 px/µm on the right-hand section:
  - The Bin card, opened with Enter at the crosshair: barcode, size, tissue
    flag, array and image position, and the bin's expression profile; then the
    same card from a fresh load of its `card=bin:` link.
  - Cell and nucleus boundaries: 13,644 cells and 13,548 nuclei around that
    view, about 25 s locally.
  - The 2 µm tier (`test.slow()`): 3,443,936 bins in 7–15 s locally (42 s with
    6× CPU and 150 ms latency emulated), about 2 GB of JS heap, then a 2 µm
    Bin card.
  - The Bin card's cell assignment: "Loaded" in about 1.3 s locally after
    Enter, from 4 requests (HEAD, two footer reads, one 300 KB range).
- [x] Direct tests for small helpers. About 14 pure helpers have no test, for
      example `slug.ts`, `mapWithConcurrency.ts`, `asyncLimiter.ts`,
      `readMaybeGzipText.ts`, `omeZarrUrl.ts` and `fallbackNotice.ts`, and the
      two cell expression panels have none. Since 2026-11-12, 16 helpers and
      three cell panels have tests (`geneFeatures.ts` and `gexSelection.ts`
      are tested through `gex.test.ts`). They found a race in
      `createAsyncLimiter`: a finishing task freed its slot before the next
      waiter took it, so a task arriving in between ran over the limit. It now
      hands the slot straight to the waiter.
- [x] CI pipeline: `ci.yml` gates every PR.

## Tech Stack

| Concern             | Planned                                         | Outcome                                                                                                 |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Build               | Vite + strict TypeScript                        | As planned; vendor chunk groups added                                                                   |
| UI and state        | React + Zustand                                 | React state in domain bundles; Zustand for the viewer store only                                        |
| Rendering           | deck.gl 9 (orthographic) + Canvas2D underlay    | As planned; GPU-resident overview and instanced Visium HD bins (November 2026)                          |
| Parquet             | DuckDB-WASM (`spatial`) + hyparquet             | As planned; non-threaded bundles; `httpfs` loaded at bootstrap; hyparquet also reads SpatialData shapes |
| Zarr                | zarrita + `@zarrita/storage`                    | Matrix, analysis, transcript LOD, H5AD references, OME-Zarr images, SpatialData stores                  |
| HDF5                | h5wasm, jsfive fallback                         | h5wasm in workers (lazy-range for Visium HD, whole-file H5 file workers otherwise); jsfive deferred     |
| OME-TIFF            | geotiff.js (IFD/SubIFD + Range)                 | As planned; `.zchunkstore` sidecar; geotiff.js decoders for non-JPEG-2000 codecs                        |
| JPEG-2000           | OpenJPEG-WASM (`@cornerstonejs/codec-openjpeg`) | In decode workers                                                                                       |
| Multi-channel blend | Viv `XRLayer`                                   | **Superseded** by Canvas2D additive compositing                                                         |
| JPEG XR             | WASM decoder                                    | **Dropped**                                                                                             |
| CSV                 | papaparse                                       | Not adopted; not a dependency. CSV parsing is hand-written; `metrics_summary.csv` is not read           |
| Workers             | Decode pool                                     | TIFF decode pool (≤ 4), Zarr decode pool (≤ 3), DuckDB, Visium HD matrix and Feature Slice              |
| State sharing       | URL hash                                        | As planned                                                                                              |
| Tests               | Vitest + Playwright, golden fixtures            | Vitest + Playwright; fixtures generated in tests; `fake-indexeddb` for the byte-range cache             |
| Persistent cache    | OPFS or IndexedDB                               | IndexedDB byte-range LRU (256 MiB, 20,000 entries, 8 MiB per entry)                                     |

## Risks And Mitigations

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
