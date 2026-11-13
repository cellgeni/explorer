# Phase 13 — QPTIFF Images

Shipped 2026-11-09. Requested to view Akoya PhenoCycler scans, using the
post-Xenium skin scan in BioImage Archive `S-BIAD3788`
(`PostXeniumAkoya/MH_BCN_skin_X0072771_post-Xenium_Scan1.er.qptiff`: 81 GB,
61 channels of 24,960 × 48,960 16-bit LZW, 0.505 µm/px).

## Product Decisions

- **DECISION:** Read QPTIFF in the TIFF loader rather than a new platform.
  It is an image-only source, a custom layer, or a manifest `image` like any
  TIFF; only the IFD layout and metadata differ. See
  [image.md](../../modalities/image.md#qptiff).
- **DECISION:** Walk the IFD chain once per file through a geotiff block
  cache (1 MiB blocks) and share it between channel loaders. Akoya writes all
  369 IFDs in the first 7.5 MB, so opening takes 8 range requests instead of
  370 sequential ones (about 63 s to EBI).
- **DECISION:** Read a channel's tile offsets on its first tile fetch. All
  channels' offsets as maps would cost about 35 MB here, and several hundred
  MB for whole-slide scans with 100 channels.
- **DECISION:** Images with more than six channels start with the first six
  on and auto-contrast only those; other channels are auto-contrasted when
  first turned on. Enabling and auto-contrasting all 61 would fetch about
  1,500 coarse tiles at load.

## Delivered

- [x] `.qptiff`/`.qptif` detection, plus QPI image descriptions in files
      with a `.tif` name.
- [x] Channels named by biomarker (fluorophore when blank) in scanner
      colours; pyramid from reduced-resolution IFDs; pixel size from
      `XResolution`.
- [x] Unit tests with an in-memory QPTIFF served by range requests.
- [x] Checked in the browser against the scan above: the IFD walk took about
      4.5 s (8 sequential 1 MiB reads); nuclei and Keratin 14 line up at full
      resolution with no tile seams.

## Known Gaps

- [ ] The stripped smallest pyramid level is not shown.
- [ ] Auto-contrast reads the coarsest level's tiles one at a time: about
      15 s per channel against EBI.
- [ ] QPTIFF placement over Xenium (registration) is not supported.
