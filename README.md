# Xenium Spatial Transcriptomics Visualizer

Browser-based explorer for 10x Xenium spatial transcriptomics output. The app
loads hosted Xenium output folders directly from object storage, renders spatial
cells and morphology imagery, and supports gene expression overlays,
annotations, embeddings, ROI queries, shareable view state, and dataset
diagnostics without a server-side data service.

The implementation is a Vite + React application. It uses deck.gl for spatial
rendering, DuckDB WASM and Hyparquet for browser-side Parquet queries, GeoTIFF
and JPEG2000 decoding for morphology tiles, and Zarr/HDF5 readers for
cell-feature matrix access.

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
- `src/datasets/` defines the spatial dataset interface and the Xenium dataset
  implementation.
- `src/rendering/` contains deck.gl layer creation, styling, aggregation,
  viewport logic, opacity handling, and morphology canvas helpers.
- `src/tiff/`, `src/codecs/`, and `src/workers/` handle tiled OME-TIFF loading,
  JPEG2000 decoding, byte-range chunk access, tile caching, and worker-backed
  decode concurrency.
- `tests/e2e/` contains Playwright coverage; colocated `*.test.ts` and
  `*.test.tsx` files cover the data, rendering, component, and store modules.

## Data Expectations

The viewer expects a Xenium output directory URL containing at least
`experiment.xenium`, `cells.parquet`, and a readable cell-feature matrix
(`cell_feature_matrix.zarr.zip` or `cell_feature_matrix.h5`). Optional files
such as `cell_boundaries.parquet`, `transcripts.parquet`, `analysis.zarr.zip`,
UMAP/t-SNE projections, and morphology OME-TIFFs enable additional layers and
workflows.

Because data is read directly by the browser, hosted datasets must support CORS
and HTTP byte-range requests. The in-app `Diagnose Dataset` action checks the
manifest and key byte-range reads before loading optional assets.

## Additional Docs And Decisions

- [User guide](docs/user-guide.md): loading data, navigation, layers, genes,
  annotations, ROI tools, embeddings, diagnostics, and shareable URLs.
- [Host your own data](docs/host-your-own-data.md): required and optional
  Xenium files, HTTP requirements, and quick validation commands.
- [S3/CORS hosting playbook](docs/s3-cors-playbook.md): exact CORS headers,
  object serving rules, byte-range validation, and CDN considerations.
- [Cell-feature matrix compatibility](docs/cell-feature-matrix-compatibility.md):
  the key decision to prefer native CSC Zarr for fast ROI gene statistics and
  fall back to HDF5 for older Xenium output, instead of generating custom
  cell-major sidecars.
