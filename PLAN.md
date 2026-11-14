# Spatial Omics Explorer — Plan

The build plan: scope, working rules, and where each phase stands. The
records are in [`docs/plan/`](docs/plan/):

| File                                             | Contents                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [Architecture decisions](docs/plan/decisions.md) | Decisions 4.1–4.11: stack, state, rendering, data sources, stores, units           |
| [Data contracts](docs/plan/data-contracts.md)    | 5.1–5.7: what each input format must provide                                       |
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

| Track                                                                                     | Scope                                                    | Status                                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| [Phase 1](docs/plan/phases/01-foundation.md)                                              | Foundation and migration                                 | Done                                                         |
| [Phase 2](docs/plan/phases/02-robust-io-caching.md)                                       | Robust I/O, caching, S3 hardening                        | Done; image-path fallback fixed 2026-11-12                   |
| [Phase 3](docs/plan/phases/03-multi-channel-imaging.md)                                   | Multi-channel imaging                                    | Done. JPEG XR **Dropped**; Z-stack done 2026-11-09           |
| [Analysis slice (before Phase 4)](docs/plan/phases/analysis-slice.md)                     | Gene selection, expression highlighting, cell info       | Done                                                         |
| [Phase 4](docs/plan/phases/04-genes-annotations.md)                                       | Genes, gene sets, annotations, ROI, embeddings, HDF5     | Done; expression LOD redesigned in November                  |
| [Phase 5](docs/plan/phases/05-production-polish.md)                                       | Production polish                                        | Done; reopened diagnostics fixed 2026-11-12                  |
| [Feature-fix pass](docs/plan/phases/feature-fix-pass.md)                                  | Correctness before optimization                          | Ongoing; individual fixes recorded                           |
| [Optimization pass](docs/plan/phases/optimization-pass.md)                                | Interaction, memory, fetch/decode concurrency, rendering | Open. November rendering and expression work done            |
| [Phase 5.1](docs/plan/phases/05.1-transcripts.md)                                         | Transcript visualization with LOD                        | Done                                                         |
| [Phase 6](docs/plan/phases/06-visium-hd.md)                                               | Visium HD                                                | MVP done; low-res fallback and diagnostics fixed 2026-11-12  |
| [Structural refactor](docs/plan/engineering.md#application-structure-and-refactor-record) | 14 recommendations from `OPTIMIZATIONS.md`               | All closed by 2026-06-28                                     |
| [Phase 7](docs/plan/phases/07-h5ad.md)                                                    | AnnData H5AD                                             | MVP done; hardening open                                     |
| [Phase 8](docs/plan/phases/08-image-only-geojson.md)                                      | Image-only viewer and GeoJSON annotations                | Done (2026-07-09)                                            |
| [Phase 9](docs/plan/phases/09-ome-zarr.md)                                                | OME-Zarr image pyramids                                  | Done (2026-07-10)                                            |
| [Phase 10](docs/plan/phases/10-spatialdata.md)                                            | SpatialData stores                                       | Done (2026-11-06)                                            |
| [Phase 11](docs/plan/phases/11-dataset-manifest.md)                                       | Dataset manifest (`explorer.json`)                       | Done (2026-11-09)                                            |
| [Phase 12](docs/plan/phases/12-atera.md)                                                  | 10x Atera output                                         | Done, with selected-gene transcripts (2026-11-09)            |
| [Phase 13](docs/plan/phases/13-qptiff.md)                                                 | QPTIFF images                                            | Done (2026-11-09)                                            |
| [Phase 14](docs/plan/phases/14-standard-visium.md)                                        | Standard Visium spots (original Phase 6 `VisiumDataset`) | Done (2026-11-10)                                            |
| [Phase 15](docs/plan/phases/15-interface-redesign.md)                                     | Interface redesign: layout, dark theme, legend, colours  | Done: M1–M5 (2026-11-11) and the 15.5 close-out (2026-11-12) |
| [Phase 16](docs/plan/phases/16-svs.md)                                                    | SVS (Aperio) images                                      | Done (2026-11-13)                                            |
| [Phase 17](docs/plan/phases/17-xenium-nucleus-boundaries.md)                              | Xenium nucleus boundaries                                | Done (2026-11-13)                                            |
| [Phase 18](docs/plan/phases/18-merscope.md)                                               | Vizgen MERSCOPE output                                   | 18-A basic support done (2026-11-14); 18-B images planned    |

## Purpose And Scope

A client-side, browser-based viewer for spatial-omics output. It reads data **as
it comes off the instrument** directly from S3-compatible storage, with no
application server in the data path. deck.gl renders the data, and the browser
parses everything: DuckDB-WASM and hyparquet for Parquet, zarrita for Zarr and
OME-Zarr, h5wasm for HDF5, and geotiff.js plus OpenJPEG-WASM for OME-TIFF and
JPEG-2000 tiles.

The brief started as Xenium-only, with seams for Visium. Scope grew by user
request:

| Platform       | Input                                                          | Planned in                   | Status                                      |
| -------------- | -------------------------------------------------------------- | ---------------------------- | ------------------------------------------- |
| Xenium         | XOA output folder                                              | Phases 1–5.1                 | Done                                        |
| Visium HD      | Space Ranger `outs/` folder                                    | Phase 6                      | MVP done; hardening open                    |
| AnnData H5AD   | Direct `.h5ad` file URL                                        | Phase 7                      | MVP done; hardening open; one item reopened |
| Image-only     | Direct OME-TIFF/TIFF/NDPI URL, plus GeoJSON annotations        | Phase 8                      | Done (2026-07-09)                           |
| QPTIFF image   | Direct Akoya `.qptiff` URL; also custom layers and manifests   | Phase 13                     | Done (2026-11-09)                           |
| SVS image      | Direct Aperio `.svs` URL; also custom layers and manifests     | Phase 16                     | Done (2026-11-13)                           |
| OME-Zarr image | Direct OME-Zarr URL; also custom layers and SpatialData images | Phase 9 (recorded from git)  | Done (2026-07-10)                           |
| SpatialData    | Zarr store root with `spatialdata_attrs`                       | Phase 10 (recorded from git) | Done (2026-10-13 to 2026-11-06)             |
| Visium (spots) | Space Ranger `outs/` folder, or `.h5ad` with `uns/spatial`     | Phase 14 (original Phase 6)  | Done (2026-11-10)                           |
| MERSCOPE       | Vizgen region folder (CSV tables, boundary GeoParquet)         | Phase 18                     | Cells and boundaries done (2026-11-14)      |

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

The SpatialData stores are for manual testing; there is no E2E coverage for them
yet. Two zipped SpatialData stores on the BioImage Archive are also used:

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
