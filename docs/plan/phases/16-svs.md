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

## Known Gaps

- [ ] The thumbnail, label, and macro images are not shown; the minimap
      decodes the coarsest level again instead of using the thumbnail.
- [ ] Aperio fluorescence SVS (one pyramid per channel) has not been tried.
- [ ] Runs of adjacent tiles are read for SVS only; QPTIFF and OME-TIFF on
      high-latency hosts could use them too.
- [ ] Tiles waiting on a shared run hold scheduler slots, so about three
      runs are in flight at once. On a host as slow as EBI was that day, more
      concurrency for SVS would shorten the overview.

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Features:

- [x] SVS (Aperio) images ([Phase 16](#phase-16--svs-aperio-images),
      2026-11-13).
