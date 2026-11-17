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

## Closed Open Items

Closed 2026-11-17, checked in headless Chromium (GPU) against the reference
run on the Sanger bucket. See [Atera](../../modalities/atera.md).

- [x] ROI transcript export and the cell z histogram (2026-11-17).
      **DECISION:** both cover the selected genes, as the transcript layer
      does: Xenium's every feature would mean reading every row of each tile
      an ROI or cell touches (up to 52 million). They read through the
      exact-point reader, whose new `contains` test keeps only points inside
      the lasso or cell outline before the limit. Without genes, the export
      fails and asks for them, and the histogram asks for them. A
      110 × 70 µm box on UMOD-rich tubules exported 1,013 rows in 0.25 s;
      an epithelial cell's 45 UMOD transcripts binned in 2.4–2.7 s.
- [x] Density that follows `Min QV` (2026-11-17). At QV 20 the squares are
      the binned store's; at another value they bin the selected genes' rows
      of `transcripts.zarr.zip`, up to 2,000,000 rows a view
      (`ATERA_QV_DENSITY_ROW_LIMIT`), beyond which the QV ≥ 20 squares show
      with a message naming the row count. At QV 30, whole-slide NPHS1 binned
      88 squares from `transcripts.zarr.zip`; whole-slide UMOD needs
      2,142,840 rows and fell back.
- [x] Magic Lens (2026-11-17). It reads the lens cells and their CSR rows
      through the AnnData ROI loaders; before, it called the Xenium loaders.
      Summarise View over 368 cells at 4 px/µm took 3.4 s.
- [x] Azimuth category colours (2026-11-17). The AnnData reader reads a
      categorical column's `color` (int32 `0xRRGGBBAA`) when it has one per
      category, and new classes take it until the user picks another colour.
- [x] The 3D DAPI stack shown with the dataset (2026-11-17). **DECISION:**
      an alternative dataset image, `Morphology` in the Image section, that
      reloads the dataset with `aimg=3d`, as the MERSCOPE stain choice does;
      the stack gets the existing `Z plane` control. A manifest's 2D sidecar
      is not applied to it. The switch showed plane 8 of 15 in 1.7 s.
