# Host Your Own Xenium Data

## Required Files

At minimum, host a Xenium output folder with:

- `experiment.xenium`
- `cells.parquet`
- `cell_feature_matrix.zarr.zip` or `cell_feature_matrix.h5` for gene expression

Optional but supported files include:

- `cell_boundaries.parquet`
- `transcripts.parquet`
- `analysis.zarr.zip`
- `analysis/umap/gene_expression_2_components/projection.csv`
- `analysis/tsne/gene_expression_2_components/projection.csv`
- `morphology.ome.tif`, `morphology_mip.ome.tif`, or morphology focus TIFFs

## HTTP Requirements

The app reads large files directly in the browser, so hosting must support
byte-range `GET` requests and CORS for the app origin. See
[`docs/s3-cors-playbook.md`](./s3-cors-playbook.md) for the exact headers.

Important rules:

- Return `206 Partial Content` for `Range: bytes=0-0`.
- Expose `Content-Range` to browsers.
- Do not serve Parquet, TIFF, Zarr zip, or HDF5 with transfer
  `Content-Encoding`.
- Keep object paths immutable when possible so browser/CDN caches stay useful.

## Quick Validation

Use the app's `Diagnose Dataset` button against the hosted folder before sharing
the link. For command-line validation, run:

```sh
curl -r 0-0 -i https://bucket.example/path/to/output/cells.parquet
```

The response should be `206 Partial Content` and include `Content-Range`.
