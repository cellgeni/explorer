# Optimization Pass

- [ ] Tune interaction performance, memory pressure, fetch/decode concurrency,
      and rendering cost without changing product behaviour. Planned
      2026-11-25: [Plan](#plan-2026-11-25).

Work recorded so far: vendor chunk groups (React, deck.gl, DuckDB-WASM, spatial
I/O, codecs) cut the entry chunk from about 1.26 MB to about 427 kB; heavy
readers are lazy-loaded; and the structural refactor in
[the refactor record](../engineering.md#application-structure-and-refactor-record) is complete.

## Plan (2026-11-25)

Planned 2026-11-25, after the
[code review](feature-fix-pass.md#code-review-2026-11-19-to-2026-11-24)
closed. The pass takes the open items about speed, memory and requests,
measures each one, and fixes those the numbers bear out. What the user sees
does not change, except where a task says so. The user answered the plan's
three questions the same day ([Answered Questions](#answered-questions)).

The plan rests on a code map made on 2026-11-25 at `73d1ba7`, cited below as
`file:line`; line numbers drift as the code changes. Sizes are for one
developer: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

### Rules

- **Measure before changing.** Each task records a baseline on the setup it
  names, and the same numbers after the change. A task whose baseline shows
  no problem closes with its measurement and no code.
- **Same results.** Values, colours and drawn pixels stay the same. Each PR
  shows it with a test where one can (identical arrays, identical images of a
  fixture), or with a comparison in its description where none can.
- **Production builds.** Profile `vite build --minify false` builds with
  `scripts/profile-load.mjs` ([Profiling](../../profiling.md)), alternating
  the base and the branch, three runs or more each, and report ranges.
- **Drawing on the GPU.** Time drawing in Playwright's `chromium` channel
  with `--use-angle=metal`. SwiftShader takes seconds per frame on a large
  dataset and hides the change. Say which was used.
- **Local data.** Serve data with `scripts/range-server.mjs`, with
  `--delay 300` where request rounds matter. Hosted datasets are read only
  as agreed ([Answered Questions](#answered-questions)): to confirm the
  largest changes.
- **A guard with each fix.** Where it is cheap, a test keeps the gain: a call
  or request count, a size limit, a worker that must be used.
- **One PR per task**, recorded in this file with its numbers, as the
  [worker moves](#worker-moves-2026-11-13) were.

### Current State

Read from the code at `73d1ba7`; nothing here was timed unless it says so.

Rendering and interaction:

- **An expression batch restyles every cell, twice per read.** Starting a
  read sets its status to loading (`useViewportDataWorkflow.ts:392`), which
  clears `geneExpressionActive` (`App.tsx:1316`, `:5410`); the end of the
  read sets it again. Each change makes a new styler, which packs a colour
  for every cell with a string lookup per cell (`ViewerCore.tsx:983-995`,
  `cellPointStyle.ts:150`), builds the layer's fill and line colours in a
  second pass (`cellPointStyle.ts:183`), and deck.gl uploads both again.
  Above 500,000 cells a settled zoom reads again once 50,000 cells or fewer
  are in view (`geneExpressionLod.ts:116-166`).
- **Outlines are rebuilt for each batch.** The expression style returns a new
  outline array (`cellBoundaryRenderer.ts:358`, `App.tsx:1321-1328`), so
  ViewerCore rebuilds the outline geometry, the cell filter and deck.gl's
  tessellation (`ViewerCore.tsx:1073-1140`). The flag above also turns the
  fill on and off, which rebuilds the geometry twice per read.
- **The first overview draw passes over every cell about ten times.** For
  the Xenium demo's 1.4 million cells, on the main thread: objects from the
  worker's columns (`hyparquetCells.ts:316-357`), point objects
  (`cellPointRenderer.ts:236-272`), three extent passes
  (`useViewerLayerData.ts:214`, `ViewerCore.tsx:366`, `:754`), two maps and a
  set of every ID (`App.tsx:1449`, `ViewerCore.tsx:1042`,
  `useCellQueryModel.ts:588`, the last built with Cell Query closed), then
  colours, ranks, geometry and filter values. The 2.3–3.0 s first render
  measured on 2026-11-12 came before the worker moves and has not been
  measured since.
- **Hovering transcripts renders App on every pointer move.** Each move over
  a transcript or a density square, which tile the view, sets App state to a
  new object (`ViewerCore.tsx:1840-1869`, `App.tsx:5504`). Cell, bin and
  outline hovers stay in ViewerSurface. Each settled view also renders App
  twice: once for a viewport cell count that nothing reads
  (`useAppDomainState.ts:557`), and once for a new viewport detail object
  (`useViewportDataWorkflow.ts:221`). `App.tsx` has 5,927 lines, and
  ViewerCore is not memoised (`ViewerCore.tsx:273`).

Requests:

- **Range reads have no timeout** except in the H5 worker (120 s, three
  tries, `h5RangeFile.ts:90-150`). Four other timeouts are separate copies
  (`datasetFactory.ts:2140`, `h5adDataset.ts:3787`,
  `datasetCollection.ts:381`, `examplesIndex.ts:181`), and two of them stop
  timing once the headers arrive, so a stalled body is not covered. Zip
  entries (`cachedZipStore.ts:89`), the Zarr and Icechunk stores
  (`zarrStores.ts:60`, `icechunkStore.ts:233`), hyparquet's reads, and TIFF
  tiles and tags (`tiff/loader.ts:2709`, `remoteTiff.ts:43`) have none.
- **Cancelling a load does not stop its reads.** `cachedSpatialDataset`
  takes no signal (`datasetFactory.ts:1926`), and neither do `overview()`,
  `readBinnedOverview()`, `summary()` or `visiumSummary()`, and
  `useDatasetLifecycle.ts` calls them without the load's signal.
- **A pyramidal OME-TIFF opens in about 24 request rounds.** Only geotiff's
  chain of IFDs must be read in order. Our code reads the eight decode tags
  one after another (`tiff/loader.ts:2015-2028`), the tile offsets before
  their byte counts (`:3115`), and the description before the SubIFDs
  (`:305`, `:426`), and opens the other channel files only after the first
  has opened (`morphologyImage.ts:106`, `:467`).
- **QPTIFF auto-contrast reads its tiles one at a time**
  (`morphologyContrast.ts:94-108`, up to 64 tiles), about 15 s per channel
  against EBI ([Phase 13](13-qptiff.md#known-gaps)).
- **Other chains on load:** Visium HD bin sizes probed one at a time
  (`datasetFactory.ts:1616`); a `bytes=0-0` probe and then hyparquet's
  `HEAD` for the same file (`datasetOverview.ts:42-61`); AnnData Zarr obs
  columns, and their codes, categories and colours, read one after another
  (`h5adDataset.ts:3632-3720`), as are embeddings (`h5adDataset.ts:1114`,
  `analysisEmbeddings.ts:99`) and a Xenium gene's three reads
  (`gex.ts:1042-1090`).
- **Xenium nucleus outlines wait for the cell outlines**, since both query
  one DuckDB client (`xeniumDataset.ts:304-389`): about 6 s later, cold
  ([Phase 17](17-xenium-nucleus-boundaries.md#known-gaps)).
- **A failed Zarr decode worker is started again** for OME-Zarr tiles and
  SpatialData labels: the flag that stops using workers lives in
  `workerZarrCodecs.ts:38-43`, not in the pool (`zarrDecodePool.ts`).
- **OME-Zarr chunks read over HTTP are not kept in IndexedDB**
  (`zarrStores.ts:52-94`); only zip ranges, TIFF tiles and Parquet footers
  are.

Main thread:

- **AnnData table code:** `uniqueNames` builds two sets and a map of every
  name even when none repeats (`h5adDataset.ts:5160`); colouring by a gene
  rebuilds a map of every cell on each call (`h5adMatrixForCells`, `:4377`);
  numeric columns are copied to number arrays (`:5289`). Measured on the
  460-plex zip on 2026-11-13: about 240 ms for unique IDs, 110–145 ms for 20
  numeric columns, 110 ms for distinct values, and 230–270 ms for one gene's
  CSR scan on the SpatialData Visium table.
- **Visium HD positions and barcode mappings** are read as one object per row
  on the main thread (`visiumHdOverview.ts:282-340`,
  `visiumHdBarcodeMappings.ts:152-204`); the positions decoded for about
  0.6 s in short tasks (2026-11-17).
- **CSV files** named by `annotationUrl=` (up to 100 MB) and embedding CSVs
  are parsed there, character by character (`customAnnotations.ts:528`,
  `analysisEmbeddings.ts:459`).

Memory:

- **Kept for the session:** one H5 worker per matrix file (`gex.ts:107`) and
  per Feature Slice file (`visiumFeatureSlice.ts:57`), each with a block
  cache of up to 128 MiB; transcript Zarr metadata (`transcriptZarr.ts:181`);
  cell-ID arrays (`gex.ts:112`); zip folders with up to four inflated entries
  of 32 MiB each (`zipFolder.ts:67`). TIFF files and pyramids keep the last
  two to four (`tiff/loader.ts:196`, `:611`, `:1075`), but are not tied to a
  dataset.
- **`dispose()`** exists only for Xenium, which closes its DuckDB client, and
  H5AD, which closes its H5 worker. Visium HD, Visium, SpatialData, MERSCOPE
  and Atera have none.
- **No ceiling.** Budgets scale with `navigator.deviceMemory` for tiles and
  cell caps only (`performanceBudget.ts:45-64`). Each channel's tile cache
  is sized when it opens (`MorphologyCanvas.tsx:455-459`), so eight channels
  opened in turn hold up to 346 tiles on the balanced budget of 120.
  DuckDB has no `memory_limit` (`duckdb.ts`). Telemetry is the tile cache's
  eviction count and Chrome's main-thread heap in debug details; workers,
  WebAssembly heaps and the GPU are not counted.

Start-up:

- **The start screen fetches 2,749 kB of JavaScript (887 kB gzip)** in 41
  files, up from about 2.3 MB (745 kB gzip) on 2026-11-16 (`vite build` at
  `73d1ba7`). The entry chunk is 1,140 kB. By its source map it holds panels
  that open on demand, in minified kB: Cell Query (66), Browse Store and
  Browse File (55), Plots (47) and Screenshot (28).

### Scenarios

Measured at the start of the pass as the baseline, and again by the tasks
that touch them.

| #   | Scenario                                                  | Data                          | Measures                                |
| --- | --------------------------------------------------------- | ----------------------------- | --------------------------------------- |
| S1  | The start screen, at 10 Mbit/s and 150 ms                 | None                          | JavaScript fetched; time to the form    |
| S2  | Load to the first overview draw                           | Xenium-shaped, 1.4M cells     | Main-thread time, longest stretch, heap |
| S3  | Colour by a gene, then five zoom steps and a pan          | Xenium-shaped, 1.4M cells     | Main-thread time per settled view       |
| S4  | S3 with cell outlines on                                  | Xenium-shaped, 1.4M cells     | Main-thread time per batch              |
| S5  | Move the pointer over transcripts for 5 s                 | Xenium demo, hosted (as S9)   | App renders                             |
| S6  | Load, then colour by a gene                               | H5AD, 1M cells                | Main-thread time by module              |
| S7  | Open a pyramidal OME-TIFF with `--delay 300`              | Four-channel OME-TIFF         | Requests and time to the first tile     |
| S8  | Open ten datasets in turn                                 | Fixtures and the above        | Live workers; page and worker heaps     |
| S9  | S2 to S4 and S6 on hosted data, with the user's agreement | Xenium demo, 460-plex, QPTIFF | As above                                |

### Tasks

M0, measuring:

- [x] **O1. Scenarios and tools.** (M) Built in
      [#433](https://github.com/cellgeni/explorer/pull/433).
  - `scripts/profile-load.mjs`: the GPU channel (`--gpu`), scripted zoom
    and pan steps after the load (`--steps`), further datasets opened in
    turn (`--then`), the page's and workers' JavaScript heaps, and the
    count of live workers.
  - `scripts/range-server.mjs`: a request log, and options that stall or
    fail a share of requests, for O7.
  - The baseline: S1 to S8, three runs each,
    [recorded below](#baseline-2026-11-25).
- [x] **O2. Synthetic data at scale.** (M) Built in
      [#435](https://github.com/cellgeni/explorer/pull/435) as
      `scripts/make_scale_data.py`, which writes, outside the repository:
  - a Xenium-shaped output of N cells (1.4 million by default):
    `experiment.xenium`, `cells.parquet`, the cell-feature matrix as Zarr
    and H5, cell and nucleus outlines, and a four-channel pyramidal
    OME-TIFF;
  - an H5AD of N cells with `obsm/spatial`, an embedding, 20 numeric and 6
    categorical obs columns, and a sparse `X`.
  - Not run in CI, like the other fixture scripts. The fixtures today hold
    at most 40,000 cells (`writeLargeFeatureBarcodeMatrix`,
    `src/test/h5Fixtures.ts:58`), and the costs above show from about
    500,000.

M1, interaction:

- [x] **O3. Patch colours per expression batch.** (M) Keep a base colour
      array per cells and colouriser, and one for cells without expression.
      For a batch, copy the right one and write only the batch's cells,
      through the cell index ViewerCore already builds; the layer's fill
      and line colours the same way. Both restyles of a read become copies.
      Bins (Visium HD) and datasets with repeated IDs keep the full pass.
  - A fast-check test: the patched arrays equal the full pass for random
    cells, batches and colour modes.
  - Measure S3.
  - Built in [#478](https://github.com/cellgeni/explorer/pull/478):
    [Expression Colours Written Per Batch](#expression-colours-written-per-batch-2026-11-27).
- [x] **O4. Colour outlines without rebuilding them.** (M) ViewerCore takes
      the unstyled outlines and applies expression colours as colour
      attributes only. The geometry, the cell filter and the tessellation
      are kept per outline array, and turning the fill on or off does not
      rebuild the geometry. App keeps its styled list for its other uses
      (`App.tsx:1363`, `:3474`).
  - Tests: the colour attributes equal today's, and a batch builds no
    geometry.
  - Measure S4.
  - Built in [#439](https://github.com/cellgeni/explorer/pull/439):
    [Outlines Coloured By ID](#outlines-coloured-by-id-2026-11-25).
- [x] **O5. Fewer passes before the first overview draw.** (M) One extent
      pass, reused; the ID maps built when first needed (outlines, a hover,
      Cell Query opening); ranks with filter values, and colours with layer
      colours, in one pass each; points packed from the worker's column
      arrays rather than from two rounds of objects.
  - Measure S2 first, since the 2026-11-12 numbers came before the worker
    moves.
  - The ID maps built in [#437](https://github.com/cellgeni/explorer/pull/437):
    [Cell ID Maps Built On First Use](#cell-id-maps-built-on-first-use-2026-11-25).
  - The cell objects and the extent built in
    [#468](https://github.com/cellgeni/explorer/pull/468):
    [Overview Cells In Fewer Passes](#overview-cells-in-fewer-passes-2026-11-26);
    the ranks and colours were measured and left.
- [x] **O6. App renders on hover and on settling.** (S) Pass a transcript
      hover to App only when the hovered object changes; the tooltip still
      follows the pointer, and the diagnostics dump reads the latest hover
      from a ref. Remove the unread viewport cell count, and keep the
      viewport detail when nothing in it changed. Then measure whether
      memoising ViewerCore saves renders.
  - A test counts App's hover updates over repeated moves on one
    transcript.
  - Measure S5 with the React Profiler.
  - Built in [#440](https://github.com/cellgeni/explorer/pull/440):
    [App Renders On A New Hover](#app-renders-on-a-new-hover-2026-11-25).
- [x] **O22. Outlines read as columns.** (S–M) Found by the baseline (S4):
      the outline query returns a row per vertex, about a million for the
      view where outlines first show, and each becomes an object on the
      main thread (`result.toArray()`, `xeniumDatasetReaders.ts:318`;
      `parseBoundaryRow`, `xeniumDatasetRows.ts:85`). Read the result's
      columns as typed arrays and cut them into rings by cell instead.
  - Tests: the same outlines as today from a fixture's rows.
  - Measure S4.
  - Built in [#436](https://github.com/cellgeni/explorer/pull/436):
    [Outlines Read As Lists](#outlines-read-as-lists-2026-11-25).

M2, requests:

- [x] **O7. One fetch with a timeout and retries.** (M) A wrapper in
      `src/data/` for every range read listed above, replacing the four
      timeouts. Each attempt ends after a time with no bytes, headers or
      body; network errors, timeouts, 408, 429 and 5xx are tried again with
      back-off; a 4xx or the caller's abort is not. The H5 worker moves to
      it. DuckDB's own reads cannot be wrapped. A stalled request is now
      tried again after 30 s with no bytes, three attempts in all
      ([Answered Questions](#answered-questions)).
  - Tests with a fake fetch that hangs, fails, or stalls mid-body.
  - Measure with range-server's stall option.
  - Built in [#441](https://github.com/cellgeni/explorer/pull/441):
    [Range Read Timeouts And Retries](#range-read-timeouts-and-retries-2026-11-26).
- [x] **O8. Cancelling a load stops its reads.** (M–L) A signal through
      `cachedSpatialDataset`, `overview()`, `readBinnedOverview()`,
      `summary()` and `visiumSummary()`. A shared read is aborted only
      when all its callers have aborted, as `utils/sharedLoad.ts` does.
  - Measure with `--delay 300`: open one fixture, switch to another, and
    count the first one's requests after the switch.
  - Built in [#443](https://github.com/cellgeni/explorer/pull/443):
    [Cancelled Loads Stop Their Reads](#cancelled-loads-stop-their-reads-2026-11-26).
- [x] **O9. Fewer rounds when a TIFF opens.** (S–M) Read the decode tags
      together, the tile offsets with their byte counts, and the SubIFDs
      with the description; open the other channel files as soon as the
      OME-XML names them.
  - A test counts reads on a SubIFD fixture.
  - Measure S7.
  - Built in [#446](https://github.com/cellgeni/explorer/pull/446):
    [TIFF Opens In Fewer Rounds](#tiff-opens-in-fewer-rounds-2026-11-26).
- [x] **O10. QPTIFF auto-contrast reads its tiles together.** (S) Fetch 4–6
      tiles at a time, passing `upcoming` so that neighbours share a
      request, and sample them in order, since each tile's first sample
      depends on the one before (`tileSamples.ts:26`). The samples and the
      contrast stay the same.
  - A test with a delayed fake loader.
  - Measure on the 19-plex tonsil through the mirror (S9).
  - Built in [#449](https://github.com/cellgeni/explorer/pull/449):
    [Auto-Contrast Reads Tiles Together](#auto-contrast-reads-tiles-together-2026-11-26).
- [x] **O11. Shorter chains on load.** (M, one PR per group)
  - Probe every Visium HD bin size at once. Built in
    [#469](https://github.com/cellgeni/explorer/pull/469):
    [Shorter Request Chains On Load](#shorter-request-chains-on-load-2026-11-26).
  - Pass the probe's size to hyparquet, so it skips its `HEAD`. Not
    adopted: Chromium already answers that `HEAD` from its cache. The
    overview's reads waited for each other in that cache instead, and
    Parquet Range reads now skip it, in
    [#472](https://github.com/cellgeni/explorer/pull/472):
    [Parquet Range Reads Skip The HTTP Cache](#parquet-range-reads-skip-the-http-cache).
  - Read AnnData Zarr obs columns, and embeddings, a few at a time. Built
    in [#475](https://github.com/cellgeni/explorer/pull/475):
    [AnnData Zarr Arrays Read Together](#anndata-zarr-arrays-read-together).
    No embeddings are read one after another.
  - Read a Xenium gene's three arrays together, and read the next
    transcript tiles ahead, within the point limit
    (`transcriptZarr.ts:208`). The gene's arrays are read together in
    [#476](https://github.com/cellgeni/explorer/pull/476):
    [A Xenium Gene's Arrays Read Together](#a-xenium-genes-arrays-read-together).
    The transcript tiles read ahead are not adopted:
    [Transcript Tiles Read Ahead](#transcript-tiles-read-ahead-not-adopted).
  - Measure each with `--delay 300` on the `anndata-zarr`, `spatialdata`
    and `visium-hd` fixtures.
- [x] **O12. Nucleus outlines on their own DuckDB client.** (S–M) Started
      when nucleus outlines are first shown, closed by `dispose()`.
  - It costs a worker and a WebAssembly heap: measure both (S8), and the
    time to both outline types (S4).
  - Not adopted: tried in
    [#458](https://github.com/cellgeni/explorer/pull/458), where the cell
    outlines arrived 2.7–5.9 s later. The outline query changes it led to
    are in [#463](https://github.com/cellgeni/explorer/pull/463):
    [Xenium Outline Queries In Less Memory](#xenium-outline-queries-in-less-memory-2026-11-26).
- [x] **O13. The Zarr decode pool remembers a failed worker.** (S) After
      one fails, OME-Zarr tiles and SpatialData labels decode on the main
      thread without starting new workers, as the codecs already do.
  - A test counts worker starts.
  - Built in [#457](https://github.com/cellgeni/explorer/pull/457):
    [Failed Zarr Decode Workers Stay Failed](#failed-zarr-decode-workers-stay-failed-2026-11-26).
- [x] **O14. OME-Zarr chunks in the IndexedDB cache.** (M) Measure a second
      load first, from a host that sends validators and from one that
      does not; skip if Chromium's HTTP cache already serves it. Chunks
      would be versioned by the store's metadata, and share the cache's
      256 MiB with TIFF tiles.
  - Built in [#460](https://github.com/cellgeni/explorer/pull/460):
    [OME-Zarr Shard Ranges Kept Across Loads](#ome-zarr-shard-ranges-kept-across-loads-2026-11-26).

M3, main thread:

- [x] **O15. AnnData table code, in place.** (S–M) `uniqueNames` returns
      early when no name repeats; `h5adMatrixForCells` keeps its row and
      gene maps in the cache; `sparseVectorCell` stops allocating per cell
      (`h5adDataset.ts:4897`); numeric columns stay typed arrays where
      their callers allow; distinct values are counted when the annotation
      list asks for them.
  - Measure S6, and the 460-plex zip through the mirror (S9).
  - Built in [#480](https://github.com/cellgeni/explorer/pull/480):
    [AnnData Tables Read In Place](#anndata-tables-read-in-place-2026-11-27).
- [x] **O16. Visium HD positions and barcode mappings in a worker.** (M) As
      for the Xenium overview: columns from a worker, not one object per
      row. Remove the whole-file mapping read nothing calls
      (`visiumHdBarcodeMappings.ts:124-150`). Look at the 2 µm
      `barcodes.tsv.gz` parse (`visiumHdBarcodes.ts:38-145`) too.
  - Built in [#484](https://github.com/cellgeni/explorer/pull/484):
    [Visium HD Tables Read In A Worker](#visium-hd-tables-read-in-a-worker-2026-11-27).
- [x] **O17. A gene's CSR scan off the main thread.** (M) For an H5AD read
      by the H5 worker, use its `matrix-cells` request
      (`h5FileMessages.ts:110`) rather than reading the matrix into the
      page (`h5adDataset.ts:4097`, `:4205`). For AnnData Zarr, decide after
      O15's numbers.
  - Built in [#485](https://github.com/cellgeni/explorer/pull/485):
    [A CSR Matrix Kept In The H5 Worker](#a-csr-matrix-kept-in-the-h5-worker-2026-11-27).
- [x] **O18. Large CSV files in a worker.** (S) Time both parses at a
      million rows, and move them to a worker if either blocks for more
      than 200 ms. The two `parseCsvRows` read quotes and delimiters
      differently, so merging them is not part of this task.
  - Built in [#PR](https://github.com/cellgeni/explorer/pull/PR):
    [CSV Files Parsed In A Worker](#csv-files-parsed-in-a-worker-2026-11-27).

M4, memory:

- [ ] **O19. Release what a dataset opened.** (L) A registry in
      `datasetCache.ts` of resources opened for a dataset URL, released when
      no viewer, preview or cache holds that URL any more. It covers the
      caches kept for the session above and the TIFF files. Visium HD,
      Visium, SpatialData, MERSCOPE and Atera get a `dispose()`. The
      full-file Feature Slice path, which only tests use, goes
      (`visiumFeatureSlice.ts:56`, `:196-219`).
  - A test: releasing the last holder ends the workers.
  - Measure S8.
- [ ] **O20. Memory telemetry.** (M) Each cache reports its bytes, entries
      and workers, and Data access notes shows the total. A ceiling is
      decided from these numbers
      ([Answered Questions](#answered-questions)). Candidates: one tile
      budget across channels, a DuckDB `memory_limit`, and a cap on H5
      workers.

M5, start-up:

- [ ] **O21. Load panels when they open.** (S–M) Cell Query, Browse Store
      and Browse File, Plots and Screenshot load on first use, with the
      message that a lazy chunk already shows after a deploy.
  - A test keeps them out of the entry chunk, as
    `tests/config/viteConfig.test.ts` keeps `h5wasm` out of the vendor
    groups.
  - Measure S1.

### Baseline (2026-11-25)

Measured on `3b7e942` (main), with the tools from
[#433](https://github.com/cellgeni/explorer/pull/433) and the synthetic data
from [#435](https://github.com/cellgeni/explorer/pull/435) at its default
size, served by `scripts/range-server.mjs` on the same Mac (M3). Production
builds without minifying, except S1's; Playwright's Chromium drawing with
the GPU (Metal), except S1, which draws nothing. Three runs of each; ranges
over the runs. "Busy" is main-thread time in the phase; "longest" the
longest stretch without idle time; memory is the page's JavaScript heap and
ArrayBuffer memory, and the workers' together. S5 and S9 need hosted data
and come later.

| Scenario                                   | Time      | Busy (ms)   | Longest (ms) | Requests            | Page memory    | Workers       |
| ------------------------------------------ | --------- | ----------- | ------------ | ------------------- | -------------- | ------------- |
| S1 Start screen, 10 Mbit/s and 150 ms      | 1.8 s     | 103–151     | 78–113       | 43, 0.9 MB          | 11 MB          | None          |
| S2 Xenium load, outlines off               | 0.2–0.3 s | 1,406–1,533 | 1,109–1,201  | 225–235, 47–56 MB   | 724–1,014 MB   | 4, 154–185 MB |
| S3 Colour by `M03a`                        | 1.3–1.6 s | 505–618     | 172–210      | 183–193, 101–109 MB | 1,108–1,122 MB | 7, 187 MB     |
| S3 Zoom steps 1–5 and a pan, each          | 3 s       | 116–286     | 0–115        | 0–27, ≤ 13 MB       | 1,124–1,307 MB | 8, 175–362 MB |
| S4 Step 3, where outlines first show       | 3.3–3.4 s | 2,258–2,362 | 2,007–2,137  | 77, 82 MB           | 2,173–2,221 MB | 9, 302–358 MB |
| S4 Step 4                                  | 3.0–3.1 s | 1,568–1,754 | 1,223–1,251  | 16, 8 MB            | 2,153–2,170 MB | 9, 385–450 MB |
| S4 Step 5                                  | 3 s       | 736–777     | 494–516      | 9, 4 MB             | 2,397–2,405 MB | 9, 391–456 MB |
| S6 H5AD load                               | 2.9–3.1 s | 1,249–1,277 | 504–541      | 105, 199 MB         | 1,054–1,073 MB | 1, 210 MB     |
| S6 Colour by `M03a`                        | 1.1–1.2 s | 1,048–1,113 | 1,033–1,097  | None                | 1,437–1,444 MB | 1, 210 MB     |
| S7 Four-channel OME-TIFF, 300 ms a request | 7.1 s     | 612–699     | 94–111       | 52, 5.5 MB          | —              | —             |
| S8 First of ten datasets                   | 0.3 s     | 594–651     | 145–176      | —                   | 214–225 MB     | 7, 193–210 MB |
| S8 Tenth (the 1M-cell H5AD)                | 3.6–4.1 s | 1,498–1,892 | 622–718      | —                   | 2,359–2,763 MB | 9, 384–391 MB |

What it shows:

- **The first overview draw** (S2) is a stretch of 1.1–1.2 s, 0.86 s of
  it app code (O5).
- **Expression reads** on 1.4 million cells kept the main thread busy for
  0.5–0.6 s when the gene was picked, in stretches of at most 0.21 s, and
  for at most 0.29 s per zoom step (S3). That is less than the Current
  State suggests, so O3 and O4 start by profiling where these go.
- **Outlines** cost the most: the step where they first show holds the
  main thread for 2.0–2.1 s, 0.9 s of it in DuckDB's JavaScript turning
  rows into objects (O22), and the page reaches 2.2–2.4 GB. The next zoom
  step holds it for 1.2 s.
- **Colouring the H5AD by a gene** is one stretch of 1.0–1.1 s, 0.75 s of
  it in `h5adDataset` (O15, O17).
- **The OME-TIFF** opens in about 23 rounds of 300 ms (O9).
- **Ten datasets in turn** leave 9–10 workers alive and the page at
  2.4–2.8 GB (O19). Each of the smaller datasets loaded in 0.6–1.2 s.

### Open Items Taken

Each task takes all or part of an item in [Open Items](../open-items.md).

| Open item                                                      | Tasks      |
| -------------------------------------------------------------- | ---------- |
| Every expression batch recolours every cell                    | O3, O4     |
| The Xenium demo blocks the main thread for up to 4 s           | O5         |
| Hovering transcripts sets App state on every pointer move      | O6         |
| Range reads have no timeout or retry                           | O7         |
| Cancelling a load does not stop the old dataset's reads        | O8         |
| SVS: a pyramidal OME-TIFF opens in about 24 rounds (part)      | O9         |
| QPTIFF: auto-contrast reads tiles one at a time (part)         | O10        |
| Xenium nucleus outlines drawn about 6 s after the cells (part) | O12        |
| OME-Zarr chunks are not kept in the IndexedDB cache            | O14        |
| Main-thread exceptions to the worker convention                | O15 to O18 |
| Per-URL caches that are never released                         | O19        |
| Memory ceiling with eviction telemetry beyond tile caches      | O20        |

### Order And Size

| Milestone        | Tasks         | Size           |
| ---------------- | ------------- | -------------- |
| M0 — Measuring   | O1, O2        | About 1 week   |
| M1 — Interaction | O3 to O6, O22 | About 2½ weeks |
| M2 — Requests    | O7 to O14     | About 3 weeks  |
| M3 — Main thread | O15 to O18    | About 1½ weeks |
| M4 — Memory      | O19, O20      | About 2 weeks  |
| M5 — Start-up    | O21           | 1–2 days       |

- M1 comes first: on a large dataset its costs are felt on every gene
  picked and every settled view.
- O7, O8, O13 and O21 need no synthetic data and can start with M0.
- O19 can run alongside M2 and M3. O20's ceiling waits for its numbers.
- The total is about 10½ weeks.

### Risks

| Risk                                    | Effect                                             | Mitigation                                                       |
| --------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| A patched colour array misses a cell    | Wrong colours                                      | The property test against the full pass; the full pass for bins  |
| Retries keep a dead host waiting longer | A failed load takes up to three timeouts to report | The activity log notes each retry; the last error reaches the UI |
| A second DuckDB client                  | More memory per Xenium dataset                     | Started only for nuclei, closed on dispose, measured (S8)        |
| Releasing a worker still in use         | A read fails                                       | Released only when no holder is left, keyed by dataset URL       |
| OME-Zarr chunks crowd out TIFF tiles    | More image requests on reload                      | Measured first (O14); a budget of their own if needed            |
| Synthetic data behaves unlike real data | A gain that does not carry over                    | The largest changes confirmed on one hosted dataset (S9)         |
| Lazy panels open more slowly            | A short wait on first open                         | Timed on first open; the chunks are small                        |
| Headless timings vary                   | Noise taken for a change                           | Builds alternated, ranges over three runs or more                |

### Not In This Pass

- SpatialData shapes by viewport: spatialdata-io writes `shapes.parquet` as
  one row group with no bounding-box column
  ([Phase 10](10-spatialdata.md#known-gaps)).
- Cellpose's stripped masks decode bands as wide as the slide for each view.
  The file layout causes it, and a tiled mask would not
  ([Phase 25](25-imported-segmentations.md#known-gaps)).
- NDPI blocks decoded by the browser's JPEG decoder
  (`createImageBitmap`), a spike for after this pass
  ([Phase 19](19-ndpi.md#known-gaps)).
- MERSCOPE outlines by viewport, and its transcripts: features, not
  optimisations ([Phase 18](18-merscope.md#later)).
- Splitting `startDatasetLoad` and the large modules: the code-structure
  item, kept apart from behaviour work by the
  [refactor rules](../../../PLAN.md#refactor-rules-2026-06-07).

### Docs To Update

- This file: each task's numbers under a heading of its own.
- `docs/profiling.md`: the new options and the synthetic data script.
- `docs/architecture.md`: the fetch wrapper (O7) and dataset-owned
  resources (O19).
- `docs/plan/open-items.md`: closed items move here under Closed Open Items.
- `PLAN.md`: this pass's row.

### Answered Questions

The user answered the plan's three questions on 2026-11-25, each with the
proposed option.

1. **Data for measuring:** synthetic data first, then hosted data to confirm
   the largest changes. O2's script may fetch Python packages from PyPI
   through `uv` (`pyarrow`, `h5py`, `zarr`, `tifffile`). S5 and S9 load the
   Xenium demo from its bucket, and the 460-plex zip and the QPTIFF tonsil
   through the local mirror, in a headless browser.
2. **Timeouts (O7):** an attempt ends after 30 s with no bytes, and is tried
   again with back-off up to three times; then the error shows, as now. The
   H5 worker's 120 s becomes 30 s.
3. **A memory ceiling (O20):** telemetry first; the ceiling is decided from
   its numbers.

## Expression And Rendering Rework (November 2026)

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
      [4.5](../decisions.md#45-rendering--decision-two-canvases-decode-off-the-main-thread)).
      Cell-area colours now scale to the whole slide (`bf6ebc8`).
- [x] The expression status counts only cells with expression above zero as
      positive (`8d21186`).

## Worker Moves (2026-11-13)

Since 2026-11-13 h5wasm runs only in workers, the Xenium `cells.parquet`
overview and SpatialData shapes are decoded in workers of their own,
auto-contrast decodes and samples its tiles in them, and zarrita's decompressors
and string codecs run in the Zarr decode workers. What is still on the main
thread is an [open item](../open-items.md). The record below moved from that
item when the plan was split.

h5wasm for H5AD, the Xenium H5 fallback and the standard Visium matrix moved to
H5 file workers (2026-11-13). On the Xenium demo a Cell card's H5 fallback
(worker fetch, open in 1.35 s, first cell read in 1.2–1.3 s) left no main-thread
task over 50 ms. A first version that fetched on the main thread still left a
255 ms task joining the body and a 720 ms one after it. The Xenium
`cells.parquet` overview moved to a cells overview worker (2026-11-13). CPU
profiles of the demo's load to the first overview draw (production builds,
headless Chromium, two runs each): hyparquet code took 1.63–1.67 s of
main-thread time, in stretches of up to 861 ms, before the change; after it,
building the cells from the transferred columns takes 54–59 ms and nothing
before the overview commit runs over 156 ms. Read in the page (dev build), the
columns took 66 ms to receive and 107–180 ms to turn into cells, against 324–358
ms for the old per-row parse. Auto-contrast moved to workers (2026-11-13).
Profiles of the demo's load until its four channels are auto-contrasted (same
setup): the OpenJPEG codec took 540–559 ms of main-thread time, in stretches of
up to 634 ms, before the change, and none after it; the auto-contrast module
itself takes 23–44 ms. Read in the page (dev build), one focus channel went from
a 140–165 ms task to none, about 40 ms slower end to end for starting the
worker. zarrita's codecs moved to the Zarr decode workers (2026-11-13). CPU
profiles (unminified production builds, headless Chromium, one or two runs
each): colouring the SpatialData Visium table by a gene spent 291–304 ms in
blosc on the main thread before and none after; loading the SpatialData Xenium
table spent 227–231 ms decoding strings before and none after; and on the Xenium
demo, from load to a gene's colours, the codecs (47–50 ms) and zarrita's copy of
the cell IDs (one 124–127 ms task) left the main thread, which now spends 10 ms
in zarrita. On the heart H5AD reference, served locally, zarrita's main-thread
time while loading fell from 90–113 ms to 47–51 ms, and a 94–98 ms task went.
The table code that uses the decoded arrays still runs on the main thread, for
both H5AD backends: the CSR scan for a gene (230–270 ms on the Visium table) and
the per-cell metadata (about 200 ms for 73,579 cells). SpatialData shapes moved
to a worker (2026-11-13). Profiles of the 598,222-cell 460-plex zip loading
until the gene search is ready, served from a local mirror of the byte ranges
the app reads (unminified production builds, headless Chromium, two runs each):
the SpatialData dataset code and hyparquet took 4.7–4.8 s of main-thread time,
in stretches of up to 4.5 s, before the change, and 116–126 ms after it; the
loads finished in 15.4–15.8 s instead of 20.2–20.3 s, with pixel-identical
boundaries. Most of the old time was per-shape objects, not the WKB parse (1.3 s
in Node): with 600,000 shape objects and rings on the heap, building the id
`Map` took 1.5 s and matching the table rows 1.1 s, against about 150 ms for the
same `Map` in an idle page. The AnnData table code then took 5.9–6.4 s of the
same load (2026-11-13, profiled with GPU rendering so that drawing could not
overlap it): 2.6–2.7 s counting the distinct values of the `cell_id` and
`segmentation_method` string columns, and building a metadata object per cell
for every caller of `overview()`, which ran five times (0.6–1.4 s each, timed in
the page). The same work in an idle page takes about 100 ms: large `Set`, `Map`
and object builds are 10–25 times slower during the load. Now the count stops
past 10,000 distinct values, `overview()` is built once per placement with each
cell's metadata read when the Cell card shows it, SpatialData waits for the
table read rather than for `overview()`, and Atera reads its two overview
columns by row. `h5adDataset` takes 0.71 s, the longest busy stretch fell from
about 4.0 s to 0.43–0.51 s, and the load reached the gene search in 5.9–6.3 s
instead of 12.8–13.5 s, with the same Cell card and annotation sets. Categorical
columns now keep their codes instead of a label per row (2026-11-13), which took
15–18 ms for each of the six here: `h5adDataset` went from 719–725 ms to 639–643
ms. Still on the main thread: making the cell IDs unique (about 240 ms in one
task, a `Map` of all 598,222), converting numeric columns to number arrays
(110–145 ms over 20 columns), counting the distinct values of string columns
(about 110 ms), and the CSR scan for a gene.

## Range-Read Xenium H5 Fallback (2026-11-15)

The H5 file worker reads the Xenium `cell_feature_matrix.h5` fallback by HTTP
range instead of downloading it (`h5RangeFile.ts`, `rangeBlockCache.ts`). The
file is a node in h5wasm's file system whose reads come from synchronous range
requests, which a worker may make; SharedArrayBuffer is not an option because
GitHub Pages cannot send COOP/COEP. Emscripten's `createLazyFile`, which the
Visium HD workers then used, was not reused: it reads range support from
`Accept-Ranges`, which CELLxGENE's S3 and GEO hide from CORS, so there it
downloads the whole file; it aborts the wasm module on a failed request; and
it takes a 200 reply to a range request as the range. h5wasm ignores HDF5's
read status, so a failed range read came back as uninitialised values (or a
wasm trap for variable-length strings) in a test; the worker checks the range
file's errors after every h5wasm call, and gex.ts opens the file in a new
worker after a failed read. The block policy (64 KiB blocks, 1 MiB for a miss
away from earlier reads, doubling to 16 MiB for sequential misses) was chosen
by replaying h5py's read trace of the demo file: 4 requests for the barcodes and
`indptr`, 6–11 per ROI, and 47 for 10,000 cells spread over the slide, where
fixed 1 MiB blocks need 384. Measured in the browser pane against the demo
bucket, one run each, reads in table order (after the open, the whole file's
reads come from memory):

| Read                               | Whole file (before) | By range               |
| ---------------------------------- | ------------------- | ---------------------- |
| Open                               | 47.9 s              | 1.1 s                  |
| First cell (barcodes, `indptr`)    | 1.4 s               | 3.1 s (12 req., 14 MB) |
| ROI, 2,311 cells within 150 µm     | 0.2 s               | 2.4 s (10 req., 17 MB) |
| ROI, 10,000 of the cells in 500 µm | 0.7 s               | 2.2 s (9 req., 16 MB)  |
| 10,000 cells spread over the slide | 28.7 s              | 75 s (47 req., 403 MB) |

The values match h5py's for the cell checked. The first cell comes 4.2 s after
the request instead of 49.3 s. The slide-wide sample still reads almost every
chunk, and inflating them takes about 29 s either way: the whole sequence took
78.9 s whole and 83.8 s by range. Bytes already in the worker's 128 MiB block
cache are not fetched again, and nothing is kept across sessions: the IndexedDB
byte-range cache is asynchronous. MEMFS now keeps the bytes of a whole file
instead of copying them (`canOwn`), so the worker no longer holds two copies of
an H5AD or Visium matrix.

The Visium HD filtered matrices and `feature_slice.h5` moved onto the same
worker the same day, one per file, kept open for the session; the two
`createLazyFile` workers, created for each request, are gone. The worker reads
a feature slice's metadata and gene index once, and requests go to it one at a
time so that a request still waiting can be dropped when a viewer moves on.
Measured in the browser pane against the reference dataset, 16 µm bins, the
same inputs and identical values (one run each; times here varied with load on
the machine):

| Read                                   | Before | After  |
| -------------------------------------- | ------ | ------ |
| Matrix, 1,005-bin selection (first)    | 36.6 s | 19.0 s |
| Matrix, 648 bins nearby                | 26.0 s | 2.5 s  |
| Matrix, 1,240 bins elsewhere           | 62.9 s | 4.3 s  |
| Feature Slice, 3 genes (first)         | 4.7 s  | 3.4 s  |
| Feature Slice, same genes, moved view  | 2.6 s  | 0.16 s |
| Feature Slice, same genes, other view  | 2.5 s  | 0.12 s |
| Feature Slice, 3 genes with 2 new ones | 4.6 s  | 0.93 s |

Space Ranger's filtered-matrix barcodes are not in spatial order: the first
selection touched 709 of the 16 µm matrix's 1,182 chunks and fetched 120 MB of
its 122 MB (20 requests), so the first read is bound by bandwidth; later ones
fetch 0.4–0.6 MB from what the worker keeps. Replaying both files' read traces,
every read-ahead policy tried fetched the same 120 MB for that selection, and
the one in use needed the fewest requests. 2 µm stays bound by the network: a
6,400-bin read of the 236 MB matrix fetched 247 MB in 31 requests (29.6 s here)
and spent 12.3 s decoding, which an in-memory replay in Node puts at 12.5 s
with or without the range file; before, the same read took 58.8 and 50.5 s.
Its 3.4 million barcodes would take about 283 MB to keep indexed, so readers of
more than 2 million barcodes are built for each request, as before; the Xenium
demo's 1.4 million are kept.

### ROI Warm-Up Reads the H5 by Range (2026-11-16)

The ROI warm-up's gene sample and enriched-genes reference fall back to
`cell_feature_matrix.h5` again (`h5Fallback: 'range-read'`), now that it is
read by range. The fallback comes after a Range probe of the file: the worker
reads a whole file from a host that answers Range with 200, so there the
warm-up still stops at the Zarr matrix ("no matrix sample"). Measured on the
demo with Playwright (headless Chromium with GPU, one run each, the same
25-cell box drawn after the warm-up):

| Read                         | Before                   | After                 |
| ---------------------------- | ------------------------ | --------------------- |
| Warm-up H5 reads             | none                     | 35 req., 36.6 MB, 8 s |
| First ROI's genes            | 4.9 s (35 req., 36.6 MB) | 0.8 s (1 req., 1 MB)  |
| Its enriched-genes reference | 3.3 s                    | 71 ms                 |

An ROI drawn while the warm-up opens the file cancels the warm-up, which
stops its worker, and opens the file again: its genes took 4.5 s, and the
warm-up's 1 MB was spent for nothing.

## Bundle Check (2026-11-16)

A `vite build` at `bea26d2`, sizes from `gzip -c` in kB of 1,000 bytes. The
entry chunk is 764 kB, up from the 427 kB recorded above. `index.html` also
preloads `spatial-io-vendor`, 5.3 MB, so the start screen fetches 7.1 MB of
JavaScript (1,783 kB gzip) before any dataset is chosen. 3.7 MB of that
chunk's source is `h5wasm`, which inlines its WASM. The main thread imports
`h5wasm` only lazily (`visiumFeatureSlice.ts`), but the `spatial-io-vendor`
group in `vite.config.ts` puts it with zarrita, geotiff and hyparquet, which
the entry imports statically. A build with `h5wasm` taken out of that group
put it in its own lazy chunk and cut the start screen's JavaScript to
2.3 MB (753 kB gzip). Applied the same day; see
[Closed Open Items](#closed-open-items).

| Chunk preloaded by `index.html` | Raw      | Gzip     |
| ------------------------------- | -------- | -------- |
| `spatial-io-vendor`             | 5,317 kB | 1,244 kB |
| entry (`index`)                 | 764 kB   | 215 kB   |
| `deck-vendor`                   | 665 kB   | 189 kB   |
| `react-vendor`                  | 190 kB   | 59 kB    |

## JPEG 2000 Decode-Only WASM Build (2026-11-19)

`src/codecs/jpeg2000.ts` imported the default export of
`@cornerstonejs/codec-openjpeg` 1.3.0, `dist/openjpegjs.js`: OpenJPEG compiled
to JavaScript by wasm2js (the file defines its own `WebAssembly` object, and a
worker profile shows no WebAssembly frames). It now imports the package's
decode-only WebAssembly build: `decodewasmjs` (56 kB of Emscripten glue) and
`decodewasm`, whose `.wasm` Vite emits as an asset that each tile worker fetches
when it first decodes a JPEG 2000 tile. Under Node the glue reads the `.wasm`
beside itself, so Vitest decodes the fixtures in `src/test/fixtures/jpeg2000`
with the real codec.

In Node, saved 1024² Xenium DAPI tiles from the demo's
`morphology_focus_0000.ome.tif` decoded in 462 ms (615 kB, level 0) and
2,425 ms (1 MB, level 2) with the JavaScript build, and in 128 and 211 ms with
the WebAssembly one under the same load (67 and 99 ms on an idle machine). In
the app: production builds of `487a087` and the branch, Playwright headless
Chromium with the Mac GPU (Metal), the demo from the live bucket, five runs of
each build in turn. Each run loads the demo and then zooms and pans (wheel and
drag steps, waiting for tiles to settle after each). Tile requests are timed
from the pool's `postMessage` to the worker's reply on the main thread, so
they include queueing in the worker:

| Measure (ranges over runs)                         | Before       | After                    |
| -------------------------------------------------- | ------------ | ------------------------ |
| Load: 1024² focus tiles, median                    | 329–567 ms   | 58–69 ms                 |
| Load: auto-contrast samples per channel, median    | 290–522 ms   | 41–97 ms                 |
| Zoom and pan: 1024² tiles (~1 MB), median          | 1.20–1.51 s  | 130–141 ms               |
| Zoom and pan: 1024² tiles, p95                     | 1.68–2.90 s  | 154–169 ms (666 ms once) |
| Tile-worker CPU per JPEG 2000 decode (CDP profile) | 866–1,127 ms | 91–112 ms                |

The one 666 ms p95 came from a single 1.7 s reply while cell boundaries loaded
on the main thread. The first morphology tile is set by the network: its reply
came 6–28 s after navigation in either build, as the bucket's response times
varied between runs, and in the two runs of each that timed it, decoding took
0.26–0.33 s of that before and 0.06–0.07 s after. The main thread spent no
time in `codec-vendor` in any run of either build, since tiles and
auto-contrast decode in workers ([Worker Moves](#worker-moves-2026-11-13));
only the main-thread fallback, where workers are unavailable, still decodes
there.

Sizes from `vite build` and `gzip -c`, in kB of 1,000 bytes:

| Asset                 | Before (raw, gzip) | After (raw, gzip) |
| --------------------- | ------------------ | ----------------- |
| `codec-vendor`        | 693 kB, 196 kB     | 29 kB, 11 kB      |
| `tileDecode.worker`   | 965 kB, 297 kB     | 301 kB, 111 kB    |
| `openjpegwasm_decode` | none               | 255 kB, 84 kB     |

## Million-Cell Embeddings (2026-11-24)

Large H5AD and AnnData Zarr embeddings pan and zoom quickly since
[#403](https://github.com/cellgeni/explorer/pull/403). The main thread was
idle during pans; the GPU was not. AnnData has no render cap, so each frame
drew every point, and at the full view of the 1,025,329-cell GBM atlas
every point sat at the 5 px cap. Cells now sample down to the budget's cap
while the view moves and draw in full 200 ms after it stops. Above 20,000
points the full-view size cap shrinks by √(20,000 ÷ count), and doubles per
zoom level up to the usual cap, so close views do not change. GPU time per
draw at the full view (M3, Metal, 2× pixel ratio, 1400 × 900, timed with a
1-pixel `readPixels` before and after each draw):

| Build            | Panning | 200 ms after stopping | Redraw at rest |
| ---------------- | ------- | --------------------- | -------------- |
| Before           | ~170 ms | —                     | 170–210 ms     |
| Sampling alone   | 46 ms   | 173 ms                | 212 ms         |
| Point size alone | 48 ms   | —                     | 59 ms          |
| Both (#403)      | 18 ms   | 43 ms                 | 46 ms          |

## Outlines Read As Lists (2026-11-25)

Task O22, [#436](https://github.com/cellgeni/explorer/pull/436). The cell and
nucleus outline queries returned a row per vertex, about a million for a
view of 40,000 cells, and each row became an object on the main thread
through Arrow's row proxies (`result.toArray()`), then was parsed
(`parseBoundaryRow`) and gathered by cell. At S4's outline step, a CPU
profile put about 1 s in Arrow's per-row accessors and 0.23 s in
`parseBoundaryRow`, in one 1.6 s stretch. DuckDB now gathers each outline's
vertices into lists in its worker, and the main thread reads one row per
outline (`parseBoundaryRingRow`), taking each list's typed array from its
Arrow vector
([Viewport Cell Boundaries](../../modalities/xenium.md#viewport-cell-boundaries)).
How the lists are gathered changed again in
[Xenium Outline Queries In Less Memory](#xenium-outline-queries-in-less-memory-2026-11-26).

Measured on the synthetic 1.4M-cell folder (O2), served locally, with
unminified production builds of main (`3b7e942`) and the branch,
alternating, three runs each, with GPU drawing and the profiler from O1, a
7 s profile per zoom step:

| Step                   | Main: busy / longest         | Branch: busy / longest     | Page memory                  |
| ---------------------- | ---------------------------- | -------------------------- | ---------------------------- |
| 3: outlines first show | 2,452–2,736 / 1,947–2,501 ms | 1,127–1,434 / 848–1,086 ms | 1,756–1,789 → 1,552–1,638 MB |
| 4: next zoom           | 1,146–1,186 / 882–902 ms     | 730–872 / 410–484 ms       | 1,977–2,005 → 1,735–1,818 MB |

- **Same results.** Run through DuckDB-WASM in Node on the folder's outline
  files for a 700 µm box, the old and new queries gave the same 7,235
  outlines and 180,875 vertices in the same order. Screenshots of both
  builds at the two zooms where outlines show were byte-identical.
  Requests were the same: 56 and 3.
- **The first test to run DuckDB itself**,
  `src/datasets/xeniumBoundaryQueries.test.ts`, checks the grouping,
  vertex order and nucleus numbering against the real SQL.
- **What remained** of step 3's stretch was mostly deck.gl cutting the new
  outlines into triangles and building their geometry (O4).

Lead: reading each row's lists still takes about 200 ms at the outline
step, in Arrow's per-row `get`; reading the list columns whole would avoid
it.

## Cell ID Maps Built On First Use (2026-11-25)

Task O5, first part, [#437](https://github.com/cellgeni/explorer/pull/437).
A CPU profile of S2's longest stretch, the Xenium load, found three
structures over every cell that the load itself reads none of:

| Structure                                 | Where                                  | Time   |
| ----------------------------------------- | -------------------------------------- | ------ |
| Map of overview cells by ID               | `App.tsx` `overviewCellById`           | 359 ms |
| Map of cell indices by ID                 | `ViewerCore.tsx` `cellIndexById`       | 108 ms |
| Set of placed IDs, with Cell Query closed | `useCellQueryModel.ts` `placedCellIds` | 74 ms  |

Each is first read later: on a hover or click, when outlines arrive, by an
annotation import, an embedding, or a Cell Query column. `lazyIdLookup`
(`src/data/lazyIdLookup.ts`) has `get`, `has` and `size`, builds its `Map`
on first use, and answers as `new Map(items.map(...))` did, the last of a
repeated ID winning. The three places use it.

Measured on the synthetic 1.4M-cell folder with outlines off, unminified
production builds of main (`3b7e942`) and the branch, alternating, three
runs each, with GPU drawing:

| Phase                     | Main: busy / longest         | Branch: busy / longest   |
| ------------------------- | ---------------------------- | ------------------------ |
| Load                      | 1,602–1,709 / 1,096–1,182 ms | 1,200–1,265 / 630–735 ms |
| First colouring by `M03a` | 337–344 / 166–171 ms         | 432–533 / 280–285 ms     |

- **The load's longest stretch** is about 0.45 s shorter, and every load
  gets that.
- **The first colouring by a gene** is about 0.11 s longer, all of it in
  `geneExpressionElementForCell`, which looks up each cell in the batch's
  style index by its ID. V8 hashes a string the first time it is a `Map`
  key and keeps the hash; the load's maps used to do that for every cell
  ID, and the first colour pass now does. Later colourings are unchanged.
  O3 would take the per-cell lookup out of the colour pass.
- **Same results:** both builds gave "Expression overview: 50,291 positive
  cells across 1,400,000 slide cells".

The rest of O5 is under
[Overview Cells In Fewer Passes](#overview-cells-in-fewer-passes-2026-11-26).

## Outlines Coloured By ID (2026-11-25)

Task O4, [#439](https://github.com/cellgeni/explorer/pull/439). Every
expression batch rebuilt the outlines from scratch:

- App restyled every outline, so ViewerCore got a new outline array for each
  batch, and rebuilt its geometry, packing the rings once for the paths and
  once for the fills. Turning the fill on or off rebuilt them too.
- deck.gl cut the fills into triangles twice, for the fill layer and for the
  hover hit-area layer, which also normalised every ring first.
- Every pan stop restyled the outlines 160 ms later, since ViewerCore
  coloured them only from the expression inside the last settled view.

Now each outline set has one set of rings and one set of triangles, shared
by the paths, the fills and the hit areas. The triangles are computed once
(`earcut` from `@math.gl/polygon`, which deck.gl already installs) and given
to deck.gl as `attributes.indices` with `_normalize: false`. The hit area
is a packed `SolidPolygonLayer` that maps a pick back to its outline by
index. Colours are looked up by outline ID in the expression index
ViewerCore already builds (`createCellBoundaryLayerStyle`), so their cost
depends on the number of outlines, and App passes the outlines as read.

Measured on the synthetic 1.4M-cell folder, unminified production builds
of main with O22 and O5's first part (`3b7e942` + #436 + #437) and the
branch, alternating, three runs each, with GPU drawing. The slide is
coloured by `M03a`, zoomed until outlines show, then `M05a` is added and
the view zoomed once more, each step profiled for 7 s:

| Step                          | Base: busy / longest         | Branch: busy / longest     | Page memory                  |
| ----------------------------- | ---------------------------- | -------------------------- | ---------------------------- |
| 3: outlines first show        | 1,564–2,002 / 1,040–1,264 ms | 1,323–1,569 / 868–1,005 ms | 1,609–1,648 → 1,268–1,283 MB |
| 4: a second gene, outlines on | 1,026–1,187 / 410–527 ms     | 479–537 / 112–260 ms       | 2,091–2,093 → 1,441–1,457 MB |
| 5: next zoom                  | 1,404–2,112 / 815–1,504 ms   | 719–812 / 174–226 ms       | 2,079–2,130 → 1,735–1,752 MB |

- **Same results.** Screenshots with the image off were byte-identical,
  except 22 minimap pixels that flip between two states from run to run in
  both builds. The same 12-point pointer path gave the same tooltips. A
  property test (`cellBoundaryStyle.property.test.ts`, 500 cases) checks
  the colour buffers against the old two passes.
- **Changed behaviour:** outlines outside the last settled view take their
  expression colour at once, rather than 160 ms after the view settles over
  them.

## App Renders On A New Hover (2026-11-25)

Task O6, [#440](https://github.com/cellgeni/explorer/pull/440). The viewer
reported a transcript hover to App on every pointer move, with the pointer's
position, so App and ViewerCore rendered once per move over one transcript.
Only the Transcripts section and the diagnostics dump read it, and neither
needs the position on every move. `useTranscriptHover` now returns the
current state for a hover over the same transcript or bin, so React skips
the render, and keeps the latest hover in a ref for the dump. App also
keeps its viewport detail when a report has the same box, cell count and
view (`sameViewportDetail`), and no longer stores the viewer's cell count,
which nothing read.

Measured with unminified production builds of main (`4fdf384`) and the
branch, each with a render counter (not in the PR), alternating, three runs
each, with GPU drawing. S5 is the hosted Xenium demo at zoom 5 with
transcripts on, the pointer moving every 40 ms for 5 s:

| Moves                              | Main: App / ViewerCore renders | Branch: App / ViewerCore renders |
| ---------------------------------- | ------------------------------ | -------------------------------- |
| About 100 moves on one transcript  | 100–101 / 100–101              | 1 / 0                            |
| About 100 moves across transcripts | 20 / 20                        | 20 / 20                          |

- **React's work** over one transcript fell from 331 ms to 60 ms per 5 s
  (one profile each). Main-thread totals barely changed, 1.8–2.2 s against
  1.8–2.4 s: about 1 s of the 5 s is deck.gl's picking reading pixels back
  on every move, in both builds.
- **S3** (the synthetic folder coloured by `M03a`, five zoom steps and a
  pan): App renders once less per step (3 → 2 before outlines load, 6 → 5
  on zooms that load more), and ViewerCore too. Main-thread time per step
  is within noise.
- **Memoising ViewerCore** was not done: in every render measured, at least
  one of its props had changed, so `React.memo` would have skipped none.

Leads:

- deck.gl's picking reads pixels back synchronously on each pointer move,
  about 1 s per 5 s of hovering.
- `estimateVisibleTranscriptsFromCells` takes 15–45 ms per settled view,
  even with no transcripts shown.

## Range Read Timeouts And Retries (2026-11-26)

Task O7, [#441](https://github.com/cellgeni/explorer/pull/441). Range reads
go through `fetchWithRetry` (`src/data/fetchRetry.ts`; [HTTP Requirements In
Code](../../architecture.md#http-requirements-in-code)). An attempt ends
when it has waited 30 s for bytes and its host has sent no bytes to any of
the page's requests in that time; timeouts, failed fetches, 408, 429 and 5xx
are tried again, three attempts in all; a body that stops part way resumes.
The H5 worker's synchronous reads follow the same rules, with a timeout of
30 s plus the time their bytes take at 256 kB/s.

A first version timed each request on its own. It would have cut and
retried healthy reads waiting in Chromium's queue, which sends at most six
HTTP/1.1 requests to a host at once; on 2026-11-18 the 460-plex zip queued
246 table chunk reads at 32 Mbit/s. So a request times out only once its
host has gone quiet as well, and the page and its workers tell each other
when a host sends bytes (a `BroadcastChannel`).

Measured with `scripts/range-server.mjs`'s faults on the synthetic data
([#435](https://github.com/cellgeni/explorer/pull/435)): production builds
of main (`0922724`) and the branch, alternating, GPU drawing. Each run had
a fresh server with the same seed for both builds, so both met the same
faults until their requests diverged. The run ends when the image's status
line (the four-channel OME-TIFF), the cell count (the Xenium folder, outlines
off) or the gene search (the H5AD) shows, or 20 s after an error does.

| Faults (share of range reads)     | Data          | Main                           | Branch                                   |
| --------------------------------- | ------------- | ------------------------------ | ---------------------------------------- |
| 10% held 90 s before the headers  | OME-TIFF      | 181 s, 201 s, not within 300 s | 83 s, 177 s; one run failed at 134 s     |
| 10% held 90 s after half the body | OME-TIFF      | 180 s, 181 s, not within 300 s | 63 s, 125 s; one run failed at 94 s      |
| 10% answered 503                  | OME-TIFF      | Failed in 5 of 5, at 0.5 s     | Loaded in 5 of 5, in 2.9–5.2 s           |
| 10% answered 503                  | Xenium folder | Failed in 5 of 5, at 1.5–1.8 s | Loaded in 2 of 5, in 5.1–5.7 s; 3 failed |
| 10% answered 503                  | H5AD (1M)     | Failed in 3 of 3, at 0.5 s     | Loaded in 3 of 3, in 2.7–3.0 s           |
| Every range read held 200 s       | OME-TIFF      | Waits                          | "Host not responding" at 93 s            |

- **The failed runs** had one read held or refused three times in a row,
  and the branch reported "Host not responding" or the HTTP status. At 10%
  a read fails three times in about 1 in 1,000, and these loads make 50 to
  250 range reads. Main waited out each held read, so a hold never failed
  its load; it only slowed it, past 300 s in one run of each.
- **With 20% of reads refused**, the OME-TIFF failed in 3 of 3 runs on both
  builds.
- **Without faults** the builds are the same within run-to-run noise, three
  runs each: the Xenium load (S2) and its first gene (S3), the H5AD load and
  gene (S6), and the OME-TIFF at 300 ms a request (S7, 7.1 s and 52
  requests on both). The wrapper itself took 0–5 ms of main-thread time on
  S2 and S6, whose large reads run in workers, and 15–20 ms on S7.

## Cancelled Loads Stop Their Reads (2026-11-26)

Task O8, [#443](https://github.com/cellgeni/explorer/pull/443). A dataset's
first read is a `sharedLoad`, aborted once every caller waiting on it has
cancelled: an AnnData table's arrays (H5AD, AnnData Zarr, Icechunk,
references, and the tables of SpatialData, MERSCOPE, Atera and Space Ranger
Visium), the MERSCOPE and Atera overviews, each Visium HD bin size's
overview, and opening the dataset in `DatasetCache`. The load passes its
signal to `getSpatialDataset` and to every read it makes before the dataset
is ready ([Caching](../../architecture.md#caching)).

The first runs left a SpatialData store's table reading after Cancel: its
image, which opens alongside the table, waited on the table for its units
without a signal, and kept the shared read going. The image is opened under
the signal of the callers waiting on it too.

Measured with `scripts/range-server.mjs --delay 300`: production builds of
main (`0922724`) and the branch, alternating, three runs each. Each run
opens a dataset from a link, presses Cancel once it has sent the requests
shown, and opens the fixture `anndata-zarr/tiny.v3.zarr` from another
server; the counts are the first dataset's requests sent after Cancel. The
Load button is disabled during a load, and a link change reloads the page,
so Cancel is how a load is stopped in place; a collection section or a view
change replaces a pending load the same way.

| Dataset (Cancel after)      | Main: requests after Cancel                 | Branch                         |
| --------------------------- | ------------------------------------------- | ------------------------------ |
| H5AD, 1M cells (5 requests) | 102, 197 MB, the last 34.6–34.8 s after     | None that reached the host (1) |
| AnnData Zarr fixture (8)    | 8, the obs columns, the last 2.5 s after    | None                           |
| SpatialData fixture (20)    | 7, table and shapes, the last 1.2 s after   | None                           |
| MERSCOPE fixture (6)        | None                                        | None                           |
| Xenium, 1.4M cells (20)     | 20, 27 kB: two zip directories, 3.7 s after | The same (2)                   |

1. The H5 file worker is ended on Cancel. Within 0.1 s of it, 8 requests
   for the two ranges it was reading appear and are cut at once, with no
   bytes.
2. Xenium's readers took the load's signal already. These are the zip
   directories of `cell_feature_matrix.zarr.zip` and `analysis.zarr.zip`,
   which zarrita's `ZipFileStore` reads without a signal.

The second dataset was ready 0.36–0.62 s after Cancel on both builds, as it
is served by another host. Loads that are not cancelled take the same time
and requests on both builds within run-to-run noise, three runs each: the
H5AD at full speed (2.8–3.2 s, 107 requests), and at 300 ms a request the
SpatialData (5.7 s, 59), AnnData Zarr (4.4 s, 16) and MERSCOPE (2.3 s, 17)
fixtures.

Not covered: the small first reads kept for reopening (a SpatialData store's
metadata, Atera's zip directory, gene list and cell details, an attached
image's header), Visium HD bin-size and LOD reads and the image-only
opening, which have no controller, and the reads of a Space Ranger MEX
matrix in its worker.

## TIFF Opens In Fewer Rounds (2026-11-26)

Task O9, [#446](https://github.com/cellgeni/explorer/pull/446). geotiff
reads a TIFF's header, each IFD, and each tag value its IFD's read leaves
out with a request of its own, and on main a pyramidal OME-TIFF made most
of them one after another. Now
([HTTP Requirements In Code](../../architecture.md#http-requirements-in-code)):

- `openRemoteTiff` reads on from the header's read to 64 KiB, and from a
  later shorter read to 16 KiB, and answers reads inside those from memory.
  tifffile and Bio-Formats write an IFD's tag values right after it, so the
  header's read takes in the first IFD with its tile offsets, byte counts and
  SubIFD list (54 kB of them in the Xenium demo's focus images), and a
  SubIFD's read its own (14 kB for their level 1).
- Reads of one file sent together skip Chromium's HTTP cache, which lets one
  request at a time use a URL's entry. On main a file's five SubIFDs, read
  together, came back 300 ms apart.
- An OME-TIFF's `.zchunkstore` lookups go out with its header read, Xenium's
  `morphology_focus/` folder included, rather than after its description.
- IFD 0's SubIFDs are read with its description, which Xenium writes at the
  end of the file, unless a sidecar found by those lookups gives the tiles.
- The decode tags are read together, and each level's tile offsets with
  their byte counts.
- The other files of a multi-file OME-TIFF open as soon as the first file's
  OME-XML names them, rather than once it has opened (up to the four files
  kept open).

`openRounds.test.ts` counts the round trips with a fake host that answers
the requests sent so far together: 2 rather than main's 4 for a SubIFD
pyramid, 2 rather than 5 with the description at the end, 1 rather than 3
with a sidecar, and 3 rather than 12–14 for a three-file OME-TIFF.

Measured as S7 with `scripts/range-server.mjs --delay 300`: production
builds of main (`cb953f68`) and the branch, alternating, three runs each, GPU
drawing, until the image's status line shows; then on the hosted Xenium demo
(its four focus files, 2.5–3.1 GB each, with a `.zchunkstore` at the dataset
root), at 10–100 ms a request from the Sanger network.

| Image                               | Main                                 | Branch                              |
| ----------------------------------- | ------------------------------------ | ----------------------------------- |
| S7, four-channel OME-TIFF, 300 ms   | 7.08–7.14 s, 52 requests, 5.5 MB     | 2.51–2.54 s, 40 requests, 6.0 MB    |
| S7, reads before the first tile (1) | 43 in 13 rounds; first tile at 6.6 s | 31 in 4 rounds; first tile at 2.3 s |
| Xenium demo focus image, hosted     | 1.02–1.54 s, 30 requests, 1.6 MB     | 0.57–0.58 s, 26 requests, 1.9 MB    |

1. One run each, timed from the first request to the data host. On the
   branch the 31 reads queue in Chromium, which sends six at a time over
   HTTP/1.1, so the four rounds take seven waits of 300 ms.

Main-thread time did not grow: 744–842 ms on main against 623–690 ms on the
branch for S7, and 574–900 ms against 550–600 ms on the demo. The reads
ahead add 0.5 MB on S7 and 0.3 MB on the demo; a first version read ahead
64 KiB from every short read and added 1.5 MB on S7.

Leads, not changed here:

- The demo's sidecar is turned into each channel's tile index on the main
  thread (`indexArrayChunks`, 120 ms). The branch's reads now finish before
  it, so the first tile waits for it.
- On both builds, each channel's smallest-level tiles are requested twice at
  once after the image opens, and four tile reads are cancelled and sent
  again 60 ms later. Their callers are not traced yet. The first is the
  canvas's read and auto-contrast's, now shared (O10,
  [below](#auto-contrast-reads-tiles-together-2026-11-26)).
- A file opened ahead of its channel's loader keeps reading after Cancel:
  the header, and the description when it is not in the header's read.

## Auto-Contrast Reads Tiles Together (2026-11-26)

Task O10, [#449](https://github.com/cellgeni/explorer/pull/449).
Auto-contrast fetches a TIFF channel's tiles six at a time while it samples
one, each fetch naming the eight tiles after it as `upcoming`, so that the
loader reads tiles stored back to back in one request. Tiles are still
sampled in order, in one worker, so the samples and the window are the same
([Auto-Contrast](../../modalities/image.md#auto-contrast)).

The first runs showed that the request count, not the order, set the time.
As a QPTIFF opens, the canvas and auto-contrast read the same coarsest
tiles, and a tile that one of them was reading was read again by the other,
unless a run had read it ahead: main read 27–28 tiles per channel for 18. A
tile fetched while another fetch reads it now waits for that request, and
takes its own copy of the bytes
([Fetching And Decoding](../../modalities/image.md#fetching-and-decoding)).

Measured on the tonsil QPTIFF (S-BIAD2491: 19 channels, 13 GB) through
`scripts/range-server.mjs --mirror` at 300 ms a request (S9): production
builds of main (`25ff4b4`) and the branch, alternating, three runs each,
with GPU drawing, until the six channels that are on have their
histograms. Main-thread time is from CPU profiles of three more runs each,
from the page's start.

| Measure                      | Main           | Branch         |
| ---------------------------- | -------------- | -------------- |
| Six channels auto-contrasted | 6.62–6.76 s    | 3.86–4.07 s    |
| Requests                     | 97–98          | 41–42          |
| Data                         | 29.2–29.3 MB   | 17.7–18.5 MB   |
| Main thread busy             | 1,420–1,537 ms | 1,101–1,330 ms |
| Longest stretch without idle | 146–166 ms     | 134–141 ms     |

- **Per channel.** Each channel's coarsest level is 18 tiles of about
  300 KB, stored back to back within each row of 3. The branch reads each
  tile once, in 6 requests, or 8 for DAPI, whose rows pass 1 MiB; main read
  27–28 tiles in 15–16 requests.
- **Time follows the request count.** Both builds open the file in 1.6 s
  with 3 requests. Chromium then sends six requests at a time to the host
  over HTTP/1.1, about 0.3 s for each six.
- **The same result.** The windows and the screenshots are the same on both
  builds.
- **One stall, not repeated.** In one branch run, the first after a
  rebuild, no request was sent for 15 s between the opening and the first
  tile. It did not recur in ten runs.
- **S7.** Main read both of each channel's smallest-level tiles twice at
  once: the canvas's read and auto-contrast's. The branch reads them once,
  and S7 takes 59 requests rather than 63 (one run each). One tile per
  channel is still cancelled as its read starts and sent again 20 ms
  later.

Leads:

- `computeChannelAutoContrast` sorts each channel's 234,000 samples on the
  main thread: about 110 ms of the 124–136 ms it takes over six channels,
  on both builds.
- When the canvas draws another level than the coarsest, as for a large
  image without a pyramid, six auto-contrast fetches per channel may queue
  ahead of its tiles. Not measured.

## Failed Zarr Decode Workers Stay Failed (2026-11-26)

Task O13, [#457](https://github.com/cellgeni/explorer/pull/457). Once a
Zarr decode worker fails, because its script did not load or it stopped, or
once one does not start, the pool starts no more until the page is
reloaded. It refuses later requests at once, without reading a tile's chunk
for a worker, so OME-Zarr tiles and SpatialData labels decode on the main
thread, as the codecs already did
([Decode Workers](../../architecture.md#decode-workers)). The label tracer
then reads and traces each chunk on the main thread alone. `terminate()`,
which Cell Query's measurer calls on close, is not a failure.

Measured on a synthetic OME-Zarr image (2 channels of 6,144 × 6,144
uint16, 512-pixel zlib chunks, 4 levels) with an OME-Zarr label image of
93,636 cells, opened with `segmentation=` and then zoomed in three steps.
The worker script answered 404, as for a tab left open over a deploy.
Production builds of main (`dbd672c`) and the branch, alternating, three
runs each, with GPU drawing, and the data from `scripts/range-server.mjs`
at 300 ms a request. Times run from a step's start to its last data
request.

| Measure                | Main           | Branch         |
| ---------------------- | -------------- | -------------- |
| Workers started        | 197–210        | 3              |
| Data requests          | 404            | 200            |
| Data                   | 81.6 MB        | 40.5 MB        |
| Load                   | 8.9–9.1 s      | 4.3–5.1 s      |
| First zoom step        | 9.2–9.3 s      | 4.6–4.7 s      |
| Second and third steps | 3.8–3.9 s      | 1.9–2.0 s      |
| Main-thread long tasks | 1,548–1,783 ms | 1,472–1,495 ms |

- **Each chunk was read twice.** On main, a tile's chunk was read for a
  worker that then failed, and read again for the main-thread decode. The
  branch's 200 requests are the 194 that working workers make, plus the
  first chunks sent to the three workers started before the first failure
  came back.
- **Without a delay**, main started 92–104 workers and the branch 3, with
  the same request counts.
- **Working workers are unchanged.** With the script served, both builds
  start 3 workers and make 194 requests, and at 300 ms a request both load
  in 4.0 s (one run each).
- **The same picture.** The screenshots match, and both builds draw 4,793
  outlines.

Lead:

- The TIFF tile decode pool (`src/workers/tileDecodePool.ts`) also starts
  a new worker for the next request after one fails. Not measured.

## OME-Zarr Shard Ranges Kept Across Loads (2026-11-26)

Task O14, [#460](https://github.com/cellgeni/explorer/pull/460). A second
load was measured first, with `scripts/range-server.mjs --validators`
(new: ETag, Last-Modified and 304s) and without:

- **Chunk files**, read with plain GETs: from a host with validators,
  Chromium's HTTP cache served every chunk, and the second load made no
  requests. Without validators everything was read again, but nearly all
  real hosts send them. Left to the HTTP cache.
- **Zipped stores** were already in the IndexedDB cache (`zarr-zip`).
- **Sharded arrays**: their range reads, shard indexes and inner chunks,
  skip the HTTP cache (`no-store`, since Chromium serialises and can
  truncate parallel Range requests to one URL), so every load read them
  again, from either host.

So only shard ranges were added, under `zarr-range`
([OME-Zarr](../../modalities/image.md#ome-zarr)). They are versioned by
the `HEAD` zarrita already sends for each shard's size, rather than by the
store's metadata: its size and validator name the shard's own version, as a
zip's `HEAD` does, at no extra request. A range of a file the store has not
sent a `HEAD` for is not cached.

Measured on a synthetic OME-Zarr image (2 channels of 6,144 × 6,144
uint16, 4 levels, file dates set to 2026-01-01), stored both as Zarr v2
chunk files and sharded (Zarr v3, 2,048-pixel shards of 512-pixel zstd
chunks). Production builds of main (`dbd672c`) and the branch, alternating,
three runs each, with GPU drawing, and the data at 300 ms a request. Each
run opens the image, zooms in three steps, then opens it again in the same
browser context, as a new tab would. Times run to the last data request.

| Sharded store, second load | Main        | Branch      |
| -------------------------- | ----------- | ----------- |
| With validators: requests  | 114         | 0           |
| Data                       | 32.4 MB     | 0           |
| Opening                    | 4.51–4.55 s | 2.96–2.97 s |
| Zoom steps                 | 2.19–4.10 s | 0.62–0.65 s |
| Without: requests          | 135         | 21          |
| Data                       | 32.4 MB     | 0           |
| Opening                    | 6.98–7.00 s | 5.36–5.41 s |
| Zoom steps                 | 2.52–4.42 s | 0.93–0.95 s |

- **Without validators**, the 21 requests are the shards' `HEAD`s and the
  metadata.
- **First loads are unchanged.** The builds make the same requests, and
  their times are within 0.1 s per step, slightly slower on the branch,
  which writes the ranges.
- **Chunk files** (main, one run each): from the host with validators, the
  second load's zoom steps settled in 76–96 ms rather than about 2 s;
  without, all 93 requests (32.1 MB) were made again.

Lead:

- SpatialData and AnnData Zarr stores read sharded arrays the same way,
  and are not cached. Not measured.

## Xenium Outline Queries In Less Memory (2026-11-26)

Task O12, [#463](https://github.com/cellgeni/explorer/pull/463). A DuckDB
client of their own for nucleus outlines was tried in
[#458](https://github.com/cellgeni/explorer/pull/458) and not adopted: the
cell and nucleus downloads then share the host, so the cell outlines, on by
default, arrive later. Remeasuring it led to two changes to the outline
queries, which help with one client
([Viewport Cell Boundaries](../../modalities/xenium.md#viewport-cell-boundaries),
[Nucleus Boundaries](../../modalities/xenium.md#nucleus-boundaries)):

- **Nuclei picked by their own vertices.** A nucleus is kept when the mean
  of its vertices is within the box ± 75 µm, the margin the cells' centroids
  get, so the nucleus query reads no `cells.parquet`. Vertices are read at
  least 75 µm beyond that, so no nucleus kept is cut short.
- **Vertex lists without an ordered aggregate.** Both queries gathered each
  outline's vertices with `list(vertex_x ORDER BY file_row_number)`, which
  took about 40 KB of DuckDB's memory an outline of 25 vertices: 128–256 MB
  for 5,000 outlines, where `{r, x, y}` structs sorted with `list_sort`,
  which give the same lists, need 16 MB. DuckDB-WASM has 3.1 GiB. Picking
  nuclei by their vertices groups about 73,000 at the demo's outline step,
  and with the ordered aggregate that query ran out of memory. On main, the
  demo's cell outlines run out at a `Boundary limit` of 100,000 (72,942
  cells); with the change they load in 10.8 s.

Measured on the demo (S9) with production builds of main (`946008c`), main
with the query changes, and main with the query changes and #458's second
client, alternating, three runs each, with GPU drawing. Each run opens the
dataset with `cellBounds=1&nucleusBounds=1` and zooms to the fourth step,
where outlines first show (66,835 cells). Times are the app's Log lines, from
the request to the outlines being ready. The bucket was slower than for the
first O12 runs, so the builds are compared with each other.

| Ready            | Main        | Query changes | Query changes, second client |
| ---------------- | ----------- | ------------- | ---------------------------- |
| Cell outlines    | 13.2–14.5 s | 10.9–12.5 s   | 14.5–16.8 s                  |
| Nucleus outlines | 23.1–25.3 s | 17.8–19.9 s   | 12.8–15.1 s                  |

- **The query changes.** Cell outlines are ready 1.5–2.8 s sooner than on
  main, paired run for run, and nucleus outlines 4.1–6.7 s sooner. Both
  queries read about the same bytes as before.
- **`cells.parquet` was not what delayed the cells.** On the 1.4M-cell
  folder at 300 ms a request, the second client read the `cells.parquet`
  ranges the cell query was reading, and Chromium's HTTP cache let one
  request per URL through at a time. On the demo, every build read 6
  `cells.parquet` ranges at the outline step; the cell queries of earlier
  steps had read the rest.
- **Shared host.** With the second client, the cells' 48–50 MB and the
  nuclei's 40 MB download together, so the cells arrive 2.7–5.9 s later
  than with one client, and 0.7–3.1 s later than on main. The nuclei arrive
  2.7–6.2 s sooner than with one client.
- **DuckDB alone.** In Node, with DuckDB-WASM 1.5.1 on the 1.4M-cell
  folder's local files and a box of 57,000 cells, the old nucleus query took
  3.0 s and the new one 1.0 s.

Tests: `src/datasets/xeniumBoundaryQueries.test.ts` runs both queries in
DuckDB on 5,000 outlines of 25 vertices under a 64 MB memory limit, which
the ordered aggregate runs out of on main, and picks nuclei that have no
row in `cells.parquet`.

## Overview Cells In Fewer Passes (2026-11-26)

Task O5, second part, [#468](https://github.com/cellgeni/explorer/pull/468).
After the ID maps
([Cell ID Maps Built On First Use](#cell-id-maps-built-on-first-use-2026-11-25)),
a CPU profile of the 1.4M-cell Xenium load (S2) put its longest main-thread
stretch at 0.67–0.80 s, on a machine running other work. Most of it was the
overview's cells built as objects twice, once from the worker's columns
(`cellsOverviewFromColumns`, 46–67 ms) and once for the layers
(`overviewCellsToLayerData`, 170–186 ms), and 192–207 ms of garbage
collection.

- **The layer objects** (`src/rendering/cellPointRenderer.ts`). Each of a
  cell's optional fields was spread into its literal as
  `...(x === undefined ? {} : { x })`, which made up to six objects a cell.
  They are now assigned when the cell has them, so no key is set to
  `undefined`, as before. The fill
  colour, which depends only on the cell's share of the largest transcript
  count, is one of 91 shared arrays rather than an array per cell. They are
  not frozen: a frozen array is another kind of array to V8, and with both
  kinds `packCellPointColors` took 52–67 ms against 12–34 ms.
- **One extent.** The viewer (`overviewCellsExtentBbox`) and the layer data
  (`overviewCellsToBbox`) each worked out the cells' extent, 12–29 ms a
  pass. `overviewCellsExtentBbox` keeps its result per cell array, and
  `overviewCellsToBbox` reads it.

Measured with unminified production builds of main (`9bd96a0`) and the
branch, alternating, three runs each, with GPU drawing. S2 is the synthetic
1.4M-cell folder served locally, outlines off, then coloured by `M03a`; S9
is the demo, coloured by `SNAP25`:

| Load                     | Main: longest | Branch: longest | Main: cell objects | Branch: cell objects | Main: GC   | Branch: GC |
| ------------------------ | ------------- | --------------- | ------------------ | -------------------- | ---------- | ---------- |
| S2, the synthetic folder | 766–796 ms    | 562–579 ms      | 170–186 ms         | 71–86 ms             | 192–207 ms | 142–148 ms |
| S9, the demo             | 463–735 ms    | 314–541 ms      | 172–193 ms         | 59–71 ms             | 154–174 ms | 108–126 ms |

- **Busy time** in S2's load fell by 145–243 ms, paired run for run. The
  demo's loads vary with the host, which the longest stretches show.
- **The first colouring by a gene** is unchanged: its longest stretch was
  314–345 ms on main and 307–357 ms on the branch in S2, and both builds
  gave the same expression line ("50,291 positive cells across 1,400,000
  slide cells"; on the demo, 231,404 across 1,414,155).
- **The first 30 s on the demo.** Profiled from the load until 28 s after
  the gene search is ready, two runs each, the longest stretch was 640–725
  ms on main and 569–597 ms on the branch, the first overview draw. The
  open item's stalls of up to 4 s are gone.
- **Left as they are:** the ranks (`cellPointRanks`, 26–28 ms) and colours
  (`packCellPointColors`, 12–34 ms, then `cellPointLayerColors`, 11–16 ms)
  take a pass each, too little to merge. Packing the points from the
  worker's columns, rather than building objects at all, would remove both
  object passes, but the overview's cell objects are read in 36 files.

Tests: `src/rendering/deckLayers.test.ts` checks that a cell's datum has
only the fields the cell has and that cells share their fill colour, and
`src/rendering/cellAggregation.test.ts` that an array's extent is worked
out once. Both fail on main.

## Shorter Request Chains On Load (2026-11-26)

Task O11, one PR per group of reads that waited for each other.

### Visium HD Bin Sizes Probed Together

[#469](https://github.com/cellgeni/explorer/pull/469). Detecting a Visium HD
folder probed its tiers one after another, three requests for 2 µm, then
8 µm, then 16 µm, and only then the eight segmented-output files
(`probeVisiumHdBins`, `datasetFactory.ts`): four rounds of requests. They
are now sent together, and their probes are still listed a tier at a time,
then the segmented outputs, so a detection error reads as before. A
manifest's own bins are still checked as listed, with the segmented outputs
probed alongside them
([Detection](../../modalities/visium-hd.md#detection)).

There is no Visium HD folder in the fixtures, and the hosted reference is
not among this pass's agreed data, so the probes were timed on a folder of
one-byte files under the probed names, served by `scripts/range-server.mjs`
at 300 ms a request. Production builds, three runs of each, alternating:
from the first request to the host, the last request under `*_outputs/`
ended at 3.68–3.70 s before and 3.07–3.09 s after. That server answers over
HTTP/1.1, so Chromium sends six requests at a time; a host on HTTP/2 takes
all seventeen at once, and saves about three round trips.

Test: `src/datasets/datasetFactory.test.ts` holds each output probe until
released and counts the rounds: four (3, 3, 3 and 8 requests) before, one
(17) after.

### Parquet Range Reads Skip The HTTP Cache

[#472](https://github.com/cellgeni/explorer/pull/472). The second group was
to give hyparquet the Range probe's size, so that it would not send a
`HEAD` for it. Built and measured, that saved nothing on hosts that send
validators, as nearly all do: Chromium answers the `HEAD` from the probe's
cached response (in 0 ms on the demo), so the footer read started as soon
either way. From the first request to the host it started at 163–174 ms
before and 170–224 ms after on the demo, and at 915–944 ms and 918–935 ms
on the synthetic folder at 300 ms a request. Only from a host without
validators did the footer read start a round trip sooner (1.22–1.24 s to
0.94–0.95 s, in single runs). It is not adopted.

Measuring it showed where the overview's time went. hyparquet asks for a
file's column chunks together, but Chromium's HTTP cache lets one Range
request to a URL through at a time, each when the one before has its
headers. On the demo the 14 reads of `cells.parquet` went out about 100 ms
apart, and at 300 ms a request the synthetic folder's 157 went one after
another. The Parquet readers' Range requests now skip the cache
(`cache: 'no-store'`, `rangeReadsWithoutHttpCache` in
`src/data/rangeFetch.ts`), as TIFF tiles, Zarr shards and zip ranges
already did. Their `HEAD`s keep it.

Production builds of the base (`96187ad`, #469) and the branch, alternating,
three runs each, with GPU drawing. Each run opens the Xenium dataset, then
opens it again in a second tab, and times the overview's reads of
`cells.parquet` (its `fetch` requests; DuckDB's are XHR) from the first
request to the host:

| Load                                                          | Base: first   | Branch: first | Base: second  | Branch: second |
| ------------------------------------------------------------- | ------------- | ------------- | ------------- | -------------- |
| Synthetic 1.4M-cell folder, 300 ms a request, with validators | 25.55–25.66 s | 9.11–9.25 s   | 25.55–25.57 s | 8.56–8.71 s    |
| Xenium demo, hosted                                           | 3.17–3.77 s   | 3.14–3.90 s   | 3.14–4.06 s   | 2.66–3.47 s    |

- **The demo** is limited by its host's bandwidth rather than by round
  trips, so the change shows at higher latency.
- **The HTTP cache** did not make a second load faster before, since
  Chromium answered few of the overview's Range reads from it. The range
  server answered 193 of a first load's 205 `cells.parquet` requests before
  and 202 after, and 154 of a second load's 219 before and 166–174 of
  198–224 after.
- **Not timed:** the other readers given the same fetch (SpatialData
  shapes, imported vector segmentations, Visium HD's overview and barcode
  mappings). Their fixtures have one row group each.
- **Checked on the way:** after the overview, DuckDB reads `cells.parquet`
  again, one request at a time: 2.4–4.3 s on the demo and 5.5–19.9 s at
  300 ms a request. That is the ROI warm-up's query for up to 5,000 cells
  in view; on the demo the Log's "ROI warmup cells ready: 5,000 in 2.9 s"
  matched a 2.87 s span of those reads. It is not the dataset's extent,
  which outlines wait for through `dataset.meta()`: DuckDB answers
  `readXeniumExtent`'s minima and maxima from the footer's statistics
  (`EXPLAIN ANALYZE` shows no scan). Reading the extent with hyparquet
  instead was tried, and outlines on a zoomed-in link came no sooner
  (15.9–17.4 s against 15.0–17.3 s on the demo, 17.0–17.4 s against
  17.0–17.1 s on the synthetic folder at 300 ms), so it is not adopted.

Test: `src/data/hyparquetCells.test.ts` checks that the overview's reads
over HTTP send their `HEAD` through the cache and their Range requests
past it, and fails on the base. `src/data/rangeFetch.test.ts` covers the
fetch.

### AnnData Zarr Arrays Read Together

[#475](https://github.com/cellgeni/explorer/pull/475). Opening an AnnData
table read its arrays one after another (`readH5adCacheFromGroup`,
`h5adDataset.ts`):

1. the obs index's values, then its mask;
2. the var index's values, then its mask;
3. the coordinates;
4. each obs column in turn, a categorical's codes and then its categories.

From a Zarr store each array is a request, so the tiny fixture took 11
rounds after its metadata. Now the obs and var indexes are read together,
and the coordinates with the obs columns. The columns are read four at a
time, in their order, and a column's arrays together. Where reads are
started together they are still awaited in their old order, so a broken
store reports the same error.

Production builds of the base (`a4341d6`, #472) and the branch,
alternating, three runs each, with the fixtures served by
`scripts/range-server.mjs` at 300 ms a request. From the first request to
the host, to the last; both builds sent the same requests:

| Store                                      | Base: rounds | Branch: rounds | Base: last request | Branch: last request |
| ------------------------------------------ | ------------ | -------------- | ------------------ | -------------------- |
| `anndata-zarr/tiny.zarr`                   | 12–13        | 5              | 4.08–4.14 s        | 1.66 s               |
| `anndata-zarr/stack.zarr`                  | 12–13        | 5              | 4.06–4.13 s        | 1.92–1.93 s          |
| `spatialdata/image_cells.zarr` (its table) | 14           | 7–8            | 7.23–7.25 s        | 4.73–4.74 s          |

The gene search was ready at 1.74 s rather than 4.15–4.20 s on the tiny
store, and at 2.90–2.95 s rather than 5.44–5.45 s on the SpatialData
store.

- **H5AD files** read the same way. Read with h5wasm, in memory or in the
  H5 worker, their reads are taken one at a time, so nothing changes; read
  through a kerchunk or Icechunk reference, each is a request, and they go
  together as from a Zarr store (not timed).
- **Embeddings** are not read one after another. The app asks for one
  kind at a time, and an AnnData table reads only that one.
- **Lead, not taken:** for Xenium and Visium HD the analysis CSV loader
  (`loadDatasetAnalysisEmbeddings`) ignores the kind asked for, and reads
  every kind's CSV in turn, UMAP then t-SNE. Reading them together would
  not show the view any sooner where the host's bandwidth is the limit;
  reading only the kind asked for would, but the view's list of kinds
  comes from what was read.

Test: `src/datasets/h5adDataset.test.ts` holds the tiny store's requests and
answers them a round at a time: its metadata takes 3 rounds, and took 11 on
the base.

### A Xenium Gene's Arrays Read Together

[#476](https://github.com/cellgeni/explorer/pull/476). Colouring by a gene
(`selectedGeneRowsFromCellFeatureMatrixZarr`, `gex.ts`) read the zipped
matrix's feature-major arrays one after another: each array's metadata,
then the gene's pointers, its indices and its data, then the cell IDs.
From the zip each read is two round trips, the entry's local header and
then its bytes, so one gene took 14 rounds.

- **Read together now:** the three arrays' metadata; the pointers, once
  for all the genes; a gene's indices and data; and the cell IDs,
  alongside the rest.
- **Genes are still read one at a time**, since neighbouring genes often
  share a chunk, which the byte-range cache then holds for the next.
- **The matrix's own arrays** (the cell IDs and the cell-major CSC arrays),
  which the warm-up opens at load, are opened together too.

Production builds of the base (`81fa44c`, #475) and the branch,
alternating, three runs each, with GPU drawing. Each run loads the Xenium
dataset, waits until its host has been quiet for 5 s, then colours by a
gene and times until the expression line shows:

| Data                                                 | Base        | Branch      | Base: rounds | Branch: rounds |
| ---------------------------------------------------- | ----------- | ----------- | ------------ | -------------- |
| Synthetic 1.4M-cell folder, 300 ms a request, `M03a` | 5.14–5.23 s | 2.53–2.87 s | 14           | 5–6            |
| Xenium demo, hosted, `SNAP25`                        | 2.62–2.65 s | 2.30–3.66 s | 14           | 1–2            |

- **The same reads:** both builds sent the same requests (16 on the
  synthetic folder, 14 on the demo) and coloured the same cells (50,291
  and 231,404).
- **The demo:** a round trip there is about 25 ms, so the chain cost about
  0.35 s of the 2.5 s, and the rest is the host's bandwidth and decoding.
  One base run there took 14.1 s, with 17 of the load's requests still in
  flight, and is left out.
- **Lead:** every read of a zip entry is two round trips, its local header
  and then its bytes (`@zarrita/storage`'s zip store). Reading the header
  with the bytes would halve the rounds of every zipped store.

Test: `src/data/gexZarrCache.test.ts` answers each open and read a round at
a time. Two genes take 7 rounds, and took 14 on the base.

### Transcript Tiles Read Ahead (Not Adopted)

Exact transcripts (`loadTranscriptZarrViewport`, `transcriptZarr.ts`) read
the viewport's tiles from `transcripts.zarr.zip` one after another. A
version read the next two tiles while one was filtered. It read ahead only
while every tile in flight could still add all its transcripts within the
point limit, from the grid's counts per tile, so no tile was read only to
be dropped at the limit.

It made no difference on the demo. Opened at a zoomed-in view (zoom 5,
with transcripts on), three alternating runs each:

- **Time:** the exact query took 7.1–8.1 s on the base (#476) and 7.3–8.3 s
  with the tiles read ahead.
- **Same reads:** both sent the same 244 requests and drew the same 2,741
  points.
- **Why:** one tile's arrays and chunks are already more requests than an
  HTTP/1.1 host's six connections take at once, so the next tile's only
  waited their turn.

On an HTTP/2 host it might help; that was not measured.

## Expression Colours Written Per Batch (2026-11-27)

Task O3. Each expression read made the cell points' colours twice, once when
it started and once when it ended (`geneExpressionActive`), and each time
`packCellPointColors` styled every cell with a lookup of its ID in the batch,
then `cellPointLayerColors` made the layer's fill and line colours from all
of them. On the synthetic 1.4M-cell folder that was 56–96 ms of each zoomed-in
view's main-thread time, for batches of 15–214 cells.

- **A batch writes only its cells** (`expressionCellPointColors`,
  `src/rendering/cellPointStyle.ts`). ViewerCore keeps the cells' colours
  without expression; a batch copies them, or an array of every cell in the
  zero colour once unmatched cells are styled, and writes its own cells
  over the copy, found by the cell index (`cellIndexById`).
- **The layer's colours** are written the same way: the base's fill and
  line colours are kept per opacity (`cachedCellPointLayerColors`), and a
  batch's copy recomputes only its cells.
- **The first batch takes the full pass.** V8 keeps a string's hash once it
  is first used as a Map key, and on 1.4 million cells that was most of the
  cost of building the cell index: 220–250 ms from IDs never looked up,
  60–90 ms after a full pass. Building it for the first batch made the
  first colouring 60–80 ms slower, so the index is built by the second
  batch, unless a hover, outlines or Cell Query built it first.
- **Still the full pass:** expression matched by bin position, and cells
  that share an ID, which a write by ID cannot match.
- **Memory:** the two base arrays and their layer colours, about 30 MB on
  1.4 million cells.

Measured with unminified production builds of main (`c1566d9`) and the
branch, alternating, three runs each, with GPU drawing, on the synthetic
folder coloured by `M03a`, then five zoom steps and a pan (S3, outlines
off; S4, outlines on). Colour work is the time in the colour passes and the
layer colours, from CPU profiles; on the branch it includes building the
cell index.

| Step                        | Main: colour work | Branch: colour work | Main: busy | Branch: busy | Main: longest | Branch: longest |
| --------------------------- | ----------------- | ------------------- | ---------- | ------------ | ------------- | --------------- |
| S3, colour by `M03a`        | 186–208 ms        | 179–252 ms          | 408–683 ms | 551–895 ms   | 288–323 ms    | 307–419 ms      |
| S3, step 3 (214 cells read) | 73–80 ms          | 91–105 ms           | 232–246 ms | 248–274 ms   | 81–92 ms      | 117–138 ms      |
| S3, step 4 (78 cells)       | 57–96 ms          | 2–4 ms              | 179–222 ms | 154–182 ms   | 60–67 ms      | 0–61 ms         |
| S3, step 5 (15 cells)       | 56–63 ms          | 0–28 ms             | 186–221 ms | 113–171 ms   | 57–80 ms      | 0–56 ms         |
| S4, step 3, outlines first  | 159–191 ms        | 84–88 ms            | 664–754 ms | 541–584 ms   | 460–550 ms    | 336–367 ms      |
| S4, step 4                  | 61–65 ms          | 4–15 ms             | 371–420 ms | 313–363 ms   | 112–137 ms    | 101–129 ms      |
| S4, step 5                  | 55–62 ms          | 4–16 ms             | 248–271 ms | 211–250 ms   | 62–97 ms      | 0–52 ms         |

- **The first colouring** takes one full pass on both builds, 170–250 ms
  of colour work; its busy time varies with shader compiles and garbage
  collection on both.
- **Step 3 builds the cell index** on the branch, 61–74 ms, so its colour
  work is 18–25 ms more than main's in S3. With outlines on (S4), main
  built the same index for the outlines at that step (80–114 ms, included
  above), and the branch builds it once.
- **Later steps** write their batch over a copy: 0–28 ms rather than 55–96
  ms of colour work.
- **The same colours.** Both builds gave the same expression lines, and
  the property test below compares every array with the full pass.

Tests: `src/rendering/cellPointStyle.property.test.ts` checks, for random
cells, batches, colour modes, bin sizes and opacities, that the colours and
the layer's fill and line colours equal the full pass's, and that a batch
after the first styles no cell.

## AnnData Tables Read In Place (2026-11-27)

Task O15. CPU profiles of the 1M-cell H5AD (S6) and of the 460-plex zip
through its mirror (S9), on the base of this task's PR, put the table's
main-thread work in four places:

- **Colouring by a gene** read every selected cell through the matrix's
  per-cell path (`h5adMatrixForCells`). It built a Map of every cell ID and
  a Set and a Map per cell, and returned each cell's genes as arrays, which
  `geneExpression` then added up. That was 0.84–0.99 s on S6 and 0.69–0.70 s
  on the 460-plex.
- **Counting the distinct values** of string obs columns took 0.90–0.98 s on
  the 460-plex: its 598,222 `segmentation_method` labels hold two values,
  and a Set hashes a string the first time it is used as a key. Compared
  with the label before, the same labels took 14 ms.
- **Number columns** were copied into number arrays, 67–145 ms a load.
- **Making the cell IDs unique** (`uniqueNames`), 0.23–0.28 s a load. Almost
  all of it is the Set of every ID, which only says whether any repeats.

What changed (`src/datasets/h5adDataset.ts`):

- **A gene's counts are summed row by row** (`h5adExpressionCounts`).
  `geneExpression` takes the selection as table rows, so it needs no ID
  lookups, and a CSR matrix, in memory or read by range, or a dense one in
  memory, is read straight into a sum per row (`CsrRowSums`). The sums keep
  the per-cell path's rules: a column stored twice in a row keeps its last
  value, and genes are added in the order asked. Other layouts, and a read
  of every gene, still take the per-cell path.
- **The per-cell path** (`matrix()`, Cell Query and the Cell card) keeps its
  maps of cell rows and gene columns per table rather than building them
  for each read, and its CSR rows reuse one Set and one Map rather than
  making two per cell.
- **Distinct values** are compared first with the 16 values already seen,
  and only then put in a Set (`DistinctLabels`).
- **Number columns** stay `Float64Array`s: a column read as one is kept, and
  others are copied once, with a loop for 64-bit integers.
  `Float64Array.from(values, Number)` took twice as long as the number
  arrays on the 460-plex.
- **`uniqueNames`** returns the names as they are when none repeats, which
  skips its second Set and its pass over the names. The Set that finds out
  is left, and is most of the time.

Measured with unminified production builds of the base (#478) and the
branch, alternating, three runs each, with GPU drawing: S6, then coloured by
`M03a`; and the 460-plex served from a local mirror of its EBI zip, coloured
by `GFAP`.

| Step                       | Base: busy     | Branch: busy   | Base: longest  | Branch: longest | Base: table work | Branch: table work |
| -------------------------- | -------------- | -------------- | -------------- | --------------- | ---------------- | ------------------ |
| S6, load                   | 1,176–1,278 ms | 1,034–1,143 ms | 367–473 ms     | 347–376 ms      | 315–349 ms       | 191–269 ms         |
| S6, colour by `M03a`       | 1,328–1,657 ms | 306–370 ms     | 1,290–1,616 ms | 285–343 ms      | 843–986 ms       | 113–130 ms         |
| 460-plex, load             | 2,999–3,511 ms | 1,988–2,268 ms | 888–1,088 ms   | 343–364 ms      | 1,318–1,360 ms   | 330–381 ms         |
| 460-plex, colour by `GFAP` | 3,277–3,571 ms | 2,050–2,502 ms | 1,078–1,266 ms | 1,040–1,230 ms  | 689–702 ms       | 217–260 ms         |

Table work is the time in the functions above, from CPU profiles: on a load,
counting labels, `uniqueNames` and the number columns; on a colouring, the
matrix read.

- **S6's colouring** is one stretch of 0.29–0.34 s rather than 1.3–1.6 s;
  the expression line shows 0.36–0.50 s after the click, against 1.39–1.85
  s, and the page holds 0.9 GB rather than 1.2–1.3 GB.
- **The 460-plex's colouring** still has a stretch of 1.0–1.2 s: deck.gl
  normalising the overlay's attributes for its 571,617 expressing cells
  (`_normalizeValue`, about 0.4 s) and garbage collection. Not this task's.
- **The same expression lines** on both builds: 28,988 positive cells across
  1,000,000, and 571,617 across 598,222.
- **For O17:** the CSR scan for a gene now takes 0.11–0.13 s on S6 and
  0.22–0.26 s on the 460-plex. Moving it to the H5 worker would save that
  much of one stretch.

Tests: `src/datasets/h5adExpressionCounts.property.test.ts` checks, for
random CSR tables (columns stored twice, NaN and negative values, 32- and
64-bit floats) and gene lists (repeated and missing genes), that the counts
equal the per-cell path's. `src/datasets/h5adObsColumns.test.ts` checks the
distinct-value counts around 16 values and the 10,000 limit, and that
number columns, 64-bit integers included, keep their values as typed
arrays.

## Visium HD Tables Read In A Worker (2026-11-27)

Task O16. To measure at the reference run's size without hosted data,
`scripts/make_scale_data.py --what visium-hd` now writes a Space Ranger 4
folder: 3,740,816 bins under tissue at 2 µm, 233,814 at 8 µm and 58,453 at
16 µm, with a 91 MB `barcode_mappings.parquet` (see
[Profiling](../../profiling.md#synthetic-data-at-scale)). CPU profiles of
the base of this task's PR put three long tasks on the main thread:

- **The load** decoded each tier's `tissue_positions.parquet` (700,569 rows
  at 8 µm) into one object per row with hyparquet: one stretch of 0.4–0.7 s,
  most of it in hyparquet's string decoding.
- **A bin's card** (Enter on the view) read the bin's row groups of
  `barcode_mappings.parquet` as objects and kept the bin's rows: one
  stretch of 0.67–0.81 s.
- **Zooming to the 2 µm bins** parsed the 3.7 million lines of
  `barcodes.tsv.gz`: one stretch of about 1 s, 0.56 s of it the parse.

What changed:

- **A worker reads the three tables** (`src/datasets/visiumHdTablesWorker.ts`,
  `src/workers/visiumHdTables.worker.ts`). It fetches and decodes the file,
  and sends back the positions' columns and the barcodes' rows and columns
  as transferred typed arrays, with their barcode strings. As with the other
  table workers, a read stays on the main thread when its caller passes a
  fetcher, a file, a row reader, compressors or a byte-range cache, where
  there is no `Worker`, and when the worker fails to start.
- **The positions are read as columns** (`readParquetColumns`, moved to
  `src/data/parquetColumns.ts` from the Xenium cells reader), not one object
  per row, on either thread.
- **A bin read gets the file's footer on the main thread**, once per
  dataset as before, and passes it to the worker with the row ranges to
  read. The worker reads those rows as columns and makes objects of the
  bin's rows only.
- **The whole-file mapping read is gone**, with the dataset method and the
  row budget control that led to it; `readVisiumHdBarcodeMappings` now
  requires the bins.

Measured with unminified production builds of the base (#480) and the
branch, alternating, three runs each, with GPU drawing, on the synthetic
folder served locally: the load, then the 2 µm button and seven zoom steps
(the seventh draws the 2 µm bins); and the load, then Enter.

| Step                      | Base: busy     | Branch: busy | Base: longest  | Branch: longest | Base: page | Branch: page |
| ------------------------- | -------------- | ------------ | -------------- | --------------- | ---------- | ------------ |
| Load                      | 850–944 ms     | 325–388 ms   | 405–710 ms     | 150–156 ms      | 46–51 MB   | 96–97 MB     |
| Bin card (Enter)          | 759–911 ms     | 85–149 ms    | 670–812 ms     | under 50 ms     | 193–205 MB | 104–105 MB   |
| Zoom step that draws 2 µm | 1,059–1,099 ms | 396–421 ms   | 1,009–1,040 ms | 332–340 ms      | 485–521 MB | 336–340 MB   |

- **The load** is ready in 0.35–0.39 s rather than 0.66–0.87 s. The page
  holds more just after it only until the next collection: 47–49 MB by the
  fifth zoom step, against 52–75 MB on the base.
- **The 2 µm step** still has a stretch of 0.33–0.34 s: receiving the 3.7
  million barcode strings (57 ms), making the overview (37 ms), and the
  view's tile index of the bins (`gridCellTileIndex`, about 100 ms) with
  garbage collection. The tile index is not this task's.
- **The same requests** on both builds: 53 (5.6 MB) for the load, 9
  (14.2 MB) for the card, and 2 (9.2 MB) for the 2 µm barcodes.

Tests: `src/datasets/visiumHdTablesWorker.test.ts` runs the worker's
handler across a structured clone against fixtures in
`src/test/fixtures/visium-hd/` (a `tissue_positions.parquet` in three row
groups was added): the worker's positions, bin mappings and barcodes match
the main thread's, typed arrays are transferred, errors keep their names,
and reads with a fetcher or byte-range cache stay on the main thread.

## A CSR Matrix Kept In The H5 Worker (2026-11-27)

Task O17. After O15 a gene's colouring of S6 scanned the 1M-cell CSR `/X`
on the main thread in 57 ms, inside one stretch of 0.19–0.21 s. `/X` was read
whole by the H5 file worker and sent to the page, which held its arrays.
The worker's `matrix-cells` request reads a 10x `/matrix` by barcode, so it
did not fit; three new requests do.

What changed:

- **The worker keeps a CSR `/X`** that it would have sent whole
  (`csr-keep`, `src/workers/h5FileCore.ts`), and the page's matrix becomes
  `csr-worker`, with only `indptr` in the page.
- **A gene's counts** are summed there (`csr-row-sums`), with the page's
  rules: `CsrRowSums` moved to `src/data/csrRowSums.ts` for both.
- **Plots' and the Python console's gene values** are scanned there
  (`csr-gene-values`, with `geneValuesFromCsr`).
- **A cell's genes** (Cell card, Cell Query) are read as slices, as for a
  matrix read by range; the worker answers reads of the kept paths from its
  arrays, without h5wasm.
- CSC and dense matrices, layers and `raw` are unchanged: a CSC gene is a
  slice, and layers and `raw` are already read by range.

Measured with unminified production builds of the base (#484) and the
branch, alternating, three runs each, with GPU drawing: S6, then coloured
by `M03a`. Profiling starts the colouring 3 s after the load; with a 10 s
wait the page's collection of the load's garbage happens first, as it would
before most clicks.

| Step                              | Base: busy | Branch: busy | Base: longest | Branch: longest |
| --------------------------------- | ---------- | ------------ | ------------- | --------------- |
| Load                              | 896–922 ms | 821–871 ms   | 311–333 ms    | 170–290 ms      |
| Colour by `M03a`, 3 s after load  | 208–219 ms | 211–247 ms   | 195–201 ms    | 152–169 ms      |
| Colour by `M03a`, 10 s after load | 209–223 ms | 155–195 ms   | 193–206 ms    | 94–129 ms       |

| Memory after colouring | Base   | Branch     |
| ---------------------- | ------ | ---------- |
| Page                   | 890 MB | 595–610 MB |
| H5 file worker         | 148 MB | 470–476 MB |

- **The scan** is 5 ms of page time rather than 57 ms. Three seconds after
  the load, the branch's colouring also collects the load's garbage (54–73
  ms), which the base had collected during its longer load.
- **The expression line** shows as soon: 0.22–0.25 s after the click,
  against 0.24–0.26 s, with the same 28,988 positive cells.
- **Memory moves** to the worker rather than growing: 1.04 GB in all after
  colouring on the base, 1.07 GB on the branch. The worker's WebAssembly
  heap, grown to decode `/X`, is not given back on either build.
- **AnnData Zarr is left as it is.** Its `X` is read in chunks, through a
  zip on the 460-plex, and its 0.22–0.26 s scan comes in batches as the
  chunks arrive; the colouring's long stretch there is deck.gl's
  (see [AnnData Tables Read In Place](#anndata-tables-read-in-place-2026-11-27)).
  Moving it would mean reading the store in a worker.

Tests: `src/datasets/h5adDataset.test.ts` reads a CSR H5AD by range through
the in-process worker and checks a gene's counts, gene values, the cells'
genes and the estimate, and that the page asked the worker to keep `/X` and
never read `/X/data` or `/X/indices` whole.

## CSV Files Parsed In A Worker (2026-11-27)

Task O18. At a million rows, in Node, an embedding's projection parsed in
0.46–0.66 s (`parseAnalysisEmbeddingCsv`, 32 MB) and an annotation file in
1.18–1.32 s (`parseCustomAnnotationImport`, 40 MB), both well over the
task's 200 ms. In the app, on the base of this task's PR:

- **Loading the synthetic Xenium folder's UMAP** (1.4 million rows, 42 MB,
  written for this measurement) was one stretch of 0.54–0.91 s, 0.32 s of
  it the parse.
- **Opening S6 with a 1M-row file in `annotationUrl=`** (`cell_id`, a
  20-class `cluster` and a numeric `score`, 31 MB) held the main thread for
  1.23–1.25 s at once, 0.70 s of it the parse.

What changed:

- **A worker parses both** (`src/data/csvTablesWorker.ts`,
  `src/workers/csvTables.worker.ts`), with the parsers unchanged. A worker
  is started for each file and exits once it has answered; where there is
  no `Worker`, or it fails to start, the parse runs on the main thread.
- **It sends columns back**: a projection's IDs and two `Float64Array`s, and
  each imported track's IDs and values, which the page makes into objects.
  In Node, receiving a million `{ cellId, value }` objects took 0.22–0.24 s
  on the main thread, and columns with the objects made from them 22–40 ms.
- **An annotation import is asynchronous**: it is dropped if another dataset
  opens while the file is parsed, and holds its file's name meanwhile, so a
  file whose name slugs alike is numbered apart. A parse error keeps its
  name, which the import's error message is chosen by.
- The embedding loader takes the parser as an option; the app passes the
  worker's, so the worker does not import the module that starts it.

Measured with unminified production builds of the base (#485) and the
branch, alternating, three runs each, with GPU drawing.

| Step                                    | Base: busy     | Branch: busy   | Base: longest  | Branch: longest |
| --------------------------------------- | -------------- | -------------- | -------------- | --------------- |
| S6 load with a 1M-row `annotationUrl=`  | 2,147–2,265 ms | 1,646–1,670 ms | 1,228–1,252 ms | 574–587 ms      |
| Xenium, Load Embeddings (1.4M-row UMAP) | 1,004–1,079 ms | 567–596 ms     | 538–911 ms     | 341–425 ms      |

- **Receiving** costs 25–29 ms of page time, and making the points 34 ms.
- **What is left is not parsing.** The import's stretch is mostly checking
  the file's IDs against the dataset's (`checkImportedCellIds`, 0.33 s for a
  million look-ups) and colouring by the new classes. The embedding's is
  mostly a Set of the 1.4 million point IDs that the status line makes
  (`embeddingPointIds`, 0.20 s).
- The page holds 778 MB after the import, against 967–972 MB, and 721–738
  MB after the embedding, against 919–933 MB.

Tests: `src/data/csvTablesWorker.test.ts` runs the worker's handler across a
structured clone: the projection's columns make the main thread's points,
missing headers are named, the import (with a formula-guarded label and an
empty value) equals the main thread's, a format error keeps its name, a
failed worker falls back, and an abort ends the worker.

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Other gaps found in the review:

- [x] Byte-range cache eviction read every cached range (2026-11-13). After
      each write, `evict` (`src/data/persistentByteRangeCache.ts`) called
      `getAll()` on the store, so the bytes of every cached range (up to 256 MiB)
      were deserialised on the main thread to add up their sizes. Database
      version 2 keeps each range's size and last access in a store of its own,
      indexed by access time, and the totals in one record: a write reads two
      small records and, over a limit, deletes ranges oldest access first from
      the index, in the same transaction. A read updates only the access time,
      where it rewrote the bytes. Version 1 ranges are dropped on upgrade. CPU
      profiles of the 460-plex zip loading until the gene search is ready
      (unminified production builds, headless Chromium, local mirror, two runs
      each): the cache module took 686–825 ms of main-thread time before, 624–745
      ms of it in `request.onsuccess` and up to 62–75 ms in one busy stretch,
      and 47–48 ms after, mostly copying the bytes it stores, with no more than
      6 ms in any stretch. Both builds cached the same 255 ranges (26 MB), and a
      second load read them from the cache.

Original-brief items with no outcome:

- [x] DuckDB ExternalFileCache evaluation. Checked 2026-11-12: the bundled
      DuckDB (v1.5.1) has it on by default (`enable_external_file_cache = true`,
      `validate_external_file_cache = VALIDATE_ALL`), and the app does not
      change it. DuckDB still reads Xenium boundaries, ROI cells, cell
      transcripts and gene expression. Measured the same day on the Xenium
      demo in headed Chromium, counting the DuckDB workers' requests over CDP,
      with the cache on and off:
  - Returning to a boundary viewport: about 107 requests and 103 MB of
    `cell_boundaries.parquet` (18–23 s) on every return with it off; 0–4
    requests and 0–6 MB (1.5–2.8 s) with it on, 0 from the second return.
  - Redrawing the same or an overlapping ROI box: 11 requests per query off,
    0 on (0.13–0.16 s). Opening the same Cell card again: 101 requests and
    95 MB off, 4 and 6 MB on.
  - `VALIDATE_ALL` costs no requests (one `HEAD` per file per instance). The
    app's IndexedDB cache is not in front of DuckDB, and Chrome's HTTP cache
    did not hold the 1.5 MB boundary ranges. Keep the default; each instance
    holds what it read (about 120 MB on the boundary instance) in its worker.
    The boundary and ROI instances stay separate, because each runs one
    query at a time and a cold boundary query took about 20 s (about 7 s
    since the FLOAT cast below).
- [x] Xenium boundary queries read nearly all of `cell_boundaries.parquet`
      (95–103 MB of 109 MB, even for one cell). Found and fixed 2026-11-12.
      `vertex_x`/`vertex_y` are FLOAT and the `BETWEEN ? AND ?` parameters
      DOUBLE, so DuckDB cast the column and pruned no row groups (36 of 36
      read where the statistics allow 13). The bounds are now cast
      (`BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)`, `betweenSql` in
      `src/data/gexSelection.ts`).
  - Measured on the Xenium demo in headed Chromium, counting the DuckDB
    workers' requests over CDP with the external file cache off: a cold
    Cell-card boundary query went from 103 requests, 96 MB and 25.1 s to 38
    requests, 35 MB and 7.1 s, with the same 27,337 rows.
  - The `transcripts.parquet` queries had the same mismatch (`x_location` and
    `y_location` are FLOAT; 7.1 GB in 2,117 row groups on the demo) and cast
    their bounds too: the ROI transcripts CSV, exact-point queries (cell IDs
    for Zarr points, or the points without a Zarr), the Parquet
    z-distribution fallback and `gexFromTranscriptsParquet`. The statistics
    allow 11 of the 2,117 row groups for a 300 µm box at the slide centre.
    The effect in the browser is not measured.
  - `cells.parquet` centroids are DOUBLE and are not cast. The cast is
    harmless on a DOUBLE column. In a DuckDB v1.5.1 test in Node, it still
    pruned (3.3 of 32.5 MB read with or without it). The bounds move by
    less than half a FLOAT step, under 1 nm below 32,768 µm. One of 17,843
    test rows lay in that sliver. On a FLOAT test file the same query read
    16.4 of 16.6 MB uncast and 1.7 MB cast, with the same rows.
- [x] Every Xenium demo load downloads the whole 433 MB
      `cell_feature_matrix.h5`: the ROI warm-up falls back from the
      feature-major Zarr matrix to the H5 file, which h5wasm reads whole. Seen
      on `main` (`f6dcb88`) on 2026-11-12. Traced and fixed the same day:
  - Cause: the viewport warm-up's 32-cell gene sample (`useRoiWorkflow`)
    went through `loadDatasetRoiGeneStats`, whose Zarr read throws without
    `csc/` arrays and then fell back to `gexFromCellFeatureMatrixH5`. The
    request's CDP initiator stack: `loadH5MatrixUncached` ← `loadH5Matrix` ←
    `loadRoiGeneStatsMatrix` ← `loadDatasetRoiGeneStats` ← the warm-up. The
    bucket sends no `Cache-Control` and Chrome did not keep the file (a warm
    profile downloaded it again), so every load paid the download (52–65 s
    here), a 1.3–1.7 s main-thread block when it ended (h5wasm copying the
    file into its file system and decoding 1.4 million barcodes), and the H5
    notice under Data access notes.
  - Fix: the warm-up's two reads pass `allowH5Fallback: false`. Where the Zarr
    matrix cannot serve the cells, `loadDatasetRoiGeneStats` throws
    `RoiGeneStatsH5FallbackSkippedError` instead of reading the H5, and the
    warm-up ends without the gene sample or the enriched-genes reference (the
    log says "no matrix sample"). Datasets with CSC arrays warm up as before.
    A drawn ROI, a cell and the Magic Lens still fall back, with the notice.
    On the demo the warm-up now takes 2.5 s with no H5 request; the first
    ROI's genes take about 52 s, the download the warm-up used to hide from
    an ROI drawn a minute or more after load. Since 2026-11-16 the warm-up
    reads the H5 by range ([above](#roi-warm-up-reads-the-h5-by-range-2026-11-16)).
  - Not done: reading cell rows from the feature-major Zarr. A cell's counts
    are spread over every gene's entries, so it means reading all of
    `indices`.

Found by the 2026-11-16 review:

- [x] The start screen preloaded `h5wasm` (2026-11-16). The
      `spatial-io-vendor` group in `vite.config.ts` put it, 3.7 MB of source
      with its WASM inlined, in one chunk with zarrita, geotiff and
      hyparquet, which the entry imports statically, so `index.html`
      preloaded it although the main thread imports `h5wasm` only lazily.
      Left out of every group, it builds into its own chunk (`hdf5_hl`,
      1,030 kB gzip) that loads on first import. The start screen's
      JavaScript fell from 7.1 MB (1,783 kB gzip) to 2.3 MB (753 kB gzip);
      in the browser it transferred 768 kB with no request for the chunk,
      and importing the chunk then wrote and read back an HDF5 file in
      144 ms. A test in `tests/config/viteConfig.test.ts` keeps `h5wasm` out
      of the groups. Workers bundle their own copy, as before.
- [x] The umbrella `deck.gl` package was a dependency but never imported
      (2026-11-16). The app imports the `@deck.gl/*` packages it uses
      directly. Removing it took 272 packages out of the lockfile, among
      them `@deck.gl/carto`, `geo-layers` and `mesh-layers`. The production
      audit (`npm audit --omit=dev`) went from 16 advisories (9 high) to
      one, `qs` through duckdb-wasm. The bundle did not change. `h5wasm` is
      pinned at 0.10.2, the version the lockfile already held, so every
      dependency is now pinned.
- [x] `npm audit` reported 22 advisories (8 high) once `deck.gl` was gone, all
      but `qs` in the dev tools (2026-11-16): Vite's dev server
      (`launch-editor`), Vitest's mock server, and minimatch, brace-expansion,
      postcss, nanoid, source-map-js, browserslist, undici and zod under ESLint,
      typescript-eslint, Vite and jsdom. Vite went from 8.0.12 to 8.3.8, Vitest
      and `@vitest/coverage-v8` from 4.1.7 to 4.1.12, ESLint from 10.3.0 to
      10.15.0 and typescript-eslint from 8.59.2 to 8.73.0, none a major version,
      and `npm audit fix` moved the rest within their ranges; `qs` and
      `side-channel` are the only runtime packages that changed, and neither is
      in the bundle. `npm audit` now reports none. Vite 8.3 folds 19 small
      shared chunks the start screen already preloaded into the entry (767 kB to
      852 kB, 216 kB to 243 kB gzip), so `index.html` preloads 18 files where it
      preloaded 37, and 745 kB gzip of JavaScript where it preloaded 754 kB. Two
      chunks that were not preloaded went into the lazy `h5adDataset` chunk and
      the workers, not the entry.
- [x] When a Zarr decode worker failed, its chunks decoded on the main thread
      with no notice (`workerZarrCodecs.ts`), and the pool started new
      workers for the next chunks, which failed the same way. With the worker
      script answering 404, as an old tab does after a deploy, the Xenium
      demo started 19 workers in 20 s of gene colouring, transcript density
      and zooming. Since 2026-11-17 the pool fails a worker's requests with
      `ZarrDecodeWorkerError`, unlike a chunk that does not decode, and after
      one the codecs decode on the main thread until reload: one worker
      start in the same session. Data access notes shows "Zarr decoding",
      which outlasts the dataset's notices, and the console has a warning.
      A chunk a worker cannot decode still goes to the main thread alone.
      OME-Zarr tiles and SpatialData labels use the same pool and still
      start new workers after a failure.

Closed by the pass's tasks:

- [x] Every expression batch recoloured every cell: `packCellPointColors`
      ran over all cells (`ViewerCore.tsx`), twice per read, and above
      500,000 cells expression is read by viewport, so on large Xenium
      datasets it ran on pan and zoom (O3 and O4). Outlines are coloured
      without being rebuilt since O4 (2026-11-25), and a batch after the
      first writes only its cells since O3 (2026-11-27): 0–28 ms rather
      than 55–96 ms a zoomed-in view on 1.4 million cells
      ([#478](https://github.com/cellgeni/explorer/pull/478))
      ([Expression Colours Written Per Batch](#expression-colours-written-per-batch-2026-11-27)).
- [x] The Xenium demo blocked the main thread for up to 4 s at a time in the
      first 30 s after load (O5, 2026-11-26). CPU profiles on 2026-11-12 put
      it on the load: hyparquet decoding `cells.parquet` (in a worker since
      2026-11-13), the first render with the overview layer build (2.3–3.0
      s), and the first JPEG 2000 decode (in workers since 2026-11-13). Over
      the first 30 s, the longest stretch is now 0.57–0.60 s, the first
      overview draw ([#468](https://github.com/cellgeni/explorer/pull/468))
      ([Overview Cells In Fewer Passes](#overview-cells-in-fewer-passes-2026-11-26)).
- [x] Hovering transcripts set App state to a new object on every pointer
      move, so App re-rendered as the pointer moved (O6, 2026-11-25). It
      now changes only when the hovered transcript does: App renders once
      for about 100 moves on one transcript, rather than about 100 times
      ([#440](https://github.com/cellgeni/explorer/pull/440))
      ([App Renders On A New Hover](#app-renders-on-a-new-hover-2026-11-25)).
- [x] Range reads had no timeout or retry (O7, 2026-11-26). On 2026-11-13, 3
      of 6 loads of the 460-plex zip from `ftp.ebi.ac.uk` had one or two
      range requests that took 55–90 s while the requests sent with them
      finished in under a second, and the load waited for them. They now go
      through `fetchWithRetry`
      ([#441](https://github.com/cellgeni/explorer/pull/441))
      ([Range Read Timeouts And Retries](#range-read-timeouts-and-retries-2026-11-26)).
      Not covered: DuckDB's own reads, the transcript zip that
      `@zarrita/storage` reads, the Visium HD nucleus mask read by geotiff's
      `fromUrl`, and whole-file reads such as CSV and matrix files.
- [x] Cancelling a load did not stop the old dataset's reads (O8,
      2026-11-26). After Cancel, a 1M-cell H5AD read on for 35 s, 197 MB,
      alongside the next load. A load's signal now reaches the dataset's
      shared first read and its requests
      ([#443](https://github.com/cellgeni/explorer/pull/443))
      ([Cancelled Loads Stop Their Reads](#cancelled-loads-stop-their-reads-2026-11-26)).
- [x] A pyramidal OME-TIFF opened in about 24 rounds of sequential range
      requests (O9, 2026-11-26, part of the SVS item). S7 opens in 2.5 s
      rather than 7.1 s at 300 ms a request
      ([#446](https://github.com/cellgeni/explorer/pull/446))
      ([TIFF Opens In Fewer Rounds](#tiff-opens-in-fewer-rounds-2026-11-26)).
- [x] QPTIFF auto-contrast read the coarsest level's tiles one at a time,
      about 15 s per channel against EBI (O10, 2026-11-26, part of the
      QPTIFF item). The six channels on at load are auto-contrasted in
      3.9–4.1 s rather than 6.6–6.8 s at 300 ms a request
      ([#449](https://github.com/cellgeni/explorer/pull/449))
      ([Auto-Contrast Reads Tiles Together](#auto-contrast-reads-tiles-together-2026-11-26)).
- [x] OME-Zarr chunks read over HTTP were not kept in the IndexedDB cache
      (O14, 2026-11-26). Chunk files come from Chromium's HTTP cache on a
      second load from a host that sends validators. A sharded array's
      range reads, which skip it, are now kept, and a second load of the
      test image makes no requests rather than 114
      ([#460](https://github.com/cellgeni/explorer/pull/460))
      ([OME-Zarr Shard Ranges Kept Across Loads](#ome-zarr-shard-ranges-kept-across-loads-2026-11-26)).
