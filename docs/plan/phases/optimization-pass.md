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

- [ ] **O1. Scenarios and tools.** (M) Built in
      [#433](https://github.com/cellgeni/explorer/pull/433).
  - `scripts/profile-load.mjs`: the GPU channel (`--gpu`), scripted zoom
    and pan steps after the load (`--steps`), further datasets opened in
    turn (`--then`), the page's and workers' JavaScript heaps, and the
    count of live workers.
  - `scripts/range-server.mjs`: a request log, and options that stall or
    fail a share of requests, for O7.
  - The baseline: S1 to S8, three runs each,
    [recorded below](#baseline-2026-11-25).
- [ ] **O2. Synthetic data at scale.** (M) Built in
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

- [ ] **O3. Patch colours per expression batch.** (M) Keep a base colour
      array per cells and colouriser, and one for cells without expression.
      For a batch, copy the right one and write only the batch's cells,
      through the cell index ViewerCore already builds; the layer's fill
      and line colours the same way. Both restyles of a read become copies.
      Bins (Visium HD) and datasets with repeated IDs keep the full pass.
  - A fast-check test: the patched arrays equal the full pass for random
    cells, batches and colour modes.
  - Measure S3.
- [ ] **O4. Colour outlines without rebuilding them.** (M) ViewerCore takes
      the unstyled outlines and applies expression colours as colour
      attributes only. The geometry, the cell filter and the tessellation
      are kept per outline array, and turning the fill on or off does not
      rebuild the geometry. App keeps its styled list for its other uses
      (`App.tsx:1363`, `:3474`).
  - Tests: the colour attributes equal today's, and a batch builds no
    geometry.
  - Measure S4.
- [ ] **O5. Fewer passes before the first overview draw.** (M) One extent
      pass, reused; the ID maps built when first needed (outlines, a hover,
      Cell Query opening); ranks with filter values, and colours with layer
      colours, in one pass each; points packed from the worker's column
      arrays rather than from two rounds of objects.
  - Measure S2 first, since the 2026-11-12 numbers came before the worker
    moves.
- [ ] **O6. App renders on hover and on settling.** (S) Pass a transcript
      hover to App only when the hovered object changes; the tooltip still
      follows the pointer, and the diagnostics dump reads the latest hover
      from a ref. Remove the unread viewport cell count, and keep the
      viewport detail when nothing in it changed. Then measure whether
      memoising ViewerCore saves renders.
  - A test counts App's hover updates over repeated moves on one
    transcript.
  - Measure S5 with the React Profiler.
- [ ] **O22. Outlines read as columns.** (S–M) Found by the baseline (S4):
      the outline query returns a row per vertex, about a million for the
      view where outlines first show, and each becomes an object on the
      main thread (`result.toArray()`, `xeniumDatasetReaders.ts:318`;
      `parseBoundaryRow`, `xeniumDatasetRows.ts:85`). Read the result's
      columns as typed arrays and cut them into rings by cell instead.
  - Tests: the same outlines as today from a fixture's rows.
  - Measure S4.

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
- [ ] **O11. Shorter chains on load.** (M, one PR per group)
  - Probe every Visium HD bin size at once.
  - Pass the probe's size to hyparquet, so it skips its `HEAD`.
  - Read AnnData Zarr obs columns, and embeddings, a few at a time.
  - Read a Xenium gene's three arrays together, and read the next
    transcript tiles ahead, within the point limit
    (`transcriptZarr.ts:208`).
  - Measure each with `--delay 300` on the `anndata-zarr`, `spatialdata`
    and `visium-hd` fixtures.
- [ ] **O12. Nucleus outlines on their own DuckDB client.** (S–M) Started
      when nucleus outlines are first shown, closed by `dispose()`.
  - It costs a worker and a WebAssembly heap: measure both (S8), and the
    time to both outline types (S4).
- [x] **O13. The Zarr decode pool remembers a failed worker.** (S) After
      one fails, OME-Zarr tiles and SpatialData labels decode on the main
      thread without starting new workers, as the codecs already do.
  - A test counts worker starts.
  - Built in [#457](https://github.com/cellgeni/explorer/pull/457):
    [Failed Zarr Decode Workers Stay Failed](#failed-zarr-decode-workers-stay-failed-2026-11-26).
- [ ] **O14. OME-Zarr chunks in the IndexedDB cache.** (M) Measure a second
      load first, from a host that sends validators and from one that
      does not; skip if Chromium's HTTP cache already serves it. Chunks
      would be versioned by the store's metadata, and share the cache's
      256 MiB with TIFF tiles.

M3, main thread:

- [ ] **O15. AnnData table code, in place.** (S–M) `uniqueNames` returns
      early when no name repeats; `h5adMatrixForCells` keeps its row and
      gene maps in the cache; `sparseVectorCell` stops allocating per cell
      (`h5adDataset.ts:4897`); numeric columns stay typed arrays where
      their callers allow; distinct values are counted when the annotation
      list asks for them.
  - Measure S6, and the 460-plex zip through the mirror (S9).
- [ ] **O16. Visium HD positions and barcode mappings in a worker.** (M) As
      for the Xenium overview: columns from a worker, not one object per
      row. Remove the whole-file mapping read nothing calls
      (`visiumHdBarcodeMappings.ts:124-150`). Look at the 2 µm
      `barcodes.tsv.gz` parse (`visiumHdBarcodes.ts:38-145`) too.
- [ ] **O17. A gene's CSR scan off the main thread.** (M) For an H5AD read
      by the H5 worker, use its `matrix-cells` request
      (`h5FileMessages.ts:110`) rather than reading the matrix into the
      page (`h5adDataset.ts:4097`, `:4205`). For AnnData Zarr, decide after
      O15's numbers.
- [ ] **O18. Large CSV files in a worker.** (S) Time both parses at a
      million rows, and move them to a worker if either blocks for more
      than 200 ms. The two `parseCsvRows` read quotes and delimiters
      differently, so merging them is not part of this task.

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
