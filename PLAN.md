# Spatial Omics Explorer — Plan

The build plan: scope, working rules, and where each phase stands. The
records are in [`docs/plan/`](docs/plan/):

| File                                             | Contents                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [Architecture decisions](docs/plan/decisions.md) | Decisions 4.1–4.11: stack, state, rendering, data sources, stores, units           |
| [Data contracts](docs/plan/data-contracts.md)    | 5.1–5.8: what each input format must provide                                       |
| [Phases](docs/plan/phases/)                      | One file per phase or track: tasks, product decisions, execution notes, known gaps |
| [Open items](docs/plan/open-items.md)            | Open work across the plan, and what was not pursued                                |
| [Engineering record](docs/plan/engineering.md)   | Refactor record, dataset hosting, testing and CI, tech stack, risks                |
| [History](docs/plan/history.md)                  | How the plan was assembled, the proof of concept, reconciliation notes, source map |
| [Plan vs docs](docs/plan/plan-vs-docs.md)        | The 2026-11-08 comparison of the plan with `docs/`, rechecked 2026-11-13           |

Where records disagree, the later decision is kept and the earlier one is marked
**Superseded**. The [reconciliation notes](docs/plan/history.md#reconciliation-notes)
list every conflict and how it was resolved. For current behaviour, the pages in
`docs/` are authoritative; this plan records intent, decisions, and history.

Until 2026-11-13 the plan was one file, `UNIFIED_PLAN.md`. Decisions and
data contracts keep the section numbers they had there (4.5, 5.3).

Legend: `[x]` done · `[ ]` open · **Deferred** · **Dropped** · **Superseded** ·
**Reopened**

## Status At A Glance

| Track                                                                                     | Scope                                                    | Status                                                           |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| [Phase 1](docs/plan/phases/01-foundation.md)                                              | Foundation and migration                                 | Done                                                             |
| [Phase 2](docs/plan/phases/02-robust-io-caching.md)                                       | Robust I/O, caching, S3 hardening                        | Done; image-path fallback fixed 2026-11-12                       |
| [Phase 3](docs/plan/phases/03-multi-channel-imaging.md)                                   | Multi-channel imaging                                    | Done. JPEG XR **Dropped**; Z-stack done 2026-11-09               |
| [Analysis slice (before Phase 4)](docs/plan/phases/analysis-slice.md)                     | Gene selection, expression highlighting, cell info       | Done                                                             |
| [Phase 4](docs/plan/phases/04-genes-annotations.md)                                       | Genes, gene sets, annotations, ROI, embeddings, HDF5     | Done; expression LOD redesigned in November                      |
| [Phase 5](docs/plan/phases/05-production-polish.md)                                       | Production polish                                        | Done; reopened diagnostics fixed 2026-11-12                      |
| [Feature-fix pass](docs/plan/phases/feature-fix-pass.md)                                  | Correctness before optimization                          | Ongoing; individual fixes recorded                               |
| [Optimization pass](docs/plan/phases/optimization-pass.md)                                | Interaction, memory, fetch/decode concurrency, rendering | Open. November rendering and expression work done                |
| [Phase 5.1](docs/plan/phases/05.1-transcripts.md)                                         | Transcript visualization with LOD                        | Done                                                             |
| [Phase 6](docs/plan/phases/06-visium-hd.md)                                               | Visium HD                                                | MVP done; open items and 2 µm memory closed 2026-11-17           |
| [Structural refactor](docs/plan/engineering.md#application-structure-and-refactor-record) | 14 recommendations from `OPTIMIZATIONS.md`               | All closed by 2026-06-28                                         |
| [Phase 7](docs/plan/phases/07-h5ad.md)                                                    | AnnData H5AD                                             | MVP done; range reads 2026-11-17; hardening open                 |
| [Phase 8](docs/plan/phases/08-image-only-geojson.md)                                      | Image-only viewer and GeoJSON annotations                | Done (2026-07-09)                                                |
| [Phase 9](docs/plan/phases/09-ome-zarr.md)                                                | OME-Zarr image pyramids                                  | Done (2026-07-10); z planes and bioformats2raw 2026-11-14        |
| [Phase 10](docs/plan/phases/10-spatialdata.md)                                            | SpatialData stores                                       | Done (2026-11-06); image no longer waits for shapes 2026-11-18   |
| [Phase 11](docs/plan/phases/11-dataset-manifest.md)                                       | Dataset manifest (`explorer.json`)                       | Done (2026-11-09)                                                |
| [Phase 12](docs/plan/phases/12-atera.md)                                                  | 10x Atera output                                         | Done (2026-11-09); zipped runs 2026-11-18                        |
| [Phase 13](docs/plan/phases/13-qptiff.md)                                                 | QPTIFF images                                            | Done (2026-11-09)                                                |
| [Phase 14](docs/plan/phases/14-standard-visium.md)                                        | Standard Visium spots (original Phase 6 `VisiumDataset`) | Done (2026-11-10)                                                |
| [Phase 15](docs/plan/phases/15-interface-redesign.md)                                     | Interface redesign: layout, dark theme, legend, colours  | Done: M1–M5 (2026-11-11) and the 15.5 close-out (2026-11-12)     |
| [Phase 16](docs/plan/phases/16-svs.md)                                                    | SVS (Aperio) images                                      | Done (2026-11-13); slide images and tile runs 2026-11-17         |
| [Phase 17](docs/plan/phases/17-xenium-nucleus-boundaries.md)                              | Xenium nucleus boundaries                                | Done (2026-11-13); known gaps closed 2026-11-17                  |
| [Phase 18](docs/plan/phases/18-merscope.md)                                               | Vizgen MERSCOPE output                                   | Done: 18-A tables and boundaries, 18-B `.vzg` image (2026-11-14) |
| [Phase 19](docs/plan/phases/19-ndpi.md)                                                   | NDPI (Hamamatsu) images                                  | Done (2026-11-15)                                                |
| [Phase 20](docs/plan/phases/20-dataset-collections.md)                                    | Dataset collections: previews, sections side by side     | Done (2026-11-14 to 2026-11-16)                                  |
| [Phase 21](docs/plan/phases/21-structure-browser.md)                                      | Browse Store and Browse File (Zarr and Parquet)          | Done (2026-11-15 to 2026-11-16)                                  |
| [Phase 22](docs/plan/phases/22-plots-panel.md)                                            | Plots panel: dot plot, violin, group-mean heatmap        | M1–M3 done (2026-11-17)                                          |
| [Phase 23](docs/plan/phases/23-cell-query.md)                                             | Cell query: filter cells, a table with cell pictures     | M1 and M2 done (2026-11-18)                                      |
| [Phase 24](docs/plan/phases/24-section-stack.md)                                          | 3D section stack: registered serial sections in 3D       | Done (2026-11-18)                                                |
| [Phase 25](docs/plan/phases/25-image-channel-conditions.md)                               | Cell query on image channels: mean and % above per cell  | Planned (2026-11-19); decisions await review                     |

**Done** means a phase's tasks shipped. Most phase files also keep a Known
Gaps list whose items stay open; [Open Items](docs/plan/open-items.md)
indexes all of them.

## Purpose And Scope

A client-side, browser-based viewer for spatial-omics output. It reads data **as
it comes off the instrument** directly from S3-compatible storage, with no
application server in the data path. deck.gl renders the data, and the browser
parses everything: DuckDB-WASM and hyparquet for Parquet, zarrita for Zarr and
OME-Zarr, h5wasm for HDF5, and geotiff.js plus OpenJPEG-WASM for OME-TIFF and
JPEG-2000 tiles.

The brief started as Xenium-only, with seams for Visium. Scope grew by user
request:

| Platform       | Input                                                          | Planned in                   | Status                          |
| -------------- | -------------------------------------------------------------- | ---------------------------- | ------------------------------- |
| Xenium         | XOA output folder                                              | Phases 1–5.1                 | Done                            |
| Atera          | 10x Atera Onboard Analysis output folder                       | Phase 12                     | Done (2026-11-09)               |
| Visium HD      | Space Ranger `outs/` folder                                    | Phase 6                      | MVP done; hardening open        |
| AnnData H5AD   | Direct `.h5ad` file URL, or an AnnData Zarr store              | Phase 7                      | MVP done; hardening open        |
| Image-only     | Direct OME-TIFF/TIFF/NDPI URL, plus GeoJSON annotations        | Phase 8                      | Done (2026-07-09)               |
| QPTIFF image   | Direct Akoya `.qptiff` URL; also custom layers and manifests   | Phase 13                     | Done (2026-11-09)               |
| SVS image      | Direct Aperio `.svs` URL; also custom layers and manifests     | Phase 16                     | Done (2026-11-13)               |
| NDPI image     | Direct Hamamatsu `.ndpi` URL; also custom layers and manifests | Phase 19                     | Done (2026-11-15)               |
| OME-Zarr image | Direct OME-Zarr URL; also custom layers and SpatialData images | Phase 9 (recorded from git)  | Done (2026-07-10)               |
| SpatialData    | Zarr store root with `spatialdata_attrs`                       | Phase 10 (recorded from git) | Done (2026-10-13 to 2026-11-06) |
| Visium (spots) | Space Ranger `outs/` folder, or `.h5ad` with `uns/spatial`     | Phase 14 (original Phase 6)  | Done (2026-11-10)               |
| MERSCOPE       | Vizgen region folder (CSV tables, boundary GeoParquet, `.vzg`) | Phase 18                     | Done (2026-11-14)               |
| Collections    | A JSON list of datasets, opened with `collection=`             | Phase 20 (recorded from git) | Done (2026-11-14 to 2026-11-16) |

### Reference Datasets

| Platform              | URL                                                                                                                                              | Notes                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Xenium                | `https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328`                                | Demo dataset; 1,414,155 cells                                                                                                 |
| Visium HD             | `https://mp33.cog.sanger.ac.uk/public/visiumhd/spaceranger401_count_50314_48d90238006ebffe73177a68c2b4f48f`                                      | Space Ranger 4.0.1; 54,504 bins at 16 µm                                                                                      |
| H5AD                  | `https://mp33.cog.sanger.ac.uk/public/h5ad/pbmc3k.h5ad`                                                                                          | 32,080,465 bytes; Range and CORS enabled                                                                                      |
| SpatialData (shapes)  | `https://webatlasdataprod.cog.sanger.ac.uk/public/visium_associated_xenium_io/a5652917-ebb4-4d4c-ba90-6e8845c6f370.sdata.zarr`                   | Visium CytAssist, Zarr v2; 4,992 circle spots; H&E images; consolidated metadata at `zmetadata`                               |
| SpatialData (labels)  | `https://cellgeni.cog.sanger.ac.uk/vento/reproductivecellatlas/ovaries/spatialdata_xenium/AU14_S14_final.zarr`                                   | spatialdata-io Xenium; table annotates `labels/xenium_segmentations`; 73,579 cells × 480 genes; true scale 0.2125 µm per unit |
| Atera                 | `https://mp33.cog.sanger.ac.uk/public/test/50170325_WSI_KID_04_region1/50170325_WSI_KID_04_region1`                                              | Human WTA kidney; 93,864 cells × 24,674 features (18,050 genes); 4 morphology channels; 667 M transcripts                     |
| Visium (H5AD)         | `https://cellxgene-census-public-us-west-2.s3.us-west-2.amazonaws.com/cell-census/2025-11-08/h5ads/60d5175f-f477-48b2-8396-ad76be2c3310.h5ad`    | CELLxGENE Census copy of GEO GSM6592057 (Visium v1); 8.9 MB; 370 spots under tissue of 4,992; 0.3236 µm/px from the spot grid |
| Visium (Space Ranger) | `https://ftp.ncbi.nlm.nih.gov/geo/samples/GSM6592nnn/GSM6592057/suppl/` through a manifest ([example](docs/dataset-manifest.md#standard-visium)) | The same sample's GEO files, gzipped; same spots and scale as the H5AD                                                        |
| MERSCOPE (vpt Baysor) | `examples/bia/S-BIAD2376.json` (BIA S-BIAD2376 D082 region 0)                                                                                    | 3,003 cells × 499 genes; boundaries 0.8 MB; CC BY 4.0                                                                         |
| AnnData Zarr          | `https://hindlimb.cog.sanger.ac.uk/datasets/20230412_multimodal/integrated/0.0.1/hindlimb-scrnaseq-integrated-anndata.zarr`                      | Zarr v2 without consolidated metadata; 125,955 cells; dense `/X` chunked by gene, so cell profiles are refused                |
| Collection            | `docs/collections/spcox.json`                                                                                                                    | 18 SPCOX Xenium sections (AnnData Zarr, each with an OME-Zarr image and label mask) and their snRNA-seq atlas; no licence     |

The nightly examples run loads the SpatialData (shapes) store through its
gallery manifest. The labels store, and the two zipped stores on the BioImage
Archive below, are tested by hand, and no smoke test covers SpatialData:

- `https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/898/S-BIAD2898/Files/460-plex/output-XETG00055__0027377__AT6-BRA-3-FO-4-S52-ii__20241031__140902_coarse.zarr.zip`:
  Xenium 460-plex, Zarr v3; 598,222 cells × 460 genes; `cell_boundaries`
  polygons (97 MB, stored); true scale 0.2125 µm per unit.
- `https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/146/S-BIAD2146/Files/STHELAR/sdata_slides/sdata_bone_marrow_s0.zarr.zip`:
  STHELAR bone marrow, Zarr v2 with no root `.zattrs`; 225,906 cells × 477
  genes; scanpy `rank_genes_groups` record arrays in `uns`; a flipped H&E
  image.

## Working Rules

### How To Use This Document

- This plan, this file and the records in `docs/plan/`, is the source of truth
  for scope and sequencing. Work phase by phase. Do not start a phase until the previous phase's definition of done is
  met, unless the user explicitly changes the order. The user did this twice:
  to pull the first gene-expression slice ahead of Phase 4, and to start Phase 3
  without JPEG XR and Z-stack.
- Each task is a checkbox and a small, reviewable PR.
- **DECISION** marks a default that has already been chosen. Deviate only on a
  concrete blocker, and record why in the PR.
- Where the POC already solves something, port and harden it. Do not
  reimplement it.
- Prefer small, pure, unit-tested modules over large stateful files.
- **Current sequence (2026-06-07):** fix existing functionality first, then
  optimize. The correctness pass needed before Phase 5.1 is closed. The broader
  optimization pass is still open.
- Phases 9 and 10 and the November 2026 rendering work were not planned in
  advance. They are recorded from commits, and their task lists describe what
  shipped.
- When a feature ships, update its phase file, its row in
  [Status At A Glance](#status-at-a-glance), and the matching page in `docs/`,
  in the same PR.
- A new phase gets a file in `docs/plan/phases/`, named `NN-slug.md`, and a row
  in the status table. It takes the next free number when its PR merges, not
  when the branch starts. Two branches that both add Phase N clash on that row,
  and the one that merges second renumbers.
- [Open Items](docs/plan/open-items.md) lists open work only. When an item
  closes, move it under Closed Open Items in its phase or track file.
- Working rules say what to do. Dated progress goes in the phase or track file.
- Code comments cite the plan by ID, not by file: `plan 15.2-A` is task A of
  15.2 in Phase 15's file, and `plan 15, D5` is decision D5 in that file.

### Conventions For Every Task

- **TypeScript in strict mode, with zero `any` in the data layer.** Model Arrow
  `bigint` vs `number`, cell-ID string vs integer pair, and µm vs px as distinct
  (branded) types, so the compiler catches conversions.
- **One coordinate module.** All screen↔data, µm↔px, and tile-bounds maths lives
  in `coords.ts`. It reads a `units` descriptor from the dataset.
- **Heavy data stays out of the global store.** The store holds descriptors,
  selection geometry, gene picks, view state, and UI flags. Arrow tables, typed
  arrays, and `ImageBitmap`s live in modules or caches, referenced by ID.
- **Decode and bulk parsing run in Web Workers.** The main thread schedules and
  draws. Transfer `ArrayBuffer`s and `ImageBitmap`s instead of copying them.
  The known exceptions are an [open item](docs/plan/open-items.md), and the
  moves so far are recorded in the
  [optimization pass](docs/plan/phases/optimization-pass.md#worker-moves-2026-11-13).
- **Every error reaches the UI.** No silent `console.warn`. A failed fetch, a
  403, a decode error, or a corrupt Zarr must be shown to the user.
- **Tests go in the same PR as the code.** A module without tests is not done.
- **Pin dependency versions.** No CDN `<script>` tags in the app bundle.

### Refactor Rules (2026-06-07)

- Shrink `App.tsx` by extracting coherent feature or domain boundaries, not by
  line count. `App.tsx` stays the orchestration root.
- Do not move state into Zustand just to make `App.tsx` shorter.
- Do not combine a refactor with behaviour changes. Keep product behaviour and UI
  copy unless a task explicitly asks for a change.
- No generic catch-all hooks such as `useAppState`.
- Avoid components with very large prop bags. Extract a view/model boundary
  together with the component, or leave the section in `App.tsx`.

### Global Definition Of Done

A task or phase is done when the code is typed and lint-clean, its unit and
integration tests pass in CI, it works against the demo dataset, and the phase's
exit criteria have not regressed. In practice, each phase closed after
`npm test`, `npm run build`, `npm run typecheck`, `npm run lint`, and
`npm run test:e2e` passed.

### Skills

| Skill                         | Use for                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `frontend-design`             | Building or styling any UI: components, panels, controls, layout. Primary skill for Phases 1, 3, 4, and 5   |
| `vercel-react-best-practices` | Writing React code                                                                                          |
| `vercel-composition-patterns` | Shaping reusable React components                                                                           |
| `web-design-guidelines`       | UI review. Source: <https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md> |

If the environment auto-discovers `SKILL.md` files, read the relevant one before
writing UI code.

### Required Competencies

1. Strict TypeScript and Vite, including WASM asset handling and dev-server
   COOP/COEP headers.
2. deck.gl and WebGL: `OrthographicView`, `ScatterplotLayer`, `PolygonLayer`,
   custom layers, `updateTriggers`, and picking.
3. DuckDB SQL over HTTP: predicate pushdown, Parquet row-group statistics, the
   `spatial` extension (`ST_Within`, `ST_Point`, `ST_GeomFromText`), and
   duckdb-wasm specifics (web filesystem, `enable_http_metadata_cache`).
4. Columnar and array formats: Parquet internals, Zarr (chunking, CSC/CSR
   sparse layouts, `.zarr.zip` over Range), and the 10x HDF5 feature-barcode
   matrix.
5. Bioimage formats: OME-TIFF (IFD/SubIFD pyramids, `TileOffsets`,
   `TileByteCounts`, OME-XML) and 16-bit JPEG-2000.
6. Web Workers and performance: worker pools, transferables, `AbortController`,
   persistent caches, LRU eviction, and memory budgets.
7. Spatial-omics domain knowledge: Xenium, Visium HD, and AnnData output
   contracts; microns vs pixels; cells vs spots vs bins; QV filtering; genes vs
   control probes; clustering and UMAP outputs.
8. Testing: Vitest, Playwright, and golden-data fixtures.
