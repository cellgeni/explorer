# Architecture

How a URL typed into the viewer becomes pixels on screen, and the shared
infrastructure every modality uses. Per-modality details live in
[`docs/modalities/`](./modalities/); the UI is described in the
[UI reference](./ui-reference.md).

## Overview

The viewer is a static Vite + React app with no data server. The browser
fetches dataset files directly from object storage using `HEAD` probes,
whole-file `GET`s for small files, and HTTP byte-range `GET`s for large binary
files. Parsing happens in the browser:

| Library                               | Used for                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `hyparquet` + `hyparquet-compressors` | Parquet reads on the main thread (Xenium overview, Visium HD positions and barcode mappings, SpatialData shapes)     |
| `@duckdb/duckdb-wasm`                 | SQL over remote Parquet (Xenium cells, boundaries, transcripts; Visium HD per-cell mappings)                         |
| `zarrita` + `@zarrita/storage`        | Zarr v2/v3, zipped Zarr, kerchunk references (Xenium matrix and transcripts, H5AD references, SpatialData, OME-Zarr) |
| `h5wasm`                              | HDF5 (H5AD, Xenium H5 matrix, Visium HD matrices and Feature Slice)                                                  |
| `geotiff`                             | TIFF/OME-TIFF structure and non-JPEG 2000 codecs                                                                     |
| `@cornerstonejs/codec-openjpeg`       | JPEG 2000 tiles                                                                                                      |
| `deck.gl`                             | Cells, bins, boundaries, transcripts, ROI geometry                                                                   |
| `zustand`                             | Dataset URL store                                                                                                    |

## Source Layout

| Directory                               | Contents                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/App.tsx`                           | Orchestration root: wires state, workflows, HUD panels, and the viewer                                                                                                   |
| `src/datasets/`                         | Detection (`datasetFactory.ts`), the `SpatialDataset` interface, and one implementation per platform                                                                     |
| `src/data/`                             | Platform-neutral readers and models: Parquet, Zarr, HDF5 matrices, transcripts, annotations, embeddings, ROI queries, caches, range probes, diagnostics, shareable state |
| `src/features/`                         | Feature modules: HUD panels (`*.tsx`), workflow hooks (`use*Workflow.ts`), and pure models (`*Model.ts`)                                                                 |
| `src/features/app-shell/`               | Dataset lifecycle, platform adapters, URL hash sync, viewer layer data, app dependencies                                                                                 |
| `src/components/`                       | `ViewerCore` (deck.gl view and interactions), `MorphologyCanvas`, overlays, status panels, error boundary                                                                |
| `src/rendering/`                        | deck.gl layer factories, colour scales, styling, aggregation, boundary viewport rules                                                                                    |
| `src/tiff/`, `src/codecs/`, `src/zarr/` | Image pyramid loaders and tile codecs                                                                                                                                    |
| `src/workers/`                          | Tile decode pool, Visium HD matrix and Feature Slice workers                                                                                                             |
| `src/store/`                            | Zustand store (dataset URL)                                                                                                                                              |
| `src/styles/`                           | CSS per UI area                                                                                                                                                          |
| `tests/e2e/`                            | Playwright tests against hosted reference datasets                                                                                                                       |

Unit tests sit next to their modules as `*.test.ts(x)` and run with Vitest.

## Load Pipeline

```text
Dataset URL
  │  detectSpatialDataset          src/datasets/datasetFactory.ts
  ▼
SpatialDatasetDetection { platform, urls, probes }
  │  cachedSpatialDataset → createSpatialDataset (lazy import per platform)
  ▼
SpatialDataset implementation    src/datasets/*Dataset.ts
  │  useDatasetLifecycle: platform-specific first paint
  ▼
React state (overview cells / grid bins, gene panel, annotation sets, image)
  │  appPlatformAdapterFor → feature gating
  │  workflow hooks (genes, transcripts, boundaries, ROI, Magic Lens, …)
  ▼
useViewerLayerData → ViewerCore (deck.gl) + MorphologyCanvas (2D canvas)
```

### 1. Detection

`detectSpatialDataset` tries platforms in this order and returns the first
match:

| Order | Test                                                                                                                 | Platform                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0     | URL path ends in `.json` (not `zarr.json`): read it as a [dataset manifest](./dataset-manifest.md); errors stop here | The manifest's `platform`                                          |
| 1     | URL ends in `.h5ad`, and `HEAD` succeeds                                                                             | `h5ad`                                                             |
| 2     | URL path ends in `.zarr`, `.ome.zarr`, `/zarr.json`, `/.zattrs`; root metadata `HEAD` succeeds                       | `spatialdata` if root attrs have `spatialdata_attrs`, else `image` |
| 3     | URL ends in `.tif`, `.tiff`, `.ome.tif(f)`, `.qptif(f)`, `.ndpi`, and `HEAD` succeeds                                | `image`                                                            |
| 4a    | `GET <url>/explorer.json` returns a manifest (run alongside 4b and 4c)                                               | The manifest's `platform`                                          |
| 4b    | `HEAD <url>/experiment.xenium` succeeds                                                                              | `xenium`                                                           |
| 4c    | `HEAD <url>/experiment.spatial` succeeds                                                                             | `atera`                                                            |
| 5     | `HEAD <url>/zarr.json` or `<url>/.zattrs` succeeds                                                                   | `spatialdata` or `image`                                           |
| 6     | At least one complete `binned_outputs/square_*um` tier                                                               | `visium-hd`                                                        |
| —     | Nothing matched                                                                                                      | `unknown` → "Unsupported spatial dataset layout."                  |

Every probe has a 15 s timeout. A host that rejects `HEAD` breaks detection.

Before step 4, detection reads the folder's index page (`GET <url>/`, 5 s
timeout); for a dataset manifest it also reads the index page of the manifest's
root folder. When the host serves an Apache, nginx, or Python `http.server` index page
(`readFolderListing`, `src/data/folderListing.ts`), the listing is registered
for that folder, and detection probes and readers skip files it does not list.
Dotfiles (`.zattrs`, `.zchunkstore`) are still requested unless the page lists
some dotfile, because index pages usually hide them. Hosts with no index page
are probed as before. This matters on hosts such as `ftp.ebi.ac.uk` (the
BioImage Archive) that send CORS headers only on successful responses: there a
missing file fails as a network error, so the listing is the only way to know
it is missing.

Detection registers the manifest it found (or clears an earlier one) for the
entered URL in `src/data/datasetFiles.ts`. Readers keep receiving the entered
URL and ask for files by role with `datasetFileUrlFor(baseUrl, role)`, which
returns the manifest's location or the standard name. See
[Dataset manifest](./dataset-manifest.md#how-it-works).

### 2. Dataset Construction

`createSpatialDataset` lazy-imports one implementation per platform so each
platform's code is a separate chunk:

| Platform      | Class                                                       | Doc                                        |
| ------------- | ----------------------------------------------------------- | ------------------------------------------ |
| `xenium`      | `XeniumDataset` (`src/datasets/xeniumDataset.ts`)           | [Xenium](./modalities/xenium.md)           |
| `atera`       | `AteraDataset` (`src/datasets/ateraDataset.ts`)             | [Atera](./modalities/atera.md)             |
| `visium-hd`   | `VisiumHdDataset` (`src/datasets/visiumHdDataset.ts`)       | [Visium HD](./modalities/visium-hd.md)     |
| `h5ad`        | `AnnDataH5adDataset` (`src/datasets/h5adDataset.ts`)        | [H5AD](./modalities/h5ad.md)               |
| `spatialdata` | `SpatialDataDataset` (`src/datasets/spatialDataDataset.ts`) | [SpatialData](./modalities/spatialdata.md) |
| `image`       | `ImageOnlyDataset` (`src/datasets/imageOnlyDataset.ts`)     | [Image sources](./modalities/image.md)     |

`cachedSpatialDataset` memoizes the instance per URL and drops failed
instances so a retry starts fresh.

All implementations satisfy `SpatialDataset` (`src/datasets/spatialDataset.ts`):

| Method                 | Purpose                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `meta()`               | Platform, `UnitsDescriptor`, extent, capability flags, channels, grids, segmentations |
| `elements(bbox)`       | Spatial elements (polygons, circles, grid cells) in a bounding box                    |
| `matrix(ids)`          | All-gene expression for element IDs                                                   |
| `annotations(options)` | Annotation sets                                                                       |
| `image()`              | `pyramid` loader or `flat` image, or `null`                                           |
| `transcripts?(…)`      | Optional molecule-level reads                                                         |

Platforms add their own methods on top, such as `overview()`,
`genePanel()`, `geneExpression()`, and `readBinnedOverview()`.

### 3. First Paint

`startDatasetLoad` in `useDatasetLifecycle`
(`src/features/app-shell/useDatasetLifecycle.ts`) resets all per-dataset
state, runs detection, and then branches per platform:

| Platform    | Awaited before "ready"                                                  | Started in the background                               |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Xenium      | `loadDatasetOverview` (`cells.parquet`)                                 | Warmup, gene panel, annotation groups, morphology image |
| Visium HD   | `readBinnedOverview()` + `meta()`                                       | Gene panel, tissue image                                |
| H5AD        | `overview()`, `genePanel()`, `annotationGroups()`, `embeddingOptions()` | —                                                       |
| SpatialData | Same as H5AD, plus `summary()` for the log                              | Image                                                   |
| Atera       | Same as H5AD                                                            | Morphology image                                        |
| Image       | `meta()`, `image()`, per-channel loaders                                | Auto-contrast                                           |

Each load gets a request ID and `AbortSignal`; results from a superseded load
are dropped (`isCurrentDatasetLoad`).

### 4. Feature Gating

`appPlatformAdapterFor` (`src/features/app-shell/platformAdapter.ts`) returns
an `AppPlatformAdapter` for the loaded platform. Until a dataset is ready it
returns the Xenium adapter. The adapter decides:

- `capabilities`: annotations, geometric annotations, transcripts, the cell
  transcript z histogram, the transcript gene-only filter, nucleus
  boundaries, Magic Lens Min QV.
- Whether features, boundaries, gene overlays, and Magic Lens can load.
- Whether an ROI can be drawn.
- Point size scaling and "cells" vs "bins" labels.

The `loadPlatform*` functions in the same file route readers by platform:
boundaries, nucleus boundaries, and selected-gene expression go to the dataset
for every platform but Xenium, and transcript capabilities, aggregates, and
viewports go to `AteraDataset` for Atera (see
[Atera](./modalities/atera.md#transcripts)) and to the Xenium readers
otherwise.

`App.tsx` also hides HUD tabs per platform. The full matrix is in the
[UI reference](./ui-reference.md#platform-availability).

### 5. Workflows

Each feature is a hook in `src/features/<area>/use*Workflow.ts` that owns a
request lifecycle (debounce, abort, latest-request check) and calls readers in
`src/data/` or methods on the dataset. Long-running requests use
`startLatestRequest` / `invalidateLatestRequest`
(`src/features/app-shell/appRuntimeModel.ts`) so only the newest request can
update state.

Readers are injected through `src/features/app-shell/appDependencies.ts`, which
lets tests replace them.

### 6. Rendering

- `useViewerLayerData` (`src/features/app-shell/useViewerLayerData.ts`) turns
  state into layer inputs: overview points, grid cells, boundaries, transcripts,
  ROI, annotations, and image channels.
- `ViewerCore` (`src/components/ViewerCore.tsx`) owns the deck.gl
  `OrthographicView`, picking, hover tooltips, keyboard navigation, ROI
  drawing, measurement, and the Magic Lens overlay. Layer factories are in
  `src/rendering/deckLayers.ts`.
- `MorphologyCanvas` draws image tiles on a 2D canvas underneath deck.gl.

## Coordinates

`src/data/coords.ts` defines branded `Micrometers`, `ImagePixels`, and
`ScreenPixels` types and the `UnitsDescriptor`:

```ts
{ dataUnit: 'micrometer', imageUnit: 'pixel', micrometersPerPixel, origin: 'top-left', imageYAxis: 'down' }
```

Every platform converts into micrometre data coordinates with a top-left
origin:

| Platform    | Data coordinates                        | µm/px source                                           |
| ----------- | --------------------------------------- | ------------------------------------------------------ |
| Xenium      | Parquet centroids/vertices (already µm) | Morphology OME-XML `PhysicalSizeX`                     |
| Visium HD   | Full-res pixels × `microns_per_pixel`   | `scalefactors_json.json`                               |
| H5AD        | `obsm` values used as µm                | 1                                                      |
| SpatialData | Coordinate-system units used as µm      | Image affine × level-0 scale, else 1                   |
| Image       | Pixels × µm/px                          | OME-XML / OME-Zarr scale (default 0.2125 TIFF, 1 Zarr) |

All screen↔data conversions go through `coords.ts`.

## HTTP Requirements In Code

- **Range probe.** `assertHttpRangeSupport` (`src/data/rangeSupport.ts`) sends
  `GET` with `Range: bytes=0-0` before large reads and requires `206`.
  `Content-Range` is not required, because hosts that leave it out of
  `Access-Control-Expose-Headers` hide it from the browser; readers take file
  sizes from `Content-Length`. Results are cached per URL. Failures produce
  "cannot be range-read" errors with the URL. A `404` or `403` is reported as
  a missing or unreadable file ("File not found or not readable") and a `5xx`
  as a server error ("Host server error"), not as blocked Range requests.
- **Missing files on hosts that hide errors.** A file the registered folder
  listing does not include fails the Range probe without a request
  (`FileNotListedError`, "File not found"). Without a listing, a request that
  fails with no response on an origin that has answered other requests, but
  never with a readable error status, is reported as `LikelyMissingFileError`
  ("File most likely missing", `src/data/hostResponses.ts`) by the Range probe
  and the morphology image loader, instead of as blocked Range requests or a
  network failure.
- **403 as missing.** Object stores that return `403` for missing keys are
  handled for Zarr metadata keys (`createZarrFetchStore`,
  `src/zarr/zarrStores.ts`) and `.zchunkstore` sidecars. Other `403`s are
  errors.

See [S3/CORS hosting playbook](./s3-cors-playbook.md) for server setup.

## Caching

| Cache                                                  | Scope                                                                                                                        | Limits                                        | File                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| IndexedDB byte-range cache `cellgeni-byte-range-cache` | Parquet footers (`parquet-footer`), Xenium matrix zip ranges (`zarr-zip`), TIFF tiles (`tiff-tile`); persists across reloads | 256 MiB, 20,000 entries, 8 MiB per entry, LRU | `src/data/persistentByteRangeCache.ts`       |
| Dataset instances                                      | Per URL                                                                                                                      | Dropped on failure                            | `datasetFactory.ts`, `xeniumDatasetCache.ts` |
| Dataset manifests                                      | Per entered URL                                                                                                              | Replaced by each detection of that URL        | `src/data/datasetFiles.ts`                   |
| Range-probe results                                    | Per URL + label                                                                                                              | Dropped on failure                            | `rangeSupport.ts`                            |
| Folder listings                                        | Per folder URL                                                                                                               | Replaced by each detection of that folder     | `src/data/folderListing.ts`                  |
| Matrix metadata and indices                            | Per matrix URL                                                                                                               | Cleared when a new Xenium dataset warms up    | `src/data/gex.ts`                            |
| SpatialData chunk cache                                | Per store                                                                                                                    | 256 MiB LRU                                   | `src/zarr/zarrStores.ts`                     |
| Decoded tile bitmaps                                   | Per image channel                                                                                                            | Performance budget                            | `src/tiff/tileCache.ts`                      |
| Visium HD overviews, segmentations                     | Per dataset                                                                                                                  | No eviction                                   | `visiumHdDatasetReaders.ts`                  |

The byte-range cache keys do not include an ETag, so replacing a file in place
at the same URL can serve stale bytes until site data is cleared.

## Workers

| Worker                           | Created by                       | Purpose                                                                                        |
| -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `tileDecode.worker.ts`           | `TileDecodeWorkerPool` (≤ 4)     | Decode TIFF tiles into `ImageBitmap`s                                                          |
| DuckDB-WASM worker               | `src/data/duckdb.ts`             | One per DuckDB client                                                                          |
| `featureBarcodeMatrix.worker.ts` | `src/data/gex.ts`                | Visium HD filtered matrix reads (per request)                                                  |
| `visiumFeatureSlice.worker.ts`   | `src/data/visiumFeatureSlice.ts` | Visium HD Feature Slice reads (per request)                                                    |
| `zarrDecode.worker.ts`           | `ZarrDecodePool` (≤ 3)           | Decode OME-Zarr image chunks into `ImageBitmap`s; trace SpatialData label chunks into outlines |

hyparquet, zarrita reads (Xenium matrix, H5AD references, SpatialData tables),
h5wasm for H5AD and the Xenium H5 fallback, and auto-contrast run on the main
thread. OME-Zarr chunk bytes are fetched on the main thread and decoded in the
Zarr decode workers, which fall back to the main thread if they fail.

## Performance Budget

`detectPerformanceBudget` (`src/data/performanceBudget.ts`) picks a profile
from `navigator.hardwareConcurrency` and `navigator.deviceMemory`:

| Profile    | When                  | Overview cells | Boundary limit | Tile requests | Tile cache | Telemetry events |
| ---------- | --------------------- | -------------- | -------------- | ------------- | ---------- | ---------------- |
| `compact`  | ≤ 4 cores or ≤ 4 GB   | 75,000         | 2,500          | 2             | 72         | 80               |
| `balanced` | Otherwise             | 150,000        | 50,000         | 4             | 120        | 120              |
| `expanded` | ≥ 8 cores and ≥ 12 GB | 250,000        | 50,000         | 6             | 180        | 160              |

The Layers tab header shows the active profile.

## Errors, Notices, Diagnostics, Telemetry

- **Structured errors.** `createStructuredLoadError`
  (`src/features/errors/loadErrorModel.ts`) classifies failures (range
  blocked, CORS, HTTP status, unsupported layout, …) for the Dataset tab's
  Issues list and viewport messages.
- **Fallback notices.** `notifyFallback` (`src/data/fallbackNotice.ts`) reports
  when a slower or partial path is used (for example the H5 matrix or
  cell-summary transcript density). Shown under Fallbacks in the Dataset tab.
- **Diagnostics.** `runDatasetDiagnostics` (`src/data/datasetDiagnostics.ts`)
  checks the files each platform needs. `Download diagnostics` writes a JSON
  dump built by `src/features/diagnostics/diagnosticsDump.ts`.
- **Telemetry.** `telemetryEvent` (`src/data/telemetry.ts`) records events in
  memory only; they appear in the diagnostics dump and are never sent anywhere.

## Shareable State

`src/data/shareableState.ts` serializes the dataset URL, view, selected genes,
ROI, and most control values into the URL hash;
`useShareableUrlHash` (`src/features/app-shell/useShareableUrlHash.ts`) keeps
it in sync. The field list is in the
[UI reference](./ui-reference.md#shareable-url).

## Build

- `vite.config.ts` splits vendor chunks (`react-vendor`, `deck-vendor`,
  `duckdb-vendor`, `spatial-io-vendor`, `codec-vendor`) and serves
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` in dev and preview. The app does not
  depend on cross-origin isolation: nothing uses `SharedArrayBuffer`, and
  DuckDB-WASM uses its non-threaded bundles. See
  [Deploy to S3](./deploy-to-s3.md#recommended-shape) for production headers.
- `npm run build` runs `tsc -b` then `vite build` into `dist/`. See
  [Deploy to S3](./deploy-to-s3.md).
