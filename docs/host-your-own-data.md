# Host Your Own Data

The viewer reads data directly from browser-accessible URLs. It supports Xenium
output folders, Visium HD Space Ranger output folders, direct H5AD files, and
direct image URLs.

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
- Allow `HEAD` requests because platform detection and H5AD size checks use
  them before loading.

## Host Your Own Xenium Data

At minimum, host a Xenium output folder with:

- `experiment.xenium`
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
- `morphology.ome.tif`, `morphology_mip.ome.tif`, or morphology focus TIFFs

Expect Range validation for optional workflows too, including
`transcripts.parquet`, `transcripts.zarr.zip`, `cell_feature_matrix.zarr.zip`,
`cell_feature_matrix.h5`, OME-TIFFs, and analysis files when those workflows are
used.

## Host Your Own Visium HD Data

Host the Space Ranger output directory, usually the `outs/` folder. The app
detects Visium HD from binned output tiers under `binned_outputs/square_*um`.

For each binned tier you want selectable, include:

- `binned_outputs/square_016um/spatial/tissue_positions.parquet`
- `binned_outputs/square_016um/spatial/scalefactors_json.json`
- `binned_outputs/square_016um/filtered_feature_bc_matrix.h5`

Use the matching `square_008um` or `square_002um` paths for 8 µm and 2 µm
tiers. The app reads 16 µm and 8 µm positions directly. For 2 µm first paint it
uses `filtered_feature_bc_matrix/barcodes.tsv.gz` and derives the affine grid
from a coarser tier instead of reading the full 2 µm
`tissue_positions.parquet`.

Optional but supported Visium HD files include:

- Root `feature_slice.h5` for selected-gene overlays.
- Root `barcode_mappings.parquet` for bin-to-cell assignment bridges.
- `spatial/tissue_hires_image.png` and `spatial/tissue_lowres_image.png` for
  tissue underlays.
- Binned `analysis/umap/gene_expression_2_components/projection.csv` for
  embedding views.
- Segmented outputs such as `cell_segmentations.geojson`,
  `nucleus_segmentations.geojson`, `nucleus_instance_mask.tiff`,
  `graphclust_annotated_cell_segmentations.geojson`, and
  `graphclust_annotated_nucleus_segmentations.geojson`.

Visium HD does not provide Xenium-style transcript records, so the transcript
tab is hidden.

## Host Your Own H5AD Data

The app can load a direct AnnData `.h5ad` file URL. Enter the full file URL in
`Dataset or image URL`, for example:

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

For hosted H5AD files, use the same CORS and byte-range rules listed above.
Files up to 300 MB use the browser HDF5 path and are opened client-side. Files
larger than 300 MB require a sibling kerchunk reference JSON at the H5AD URL
plus `.json`; for example:

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

## Host Your Own Image-Only Data

Enter a direct image URL in `Dataset or image URL`. Supported URL forms are:

- `.ome.tif`, `.ome.tiff`, `.tif`, and `.tiff`
- `.ome.zarr`, `.zarr`, `zarr.json`, and `.zattrs`
- `.ndpi` when the browser TIFF path can read the variant

OME-TIFF and TIFF assets should be tiled pyramids for interactive navigation.
OME-Zarr sources must expose OME multiscales metadata. Unsupported NDPI variants
should be converted to pyramidal OME-TIFF before hosting.

Image-only sources do not need transcriptomics files. The app disables genes,
transcripts, cell details, and Magic Lens, but keeps image channels, ROI drawing,
and GeoJSON shape annotation import/export available.

## Quick Validation

Use the app's `Diagnose Dataset` button against the hosted source before sharing
the link. For command-line validation, run a one-byte Range check against a key
large file. This example checks Xenium `cells.parquet`; substitute a Visium HD
positions Parquet, H5AD file, image TIFF, or other large asset for other source
types:

```sh
curl -r 0-0 -i https://bucket.example/path/to/output/cells.parquet
```

The response should be `206 Partial Content` and include `Content-Range`.
