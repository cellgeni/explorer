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
| `hyparquet` + `hyparquet-compressors` | Parquet reads (the Xenium overview in a worker; Visium HD positions and barcode mappings, SpatialData shapes)        |
| `@duckdb/duckdb-wasm`                 | SQL over remote Parquet (Xenium cells, boundaries, transcripts; Visium HD per-cell mappings)                         |
| `zarrita` + `@zarrita/storage`        | Zarr v2/v3, zipped Zarr, kerchunk references (Xenium matrix and transcripts, H5AD references, SpatialData, OME-Zarr) |
| `icechunk-js`                         | Icechunk repositories as zarrita stores (H5AD companion repositories; AnnData, SpatialData, OME-Zarr in Icechunk)    |
| `h5wasm`                              | HDF5 (H5AD, Xenium H5 matrix, standard Visium matrix, Visium HD matrices and Feature Slice)                          |
| `geotiff`                             | TIFF/OME-TIFF structure and non-JPEG 2000 codecs                                                                     |
| `@cornerstonejs/codec-openjpeg`       | JPEG 2000 tiles                                                                                                      |
| `deck.gl`                             | Cells, bins, boundaries, transcripts, ROI geometry                                                                   |
| `zustand`                             | Dataset URL store                                                                                                    |

## Source Layout

| Directory                               | Contents                                                                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/App.tsx`                           | Orchestration root: wires state, workflows, the section and card models, and the shell around the viewer                                                                                 |
| `src/datasets/`                         | Detection (`datasetFactory.ts`), the `SpatialDataset` interface, and one implementation per platform                                                                                     |
| `src/data/`                             | Platform-neutral readers and models: Parquet, Zarr, HDF5 matrices, transcripts, annotations, embeddings, ROI queries, caches, range probes, diagnostics, shareable state                 |
| `src/features/`                         | Feature modules: panels and blocks (`*.tsx`), workflow hooks (`use*Workflow.ts`), and pure models (`*Model.ts`)                                                                          |
| `src/features/app-shell/`               | Dataset lifecycle, platform adapters, URL hash sync, viewer layer data, app dependencies                                                                                                 |
| `src/features/sections/`                | Section models (`*Model.ts`) and the blocks that render them (`*Blocks.tsx`); see [Section Models](#section-models)                                                                      |
| `src/features/shell/`                   | The shell (15.2): top bar, tools, the shortcut table, layer panel, info drawer, Embedding panel, link panel state, narrow layout                                                         |
| `src/features/cards/`                   | The cards (15.2-D): Selection, Cell, Transcript and Magic Lens, built by `useCardStackModel`                                                                                             |
| `src/features/start/`                   | The start screen (15.3-A): the example gallery read from `examples/index.json` at runtime, recent datasets in `localStorage`, and the lists the dataset menu shares                      |
| `src/components/`                       | `ViewerCore` (deck.gl view and interactions), `MorphologyCanvas`, overlays, status panels, error boundary; interface primitives (buttons, fields, popover, card, drawer, sheet) in `ui/` |
| `src/rendering/`                        | deck.gl layer factories, colour scales, styling, aggregation, boundary viewport rules                                                                                                    |
| `src/tiff/`, `src/codecs/`, `src/zarr/` | Image pyramid loaders and tile codecs                                                                                                                                                    |
| `src/workers/`                          | Tile decode pool, H5 file worker, cells overview worker, Visium HD matrix and Feature Slice workers                                                                                      |
| `src/store/`                            | Zustand store (dataset URL)                                                                                                                                                              |
| `src/styles/`                           | CSS per UI area. `tokens.css` defines the dark theme's colours plus the type, spacing and stacking scales; the other files use only those tokens                                         |
| `tests/e2e/`                            | Playwright tests against hosted reference datasets                                                                                                                                       |

Unit tests sit next to their modules as `*.test.ts(x)` and run with Vitest.
`npm run test:coverage` adds V8 coverage over `src/` with minimum thresholds;
CI runs it on every pull request and uploads the report, but only `npm test`
blocks a merge.

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
| 3     | URL ends in `.tif`, `.tiff`, `.ome.tif(f)`, `.qptif(f)`, `.svs`, `.ndpi`, and `HEAD` succeeds                        | `image`                                                            |
| 4a    | `GET <url>/explorer.json` returns a manifest (run alongside 4b and 4c)                                               | The manifest's `platform`                                          |
| 4b    | `HEAD <url>/experiment.xenium` succeeds                                                                              | `xenium`                                                           |
| 4c    | `HEAD <url>/experiment.spatial` succeeds                                                                             | `atera`                                                            |
| 5     | `HEAD <url>/zarr.json` or `<url>/.zattrs` succeeds                                                                   | `spatialdata` or `image`                                           |
| 6     | `spatial/tissue_positions.csv` (or `…_list.csv`), `spatial/scalefactors_json.json`, `filtered_feature_bc_matrix.h5`  | `visium`                                                           |
| 7     | At least one complete `binned_outputs/square_*um` tier                                                               | `visium-hd`                                                        |
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

| Platform      | Class                                                                             | Doc                                        |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| `xenium`      | `XeniumDataset` (`src/datasets/xeniumDataset.ts`)                                 | [Xenium](./modalities/xenium.md)           |
| `atera`       | `AteraDataset` (`src/datasets/ateraDataset.ts`)                                   | [Atera](./modalities/atera.md)             |
| `visium`      | `AnnDataH5adDataset` from `createVisiumDataset` (`src/datasets/visiumDataset.ts`) | [Standard Visium](./modalities/visium.md)  |
| `visium-hd`   | `VisiumHdDataset` (`src/datasets/visiumHdDataset.ts`)                             | [Visium HD](./modalities/visium-hd.md)     |
| `h5ad`        | `AnnDataH5adDataset` (`src/datasets/h5adDataset.ts`)                              | [H5AD](./modalities/h5ad.md)               |
| `spatialdata` | `SpatialDataDataset` (`src/datasets/spatialDataDataset.ts`)                       | [SpatialData](./modalities/spatialdata.md) |
| `image`       | `ImageOnlyDataset` (`src/datasets/imageOnlyDataset.ts`)                           | [Image sources](./modalities/image.md)     |

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
(`src/features/app-shell/useDatasetLifecycle.ts`) runs detection and then
branches per platform. It resets all per-dataset state when the load
commits:

- With no dataset ready on screen, the load commits at once, before
  detection.
- With one on screen, the open dataset stays, with its requests, until the
  new one is ready (Phase 15.1-F). State the load would set before then (the
  platform, gene panel, annotation sets, manifest defaults, fallback notices)
  is queued. At the "ready" point below it commits: the open dataset's
  `datasetAbortRef` signal is aborted, `loadRequestIdRef` moves on (so other
  workflows drop the old dataset's results), the cleared state is rendered
  once with `flushSync` (so effects keyed on the dataset's status and URL
  rerun even when the same URL reloads, as a Visium library switch does),
  and then the queue and the new data are applied together.
- If it fails first, nothing changes on screen: `pendingDatasetLoadState`
  holds the error, which the Issues card and a toast (`DatasetLoadToast`)
  show. While a load is pending it is `loading`, which the loading list
  shows and which disables `Load Dataset`.

| Platform    | Awaited before "ready"                                                  | Started in the background                               |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Xenium      | `loadDatasetOverview` (`cells.parquet`)                                 | Warmup, gene panel, annotation groups, morphology image |
| Visium HD   | `readBinnedOverview()` + `meta()`                                       | Gene panel, tissue image                                |
| H5AD        | `overview()`, `genePanel()`, `annotationGroups()`, `embeddingOptions()` | —                                                       |
| Visium      | `visiumSummary()`, then the same as H5AD                                | Tissue image                                            |
| SpatialData | Same as H5AD, plus `summary()` for the log                              | Image                                                   |
| Atera       | Same as H5AD                                                            | Morphology image                                        |
| Image       | `meta()`, `image()`, per-channel loaders                                | Auto-contrast                                           |

Each load gets its own `AbortSignal`. A newer load aborts a pending one, and
a committed load's results are dropped once another commits
(`isCurrentDatasetLoad`).

### 4. Feature Gating

`appPlatformAdapterFor` (`src/features/app-shell/platformAdapter.ts`) returns
an `AppPlatformAdapter` for the loaded platform. Until a dataset is ready it
returns the Xenium adapter. The adapter decides:

- `capabilities`: cells (none for a plain image), the Magic Lens,
  annotations, geometric annotations, transcripts, the cell transcript z
  histogram, the transcript gene-only filter, nucleus boundaries, Magic Lens
  Min QV.
- Whether features, boundaries, gene overlays, and Magic Lens can load.
- Whether an ROI can be drawn.
- Point size scaling and "cells" vs "bins" labels.

The `loadPlatform*` functions in the same file route readers by platform:
boundaries, nucleus boundaries, and selected-gene expression go to the dataset
for every platform but Xenium, and transcript capabilities, aggregates, and
viewports go to `AteraDataset` for Atera (see
[Atera](./modalities/atera.md#transcripts)) and to the Xenium readers
otherwise.

The layer panel (`useLayerPanelModel`) shows sections from these
capabilities, and the top bar offers Magic Lens from them. Each loading task
(`createLoadingTasks`) names its `area` (a layer panel section, the info
drawer or a card), which puts the loading dot on the right section. The full matrix is in the
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

## Section Models

The layer panel, info drawer, top bar and Embedding panel take section
models instead of separate props (UNIFIED_PLAN.md, 15.2-A). `App.tsx` builds
seven, one hook each, in `src/features/sections/`:

| Model                     | Hook                         | Holds                                                                                                            |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DatasetInfoModel`        | `useDatasetInfoModel`        | Dataset facts, open a dataset, Share, About, platform view options (Visium HD, Visium, SpatialData), diagnostics |
| `ImageSectionModel`       | `useImageSectionModel`       | Image opacity, z plane, channels, custom image layers                                                            |
| `CellsSectionModel`       | `useCellsSectionModel`       | Cell appearance (boundaries, opacities), the gene selection, and what colours cells                              |
| `TranscriptsSectionModel` | `useTranscriptsSectionModel` | Transcript display, gene filter, colours, filters, point style, budget, hovered and pinned transcript            |
| `AnnotationsSectionModel` | `useAnnotationsSectionModel` | Annotation sets and labels, metadata tracks, saved selections (15.4-A), GeoJSON shapes                           |
| `ViewSettingsModel`       | `useViewSettingsModel`       | Hover tooltips, mouse coordinate units, the measure tool                                                         |
| `EmbeddingModel`          | `useEmbeddingModel`          | The embedding view, Load Embeddings, and the plot's selection links (15.2-G)                                     |

- A model holds values and intent callbacks such as `onOpacityPercentChange`.
  The hook does what the old panel wrappers did: converts percents, normalizes
  inputs, writes the debug log, and resets pending requests.
- Blocks (`*Blocks.tsx`) are small components that each take one model or
  sub-model, such as `GenePicker` (`cells.genes`) or `CustomImageLayers`
  (`image.customLayers`). The layer panel, info drawer and top bar arrange
  them.
- Typing stays local: the gene search, gene set drafts, saved gene sets and the
  transcript feature search live in their blocks, so a keystroke does not
  re-render `App`.
- Blocks make their own label IDs with `useId`.
- `src/test/sectionModels.ts` builds idle models with mock callbacks for block
  and panel tests.
- The cards (15.2-D) follow the same pattern:
  `useCardStackModel` (`src/features/cards/cardModels.ts`) builds a
  `CardStackModel` from the ROI, cell, pinned transcript and Magic Lens state.
  Each card is null while there is nothing to show, and its `onClose` clears
  that state. The selection card has three variants: cells, Visium HD bins,
  and image shapes.
- Saved selections (15.4-A): `useSelectionList`
  (`src/features/roi/useSelectionList.ts`) keeps every drawn box or lasso,
  with a name, colour and visibility, per dataset. It sits above the ROI
  workflows, which still hold one ROI: the active selection's. Drawing adds a
  selection and runs it; choosing one runs it again; closing the Selection
  card clears the ROI but keeps the selection. The list also replays a link's
  `roi=`.

## Coordinates

`src/data/coords.ts` defines branded `Micrometers`, `ImagePixels`, and
`ScreenPixels` types and the `UnitsDescriptor`:

```ts
{ dataUnit: 'micrometer', imageUnit: 'pixel', micrometersPerPixel, origin: 'top-left', imageYAxis: 'down' }
```

Every platform converts into micrometre data coordinates with a top-left
origin:

| Platform    | Data coordinates                        | µm/px source                                                               |
| ----------- | --------------------------------------- | -------------------------------------------------------------------------- |
| Xenium      | Parquet centroids/vertices (already µm) | Morphology OME-XML `PhysicalSizeX`                                         |
| Visium      | Full-res pixels × µm/px                 | Spot-grid fit (100 µm pitch), else spot spacing or `spot_diameter_fullres` |
| Visium HD   | Full-res pixels × `microns_per_pixel`   | `scalefactors_json.json`                                                   |
| H5AD        | `obsm` values used as µm                | 1 (Visium `.h5ad` files: as Visium)                                        |
| SpatialData | Coordinate-system units used as µm      | Image affine × level-0 scale, else 1                                       |
| Image       | Pixels × µm/px                          | OME-XML / OME-Zarr scale (default 0.2125 TIFF, 1 Zarr)                     |

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
  `src/zarr/zarrStores.ts`), Icechunk repository files
  (`src/zarr/icechunkStore.ts`), and `.zchunkstore` sidecars. Other `403`s are
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

A load that several callers wait on (range probes, whole-file H5 matrices,
Visium HD's `feature_slice.h5`) is a `sharedLoad`
(`src/utils/sharedLoad.ts`). It runs under its own signal, aborted only when
every caller waiting on it has aborted, and each caller stops waiting at its
own signal. Before 15.5-E the first caller's signal ran the load, so its
cancel failed the others with an `AbortError` they took for their own, and
their cards stayed on "Loading".

## Workers

| Worker                           | Created by                       | Purpose                                                                                        |
| -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `tileDecode.worker.ts`           | `TileDecodeWorkerPool` (≤ 4)     | Decode TIFF tiles into `ImageBitmap`s                                                          |
| DuckDB-WASM worker               | `src/data/duckdb.ts`             | One per DuckDB client                                                                          |
| `featureBarcodeMatrix.worker.ts` | `src/data/gex.ts`                | Visium HD filtered matrix reads (per request)                                                  |
| `visiumFeatureSlice.worker.ts`   | `src/data/visiumFeatureSlice.ts` | Visium HD Feature Slice reads (per request)                                                    |
| `zarrDecode.worker.ts`           | `ZarrDecodePool` (≤ 3)           | Decode OME-Zarr image chunks into `ImageBitmap`s; trace SpatialData label chunks into outlines |
| `h5File.worker.ts`               | `src/data/h5WorkerFile.ts`       | One whole downloaded HDF5 file each: H5AD, the Xenium H5 fallback, the standard Visium matrix  |
| `cellsOverview.worker.ts`        | `readCellsOverviewInWorker`      | The Xenium `cells.parquet` overview: fetch and decode its columns (one per read)               |

An H5 file worker gets the downloaded bytes by transfer (H5AD, standard
Visium) or fetches the file itself (the Xenium H5 fallback), writes them into
its own h5wasm file system, and answers reads by path; the Xenium H5
fallback's cell rows are read inside it. An H5AD file's worker stays open for reads after
load (embeddings, tissue images) and ends when the dataset is garbage
collected; the Xenium matrix's stays open for the session, as the file did on
the main thread; the standard Visium matrix's ends once it is read. Where
there is no `Worker` (Vitest's jsdom), the same handler runs on the main
thread.

A cells overview worker fetches `cells.parquet` and decodes the overview
columns from hyparquet's column chunks, without an object per row. The columns
come back as transferred typed arrays, with cell IDs and the distinct
segmentation methods as strings, and the main thread builds the overview cells
from them. The worker ends once it has answered, or when the load is aborted.
With an option a worker cannot take (a custom fetcher, an in-memory file, a
test reader) or no `Worker`, the same reader runs on the main thread.

Other hyparquet reads, zarrita reads (Xenium matrix, H5AD references,
SpatialData tables), and auto-contrast run on the main thread. OME-Zarr chunk bytes are fetched on the main thread and decoded in the
Zarr decode workers, which fall back to the main thread if they fail.

## Performance Budget

`detectPerformanceBudget` (`src/data/performanceBudget.ts`) picks a profile
from `navigator.hardwareConcurrency` and `navigator.deviceMemory`:

| Profile    | When                  | Overview cells | Boundary limit | Tile requests | Tile cache | Telemetry events |
| ---------- | --------------------- | -------------- | -------------- | ------------- | ---------- | ---------------- |
| `compact`  | ≤ 4 cores or ≤ 4 GB   | 75,000         | 2,500          | 2             | 72         | 80               |
| `balanced` | Otherwise             | 150,000        | 50,000         | 4             | 120        | 120              |
| `expanded` | ≥ 8 cores and ≥ 12 GB | 250,000        | 50,000         | 6             | 180        | 160              |

Diagnostics in the info drawer shows the active profile with debug info on.

## Errors, Notices, Diagnostics, Telemetry

- **Structured errors.** `createStructuredLoadError`
  (`src/features/errors/loadErrorModel.ts`) classifies failures (range
  blocked, CORS, HTTP status, unsupported layout, …) for the info drawer's
  load issues, ⓘ's issue badge and viewport messages.
- **Fallback notices.** `notifyFallback` (`src/data/fallbackNotice.ts`) reports
  when a slower or partial path is used (for example the H5 matrix or
  cell-summary transcript density). Shown under "Data access notes" in the
  info drawer's Diagnostics.
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
