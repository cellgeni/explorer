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
