# Phase 14 — Standard Visium Spots

Shipped 2026-11-10. Standard Visium (v1/v2, 55 µm spots) is the most common
public spatial assay. Requested: Space Ranger output with its H&E images, and
AnnData with `uns/spatial/<library>/images` and the scale factors. Checked
against GEO `GSM6592057` in both forms: the Space Ranger files on GEO (through
a manifest) and the CELLxGENE Census `.h5ad` of the same sample. See
[visium.md](../../modalities/visium.md).

## Product Decisions

- **DECISION:** One `visium` platform for both sources, read through the
  AnnData reader. A Space Ranger folder is turned into an in-memory AnnData
  table with scanpy's `read_visium` layout (`memorySource`), so spots, genes,
  clusters, embeddings, ROI, and expression use the H5AD paths unchanged. Not
  a third Visium class beside `VisiumHdDataset`: standard Visium is a few
  thousand spots, not a grid of millions of bins.
- **DECISION:** An `.h5ad` stays detected by its suffix and becomes `visium`
  after it is read, when `uns/spatial/<library>` exists and coordinates come
  from `obsm/spatial`. Detection cannot see inside the file without reading
  it.
- **DECISION:** Micrometres per pixel come from an affine fit of spot pixels
  against `array_row`/`array_col` (100 µm pitch), not from
  `spot_diameter_fullres`, which 10x documents as a 60-70 µm visualization
  estimate. Fallbacks: declared `microns_per_pixel`, nearest-neighbour spot
  spacing, then the spot diameter as 65 µm with a notice.
- **DECISION:** Draw spots at the 55 µm capture size, not the 65 µm
  visualization diameter, and keep that size at every zoom (`trueSizePoints`
  on the platform adapter) instead of the usual screen-pixel cap.
- **DECISION:** Hide `in_tissue` 0 spots. CELLxGENE keeps all 4,992 array
  spots; Space Ranger's filtered matrix already drops them.
- **DECISION:** Tissue images stay `flat` images. `uns` arrays are written to
  an uncompressed BMP object URL (no canvas needed, testable); GEO's
  `.png.gz` images are decompressed into object URLs.
- **DECISION:** Read the Space Ranger matrix whole (300 MB limit, as `.h5ad`),
  not through the Visium HD lazy-range worker: selected-gene overlays scan
  every spot, and standard Visium matrices are small (1-50 MB typically).

## Delivered

- [x] Folder detection (Space Ranger 2.0+ and 1.x positions names) before
      the Visium HD tiers; `visium` manifest platform with every file
      relocatable and gzip allowed; JSON Schema updated.
- [x] 10x HDF5 matrix reader (Cell Ranger 3+ `/matrix` and Cell Ranger 2
      per-genome groups); `library_ids`, chemistry, and software version.
- [x] `uns/spatial` placement: units, off-tissue spots, several libraries,
      scale factors, `hires`/`lowres` arrays (uint8 or 0-1 float).
- [x] Spot outlines from `elements(bbox)`; true-size points and expression
      dots; Dataset tab panel with library, spots, chemistry, scale, and a
      `Tissue image` select (High-res, Low-res, None).
- [x] Diagnostics for Space Ranger folders (no Range support needed).
- [x] Unit tests for parsing, units, BMP encoding, the Space Ranger reader,
      `uns/spatial`, detection, manifests, the adapter, the lifecycle, and the
      Dataset tab; Playwright smoke with a routed Space Ranger folder and a
      live test against the Census `.h5ad`.

## Known Gaps

- [ ] `spaceranger aggr` output (per-library `spatial/<library>/`) is not
      detected.
- [ ] The full-resolution microscope image is not shown.
- [ ] k-means clusterings and `spatial_enrichment.csv` are not read.

## Follow-Up (2026-11-10)

- [x] `Show off-tissue spots` and a `Library` select for multi-library
      `.h5ad` files. Both re-place spots from data read once
      (`setVisiumView`) and reload through the normal load path, keeping
      genes and colours; a library change clears the ROI.
- [x] Share link: `vimg`, `vlib`, and `voff`, restored on open.
- [x] Categorical `var/feature_name` gene symbols landed separately on `main`
      (`05c4092`, with Ensembl IDs kept as search aliases); nothing more was
      needed for CELLxGENE Visium files.
- [x] The CELLxGENE heart example now opens as Visium; its description says
      2,913 spots under tissue of 4,992.

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Other gaps found in the review:

- [x] Remove `'visium'` from the `Platform` union or implement it
      (implemented in Phase 14).

Features:

- [x] Standard Visium (spots) from the original Phase 6
      ([Phase 14](#phase-14--standard-visium-spots), 2026-11-10).
