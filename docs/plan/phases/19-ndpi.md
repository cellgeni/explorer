# Phase 19 — NDPI (Hamamatsu) Images

Shipped 2026-11-15. Requested as NDPI support, tried first on a Sanger kidney
section (`mp33.cog.sanger.ac.uk/public/ndpi/STAN-FC34A - BQ11-KID-21-PFPE-1-s1

- 2026-02-12 11.34.23.ndpi`: 604 MB, NanoZoomer C13210, 68,096 × 37,632 and
five 2× levels, 0.2212 µm/px). Before this phase, `.ndpi` URLs went through
  the plain TIFF loader, which refused the level as a 7.7 GB strip, so almost
  no slide opened (Phase 8 documented converting them).

## Product Decisions

- **DECISION:** Read NDPI in the TIFF loader, as for SVS and QPTIFF, rather
  than as a new platform: it is an image-only source, a custom layer, or a
  manifest `image` like any TIFF. See
  [image.md](../../modalities/image.md#ndpi).
- **DECISION:** Use the McuStarts tag, as OpenSlide does: each level is one
  JPEG, but the scanner lists where each restart interval starts, so a run
  of intervals decodes as a JPEG of its own (the level's header with the
  run's size, the intervals' data, restart markers renumbered). The level's
  JPEG header states a width of 0 when the level is wider than 65,535
  pixels; the run's size is written in instead.
- **DECISION:** Read whole MCU rows in bands of about 2 MiB, one request
  each, rather than each row's intervals in view. A full-resolution view
  reads about 20 times the bytes it shows (31 MB against about 1.5 MB), but
  reading only those intervals costs a request per 8-pixel MCU row (85 to
  170 per view), and the Sanger host answered in about 0.4 s per request on
  the network this was measured from. Bands are shared by every block across
  them.
- **DECISION:** Decode blocks of about 2,048 px of whole intervals (one
  3,584-px interval at full resolution) in the strip-band decode workers and
  cut 512-pixel tiles from them, so neighbouring tiles share a decode.
- **DECISION:** Add a level an eighth the size of the smallest when that
  level is over 2,048 px, decoded from each 8 × 8 block's DC term only (a
  `dcOnly` mode of the built-in sequential decoder). The BioImage Archive
  slide below has no level under 5,704 × 4,880, and its whole-slide view
  needed 120 tiles, past the scheduler's 96, so it drew with its corners
  missing.
- **DECISION:** Mark loaders whose tiles all come from shared reads
  (`tilesFromSharedReads`), so the scheduler stops treating their
  uncompressed 512-pixel tiles as large raw tiles (18 tiles, one request at
  a time).
- **DECISION:** Refuse files over 4 GB with a message to convert them. They
  keep the high bits of their offsets outside the TIFF fields, which geotiff
  does not read; no such file was at hand to test against. The message shows
  only when the reader can tell; on Zenodo it cannot (see
  [64-Bit NDPI Files](#64-bit-ndpi-files-over-4-gb)). Support was asked to be
  recorded, not built (2026-11-15).

## Delivered

- [x] `.ndpi` URLs, and TIFFs with the NDPI format tag under another name,
      open the NDPI reader; `#ifd=N` still opens one IFD as a plain TIFF
      (the macro image of the Sanger slide is `#ifd=6`).
- [x] Levels from the images with a positive magnification in the focal
      plane nearest the focus, largest first. Levels with McuStarts are read
      by block; a small level without them (the Sanger slide's 2,128 ×
      1,176) is read whole as a stripped level. The IFD walk stops at the
      macro: 8 range requests to open the Sanger slide.
- [x] Pixel size from `XResolution` in centimetres; one RGB channel drawn as
      stored.
- [x] Tiles at every level of the Sanger slide, edge tiles included, within
      3 levels of tifffile's decode (libjpeg-turbo), 0.15 on average.
- [x] Opened in headless Chromium at 1,400 × 900 from a cold cache: the
      Sanger slide's whole-slide view in 0.8 s (12 requests, 1.0 MB) and a
      full-resolution view over tissue in 4.2 s (26 requests, 31 MB); BioImage
      Archive `S-BIAD2323` `component_B_hamamatsu_ndpi/c003_hamamatsu.ndpi`
      (609 MB, CC BY 4.0; 91,264 × 78,080, five levels, all with McuStarts)
      in 3.3 s (22 requests, 3.1 MB) and 2.7 s (30 requests, 17 MB).
- [x] Unit tests with a synthetic NDPI (Pillow JPEGs with restart markers,
      4:2:0 and 4:4:4, `src/test/fixtures/ndpi/make_fixtures.py`) served by
      range requests: every block decodes to the pixels of the whole image,
      at full size and from DC terms.

## 64-Bit NDPI Files (Over 4 GB)

Recorded 2026-11-15; not built.

**Layout.** Classic TIFF positions are 32-bit, so they cannot point past
4 GiB (4,294,967,296 bytes). Hamamatsu keeps the classic TIFF header and IFD
entries rather than switching to BigTIFF, and stores the upper 32 bits
elsewhere, as tifffile reads them:

- The header's first-IFD offset and each IFD's next-IFD offset are 8 bytes.
- After each IFD's next-IFD offset comes an array of 4-byte values, the upper
  32 bits of each entry's value field: offsets to tag data, and single LONG
  values such as `StripByteCounts`.
- The upper 32 bits of each McuStarts entry are in McuStartsHighBytes
  (65432).

Below 4 GiB every upper half is zero, and the file reads as a classic TIFF,
which is why geotiff opens smaller NDPI files.

**Test files.** Zenodo [10.5281/zenodo.8234093](https://zenodo.org/records/8234093)
("NDPI Bio-Formats artifact examples", CC BY 4.0, copied from images.jax.org):
`Topors_A-2634_OV_03.ndpi` (4,527,833,129 bytes) and
`Dguok_A_6275_Con_OV_01.ndpi` (4,508,030,965 bytes). The second, read with
tifffile over HTTP:

- 234,240 × 81,664 at 40×, then 58,560 × 20,416 (10×) and 14,640 × 5,104
  (2.5×), all with McuStarts, then the macro and the map.
- Every IFD is past 4 GiB; IFD 0 is at 4,300,882,058.
- Level 0's JPEG is 4,295,891,586 bytes, 924,290 past 4 GiB, so its last
  McuStarts entries carry an upper half of 1. Levels 1 and 2 and the macro
  start past 4 GiB.
- Level 0 has 61 restart intervals per MCU row, about 420 KB of JPEG per row
  on average.

**What the app does today.**

- geotiff takes the lower half of the first-IFD offset and reads IFD 0 at
  5,914,762, inside level 0's JPEG, so the open fails with a parse error.
- The over-4-GB message does not show. It relies on the file size from
  `Content-Range`, which Zenodo does not expose to scripts (its
  `Access-Control-Expose-Headers` lists `Content-Type`, `ETag`, `Link`, and
  rate-limit headers), and the McuStartsHighBytes check runs only after the
  IFDs parse.
- Zenodo sends CORS headers for
  `https://zenodo.org/api/records/8234093/files/<name>/content`, which does
  not end in `.ndpi`, so URL detection does not see an image. The
  `https://zenodo.org/records/8234093/files/<name>?download=1` form ends in
  `.ndpi`, but its response has no CORS header.
- A dataset manifest `image` without a known suffix opens as a plain TIFF,
  where the NDPI reader is chosen by the format tag in IFD 0. That works
  under 4 GB, but not here: IFD 0 cannot be found without knowing first that
  the file is NDPI.

**What support needs.**

- An NDPI directory reader, used instead of geotiff for NDPI files, that
  reads the 8-byte IFD offsets and the upper-half arrays and serves the tags
  the NDPI reader uses (image size, compression, strip offsets and counts,
  resolution, and the NDPI tags). Offsets fit JavaScript numbers.
- McuStarts combined with McuStartsHighBytes.
- A way to open an NDPI whose URL has no `.ndpi` suffix: a manifest field,
  or trying the 8-byte header offset when the 4-byte one does not lead to an
  IFD.
- The over-4-GB message removed, or kept for files the reader cannot open.

**Open question.** Whole-row bands suit level 0 of this slide poorly. A
1,400 × 900 view at full resolution spans about 85 MCU rows: about 36 MB of
whole rows, estimated from the average row size, for about 1 MB in the one
or two intervals in view. Reading only those intervals would cost about 85
requests per view. Measure both against Zenodo before choosing; the choice
could be made per level from the number of intervals per row.

## Known Gaps

- [ ] Files over 4 GB are not read (see
      [64-Bit NDPI Files](#64-bit-ndpi-files-over-4-gb)); on hosts that hide
      the file size, such as Zenodo, the open fails with a parse error rather
      than the over-4-GB message.
- [ ] Other focal planes have no `Z plane` control; the macro image and map
      show only through `#ifd=N`.
- [ ] Blocks decode with `geotiff`'s JavaScript decoder (about 40 ms for a
      3,584 × 128 block in Node); the browser's decoder, which SVS tiles use,
      would be faster.
- [ ] A level whose restart intervals do not divide its MCU rows fails when
      its tiles load rather than at open. No such file has been seen.
- [ ] Fluorescence NDPI has not been tried.
