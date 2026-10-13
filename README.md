# Spatial Omics Explorer

Browser-based explorer for hosted spatial-omics and image data. The app loads
10x Xenium output folders, Visium HD Space Ranger output folders, direct AnnData
`.h5ad` files, SpatialData Zarr stores, and image-only OME-TIFF/TIFF/OME-Zarr
URLs from object storage.
It renders spatial cells, bins, image pyramids, morphology channels, expression
overlays, transcript density/exact overlays, annotations, ROI queries,
shareable view state, and dataset diagnostics without a server-side data
service.

The implementation is a Vite + React application. It uses deck.gl for spatial
rendering, DuckDB WASM and Hyparquet for browser-side Parquet queries, GeoTIFF,
OME-Zarr, and JPEG2000 decoding for image tiles, and Zarr/HDF5 readers for
cell-feature matrices, Feature Slice H5, H5AD, and native transcript LOD access.

## Quick Start

```sh
npm ci
npm run dev
```

Useful development commands:

```sh
npm run typecheck
npm run lint
npm run test
npm run build
npm run preview
```

End-to-end tests use the built app through Vite preview:

```sh
npm run build
npm run test:e2e
```

The Vite dev and preview servers are configured with cross-origin isolation
headers needed by the browser-side WASM and decoding paths.

## Repository Layout

- `src/App.tsx` coordinates dataset loading, controls, diagnostics, URL hash
  state, ROI workflows, and the viewer shell.
- `src/components/` contains the spatial viewer, morphology canvas, error
  boundary, and viewer model helpers.
- `src/data/` contains browser data access for Parquet, Zarr, HDF5, analysis
  outputs, annotations, ROI queries, diagnostics, range checks, telemetry, and
  shareable state.
- `src/datasets/` defines the spatial dataset interface and platform
  implementations for Xenium, Visium HD, H5AD, SpatialData, and image-only
  sources.
- `src/features/` contains domain UI and workflow modules for the app shell,
  genes, transcripts, annotations, ROI, morphology, cells, diagnostics, and
  platform-specific behavior.
- `src/rendering/` contains deck.gl layer creation, styling, aggregation,
  viewport logic, opacity handling, and morphology canvas helpers.
- `src/tiff/`, `src/codecs/`, `src/zarr/`, and `src/workers/` handle tiled
  OME-TIFF and OME-Zarr loading, JPEG2000 decoding, byte-range chunk access,
  tile caching, and worker-backed decode concurrency.
- `tests/e2e/` contains Playwright coverage; colocated `*.test.ts` and
  `*.test.tsx` files cover the data, rendering, component, and store modules.

## Data Expectations

Enter a source in the `Dataset or image URL` field:

- Xenium: output folder with `experiment.xenium`, `cells.parquet`, and a
  readable `cell_feature_matrix.zarr.zip` or `cell_feature_matrix.h5`.
- Visium HD: Space Ranger `outs/` folder with at least one
  `binned_outputs/square_*um` tier containing positions, scalefactors, and a
  filtered feature-barcode matrix.
- H5AD: direct `.h5ad` file URL with `obs`, `var`, `/X`, and a supported 2D
  `obsm` coordinate matrix.
- SpatialData: Zarr store root (v2 or v3) with consolidated metadata, an AnnData
  table annotating a shapes element, and optionally an image element.
- Image-only: direct OME-TIFF, TIFF, OME-Zarr, or validated NDPI URL.

Because data is read directly by the browser, hosted datasets must support CORS
and HTTP byte-range requests for large binary assets. The in-app
`Diagnose Dataset` action checks the detected platform and the key assets for
the active source.

## Additional Docs And Decisions

- [User guide](docs/user-guide.md): loading supported sources, navigation,
  layers, genes, transcript overlays, annotations, ROI tools, embeddings,
  diagnostics, and shareable URLs.
- [Deploy the React app to S3-compatible object storage](docs/deploy-to-s3.md):
  build the Vite app, upload `dist/` to AWS S3 or Ceph RGW-style storage,
  configure edge headers, and validate production.
- [Host your own data](docs/host-your-own-data.md): required and optional files
  for Xenium, Visium HD, H5AD, SpatialData, and image-only sources, plus HTTP
  requirements
  and quick validation commands.
- [Image-only and GeoJSON annotations](docs/image-only-and-geojson.md): direct
  image URL support, platform gating, and GeoJSON shape import/export rules.
- [S3/CORS hosting playbook](docs/s3-cors-playbook.md): exact CORS headers,
  object serving rules, byte-range validation, and CDN considerations.
- [Cell-feature matrix compatibility](docs/cell-feature-matrix-compatibility.md):
  the key decision to prefer native CSC Zarr for fast ROI gene statistics and
  fall back to HDF5 for older Xenium output, instead of generating custom
  cell-major sidecars.
- [Visium HD 2 µm strategy](docs/visium-hd-2um-strategy.md): why 2 µm first
  paint uses filtered matrix barcodes and a derived affine grid instead of the
  full `tissue_positions.parquet`.
