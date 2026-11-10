# H5AD (AnnData) Modality

How the viewer detects and reads a direct AnnData `.h5ad` file URL. For
hosting requirements see [Host your own data](../host-your-own-data.md#host-your-own-h5ad-data);
for the shared load pipeline see [Architecture](../architecture.md).

## Detection

`detectSpatialDataset` (`src/datasets/datasetFactory.ts`) checks the URL
before any other platform:

1. The URL, with trailing slashes stripped, must end in `.h5ad` (a query string
   or fragment may follow).
2. A single `HEAD` request (15 s timeout) must return `2xx`. A host that rejects
   `HEAD` makes the file undetectable and the platform `unknown`.

`createSpatialDataset` then lazy-imports `AnnDataH5adDataset`
(`src/datasets/h5adDataset.ts`). Instances are memoized per URL by
`cachedSpatialDataset`.

A file with the standard Visium layout in `uns/spatial/<library>` is switched to
the Visium platform once it is read; see
[Standard Visium](./visium.md#h5ad-with-unsspatial).

## Files Read

| File               | Required                         | Read by                    | Library                                             | Notes                                                |
| ------------------ | -------------------------------- | -------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `sample.h5ad`      | Yes                              | `readH5ad`                 | `h5wasm` (whole file) or `zarrita` over a reference | `HEAD` first to read `Content-Length`                |
| `sample.h5ad.json` | Only if the file exceeds 300 MiB | `readH5adReferenceOrThrow` | `@zarrita/storage` `ReferenceStore`                 | Kerchunk reference; URL is the H5AD URL plus `.json` |

## Two Backends

`readH5ad` picks a backend from the file size (`H5AD_MAX_FILE_BYTES` =
300 MiB = 314,572,800 bytes):

- **In-memory (`h5wasm`).** For files up to 300 MiB. The whole file is
  downloaded with one plain `GET` (no byte ranges), written into the Emscripten
  filesystem, and opened with `h5wasm.File`. If `Content-Length` is missing,
  the body is streamed with a running byte count; going past 300 MiB cancels
  the download and switches to the reference backend.
- **Kerchunk reference (`zarrita`).** For files over 300 MiB. The app fetches
  `<h5ad URL>.json`, rewrites every chunk reference to point at the H5AD URL
  (the URL stored in the JSON is ignored), and opens it as a Zarr v2 store with
  `ReferenceStore.fromSpec`. Chunk reads are byte-range requests with at most 6
  in flight (`H5AD_REFERENCE_FETCH_CONCURRENCY`). The query string of the H5AD
  URL is carried into the `.json` URL, so presigned URLs need a matching
  presigned reference URL.

Generate the reference with `kerchunk.hdf.SingleHdf5ToZarr` (for example with
`inline_threshold=0`) and host it next to the H5AD file.

Both backends hydrate a group tree and pass it to `readH5adCacheFromGroup`, so
everything below applies to either. The parsed result is cached once per
dataset instance (`cachePromise`, reset on error).

## HDF5 Layout Read

| Path    | Required | What is read                                         |
| ------- | -------- | ---------------------------------------------------- |
| `/obs`  | Yes      | Index plus every column (see below)                  |
| `/var`  | Yes      | Index, optionally replaced by a gene-name column     |
| `/obsm` | Yes      | 2D matrices with `n_obs` rows and at least 2 columns |
| `/X`    | Yes      | Dense dataset, or a CSR/CSC sparse group             |

`/layers`, `/raw`, `/varm`, and `/obsp` are not read. `/uns` is read only for
`uns/spatial` ([Standard Visium](./visium.md#h5ad-layout-read)).

### Index And Gene Names

- **Index** (`readDataframeIndex`): the `_index` attribute value, then
  datasets named `_index`, `index`, `obs_names`/`var_names`, then `cell_id`
  (obs) or `gene_ids` (var). Names are trimmed; empty names become `obs-N` or
  `var-N`; duplicates get `-2`, `-3`, … suffixes.
- **Gene names** (`readGeneNames`): the first column among `gene_symbols`,
  `gene_symbol`, `feature_name`, `name` with one value per gene and at least
  one non-empty value replaces the var index. A column can be a string
  dataset, a categorical group (`codes` + `categories`, as CELLxGENE stores
  `feature_name`), or integer codes with a legacy `/var/__categories/<key>`
  sidecar. Negative codes become empty names. The index's rules then apply:
  empty names become `var-N` and duplicates get `-2`, `-3`, … suffixes.
- **Gene aliases** (`geneAliases`): when a column replaces the index, each
  gene's index name (often its Ensembl ID) is kept as an alias. The
  `Gene selection` search and `Gene set symbols` match aliases too, and the
  gene list tooltip shows it (`MYH7 (ENSG00000092054)`). Selected genes,
  shared links, and manifest `defaults.genes` use the listed names only.

### `obs` Columns

`readObservationTracks` follows the `column-order` attribute, or all keys
except the index and `__*` entries:

- Categorical groups (`codes` + `categories`) become **annotation sets**.
  Negative codes are treated as missing; numeric categories are stringified.
- Legacy `/obs/__categories/<key>` sidecars with integer codes are also
  treated as categorical.
- Numeric datasets become continuous tracks (skipped if no value is finite).
  Boolean datasets count as numeric (0/1) on every backend.
- String datasets become categorical tracks; empty strings are missing.
- Other groups (nullable integer/boolean, masked arrays) are skipped.

Continuous `obs` values appear as per-cell "Observations" rows in the Cell
tab and as `Cell color` → `Metadata` tracks. The track list (label, range, cell
count) loads with the dataset; a track's per-cell values are built only when it
is shown (see [Feature Read Paths](#feature-read-paths)).

### Coordinates (`/obsm`)

- Spatial coordinates come from the first key present in
  `H5AD_COORDINATE_KEYS`: `X_spatial`, `spatial`, `X_umap`, `umap`, `X_tsne`,
  `X_tSNE`, `tsne`, `X_pca`. If none exists, the load fails.
- Only columns 0 and 1 are used. Any non-finite value fails the load.
- Values are used directly as micrometres (1 µm per unit), except for Visium
  files, whose `obsm/spatial` pixels are scaled to micrometres
  ([Units And Coordinates](./visium.md#units-and-coordinates)).
- Embedding options (`readObsmEmbeddingOptions`) are every dense 2D obsm
  matrix with `n_obs` rows and 2+ columns, ordered `X_umap`, `umap`, `X_tsne`,
  `X_tSNE`, `tsne`, `X_pca`, `X_spatial`, `spatial`, then alphabetically.

### Expression (`/X`)

`readMatrix` classifies `/X`:

| `/X` shape                            | Layout (h5wasm / reference) | How one cell's genes are read                                       |
| ------------------------------------- | --------------------------- | ------------------------------------------------------------------- |
| Dataset `n_obs × n_vars`              | `dense` / `dense-zarr`      | Row lookup / `zarr.get(values, [row, null])`                        |
| Group, `encoding-type` = `csc_matrix` | `csc` / `csc-zarr`          | One `indptr` span per requested gene                                |
| Group, any other encoding             | `csr` / `csr-zarr`          | `indptr` slice per row; Zarr rows are batched into contiguous reads |

Sparse groups need a `shape` attribute and `data`, `indices`, `indptr`
datasets. `indptr` is always read in full. On the reference backend `data` and
`indices` stay lazy; CSR row reads are merged into batches of up to 4,000,000
values with gaps up to 262,144 values (`csrZarrRowBatches`).

## Load Sequence

`useDatasetLifecycle` (`src/features/app-shell/useDatasetLifecycle.ts`) runs
`loadAnnDataOverview`, which calls these in parallel:

| Call                 | Result                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `overview()`         | One point per finite coordinate row, with categorical and numeric obs values as metadata |
| `genePanel()`        | Gene names from `/var`                                                                   |
| `annotationGroups()` | One `analysis:<column>` option per categorical obs column                                |
| `embeddingOptions()` | obsm keys usable as embeddings; the first one is selected                                |
| `metadataTracks()`   | One `h5ad:<column>` `Metadata` track per continuous obs column, without per-cell values  |

H5AD has no morphology image and no boundary polygons, so cell boundaries are
switched off and `meta()` reports all capabilities as `false`. `elements()`
returns `[]` and `image()` returns `null`. Before this, the lifecycle calls
`visiumSummary()`; when it finds a Visium layout, the load continues as
[Standard Visium](./visium.md#load-sequence) instead.

## Feature Read Paths

| Feature                 | Path                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cell rendering          | Points from `overview()`, radius 2 px, scaled with `pointSizeFullViewScale: 0.5`; no overview cap or viewport clipping                                          |
| Selected-gene colouring | `geneExpression(bbox, genes)` scans cells in the bbox in obs order, reads per-cell counts for the requested genes, and sums them for multi-gene signatures      |
| Annotations             | `annotations({ groupId })` on demand when an annotation set is loaded                                                                                           |
| Embeddings              | `embeddings({ kind })` re-reads the selected obsm matrix                                                                                                        |
| Metadata colouring      | `metadataTrackValues(trackId)` for the selected track when `Cell color` is Metadata (`useCellMetadataTrackValues`), including a shared link that opens that way |
| Selected-cell profile   | `matrix([cellId])` over all genes, summarized by `summarizeRoiGeneExpression`                                                                                   |
| ROI cells               | `cells(bbox)` bbox scan plus point-in-polygon for lassos                                                                                                        |
| ROI gene stats          | 32-cell preview, then a refinement over every ROI cell                                                                                                          |

Transcripts, Magic Lens, nucleus boundaries, and ROI transcript export are
disabled by `H5AD_PLATFORM_ADAPTER` (`src/features/app-shell/platformAdapter.ts`).

## Source Files

| File                                            | Role                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `src/datasets/datasetFactory.ts`                | URL check, `HEAD` probe, lazy construction                          |
| `src/datasets/h5adDataset.ts`                   | Both backends, HDF5 layout parsing, all dataset methods             |
| `src/features/app-shell/useDatasetLifecycle.ts` | `loadAnnDataOverview` first-paint sequence                          |
| `src/features/app-shell/platformAdapter.ts`     | `H5AD_PLATFORM_ADAPTER` feature gating, `isAnnDataPlatform` routing |
| `src/features/cells/useCellDetailWorkflow.ts`   | Selected-cell gene profile                                          |
| `src/features/roi/useRoiWorkflow.ts`            | ROI cells and gene statistics                                       |
| `src/features/errors/loadErrorModel.ts`         | User-facing messages for H5AD errors                                |
| `src/data/datasetDiagnostics.ts`                | Diagnostics: detection plus a range check on the `.h5ad` file       |

## Errors

| Error                                        | Cause                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `H5adReferenceFileUnavailableError`          | File is over 300 MiB and `<url>.json` is missing or not readable                       |
| `H5adAllGeneCscMatrixUnsupportedError`       | All-gene read (selected-cell profile, ROI gene stats) on a reference-backed CSC matrix |
| "Expected H5AD /obs/... to contain strings." | An obs dataset is neither numeric nor string                                           |

## Known Limitations

- `Clear Annotations`, or a metadata track's `x`, also drops the tracks read
  from `obs`; reload the dataset to get them back.
- Imported CSV/JSON annotation and metadata files are parsed with `asCellId`
  (`src/data/cellid.ts`), which only accepts Xenium-format IDs
  (`/^[a-p]{8}-\d+$/`). Files keyed by H5AD obs names are rejected.
- Diagnostics do not check the `.h5ad.json` reference.
- The in-memory backend downloads the whole file before anything renders.
