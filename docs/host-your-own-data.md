# Host Your Own Data

The viewer reads data directly from browser-accessible URLs. It supports Xenium
output folders, Visium HD Space Ranger output folders, direct H5AD files,
SpatialData Zarr stores, and direct image URLs.

This page lists what to host. For exactly how each file is read, see the
modality docs: [Xenium](./modalities/xenium.md),
[Visium HD](./modalities/visium-hd.md), [H5AD](./modalities/h5ad.md),
[SpatialData](./modalities/spatialdata.md), and
[Image sources](./modalities/image.md).

Files can be renamed or moved: add a [dataset manifest](./dataset-manifest.md)
(`explorer.json`) that says where they are.

## HTTP Requirements

Large assets must support byte-range `GET` requests and CORS for the app origin.
AWS S3 and S3-compatible services such as Ceph RADOS Gateway (RGW) can work when
configured this way. See
[`docs/s3-cors-playbook.md`](./s3-cors-playbook.md) for the exact headers.

Important rules:

- Return `206 Partial Content` for `Range: bytes=0-0`.
- Expose `Content-Range` to browsers.
- Do not serve Parquet, TIFF, Zarr zip, OME-Zarr chunks, or HDF5 with transfer
  `Content-Encoding`.
- Keep object paths immutable when possible so browser/CDN caches stay useful.
- Allow `HEAD` requests. Platform detection, H5AD size checks, and the Parquet
  reader use them. A failed `HEAD` makes detection skip that platform.

## Host Your Own Xenium Data

At minimum, host a Xenium output folder with:

- `experiment.xenium`, or an `explorer.json` dataset manifest with
  `"platform": "xenium"`
- `cells.parquet`
- `cell_feature_matrix.zarr.zip` or `cell_feature_matrix.h5` for gene expression

For interactive ROI gene statistics, prefer `cell_feature_matrix.zarr.zip` files
with `cell_features/csc/*` arrays. Older XOA output falls back to
`cell_feature_matrix.h5`; see
[`docs/cell-feature-matrix-compatibility.md`](./cell-feature-matrix-compatibility.md).

Optional but supported Xenium files include:

- `cell_boundaries.parquet`
- `transcripts.parquet` for exact transcript metadata such as transcript ID,
  cell ID, QV, nucleus overlap, gene/control status, exact fallback reads, ROI
  transcript export, and selected-cell transcript z-axis distributions
- `transcripts.zarr.zip` for native low/medium zoom transcript density,
  aggregate count squares, and preferred exact transcript grid reads
- `analysis.zarr.zip`
- `analysis/umap/gene_expression_2_components/projection.csv`
- `analysis/tsne/gene_expression_2_components/projection.csv`
- `gene_panel.json` for the gene list (otherwise gene names come from
  `transcripts.zarr.zip`)
- `morphology.ome.tif`, `morphology_mip.ome.tif`, or morphology focus TIFFs,
  as listed in `experiment.xenium` (the first listed path is used, preferring
  MIP, then focus, then morphology)
- `.zchunkstore` tile-offset sidecars next to the morphology TIFFs, which skip
  TIFF directory parsing

Not read: `nucleus_boundaries.parquet`, `analysis/clustering/*` CSVs,
`metrics_summary.csv`, and `cells.zarr.zip`.

Expect Range validation for optional workflows too, including
`transcripts.parquet`, `transcripts.zarr.zip`, `cell_feature_matrix.zarr.zip`,
`cell_feature_matrix.h5`, OME-TIFFs, and analysis files when those workflows are
used.

## Host Your Own Visium HD Data

Host the Space Ranger output directory, usually the `outs/` folder. The app
detects Visium HD from binned output tiers under `binned_outputs/square_*um`.

For each binned tier you want selectable, include all three of:

- `binned_outputs/square_016um/spatial/tissue_positions.parquet`
- `binned_outputs/square_016um/spatial/scalefactors_json.json`
- `binned_outputs/square_016um/filtered_feature_bc_matrix.h5`

Use the matching `square_008um` or `square_002um` paths for 8 µm and 2 µm
tiers. A tier is offered only when all three files answer a `HEAD` request.
The app reads 16 µm and 8 µm positions directly; when 8 µm is present, loading
16 µm also reads the 8 µm positions to derive the grid. For 2 µm first paint it
uses `binned_outputs/square_002um/filtered_feature_bc_matrix/barcodes.tsv.gz`
and derives the grid from the 8 µm (or 16 µm) tier instead of reading the full
2 µm `tissue_positions.parquet`, which still has to exist for detection. Host
an 8 µm or 16 µm tier alongside 2 µm.

Strongly recommended:

- Root `feature_slice.h5`. Selected-gene overlays require it; there is no
  fallback to the filtered matrix.
- `filtered_feature_bc_matrix/features.tsv.gz` in the default tier for the
  gene list.

Optional but supported Visium HD files include:

- Root `barcode_mappings.parquet` for bin-to-cell assignment and
  segmented-cell expression profiles.
- `spatial/tissue_hires_image.png` in each tier for the tissue underlay
  (`tissue_lowres_image.png` is not used).
- Binned `analysis/umap/gene_expression_2_components/projection.csv` (or root
  `analysis/…`) for embedding views.
- Segmented outputs under `segmented_outputs/`:
  `cell_segmentations.geojson`, `nucleus_segmentations.geojson`,
  `nucleus_instance_mask.tiff`,
  `graphclust_annotated_cell_segmentations.geojson`, and
  `graphclust_annotated_nucleus_segmentations.geojson`. The graphclust files
  are used only when the plain GeoJSON is missing; the nucleus mask only when
  neither nucleus GeoJSON exists.

Visium HD does not provide Xenium-style transcript records, so the transcript
tab is hidden.

## Host Your Own H5AD Data

The app can load a direct AnnData `.h5ad` file URL. Enter the full file URL in
`Dataset or image URL`, for example:

```text
https://bucket.example/path/to/sample.h5ad
```

The H5AD reader requires:

- `/obs` with a readable dataframe index for cell IDs.
- `/var` with a readable dataframe index. A plain (non-categorical)
  `gene_symbols`, `gene_symbol`, `feature_name`, or `name` column replaces the
  index as the gene name.
- `/obsm` with an `n_obs x 2+` coordinate matrix. The first of `X_spatial`,
  `spatial`, `X_umap`, `umap`, `X_tsne`, `X_tSNE`, `tsne`, `X_pca` is used for
  positions, and every value must be finite.
- `/X` as either a dense `n_obs x n_vars` dataset or a sparse group with
  `data`, `indices`, `indptr`, and a `shape` attribute. Groups with
  `encoding-type = csc_matrix` are read as CSC; all others as CSR.

`/uns`, `/layers`, `/raw`, `/varm`, and `/obsp` are not read. See
[H5AD](./modalities/h5ad.md) for details.

Supported H5AD views:

- Cell rendering as pickable points from spatial or embedding coordinates.
- Embedding view options from numeric 2D `/obsm/*` matrices such as
  `/obsm/X_umap`, `/obsm/X_tsne`, and `/obsm/X_pca`.
- Categorical and string `obs` columns as annotation labels.
- Numeric `obs` columns as per-cell values in the Cell tab and as `Metadata`
  colour tracks.
- Selected-gene expression coloring, selected-cell gene profile, and ROI gene
  summaries from `/X`.

H5AD files do not provide Xenium transcript records, morphology images, or cell
boundary polygons by default, so those controls are disabled or unavailable for
H5AD datasets.

For hosted H5AD files, use the same CORS and byte-range rules listed above.
Files up to 300 MiB are downloaded whole (no byte ranges) and opened
client-side with `h5wasm`. Files larger than 300 MiB require a sibling kerchunk
reference JSON at the H5AD URL plus `.json`; for example:

```text
https://bucket.example/path/to/sample.h5ad
https://bucket.example/path/to/sample.h5ad.json
```

Generate the reference with `kerchunk.hdf.SingleHdf5ToZarr` (for example with
`inline_threshold=0`), then host both files with CORS and byte-range support.
The app probes the H5AD size first; when the file exceeds 300 MiB it opens the
JSON with Zarrita `ReferenceStore` and lazily reads the referenced HDF5 chunks.
Chunk references are always redirected to the H5AD URL, so the URL stored
inside the JSON does not matter. With the reference backend, all-gene reads
(selected-cell profile, ROI gene stats) are not supported for CSC matrices.

Reference hosted fixture:

```text
https://mp33.cog.sanger.ac.uk/public/h5ad/pbmc3k.h5ad
```

## Host Your Own SpatialData Data

The app can load a [SpatialData](https://spatialdata.scverse.org/) Zarr store
written by `spatialdata` (Zarr v2 or v3). Enter the store root URL in
`Dataset or image URL`, for example:

```text
https://bucket.example/path/to/sample.sdata.zarr
```

The store is detected from `spatialdata_attrs` in the root `.zattrs` or
`zarr.json`. It must be written with consolidated metadata (`zmetadata`,
`.zmetadata`, or `consolidated_metadata` in the root `zarr.json`), which
`spatialdata` does by default. The browser cannot list object-store prefixes,
so the consolidated metadata is how the app finds elements. Re-consolidate with
`sdata.write(path, consolidate_metadata=True)` or
`zarr.consolidate_metadata(path)` if the store was edited in place.

What the app reads:

- One coordinate system. Systems are ranked by how many of the table's
  annotated elements they hold, then whether they hold an image, then their
  total element count, then whether they are named `global`. The choice appears
  in the Dataset tab log; pick another one in the `Dataset` tab.
- One AnnData table: the first annotating a shapes element through `region`,
  `region_key`, and `instance_key`, else one annotating labels, else the first
  table. `X`, `obs`, `var`, and `obsm` are read the same way as H5AD: dense,
  CSR, or CSC matrices, categorical annotations, and `obsm` embeddings.
- Shapes from GeoParquet `shapes/<name>/shapes.parquet`. Table rows are placed
  at the centroid of their annotated circle or polygon, and those shapes are
  drawn as cell boundaries. When the annotated shapes are circles (for example
  Xenium `cell_circles`), a polygon element named like `cell_boundaries` that
  shares the same index is drawn instead.
- Labels (segmentation masks) annotated by the table. Rows are placed at their
  `obsm` spatial coordinates, read as label-pixel positions and mapped through
  the labels transform. Cell outlines are traced from the label pixels of the
  visible area when you zoom in below `Boundary limit`. Label ids come from the
  `instance_key` column when it holds integers, otherwise from an integer `obs`
  column named like `cell_labels`.
- One image element, as an OME-Zarr pyramid. The finest image is shown by
  default; pick another one in the `Dataset` tab. Scale and translation
  transforms are applied. Rotated, sheared, or flipped images are skipped.
  Native RGB (H&E) images, including three-channel 8-bit images with
  SpatialData's default channel labels `0`, `1`, `2`, keep their full 0-255
  display window instead of per-channel auto contrast. Chunks larger than 512
  pixels are split into smaller tiles.

Units: the viewer works in micrometers. The app uses the axis units the store
declares for the coordinate system. spatialdata-io stores usually declare none
(`unit`), so the app estimates the scale from Xenium-style `cell_area` against
segmentation areas, from the Visium 100 µm spot pitch (tables with `array_row`
and `array_col`), or from Visium HD `square_NNNum` bin names. When nothing
applies, distances are labelled as units. The `µm per unit` field in the
`Dataset` tab overrides the scale, for example `0.2125` for Xenium morphology
pixels. The coordinate system, image, and scale are kept in the shareable URL
(`sdCs`, `sdImage`, `sdUm`).

Not yet shown: `points` (transcripts) and more than one image at a time.

Large shapes elements are read whole through the browser Parquet reader, and
Zarr chunks (matrix, obs, and image) are cached in memory (up to 256 MiB) so
switching genes does not refetch them. Serve the store with the same CORS and
byte-range rules listed above. Object stores that answer missing metadata keys
with `403` are supported; `403` for data chunks is still an error.

Incomplete uploads: Zarr reads a missing chunk as the array fill value, so a
partly uploaded store can load with empty columns. The app logs table chunks
read that way, fails with `Store objects missing or unreadable` when a string
array or a required array cannot be read, and skips optional `obs` columns
whose chunks return `403`. `Diagnose Dataset` checks every table chunk and one
image chunk.

## Host Your Own Image-Only Data

Enter a direct image URL in `Dataset or image URL`. Supported URL forms are:

- `.ome.tif`, `.ome.tiff`, `.tif`, and `.tiff`
- `.ome.zarr`, `.zarr`, `zarr.json`, and `.zattrs`
- `.ndpi`, read with the same TIFF loader

OME-TIFF and TIFF assets must be tiled (not stripped), with pyramid levels
stored as `SubIFDs`. OME-Zarr sources must expose OME multiscales metadata.
Most NDPI files are stripped or use top-level IFD pyramids; convert them to
pyramidal OME-TIFF before hosting. See
[Image-only and GeoJSON](./image-only-and-geojson.md#supported-image-urls).

Image-only sources do not need transcriptomics files. The app disables genes,
transcripts, cell details, and Magic Lens, but keeps image channels, ROI drawing,
and GeoJSON shape annotation import/export available.

## Quick Validation

Use the app's `Diagnose Dataset` button against the hosted source before sharing
the link. For command-line validation, run a one-byte Range check against a key
large file. This example checks Xenium `cells.parquet`; substitute a Visium HD
positions Parquet, H5AD file, SpatialData `shapes.parquet`, image TIFF, or
other large asset for other source types:

```sh
curl -r 0-0 -i https://bucket.example/path/to/output/cells.parquet
```

The response should be `206 Partial Content` and include `Content-Range`.
