# Spatial Omics Explorer

Browser-based explorer for hosted spatial-omics and image data. The app loads
10x Xenium and Atera output folders, standard Visium (55 µm spots) and Visium
HD Space Ranger output folders, Vizgen MERSCOPE region folders, AnnData
`.h5ad` files and AnnData Zarr stores (including Visium AnnData with
`uns/spatial`), SpatialData Zarr stores, and image-only
OME-TIFF/TIFF/QPTIFF/SVS/NDPI/OME-Zarr URLs from object storage, and dataset
collections that list several of them to browse together.
It renders spatial cells, spots, bins, image pyramids, morphology channels, expression
overlays, transcript density/exact overlays, annotations, ROI queries,
shareable view state, and dataset diagnostics without a server-side data
service. `Browse Store` and `Browse File` show what a Zarr store or Parquet
file holds without opening it as a dataset.

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

`npm run test:coverage` runs the unit tests with V8 coverage, writes an HTML
report to `coverage/`, and fails below the thresholds in `vitest.config.ts`. CI
runs it on every pull request in a separate job that reports but does not block;
`npm test` is the required check.

End-to-end tests use the built app through Vite preview:

```sh
npm run build
npm run test:e2e
```

One smoke test runs the axe accessibility rules (WCAG 2.2 A and AA) on the
layer sections, the info drawer, the dataset menu, Help, Settings and the
Embedding panel, empty and with a fixture loaded. Known violations are
listed in `tests/e2e/axe-baseline.json`, and any other violation fails the
test. When you fix one, the test fails until you remove it from the list; to
rewrite the list, run:

```sh
UPDATE_AXE_BASELINE=1 npx playwright test --grep "axe baseline"
```

The Vite dev and preview servers are configured with cross-origin isolation
headers needed by the browser-side WASM and decoding paths.

To measure main-thread work and load times, or to serve datasets locally with
byte ranges, see [Profiling](docs/profiling.md).

## Releases

To cut a release, open Releases > Draft a new release, create a new `vX.Y.Z`
tag on `main`, generate the release notes, and publish. The
[Release workflow](.github/workflows/release.yml) then type-checks the tag,
runs the unit and E2E smoke tests, builds the app, and attaches it to the
release as `explorer-<tag>.zip`. Pre-releases get a zip too. To retry, or to
attach a zip to an older release, run the workflow manually with the tag.

The zip holds one `explorer-<tag>/` folder with `index.html`, `assets/`,
`LICENSE`, and a `version.json` that records the tag and commit. Asset paths are relative, so
the folder works when served from a domain root or any subpath. It has to be
served over HTTP; opening `index.html` from disk does not work. See
[Deploy to S3](docs/deploy-to-s3.md) for hosting it.

## Repository Layout

- `src/App.tsx` coordinates dataset loading, controls, diagnostics, URL hash
  state, ROI workflows, and the viewer shell.
- `src/components/` contains the spatial viewer, morphology canvas, error
  boundary, and viewer model helpers.
- `src/data/` contains browser data access for Parquet, Zarr, HDF5, analysis
  outputs, annotations, ROI queries, diagnostics, range checks, telemetry, and
  shareable state.
- `src/datasets/` defines the spatial dataset interface and platform
  implementations for Xenium, Atera, standard Visium, Visium HD, MERSCOPE,
  H5AD, SpatialData, and image-only sources.
- `src/features/` contains domain UI and workflow modules for the app shell,
  genes, transcripts, annotations, ROI, morphology, cells, diagnostics,
  dataset collections, the store and file browser, and platform-specific
  behaviour.
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
- Atera: Atera Onboard Analysis output folder with `experiment.spatial`,
  `cell_feature_matrix.zarr.zip`, `csc_cell_feature_matrix.zarr.zip`, and
  `cells.zarr.zip`, plus the `morphology_2d/` OME-TIFFs for the image.
- Standard Visium (v1/v2, 55 µm spots): Space Ranger `outs/` folder with
  `spatial/tissue_positions.csv` (or the 1.x `tissue_positions_list.csv`),
  `spatial/scalefactors_json.json`, and `filtered_feature_bc_matrix.h5`, plus
  the hires or lowres tissue PNG; or a `.h5ad` with the scanpy/CELLxGENE
  `uns/spatial/<library>` layout. A dataset manifest loads GEO samples, whose
  files are renamed and gzipped, in place.
- MERSCOPE: Vizgen region folder with `cell_by_gene.csv` and
  `cell_metadata.csv` (each read whole, up to 300 MB), plus
  `cell_boundaries.parquet` for cell outlines, and the run's `.vzg` for the
  image (one stain and z plane at a time). A dataset manifest loads vpt
  re-segmentations and GEO deposits in place. Transcripts are not read.
- Visium HD: Space Ranger `outs/` folder with at least one
  `binned_outputs/square_*um` tier containing positions, scalefactors, and a
  filtered feature-barcode matrix, plus root `feature_slice.h5` for gene
  overlays.
- H5AD: direct `.h5ad` file URL with `obs`, `var`, `/X`, and a supported 2D
  `obsm` coordinate matrix. Files over 64 MiB are read by range; over
  300 MiB on a host without Range support they need a `.h5ad.json` reference
  or `.h5ad.icechunk` repository next to them. An AnnData Zarr store (v2 or
  v3, as `adata.write_zarr` writes it) needs neither, as it is read chunk
  by chunk; its root metadata must say `encoding-type: anndata`.
- SpatialData: Zarr store root (v2 or v3) with consolidated metadata, an AnnData
  table annotating a shapes or labels element, and optionally image elements;
  or the same store zipped as one `.zarr.zip` file.
- Image-only: direct OME-TIFF, TIFF, QPTIFF, SVS (Aperio H&E), NDPI
  (Hamamatsu), or OME-Zarr URL. NDPI files over 4 GB are not read.
- Icechunk: a `.icechunk` repository URL holding AnnData, SpatialData (images,
  labels, and tables), or an OME-Zarr image.

Files do not have to keep these names. A dataset manifest, `explorer.json` in
the dataset folder (or any `.json` URL entered directly), can name the
platform, point to renamed or moved files, and set the genes, layers, and image
channels shown on first load. See [Dataset manifest](docs/dataset-manifest.md).

A dataset collection is a JSON file that lists datasets to browse together,
such as the sections of one study. Open it with `?collection=<url>` in the
viewer's address: a bar under the canvas lists its datasets with previews of
their cells, and choosing one opens it with the same genes and cell
colouring. Sections registered to each other can be shown side by side with
one view. See [Dataset collections](docs/dataset-collections.md).

Because data is read directly by the browser, hosted datasets must support CORS
and HTTP byte-range requests for large binary assets. The in-app
`Diagnose Dataset` action checks the detected platform and the key assets for
the active source.

When the address is a Zarr store (a `.zarr` folder or a group inside one, a
zipped store, or an Icechunk repository), `Browse Store` next to
`Load Dataset` lists its groups and arrays with their shapes, data types,
chunking, codecs and attributes. For a Parquet file, `Browse File` shows
its schema, row groups, metadata and first rows, read from the footer and the
first pages. Neither loads the dataset, so both work for stores and files the
viewer cannot open.

## Examples

[`examples/`](examples/README.md) lists public datasets from data repositories
(BioImage Archive, CELLxGENE, IDR, and others) with links that open them in
the hosted viewer. Each is a dataset manifest pointing at the repository's own
files; add one with `npm run examples` to refresh the list. The viewer's start
screen reads the same list from `main` at runtime, so a new example appears
there without a release.

## Additional Docs And Decisions

The full index is in [docs/README.md](docs/README.md).

- [User guide](docs/user-guide.md): loading supported sources, navigation,
  layers, genes, transcript overlays, annotations, ROI tools, embeddings,
  diagnostics, and shareable URLs.
- [UI reference](docs/ui-reference.md): every panel, control, default, viewer
  interaction, and shareable URL parameter, with platform availability.
- [Architecture](docs/architecture.md): detection order, load pipeline,
  platform gating, coordinates, caching, workers, and error handling.
- Modality read paths: [Xenium](docs/modalities/xenium.md),
  [Atera](docs/modalities/atera.md), [standard Visium](docs/modalities/visium.md),
  [Visium HD](docs/modalities/visium-hd.md), [MERSCOPE](docs/modalities/merscope.md),
  [H5AD](docs/modalities/h5ad.md),
  [SpatialData](docs/modalities/spatialdata.md), and
  [image sources](docs/modalities/image.md). Each lists the files read, the
  libraries used, the source modules involved, and known limitations.
- [Deploy the React app to S3-compatible object storage](docs/deploy-to-s3.md):
  download a release zip or build the Vite app, upload it to AWS S3 or Ceph
  RGW-style storage, configure edge headers, and validate production.
- [Host your own data](docs/host-your-own-data.md): required and optional files
  for Xenium, Atera, standard Visium, Visium HD, MERSCOPE, H5AD, SpatialData, and
  image-only sources, plus HTTP requirements, serving data from your own
  computer, and quick validation commands.
- [Dataset manifest](docs/dataset-manifest.md): the optional `explorer.json`
  that maps renamed files and sets first-load display defaults, with a JSON
  Schema in `public/schemas/`.
- [Dataset collections](docs/dataset-collections.md): a JSON file listing
  datasets to browse together, opened with `?collection=`, with previews and
  registered sections side by side.
- [Image-only and GeoJSON annotations](docs/image-only-and-geojson.md): direct
  image URL support, platform gating, and GeoJSON shape import/export rules.
- [TIFF tile-offset sidecars](docs/zchunkstore.md): the optional
  `.zchunkstore` next to a pyramidal OME-TIFF, and how to generate one.
- [Large H5AD files](docs/h5ad-reference.md): how large H5AD files are read
  by range, and the optional `.h5ad.json` kerchunk reference or
  `.h5ad.icechunk` repository, and how to generate one.
- [S3/CORS hosting playbook](docs/s3-cors-playbook.md): exact CORS headers,
  object serving rules, byte-range validation, and CDN considerations.
- [Cell-feature matrix compatibility](docs/cell-feature-matrix-compatibility.md):
  the key decision to prefer native CSC Zarr for fast ROI gene statistics and
  fall back to HDF5 for older Xenium output, instead of generating custom
  cell-major sidecars.
- [Visium HD 2 µm strategy](docs/visium-hd-2um-strategy.md): why 2 µm first
  paint uses filtered matrix barcodes and a derived affine grid instead of the
  full `tissue_positions.parquet`.
- [Plan](PLAN.md): the build plan, with each phase's status. Phase records,
  architecture decisions, refactor history, and open items are in
  [`docs/plan/`](docs/plan/).

## License

[MIT](LICENSE). Copyright (c) 2026 Genome Research Ltd.
