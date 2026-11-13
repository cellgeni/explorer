# Optimization Pass

- [ ] Tune interaction performance, memory pressure, fetch/decode concurrency,
      and rendering cost without changing product behaviour.

Work recorded so far: vendor chunk groups (React, deck.gl, DuckDB-WASM, spatial
I/O, codecs) cut the entry chunk from about 1.26 MB to about 427 kB; heavy
readers are lazy-loaded; and the structural refactor in
[the refactor record](../engineering.md#application-structure-and-refactor-record) is complete.

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

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Other gaps found in the review:

- [x] Byte-range cache eviction read every cached range (2026-11-13). After
      each write, `evict` (`src/data/persistentByteRangeCache.ts`) called
      `getAll()` on the store, so the bytes of every cached range (up to 256 MB)
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
    an ROI drawn a minute or more after load.
  - Not done: reading cell rows from the feature-major Zarr. A cell's counts
    are spread over every gene's entries, so it means reading all of
    `indices`.
