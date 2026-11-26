# Phase 16 — SVS (Aperio) Images

Shipped 2026-11-13. Requested as an efficient reader for SVS, the common
format for H&E whole-slide scans, using BioImage Archive `S-BSST129`
(`HR10036-BL117659-94605_N2.svs`: 24 MB, Aperio AT2, JPEG 2000 tiles of
240 px, 11,952 × 8,842 and one 4× level, 0.503 µm/px). The URL first given,
in `S-BSST383`, returns 404: that study's `Files/` folder is no longer on the
EBI FTP server.

## Product Decisions

- **DECISION:** Read SVS in the TIFF loader, sharing the top-level IFD
  pyramid code with QPTIFF, rather than a new platform. It is an image-only
  source, a custom layer, or a manifest `image` like any TIFF. See
  [image.md](../../modalities/image.md#svs).
- **DECISION:** Every tiled IFD is a level, as OpenSlide reads SVS. The IFD
  walk uses 64 KiB blocks and stops at the label: 5 range requests to open
  the slide above, against 10 reading exact ranges.
- **DECISION:** Decode 8-bit RGB JPEG tiles with the browser's decoder in the
  decode worker (about 1 ms against 15 ms per 256-pixel tile), adding an
  Adobe marker to Aperio's RGB tiles, which browsers would read as YCbCr.
- **DECISION:** Read SVS tiles in runs of neighbours stored back to back (at
  most 16 tiles, 1 MiB), since a tile is only a few KB and EBI answers each
  request in 150 ms to several seconds. Other TIFFs keep one request per tile.
  **Superseded** (2026-11-17): every tiled TIFF level reads runs, made only
  of tiles the view has queued (see [Follow-Up](#follow-up-2026-11-17)).
- **DECISION:** Send every TIFF tile `Range` request with
  `cache: 'no-store'`. Chromium's HTTP cache let one request at a time use a
  file's cache entry, so tile requests to one file ran one after another
  whatever the scheduler allowed; tiles are cached in IndexedDB already.
- **DECISION:** Size the tile request, cache, and concurrency budgets by tile
  area, up to 4× for small tiles. With 120 tiles the overview of the slide
  above (130 tiles) drew with black gaps at its edges.

## Delivered

- [x] `.svs` detection (`imageKind: 'svs'`), and `Aperio` descriptions in
      files with a `.tif` name.
- [x] Levels from tiled IFDs, pixel size from `MPP`, per-level `JPEGTables`,
      per-level tile offsets read on the level's first tile, and zero-length
      tiles drawn transparent.
- [x] JPEG colour for Aperio RGB tiles and for YCbCr tiles (Leica GT450,
      Grundium). YCbCr JPEG tiles of any TIFF were drawn with wrong colours
      before.
- [x] Native RGB channels are not auto-contrasted at load (the slide above
      would decode all 130 coarse tiles on the main thread for a window RGB
      ignores).
- [x] Tile edges snapped to whole pixels (seams showed on white backgrounds),
      and a minimap cache that holds the coarsest level.
- [x] Measured in headless Chromium at 1,400 × 900 against a local copy with
      300 ms added per request: the overview took 169 requests and 53.6 s
      before the cache and run changes, and 41 requests and 5.3 s after.
      Live from BioImage Archive, with EBI answering in 7 to 14 s per
      request that day (six parallel requests took as long as one), the
      slide opened in 27 s, and the overview and minimap were complete after
      188 s and 47 requests.
- [x] Opened from BioImage Archive `S-BIAD2323` (prostate biopsies, CC BY
      4.0): a Leica GT450 slide (BigTIFF, YCbCr JPEG, five 2× levels, 240
      tiles in the overview) complete in 25.6 s with 72 requests, and a
      Grundium slide (512-pixel tiles) in 8.7 s with 18. CMU-1 (Aperio JPEG
      with per-level tables) was opened through a local CORS proxy, since
      the OpenSlide test-data host sends no CORS headers.
- [x] Unit tests with an in-memory SVS served by range requests, and real
      JPEG tiles (Aperio RGB with `JPEGTables`, JFIF YCbCr).

## Follow-Up (2026-11-17)

The four Known Gaps of 2026-11-13, closed together.

Decisions:

- **DECISION:** Show the slide images (label, macro, thumbnail) in the info
  drawer, label first, rather than as layers: they are photographs of the
  glass slide, not aligned with the image. Each opens on its own as
  `#ifd=N` on the slide's URL, as NDPI's macro does, at 1 µm per pixel. The
  macro's IFD is read when the drawer lists them, so opening a slide still
  stops at the label.
- **DECISION:** The minimap of an RGB slide draws its thumbnail, stretched
  over the slide (the loader's `overview`); the main view keeps the pyramid
  levels. A single-channel or fluorescence slide's minimap keeps the coarsest
  level, so it matches the channel's colour and window.
- **DECISION:** Read runs for every tiled TIFF level (OME-TIFF, QPTIFF, SVS,
  page pyramids), made only of tiles the view has queued: the scheduler
  passes its queue (`upcoming`) with each fetch. A run no longer reads
  neighbours outside the view (the old rule took anything within 4 tiles),
  so larger tiles cost no wasted bytes. The 16-tile and 1 MiB limits stay;
  Xenium's 1,024-pixel JPEG 2000 tiles (400–670 KB) are read one per request
  as before.
- **DECISION:** A tile whose bytes come from another tile's run gives up its
  scheduler slot (`onSharedRead`), so the limit counts requests, not tiles
  waiting.
- **DECISION:** Cancel a run when every tile waiting for it has left the
  view, now that runs can be up to 1 MiB of large tiles; its unclaimed tiles
  are read again if wanted later. A run leaves out tiles another run is
  reading.
- **DECISION:** Name an Aperio FL channel file's channel by `Dye` and draw it
  in `DisplayColor`. `Acquisition Bit Depth` (10) is not used for the
  window: the Zenodo files' samples span 117 to 65,472.

Delivered:

- [x] Slide images in the info drawer (`SlideImages`), with `Open` links;
      `associatedImages` on SVS loaders; `#ifd=N` for associated images.
      Checked on CMU-1-Small-Region, the S-BSST129 slide, and the Zenodo FL
      files.
- [x] The minimap draws the thumbnail: one strip read (132 KB) instead of
      the 130 tiles of the S-BSST129 slide's coarsest level.
- [x] Runs from the scheduler's queue for every tiled TIFF, cancellable runs,
      and slot release for tiles riding on another's run.
- [x] Measured against `main` (below).
- [x] Tried an Aperio fluorescence scan: Zenodo
      [10.5281/zenodo.841835](https://zenodo.org/records/841835) (CC BY 4.0),
      a ScanScope FL scan exported by ImageScope as one SVS-layout `.tif` per
      channel (DAPI, Alexa Fluor 568; 858 MB each, uncompressed 16-bit
      256-pixel tiles, 18,417 × 21,256 and two 4× and 8× levels, 0.4626 µm)
      plus an `.afi` XML that lists them. A channel file opens as one channel,
      now named by its dye in its scanner colour; the second channel opens as
      a custom layer over it. No public SVS with every channel in one file
      was found: Aperio FL writes one file per channel, and Aperio Versa
      fluorescence is `.scn`.
- [x] `scripts/range-server.mjs`: `--delay`, a user agent Zenodo accepts, and
      mirrors refuse requests without `Range` (a browser tab on a mirror had
      started copying the whole 13 GB file).

Measurements: headless Chromium (Metal) at 1,400 × 900, local copies served
with 300 ms added per request (`scripts/range-server.mjs --delay 300`),
`main` at `1019e26` against this branch, two runs each with the same
result. Times are to the last tile response.

| File                                        | Before                      | After                               |
| ------------------------------------------- | --------------------------- | ----------------------------------- |
| S-BSST129 SVS, overview and minimap         | 41 requests, 1.8 MB, 5.9 s  | 15 requests, 1.3 MB, 3.0 s          |
| S-BIAD2491 QPTIFF (gallery tonsil, DAPI)    | 33 requests, 11.4 MB, 5.7 s | 17–18 requests, 11.1–11.5 MB, 4.1 s |
| Xenium demo `morphology_focus_0000.ome.tif` | 77 requests, 1.7 MB         | The same                            |

The OME-TIFF's fit view needs one tile; its requests are the open of the
file and of the three channel files beside it (served from the same copy),
see Known Gaps.

## Known Gaps

- [ ] An Aperio FL scan's `.afi` file is not read, so its channels open one
      file at a time. Zenodo's CORS-enabled `/api/records/…/content` URLs do
      not end in a name the app detects, so the files above open only through
      a manifest or a mirror.
- [x] A pyramidal OME-TIFF opens in about 24 rounds of sequential range
      requests (IFD, SubIFDs, tag arrays) before its first tile: 11 s at 300
      ms per request for the Xenium file above. Closed by the optimization
      pass's O9 (2026-11-26): see
      [TIFF Opens In Fewer Rounds](optimization-pass.md#tiff-opens-in-fewer-rounds-2026-11-26).

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Features:

- [x] SVS (Aperio) images ([Phase 16](#phase-16--svs-aperio-images),
      2026-11-13).
- [x] SVS: show the thumbnail, label, and macro images, and draw the minimap
      from the thumbnail; read runs of adjacent tiles for QPTIFF and OME-TIFF
      too; stop tiles waiting on a shared run from holding scheduler slots;
      try a fluorescence SVS ([Follow-Up](#follow-up-2026-11-17),
      2026-11-17).
