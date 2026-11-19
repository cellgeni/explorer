# Phase 25 — Imported Segmentations On Images

Implemented 2026-11-19. Not planned in advance. Requested: import a
segmentation onto an existing dataset, such as Cellpose label masks over an
NDPI, or outlines as WKT, Parquet or GeoJSON. Outlines only (no cell table),
hosted anywhere, about 300,000 cells a slide and from 70,000 to 1 million.

Current behaviour is documented in
[`docs/image-only-and-geojson.md`](../../image-only-and-geojson.md#imported-segmentations).

## Product Decisions

- **DECISION:** Image sources only. A segmentation without a table has no
  cells to match a Xenium, Visium or AnnData table, and AnnData can already
  name a `labels` mask. An image gains a Segmentation section in the layer
  panel; the Cells section stays hidden.
- **DECISION:** Draw the outlines through the cell boundary path rather than
  as a layer of their own, so they get its viewport requests (debounce,
  padding, abort), Boundary limit, error banner, loading dot and hover
  tooltip. The segmentation counts the outlines in view for the request in
  place of the viewer's cell count, which an image does not have.
- **DECISION:** Read polygons once into SpatialData shape columns in a
  worker, and select by bounds per view, as Visium HD's segmentation index
  does. A million 12-vertex polygons are about 250 MB of browser memory; a
  linear scan of their bounds per view takes a few milliseconds, so there is
  no spatial index. The count in view is exact.
- **DECISION:** Trace masks per view with the SpatialData label tracer,
  generalised to any chunk source (`LabelOutlineReader`), reading TIFF tiles
  through the image loader (strips cut into tiles, byte-range cache) with a
  `labels` option that allows 32-bit samples; Cellpose writes 32-bit masks
  over 65,535 cells. Tiles decode and trace in the tile decode workers.
- **DECISION:** A mask's count in view is known only once it is traced. The
  first view is traced when a level fits 16 million pixels and is at most 4
  times coarser than the mask; after that the traced density estimates the
  count, and a trace with more labels than the Boundary limit draws none.
- **DECISION:** A mask covers the image (stretched when smaller), as AnnData
  labels do. Polygons are in image pixels by default, the units Cellpose,
  QuPath and StarDist write, with Micrometres to choose; the section warns
  when the outlines fall outside the image or crowd its corner.
- **DECISION:** The outline colour (green by default) and opacity (100%) are
  the section's own, not the cell boundary opacity: on H&E the default grey
  at 50% was hard to see. Neither is in the link.
- **DECISION:** A link keeps a segmentation opened from a URL
  (`segmentation=`, with `segmentationFormat=` and `segmentationUnits=` only
  when needed); a picked file cannot be linked. An image manifest can name one
  (`files.segmentation`).

## Delivered

- [x] Readers: `wktPolygons.ts` (POLYGON and MULTIPOLYGON, 2D to 4D, EWKT),
      `geojsonFeatureStream.ts` (shared with Visium HD; also QuPath's bare
      feature arrays), `vectorSegmentation.ts` (GeoJSON, WKT lines and
      tables, Parquet as GeoParquet WKB, a WKT column or vertex rows, a row
      group at a time) and its worker; `tiffLabels.ts` and
      `tiffLabelTraceCore.ts` (8-, 16-, 32-bit, signed, float, big-endian).
- [x] `importedSegmentation.ts`: polygon and mask segmentations behind one
      interface (`estimateCount`, `outlines`), placement and warnings.
- [x] `ElementBatch.overLimit` and the `ready` boundary state's `overLimit`;
      the viewport workflow's `viewportCellCount`; the boundary loader's
      `cellLimit`.
- [x] `useImportedSegmentation`, the Segmentation section model and blocks,
      the `segmentation` layer section (`panel=segmentation`), loading tasks
      in its area.
- [x] `segmentation=` links; `files.segmentation`,
      `options.segmentationFormat` and `options.segmentationCoordinates` in
      image manifests and the manifest schema.

Checked in headless Chromium with the GPU on a synthetic 6,000 × 6,000 pixel
slide with 81,900 cells, served by `scripts/range-server.mjs`: a Cellpose-style
stripped 32-bit mask, a tiled pyramidal mask, GeoJSON (a bare array), a WKT
CSV with a pandas index, a micrometre vertex Parquet and GeoParquet each opened
in 2–3 s and drew the same 2,576 outlines in one view, lined up with the
image. A million polygons opened in 2.3 s (GeoParquet, 142 MB) and 3.3 s (WKT
CSV, 226 MB).

## Known Gaps

- [ ] No test on a real Cellpose run over a hosted NDPI.
- [ ] Outlines do not take part in ROI selections, the Selection card or Cell
      Query; there is no table to count or export.
- [ ] GeoJSON class names and colours (QuPath's `classification`) are not
      read; every outline takes the section's colour.
- [ ] Cellpose's stripped masks decode whole rows across the slide for each
      view; the docs recommend a tiled pyramid.
- [ ] A Zarr label image cannot be picked as a local folder.
- [ ] Other platforms (a Xenium re-segmentation, say) cannot import one.
