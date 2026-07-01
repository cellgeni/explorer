# Host Your Own Xenium Data

## Required Files

At minimum, host a Xenium output folder with:

- `experiment.xenium`
- `cells.parquet`
- `cell_feature_matrix.zarr.zip` (or `cell_feature_matrix.h5`) for gene expression

For interactive ROI gene statistics, prefer `cell_feature_matrix.zarr.zip` files
with `cell_features/csc/*` arrays. Older XOA output falls back to
`cell_feature_matrix.h5`; see
[`docs/cell-feature-matrix-compatibility.md`](./cell-feature-matrix-compatibility.md).

Optional but supported files include:

- `cell_boundaries.parquet`
- `transcripts.parquet` for exact transcript metadata such as transcript ID,
  cell ID, QV, nucleus overlap, gene/control status, exact fallback reads, ROI
  transcript export, and selected-cell transcript z-axis distributions
- `transcripts.zarr.zip` for native low/medium zoom transcript density,
  aggregate count squares, and preferred exact transcript grid reads
- `analysis.zarr.zip`
- `analysis/umap/gene_expression_2_components/projection.csv`
- `analysis/tsne/gene_expression_2_components/projection.csv`
- `morphology.ome.tif`, `morphology_mip.ome.tif`, or morphology focus TIFFs

## HTTP Requirements

The app reads large files directly in the browser, so hosting must support
byte-range `GET` requests and CORS for the app origin. AWS S3 and S3-compatible
services such as Ceph RADOS Gateway (RGW) can work when configured this way. See
[`docs/s3-cors-playbook.md`](./s3-cors-playbook.md) for the exact headers.

Important rules:

- Return `206 Partial Content` for `Range: bytes=0-0`.
- Expose `Content-Range` to browsers.
- Do not serve Parquet, TIFF, Zarr zip, or HDF5 with transfer
  `Content-Encoding`.
- Keep object paths immutable when possible so browser/CDN caches stay useful.
- Expect Range validation for optional workflows too, including
  `transcripts.parquet`, `transcripts.zarr.zip`, `cell_feature_matrix.zarr.zip`,
  `cell_feature_matrix.h5`, OME-TIFFs, and analysis files when those workflows
  are used.

## Quick Validation

Use the app's `Diagnose Dataset` button against the hosted folder before sharing
the link. For command-line validation, run:

```sh
curl -r 0-0 -i https://bucket.example/path/to/output/cells.parquet
```

The response should be `206 Partial Content` and include `Content-Range`.

# Host Your Own H5AD Data

The app can also load a direct AnnData `.h5ad` file URL. Enter the full file URL
in `Dataset URL`, for example:

```text
https://bucket.example/path/to/sample.h5ad
```

The first H5AD implementation expects:

- `/obs` with a readable dataframe index for cell IDs.
- `/var` with a readable dataframe index or gene-name column.
- `/obsm/X_spatial`, `/obsm/spatial`, or a supported embedding such as
  `/obsm/X_umap` with an `n_obs x 2+` coordinate matrix.
- `/X` as either a dense `n_obs x n_vars` dataset or a CSR/CSC sparse group
  with `data`, `indices`, `indptr`, and `shape`.

Supported H5AD views:

- Cell rendering as pickable points from spatial or embedding coordinates.
- Embedding view options from numeric 2D `/obsm/*` matrices such as
  `/obsm/X_umap`, `/obsm/X_tsne`, and `/obsm/X_pca`.
- Categorical `obs` columns as annotation labels.
- Numeric `obs` columns as continuous metadata tracks.
- Selected-gene expression coloring, selected-cell gene profile, and ROI gene
  summaries from `/X`.

H5AD files do not provide Xenium transcript records, morphology images, or cell
boundary polygons by default, so those controls are disabled or unavailable for
H5AD datasets.

For hosted H5AD files, use the same CORS and byte-range rules as large Xenium
assets. Files up to 300 MB use the browser HDF5 path and are opened
client-side. Files larger than 300 MB require a sibling kerchunk reference JSON
at the H5AD URL plus `.json`; for example:

```text
https://bucket.example/path/to/sample.h5ad
https://bucket.example/path/to/sample.h5ad.json
```

Generate the reference with `kerchunk.hdf.SingleHdf5ToZarr` using
`inline_threshold=0`, then host both files with CORS and byte-range support. The
app probes the H5AD size first; when the file exceeds 300 MB it opens the JSON
with Zarrita `ReferenceStore` and lazily reads the referenced HDF5 chunks.

Reference hosted fixture:

```text
https://mp33.cog.sanger.ac.uk/public/h5ad/pbmc3k.h5ad
```
