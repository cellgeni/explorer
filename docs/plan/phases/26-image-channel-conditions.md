# Phase 26 — Image Channel Conditions

Planned 2026-11-19. The spike (task A), the decoder switch (task A2), M1
(tasks B to G, TIFF images) and M2 (OME-Zarr images, SpatialData's
included) were done the same day ([M1 Results](#m1-results-2026-11-19),
[M2 Results](#m2-results-2026-11-19)). Requested: filter cells by the
presence or intensity of up to three image channels inside each cell, in
the Cell Query window ([Phase 23](23-cell-query.md)).

The scope is an Image group of columns in Cell Query. For each fluorescence
channel the canvas lists, the group has two columns:

- the cell's mean intensity in the channel;
- the share of the cell's pixels at or above a threshold, for presence.

Both are number columns, so the existing `Between`, `At least` and
`At most` conditions, the table, `Save As Class` and `Export CSV` take them
as they are. The work is in measuring them: reading the image under every
cell, in workers, without stalling the page or flushing the caches.

The decisions below are the defaults discussed with the user on
2026-11-19. The user answered the plan's open questions the same day
([Answered Questions](#answered-questions)); D4, D5, D6 and D9 carry the
answers. The spike reopened two of them, the default level and the default
threshold, and the user answered them again the same day.

The plan rests on a code map made on 2026-11-19 at `b438945`. It is cited
below as `file:line`; line numbers drift as the code changes.

Sizes are for one developer: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

## Goals And Non-Goals

Goals:

- An Image group in Cell Query's `Add condition` and `Add column` menus,
  with `{channel} mean` and `{channel} % above` for each fluorescence
  channel the canvas lists, custom layers included.
- Up to three channels measured at a time.
- Every cell of the dataset, as for the other columns (plan 23-D1), not
  the viewport.
- An estimate of the read before it starts, a question before a large one,
  then progress and `Cancel` while it runs.
- Decoding and measuring run in workers. The main thread fetches tiles and
  adds up small per-tile results.
- A measurement does not evict the IndexedDB byte-range cache.
- Xenium, Atera and MERSCOPE images, and an AnnData table's manifest image
  (OME-TIFF, TIFF or QPTIFF) in M1. SpatialData images and OME-Zarr
  manifest images in M2.
- `query=` keeps image conditions, with their level and threshold.
- The axe baseline stays empty and `nativeTitleAudit` passes.

Non-goals:

- RGB images (H&E, SVS, NDPI, the Visium hires image). Intensity per
  channel means little without colour deconvolution. See [Later](#later).
- Image-only datasets, which have no cells (plan 23-D1). An AnnData
  manifest can pair an image with a cell table
  ([AnnData With An Image](../../dataset-manifest.md#anndata-with-an-image)),
  and that pairing is in scope.
- Cell outlines and label masks. Cells are discs in this phase (D4).
- Nucleus and cytoplasm as separate compartments.
- Moving a threshold without measuring again (D6).
- More than three channels at once, or whole high-plex panels.
- Visium HD, and queries across the sections of a collection.
- Keeping measurements between visits.

## Measurements (2026-11-19)

The Xenium demo (`mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155…`),
read with tifffile over HTTP. `morphology_focus_0000.ome.tif` (DAPI) is one
channel of four, each in its own file. It is 51,294 × 88,404 px at
0.2125 µm/px, in 1,024-px JPEG 2000 tiles over 9 levels. Only channel 0 was
measured; the other three channels' files may differ in size.

| Level | µm/px | Tiles | Tiles over 100 KB | MB per channel | Pixels in the median cell |
| ----- | ----- | ----- | ----------------- | -------------- | ------------------------- |
| 0     | 0.21  | 4,437 | 3,365             | 1,729          | 1,030                     |
| 1     | 0.43  | 1,144 | —                 | 646            | 258                       |
| 2     | 0.85  | 286   | 235               | 180            | 64                        |
| 3     | 1.7   | 77    | —                 | 52             | 16                        |

- The median cell is 46.5 µm² (`cell_area` in `cells.parquet`; 5th
  percentile 18.7, 95th 100.5). The median nucleus is 26.3 µm².
- About three quarters of the tiles hold tissue (over 100 KB). The rest
  are nearly empty background.
- JPEG 2000 decode in Node 25 on one thread, including a sum over every
  pixel, with the decode-only wasm build of `@cornerstonejs/codec-openjpeg`,
  which the app loads since task A2
  ([Spike Results](#spike-results-2026-11-19)).
  - level 0: 67 ms for a 615 KB tile (75th percentile size), 89 ms for the
    largest (929 KB);
  - level 2: 99 ms for a 1,028 KB tile (75th percentile), 123 ms for the
    largest (1,301 KB).
- `cell_boundaries.parquet` is 109 MB, holding 35 million vertices. The
  boundaries are not read in this phase (D4).

Estimated time per channel, with 4 decode workers (`min(4, cores)`,
`tileDecodePool.ts:263-265`) and 10–40 MB/s from Sanger. These were
estimates. The spike measured slower times, since the bucket gave 4–9 MB/s
([Spike Results](#spike-results-2026-11-19)).

| Level | Decode | Read     | Per channel |
| ----- | ------ | -------- | ----------- |
| 0     | ~67 s  | 43–173 s | 1.1–2.9 min |
| 1     | ~20 s  | 16–65 s  | 20–65 s     |
| 2     | ~6.5 s | 4.5–18 s | 7–18 s      |

Three channels at level 2, the default (D5), read about 540 MB, in 20 s
to a minute. At level 1 they read about 1.9 GB, in 1–3 minutes. Images
on the BioImage Archive read at roughly 3–10 MB/s and take several times
longer. The 19-plex tonsil QPTIFF is about 0.5 GB per channel at full
resolution (0.507 µm/px).

## Spike Results (2026-11-19)

Task A. A throwaway measurer, not committed, ran in a production build in
headless Chromium on the Mac's GPU (Apple M3, 4 performance and 4
efficiency cores), 1280 × 800, with the Xenium demo open at the brain view.
It measured DAPI (`morphology_focus_0000.ome.tif`) under all 1,414,155 cells
with D4's discs and pixel ownership. It used 4 workers, 6 fetches at a
time, 12 tiles in flight, and no byte-range cache (D8). Times run from
bucketing the cells to the last tile.

| Decoder          | Level | Canvas  | Tiles | MB  | Time  | MB/s | Decode per tile, median and p95 | Limit   |
| ---------------- | ----- | ------- | ----- | --- | ----- | ---- | ------------------------------- | ------- |
| The app's        | 1     | Idle    | 910   | 643 | 156 s | 4.1  | 415 ms, 1,512 ms                | Decode  |
| The app's        | 1     | Panning | 910   | 643 | 283 s | 2.3  | 1,233 ms, 1,750 ms              | Decode  |
| The app's        | 2     | Idle    | 248   | 180 | 83 s  | 2.2  | 1,296 ms, 1,799 ms              | Decode  |
| Decode-only wasm | 1     | Idle    | 910   | 643 | 146 s | 4.4  | 99 ms, 138 ms                   | Network |
| Decode-only wasm | 1     | Panning | 910   | 643 | 70 s  | 9.2  | 98 ms, 135 ms                   | Network |
| Decode-only wasm | 2     | Idle    | 248   | 180 | 20 s  | 8.9  | 102 ms, 147 ms                  | Network |

- **The app decoded JPEG 2000 with the slow build.** `jpeg2000.ts:149`
  imported the package's default build, `openjpegjs.js`, which is OpenJPEG
  compiled to JavaScript by wasm2js. Its decode-only wasm build,
  `openjpegwasm_decode.js`, decodes the same tiles 4.2 times faster in the
  spike's measurer, with identical values. In Node it is 2.4–3 times
  faster: 74 against 223 ms for a level-0 tile, 112 against 270 ms for a
  level-2 tile. With the old build the decode workers were busy for the
  whole run.
- **Task A2 switched the app to the fast build**
  ([PR #192](https://github.com/cellgeni/explorer/pull/192), merged
  2026-11-19). Its record is in the
  [optimization pass](optimization-pass.md#jpeg-2000-decode-only-wasm-build-2026-11-19).
  Zooming and panning the demo, the canvas's 1024² tiles took 130–141 ms
  at the median from request to reply, against 1.20–1.51 s, and a decode
  took 91–112 ms of worker CPU, against 866–1,127 ms. Auto-contrast samples
  took 41–97 ms per channel, against 290–522 ms. The tile worker shrank
  from 965 to 301 kB, plus a 255 kB `.wasm`. The measurer's rows above for
  the decode-only build are what M1 can expect.
- **With the fast build, the network is the limit.** The same 643 MB took
  70–146 s as the bucket moved between 4.4 and 9.2 MB/s. `curl` on the same
  Mac got 7.0 MB/s on one connection and 7.9 MB/s on six. The bucket serves
  HTTP/1.1, so Chromium opens at most 6 connections to it, and the canvas's
  tile reads share them. The 4 workers could decode about 40 tiles, or
  28 MB, a second.
- **Over 90 s at level 1.** One channel at level 1 took over 90 s in the
  slower run, the point task A set for revisiting D3 and D5. Three channels
  at level 1 (about 1.9 GB) would take 3½–7 minutes at these rates. At
  level 2 (540 MB) they would take 1–2 minutes.
- **The main thread stays free.**
  - Idle runs had 3 long tasks or fewer. The longest was 236 ms, including
    128 ms of bucketing 1.4 million cells. Frames were 8.3 ms at the median
    and 9.2 ms at the 95th percentile, with at most 4 over 50 ms.
  - Adding up the 910 tiles' results took 55 ms in all.
  - Panning while measuring gave 0.84 long tasks and 95 ms of long tasks a
    second. Panning alone gave 0.87 and 98 ms. Measuring added nothing
    visible.
- **Measuring a tile is cheap.** Giving each pixel to a cell and summing
  took 7 ms per tile at the median and 16 ms at the 95th percentile. A tile
  with tissue holds 1,379 cells at the median and 6,566 at most.
- **The values match the reference exactly.** The reference used tifffile,
  imagecodecs and numpy, with the same discs and pixel ownership. It covered
  the 24,368 cells inside a 2 × 2 block of level-1 tiles (x 870–1,741 µm,
  y 1,741–2,611 µm). Pixel counts, means and the share above 5,000 were the
  same as the browser's for every cell. Many of the cells cross tile edges,
  so this checks the bucketing too.
- **Level 1 averages.** It matches level 0 smoothed over 3 × 3 pixels and
  taken at even pixels: correlation 0.9997, mean difference 13, against 181
  between neighbouring level-0 pixels. It is not a plain subsample. Cell
  means at level 1 and level 0 differ by 0.47% at the median and 2.3% at
  the 99th percentile (correlation 0.999).
- **Level 2 drifts further.** Checked after level 2 became the default, in
  numpy only, on the same block and cells. Cell means at level 2 and
  level 0 differ by 1.6% at the median, 5.4% at the 95th percentile and
  7.9% at the 99th (correlation 0.988). The median cell there has 35
  pixels, and the 5th percentile 17.
- **Pixels per cell.** Nearest pixels go to neighbours, so at level 1 a
  cell has 91, 233 and 519 pixels at the 5th, 50th and 95th percentiles
  over the slide. The median cell's disc alone covers 258. In the dense
  block above, the median is 138.
- **The canvas contrast minimum is 0 on the demo**, for all four channels.
  Auto-contrast takes the 0.5th percentile of the coarsest level, and 17%
  of DAPI's coarsest level is 0, outside the scanned area. With the canvas
  minimum as the threshold, D6's first default, `% above` is 100 for every
  cell. For comparison:
  - Otsu's threshold on the coarsest DAPI level is 2,065, or 2,176 leaving
    out zeros.
  - Cell means over the slide are 550, 1,786 and 5,185 at the 5th, 50th
    and 95th percentiles.
  - At 5,000, cells in the dense block have 0% to 91% of their pixels
    above (median 38%).

## M1 Results (2026-11-19)

M1 as built, in a production build in headless Chromium on the Mac's GPU,
1280 × 800, with the Xenium demo open at the brain view, as in the spike.

- **The Image group** lists each channel's mean and `% above` at level 2,
  0.85 µm/px. Otsu's thresholds from auto-contrast's samples, leaving out
  zeros, are 2,188 for DAPI (2,176 from the whole coarsest level in the
  spike), 1,017 for ATP1A1/CD45/E-Cadherin, 521 for 18S and 555 for
  alphaSMA/Vimentin. `Resolution` lists every level with its size from the
  tile index: 1.6 GiB at 0.21 µm/px, 616 MiB at 0.42, 172 MiB at 0.85.
- **`DAPI % above 2,188` at least 50** matched 558,053 of 1,414,155 cells
  23.9 s after the condition was added, in 204 requests for 248 tiles. The
  page had 2 long tasks (147 ms in all, the longest 86 ms) and 3 frames over
  50 ms; frames were 8.3 ms at the median and 9.1 ms at the 95th percentile.
- **`DAPI mean` at least 2,188** from the same pass took 1.7 s, with no
  new reads; both conditions matched 518,156 cells.
- **The link** (`image:above:2:t2188:Channel:0|at-least|50;image:mean:2:Channel:0|at-least|2188`)
  opened on a fresh page and measured without a click: `Measuring` with
  progress from 6 s, the same 518,156 cells at 36.7 s, the measurement
  29.5 s (172 MiB) beside the dataset's own load.
- **The MERSCOPE `.vzg` smoke fixture**, 12-bit JPEG at 5 µm discs: the
  three cells' means at 2 µm/px are about 1,927, 1,987 and 1,430 in
  tifffile and numpy, and `DAPI mean` at least 1,700 matches two of them at
  2 and at 0.5 µm/px in the app.
- **The main chunk did not grow**: 1,042 kB against 1,049 kB on `main`. The
  threshold reader and the main-thread fallback load on demand.

Where M1 differs from the plan above:

- Task E's measurer is two modules: `cellImageMeasurer.ts` plans and runs
  one measurement, and `CellImageMeasurements` keeps the dataset's
  measurements for the panel's model.
- One decode pool per dataset's measurements, shared by the channels
  measured at once and closed when none is, rather than one per
  measurement.
- Channels auto-contrast does not read (past the six on by default) get
  Otsu's threshold from their coarsest level when the panel opens. Their
  `% above` is listed as finding a threshold until then.
- The status line says `Measuring`, or `Waiting to measure` at the
  question or after `Cancel`, rather than the last count. A measured
  column's range shows under its bounds.
- A tile that fails is read once more before the measurement fails.
- Task G's offline App test is a Playwright smoke test on the MERSCOPE
  `.vzg` fixture instead, beside panel tests on the real hook with an
  in-memory TIFF; Cell Query's other App-level coverage is in Playwright
  too. The no-redraw guard is a store test: a measurement changes state
  three times however many tiles it reads, and progress renders only the
  conditions.

## M2 Results (2026-11-19)

M2 as built: OME-Zarr images are measured chunk by chunk, so SpatialData
images and an AnnData manifest's OME-Zarr image now list their channels.

- **A local SpatialData store** written with spatialdata 0.9.0 (Zarr v3):
  a 12288² uint16 image in 4096² chunks (18 MB each with zstd) and two
  coarser levels, and 150,000 circle cells, each a blob of one value over
  noise. In a production build on the Mac's GPU, served from disk through
  Playwright:
  - `Resolution` lists `1 µm/px, up to 288 MiB`, `2 µm/px, up to 128 MiB`
    and `4 µm/px, up to 18 MiB (default)`.
  - `DAPI mean` at least 1,000 at the default level matched 135,000 of
    150,000 cells in 0.7 s, from one chunk.
  - At 1 µm/px, nine chunks (162 MB) took 2.6 s with no long tasks;
    frames were 8.3 ms at the median and 9.2 ms at the 95th percentile.
    With 300 ms added to every request, 3.0 s, with 2 long tasks (148 ms
    in all, the longest 74 ms).
- **Live stores were not timed.** On the day, the Sanger buckets took
  10–40 s per request and EBI was little better, so the AU14 Xenium store
  and STHELAR's `morpho` image did not finish loading. Both remain the
  live checks to make.
- **The smoke test's store** (`src/test/fixtures/spatialdata/`, 316 KB):
  two channels in 32² chunks, all-zero chunks left out by zarr-python, and
  a table anndata 0.13 writes sharded. `DAPI mean` at least 3,000 and
  `CD3 % above` its threshold match as written, at both levels.
- **The main chunk** grew 1.7 kB, to 1,075.8 kB against M1's 1,074.1 kB.

Where M2 differs from the plan above:

- Task C's `measure-tile` request reading a tile across chunks became
  `measure-chunk`, which measures a whole chunk. The measurer buckets cells
  by the image's chunks rather than the canvas's tiles, which cut a 4096²
  chunk into 64 tiles of 512²: per tile, a chunk would be fetched and
  decoded up to 64 times, or held in the workers' caches between tiles. So
  no tile spans chunks, and nothing is cached: each chunk is fetched once,
  sent to a worker with its bytes, decoded and summed.
- Chunks can be far larger than TIFF tiles, so fewer are read at once: as
  many as fit in 256 MiB decoded, at least 2.
- An OME-Zarr store has no tile index, so a read's size is the chunks
  decoded, an upper bound: `Resolution` and the question say `up to`. The
  budget applies to it as it is.
- Not covered: sharded OME-Zarr images fail with a message, as a shard's
  chunks cannot be decoded apart from it; a zipped OME-Zarr's chunks still
  go into the byte-range cache, which its zip reader writes to. Both are
  under [Later](#later).

## Current State

What the work can build on:

- **Cell Query columns.**
  - `CellQueryColumnSource` has the kinds `cell`, `set` and `track`
    (`cellQueryModel.ts:21-26`). The groups are `Cell`, `Classes` and
    `Metadata` (`:28`).
  - `cellQueryColumns` builds the list (`:152-213`). Column IDs are
    `cell:…`, `set:…` and `track:…` (`:67-72`, `:142`, `:146`).
  - `formatCellQueryLink` and `parseCellQueryLink` (`:275-331`) do not
    check the ID's prefix, so `image:` IDs parse as they are.
  - `Select` turns consecutive options of one group into an `<optgroup>`
    (`Select.tsx:57-62`).
- **Reading a column.**
  - `ColumnInput` is `loading`, `error` or `ready`
    (`useCellQueryModel.ts:203-212`). `columnInput()` switches on the
    source (`:947-1049`).
  - An effect sends each ready column to the worker once (`:495-570`), then
    matches after 250 ms (`:66`).
  - The panel shows `Reading {label}…` (`CellQueryPanel.tsx:170-174`) and
    errors (`:175-179`). Number fields are `NumberBounds` (`:292-343`).
  - There is no progress state, here or in `useOnDemandLoads`
    (`useOnDemandLoads.ts:9-12`).
- **The query worker.** `setNumberColumn(columnId, values: Float64Array)`
  (`cellQuery.ts:109`) takes one value per overview row, NaN for none,
  through the `number-column` message (`cellQueryMessages.ts:14-36`).
- **Canvas channels already reach Cell Query.**
  - App builds `cellQueryPictureImage` from `morphologyCanvasChannels`
    (`App.tsx:4469-4483`). It reaches the model as `pictureImage`
    (`useCellQueryModel.ts:196`).
  - Each channel is `{id, loader, enabled, color, contrast, opacity}`
    (`useViewerLayerData.ts:353-376`). It has no name: names are on the
    channel infos of `morphologyChannels` (`App.tsx:988-994`).
  - Each channel has its own loader (`morphologyImage.ts:361-471`). Custom
    layers are included. A z-stack opens new loaders per plane
    (`morphologyImage.ts:377-431`).
  - Channel IDs are like `Channel:0`, and `{layer}:Channel:0` for custom
    layers (`qptiff.ts:134`, `omeZarrLoader.ts:1517`,
    `customMorphologyLayers.ts:106`).
- **Cells.**
  - `OverviewCellDatum` positions are µm with y negated
    (`deckLayerTypes.ts:11-27`; `cellPointRenderer.ts:247`).
  - `cellArea` is filled on Xenium and Atera, and on standard Visium as a
    constant spot area. MERSCOPE and SpatialData cells have none.
- **Raw pixels.** There are two loader classes: `TiffPyramidLoader`
  (`tiff/loader.ts:1910`) and `OmeZarrImagePyramidLoader`
  (`omeZarrLoader.ts:406`). QPTIFF, SVS, NDPI and MERSCOPE `.vzg` all go
  through the TIFF one.
  - TIFF:
    - `fetchTileBytes` (`loader.ts:2121`) and `tileDecodeOptions`
      (`:2099`), then `decodeTiffTilePixels` (`codecs/tiffTile.ts:46`).
      Tiles come back padded to the full tile size. Missing tiles are
      0 bytes.
    - Each tile's byte length is in the chunk index
      (`TiffChunkIndexEntry`, `loader.ts:101`), so a read's size is known
      exactly.
    - The `upcoming` fetch option reads adjacent tiles in one request
      (`imagePyramid.ts:92-100`).
  - OME-Zarr:
    - `loadTilePixels` decodes on the main thread (`omeZarrLoader.ts:559`).
    - `sampleTilePixels` decodes in a worker (`:736-760`), but returns
      null for a tile that spans chunks.
  - The flat Visium image is an `HTMLImageElement` with no raw path. It is
    RGB, so it is out of scope.
- **Decoding in a worker and returning something small.** Auto-contrast
  already works this way:
  - TIFF: `TileDecodeWorkerPool.sample` (`tileDecodePool.ts:81-98`).
    Requests are routed by key (`tileDecode.worker.ts:18-34`) and handled
    by `handleTileSamplesRequest` (`tileSamplesCore.ts:29-53`).
  - OME-Zarr: `sample-tile` on `ZarrDecodePool`
    (`zarrDecodePool.ts:94-114`).
  - Pool sizes: TIFF `min(4, cores)`; Zarr `min(3, cores − 1)`
    (`zarrDecodePool.ts:353-357`). Each tile cache makes its own TIFF pool
    (`tileCache.ts:103`).
- **Thresholds.**
  - Auto-contrast reads the coarsest level. It gives the 0.5 and 99.8
    percentiles and a 32-bin histogram (`morphologyContrast.ts:64-84`),
    kept as `MorphologyChannelSetting.histogram`.
  - `ChannelHistogramView` draws the histogram
    (`MorphologyChannelControls.tsx:189-219`).
- **Placement.**
  - `tileBounds` is in µm, in the loader's own frame
    (`imagePyramid.ts:150-158`).
  - `ImageFramePlacement` and `unplaceFrameBbox` (`coords.ts:287`,
    `:314`) map between that frame and the dataset. SpatialData scales are
    folded into the levels' µm per pixel (`omeZarrLoader.ts:228-232`).
- **Caches and limits.**
  - TIFF tile reads go through the 256 MiB IndexedDB LRU
    (`persistentByteRangeCache.ts:3-5`; `loader.ts:2432-2444`). Only a
    whole loader can skip it (`byteRangeCache: null`, `loader.ts:152`).
  - `TileRequestSlots` caps requests in flight across schedulers
    (`tileRequestScheduler.ts:37-70`).
  - Plots asks before reading over 32 MiB and refuses over 256 MiB
    (`plotReadDecision`, `plotsPanelModel.ts:484-495`).
- **RGB.** A TIFF RGB channel has `samplesPerPixel > 1`
  (`morphologyChannels.ts:86-88`). OME-Zarr RGB channels have
  `alphaFromIntensity: false` (`omeZarrLoader.ts:1490-1527`).

What is missing:

- Per-cell image values, anywhere.
- A worker request that decodes a tile and returns per-cell sums.
- A progress state for a Cell Query column.
- A tile fetch that leaves the persistent byte-range cache alone.
- An OME-Zarr worker path for a tile that spans chunks.
- Channel names in the Cell Query model.
- A cell size on MERSCOPE and SpatialData.

## Product Decisions

Proposed 2026-11-19. D4, D5, D6 and D9 are settled by the user's answers,
D5 and D6 after the spike; the others stand as proposed.

- **D1. Two columns per channel.**
  - `{channel} mean`: the mean of the cell's pixels in the image's own
    units (0–65,535 for 16-bit).
  - `{channel} % above`: the share of the cell's pixels at or above the
    channel's threshold, 0–100.

  Both sit in an Image group after Metadata, for every channel the canvas
  lists that is not RGB: `samplesPerPixel` at most 1 and
  `alphaFromIntensity` not false. An image with no such channel shows a
  note in place of the group.

- **D2. Up to three channels.**
  - A column of a fourth channel is listed but disabled, with a note
    naming the three in use.
  - A channel stops counting when no condition or table column uses it.
  - Measurements stay for the dataset while it is open.

  Three keep a measurement at level 2 on the demo to about 540 MB, which
  takes 1–2 minutes at the spike's rates. They also keep memory near 70 MB
  while measuring (16 bytes per cell per channel) and 70 MB of kept
  columns.

- **D3. Every cell, measured once per channel.**
  - A condition on an image column waits for the whole measurement. The
    condition shows `Measuring {channel}… 42%` with `Cancel`.
  - The count waits for the measurement, as it waits for any column still
    being read (`runnable`, `useCellQueryModel.ts:454-455`).
  - The mean and the share above come from the same pass.
  - Cells outside the image get no value, and so never match. The note
    says how many there are, as unmatched IDs do.

- **D4. A cell is a disc.**
  - The disc is centred on the cell's position, with the cell's area where
    the platform gives one (`cellArea`; radius √(area/π)).
  - Where it does not (MERSCOPE, SpatialData, AnnData other than Visium),
    a `Radius` field in the Image group sets it, 5 µm to start. Changing
    it measures the channels in use again. The radius is in the link (D9).
  - A pixel counts when its centre is inside the disc. A pixel inside
    several discs counts for the cell whose centre is nearest relative to
    its radius, so neighbours do not share pixels.
  - The disc is round in micrometres. On an image whose pixels are not
    square (OME-Zarr scales each axis) it is an ellipse in pixels.
  - Outlines and label masks are [later](#later).

- **D5. One pyramid level per measurement.**
  - The default is level 2, two steps coarser than full resolution, or
    the coarsest level on an image with fewer. On the Xenium demo that is
    0.85 µm/px, with 64 pixels in the median cell's disc. One channel took
    20 s in the spike, against 70–146 s at level 1. Cell means at level 2
    are within 1.6% of level 0's at the median and 7.9% at the 99th
    percentile; at level 1, 0.47% and 2.3%.
  - `Resolution` lists every level with µm per pixel and the size of its
    read, so a finer level is a choice away.
  - The level is part of the column: the label and the CSV header say
    `DAPI mean (0.85 µm/px)`. The same channel at another level is
    another column.

- **D6. One threshold per channel, applied while measuring.**
  - It is in the image's units. It starts at Otsu's threshold on the
    pixels auto-contrast samples from the coarsest level, leaving out
    zeros: 2,176 on the demo's DAPI. The canvas contrast minimum was the
    first choice, but it is 0 on the demo, where 17% of the coarsest level
    lies outside the scan, so every cell would be 100% above it.
  - It is shown on the channel's histogram.
  - Changing it measures the channel again (about 20 s on the demo at
    level 2).

- **D7. Read budget.**
  - The read is worked out before it starts. On TIFF it is exact, from the
    chunk index. On OME-Zarr it is an upper bound: the chunk count times
    the chunk's decoded size.
  - The budget is per channel. Above 1 GiB the condition asks first:
    "Measuring DAPI reads 1.6 GiB. Measure?" (level 0 on the demo). At
    level 2 the demo reads 180 MB per channel and does not ask; at level 1,
    646 MB.
  - Above 8 GiB it refuses and suggests a coarser level, as
    `plotReadDecision` does for genes.

- **D8. No persistent cache writes.** Tiles read for a measurement may come
  from the IndexedDB byte-range cache but are not written to it. A
  hundred-megabyte pass would otherwise evict everything the canvas and
  the other readers keep there.
- **D9. In the link.**
  - The column ID carries the statistic, the level, the z plane for a
    z-stack, the threshold for `% above`, the radius where cells have no
    area (D4), and the channel ID, in that order. The channel ID goes last
    because it may contain colons (`Channel:0`, `{layer}:Channel:0`). For
    example, `image:above:2:t2176:Channel:0|at-least|40` on Xenium, or
    `image:mean:2:r5:Channel:0|at-least|300` on MERSCOPE.
  - A link with an image condition measures on opening, once the dataset
    is ready, without a click. D7's question and refusal still apply. On
    the demo, a link with three channels at level 2 reads about 540 MB as
    it opens, with progress and `Cancel`.
  - A channel the image does not have is noted and left out, as other
    columns are.
- **D10. The plane the canvas shows.** On a z-stack, a measurement reads
  the canvas's plane at the time it starts. Changing the plane later does
  not measure again; the column's label names the plane.

## How A Measurement Runs

1. **Cells into the image's frame.**
   - Take each overview cell's position in µm, with y back to positive.
     Map it into the loader's frame with the inverse of its placement
     (`unplaceFrameBbox`'s maths, for a point).
   - Turn it into pixels at the chosen level, with the disc's radius in
     pixel widths and the pixels' height over width (D4).
2. **Tiles.**
   - Bucket the cells by the tiles their discs touch. A disc across a tile
     edge goes in each tile.
   - Tiles without cells are not read.
   - On TIFF, tiles are read in file order, so `upcoming` joins adjacent
     tiles into one request.
3. **Per tile.**
   - The main thread fetches the bytes (D8) and posts them to a decode
     worker with the decode metadata, the tile's cells, the threshold and
     the pixels' height over width. The cells go as `Float32Array` x, y and
     radius in tile pixels, and a `Uint32Array` of rows.
   - The worker decodes and crops to the tile's visible size, then gives
     each pixel to a cell (D4).
   - It returns, transferred, per cell: the sum of values
     (`Float64Array`), the pixel count and the count at or above the
     threshold (`Uint32Array`s).
   - At level 2 on the demo a tile with tissue holds 4,793 cells at the
     median and 25,010 at most: 77 KB and 400 KB each way. At level 1 it
     is 1,379 and 6,566 cells.
4. **Adding up.**
   - A `CellImageMeasurer` adds each tile's results into per-channel
     arrays, kept in private fields and never passed as props. React 19's
     dev build walks typed arrays in props.
   - When every tile is in, it sends `mean` and `% above` to the query
     worker as `number-column`s.
5. **Limits.**
   - The measurer has its own decode pool, sized `cores − 2` (at least 1,
     at most 4), so the canvas stays responsive. It is closed when the
     measurement ends.
   - A `TileRequestSlots` of 6 is shared by the channels being measured.
     An HTTP/1.1 host such as the Sanger bucket allows 6 connections, which
     the canvas's tile reads share.
   - `Cancel`, a dataset change, or removing the last condition on the
     channel aborts the fetches and the pool's requests, and drops the
     partial sums.

## Tasks

- [x] **A. Measurement spike.** (S; done 2026-11-19, see
      [Spike Results](#spike-results-2026-11-19)) A throwaway measurement of
      one channel of the Xenium demo at level 1 in the browser.
  - Record tiles per second, MB/s, the main thread's long tasks and the
    canvas's frame rate while it runs.
  - Compare a few hundred cells' means with a tifffile and numpy reference
    using the same discs, and level-1 means with level-0 means. The second
    comparison shows whether the pyramid averages or subsamples.
  - Record the numbers in this file. If one channel takes over 90 s on the
    dev Mac, revisit D3 and D5 before going on.
- [x] **A2. The fast JPEG 2000 decoder.** (S; done 2026-11-19 in
      [PR #192](https://github.com/cellgeni/explorer/pull/192)) Load the
      decode-only wasm build of `@cornerstonejs/codec-openjpeg` in
      `jpeg2000.ts` ([Spike Results](#spike-results-2026-11-19)).
- [x] **B. Measuring a tile.** (M) A pure
      `measureTileCells(pixels, width, height, cells, threshold)` in
      `src/data/`, beside `tileSamples.ts`.
  - Padded tiles are cropped. Missing (0-byte) tiles count as zeros, as
    the TIFF fill value.
  - fast-check tests against a brute-force reference:
    - a pixel counts for one cell at most;
    - the sums of a disc cut into tiles equal its sums in one piece;
    - the share above stays between 0 and 100.
- [x] **C. Worker requests.** (M; the TIFF part done in M1, OME-Zarr in
      M2, as a chunk-sized request: see
      [M2 Results](#m2-results-2026-11-19))
  - A `measure` request on `TileDecodeWorkerPool`, routed by key as
    `sampling` is.
  - A `measure-tile` request on `ZarrDecodePool` that reads a tile across
    chunks, generalising `chunkWindowSamples`.
  - Results are transferred. Tests on the worker cores, as
    `tileSamplesCore.test.ts` does.
- [x] **D. Fetching without persisting.** (S)
  - A per-call option on `ImagePyramidTileFetchOptions` that reads the
    byte-range cache but does not write to it. The TIFF loader's
    `fetchByteRangeWithCache` path honours it.
  - Test that a measurement leaves the IndexedDB cache's entries as they
    were.
- [x] **E. The measurer.** (M) `CellImageMeasurer` in `src/features/query/`.
  - Cells into the frame, the level (D5), buckets and tile order.
  - The default threshold (D6): Otsu's on the samples
    `computeChannelAutoContrast` reads (`morphologyContrast.ts:75`),
    leaving out zeros, kept beside the percentiles. Tests on a two-peak
    sample set and on one with a block of zeros.
  - The read estimate and budget (D7), request slots, progress, cancel,
    adding up and the columns.
  - Unit tests with a fake loader: flipped and swapped placements, an
    origin offset (MERSCOPE), cells outside the image, the budget's three
    answers, cancel part-way, and progress reaching 100%.
- [x] **F. Cell Query.** (M)
  - An `image` source kind and the Image group in `cellQueryModel.ts`. The
    column IDs and the link (D9).
  - A `measuring` state with a fraction, from `columnInput()` through
    `conditionViews` to the panel: `Measuring {channel}… 42%` and
    `Cancel`.
  - The threshold field over the channel's histogram, `Resolution`, and
    `Radius` where cells have no area. The three-channel limit (D2).
  - Channel names passed beside `pictureImage` (`App.tsx:4469`).
  - Tests: the model, the link's round trip, and a panel component test
    on the real hook.
- [x] **G. Docs and end-to-end tests.** (M)
  - Docs: [Docs To Update](#docs-to-update).
  - `App.test.tsx`, offline: an OME-TIFF fixture with known values
    (tifffile, as in the local TIFF fixtures) under an AnnData manifest.
    Add `DAPI mean` at least a value, check the count, and save as a
    class.
  - E2E smoke on the same fixture, with the axe test opening the Image
    group, and the baseline staying `{}`.
  - A nightly `@live` test: time to measure one channel of the Xenium
    demo.
  - The no-redraw guard: measuring must not render DeckGL, which costs
    about 9 s per render headless.

## Order And Size

| Milestone        | Contents                              | Size             |
| ---------------- | ------------------------------------- | ---------------- |
| M0 — Spike       | A, A2 (both done)                     | S                |
| M1 — TIFF images | B, C (TIFF), D, E, F, G (done)        | About 2–2½ weeks |
| M2 — OME-Zarr    | C (OME-Zarr), SpatialData test (done) | M                |

- M1 covers Xenium, Atera and MERSCOPE, and AnnData with a TIFF, OME-TIFF
  or QPTIFF image. M2 adds SpatialData images and OME-Zarr manifest
  images.
- B and D can go in parallel with C. E needs B and C. F can start on a
  fake measurer.
- The total is about 2½–3 weeks.

## Risks

| Risk                                        | Effect                                                      | Mitigation                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A slow host (BioImage Archive, 3–10 MB/s)   | A measurement takes minutes                                 | The estimate and question first (D7), a coarser level, `Cancel`                                         |
| The app's slow JPEG 2000 decoder            | Decoding, not the network, sets the pace: 156 s per channel | Done: task A2 switched to the decode-only wasm build (PR #192)                                          |
| A threshold of 0 by default                 | `% above` is 100 for every cell on the demo                 | Otsu's threshold, leaving out zeros (D6)                                                                |
| A disc is not the cell                      | Membrane markers are missed, neighbours' signal is included | Docs say so; nearest-centre pixels (D4); outlines and masks later; the spike compares with a reference  |
| Values depend on the level                  | Numbers differ from a pipeline's, and between levels        | The level is in the column's label, the CSV header and the link (D5, D9)                                |
| A pyramid made by subsampling               | Noisier means at coarse levels                              | Level 1 averages; level 2 is within 1.6% of level 0 at the median, 7.9% at p99; level 1 in `Resolution` |
| The measurement competes with the canvas    | The canvas stutters while measuring                         | A separate pool of `cores − 2` workers; the spike measures the frame rate                               |
| The pass evicts the byte-range cache        | The canvas and the readers lose their cached bytes          | No writes for measurement reads (D8)                                                                    |
| Large typed arrays in React props           | React 19's dev build walks them; dev tabs crash             | Sums and columns stay in the measurer's private fields and the query worker                             |
| Many cells × many channels                  | Tab memory                                                  | Three channels (D2): 16 bytes per cell per channel while measuring; a column is 8 bytes per cell        |
| A threshold or radius change measures again | About 20 s per channel on the demo at level 2               | Per-cell histograms later; a default from the image's own histogram (D6)                                |

## Docs To Update

- `docs/ui-reference.md`: the Image group in the Cell Query Panel section,
  `Resolution`, the threshold and `Radius`; the `query=` key's image column
  IDs.
- `docs/user-guide.md`: a walkthrough from a channel condition to a saved
  class.
- `docs/architecture.md`: the `measure` requests and `CellImageMeasurer`.
- `PLAN.md`: this phase's row.

## Answered Questions

Answered by the user on 2026-11-19 and folded into the decisions. The
spike reopened the first two, and the user answered them again the same
day.

1. **Default level: level 2** (D5). The first answer was level 1. The spike
   then took 70–146 s for one channel at level 1, 3½–7 minutes for three,
   against 20 s for one at level 2. Level 1 stays in `Resolution`.
2. **Default threshold: Otsu's, leaving out zeros** (D6). The first answer
   was the canvas's contrast minimum, which the spike found is 0 on the
   demo.
3. **Cells without an area: a `Radius` field in the panel** (D4), 5 µm to
   start, not a median taken from a platform column.
4. **Links: measure on opening** (D9), not on a click.

## Later

- Cell outlines:
  - Xenium's `cell_boundaries.parquet` (109 MB) read once;
  - SpatialData and manifest label masks, each pixel already naming its
    cell (`SpatialDataLabelsReader`, `spatialDataLabels.ts:168`);
  - Atera's gridded polygons.
- Nucleus and cytoplasm separately, from nucleus boundaries or area.
- Per-cell histograms, so a threshold moves without reading again. With 16
  bins that is about 130 MB for three channels on the demo.
- Keeping measurements in IndexedDB by file version, as the byte-range
  cache keys its entries.
- Colouring cells on the canvas by a measured column.
- RGB images through colour deconvolution (haematoxylin, DAB).
- More channels, measured a few at a time.
- Image-only datasets whose segmentation mask supplies the cells.
- Sharded OME-Zarr images (Zarr v3 shards): read each shard's index on the
  main thread and send the workers each chunk's bytes.
- Reading a zipped OME-Zarr's chunks without adding them to the byte-range
  cache (26-D8): its zip reader has no per-read option.
