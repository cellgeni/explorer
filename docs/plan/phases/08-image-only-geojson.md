# Phase 8 — Image-Only Viewer And GeoJSON Annotations

Goal: load direct OME-TIFF (and later validated NDPI) URLs without
transcriptomics data, and add geometric annotations as their own overlay model
instead of extending cell-ID annotations. Shipped on 2026-07-09 (`f7ff9c5`,
`89e99cf`).

## Product Decisions

- [x] Add an `image` platform (`ImageOnlyDataset`). It uses the tiled image
      renderer and computes extent from image size and microns per pixel. Other
      platforms are unchanged.
- [x] Detect `.ome.tif`, `.ome.tiff`, `.tif`, `.tiff`, and `.ndpi` URLs. NDPI goes
      through the TIFF loader and renders only when it is tiled with `SubIFD`
      pyramids (see [5.4](../data-contracts.md#54-image-only-sources-phase-8)).
      **Superseded** by [Phase 19](19-ndpi.md) (2026-11-15): NDPI slides are
      read as the scanner writes them.
- [x] Disable transcripts, gene expression, cell details, cell annotations,
      boundaries, Magic Lens, ROI gene stats, and ROI transcript export. The
      Genes, Transcripts, Magic Lens, and Cell tabs are hidden.
- [x] Use the image extent for the initial camera when there are no cells,
      grid cells, or boundaries.
- [x] Rename `Dataset URL` to `Dataset or image URL`, keeping the load action.
- [x] Enable every channel on load and run auto-contrast on all of them;
      multi-channel TIFFs get colour channels (`89e99cf`). Since Phase 13,
      only the first six channels start on, and images with more than six
      auto-contrast only those.

## Geometric Annotations

- [x] A model separate from cell-ID annotations
      (`geometricAnnotationModel.ts`): Polygon or MultiPolygon geometry, label,
      colour, visibility, and source metadata.
- [x] On image-only sources the ROI tab becomes `Geometry`: box and lasso
      drawings are saved as shapes, with an optional `Shape name`.
- [x] Import and export GeoJSON. Import accepts a `Feature` or
      `FeatureCollection` of Polygon or MultiPolygon; `null` geometries are
      skipped and any other geometry rejects the file. Labels come from `label`,
      `name`, or `title`; colours from `color`, `stroke`, or `fill`
      (`#rrggbb`). Image-only imports default to pixels and other platforms to
      micrometres; `coordinate_unit` overrides. Export always writes
      micrometres to `geometric-annotations.geojson`.
- [x] Render as deck.gl overlays with colour, visibility, label, remove, clear,
      and export controls. GeoJSON shapes are available on every platform, not
      only image-only.
- [x] Document converting unsupported NDPI to pyramidal OME-TIFF
      (`docs/image-only-and-geojson.md`). Since [Phase 19](19-ndpi.md), only
      files over 4 GB need converting.

## Test Plan

- [x] URL detection for OME-TIFF, TIFF, and NDPI (`datasetFactory.test.ts`).
- [x] `ImageOnlyDataset.meta()` extent and capabilities, and `image()`
      (`imageOnlyDataset.test.ts`).
- [x] Image platform adapter gating (`platformAdapter.test.ts`).
- [x] Initial fit from image extent (`ViewerCore.test.tsx`).
- [x] GeoJSON import: Polygon, MultiPolygon, empty files, invalid geometry,
      pixel and micrometre coordinates (`geometricAnnotationModel.test.ts`).
- [x] Component test: an image-only source loads and enables GeoJSON shape
      annotations (`App.test.tsx`).
- [x] Xenium, Visium HD, and H5AD tests still pass.

## Image Pipeline Fixes After Phase 8

- [x] Custom RGB OME-TIFF layers render as native RGB (`94527ce`, 2026-08-25).
- [x] Planar (separate-plane) TIFF tiles and pyramid level scaling
      (`0d67e06`, 2026-08-28).
- [x] OME `Channel@Color` decoded as signed RGBA with red in the high byte;
      opaque red had been rendering as blue (`3e1a8d5`, 2026-11-07).
- [x] Single-level TIFFs (#92, 2026-11-14): tiles decoded before the display
      window was known each stretched their own contrast, drawing bright
      tiles near the top-left corner; they now wait for the first decode's
      window. Tiles drawn at under half size use high-quality canvas
      smoothing, so the minimap no longer looks like a crop.
- [x] Stripped TIFFs (#94, 2026-11-14), tifffile's default and the layout of
      most microscope exports: shown as virtual tiles cut from bands of whole
      rows (`src/tiff/strips.ts`), with a 256 MiB band cache shared by all
      images. LZW is always decoded in-app, because geotiff 3.0.5 loops until
      it runs out of memory on the code 4094 that imagecodecs writes.
      Auto-contrast samples at most 64 tiles of the coarsest level, so an
      image without a pyramid is no longer downloaded in full.

## Known Gaps

- [x] A failed GeoJSON import logs "GeoJSON annotation import failed" without
      the reason. Fixed 2026-11-12: a message under `Import GeoJSON` gives the
      file name and the reason (not JSON, wrong geometry, or no polygons).
- [ ] The `visible` property is not imported, and shapes are not saved in
      the shareable URL. A feature's `id` is kept as its object ID and
      exported again since #288 (2026-11-22).
- [ ] No E2E test of GeoJSON import or export. Smoke tests load OME-TIFF
      images and a plain TIFF with a label mask (#193, #205, #234, #255).

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Other gaps found in the review:

- [x] A failed GeoJSON import does not show the reason. A message under
      `Import GeoJSON` now gives the file name and the reason (2026-11-12).
