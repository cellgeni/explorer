# Phase 12 — 10x Atera Output

Shipped 2026-11-09; selected-gene transcripts followed the same day (see
[Transcripts](#transcripts) below). Requested to support 10x Atera, the
Xenium successor, using the reference run in [1](../../../PLAN.md#reference-datasets).

## Product Decisions

- **DECISION:** A separate `atera` platform rather than a Xenium variant. The
  bundle has no Parquet files, so none of the Xenium DuckDB readers apply; the
  matrices are AnnData Zarr, so the AnnData readers do.
- **DECISION:** `AteraDataset` wraps `AnnDataH5adDataset` over the zipped
  CSR matrix, like `SpatialDataDataset` wraps a table. Cells, genes,
  annotations, tracks, embeddings, ROI cells, and cell profiles come from it.
- **DECISION:** Selected-gene overlays read whole columns from
  `csc_cell_feature_matrix.zarr.zip`, not CSR rows: a whole-slide CSR read
  would touch the full 236 M-value matrix.
- **DECISION:** The matrix zip has no consolidated metadata. Only the needed
  nodes' metadata is fetched, in parallel, and served from memory; opening
  every node in turn would mean about 600 sequential range requests.
- **DECISION:** Boundaries come from `cells.zarr.zip`
  `gridded_polygon_sets`, read by viewport tile and level, not the
  full-precision `polygon_sets` or the label masks.
- **DECISION:** `morphology_2d` opens through the Xenium morphology loader,
  since it is the same multi-file OME-TIFF layout as `morphology_focus`.

## Delivered

- [x] Detection from `experiment.spatial`, probed alongside `explorer.json`
      and `experiment.xenium`; manifest platform `atera` with its own file
      roles; files located by manifest, then `experiment.spatial`, then
      standard name.
- [x] Overview with transcript counts, areas, nucleus counts, and
      segmentation methods; gene list limited to `Gene Expression` features.
- [x] Cell and nucleus boundaries (`<barcode>#nucleus-N` for extra nuclei).
- [x] Four-channel morphology; Leiden and Azimuth annotations; UMAP and PCA;
      metadata tracks; ROI with means; cell profile.
- [x] Diagnostics for the experiment file, both matrices, cells, and the
      image.
- [x] `docs/modalities/atera.md`; unit tests with an in-memory AnnData
      fixture; an `@live` E2E test against the reference run.
- [x] Checked in the browser against the reference run: ready in about 4 s;
      UMOD overlay about 0.85 s; 5,805 cell and 5,703 nucleus polygons in
      view in under 2 s.

## Transcripts

Atera stores transcripts per gene, so the Transcripts tab shows selected
genes only.

- **DECISION:** Transcripts route by platform like selected-gene expression:
  `loadPlatformTranscriptCapabilities`, `…Aggregates`, and `…Viewport` in
  `platformAdapter.ts` send Atera to `AteraDataset` and leave every other
  platform on the Xenium loaders. A `geneRanges` capability marks per-gene
  outputs for the workflow; Xenium capabilities are unchanged.
- **DECISION:** Selected-gene density comes from
  `binned_transcripts.zarr.zip`: one nested `gene/<index>.zip` (about
  50–190 KB) per gene, read once and opened in memory. Its 5 µm counts are
  summed into squares that double in size until the view has at most 1,500.
- **DECISION:** The same pass counts the selected genes' transcripts in the
  view, and that count, not the all-transcript cell estimate, decides between
  density and exact points. On the reference run the count matched the exact
  QV ≥ 20 points (1,031 of 1,031 in a 600 × 400 µm box).
- **DECISION:** Exact points read each selected gene's `gene_offset` row
  range in the visible 2,000 µm tiles of `transcripts.zarr.zip`. Rows within a
  gene are not spatially sorted, so the whole range is read (at most about
  175,000 rows per gene per tile on the reference run); cell ids and nucleus
  overlap are read only for rows inside the box and above the minimum QV.
  `quality_score` is float16 and is read as uint16 bits, since zarrita needs
  `Float16Array`.
- **DECISION:** With no gene filter (no genes, or Feature filter set to All
  features), the layer is cell-summary squares from `obs/transcript_counts`
  with a message asking for a gene filter; Exact with no genes waits with the
  same request. All-gene native density or points would mean reading every
  gene.

Delivered:

- [x] Transcripts tab and overlay for Atera: per-gene density squares,
      selected-gene estimate, exact points with cell ids, QV, z, and nucleus
      overlap; gene-only filter disabled; no FOV column or hover row.
- [x] Diagnostics range-check both transcript zips, warning when missing.
- [x] Unit tests with in-memory stores, including a stored nested zip, delta
      and Fortran-order arrays, and float16 quality scores; workflow tests for
      the per-gene branch; the `@live` E2E test covers density, cell-summary,
      and exact points.
- [x] Checked in the browser against the reference run: UMOD whole-slide
      density 165 squares (640 µm) summing to the stored 1,914,072; at 4 px/µm
      7,645 exact points against an estimate of 7,689, about 5 s cold and
      1.4 s with the range cache warm.

## Known Gaps

- [ ] Transcripts: no ROI transcript export or cell z histogram; density
      always counts QV ≥ 20 (the binned store's threshold), whatever `Min QV`
      says.
- [ ] Magic Lens is unavailable.
- [ ] Azimuth category colours (`obs/<column>/color`, packed RGBA) are not
      used.
- [ ] The 3D DAPI stack (`morphology_3d/`) is not shown with the dataset; it
      opens as an image URL with a `Z plane` slider.
