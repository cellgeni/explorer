# Documentation

## Using The Viewer

- [Examples](../examples/README.md): public datasets from BioImage Archive,
  CELLxGENE, IDR, and other repositories, each a manifest that opens in the
  viewer.
- [User guide](./user-guide.md): loading data, navigation, genes, transcripts,
  annotations, ROI, embeddings, diagnostics, and shareable URLs.
- [UI reference](./ui-reference.md): every panel, control, default, interaction,
  and shareable URL parameter, with the component that renders it and the
  platforms that show it.

## Hosting Data And Deploying

- [Host your own data](./host-your-own-data.md): which files to host for each
  source type.
- [Dataset manifest](./dataset-manifest.md): an optional `explorer.json` that
  declares the platform, points to renamed or moved files, and sets what the
  viewer shows on first load.
- [S3/CORS hosting playbook](./s3-cors-playbook.md): CORS, byte-range, and
  caching rules for dataset buckets.
- [Image-only and GeoJSON](./image-only-and-geojson.md): direct image URLs and
  GeoJSON shape import/export.
- [TIFF tile-offset sidecars](./zchunkstore.md): the optional `.zchunkstore`,
  when it helps, and how to generate one with `scripts/make_zchunkstore.py`.
- [Large H5AD files](./h5ad-reference.md): the `.h5ad.json` kerchunk
  reference or `.h5ad.icechunk` Icechunk repository that H5AD files over
  300 MiB need, what they hold, how the viewer reads through them, and how to
  generate one with `scripts/make_h5ad_reference.py`.
- [Deploy to S3](./deploy-to-s3.md): getting the app from a release zip or a
  local build, and hosting it.

## How It Works

- [Architecture](./architecture.md): source layout, detection order, load
  pipeline, platform gating, coordinates, caching, workers, and errors.
- Modalities, one page each with detection, every file read, the libraries
  used, the read path for each feature, source files, and known limitations:

  | Modality    | Input                                          | Detected by                                            | Doc                                           |
  | ----------- | ---------------------------------------------- | ------------------------------------------------------ | --------------------------------------------- |
  | Xenium      | XOA output folder                              | `experiment.xenium`                                    | [xenium.md](./modalities/xenium.md)           |
  | Atera       | Atera Onboard Analysis output folder           | `experiment.spatial`                                   | [atera.md](./modalities/atera.md)             |
  | Visium      | Space Ranger `outs/` folder, or Visium `.h5ad` | Positions, scale factors, and matrix; or `uns/spatial` | [visium.md](./modalities/visium.md)           |
  | Visium HD   | Space Ranger `outs/` folder                    | `binned_outputs/square_*um` tiers                      | [visium-hd.md](./modalities/visium-hd.md)     |
  | H5AD        | `.h5ad` file URL                               | URL suffix                                             | [h5ad.md](./modalities/h5ad.md)               |
  | SpatialData | Zarr store root                                | `spatialdata_attrs` in root metadata                   | [spatialdata.md](./modalities/spatialdata.md) |
  | Image       | OME-TIFF, TIFF, QPTIFF, NDPI, or OME-Zarr URL  | URL suffix or Zarr metadata                            | [image.md](./modalities/image.md)             |

  Any of these can instead be described by a
  [dataset manifest](./dataset-manifest.md), which names the platform and
  files.

## Design Decisions

- [Cell-feature matrix compatibility](./cell-feature-matrix-compatibility.md):
  native CSC Zarr first, `cell_feature_matrix.h5` as the fallback for older
  Xenium output.
- [Visium HD 2 µm strategy](./visium-hd-2um-strategy.md): building the 2 µm
  grid from filtered barcodes instead of the full positions file.

## Planning Records

[`UNIFIED_PLAN.md`](../UNIFIED_PLAN.md) in the repository root records the
build plan, phase-by-phase execution notes, architecture decisions, and
refactor progress. It merges the former `PLAN.md`, `UPDATED_PLAN.md`, and
`OPTIMIZATIONS.md`. It describes intent and history; the pages above describe
current behaviour. [`PLAN_VS_DOCS.md`](../PLAN_VS_DOCS.md) lists where the plan
and these pages differed as of 2026-11-08.
