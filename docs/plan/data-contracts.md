# Data Contracts

## 5.1 Xenium Output (Read As-Is; Never Require Preprocessing)

Reference: 10x "Understanding Xenium Outputs".

| File                                             | Reader             | Use                                                                                                  |
| ------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `experiment.xenium`                              | fetch JSON         | Panel, chemistry, pixel size (0.2125 µm), software version, and the file manifest (morphology paths) |
| `cells.parquet`                                  | hyparquet, DuckDB  | Centroids, `cell_area`, `nucleus_area`, `transcript_counts`, `file_row_number`                       |
| `cell_boundaries.parquet`                        | DuckDB (Range)     | Polygon vertices per `cell_id`                                                                       |
| `nucleus_boundaries.parquet`                     | DuckDB (Range)     | Nucleus polygons per `cell_id` and `label_id` ([Phase 17](phases/17-xenium-nucleus-boundaries.md))   |
| `transcripts.parquet`                            | DuckDB (Range)     | Per-transcript `cell_id`, `feature_name`, x/y/z, `qv`, `overlaps_nucleus`, `is_gene`                 |
| `transcripts.zarr.zip`                           | zarrita            | Native transcript LOD: `/grids` pyramid and level-0 tiles; `/density/gene` (selected genes, 15.1-J)  |
| `cell_feature_matrix.zarr.zip`                   | zarrita            | Per-cell sparse counts (CSC or feature-major)                                                        |
| `cell_feature_matrix.h5`                         | h5wasm             | Same matrix; fallback                                                                                |
| `analysis.zarr.zip`                              | zarrita            | Clustering                                                                                           |
| `analysis/{umap,tsne}/…/projection.csv`          | fetch CSV          | UMAP / t-SNE                                                                                         |
| `gene_panel.json`                                | fetch JSON         | Full gene list, so genes can be picked before any selection                                          |
| `morphology_focus/morphology_focus_000N.ome.tif` | geotiff + OpenJPEG | Multi-channel focus images                                                                           |
| `morphology_mip.ome.tif` / `morphology.ome.tif`  | geotiff + OpenJPEG | DAPI MIP / Z-stack (`Z plane` selector)                                                              |
| `.zchunkstore`                                   | fetch JSON         | Precomputed TIFF tile byte ranges                                                                    |
| `metrics_summary.csv`                            | papaparse          | QC display (no implementation recorded)                                                              |

Rules to encode once:

- **Coordinates.** Micrometres, origin top-left, Y down (px = µm / 0.2125).
  deck.gl `OrthographicView` with `flipY: false` is Y-up, so Y is negated. All
  conversions live in `coords.ts`.
- **Cell IDs.** Parquet uses a shifted-hex string; the matrix Zarr uses a
  `[prefix, suffix]` uint32 pair. The codec must round-trip, tested against a
  real pair.
- **Scope.** `cells-only` and `spatial` transcript scopes differ by design
  (extracellular transcripts). Keep both and label them clearly.
- **Features.** Exclude `NegControlProbe`, `NegControlCodeword`, `BLANK`,
  `UnassignedCodeword`, `antisense`, and `Deprecated` from genes. Keep them for
  QC.
- **Sizes.** Buffer `cells.parquet`. Range-read `cell_boundaries.parquet` and
  `transcripts.parquet`.

Facts verified on the demo dataset:

- `morphology_mip.ome.tif` is missing; the loader uses
  `morphology_focus/morphology_focus_0000.ome.tif`, which has 9 pyramid levels.
- OME-XML channels: DAPI, ATP1A1/CD45/E-Cadherin, 18S, and alphaSMA/Vimentin.
- `cells.parquet` is ZSTD-compressed.
- The cell-feature matrix may expose only feature-major arrays, without the
  `csc` group.
- Level-0 `transcripts.zarr.zip` tiles expose location, gene/codeword identity,
  ID, quality score, validity/status, UUID, and gene offsets. They have no
  per-transcript cell assignment. There is no `/density/codeword` group.
- A cold Zarr read for even one cell can take about 20 s, because the cost is
  opening the feature-matrix path, not the sample size.
- `cells.zarr.zip` and `cell_feature_matrix.*` cannot give per-transcript cell
  assignment.

## 5.2 Visium HD Output (Space Ranger `outs/`)

10x references:

- [Understanding Space Ranger outputs](https://www.10xgenomics.com/support/software/space-ranger/latest/analysis/outputs/output-overview)
- [Segmented outputs](https://www.10xgenomics.com/support/software/space-ranger/latest/analysis/outputs/segmented-outputs)
- [Feature Slice H5](https://www.10xgenomics.com/support/software/space-ranger/latest/analysis/outputs/space-ranger-feature-slice-h5)

The binned `filtered_feature_bc_matrix.h5` is a standard matrix output, but
interactive selected-gene overlays should use `feature_slice.h5`. 10x documents
it as the Visium HD path for fast single- or multi-gene 2 µm slices that can be
binned to 8 or 16 µm.

Facts probed on the reference dataset:

| Item                                                 | Value                                                                                                                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top-level entries                                    | `binned_outputs/`, `segmented_outputs/`, `spatial/`, `barcode_mappings.parquet`, `feature_slice.h5`, `metrics_summary.csv`, `molecule_info.h5`, `probe_set.csv`, `web_summary.html` |
| `tissue_positions.parquet` size (16 / 8 / 2 µm)      | 3.3 MB / 11.3 MB / 171.2 MB; one row group each, so no row-group pruning                                                                                                            |
| Position schema                                      | `barcode`, `in_tissue`, `array_row`, `array_col`, `pxl_row_in_fullres`, `pxl_col_in_fullres`                                                                                        |
| `filtered_feature_bc_matrix.h5` size (16 / 8 / 2 µm) | 121.6 MB / 160.3 MB / 236.5 MB                                                                                                                                                      |
| Filtered barcodes (16 / 8 / 2 µm)                    | 54,504 / 215,320 / 3,443,936; 18,085 gene features                                                                                                                                  |
| `feature_slice.h5`                                   | 503.2 MB, Range-readable                                                                                                                                                            |
| `barcode_mappings.parquet`                           | 109.8 MB; 11,222,500 rows in 1,123 row groups; `square_002um`, `square_008um`, `square_016um`, `cell_id`, `in_nucleus`, `in_cell`                                                   |
| `molecule_info.h5`                                   | 989.0 MB                                                                                                                                                                            |
| Tissue images                                        | High-res 6000 × 5143 (37.6 MB); low-res 600 × 514 (230.7 KB)                                                                                                                        |
| Root `spatial/scalefactors_json.json`                | Returns 404. Use the binned or segmented scalefactors                                                                                                                               |
| Binned `scalefactors_json.json`                      | `microns_per_pixel = 0.22133875377751464`; `spot_diameter_fullres` 72.287 / 36.144 / 9.036 px                                                                                       |
| Segmented `scalefactors_json.json`                   | Same image scale fields; no `bin_size_um` or `spot_diameter_fullres`                                                                                                                |
| Missing scalefactor fields                           | This dataset omits `tissue_hires_image_width`/`height`                                                                                                                              |
| 16 µm array → full-res transform                     | Affine with a small residual: column step (row px +0.2023, col px −72.2784); row step (row px +72.2785, col px +0.2035)                                                             |

Matrix Market sidecars are larger than the H5 files, so they are not a usable
interactive fallback.

Segmented-output files named by Space Ranger 4.1: `cell_segmentations.geojson`,
`nucleus_segmentations.geojson`, `nucleus_instance_mask.tiff`,
`graphclust_annotated_cell_segmentations.geojson`,
`graphclust_annotated_nucleus_segmentations.geojson`, and the feature-cell
matrices.

## 5.3 AnnData H5AD

- `/obs`: cell IDs and observations. Categorical and string columns are
  annotation tracks. Numeric columns are parsed as continuous tracks and shown
  as Cell Info values (not yet as colour tracks; see Phase 7). Category sidecars
  such as `/obs/__categories/leiden` are supported. Boolean columns load as 0/1
  on every backend.
- `/var`: gene names.
- `/X`: expression, `n_obs × n_vars`. Dense, CSR, or CSC.
- `/obsm`: coordinates. The first present key of `X_spatial`, `spatial`,
  `X_umap`, `umap`, `X_tsne`, `X_tSNE`, `tsne`, `X_pca` is used, as
  micrometres. Fail with a schema error if none is usable or a value is not
  finite. Every valid numeric 2D `obsm` matrix is offered as an embedding.
- Duplicate or missing obs/var names are normalized deterministically.
- **Size gate.** Files up to 300 MiB (314,572,800 bytes) are downloaded whole
  and opened with h5wasm. Larger files need a sibling `DATASET.h5ad.json`
  reference, read with the Zarrita `ReferenceStore`, or a sibling
  `DATASET.h5ad.icechunk` repository, read with `icechunk-js`, so `/X` data
  and indices stay lazy. `scripts/make_h5ad_reference.py` writes either. The
  H5AD URL's query string is carried to the reference URL, so presigned URLs
  need a matching presigned reference.
- Planned, not done: `/layers/*` and `/raw/X` as selectable expression sources.

## 5.4 Image-Only Sources (Phase 8)

- Direct `.ome.tif`, `.ome.tiff`, `.tif`, and `.tiff` URLs, plus `.ndpi`
  through the same TIFF loader (no NDPI-specific code).
- TIFFs must be tiled, with pyramid levels as `SubIFDs` of the base image, and
  8- or 16-bit samples with 1, 3, or 4 samples per pixel. Stripped TIFFs and
  top-level-IFD pyramids are not indexed; most NDPI files fall in these cases
  and should be converted to pyramidal OME-TIFF.
- µm/px comes from OME-XML `PhysicalSizeX` (default 0.2125). `Channel@Color` is
  a signed 32-bit RGBA integer with red in the high byte (`3e1a8d5`).
- Extent is image dimensions × microns per pixel.
- Codecs: JPEG 2000 through OpenJPEG; uncompressed and no-predictor LZW built
  in; everything else (LZW with predictor, JPEG, Deflate, PackBits, LERC, Zstd,
  WebP) through geotiff.js decoders. Planar (separate-plane) tiles are supported
  (`0d67e06`).

## 5.5 OME-Zarr Images (Phase 9)

- Zarr v2 or v3; `multiscales[0]` from `attrs.ome` (OME-Zarr 0.5) or `attrs`.
  `x` and `y` axes are required; only `t = 0` and `z = 0` are shown.
- µm/px is the product of multiscale and dataset `scale` values for `x`, with
  unit conversion; a missing scale gives 1 µm/px.
- `omero.channels` gives names, colours, and windows. Three channels with no
  omero data, or labelled or coloured red, green, and blue, are native RGB.
- Tile size is the x/y chunk shape; chunks over 512 px are served as virtual
  tiles that share one decoded chunk.

## 5.6 SpatialData Stores (Phase 10)

- The root is SpatialData when `spatialdata_attrs` is present and none of
  `coordinateTransformations`, `encoding-type`, `multiscales`, or `ome` is (so a
  URL to `…/images/<name>` opens as a plain OME-Zarr image).
- A `.zip` URL is a zipped store. Its root is the shallowest folder in the zip
  holding Zarr root metadata. Besides `spatialdata_attrs`, a zipped root is
  SpatialData when it holds `images`, `labels`, `points`, `shapes`, or
  `tables` groups and its attributes do not mark an image or AnnData, because
  some writers leave root attributes out.
- Consolidated metadata is required.
- Elements are `<kind>/<name>` groups under `images`, `labels`, `points`,
  `shapes`, and `tables`. Supported transforms: `identity`, `scale`,
  `translation`, `affine`, `mapAxis` (x/y swaps), and `sequence`.
- One table is shown: the first annotating a shapes element, else a labels
  element, else the first table. `region`, `region_key`, and `instance_key` come
  from `spatialdata_attrs`.
- One coordinate system is shown: ranked by table regions placed in it, then
  whether it holds an image, then element count, then the name `global`.
- One image is shown: axis-aligned, positive-scale, highest resolution.
- Shapes: `shapes.parquet` (GeoParquet or WKB; Point, Polygon, MultiPolygon).
  Points become circles from the `radius` column. Polygons keep the outer ring
  of their largest polygon, read from WKB into a `Float32Array`.
- Labels: rows are placed from `obsm` through the labels transform, and cell
  outlines are traced from the label raster on demand.
- Not read: `points` (transcripts), extra images, and extra tables.

## 5.7 Dataset Manifest (Phase 11)

- Optional `explorer.json` in the dataset folder, or any `.json` URL entered
  directly (except Zarr `zarr.json`). Full reference:
  [`docs/dataset-manifest.md`](../dataset-manifest.md); schema:
  [`public/schemas/explorer-manifest.v1.json`](../../public/schemas/explorer-manifest.v1.json).
- Required: `version: 1` and `platform`. Optional: `name`, `description`,
  `root`, `files`, `options`, `defaults`.
- `files` maps each standard file to another relative path or http(s) URL;
  files left out keep their standard names. H5AD, SpatialData, and image
  manifests must name their one source file.
- `options`: Visium HD `binSize`; SpatialData `coordinateSystem`, `image`,
  `micrometersPerUnit`.
- `defaults`: genes, cell colour, gene scale and score, boundary toggles, image
  channels, three opacities, and the transcript overlay. A shared link's own
  fields take precedence.
- Validation is strict: unknown fields and wrong types are errors. A probed
  file that is missing, not JSON, or has neither `platform` nor `version` means
  no manifest.
