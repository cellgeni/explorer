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
| `hyparquet` + `hyparquet-compressors` | Parquet reads (the Xenium overview and SpatialData shapes in workers; Visium HD positions and barcode mappings)      |
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
| `src/main.tsx`                          | Entry point: installs the worker Zarr codecs and renders `App` inside `AppErrorBoundary`                                                                                                 |
| `src/App.tsx`                           | Orchestration root: wires state, workflows, the section and card models, and the shell around the viewer                                                                                 |
| `src/datasets/`                         | Detection (`datasetFactory.ts`), the `SpatialDataset` interface, and one implementation per platform                                                                                     |
| `src/data/`                             | Platform-neutral readers and models: Parquet, Zarr, HDF5 matrices, transcripts, annotations, embeddings, ROI queries, caches, range probes, diagnostics, shareable state                 |
| `src/features/`                         | Feature modules: panels and blocks (`*.tsx`), workflow hooks (`use*Workflow.ts`), and pure models (`*Model.ts`)                                                                          |
| `src/features/app-shell/`               | Dataset lifecycle, platform adapters, URL hash sync, viewer layer data, app dependencies                                                                                                 |
| `src/features/sections/`                | Section models (`*Model.ts`) and the blocks that render them (`*Blocks.tsx`); see [Section Models](#section-models)                                                                      |
| `src/features/shell/`                   | The shell (15.2): top bar, tools, the shortcut table, layer panel, info drawer, the Embedding, Plots and Cell Query windows, link panel state, narrow layout                             |
| `src/features/plots/`                   | The Plots panel (plan 22): what it groups, the stats store and its worker session, the dot plot, violin and heatmap models, their SVGs and the heatmap canvas, exports                   |
| `src/features/query/`                   | The Cell Query panel (plan 23): the columns it offers, the query store and its worker session, the conditions editor, the paged table, `query=`                                          |
| `src/features/cards/`                   | The cards (15.2-D): Selection, Cell, Transcript and Magic Lens, built by `useCardStackModel`                                                                                             |
| `src/features/start/`                   | The start screen (15.3-A): the example gallery read from `examples/index.json` at runtime, recent datasets in `localStorage`, and the lists the dataset menu shares                      |
| `src/features/collection/`              | [Dataset collections](./dataset-collections.md) (`collection=`): the collection bar and its previews, and registered sections shown side by side in panels sharing one camera            |
| `src/features/store-structure/`         | The Store structure drawer that `Browse Store` and `Browse File` open: a Zarr store's groups and arrays, or a Parquet file's schema, row groups and first rows                           |
| `src/components/`                       | `ViewerCore` (deck.gl view and interactions), `MorphologyCanvas`, overlays, status panels, error boundary; interface primitives (buttons, fields, popover, card, drawer, sheet) in `ui/` |
| `src/rendering/`                        | deck.gl layer factories, colour scales, styling, aggregation, boundary viewport rules                                                                                                    |
| `src/tiff/`, `src/codecs/`, `src/zarr/` | Image pyramid loaders and tile codecs; Zarr stores (HTTP, zipped, Icechunk), `Browse Store`'s reader (`zarrStructure.ts`) and its folder lister (`zarrFolderLister.ts`)                  |
| `src/workers/`                          | Worker entry points (`*.worker.ts`) with their handlers (`*Core.ts`) and messages, the decode pools, and the H5 range-read file; see [Workers](#workers)                                 |
| `src/utils/`                            | Small shared helpers: `sharedLoad`, `abortable`, `createAsyncLimiter`, `mapWithConcurrency`, `slug`                                                                                      |
| `src/store/`                            | Zustand store (dataset URL)                                                                                                                                                              |
| `src/styles/`                           | CSS per UI area, imported by `src/index.css`. `tokens.css` defines the dark theme's colours plus the type, spacing and stacking scales; the other files use only those tokens            |
| `src/test/`                             | Vitest setup, the App test harness, idle section models, and fixture builders; fixture files and the scripts that write them in `fixtures/`                                              |
| `src/types/`                            | Type declarations for modules that ship none (`@cornerstonejs/codec-openjpeg`, hyparquet's `encoding.js`)                                                                                |
| `tests/config/`                         | Vitest tests of `vite.config.ts`                                                                                                                                                         |
| `tests/e2e/`                            | Playwright tests: `@smoke` tests run offline on fixtures; `@live` tests load hosted datasets and every example in `examples/`                                                            |

Unit tests sit next to their modules as `*.test.ts(x)` and run with Vitest.
On every pull request, CI (`.github/workflows/ci.yml`) runs Prettier, ESLint,
the typecheck, `npm test` and the build, and in a job of their own the
`@smoke` E2E tests, which answer data requests from fixtures with `page.route`
and need no network. `npm run test:coverage` adds V8 coverage over `src/` with
minimum thresholds; CI runs it too and uploads the report, in a job that is
allowed to fail. The full Playwright suite, which adds the `@live` tests on
hosted datasets and every example in `examples/`, runs on a weekday schedule
(`.github/workflows/e2e-live.yml`). `npm audit` runs on every pull request,
on pushes to `main` and each weekday morning (`.github/workflows/audit.yml`):
any advisory in a package the app ships fails it, and in the dev tools only
critical ones do (high ones too once `picomatch` has a fix for
GHSA-fc5q-39xc-vjpf). It is a workflow of its own so that a newly published
advisory cannot hold up the Pages deploy, which waits for CI.

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

| Order | Test                                                                                                                                    | Platform                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0     | URL path ends in `.json` (not `zarr.json`): read it as a [dataset manifest](./dataset-manifest.md); errors stop here                    | The manifest's `platform`                                          |
| 1     | URL ends in `.h5ad`, and `HEAD` succeeds                                                                                                | `h5ad`                                                             |
| 1b    | URL path ends in `.icechunk`: open the repository and read its root group; errors stop here                                             | `h5ad` (AnnData), `spatialdata`, or `image`                        |
| 1c    | URL path ends in `.zip`, and `HEAD` succeeds; a zipped store that is neither SpatialData nor an OME-Zarr image is an error              | `spatialdata` or `image`                                           |
| 2     | URL path ends in `.zarr`, `.ome.zarr`, `/zarr.json`, `/.zattrs`, or names a group inside a `.zarr` store; root metadata `HEAD` succeeds | `spatialdata` or `h5ad` (AnnData) by root attributes, else `image` |
| 3     | URL ends in `.tif`, `.tiff`, `.ome.tif(f)`, `.qptif(f)`, `.svs`, `.ndpi`, and `HEAD` succeeds                                           | `image`                                                            |
| 4a    | `GET <url>/explorer.json` returns a manifest (run alongside 4b and 4c)                                                                  | The manifest's `platform`                                          |
| 4b    | `HEAD <url>/experiment.xenium` succeeds                                                                                                 | `xenium`                                                           |
| 4c    | `HEAD <url>/experiment.spatial` succeeds                                                                                                | `atera`                                                            |
| 5     | `HEAD <url>/zarr.json` or `<url>/.zattrs` succeeds                                                                                      | `spatialdata`, `h5ad`, or `image`, as in 2                         |
| 6     | `spatial/tissue_positions.csv` (or `…_list.csv`), `spatial/scalefactors_json.json`, `filtered_feature_bc_matrix.h5`                     | `visium`                                                           |
| 6b    | `cell_by_gene.csv` and `cell_metadata.csv` (probed alongside 6, with `cell_boundaries.parquet`)                                         | `merscope`                                                         |
| 7     | At least one complete `binned_outputs/square_*um` tier                                                                                  | `visium-hd`                                                        |
| —     | Nothing matched                                                                                                                         | `unknown` → "Unsupported spatial dataset layout."                  |

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
| `merscope`    | `MerscopeDataset` (`src/datasets/merscopeDataset.ts`)                             | [MERSCOPE](./modalities/merscope.md)       |
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
| MERSCOPE    | Same as H5AD (both cell tables read in a worker), then `summary()`      | `.vzg` image, one stain and plane                       |
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
  histogram, the transcript gene-only filter, and nucleus boundaries.
- Whether features, gene overlays, and Magic Lens can load, and whether cell
  outlines are read (only while `Cell boundaries` is on). Nucleus outlines
  are a separate request, made while `Nucleus boundaries` is on where the
  platform has them (`useViewportDataWorkflow.ts`).
- Whether an ROI can be drawn.
- Point size scaling and "cells" vs "bins" labels.

The `loadPlatform*` functions in the same file route readers by platform:
boundaries and selected-gene expression go to the dataset for every platform
but Xenium, nucleus boundaries go to the dataset's `segmentationElements` on
Xenium, Atera, Visium HD, and SpatialData, and transcript capabilities, aggregates, and
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

## Default Colours

Colours used when the data gives none. Most canvas defaults are in
`src/rendering/deckLayerColors.ts`; a few are written where they are used.

| What                                                                                                                                                           | Where                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outline and fill of cells with no colour, default cell point fill, gene and transcript-density colour scales, alpha range of outlines drawn in a cell's colour | `src/rendering/deckLayerColors.ts`: `DEFAULT_CELL_BOUNDARY_LINE_COLOR`, `DEFAULT_CELL_BOUNDARY_FILL_COLOR`, `DEFAULT_OVERVIEW_CELL_FILL_RGB`, `GENE_EXPRESSION_COLOR_STOPS`, `TRANSCRIPT_DENSITY_COLOR_STOPS`, `boundaryLineColor` |
| Nucleus outline and fill                                                                                                                                       | `src/features/app-shell/useViewerLayerData.ts`, written in the nucleus `boundaryElementsToLayerData` call                                                                                                                          |
| Cell point outline alpha                                                                                                                                       | `src/rendering/cellPointStyle.ts`: `DEFAULT_OUTLINE_ALPHA`                                                                                                                                                                         |
| Annotation class palette                                                                                                                                       | `src/rendering/annotationPalette.ts`: `ANNOTATION_DEFAULT_PALETTE`, `FALLBACK_ANNOTATION_COLOR`                                                                                                                                    |
| Transcript colours per gene                                                                                                                                    | `src/rendering/transcriptColors.ts`: `TRANSCRIPT_FEATURE_PALETTE`                                                                                                                                                                  |
| Transcript point outline                                                                                                                                       | `src/rendering/transcriptRenderer.ts`, written in `getLineColor`                                                                                                                                                                   |
| Image channel colours                                                                                                                                          | `src/data/imagePyramid.ts`: `DEFAULT_CHANNEL_COLORS`, used by the OME-Zarr and OME-TIFF loaders. `defaultChannelColor` in `src/tiff/omeMetadata.ts` picks some by channel name                                                     |
| Interface colours: the accent, and selections, measurements and the lens over the canvas                                                                       | `src/styles/tokens.css`: `--accent`, `--overlay-selection`                                                                                                                                                                         |

## Section Models

The layer panel, info drawer, top bar and Embedding panel take section
models instead of separate props
([plan 15.2-A](plan/phases/15-interface-redesign.md#152-shell-re-layout)).
`App.tsx` builds seven, one hook each, in `src/features/sections/`:

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
- **Plain-http data from an HTTPS page.** A read that gets no response
  (detection's "Request blocked", a network error, or a Range probe without a
  response) from an HTTPS page to an `http://` address gets advice for that
  case instead of the CORS advice (`src/features/errors/insecureRequest.ts`).
  The advice depends on whether the address is on this computer, on the local
  network, or elsewhere. See
  [Serve data from your computer](./host-your-own-data.md#serve-data-from-your-computer).
- **DuckDB extensions.** DuckDB-WASM downloads its extensions from
  `extensions.duckdb.org` (`src/data/duckdb.ts`): `httpfs` and `parquet` when
  a client starts, and `spatial` on the first lasso. They are not in
  `package-lock.json`; the URL carries DuckDB's version, and unsigned
  extensions are refused. A `parquet` or `spatial` load that fails throws
  `DuckDbExtensionLoadError` ("DuckDB extension did not load"), and the next
  lasso loads `spatial` again. Without `httpfs`, reads go through DuckDB-WASM's
  own HTTP file system, which is slower, and a console warning says so.

See [S3/CORS hosting playbook](./s3-cors-playbook.md) for server setup.

## Caching

| Cache                                                  | Scope                                                                                                                        | Limits                                        | File                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| IndexedDB byte-range cache `cellgeni-byte-range-cache` | Parquet footers (`parquet-footer`), zipped Zarr store ranges (`zarr-zip`), TIFF tiles (`tiff-tile`); persists across reloads | 256 MiB, 20,000 entries, 8 MiB per entry, LRU | `src/data/persistentByteRangeCache.ts`              |
| Dataset instances                                      | Per URL                                                                                                                      | Dropped on failure, else kept until reload    | `datasetFactory.ts`, `xeniumDatasetCache.ts`        |
| Dataset manifests                                      | Per entered URL                                                                                                              | Replaced by each detection of that URL        | `src/data/datasetFiles.ts`                          |
| Range-probe results                                    | Per URL + label                                                                                                              | Dropped on failure                            | `rangeSupport.ts`                                   |
| Folder listings                                        | Per folder URL                                                                                                               | Replaced by each detection of that folder     | `src/data/folderListing.ts`                         |
| Zarr matrix metadata and cell ID indices               | Per matrix URL                                                                                                               | Cleared when a new Xenium dataset warms up    | `src/data/gex.ts`                                   |
| H5 range-read files                                    | Per file URL, open in an H5 file worker: the Xenium H5 fallback, Visium HD matrices, `feature_slice.h5`, H5AD over 64 MiB    | 128 MiB of blocks each; dropped on failure    | `gex.ts`, `visiumFeatureSlice.ts`, `h5adDataset.ts` |
| SpatialData chunk cache                                | Per store                                                                                                                    | 256 MiB LRU                                   | `src/zarr/zarrStores.ts`                            |
| Decoded tile bitmaps                                   | Per image channel                                                                                                            | Performance budget                            | `src/tiff/tileCache.ts`                             |
| Visium HD overviews, segmentations                     | Per dataset                                                                                                                  | No eviction                                   | `visiumHdDatasetReaders.ts`                         |

The byte-range cache (database version 3) keeps each range's bytes, each
range's size and last access, and the cache's totals in three object stores. A
write stores the range and updates the totals in one transaction. Over a limit,
the same transaction walks the access-time index from the oldest range and
deletes ranges until the totals fit, so eviction never reads cached bytes. A
read updates only the range's access time. Upgrading from an older version
drops the cached ranges: version 1 kept sizes next to the bytes, and version 2
keyed ranges without the file's version. While a tab of an older build holds
the database open, the upgrade waits and the new tab reads without the cache;
each connection closes when a newer version opens elsewhere.

A range's key is its namespace, URL, byte range and the file's version
(`byteRangeFileVersion`): the file's size and its ETag, or its Last-Modified
date when it has no ETag (`responseValidator`). A file replaced at the same
URL therefore misses the ranges cached from the old one. Readers take the
version from a response they already make, never a request of their own: the
zip's `HEAD` (`src/zarr/cachedZipStore.ts`), the TIFF header read
(`src/tiff/remoteTiff.ts`), and hyparquet's `HEAD` for Parquet footers
(`fetchKeepingValidator`). Last-Modified is always readable cross-origin, but
ETag only when the server exposes it. With neither, the key has only the size,
so a replacement of the same size can still be served the old bytes; a TIFF
whose host also hides `Content-Range` is cached by URL alone. A file the page
has already opened, such as a zip store or a TIFF, keeps the version it was
opened with until the page reloads.

A load that several callers wait on (range probes, opening an H5 matrix or
Visium HD's `feature_slice.h5` in its worker, Visium HD barcode mappings) is a
`sharedLoad` (`src/utils/sharedLoad.ts`). It runs under its own signal,
aborted only when every caller waiting on it has aborted, and each caller
stops waiting at its own signal. Before 15.5-E the first caller's signal ran
the load, so its cancel failed the others with an `AbortError` they took for
their own, and their cards stayed on "Loading".

## Workers

| Worker                                | Created by                              | Purpose                                                                                                                    |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `tileDecode.worker.ts`                | `TileDecodeWorkerPool` (≤ 4)            | Decode TIFF tiles into `ImageBitmap`s, or into auto-contrast samples                                                       |
| DuckDB-WASM worker                    | `src/data/duckdb.ts`                    | One per DuckDB client                                                                                                      |
| `zarrDecode.worker.ts`                | `ZarrDecodePool` (≤ 3)                  | Decode OME-Zarr tiles; trace SpatialData labels; run zarrita codecs for main-thread Zarr reads                             |
| `h5File.worker.ts`                    | `src/data/h5WorkerFile.ts`              | One HDF5 file each: small H5AD and the standard Visium matrix whole; larger H5AD, Xenium and Visium HD by range            |
| `cellsOverview.worker.ts`             | `readCellsOverviewInWorker`             | The Xenium `cells.parquet` overview: fetch and decode its columns (one per read)                                           |
| `spatialDataShapes.worker.ts`         | `readSpatialDataShapesInWorker`         | SpatialData `shapes.parquet` files and MERSCOPE cell boundaries: decode them into transferred shape columns (one per read) |
| `merscopeTable.worker.ts`             | `readMerscopeTableInWorker`             | MERSCOPE `cell_by_gene.csv` and `cell_metadata.csv`: fetch, gunzip and parse them (one per read)                           |
| `featureBarcodeMex.worker.ts`         | `readFeatureBarcodeMexInWorker`         | A standard Visium MEX matrix folder: fetch, inflate and parse it into CSR arrays (one per read)                            |
| `zipEntry.worker.ts`                  | `readZipEntryInWorker`                  | One zip entry, a MERSCOPE `.vzg` image pyramid: fetch and inflate it (one per read)                                        |
| `visiumHdSegmentationIndex.worker.ts` | `readVisiumHdSegmentationIndexInWorker` | Visium HD segmentation GeoJSON, piped from the main thread: parse it into index columns (one per read)                     |
| `plotStats.worker.ts`                 | `createPlotStatsSession`                | The Plots panel's numbers: one dataset's rows, the plotted groups and up to 128 MiB of gene values (one per dataset)       |
| `cellQuery.worker.ts`                 | `createCellQuerySession`                | The Cell Query panel's columns by cell, its matching, sorting and the table's values (one per dataset)                     |

An H5 file worker gets the downloaded bytes by transfer (H5AD up to 64 MiB,
standard Visium), writes them into its own h5wasm file system, and answers
reads by path. The Xenium H5 fallback, the Visium HD filtered matrices,
`feature_slice.h5` and larger H5AD files it reads itself: the file sits in h5wasm's file system as a
range-read file (`h5RangeFile.ts`) whose blocks come from synchronous range
requests with read-ahead (`rangeBlockCache.ts`), so HDF5 fetches only what it
reads, and matrix rows and Feature Slice genes are read inside the worker. A
host that ignores Range, or hides the file's size, sends the file whole; for an
H5AD the main thread then downloads it within the 300 MiB limit. An
H5AD file's worker stays open for reads after load (embeddings, tissue images)
and ends when the dataset is garbage collected; a range-read file's stays open
for the session, keeping its barcode index (up to 2 million barcodes) and up to
128 MiB of blocks; the standard Visium matrix's ends once it is read. Requests
go to a worker one at a time, so a request still waiting is dropped when it is
cancelled, and after a failed read the next one opens the file in a new
worker. Where there is no `Worker` (Vitest's jsdom), the same handler runs on
the main thread.

A cells overview worker fetches `cells.parquet` and decodes the overview
columns from hyparquet's column chunks, without an object per row. The columns
come back as transferred typed arrays, with cell IDs and the distinct
segmentation methods as strings, and the main thread builds the overview cells
from them. The worker ends once it has answered, or when the load is aborted.
With an option a worker cannot take (a custom fetcher, an in-memory file, a
test reader) or no `Worker`, the same reader runs on the main thread.

A SpatialData shapes worker decodes one `shapes.parquet` (WKB points and
polygons) into columns: instance ids, kinds, centroids, radii, ring areas and
bounds, and every outer ring in one `Float32Array`, all transferred. It
fetches a plain URL itself; a file inside a zipped store, or one behind a
custom fetcher, is read on the main thread and handed over slice by slice, so
the zip store and its byte-range cache stay on the main thread. The worker
ends once it has answered, or on abort. If it fails to start, or there is no
`Worker`, the file is read on the main thread.

The MERSCOPE table, MEX matrix and zip entry workers each fetch their files
themselves and send back progress messages, then the result by transfer. The
Visium HD segmentation index worker fetches nothing: the main thread fetches
the GeoJSON, so custom fetchers and the full-file budget apply, and hands its
body over chunk by chunk. Each ends once it has answered, or on abort. With a
custom fetcher (except the segmentation index), with no `Worker`, or if the
worker fails to run, the same reader runs on the main thread. See
[MERSCOPE](./modalities/merscope.md), [Standard Visium](./modalities/visium.md)
and [Visium HD](./modalities/visium-hd.md#caching-and-workers).

The Plots panel reads each selected gene's value in every cell with the
dataset's `geneValues(genes)` (`src/data/geneValues.ts`): the rows with a
stored value other than 0, and those values, as typed arrays. A matrix held
in memory (standard Visium, MERSCOPE, an `.h5ad` read whole) is scanned on the
main thread, yielding every million stored values; a CSR matrix is scanned
once for all the genes asked for. A matrix read over HTTP goes through the
same module with the dataset's own reads passed in:
`geneValuesFromColumnSlices` for each gene's slice of a CSC matrix, Atera's
CSC and Xenium's feature-major `cell_features`;
`geneValuesFromCsrBatches` for all of a CSR `X`, in batches of whole rows
with up to 4 million stored values; and `geneValuesFromDenseChunks` for the
dense Zarr chunks that hold the genes. Four reads are in flight at once (six
for H5AD). Before reading, `estimateGeneValuesRead(genes)` gives the bytes the
read decodes, which the panel holds to its budget (plan 22-D7). The values go
by transfer to the panel's plot worker, which the panel starts once per
dataset and gives the dataset's row cell IDs; Xenium's are the
`cell_features/cell_id` integer pairs, made text in the worker. The worker
maps each class's cell IDs, and the selection's, to rows once per set, then
sums each gene's stored values into the groups of their rows; every other
cell of a group counts as 0. It also sorts each group's stored values once
per gene, for the quartiles with the zeros placed among them, and for up to
64 groups makes a smoothed histogram of each on the gene's range, the
violin's shape; both scales and both Include zeros settings are worked out
then, so switching reads and computes nothing. It keeps gene values up
to 128 MiB, least recently used first out, and answers for genes it no longer
holds with their names, which the panel reads again. If the worker fails, or
there is no `Worker`, the same store runs on the main thread. See
[plan 22](plan/phases/22-plots-panel.md).

The Cell Query panel keeps the columns its conditions and table use in its
own worker (`src/features/query/cellQuery.ts`), started once per dataset and
given the overview's cell IDs, so rows are the overview's cells in their
order. Overview values (transcript count, area, nucleus count) go to it as
one `Float64Array` per column, NaN where a cell has none, and the
segmentation method as a code per row. Class sets and saved selections go as
each class's cell IDs, and metadata tracks as IDs and values; the worker maps
the IDs to rows once per column, keeping each row's first class and a map of
further ones, as the plot worker does. A column is sent the first time a
condition, table column or sort uses it, and again only when its values
change. Matching filters the rows condition by condition and returns the
matches, sorted, as a transferred `Uint32Array`; the table then asks for the
values of 64 rows at a time, sending a copy of those rows. Sorting the IDs
compares whole numbers by value and other text by character code, as a
collator would take seconds over a million IDs. If the worker fails, or there
is no `Worker`, the same store runs on the main thread, given the rows and
columns again. See [plan 23](plan/phases/23-cell-query.md).

Auto-contrast decodes and samples tiles off the main thread and gets back only
the sampled pixels. TIFF tile bytes, fetched on the main thread, go to a tile
decode worker started for the run, which ends with the run or on abort. An
OME-Zarr tile is sampled by the Zarr decode worker that holds its chunk. The
main thread sorts the samples and builds the histogram. Where there is no
`Worker`, or a Zarr decode worker fails, tiles are sampled on the main thread.

zarrita reads (Xenium matrix and transcripts, H5AD references, SpatialData
tables) are made on the main thread, but their costly codec steps are not:
`installWorkerZarrCodecs` (`src/zarr/workerZarrCodecs.ts`, called from
`main.tsx`) points zarrita's codec registry at worker versions of its
decompressors (`blosc`, `zstd`, `lz4`, `gzip`, `zlib`) and string codecs
(`vlen-utf8`, `json2`). Each chunk zarrita decodes is copied to a Zarr decode
worker, which runs zarrita's own codec and sends back the bytes by transfer
(strings by clone). Byte order, filters and assembling the selection stay on
the main thread; whole arrays whose chunks span every axis but the first are
assembled a chunk at a time (`getWholeArray`, `src/zarr/zarrWholeArray.ts`)
instead of zarrita's row-by-row copy. A chunk a worker cannot decode is
decoded on the main thread with zarrita's codec, which reports a chunk that
does not decode. A worker that fails (`ZarrDecodeWorkerError`: its script did
not load, or it stopped) sends every chunk to the main thread until the page
is reloaded, rather than starting new workers that fail again, and Data access
notes says so ("Zarr decoding", `src/zarr/zarrCodecWorkerStatus.ts`), however
many datasets are opened after. With no `Worker` the registry is left alone.
OME-Zarr image chunk bytes are fetched on the main thread and decoded whole in
the Zarr decode workers, which fall back to the main thread if they fail.
Other hyparquet reads (Visium HD positions and barcode mappings, and
`Browse File`'s footer and first rows) run on the main thread.

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
  `duckdb-vendor`, `spatial-io-vendor`, `codec-vendor`); h5wasm, whose
  WASM is inlined, stays out of them in a chunk of its own that loads on
  first import, so the start screen does not preload it. The config also
  serves `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` in dev and preview. The app does not
  depend on cross-origin isolation: nothing uses `SharedArrayBuffer`, and
  DuckDB-WASM uses its non-threaded bundles. See
  [Deploy to S3](./deploy-to-s3.md#recommended-shape) for production headers.
- `npm run build` runs `tsc -b` then `vite build` into `dist/`. See
  [Deploy to S3](./deploy-to-s3.md).
