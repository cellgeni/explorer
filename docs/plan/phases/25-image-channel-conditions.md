# Phase 25 — Image Channel Conditions

Planned 2026-11-19. Not started. Requested: filter cells by the presence or
intensity of up to three image channels inside each cell, in the Cell Query
window ([Phase 23](23-cell-query.md)).

The scope is an Image group of columns in Cell Query. For each fluorescence
channel the canvas lists, the group has two columns:

- the cell's mean intensity in the channel;
- the share of the cell's pixels at or above a threshold, for presence.

Both are number columns, so the existing `Between`, `At least` and
`At most` conditions, the table, `Save As Class` and `Export CSV` take them
as they are. The work is in measuring them: reading the image under every
cell, in workers, without stalling the page or flushing the caches.

The decisions below are the defaults discussed with the user on
2026-11-19, written down for review. None is final until the user confirms
it; the [Open Questions](#open-questions) are the ones most worth a look.

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
- JPEG 2000 decode, with the app's codec (`@cornerstonejs/codec-openjpeg`)
  in Node 25 on one thread, including a sum over every pixel:
  - level 0: 67 ms for a 615 KB tile (75th percentile size), 89 ms for the
    largest (929 KB);
  - level 2: 99 ms for a 1,028 KB tile (75th percentile), 123 ms for the
    largest (1,301 KB).
- `cell_boundaries.parquet` is 109 MB, holding 35 million vertices. The
  boundaries are not read in this phase (D4).

Estimated time per channel, with 4 decode workers (`min(4, cores)`,
`tileDecodePool.ts:263-265`) and 10–40 MB/s from Sanger. These are
estimates, not measurements; task A measures them in the browser.

| Level | Decode | Read     | Per channel |
| ----- | ------ | -------- | ----------- |
| 0     | ~67 s  | 43–173 s | 1.1–2.9 min |
| 1     | ~20 s  | 16–65 s  | 20–65 s     |
| 2     | ~6.5 s | 4.5–18 s | 7–18 s      |

Three channels at level 2 read about 540 MB, in 20 s to a minute. Images
on the BioImage Archive read at roughly 3–10 MB/s and take several times
longer. The 19-plex tonsil QPTIFF is about 0.5 GB per channel at full
resolution (0.507 µm/px).

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
  - TIFF tile reads go through the 256 MB IndexedDB LRU
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

Proposed 2026-11-19, for the user to confirm.

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

  Three keeps a measurement under about a minute on the demo at level 2.
  It also keeps memory near 70 MB while measuring (16 bytes per cell per
  channel) and 70 MB of kept columns.

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
    a `Radius` field in the Image group sets it, 5 µm by default.
  - A pixel counts when its centre is inside the disc. A pixel inside
    several discs counts for the cell whose centre is nearest relative to
    its radius, so neighbours do not share pixels.
  - Outlines and label masks are [later](#later).

- **D5. One pyramid level per measurement.**
  - The default is the coarsest level at which the median cell covers at
    least 64 pixels: level 2 on the Xenium demo.
  - `Resolution` lists the finer levels with µm per pixel and the size of
    their read.
  - The level is part of the column: the label and the CSV header say
    `DAPI mean (0.85 µm/px)`. The same channel at another level is
    another column.

- **D6. One threshold per channel, applied while measuring.**
  - It is in the image's units. It starts at the channel's contrast minimum
    on the canvas: what the canvas shows as above background.
  - It is shown on the channel's histogram.
  - Changing it measures the channel again (7–18 s per channel on the
    demo at level 2).

- **D7. Read budget.**
  - The read is worked out before it starts. On TIFF it is exact, from the
    chunk index. On OME-Zarr it is an upper bound: the chunk count times
    the chunk's decoded size.
  - Above 1 GiB the condition asks first: "Measuring DAPI reads 1.7 GiB.
    Measure?".
  - Above 8 GiB it refuses and suggests a coarser level, as
    `plotReadDecision` does for genes.

- **D8. No persistent cache writes.** Tiles read for a measurement may come
  from the IndexedDB byte-range cache but are not written to it. A
  hundred-megabyte pass would otherwise evict everything the canvas and
  the other readers keep there.
- **D9. In the link.**
  - The column ID carries the statistic, the level, the z plane for a
    z-stack, the threshold for `% above`, and the channel ID, in that
    order. The channel ID goes last because it may contain colons
    (`Channel:0`, `{layer}:Channel:0`). For example,
    `image:above:2:t1200:Channel:0|at-least|40`.
  - A link with an image condition starts measuring when the dataset is
    ready, subject to D7.
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
   - Turn it into pixels at the chosen level, with the disc's radius
     (D4).
2. **Tiles.**
   - Bucket the cells by the tiles their discs touch. A disc across a tile
     edge goes in each tile.
   - Tiles without cells are not read.
   - On TIFF, tiles are read in file order, so `upcoming` joins adjacent
     tiles into one request.
3. **Per tile.**
   - The main thread fetches the bytes (D8) and posts them to a decode
     worker with the decode metadata, the tile's cells and the threshold.
     The cells go as `Float32Array` x, y and radius in tile pixels, and a
     `Uint32Array` of rows.
   - The worker decodes and crops to the tile's visible size, then gives
     each pixel to a cell (D4).
   - It returns, transferred, per cell: the sum of values
     (`Float64Array`), the pixel count and the count at or above the
     threshold (`Uint32Array`s).
   - At level 2 on the demo that is about 6,000 cells, or 100 KB each
     way, per tile.
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
   - `Cancel`, a dataset change, or removing the last condition on the
     channel aborts the fetches and the pool's requests, and drops the
     partial sums.

## Tasks

- [ ] **A. Measurement spike.** (S) A throwaway measurement of one channel
      of the Xenium demo at level 2 in the browser.
  - Record tiles per second, MB/s, the main thread's long tasks and the
    canvas's frame rate while it runs.
  - Compare a few hundred cells' means with a tifffile and numpy reference
    using the same discs, and level-2 means with level-0 means. The second
    comparison shows whether the pyramid averages or subsamples.
  - Record the numbers in this file. If one channel takes over a minute on
    the dev Mac, revisit D3 and D5 before going on.
- [ ] **B. Measuring a tile.** (M) A pure
      `measureTileCells(pixels, width, height, cells, threshold)` in
      `src/data/`, beside `tileSamples.ts`.
  - Padded tiles are cropped. Missing (0-byte) tiles count as zeros, as
    the TIFF fill value.
  - fast-check tests against a brute-force reference:
    - a pixel counts for one cell at most;
    - the sums of a disc cut into tiles equal its sums in one piece;
    - the share above stays between 0 and 100.
- [ ] **C. Worker requests.** (M; the TIFF part in M1, OME-Zarr in M2)
  - A `measure` request on `TileDecodeWorkerPool`, routed by key as
    `sampling` is.
  - A `measure-tile` request on `ZarrDecodePool` that reads a tile across
    chunks, generalising `chunkWindowSamples`.
  - Results are transferred. Tests on the worker cores, as
    `tileSamplesCore.test.ts` does.
- [ ] **D. Fetching without persisting.** (S)
  - A per-call option on `ImagePyramidTileFetchOptions` that reads the
    byte-range cache but does not write to it. The TIFF loader's
    `fetchByteRangeWithCache` path honours it.
  - Test that a measurement leaves the IndexedDB cache's entries as they
    were.
- [ ] **E. The measurer.** (M) `CellImageMeasurer` in `src/features/query/`.
  - Cells into the frame, the level (D5), buckets and tile order.
  - The read estimate and budget (D7), request slots, progress, cancel,
    adding up and the columns.
  - Unit tests with a fake loader: flipped and swapped placements, an
    origin offset (MERSCOPE), cells outside the image, the budget's three
    answers, cancel part-way, and progress reaching 100%.
- [ ] **F. Cell Query.** (M)
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
- [ ] **G. Docs and end-to-end tests.** (M)
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

| Milestone        | Contents                       | Size             |
| ---------------- | ------------------------------ | ---------------- |
| M0 — Spike       | A                              | S                |
| M1 — TIFF images | B, C (TIFF), D, E, F, G        | About 2–2½ weeks |
| M2 — OME-Zarr    | C (OME-Zarr), SpatialData test | M                |

- M1 covers Xenium, Atera and MERSCOPE, and AnnData with a TIFF, OME-TIFF
  or QPTIFF image. M2 adds SpatialData images and OME-Zarr manifest
  images.
- B and D can go in parallel with C. E needs B and C. F can start on a
  fake measurer.
- The total is about 2½–3 weeks.

## Risks

| Risk                                      | Effect                                                      | Mitigation                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A slow host (BioImage Archive, 3–10 MB/s) | A measurement takes minutes                                 | The estimate and question first (D7), a coarser level, `Cancel`                                        |
| A disc is not the cell                    | Membrane markers are missed, neighbours' signal is included | Docs say so; nearest-centre pixels (D4); outlines and masks later; the spike compares with a reference |
| Values depend on the level                | Numbers differ from a pipeline's, and between levels        | The level is in the column's label, the CSV header and the link (D5, D9)                               |
| A pyramid made by subsampling             | Noisier means at coarse levels                              | The spike compares level 2 with level 0                                                                |
| The measurement competes with the canvas  | The canvas stutters while measuring                         | A separate pool of `cores − 2` workers; the spike measures the frame rate                              |
| The pass evicts the byte-range cache      | The canvas and the readers lose their cached bytes          | No writes for measurement reads (D8)                                                                   |
| Large typed arrays in React props         | React 19's dev build walks them; dev tabs crash             | Sums and columns stay in the measurer's private fields and the query worker                            |
| Many cells × many channels                | Tab memory                                                  | Three channels (D2): 16 bytes per cell per channel while measuring; a column is 8 bytes per cell       |
| A threshold change measures again         | 7–18 s per change on the demo                               | Per-cell histograms later; the default comes from the canvas contrast                                  |

## Docs To Update

- `docs/ui-reference.md`: the Image group in the Cell Query Panel section,
  `Resolution`, the threshold and `Radius`; the `query=` key's image column
  IDs.
- `docs/user-guide.md`: a walkthrough from a channel condition to a saved
  class.
- `docs/architecture.md`: the `measure` requests and `CellImageMeasurer`.
- `PLAN.md`: this phase's row.

## Open Questions

For the user, before M1:

1. **Default level.** Should the median cell cover 64 pixels (level 2 on
   the demo, about 540 MB for three channels) or about 250 (level 1, about
   1.9 GB)? Level 1 halves the share of pixels at the disc's edge, which
   mix with neighbours, but reads 3.6 times as much.
2. **Default threshold.** Should it be the canvas's contrast minimum (D6),
   or an automatic threshold, such as Otsu's on the channel's histogram?
3. **Cells without an area.** Should they use a fixed 5 µm radius field
   (D4), or the median area of a platform column where one exists, such as
   MERSCOPE's cell volume?
4. **Links.** Should a link with an image condition measure on opening
   (D9), or wait for a click?

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
