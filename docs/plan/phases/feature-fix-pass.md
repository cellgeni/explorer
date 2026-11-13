# Feature-Fix Pass (After Phase 5)

- [ ] The pass stays open. Record fixes here as they close.

Fixes recorded:

- [x] ROI summary hung after Magic Lens scans. Transcript scans now use a
      separate DuckDB worker, and drawing an ROI aborts any lens scan.
- [x] Magic Lens hung. Lens scans now reuse the bounded ROI cell query, filter
      the cursor circle by centroid, and summarize genes through the matrix
      path instead of scanning `transcripts.parquet`.
- [x] The first ROI waited 20+ s for genes. Dataset warmup stays metadata-only;
      a separate ROI-gene warmup runs per dataset (first per viewport, then
      changed to once per dataset), and ROI drawing shows a preparing state
      until it is ready.
- [x] The activity log records timings for every ROI step.
- [x] Selected-cell detail loads all nonzero genes through the matrix/H5 path,
      and shows metadata and shape metrics (equivalent diameter, perimeter,
      axes, eccentricity, circularity) when boundary geometry exists.
- [x] Picking no longer depends on visible fill, with a point-in-polygon
      fallback.
- [x] Opacity sliders update immediately (`updateTriggers`).
- [x] Imported labels that collide after slugging keep unique IDs.
- [x] Cell Info lists the selected cell's annotation membership.
- [x] Custom image layers from remote OME-TIFF URLs, with prefixed channel IDs
      and removal. LZW and uncompressed tiles decode through geotiff.js; large
      LZW tiles use a preallocated buffer and lower budgets.
- [x] Exact transcript colours are deterministic per feature, with QV colouring
      as an explicit mode.
- [x] Visium HD ROIs load genes for all selected barcodes and label the panel
      `ROI genes`.
- [x] Transcripts stayed loading after a rerun for the same view. Selecting a
      gene with Feature filter set to All, or ViewerCore reporting the same
      view again as a new object, stopped the read, and the rerun skipped its
      unchanged request key. The effect cleanup now clears the key of a read it
      stops while that read is still running, so the rerun starts it again; a
      cancelled read (15.3-D) keeps its key.
