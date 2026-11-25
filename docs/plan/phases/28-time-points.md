# Phase 28 — Time Points

Planned 2026-11-25. Requested: `t` axis support for SpatialData, with a
`Play` button that steps through the time points on its own.

Today an image with a `t` axis opens, but shows one time point:
`omero.rdefs.defaultT`, else the first (`omeZarrLoader.ts:1313-1348`).
Nothing can choose another. Labels read the first plane of every axis but
x and y, so they show `t = 0` and `z = 0` whatever the image shows
(`spatialDataLabels.ts:577-583`).

The scope:

- A `Time point` slider in the Image section, under `Z plane`, for
  OME-Zarr images with more than one time point. That covers SpatialData
  images, plain OME-Zarr, Icechunk and zipped OME-Zarr, and OME-Zarr
  images attached to AnnData.
- `Play`, with a speed and `Loop`. It shows each time point once that
  point's visible tiles and outlines have loaded.
- Labels that follow the image's time point and z plane.
- `t` in the share link.

The decisions below were proposed on 2026-11-25. The user answered the
plan's four questions the same day
([Answered Questions](#answered-questions)); D6, D8, D11 and Later carry
the answers.

M1 (tasks B to D, choosing a time point) was built the same day:
[M1 Results](#m1-results-2026-11-25). The spike (task A) and M2 (tasks E to
G, Play) followed, also the same day: [Spike Results](#spike-results-2026-11-25)
and [M2 Results](#m2-results-2026-11-25). M3 (tasks H and I, labels at a
plane) came next: [M3 Results](#m3-results-2026-11-25).

**M4 (tasks J to L) has not been implemented.** Two parts were built ahead
of it, in PR 431: the 3D view at the chosen time point (part of
J) and two gallery examples (part of L). The rest is listed in
[M4 Status](#m4-status-2026-11-25).

The plan rests on a code map made on 2026-11-25 at `d52cc1c`. It is cited
below as `file:line`; line numbers drift as the code changes.

Sizes are for one developer: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

## SpatialData Has No Time Axis Yet

spatialdata 0.9.0 takes images as `(c, y, x)` or `(c, z, y, x)` and labels
as `(y, x)` or `(z, y, x)`. `Image2DModel.parse` with dims
`('t', 'c', 'y', 'x')` raises "Wrong `dims` … Expected ('c', 'y', 'x')"
(checked 2026-11-25). Its
[design document](https://spatialdata.scverse.org/en/latest/design_doc.html)
lists time axes as future work. So:

- No store that spatialdata writes today has a `t` axis. A store written
  another way can. The viewer reads the Zarr itself, not through
  spatialdata's models, so such a store opens.
- The work is in the OME-Zarr loader that SpatialData images use
  (`spatialDataDataset.ts:291-298`) and in the labels reader that
  SpatialData labels use. Plain OME-Zarr gets the feature at the same
  time, and that is where public time-lapse data is ([Data](#data)).
- The SpatialData test store is written by spatialdata with a z axis, then
  given a leading `t` axis with zarr-python (task L).

## Goals And Non-Goals

Goals:

- A `Time point` slider for any OME-Zarr image with a `t` axis longer
  than 1, wherever the `Z plane` control appears today.
- `Play` and `Pause`, a speed, and `Loop`. Play never shows a half-loaded
  time point.
- Stepping through time points makes no metadata requests. Recent time
  points replay from memory.
- Labels from SpatialData, AnnData `labels` and imported Zarr
  segmentations follow the image's time point and z plane.
- `t` in the share link. The 3D view reloads at the chosen time point.
  Screenshots record the time point.
- The axe baseline stays empty and `nativeTitleAudit` passes.

Non-goals:

- OME-TIFF time series. They show `t = 0`, as today
  (`omeMetadata.ts:348`). See [Later](#later).
- Play in the 3D view (answer 3), and a movie export (answer 4).
- Cells, shapes, points or tables that change over time. Nothing in
  SpatialData or AnnData places them in time.
- A `Time point` control for custom image layers. They have no `Z plane`
  control either (`docs/modalities/image.md:753-754`).

## Current State

### The Loader

- `openOmeZarrImageWithOptions` (`omeZarrLoader.ts:176-321`) holds one
  index for each axis other than x, y and channel (`planeIndices`,
  `:158-159`). Every read goes through `planeIndexAt` (`:1105-1115`):
  tiles (`:1092`), chunk reads (`:818-831`), chunk windows (`:981-992`)
  and volumes (`:647-655`). `planeIndexAt` also scales the index on a
  level that is downsampled along the axis. A `t` index therefore needs no
  change in the readers.
- `initialPlaneIndices` (`:1313-1348`) already opens `t` at
  `rdefs.defaultT`. It has no URL selection for `t`;
  `parseOmeZarrImageSelection` reads only `c` and `z` (`:1128-1141`).
- There is no `findOptionalTAxis`. `axesFromArray` does not type a Zarr v3
  `dimension_names` entry `t` as time (`:1252-1257`). The 5-D fallback is
  `t, c, z, y, x` (`:1264-1273`).
- Channel loader URLs carry only `z` (`:271-275`, `:1652-1654`), so a `t`
  in the opened URL would be lost for channels after the first.
- `levelMetaFromArray` and `withImpliedLevelScales` ignore extra axes
  (`:1374-1474`). Transformations pick x and y by name, so a `t` entry in
  a scale, translation or affine is ignored safely
  (`spatialDataTransforms.ts:142-158`, `:195-230`).

### The Z Plane Path

- The control is a native range input, `MorphologyZPlaneControl.tsx:16-49`,
  shown by `ImageZPlaneControl` (`ImageSectionBlocks.tsx:35-47`) in the
  Image section (`LayerPanel.tsx:339-360`).
- There is no separate z state. The plane is
  `morphologyImage.zStack.zPlane` (`morphologyImage.ts:38-44`).
  `zStack.openPlane(z)` returns a whole new `MorphologyImage`.
- `useMorphologyZPlaneWorkflow.ts:60-127` opens each slider step, with no
  debounce, aborting the previous one. `openPlane`
  (`morphologyImage.ts:413-459`) keeps channel loaders for 8 planes
  (`:72-74`).
- Each new plane reopens every channel from its URL:
  `morphologyChannelImageUrl` adds `#z=` (`morphologyImage.ts:570-615`).
  Each open makes a new store, reads consolidated metadata, the group and
  every level's array (`omeZarrLoader.ts:327-349`, `:176-321`). Task A
  counts the requests.
- The share link writes `z` whenever the image has a z-stack
  (`App.tsx:1969-1973`; `shareableState.ts:206`, `:709-711`), debounced
  160 ms (`useShareableUrlHash.ts:450-463`). The key `t` is unused.

### Tiles And Flicker

- Tile caches are keyed by the loader's URL (`MorphologyCanvas.tsx:509-516`),
  so each plane gets new caches. The tile store drops the old plane's
  caches and closes their bitmaps as soon as the canvas stops drawing them
  (`morphologyTileStore.ts:82-96`).
- The canvas keeps its old pixels until the first new tile is ready
  (`MorphologyCanvas.tsx:252-259`). Then it clears and draws only the ready
  tiles (`morphologyCanvas.ts:72`), so the new plane fills in tile by tile,
  with gaps and some channels missing. The lower-resolution fallback
  cannot help, because the new caches are empty at every level.
- There is no prefetch of other planes. The decode worker's 128 MB chunk
  cache (`zarrDecode.worker.ts:26`) is keyed by chunk coordinates
  (`omeZarrLoader.ts:981-996`). It helps only when a chunk holds several
  planes.
- `tileCacheMaxTiles` is 72, 120 or 180 per cache by budget
  (`performanceBudget.ts:23`, `:32`, `:41`).

### Labels

- The reader keeps only x and y (`spatialDataLabels.ts:633-653`). It reads
  chunk 0 on every other axis (`:577-583`), sends no `fixedAxes` to the
  worker (`:164`), and the worker ignores them (`zarrDecode.worker.ts:174-184`).
  The main-thread `labelWindow` has no base offset
  (`spatialDataLabelTrace.ts:29-62`).
- Traces are cached by `level/col/row` (`spatialDataLabels.ts:294`), up to
  192 MiB (`:101`), and rings by level and label (`:200`, `:449-458`). No
  key has a plane.
- `SpatialDataset.elements(bbox)` has no plane argument
  (`spatialDataset.ts:263`), and nor do its callers
  (`platformAdapter.ts:627`, `datasetBoundaries.ts:38`).
- `openOmeZarrLabels` drops a URL's hash (`omeZarrLoader.ts:370`,
  `:381-394`). Its callers are AnnData's attached labels
  (`h5adDataset.ts:1274-1295`) and imported segmentations
  (`importedSegmentation.ts:129-150`).

### Elsewhere

- The 3D view keys its volumes by root URL and level, without the plane
  (`useMorphologyVolumeWorkflow.ts:95-98`). A time point would load a
  stale volume.
- Screenshots use the canvas's channel loaders, so they draw the shown
  plane. The PNG records only the z plane (`screenshotModel.ts:38-50`,
  `screenshotRun.ts:64-72`).
- Cell Query's image columns are keyed by the z plane
  (`useCellQueryModel.ts:451-456`).
- Auto contrast runs once, when the image opens
  (`useDatasetLifecycle.ts:1046-1049`). It stays the same across z planes.
- The app has no play button, timer stepping, or play and pause icons.
  Reduced motion is handled only in CSS (`responsive.css:27-36`).
  `useNarrowScreen.ts:1-28` is a `matchMedia` hook pattern to follow.

## Product Decisions

Proposed 2026-11-25. D6, D8 and D11 are settled by the user's answers the
same day; the others stand as proposed.

- **D1. The time axis** is the first axis named `t` (in any case) or
  typed `time`. `axesFromArray` types a v3 `dimension_names` `t` as time.
  An image with one time point shows no control.
- **D2. The opening time point**, in order:
  - the share link's `t`;
  - the image URL's `#t=N`, 0-based like `#z=`;
  - `omero.rdefs.defaultT`;
  - the first.
- **D3. The label** reads `22 / 40`. When the `t` axis has a unit, the
  time since the first point follows: `22 / 40 · 63 min`. The value is the
  index times the `t` scale, in the axis's unit and its symbol (ms, s,
  min, h, d), as the z depth is shown in µm. idr0052A has no unit, so it
  shows only the position.
- **D4. One plane, `{ z, t }`.**
  - `MorphologyImage` gains `timeSeries: { sizeT, timePoint, interval? }`
    beside `zStack`.
  - `openPlane({ z?, t? })` replaces `zStack.openPlane(z)`.
  - The loader cache is keyed `z:t`. TIFF images have no `t`.
- **D5. Planes without reopening.**
  - An OME-Zarr loader makes a sibling at another plane from what it has
    already opened (`atPlane`). The sibling shares the arrays, levels,
    channel info and decode pool.
  - Its URL carries the plane in the hash, so tile caches and the chunk
    cache keep planes apart.
  - A step makes no metadata requests. Z steps use the same path.
  - TIFF keeps its `#ifd=` reopen.
- **D6. The frame stays until the next one is whole** (answer 2).
  - On a time point or z plane change, the canvas keeps drawing the old
    plane until every visible channel's tiles at the requested level are
    ready. Then it switches in one draw.
  - A slider step falls back to today's tile-by-tile fill after 2 s, so a
    slow host still shows progress. Play waits as long as it takes.
  - Z steps get this too. It is the same code path, and it removes the
    half-drawn composites seen today.
- **D7. The controls.**
  - A `Play`/`Pause` icon button left of the `Time point` slider.
  - Under them, a `Speed` select (1, 2, 5, 10 or 20 time points a second;
    5 to start) and a `Loop` checkbox (on to start).
  - Play at the last time point with `Loop` off starts again from the
    first.
  - The layer summary reads `t 22 of 40`, as it reads `z N of M`
    (`layerPanelModel.ts:81-85`). Dataset info lists the time points
    (`datasetInfoModel.ts:168-169`).
- **D8. How Play advances** (answer 2). The next time point is shown when
  both of these hold:
  - 1/speed seconds have passed since the last one;
  - it is whole: its image tiles (D6) and its label outlines (D9) for the
    current view.

  While it waits past the interval, the label shows `…` and the control
  is `aria-busy`, as the z control is now. Caching works like this:
  - The next K time points are prefetched while one is shown, one tile at
    a time for each channel, so the shown one's reads go first: K is 1 on
    the compact budget, 2 balanced and 3 expanded.
  - Shown time points stay in a cache of up to 4 × `tileCacheMaxTiles`
    tiles of 256 × 256 pixels (288, 480 or 720; about 72, 120 or 180 MB),
    so a short loop replays from memory. It is counted in pixels, so larger
    tiles count for more. idr0052A's 40 time points × 3 channels at 256 px
    are 120 tiles.
  - Panning, zooming, a z change or a channel change restarts the
    prefetch.

- **D9. Labels follow the image's plane.**
  - SpatialData labels, AnnData `labels` and imported Zarr segmentations
    with a `t` axis read the image's time point. Those with a `z` axis
    read the image's z plane, which closes the gap "labels read only
    `z = 0`".
  - The index is mapped as the loader maps a downsampled axis.
  - If a label axis's length differs from the image's, the index is
    clamped, and the activity log says so once.
  - TIFF labels and polygons do not change.
- **D10. When Play stops.**
  - It stops when the user moves the time slider (arrow keys included),
    opens another dataset, switches to 3D, starts a screenshot, or hides
    the page, or when a time point cannot be read (logged).
  - Changing z, panning, zooming, channels or contrast does not stop it.
  - It never starts on its own. A link restores the time point, not
    playback. Since the user starts Play and can pause it, this meets
    WCAG 2.2.2.
- **D11. The 3D view** (answer 3). The slider stays and reloads the
  volume at the chosen time point; the volume key gains `t`. `Play` is
  hidden in 3D.
- **D12. The share link** writes `t` whenever the image has time points,
  as it writes `z`. During Play it is written when Play stops, not on
  every time point.
- **D13. Contrast stays fixed across time points**, as it does across z
  planes.
  - Auto contrast runs on the opening time point. `Auto contrast` samples
    the shown one.
  - The histogram and its Otsu threshold come from the opening time
    point.
  - Contrast that changed with each time point would flicker during Play.
- **D14. Screenshot and Cell Query.**
  - A screenshot stops Play and captures the shown time point. The PNG's
    Description adds `time point 22 of 40`, and the time when D3 gives
    one.
  - Cell Query's image columns measure at the shown `{ z, t }`. While Play
    runs they keep the last measured time point, and the column header
    says which. They are measured again when Play stops.
- **D15. Cells, shapes, points and tables stay the same at every time
  point.** The docs say so.
- **D16. Accessibility.**
  - The button's name and `title` are `Play time points` or
    `Pause time points`. The slider is labelled `Time point`, with
    `aria-valuetext`.
  - No live region announces each time point.
  - No single-key shortcut; one waits on the shortcut decision in
    [Open Items](../open-items.md).
  - Reduced motion changes nothing: Play is started by the user and steps
    without tweening.
  - Play and pause icons are added to `icons.tsx`.

## How Play Runs

As built in M2:

1. `Play` (`useTimePointPlayback`) hands the canvas the next K time points
   at the shown z plane as prefetch planes. The canvas makes their channel
   loaders with `atPlane` (D5), without requests, and reads their visible
   tiles at the current level, one at a time for each channel.
2. Once the canvas reports the shown time point drawn whole, a timer of
   1/speed seconds starts. When it fires, the next time point is asked for
   through the plane workflow, as a slider step is.
3. The canvas keeps drawing the shown time point until the visible tiles of
   the new one are read (D6), then draws it in one draw and reports it. A
   prefetched time point is usually whole already, so it shows at once.
4. The time point it replaced stays in the tile store's replay cache, and
   step 1 runs for the next ones. With `Loop` off, Play stops after the last
   time point.
5. Anything in D10 stops it. Prefetch reads are aborted; read tiles stay in
   the replay cache.

Since M3, label outlines that follow the plane take part: the next time
points' outlines are read ahead for the last area read, and the canvas holds a
new time point until the outlines read at its plane have come (D9).

## Data

- **idr0052A, image 5514375** (`https://livingobjects.ebi.ac.uk/idr/zarr/v0.4/idr0052A/5514375.zarr`):
  - OME-Zarr 0.4; axes `t, c, z, y, x`; 40 × 3 × 31 × 256 × 256 uint16;
    one chunk per `(t, c, z)`, 80–130 KB each with Blosc LZ4; 3 levels.
  - `rdefs` gives `defaultT` 21 and `defaultZ` 15. Channels are NCAPD2,
    DNA and NEG_Dextran.
  - Label images `labels/Cell` and `labels/Chromosomes` are 40 × 1 × 31 ×
    256 × 256 int8, in chunks of 10 × 1 × 8 × 128 × 128, with 4 levels.
  - It has CORS. Licence CC BY 4.0. Walther N et al. (2018) A quantitative
    map of human Condensins provides new insights into mitotic chromosome
    architecture. _J Cell Biol_ 217(7):2309–2328.
    doi:10.1083/jcb.201801048.
  - The app does not open an OME-Zarr image's own `labels/` group. The
    label test imports `labels/Cell` as a segmentation, which uses
    `SpatialDataLabelsReader` (`importedSegmentation.ts:129-150`).
  - The gallery example `examples/idr/idr0052-mitosis.json` names
    `labels/Cell` as its segmentation (`label-zarr`).
- **idr0051, the tailbud preview**
  (`https://livingobjects.ebi.ac.uk/idr/zarr/v0.5/idr0051/180712_H2B_22ss_Courtney1_20180712-163837_p00_c00_preview.zarr`):
  - OME-Zarr 0.5, sharded; axes `t, c, z, y, x`; 79 × 1 × 201 × 333 × 333
    uint16; 2 levels. A shard per time point (13.3 MB at level 0) holds
    one-plane inner chunks with Blosc Zstd.
  - No pixel size or time step, here or in IDR (image 4007817 is the same
    333-pixel preview), so the app assumes 1 µm per pixel; the study images
    every 2 minutes. `rdefs` gives `defaultZ` 100 and `defaultT` 0.
  - The signal fades over the series, and contrast is set on the opening
    time point (D13), so the gallery example
    `examples/idr/idr0051-tailbud.json` opens at `#t=39`.
  - Play kept up at speed 5 and 10 (4.8 and 9.5 a second, first pass) and
    reached 18 a second at speed 20 from the replay cache; the 3D view reads
    one shard per time point. Licence CC BY 4.0. Attardi A et al. (2018)
    Neuromesodermal progenitors are a conserved source of spinal cord with
    divergent growth dynamics. _Development_ 145(21):dev166728.
    doi:10.1242/dev.166728.
- **idr0109A, image 12922361**, the heavy case
  (`https://livingobjects.ebi.ac.uk/idr/zarr/v0.3/idr0109A/12922361.zarr`):
  - OME-Zarr 0.3; axes `t, y, x` with no channel axis; 721 × 2160 × 2560
    uint16; 6 levels. Each chunk is a whole plane: 6.9 MB at level 0 and
    457 KB at level 2.
  - Licence CC BY 4.0.
- **Fixtures:**
  - The loader tests' `zStackOmeZarrFiles` (`omeZarrLoader.test.ts:1319-1373`)
    gains an optional `t` axis, with pixel value `100t + 10c + z + 1`.
  - A small SpatialData store with a `t, c, z, y, x` image and
    `t, z, y, x` labels, written as described above, for the end-to-end
    test.

## Tasks

- [x] **A. Spike.** (S) In a production build, in Playwright with Metal
      WebGL, record in this file:
  - On idr0052A, for one z step today: requests (metadata and chunks),
    time to the first tile, and time to the whole frame. Then the same
    with a throwaway `atPlane`.
  - The highest steady rate of whole time points on idr0052A at the
    default zoom, and on idr0109A at whole-image zoom.
  - The time to trace `labels/Cell` for a time point and to update the
    boundary layer.
  - Bitmap memory per time point.
  - Revisit K and the replay cache in D8, and the 2 s fallback in D6, if
    the numbers call for it.
- [x] **B. The loader.** (M) `findOptionalTAxis`; `#t=` parsed
      (`parseOmeZarrImageSelection`) and kept in channel URLs; a
      `selectedTIndex` for `initialPlaneIndices`; `timeSeries` on the
      loader (`sizeT`, `defaultTimePoint`, `interval`); `atPlane` (D5).
  - Tests: `t` selection, `defaultT`, a `t` downsampled across levels,
    `atPlane` making no fetches, channels keeping `t`, the v3
    `dimension_names` case, a `t` axis without a channel axis.
- [x] **C. The plane in the app.** (M) `MorphologyImage` with
      `timeSeries` and `openPlane({ z?, t? })` (D4); the loader cache keyed
      `z:t`; `t` restored from the link (D2) and written to it (D12); the
      layer summary and dataset info (D7).
  - Tests in `morphologyImage.test.ts`, `shareableState.test.ts`,
    `layerPanelModel.test.ts` and `datasetInfoModel` tests.
- [x] **D. The slider.** (S) `MorphologyTimePointControl` beside the z
      control, and the plane workflow generalised from
      `useMorphologyZPlaneWorkflow`. Tests as for the z control.
- [x] **E. Whole-frame swaps.** (M) The canvas keeps the old plane's caches
      until the new plane's tiles at the requested level are ready (D6),
      with the 2 s fallback for slider steps.
  - Tests with a fake loader: no partial draw, the fallback, and a swap
    cancelled by another step.
- [x] **F. Prefetch and the replay cache.** (M) Prefetch planes for the
      canvas: tiles requested without drawing, at low priority, with a
      ready report. The replay cache and its tile limit (D8).
  - Tests: priority over the shown plane, eviction closes bitmaps, a view
    change restarts the prefetch.
- [x] **G. Play.** (M) `useTimePointPlayback`: the interval and readiness
      gate (D8), `Speed`, `Loop`, the stop rules (D10), and the icons.
  - Tests with fake timers: a slow time point delays the next one; it
    never skips; each D10 stop.
- [x] **H. Labels at a plane.** (M) `SpatialDataLabelsReader` records its
      `t` and `z` axes. Chunk coordinates and `fixedAxes` follow the plane
      in the worker and on the main thread. The plane goes into the trace
      and ring keys. `outlines(bounds, { plane })`. The clamp and log (D9).
  - Tests in `spatialDataLabels.test.ts` with a 4 × 2 label image over
    `t` and `z`.
- [x] **I. Labels in the datasets.** (M) A plane for `elements(bbox)` in
      SpatialData, AnnData's attached labels and imported segmentations;
      boundaries read again on a plane change; outline readiness for Play
      (D8).
  - Tests in `spatialDataDataset.test.ts` and `datasetBoundaries` tests.
- [ ] **J. 3D, Screenshot and Cell Query.** (S) The volume key with `t`
      and `Play` hidden in 3D (D11), done; the PNG Description, and Play
      stopped by a screenshot (D14); Cell Query image columns keyed by
      `{ z, t }` and paused during Play (D14).
- [ ] **K. Docs.** (S) [Docs To Update](#docs-to-update).
- [ ] **L. End-to-end tests and the example.** (M)
  - The SpatialData fixture store, written with spatialdata 0.9.0 and a
    `t` axis added with zarr-python, and its generator script beside
    `make_image_store.py`.
  - Playwright on the fixture: open at `defaultT`, step, Play to the next
    time point with a known pixel and a known outline, the link restoring
    `t`. Run it on a port other than 4173.
  - The axe test with the control shown; the baseline stays `{}`.
  - Gallery examples in `examples/idr/` (done): idr0052A, opening at
    `defaultT` with `labels/Cell` as its segmentation, and idr0051, opening
    at its middle time point. Still to do: a nightly `@live` test that plays
    five time points.

## Order And Size

| Milestone            | Contents | Size                                                                   |
| -------------------- | -------- | ---------------------------------------------------------------------- |
| M0 — Spike           | A        | S                                                                      |
| M1 — Choosing a time | B to D   | About 1 week                                                           |
| M2 — Play            | E to G   | About 1 week                                                           |
| M3 — Labels follow   | H, I     | About 1 week                                                           |
| M4 — The rest        | J to L   | About 4 days; not implemented (see [M4 Status](#m4-status-2026-11-25)) |

- M1 is useful on its own: a slider, the link and `defaultT`. It can merge
  before Play.
- A and B can go in parallel. E needs A's numbers. H can start any time
  after B.
- One PR per milestone against `main`, in order. The total is about four
  weeks.

## M1 Results (2026-11-25)

Tasks B to D, on the plan's branch.

- **The loader** (`omeZarrLoader.ts`): `findOptionalTAxis`; `#t=` parsed and
  kept in channel URLs, written before `z` (`#c=1&t=3&z=1`); `timeSeries` with
  `sizeT`, `defaultTimePoint` and `timeStep`; `atPlane`. A loader keeps the
  one it was opened as its root, and every plane is derived from the root, so
  the root's own plane gives the root back, with its URL and caches. Time
  units have symbols in `timeUnits.ts`.
- **The image** (`morphologyImage.ts`): `openPlane({ z?, t? })` moved from
  `zStack` to the image, with `timeSeries` beside `zStack`. For a loader with
  `atPlane`, the channels are opened once at the loader's plane and each plane
  is derived from them; TIFF still opens each plane's `#ifd=`. The cache of 8
  planes is keyed `z:t`.
- **The workflow**: `useMorphologyZPlaneWorkflow` became
  `useMorphologyPlaneWorkflow`. A z step and a time step share one request, so
  a time step made while a z plane is opening keeps that z.
- **The rest of M1**: `MorphologyTimePointControl` under `Z plane`; `t` in the
  share link and restored on open; `t N of M` in the layer summary; time points
  in dataset info.
- **Taken from task J**: Cell Query's image columns are keyed by the time
  point too (`time{n}` in the column ID, as `t` is the threshold's), so a
  column measured at one time point is not shown at another. They are not yet
  paused during Play (D14).
- **Checked** in the dev build on idr0052A: it opens at `z=15&t=21` from
  `rdefs`; time point 31 shows the cell later in mitosis; a reload restores
  `t=30` from the link. 3,919 unit tests pass.
- **Not yet**: the spike's request counts and timings (task A).

## Spike Results (2026-11-25)

A production build of `main` (`d52cc1c`) and of the M1 branch, each served
by `vite preview`, measured in Playwright with Metal WebGL at 1500 × 900 on
idr0052A from livingobjects.ebi.ac.uk, a fresh browser context per run. The
counts include the minimap, which draws the image too.

| Step                | Metadata requests | Chunk requests | First draw | Whole frame |
| ------------------- | ----------------- | -------------- | ---------- | ----------- |
| z, `main` (reopens) | 36                | 9              | 310–335 ms | 370–435 ms  |
| z, with `atPlane`   | 0                 | 6              | 45–60 ms   | 120–165 ms  |
| t, with `atPlane`   | 0                 | 6              | 185–195 ms | 305–450 ms  |

- Each step reads about 355 KB, one chunk per channel for the canvas and
  one for the minimap. The t steps drew first about 140 ms later than the z
  steps. Both make the same requests through the same code, so the gap is in
  how fast the host answers them, perhaps from its cache.
- **Steady rate without prefetch**, stepping as soon as each frame was
  whole: idr0052A 270–350 ms per time point (about 3 a second; one step of
  5.3 s was a stalled request), and idr0109A at the whole-image zoom about
  340 ms (2.9 a second, 480 KB per step). Reading one time point at a time
  cannot reach the default speed of 5, which is why M2 prefetches.
- **Bitmap memory** per time point at the default view: idr0052A 0.75 MB
  (3 channels × 256 × 256 RGBA), idr0109A 1.32 MB (640 × 540). The replay
  limit in D8 was changed to count pixels rather than tiles, so a 512-pixel
  tile counts as four.
- **The 2 s fallback** (D6) stays: whole frames took well under 0.5 s.
- **Label tracing** was measured in M3:
  [M3 Results](#m3-results-2026-11-25).

## M2 Results (2026-11-25)

Tasks E to G, on the plan's branch.

- **Whole-frame swaps** (`MorphologyCanvas.tsx`): the canvas takes a `frame`
  (image and plane). On a change to another plane of the same image it keeps
  drawing the shown plane's tiles, at the current view, until the new
  plane's visible tiles at the requested level are read or failed for good;
  then it draws the new plane at once and calls `onFrameShown`. After
  `frameFallbackMs` (2 s; Infinity while playing) tiles draw as they come.
  The minimap gets the frame too. A step made while another is pending
  replaces it; the shown plane stays until the newest is whole.
- **Prefetch and replay** (`morphologyTileStore.ts`): `prefetchPlanes`
  makes each plane's loaders with `atPlane` and reads their visible tiles,
  one at a time per channel. A loader now keeps the last 16 loaders it made,
  so a prefetched plane is shown with the same loader and its reads carry
  on. Channels of a replay group (one channel of one image in one colour
  and contrast) that no canvas draws stay in the store, the most recent
  first, up to the pixel limit in D8; a contrast or colour change drops
  them. New caches are sized without counting kept channels.
- **Play** (`useTimePointPlayback.ts`): `Play time points` / `Pause time
points` left of the slider, `Speed` and `Loop` under it, hidden in 3D.
  The next time point is asked for 1/speed seconds after the shown one was
  drawn whole. Play stops for good on a slider move, another image, the 3D
  view, a screenshot, a plane that fails to open, or a hidden page. While it
  runs, the link keeps the time point it started from (D12). The shown frame
  lives outside React state (`ShownMorphologyFrame`), so each shown time
  point re-renders only the plane controls; both plane controls stay
  `aria-busy` until the canvas shows their plane.
- **Measured** in the same production set-up as the spike, on the M2 build:

  | Image    | Speed | Played time points | Rate     | Partial draws |
  | -------- | ----- | ------------------ | -------- | ------------- |
  | idr0052A | 5     | 29 in 6.1 s        | 4.8 / s  | 0             |
  | idr0052A | 10    | 49 in 6.1 s        | 8.0 / s  | 0             |
  | idr0052A | 20    | 45 in 6.2 s        | 7.3 / s  | 0             |
  | idr0052A | 20    | 283 in 16.1 s      | 17.5 / s | 0             |
  | idr0109A | 5     | 39 in 8.1 s        | 4.8 / s  | 0             |

  The 16 s run played the 40 time points from the network once (234
  requests) and then replayed them from memory with no requests. Reading from
  the host reached about 7–8 time points a second.

- **Not yet**: labels at a plane (M3); Cell Query paused during Play, the
  3D volume key with `t`, and the screenshot PNG's time point (task J).

## M3 Results (2026-11-25)

Tasks H and I, on the plan's branch.

- **The reader** (`spatialDataLabels.ts`): each level records its `z` axis
  and its `t` axis (named `t` or typed `time`). For an image plane it reads
  the chunk holding the plane and the plane's index inside it
  (`fixedAxes`), on the main thread (`labelWindow` gained an offset) and in
  the worker (which now honours `fixedAxes`). Indices are clamped to the
  labels' own length and scaled on a downsampled level. The plane is part
  of the trace key and the ring cache key (8 planes a level kept); 2D labels
  have one key at every plane, so nothing is traced again. A chunk that
  holds several planes is read once for all of them (32 MB of stored chunk
  bytes kept): idr0052A's label chunks hold 10 time points × 8 z planes.
  `followsPlanes` and `planeNotice` tell the datasets what the labels do.
- **The datasets**: `elements(bbox, { plane })` on SpatialData and AnnData,
  and `outlines(bbox, { plane })` on imported segmentations. A batch from
  labels that follow the plane names it (`plane`, as `imagePlaneKey` writes
  it, `z:t`) and says when the labels are shorter than the image
  (`planeNotice`, logged).
- **The boundaries**: the viewport workflow puts the image plane in the cell
  outline request key, so a step reads the outlines again; the outlines drawn
  stay until the new ones come. The load state carries the plane of the
  outlines drawn, and the canvas holds a new plane until it matches
  (`outlinesPlane`), unless the outlines are hidden, deferred, over the limit
  or failed. While Play runs, the next time points' outlines are read ahead.
- **The Play row**: Play sits left of the slider and `Speed` and `Loop`
  share the row under it; M2 had left the row without its CSS.
- **Measured** on idr0052A with `labels/Cell` imported as a segmentation,
  in the spike's set-up (production build, Playwright, Metal):

  | Case                                      | Result                           |
  | ----------------------------------------- | -------------------------------- |
  | One time step, image and outlines shown   | 111–158 ms (image alone 111–235) |
  | Play at speed 5, outlines read on showing | 3.1 / s, 76 label requests       |
  | … with outlines read ahead                | 4.6 / s, 124 label requests      |
  | … and chunks read once for their planes   | 4.7 / s, 12 label requests       |
  | Play at speed 10                          | 5.5–9.3 / s, 12 label requests   |

  Every draw during Play had all three channels. Screenshots at time points
  22 and 1 show the outline following the cell from division back to one
  nucleus. One run at speed 20 drew three partial frames for a time point
  stuck behind a slow request; the timing fits the 2 s fallback after the
  script pressed Pause. Four more runs that marked the pause showed no
  partial draw, during Play or after.

- **Not yet**: the SpatialData fixture with a `t` axis and the end-to-end
  test (task L).

## M4 Status (2026-11-25)

M4 has not been implemented. Two parts were built ahead of it; the rest is
open.

- **Not implemented:**
  - task J: the time point in the screenshot PNG's Description (D14), and
    Cell Query's image columns paused during Play (D14). Play already stops
    for a screenshot (M2), and Cell Query's image columns are keyed by the
    time point (M1);
  - task K: the docs pass over [Docs To Update](#docs-to-update);
  - task L: the SpatialData fixture with a `t` axis and its generator, the
    Playwright end-to-end test, the axe test with the control shown, and the
    nightly `@live` test that plays five time points.
- **Gallery examples** (part of task L): `examples/idr/idr0052-mitosis.json`
  and `examples/idr/idr0051-tailbud.json`; see [Data](#data).
- **3D at a time point** (part of task J, D11):
  - `useMorphologyVolumeWorkflow` keys volumes by image root, level and time
    point. A time step keeps the drawn volumes as `held` while the new time
    point's channels are read, and draws them together once each is read or
    has failed. A step during a read aborts it and keeps holding what is
    drawn.
  - The 3D view reports its shown frame to its own `ShownMorphologyFrame`,
    which the plane controls follow while 3D is open. Before, they followed
    the 2D canvas under the 3D view, which drew the new time point in about
    0.3 s while the volume stayed at the old one.
  - Measured in the spike's set-up, one step in 3D:

    | Image                                | Whole volume | Requests |
    | ------------------------------------ | ------------ | -------- |
    | idr0052A, 3 channels, 256 × 256 × 31 | 3.6 s        | 99       |
    | idr0051, 1 channel, 333 × 333 × 201  | 2.6 s        | 7        |

    The requests include the 2D canvas's tiles under the 3D view. Five fast
    steps on idr0052A made 219: each step's aborted read had started some
    chunk reads. A screenshot mid-read shows the last time point's volume,
    not a blank view.

## Risks

| Risk                                            | Effect                                                        | Mitigation                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Every step reopens Zarr metadata                | Requests and delay per time point, per channel                | `atPlane` (D5); the spike counts the requests before and after                             |
| Bitmaps for prefetched and replayed time points | Memory grows during Play                                      | K and the tile limit by budget (D8); bitmaps closed on eviction; the spike measures memory |
| Outlines rebuilt for every time point           | The boundary layer updates on each step; slow with many cells | Outlines are read ahead (D8); stable DeckGL props; the spike times it                      |
| An aborted prefetch on a sharded store          | zarrita aborts other reads of the same shard                  | Tile reads already retry foreign aborts (`getRetryingForeignAborts`)                       |
| Whole-plane chunks (idr0109A)                   | 6.9 MB per time point at level 0                              | Play waits (D6); the level follows the zoom; the nightly test uses idr0052A                |
| Large arrays in React props                     | React 19's dev build walks them, and dev tabs crash           | Plane loaders and outlines stay out of props, in private fields                            |
| Hidden tab                                      | No animation frames, timers throttled                         | Play stops when the page is hidden (D10)                                                   |

## Docs To Update

- `docs/ui-reference.md`: the `Time point` control, `Play`, `Speed`,
  `Loop`, and the `t` link key.
- `docs/user-guide.md`: time-lapse images under the image controls.
- `docs/modalities/image.md` (`:546-550`, `:751-752`),
  `docs/modalities/spatialdata.md` (`:394-396`),
  `docs/image-only-and-geojson.md` (`:40-41`, `:79-80`): time points,
  labels following the plane, and cells staying the same over time.
- `docs/plan/data-contracts.md` 5.5 (`:161-163`) and 5.6: the time axis
  and label planes.
- `docs/plan/phases/09-ome-zarr.md` and `10-spatialdata.md`: close the
  `t` and label z gaps. `docs/plan/open-items.md`: the `t` part of the
  OME-Zarr item.
- `PLAN.md`: this phase's row.

## Answered Questions

Answered by the user on 2026-11-25 and folded into the decisions.

1. **OME-Zarr only.** OME-TIFF time series are under [Later](#later).
   Reading OME-TIFF planes at `t > 0` was the other choice, adding about
   2–4 days.
2. **Play waits for whole time points** (D6, D8), rather than keeping the
   set speed and drawing whatever tiles have arrived.
3. **The slider works in 3D; Play is 2D only** (D11). Play in 3D, with
   volumes prefetched within a memory limit, is under [Later](#later).
4. **A movie export later.** A WebM video and a PNG sequence were the
   other choices.

## Later

- OME-TIFF time series: `TiffData` and IFDs located for `T`, and a `sizeT`
  on the TIFF loader (`omeMetadata.ts:260-359`).
- Play in the 3D view.
- Export the played time points as a WebM video or a zip of PNGs, using
  the screenshot renderer.
- Contrast sampled across time points.
- Real time stamps from OME-XML `Plane DeltaT` (bioformats2raw's
  `OME/METADATA.ome.xml`).
- An OME-Zarr image's own `labels/` group shown without importing it.
- A `Time point` and `Z plane` control for custom image layers.
- A manifest default time point.
- A keyboard shortcut for Play.
