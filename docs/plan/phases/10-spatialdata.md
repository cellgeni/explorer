# Phase 10 — SpatialData Stores (Recorded From Git)

Shipped from 2026-10-13 to 2026-11-06 (`66d44de`, `10e3470`, `92defed`). Not
planned in advance.

## Delivered

- [x] Detect SpatialData from `spatialdata_attrs` in root metadata, both for
      Zarr-looking URLs (before the Xenium probe) and for plain folder URLs
      (after it).
- [x] Read the element catalog from consolidated metadata and place images,
      shapes, labels, and tables in a shared coordinate system through their
      transforms (see [5.6](../data-contracts.md#56-spatialdata-stores-phase-10)).
- [x] Read the table through the AnnData reader, so genes, annotation sets,
      embeddings, selected-cell profiles, and ROI summaries work as for H5AD.
- [x] Place table rows on their annotated shapes (centroids) or, for labels
      regions, from `obsm` through the labels transform. Rows that match
      nothing are hidden; the load fails if no row is placed.
- [x] Shapes from GeoParquet or WKB (`shapes.parquet`). Circles and polygons
      appear as cell boundaries. When the region is circles (for example
      Xenium `cell_circles`), a `cell_boundaries`-style shapes element is drawn
      instead, matched through instance IDs.
- [x] spatialdata-io Xenium stores whose table annotates a labels element: map
      label IDs from the instance key or a `cell_labels`-style column, and trace
      outlines from the label raster on demand, joining cells that span chunks
      (`10e3470`).
- [x] Units: µm-per-unit from an override, declared axis units, or an estimate;
      unknown scales are labelled as units (see
      [4.11](../decisions.md#411-units-for-stores-without-declared-scale-phase-10)).
- [x] Dataset tab controls: `Coordinate system`, `Image`, and `µm per unit`
      (`Set`/`Auto`), saved in the shareable URL as `sdCs`, `sdImage`, and
      `sdUm`. Changing them reloads the store and releases the previous dataset
      instance.
- [x] Incomplete stores are reported: chunks read as fill values are tracked,
      missing string chunks fail fast, `403` chunk errors are typed, optional
      obs columns that cannot be read are skipped, and Diagnose Dataset sends a
      `HEAD` for every table chunk and checks one image chunk.
- [x] Panning performance: label tracing and OME-Zarr decoding in workers,
      outlines cached per label and simplified, and padded boundary requests
      (`92defed`; see [4.9](../decisions.md#49-cell-boundaries)).
- [x] Platform gating (`SPATIALDATA_PLATFORM_ADAPTER`): boundaries from
      `elements(bbox)`; transcripts, nucleus boundaries, and Magic Lens off.
- [x] Zipped stores (2026-11-13): `.zarr.zip` URLs such as the BioImage
      Archive exports in [1](../../../PLAN.md#reference-datasets) are read by range (see
      [4.10](../decisions.md#410-zarr-store-access-phases-910)). Found on the way:
  - Numeric `obs` columns over about 120,000 rows overflowed the stack
    (`Math.min(...values)`); min and max are now a loop. This affected H5AD
    too.
  - Arrays under `uns/` that zarrita cannot open (scanpy `rank_genes_groups`
    record dtypes) are left out instead of failing the table.
  - Shapes held as GeoJSON ran the browser to 3.7 GB on 598,222 polygons.
    Outer rings are now `Float32Array`s with bounds in typed arrays, and
    `elements(bbox)` builds elements only for cells in view: 2.3 GB peak,
    1.4 GB settled.

## Known Gaps

- [ ] `points` (transcripts), extra images, and extra tables are not shown.
- [ ] Shapes are read whole, not by viewport: spatialdata-io writes one row
      group with no per-shape bounding boxes, so a viewport-scoped read needs
      a spatially sorted companion file. Parsing moved to a worker on
      2026-11-13 (see
      [4.5](../decisions.md#45-rendering--decision-two-canvases-decode-off-the-main-thread)).
- [ ] `meta()` waits for the image, so a broken image also blocks boundaries.
- [x] Imported CSV/JSON annotations must use Xenium cell IDs (shared with
      [Phase 7](07-h5ad.md)). Boolean `obs` columns were fixed on
      2026-11-09; imports accept any cell ID since 2026-11-12.
- [ ] Diagnostics check only one image chunk.
- [ ] No E2E coverage; the reference stores in
      [1](../../../PLAN.md#reference-datasets) are used for manual testing.
