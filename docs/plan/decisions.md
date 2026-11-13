# Architecture Decisions

## 4.1 React And TypeScript — DECISION: Yes

The POC's global state was already strained. React components and a small store
keep the growing UI manageable, and TypeScript catches the bugs that matter
here. deck.gl does not depend on a framework, so keep the imperative deck.gl and
canvas core and wrap only the chrome (panels and controls) in React.
TypeScript and modules are non-negotiable; React is the recommended default.

## 4.2 State — DECISION: Zustand, Kept Small

- **Original:** Zustand, because it is small and can be used outside React, so
  the deck.gl loop can share the store. Heavy data stays out of it.
- **Amended (2026-06-07):** the existing viewer store stays the only Zustand
  boundary. Feature state stays in React. Domain state is grouped into bundles
  by `useAppDomainState` (refactor item 1, closed 2026-06-27).

## 4.3 Parquet Engine — DECISION: DuckDB-WASM Primary, hyparquet For First Paint

- DuckDB-WASM is needed for `ST_Within` polygons, bounding-box predicates with
  row-group skipping, and joins. It costs about 40 MB of WASM and seconds of
  start-up time.
- hyparquet (about 10 KB, with `hyparquet-compressors` for ZSTD) reads
  `cells.parquet` centroids for a fast first paint, in a worker since
  2026-11-13. DuckDB is imported dynamically, only when a query needs it.
- If hyparquet cannot decode the `cells.parquet` page encoding, the overview
  falls back to DuckDB.
- Use the non-threaded MVP/EH DuckDB bundles. The cross-origin-isolated pthread
  bundle failed to load the `spatial` and `parquet` extensions because of a
  shared-memory mismatch.
- Run `SET enable_http_metadata_cache=true` at boot. Without it, the Parquet
  footer and a `HEAD` request are fetched again for every query.
- **`httpfs` — Superseded.** The original brief said `LOAD httpfs` was
  redundant in duckdb-wasm. Phase 5.1 changed this: load `httpfs` during
  bootstrap before remote Parquet reads, and continue if loading fails on older
  bundles. On DuckDB v1.5.1 this read 100 remote transcript rows in about 1.2 s.
  `LOAD spatial` is still required.
- Range-read `cell_boundaries.parquet` and `transcripts.parquet` with the
  bounding-box pattern. Buffer only small files such as `cells.parquet`.
- Use separate DuckDB clients for transcript scans and interactive cell or ROI
  queries, so a busy scan cannot block them.
- Keep row groups reasonably sized in any data you control, so bounding-box
  pruning fetches few chunks.
- Match the bounds to the column's Parquet type. DuckDB casts a FLOAT column
  compared with DOUBLE parameters and then cannot prune by row-group
  statistics, so FLOAT columns (Xenium boundary vertices and transcript
  locations) take `CAST(? AS FLOAT)` bounds (`betweenSql`, 2026-11-12).
- ExternalFileCache (checked 2026-11-12): on by default in the bundled DuckDB
  v1.5.1, and left on. Its effect in the browser is not measured; see the
  [optimization pass](phases/optimization-pass.md#closed-open-items).

## 4.4 Image Layer — DECISION: Custom JPEG-2000 Path; Canvas2D Compositing

- Keep the custom JPEG-2000 tile pipeline for 16-bit Xenium morphology.
- **Viv `XRLayer` — Superseded.** The brief planned Viv for multi-channel
  blending. Phase 3 implemented compositing in the existing Canvas2D underlay
  instead: one TIFF loader and cache per channel, tinted tiles, and additive
  compositing. This avoided a renderer architecture change.
- **JPEG XR — Dropped** by the user on 2026-06-07.
- LZW and uncompressed custom image layers decode through geotiff.js. The common
  no-predictor LZW path decodes into a preallocated buffer.

## 4.5 Rendering — DECISION: Two Canvases, Decode Off The Main Thread

deck.gl (orthographic) draws points, polygons, grids, and transcripts. A
Canvas2D underlay draws image tiles. Image decode runs in a worker pool and
returns transferables. The main thread schedules and draws. This was the single
biggest UX improvement over the POC.

Later additions:

- **Zarr decode workers (Phase 10, `92defed`).** OME-Zarr image chunks are
  decoded and converted to RGBA in a pool of up to three module workers
  (`zarrDecodePool.ts`). Each chunk is routed to one worker, which keeps it for
  all of its virtual tiles. SpatialData label chunks are traced into outlines in
  the same workers. Chunk bytes are still fetched on the main thread so store
  errors behave the same, and decoding falls back to the main thread if a worker
  fails.
- **GPU-resident overview (`bf6ebc8`).** Every overview cell is uploaded once as
  packed arrays. The GPU draws a fixed-rank sample capped by the performance
  budget (75k / 150k / 250k), hides outlined cells with a GPU filter, and
  styles the hovered cell on demand. Panning no longer filters, re-samples, or
  restyles cells on the CPU. Viewport counts come from a bucket index.
- **Instanced Visium HD bins (`bf6ebc8`).** One shared bin shape per bin size is
  uploaded once and instanced per bin, instead of re-tessellating visible
  polygons on every pan. Grids over 1M bins (2 µm) are clipped to a snapped box
  that moves every half view.
- **Tile scheduling (`bf6ebc8`).** When the view moves, morphology tiles still in
  view keep loading; only tiles that left the view are cancelled.
- **H5 file workers (2026-11-13).** A whole HDF5 file (an H5AD up to 300 MiB,
  the Xenium `cell_feature_matrix.h5` fallback, the standard Visium filtered
  matrix) is opened with h5wasm in its own worker (`h5File.worker.ts`), which
  answers reads by path. H5AD and Visium bytes are downloaded on the main
  thread, as before, and transferred; the worker fetches the Xenium matrix
  itself, so its 433 MB never reach the main thread. H5AD files send back their
  groups, datasets and attributes once, and the reader then reads datasets as
  before; the Xenium fallback's cell rows are read in the worker and come back
  packed in typed arrays. One worker per file, because h5wasm's heap cannot
  shrink: terminating it frees the file. An H5AD's worker ends when its
  dataset is garbage collected (`FinalizationRegistry`).
- **Cells overview worker (2026-11-13).** The Xenium `cells.parquet` overview
  is fetched and decoded in a worker of its own (`cellsOverview.worker.ts`).
  It reads hyparquet's column chunks instead of an object per row, and sends
  the columns back as transferred typed arrays; cell IDs and the distinct
  segmentation methods are cloned as strings. The main thread only builds the
  overview cells from the columns. Decode errors keep their name across the
  worker, so the DuckDB fallback still applies.
- **Auto-contrast worker (2026-11-13).** Auto-contrast decodes and samples
  tiles off the main thread and gets back only the sampled pixels. TIFF tile
  bytes go to a tile decode worker started for the run and ended with it or
  on abort; an OME-Zarr tile is sampled by the Zarr decode worker that holds
  its chunk, often already decoded for drawing. Samples are taken by level
  pixel index, as before, so results are unchanged. The main thread sorts at
  most 250,000 samples as a `Float64Array` (about 18 ms, against 44 ms for the
  `number[]` it used) and builds the histogram.
- **Zarr codec workers (2026-11-13).** zarrita reads made on the main thread
  (Xenium matrix and transcripts, H5AD references, SpatialData tables) run their
  decompressors (`blosc`, `zstd`, `lz4`, `gzip`, `zlib`) and string codecs
  (`vlen-utf8`, `json2`) in the Zarr decode workers. `main.tsx` points zarrita's
  codec registry at worker versions (`workerZarrCodecs.ts`) that copy each chunk
  to a worker and get the bytes back by transfer, or the strings by clone, so
  one hook covers every store (HTTP, zip, references, Icechunk) without moving
  reads or their caches into workers. zarrita still fetches chunks and assembles
  selections on the main thread; whole arrays chunked only by row are assembled
  a chunk at a time (`getWholeArray`) instead of with zarrita's row-by-row copy,
  which took 124–127 ms for the Xenium matrix's 1,414,155 × 2 cell IDs. If a
  worker fails, the chunk is decoded on the main thread.
- **SpatialData shapes worker (2026-11-13).** Each `shapes.parquet` is decoded
  in a worker of its own (`spatialDataShapes.worker.ts`). The worker fetches a
  plain URL itself; a file inside a zipped store, or behind a custom fetcher,
  is read on the main thread and handed over slice by slice, so the zip store
  and its caches stay where they are. Shapes come back as columns
  (`SpatialDataShapes`): ids, kinds, centroids, radii, ring areas, bounds, and
  every outer ring in one `Float32Array`, all transferred. The main thread
  keeps no object or typed array per shape: a table row first tries the shape
  after the last one matched and builds an id `Map` only when that misses,
  coordinates are scaled to µm when used, and outlines are built only for
  cells in view. If the worker fails to start, the file is read on the main
  thread.

## 4.6 Data-Source Abstraction — Capability-Based

Do not assume every dataset has every modality. The interface exposes
capabilities and tags geometry. It does not hardcode a platform.

Original interface:

```ts
type Platform = 'xenium' | 'visium' | 'visium-hd'
type ElementGeometry =
  | { kind: 'polygon'; rings: number[][][] } // Xenium cells
  | { kind: 'circle'; center: [number, number]; diameter: number } // Visium spots
  | { kind: 'square'; origin: [number, number]; size: number } // Visium HD bins

interface DatasetMeta {
  platform: Platform
  units: UnitsDescriptor // µm + origin (Xenium) | px + scalefactors (Visium)
  extent: BBox
  capabilities: {
    transcripts: boolean
    cellBoundaries: boolean
    pyramidImage: boolean
    multiChannel: boolean
  }
  channels?: ChannelInfo[]
}

interface SpatialDataset {
  meta(): Promise<DatasetMeta>
  elements(bbox: BBox): Promise<ElementBatch> // geometry-tagged: cell | spot | bin
  matrix(ids: string[]): Promise<GexResult> // feature-barcode matrix
  annotations(): Promise<Annotation[]> // clusters, UMAP, custom labels
  image(): Promise<ImageSource | null> // pyramid | flat + scalefactor
  // Capability-gated. Absent on Visium.
  transcripts?(sel: Selection, scope: TranscriptScope, minQv: number): Promise<GexResult>
}

type ImageSource =
  | { kind: 'pyramid'; loader: TiffPyramidLoader }
  | { kind: 'flat'; url: string; scaleFactor: number; size: [number, number] }
```

Rules:

- The renderer picks the layer from the geometry `elements()` returns, not from
  the platform.
- The image component branches on `ImageSource.kind`.
- `transcripts` is optional. Gate transcript UI on `capabilities.transcripts`.
- `coords.ts` reads `meta().units`. No platform conditionals elsewhere.

Amendments made in later phases:

- **Generic element IDs (Phase 6).** The interface became
  `SpatialDataset<ElementId>`, with `SpatialElementId` and
  `GexResult<ElementId>`. Xenium is typed `SpatialDataset<CellId>`.
- **Affine grid instead of `square` (Phase 6).** Visium HD bins are an indexed
  affine grid (`SpatialGrid`/`SpatialGridBasis`), not per-bin polygons and not
  axis-aligned squares. Grid payloads are columnar (`GridCellBatch`: `Int32Array`
  rows and columns with one interned `gridId`). A logical `grid-cell`
  `ElementGeometry` is rebuilt only for picking, tooltips, and selection. See
  [Phase 6 product decisions](phases/06-visium-hd.md#product-decisions) for the invariants.
- **Segmentation descriptors (Phase 6).** `DatasetMeta` has optional
  segmentation descriptors: cell or nucleus, GeoJSON or TIFF, path, label, and
  annotation metadata.
- **New platforms.** `h5ad` (Phase 7), `image` (Phase 8), and `spatialdata`
  (Phase 10). The union is now `'xenium' | 'visium' | 'visium-hd' | 'h5ad' |
'spatialdata' | 'image'`; `'visium'` has no implementation.
- **SpatialData reuses AnnData (Phase 10).** `SpatialDataDataset` reads its table
  through `AnnDataH5adDataset` over a Zarr source, so H5AD and SpatialData share
  obs, var, `X`, and `obsm` handling.
- **Shared image pyramid interface (Phase 9).** TIFF and OME-Zarr loaders both
  implement `ImagePyramidLoader` (`src/data/imagePyramid.ts`); `openImagePyramid`
  picks the loader from the URL.
- **Geometric annotations (Phase 8).** GeoJSON shapes are a separate model
  (`geometricAnnotationModel.ts`), not cell-ID annotations.
- **Detection.** A dataset factory resolves a `SpatialDataset` from a URL. It
  accepts both directory roots and direct file URLs. Current order: `.h5ad` URL,
  Zarr-looking URL (SpatialData or OME-Zarr), TIFF/NDPI URL,
  `experiment.xenium`, root Zarr metadata, then Visium HD tiers. Every probe is
  a `HEAD` with a 15 s timeout, so hosts must allow `HEAD`.
- **Platform adapter (refactor).** App-level platform branching is centralized
  in `platformAdapter.ts`.
- **Naming (refactor).** The shared expression contract uses `elements`, not
  `cells`, because Visium HD bins flow through it (2026-06-28).
- **Flat images (Phase 6).** `ImageSource.kind === 'flat'` is implemented for
  Visium HD PNGs. Image dimensions are optional; the browser image's natural
  size is the fallback.

## 4.7 Transcript Source

- **Original — Superseded in part:** drop `transcripts.zarr.zip` because
  `transcripts.parquet` has `cell_id` and the Zarr does not. The POC's
  `gexFromTranscriptsZarr` per-cell path stays deleted.
- **Phase 5.1:** `transcripts.zarr.zip` is the native level-of-detail source.
  Its `/grids` pyramid drives density squares, and its level-0 grid tiles drive
  exact points. `transcripts.parquet` is the source of truth for per-transcript
  `cell_id`, `overlaps_nucleus`, `nucleus_distance`, `is_gene`, FOV, QV, and
  coordinates. It is also the exact-point fallback when the Zarr is missing.
- Per-cell expression highlighting uses the cell-feature matrix, never
  `transcripts.parquet`.

## 4.8 Cell-Feature Matrix

- Prefer native CSC Zarr (`cell_features/csc/{indptr,indices,data}`, XOA 3.1
  and later).
- Support the older feature-major arrays (`cell_features/{indptr,indices,data}`)
  for selected-gene reads.
- For ROI gene statistics and selected-cell profiles on older output, fall back
  to `cell_feature_matrix.h5` through h5wasm.
- Do not look for or generate cell-major Zarr sidecars.
- **jsfive — Deferred.** Add it only if a real H5-only dataset fails in h5wasm
  but works in jsfive.

## 4.9 Cell Boundaries

- Range-read through DuckDB. Order vertices by `file_row_number`. Fetch
  vertices with at least a 150 µm margin around the viewport, and expand the
  candidate centroid window by 75 µm so partly visible edge cells are kept.
- Do not add a client-side simplified-boundary mode (fewer than 5 points). It
  would still fetch every vertex. Revisit only if a precomputed simplified
  geometry pyramid is added.
- Do not draw centroid-generated pseudo-boundaries. The hexagon layer was
  removed.
- **Current load rule (2026-11).** Boundaries load when zoom is −0.25 or closer,
  or when fewer visible cells than `Boundary limit` are in view. The limit is
  1–100,000, defaulting to 2,500 on compact devices and 50,000 otherwise.
  Requests are keyed by the bounding box rounded to 50 µm.
- **Xenium nuclei (Phase 17).** `nucleus_boundaries.parquet` is read the same
  way and under the same rule, split by `cell_id` and `label_id`. The cell
  query is skipped while `Cell boundaries` is off.
- **SpatialData outlines (Phase 10).** Label outlines are traced only for cells
  overlapping the requested area, cached per label while their chunks stay
  loaded, and simplified with Douglas–Peucker at 0.25 label pixels. Requests
  cover the viewport plus up to 25% per side, and no new request is made while
  the padded area still covers the view at a similar zoom.

## 4.10 Zarr Store Access (Phases 9–10)

- Object stores that deny listing answer `403` for missing keys. Treat `403` as
  missing **only** for metadata keys (`.zarray`, `.zgroup`, `.zattrs`,
  `.zmetadata`, `zmetadata`, `zarr.json`); chunk `403`s stay errors
  (`9c0d221`).
- SpatialData requires consolidated metadata (`zarr.json` v3,
  `zmetadata`/`.zmetadata` v2), because the browser cannot list prefixes. OME-Zarr
  images use it when present.
- Non-range chunk reads go through a 256 MiB LRU per SpatialData store. Decoded
  OME-Zarr chunks share a separate 256 MiB cache.
- Absent chunks read as fill values, so an interrupted upload loads silently with
  empty data. Diagnostics therefore send a `HEAD` for every table chunk, and
  missing string chunks fail fast.
- **Zipped SpatialData (2026-11-13).** A `.zip` URL is read through zarrita's
  `ZipFileStore` over the cached range reader (`src/zarr/zarrZipStore.ts`).
  The central directory is read once and shared by detection, the dataset,
  and diagnostics; keys are relative to the store folder inside the zip.
  Stored entries are read by range, deflated entries whole. Only SpatialData
  is read from zips. Diagnostics check chunks against the zip directory
  instead of sending `HEAD`s.

## 4.11 Units For Stores Without Declared Scale (Phase 10)

SpatialData coordinates are converted to micrometres by a factor per coordinate
system: a user override (`µm per unit`), else the declared axis unit, else an
estimate (`cell_area` against segmentation area, the Visium 100 µm spot pitch,
or Visium HD `square_NNNum` bin names). If none applies, the factor is 1 and the
scale bar, measurements, and coordinate readout say "units" instead of µm.
H5AD `obsm` values are used directly as micrometres.
