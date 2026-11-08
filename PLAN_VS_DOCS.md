# Unified Plan vs Current Docs

This compares [`UNIFIED_PLAN.md`](./UNIFIED_PLAN.md) with `docs/` (and the root
`README.md`) at commit `096ef46`, 2026-11-08.

The two sets serve different purposes. `docs/README.md` says the planning files
"describe intent and history", while the docs "describe current behaviour".
The plan's last edit was on 2026-07-09. The docs were rewritten on 2026-11-07
(`06dae4b`, `3a46456`). Most differences are therefore the plan falling behind
four months of shipped work. A smaller set are real contradictions, where the
plan marks something done and the docs say it does not work that way.

Where the two disagreed, I checked the code. **Code:** notes below give the
file and what it shows.

## Resolution (2026-11-08)

This review is now a record. Its findings were acted on the same day:

| Section                                   | What was done                                                                                                                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [1](#1-in-the-docs-not-in-the-plan)       | Folded into `UNIFIED_PLAN.md`: Phase 8 closed, Phase 9 (OME-Zarr) and Phase 10 (SpatialData) added, November expression and rendering work recorded under the optimization pass, unrecorded Visium HD work added to Phase 6 |
| [2](#2-plan-says-done-docs-say-otherwise) | The eight items are marked **Reopened** in the plan and listed in its Open Items. The code was not changed                                                                                                                  |
| [3](#3-in-the-plan-not-in-the-docs)       | Already open in the plan; outcomes added (for example, papaparse not adopted)                                                                                                                                               |
| [4](#4-same-topic-different-values)       | Current values recorded in the plan; Appendix A rows 23–30 note what they superseded                                                                                                                                        |
| [5](#5-inconsistencies-inside-docs)       | All six fixed in `docs/`, plus a seventh found while fixing them (SpatialData diagnostics)                                                                                                                                  |

## Summary

1. **Three shipped areas have no plan record.** SpatialData (Oct–Nov 2026),
   OME-Zarr images (July 2026), and Phase 8 (image-only plus GeoJSON). Phase 8
   has no item checked in the plan, but the docs describe it as shipped.
2. **The plan marks eight items done that the docs say are missing or partial.**
   The largest: H5AD numeric `obs` colour tracks, H5AD HDF5 reads in a worker,
   Visium HD low-res image fallback, the Magic Lens QV filter, and diagnostics
   coverage.
3. **Key numbers changed.** Expression LOD, overview point rendering, and
   boundary limits all work differently now than the plan describes.
4. **Some plan items never shipped and the docs do not mention them.**
   Standard Visium spots, Xenium nucleus boundaries, `metrics_summary.csv` QC,
   Z-stack, CI, and the golden fixture bundle.
5. **The docs disagreed with themselves in six places**, including two stale
   statements about where OME-Zarr decoding runs. All are fixed. See
   [section 5](#5-inconsistencies-inside-docs).

---

## 1. In The Docs, Not In The Plan

Features the docs describe that the plan never recorded.

| Area                              | What the docs describe                                                                                                                                                                                                                                                                                                                           | Plan coverage                                    | Commits                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------ |
| **SpatialData platform**          | Detection via `spatialdata_attrs`; required consolidated metadata; catalog and view selection (table, coordinate system, image, boundary candidates); transforms; GeoParquet/WKB shapes; label masks traced into outlines in workers; µm-per-unit overrides and estimates; `Coordinate system` and `Image` pickers (`modalities/spatialdata.md`) | None                                             | `66d44de`, `10e3470`, `92defed`            |
| **OME-Zarr images**               | Image-only OME-Zarr URLs, OME-Zarr custom layers, and SpatialData images; Zarr v2/v3; `omero` channels; native RGB detection (`modalities/image.md`)                                                                                                                                                                                             | None                                             | `f9560ee`                                  |
| **Phase 8 shipped**               | `image` platform, NDPI through the TIFF loader, `Geometry` ROI panel, GeoJSON import/export rules, export in micrometres (`image-only-and-geojson.md`, `modalities/image.md`)                                                                                                                                                                    | All Phase 8 items unchecked                      | `f7ff9c5`, `89e99cf`                       |
| **Expression LOD redesign**       | `Auto LOD` loads every cell for datasets up to 500,000 cells; new `All cells` mode; samples keep every expressing cell and thin only non-expressing ones; low-zoom bins removed; DuckDB row join for up to 32 genes (`modalities/xenium.md`, `ui-reference.md`)                                                                                  | Phase 4 design: exact below 5,000, sampled above | `8d21186`, `af73e5d`, `0ed880d`            |
| **Overview rendering on the GPU** | Every cell uploaded once; the GPU draws a fixed-rank sample capped at 75k / 150k / 250k by profile, so panning does not rebuild the layer                                                                                                                                                                                                        | Phase 4: "all viewport-clipped centroids"        | `bf6ebc8`                                  |
| **Visium HD zoom LOD**            | With 2 µm selected below zoom 3, 16 µm bins are shown; gene LOD drops 8 µm to 16 µm at zoom −1.25 or lower; colour-averaged aggregates that cannot be picked                                                                                                                                                                                     | None                                             | `157efdf`, `32d1c47`                       |
| **Visium HD cell profiles**       | Segmented-cell profile: DuckDB query of `barcode_mappings.parquet` for one `cell_id`, then `matrix()` over those bins. Bin→cell expression projection                                                                                                                                                                                            | Mentions only a budgeted hyparquet reader        | `5d53124`, `baac653` (June, unrecorded)    |
| **Image pipeline additions**      | `geotiff` decoders for Deflate, JPEG, LERC, Zstd, WebP; planar TIFF tiles; RGB custom OME-TIFFs; `Channel@Color` read as RGBA; `TileRequestScheduler` keeps in-view tiles loading; custom layers retry http as https                                                                                                                             | LZW and raw only                                 | `94527ce`, `0d67e06`, `3e1a8d5`, `bf6ebc8` |
| **UI features**                   | Distance measurement; µm/px readout and scale bar; `Hover tooltips` toggle; annotation `Import URL`; `Export Annotations`; set-size bars with visibility; ROI `Export GeoJSON`; Fallbacks, Matrix Warning, and Log panels                                                                                                                        | None                                             | various                                    |
| **Shareable URL fields**          | Adds `annotationUrl`, `customImageUrl`/`customImageOpacity`, `lens*`, `nucleusBounds`, `hoverTips`, `measureUnit`, `imgOpacity`, `cellFill`, `cellBoundary`, `channels`, `txBudget`, `txDensity`; dataset-specific values restored only on a matching URL                                                                                        | Phase 5 and 5.1 subsets                          | various                                    |
| **Detection order**               | `.h5ad` → Zarr URL → TIFF URL → `experiment.xenium` → root Zarr metadata → Visium HD tiers. Every probe has a 15 s timeout, and a host that rejects `HEAD` breaks detection                                                                                                                                                                      | Only "detect, then route"                        | —                                          |
| **Cache details**                 | IndexedDB cache: 256 MiB, 20,000 entries, 8 MiB per entry; namespaces `parquet-footer`, `zarr-zip`, `tiff-tile`; SpatialData 256 MiB chunk LRU                                                                                                                                                                                                   | "IndexedDB LRU" only                             | —                                          |
| **App hosting**                   | `deploy-to-s3.md`: build and upload `dist/`, edge headers, production checks                                                                                                                                                                                                                                                                     | Plan covers dataset hosting only                 | —                                          |
| **H5AD reader details**           | Index and gene-name resolution order; CELLxGENE categorical `feature_name` is skipped; CSR rows batched up to 4,000,000 values; `H5adAllGeneCscMatrixUnsupportedError`; at most 6 concurrent reference fetches                                                                                                                                   | None                                             | various                                    |

---

## 2. Plan Says Done, Docs Say Otherwise

These need correcting in one place or the other.

| #   | Plan claim (section)                                                                     | What the docs say                                                                                                                                                            | Code check                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | H5AD DoD `[x]`: continuous `obs` tracks colour cells on a numeric scale (Phase 7)        | Numeric `obs` columns are **not** offered as `Cell color: Metadata` tracks; they appear only as Cell tab values (`modalities/h5ad.md`, `user-guide.md`)                      | **Confirmed.** `metadataTracks()` exists in `h5adDataset.ts:454` and `spatialDataDataset.ts:363`, but nothing in the app calls it |
| 2   | H5AD slice 5 `[x]`: "run HDF5 reads in a worker"                                         | h5wasm for H5AD runs on the main thread; the in-memory backend downloads the whole file first (`architecture.md` Workers, `modalities/h5ad.md`)                              | Consistent with the plan's own open item "move remote HDF5 reads onto a worker". The slice checkbox is wrong                      |
| 3   | H5AD decision `[x]`: boolean `obs` become continuous tracks                              | Boolean columns load as 0/1 with h5wasm but are expected to **fail the load** on the reference backend and in SpatialData tables (found by reading the code; not reproduced) | Not run                                                                                                                           |
| 4   | Visium HD slice 4 `[x]`: flat image falls back from high-res to low-res                  | "No pyramid and no lowres fallback"; `tissue_lowres_image.png` is "probed or diagnosed but never read" (`modalities/visium-hd.md`)                                           | `visiumHdOverview.ts` records the low-res path, but no image reader loads it                                                      |
| 5   | Phase 5 `[x]`: Magic Lens "cursor radius and QV controls"                                | The lens `Min QV` is part of the query key but is not passed to the readers, so it **does not change results** (`modalities/xenium.md`, `ui-reference.md`)                   | —                                                                                                                                 |
| 6   | Phase 5 `[x]`: diagnostics "probe the manifest plus required/optional byte-range assets" | Xenium diagnostics check a **hard-coded** `morphology.ome.tif` instead of the manifest's image, and skip `analysis.zarr.zip`, `gene_panel.json`, the H5 matrix, and the CSVs | **Confirmed.** `datasetDiagnostics.ts:78` uses `path: 'morphology.ome.tif'`                                                       |
| 7   | Phase 6 DoD `[x]`: diagnostics check the Visium HD files that matter                     | The high-res PNG is marked required, segmentation GeoJSON is fetched in full, and `barcodes.tsv.gz` and `features.tsv.gz` are not checked                                    | —                                                                                                                                 |
| 8   | Phase 2: image loading "prefers MIP/focus/full-resolution paths in that order"           | "Only the first morphology image path in the manifest is tried" (`modalities/xenium.md`)                                                                                     | **Confirmed.** `morphologyImage.ts:63` takes `candidates[0]`; the order is MIP then focus, with no retry on failure               |

Partial contradictions (the plan oversells what shipped):

- **Segmentation GeoJSON caching.** The plan says GeoJSON reads are "cached
  repeated reads by bbox". The docs say the GeoJSON "is streamed in full for
  each new viewport", which is listed as a known limitation.
- **Barcode-mapping caching.** The plan says the dataset "caches mapping reads
  by explicit row budget". The docs say reads with an `AbortSignal` are not
  cached, and the app always passes one, so every bin selection re-reads
  `barcode_mappings.parquet` (109.8 MB on the reference dataset).
- **Annotation import on non-Xenium platforms.** The plan enables annotations
  for H5AD. The docs say imported CSV/JSON files must use Xenium-format cell IDs
  (`/^[a-p]{8}-\d+$/`), so files keyed by H5AD or SpatialData obs names are
  rejected.
- **Worker convention.** The plan's rule is "decode and bulk parsing run in Web
  Workers". The docs list hyparquet, zarrita for the Xenium matrix, h5wasm for
  H5AD and the Xenium H5 fallback, and auto-contrast as main-thread work.
- **`XeniumDataset` as the abstraction.** The plan (§4.6) puts Xenium behind
  `XeniumDataset`. The docs say the Xenium load path calls free functions in
  `src/data/`. The viewer's µm/px comes from OME-XML `PhysicalSizeX`; only the
  boundary loader uses the manifest pixel size.
- **"Every error reaches the UI."** A failed GeoJSON import adds only "GeoJSON
  annotation import failed" to the log, without the reason.
- **Persistent cache freshness.** The plan's hosting rules rely on `ETag` and
  immutable paths. The docs say byte-range cache keys omit the ETag, so replacing
  a file at the same URL serves stale bytes until site data is cleared.

---

## 3. In The Plan, Not In The Docs

Planned items with no implementation in the docs. The docs either say "not
read" or say nothing.

| Plan item                                         | Plan status           | Docs                                                                                                                 |
| ------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Standard Visium spots (`VisiumDataset`, `circle`) | Not started           | No mention. **Code:** `'visium'` is still in the `Platform` union (`spatialDataset.ts:13–19`) with no implementation |
| Visium HD annotations from `analysis/`            | Not recorded          | "`annotations()` rejects"; the adapter turns annotations off                                                         |
| Xenium `nucleus_boundaries.parquet` overlay       | No outcome            | "Not read"; nucleus boundaries are Visium HD only                                                                    |
| `metrics_summary.csv` QC display (papaparse)      | No outcome            | "Not read". **Code:** papaparse is not a dependency                                                                  |
| Z-stack plane selector                            | Deferred              | Only the first manifest image; OME-Zarr shows `z = 0` only                                                           |
| H5AD `/layers/*`, `/raw/X`                        | Open                  | "`/uns`, `/layers`, `/raw`, `/varm`, and `/obsp` are not read" (consistent)                                          |
| Transcript estimate from native Zarr counts       | Open                  | Still the sum of overview `transcript_counts` (consistent)                                                           |
| CI (GitHub Actions), deploy previews              | No outcome            | Not mentioned. **Code:** no `.github/` directory                                                                     |
| Golden Xenium fixture bundle                      | No outcome            | Not mentioned; E2E uses hosted datasets                                                                              |
| Coverage reporter and thresholds                  | Open                  | Not mentioned. **Code:** `vitest.config.ts` has no coverage settings                                                 |
| DuckDB ExternalFileCache, property tests          | No outcome            | Not mentioned                                                                                                        |
| Viv `XRLayer`, jsfive                             | Superseded / Deferred | Not mentioned; consistent with the plan                                                                              |

---

## 4. Same Topic, Different Values

| Topic                          | Unified plan                                              | Current docs                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Boundary limit default         | 5,000 (Phase 1), later "set by budget"                    | 2,500 (compact) or 50,000; range 1–100,000                                                                                                   |
| When boundaries load           | Visible cells ≤ limit                                     | Zoom ≥ −0.25 **or** visible cells < limit; requests keyed by bounding box rounded to 50 µm                                                   |
| `Auto LOD` exact threshold     | Below 5,000 visible cells                                 | Every cell when the dataset has ≤ 500,000 cells; otherwise exact at ≤ 50,000 visible, overview sample when > 100,000 visible or zoom ≤ −1.25 |
| `Exact region` above the limit | Waiting state instead of sampling                         | Sampled "the same way" (keeps every expressing cell)                                                                                         |
| Expression detail modes        | `Auto LOD`, `Exact region`                                | Adds `All cells`                                                                                                                             |
| Low-zoom expression marks      | Fixed data-space bins                                     | Each expressing cell drawn (bins removed in `0ed880d`)                                                                                       |
| Overview points                | All viewport-clipped centroids; CPU aggregation off       | GPU fixed-rank sample capped at 75k / 150k / 250k                                                                                            |
| Transcript exact budget        | No number recorded                                        | `Exact budget` 1–1,000,000, default 100,000; at ≥ 80%, `Load exact viewport` is required                                                     |
| Transcript feature filter      | All genes, selected genes, search                         | Default **Selected genes**; options Selected genes and All features                                                                          |
| ROI limits                     | "Samples large ROIs"                                      | 50,000 cells; gene stats from a 32-cell preview then 10,000-cell refinement; transcripts CSV up to 100,000 rows at QV ≥ 20                   |
| ROI transcript export QV       | "QV-filtered"                                             | Fixed QV ≥ 20                                                                                                                                |
| Magic Lens                     | Radius and QV                                             | Radius 10–500 µm, default 80; up to 25,000 cells/bins; 320 ms debounce                                                                       |
| Visium HD 16 µm first paint    | Reads 16 µm positions                                     | Also reads the whole 8 µm positions file to derive the basis                                                                                 |
| Visium HD 2 µm detection       | Do not read the 2 µm positions                            | Still never read, but the file **must exist** for 2 µm to be offered; with only a 2 µm tier the default load fails                           |
| H5AD size gate                 | 300 MB                                                    | 300 MiB (314,572,800 bytes); also switches mid-download when `Content-Length` is missing                                                     |
| H5AD coordinate keys           | `X_spatial`, `spatial`, then embeddings such as `X_umap`  | `X_spatial`, `spatial`, `X_umap`, `umap`, `X_tsne`, `X_tSNE`, `tsne`, `X_pca`; any non-finite value fails the load                           |
| Kerchunk reference URL         | Sibling `DATASET.h5ad.json`                               | Same, and the H5AD URL's query string is carried over (presigned URLs need a matching presigned reference)                                   |
| Gene scales                    | Plasma (default) plus Cividis, Teal, Rose, Glasbey        | Gold, Magma, Viridis, Plasma (default), Cividis, Teal, Rose, Glasbey                                                                         |
| Performance profiles           | Names only                                                | Full table: cores and memory thresholds, caps, tile cache 72/120/180, telemetry 80/120/160                                                   |
| Tile decode workers            | "Lazy and capped"                                         | At most `min(4, hardwareConcurrency)`                                                                                                        |
| COOP/COEP for the app          | Needed only for threaded WASM; non-threaded DuckDB in use | `deploy-to-s3.md` says to serve both headers in production (see [5](#5-inconsistencies-inside-docs))                                         |
| Diagnostics dump               | "Download JSON"                                           | Always named `xenium-diagnostics.json`, on every platform                                                                                    |

---

## 5. Inconsistencies Inside `docs/`

Found while comparing; unrelated to the plan.

1. **SpatialData coordinate-system picker.** `modalities/spatialdata.md` Known
   Limitations says "The coordinate system is chosen automatically; there is no
   picker." The same page, `user-guide.md`, and the code (`sdCs` in
   `shareableState.ts:104`) all have a `Coordinate system` select. _Fixed:_ the
   limitation now says one system and one image are shown at a time, chosen
   automatically, with the Dataset tab selects overriding them.
2. **SpatialData labels.** The same Known Limitations list says "`labels`
   rasters … are not shown", but the page also says labels are traced into cell
   outlines. It probably means label rasters are not drawn as an image layer.
   _Fixed:_ reworded to say labels appear only as traced outlines.
3. **`ui-reference.md` lacks SpatialData controls.** The Dataset tab table has
   no `Coordinate system`, `Image`, or `µm per unit` (`Set` / `Auto`) rows. The
   Shareable URL table has no `sdCs`, `sdImage`, or `sdUm`, although the code
   reads and writes them (`shareableState.ts:104–106`, `417–418`). _Fixed:_
   rows added to the Dataset tab, Platform Availability, and Shareable URL
   tables; `sd*` values follow the matching-dataset restore rule.
4. **OME-Zarr decoding is not on the main thread any more.** `architecture.md`
   lists OME-Zarr tile conversion as main-thread work and leaves
   `zarrDecode.worker.ts` out of the Workers table. `modalities/image.md` says
   chunks are "converted to RGBA on the main thread; no worker". Since `92defed`,
   `omeZarrLoader.ts` and `spatialDataLabels.ts` use `sharedZarrDecodePool()`;
   only chunk fetching stays on the main thread, and decoding falls back to it if
   workers fail. _Fixed_ in both pages: a `zarrDecode.worker.ts` row (≤ 3
   workers), the main-thread list, image constants, source files, and virtual
   tiles.
5. **COOP/COEP.** `deploy-to-s3.md` says to serve `Cross-Origin-Opener-Policy`
   and `Cross-Origin-Embedder-Policy` in production. `s3-cors-playbook.md` says
   to do so only "if cross-origin isolated threaded WASM is enabled later". They
   should agree. _Fixed:_ the code does not depend on cross-origin isolation (no
   `SharedArrayBuffer`; non-threaded DuckDB), and all dataset reads are CORS
   requests. Both pages, and `architecture.md`, now say the headers are
   recommended for parity with dev and preview but not required, and that
   dataset hosts need CORS but not `CORP`.
6. **Planning records pointer.** _Fixed._ `docs/README.md` "Planning Records"
   named `PLAN.md`, `UPDATED_PLAN.md`, and `OPTIMIZATIONS.md`; it now points to
   `UNIFIED_PLAN.md`.
7. **SpatialData diagnostics** (found while fixing the others). Known
   Limitations said diagnostics "do not check the image or table arrays", but
   since `10e3470` Diagnose Dataset sends a `HEAD` for every table chunk and
   checks one image chunk (`datasetDiagnostics.ts`). _Fixed_ in the limitation
   and the source-files table.

---

## 6. Suggested Follow-Ups

1. _Done._ `UNIFIED_PLAN.md` replaces the three source files: they were
   deleted, `PLAN.md` was removed from `.prettierignore`, and `README.md` and
   `docs/README.md` link to the unified plan.
2. _Done._ The plan records shipped work: Phase 8 closed, Phases 9 and 10
   added, and the November LOD and rendering changes recorded.
3. _Half done._ The eight contradictions in
   [section 2](#2-plan-says-done-docs-say-otherwise) are reopened in the plan.
   Fixing the code is still open; H5AD metadata tracks and Xenium diagnostics
   are the most visible to users.
4. _Done._ All documentation inconsistencies in
   [section 5](#5-inconsistencies-inside-docs) are fixed.
