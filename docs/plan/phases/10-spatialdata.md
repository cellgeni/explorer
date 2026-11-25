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
      `HEAD` for each table chunk (the first 2,000; every chunk in a zip since
      2026-11-17) and checks one image chunk.
- [x] Panning performance: label tracing and OME-Zarr decoding in workers,
      outlines cached per label and simplified, and padded boundary requests
      (`92defed`; see [4.9](../decisions.md#49-cell-boundaries)).
- [x] Platform gating (`SPATIALDATA_PLATFORM_ADAPTER`): boundaries from
      `elements(bbox)`; transcripts and Magic Lens off. Nucleus boundaries
      were off until 2026-11-17.
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

Checked against the code on 2026-11-17. Ordered roughly by how soon they
matter on real stores.

- [ ] Images whose affine rotates or shears (beyond 1e-4 rad) are skipped
      and named only in the activity log's skipped elements. Flipped and
      axis-swapped images are shown since 2026-11-17 (see
      [Closed Open Items](#closed-open-items)). None of the reference stores
      has a rotated image.
- [ ] `points` (transcripts) are not read. Checked 2026-11-17 by reading
      every footer of the 460-plex store's `points/transcripts` (190 parts,
      8.8 GB, stored in the zip, 503.5 million rows in 569 row groups of
      about a million rows): every row group has x/y min/max, as parts are x
      strips 250-1,000 µm wide and row groups are y bands within them, but
      there is no page index (no column or offset index). A viewport read is
      therefore whole row groups: a 100 µm view reads 6 (4.7 million rows,
      23 MB of x, y, `feature_name`, and `qv`), a 500 µm view 45 MB, the
      whole slide 2.35 GB, so only zoomed-in views could be read and an
      overview would need a companion. `feature_name` is an int16 dictionary
      with rows run-sorted by gene (about 10 KB a row group). STHELAR's
      `points/st` is one deflated zip entry (156 MB) whose row groups are
      1,250-wide x strips over the full y range, so it would be read whole.
- [ ] Magic Lens is unavailable (`magicLensAvailability` says "Unavailable
      for SpatialData"), although the capability is on and, since
      [Phase 12](12-atera.md#closed-open-items) (PR #157), the lens reads
      cells and expression through the AnnData ROI loaders on every AnnData
      platform. H5AD, Visium, and MERSCOPE are gated the same way. Found by
      reading the code on 2026-11-17; not tried in a browser.
- [ ] Shapes are read whole, not by viewport: spatialdata-io writes one row
      group with no per-shape bounding boxes, so a viewport-scoped read needs
      a spatially sorted companion file. Parsing moved to a worker on
      2026-11-13 (see
      [4.5](../decisions.md#45-rendering--decision-two-canvases-decode-off-the-main-thread)).
      Nucleus shapes are read the same way, the first time nuclei are shown.
- [ ] Labels are drawn only as traced outlines, not as a raster layer, and
      nucleus labels (`nucleus_labels`) are not traced.
- [x] Labels show only their first z plane, and neither images nor labels
      have a `t` choice (shared with the OME-Zarr `t` item in
      [Open Items](../open-items.md)). Since 2026-11-14 images open on
      `omero.rdefs.defaultZ`, else the middle plane (`omeZarrLoader.ts`), as
      other z-stacks do. Since 2026-11-25 images have `Time point` and
      labels follow the image's z plane and time point
      ([Phase 28](28-time-points.md), PR 431).
- [ ] Polygons keep only the outer ring of their largest part: holes and the
      other parts of a MultiPolygon are dropped. Fine for cells, wrong for
      tissue or region annotations.
- [ ] Over HTTP, diagnostics send a `HEAD` for the first 2,000 table chunks
      (`SPATIALDATA_MAX_CHECKED_CHUNKS`) and check only the first chunk of
      the coarsest level of the image and of each labels region. Zipped
      stores have every chunk checked since 2026-11-17.

## Closed Open Items

- [x] The image no longer waits for the cell shapes (2026-11-18). On the
      460-plex zip the image opened only after the cells, for three reasons:
      the lifecycle loaded it after the overview; the units it is scaled by
      were estimated from the 101 MB `cell_boundaries` polygons; and
      Chromium's HTTP cache let one Range request to the zip's URL through at
      a time. Now the lifecycle starts the image alongside the table, shown
      once the load replaces an open dataset (on a first load the view fits
      it until the cells arrive). spatialdata-io Xenium stores take their
      units from the table's `uns/xenium/pixel_size`: 0.2125 µm per unit on
      the 460-plex, where the `cell_area` estimate gave 0.2175 (2.4% off).
      Zip Range requests are sent with `cache: 'no-store'`. Measured on a
      local mirror throttled to 32 Mbit/s and 100 ms (Metal GPU, two runs
      each, within 1.2 s): main opened the image with the cells at 58 s and
      had its coarsest tiles at 70 s. With all three changes the image opens
      at 2.5 s, its tiles are in at 17.5 s, and the cells are ready at 57 s.
      `no-store` alone brings the cells to 47 s, since the table's 246 chunk
      reads stop waiting for each other. The coarsest level is one
      3,619 × 3,371 chunk per channel (44 MB), and sharing the bandwidth with
      it costs the cells about 10 s of that gain. Unthrottled, the load takes
      about 5 s either way. Stores with estimated units still open the image
      after the table's rows are placed (see
      [Open Items](../open-items.md)).
- [x] `nucleus_boundaries` shapes are drawn (2026-11-17). A non-region
      shapes element named like `nucleus_boundaries` is the nucleus layer
      (`nucleusCandidates` in the view); a table that annotates the nuclei
      itself, such as STHELAR's `table_nuclei`, still draws them as cells.
      `SpatialDataDataset.segmentationElements('nucleus', bbox)` reads the
      whole `shapes.parquet` in the shapes worker the first time nuclei are
      shown and filters it by bounds, keeping element objects for nuclei
      still in view. `meta().segmentations` lists cell and nucleus outlines,
      and diagnostics range-check the nucleus file (optional).
      **DECISION:** nuclei are matched to table rows through the region
      shapes that share their index (spatialdata-io indexes
      `cell_boundaries` and `nucleus_boundaries` by cell id), or by the
      table's cell ids when the table annotates labels. A cell's first
      nucleus keeps its id and later ones get `<id>#nucleus-N`, as on Xenium
      ([Phase 17](17-xenium-nucleus-boundaries.md)). Unmatched nuclei are
      left out; when none match, every nucleus is drawn and the log says so.
      **DECISION:** the `Nucleus boundaries` checkbox shows only for a store
      with a nucleus element (`summary().nuclei`,
      `nucleusBoundaryControlsVisibleFor`); cell outlines are read only while
      `Cell boundaries` is on, so nuclei alone do not wait for them; a link's
      `nucleusBounds=1` turns them on. Each matched nucleus names its cell
      (segmentation metadata `cellId`), so with
      [Phase 17](17-xenium-nucleus-boundaries.md#closed-open-items)'s nucleus
      hover (PR #161) hovering a nucleus shows its cell, a click selects the
      cell, and the Cell card lists the cell's nuclei in view with area and
      circularity; nuclei drawn because none matched name no cell. Since
      PR #161 cell and nucleus outlines are also separate viewport requests,
      so cell outlines no longer wait for the nuclei. On STHELAR bone marrow
      all 225,906 nuclei matched. The first view with nuclei (1,912 in view)
      took 17-21 s, most of it the 19.4 MB compressed zip entry from the
      BioImage Archive, and the cell outlines waited for it. Rechecked after
      PR #161 (2026-11-17, one run): cell outlines were drawn 0.1 s after the
      view opened and 1,909 nuclei 6.8 s later; hovering a nucleus showed
      `1 of 1` and its cell, and a click opened that cell's card with one
      `Nucleus` row (26.5 µm², against the table's `nucleus_area` of 27.4).
      The 460-plex store has no nucleus shapes.
- [x] Flipped and axis-swapped images are shown (2026-11-17). STHELAR's
      `he` (an x/y swap and flip) opens from the `Image` select and lies over
      the DAPI `morpho` image, with cell and nucleus outlines on the
      hematoxylin. **DECISION:** support affines whose linear part is a
      signed axis permutation with scales (flips, swaps, and turns by
      multiples of 90°), not arbitrary rotation: each tile is then still an
      axis-aligned rectangle on screen, so its edges keep snapping to whole
      pixels and neighbouring tiles meet without seams. The loader keeps the
      absolute scales, and an `ImageFramePlacement` (`coords.ts`) maps its
      frame to the coordinate system; the morphology canvas and minimap
      select tiles for the viewport mapped into the frame and draw each tile
      turned into place. **DECISION:** off-axis terms under 1e-4 of the scale
      are dropped (`axisPermutingAffine`): STHELAR's affine also turns by
      1.9e-5 rad, which moves pixels of the 37,252-pixel image by under one
      pixel. Images are ranked by pixel size instead of x scale, so STHELAR
      still opens on `morpho` (pixel 1 unit against 1.288).
- [x] Zipped stores have every table, image, and labels chunk checked
      against the zip directory (2026-11-17), with no request per chunk.
      Diagnosing STHELAR with `he` (8,591 image chunks) took about 3 s.
      Image and labels chunks absent only from finer levels pass with a
      note, since zarr-python 3 does not write chunks that hold only the
      fill value: 304 of the 460-plex image's 1,148 chunk files are absent,
      none in its coarsest level (the first listed are the top-left corner
      of `s0`). Absent chunks of the coarsest level still warn.
- [x] The table can be chosen (2026-11-14). The first table, by name, that
      annotated a shapes element won, else one that annotated labels, else
      the first (`primaryTable`); there was no `sdTable`. spatialdata-io
      names Visium HD tables `square_002um`, `square_008um`, and
      `square_016um`, so a Visium HD store opened on the 2 µm bins and read
      all their shapes (found by reading the code; no Visium HD store was
      tried). In STHELAR only `table_cells` was reachable, not
      `table_nuclei`, `table_scvi`, or `table_combined`. A `Table` select in
      View options now picks the table (`sdTable`, manifest
      `options.table`), unselected tables are listed as skipped elements,
      and among Visium HD bin tables only the coarsest is a default.
      Switching was checked on STHELAR bone marrow (`table_nuclei`: 541
      genes on `nucleus_boundaries`, reloaded in 15 s); the Visium HD default
      is covered by a unit test only.
- [x] `meta()` no longer waits for the image (2026-11-14), so a broken image
      no longer blocks boundaries: `meta()` treats an image that fails to
      open as no image, and the error still reaches the morphology layer
      through `image()`.
- [x] Imported CSV/JSON annotations accept any cell ID (2026-11-12; shared
      with [Phase 7](07-h5ad.md)). Boolean `obs` columns were fixed on
      2026-11-09.
- [x] Diagnostics check the view the dataset loads with (2026-11-14). They
      checked the default view, not the `sdCs` / `sdImage` selection, and
      skipped labels and the polygon shapes drawn in place of region circles
      (`cell_boundaries` for `cell_circles`). They now use
      `spatialDataSelectionFor`, check one chunk of each labels region
      (optional), and range-check the outline companion's `shapes.parquet`
      (optional, since region polygons are drawn themselves).
- [x] E2E coverage of a SpatialData store (2026-11-14). `examples/index.json`
      had no SpatialData entry, so the nightly examples test never loaded
      one. The gallery now has the SpatialData sandbox's
      `visium_associated_xenium_io` (Visium CytAssist breast cancer, mirrored
      on the WebAtlas bucket), which the nightly run loads (2.6 s locally).
      It covers a Zarr v2 store with circle shapes only: zipped, Zarr v3,
      Icechunk, and labels-annotated stores are still tested by hand (see
      [Open Items](../open-items.md)).
