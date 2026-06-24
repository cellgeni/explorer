# Xenium Spatial Transcriptomics Visualizer — Production Plan (Agent Brief)

A client-side, browser-based viewer for 10x Xenium output (Visium later), reading
data **as it comes off the instrument** directly from S3-compatible storage, with
no application server in the data path. Rendering via deck.gl; all parsing done in
the browser (DuckDB-WASM for Parquet, zarrita for Zarr, h5wasm/jsfive for HDF5,
OpenJPEG-WASM for JPEG-2000 image tiles).

A working proof-of-concept exists (vanilla JS + CDN deck.gl) in `old` folder.
It has de-risked the hard problems; this brief turns it into a typed, tested,
production app and lays the seams for Visium support later.

---

## How to use this document (for the executing agent)

- This is the source of truth for scope and sequencing. Work **phase by phase,
  top to bottom**. Do not start a phase until the previous phase's *Definition of
  done* is met.
- Each task is a checkbox. Treat each as a small, reviewable PR.
- When a decision is marked **DECISION**, the default is already chosen; only
  deviate if you find a concrete blocker, and record why in the PR description.
- Where the POC already solves something (§0), **port and harden it — do not
  reimplement from scratch.** The original POC files (`main.js`, `gex.js`,
  `quack.js`, `tiff-loader.js`, `tile-cache.js`, `j2k-decoder.js`,
  `index.html`) are the reference implementation.
- Prefer small, pure, unit-tested modules over large stateful files. The POC's
  single-file global-state design is explicitly what we are moving away from.

### Working conventions (apply to every task)

- **TypeScript, strict mode. Zero `any` in the data layer.** Model Arrow
  `bigint` vs `number`, cell-ID string vs int pair, and µm vs px as distinct
  types/branded types so the compiler catches conversions.
- **One coordinate module.** All `screen↔data`, `µm↔px`, and tile-bounds math
  lives in `coords.ts` and nowhere else. It reads a `units` descriptor from the
  dataset so it works for both Xenium (µm, origin top-left, Y-down image space)
  and, later, Visium (full-res pixels + scalefactors).
- **Heavy data stays out of the global store.** The store holds descriptors,
  selection geometry, gene picks, view state, UI flags. Arrow tables, typed
  arrays, and `ImageBitmap`s live in modules/caches referenced by id.
- **All decode and bulk parsing run in Web Workers.** The main thread schedules
  and draws only. Transfer `ArrayBuffer`/`ImageBitmap`, don't copy.
- **Every error is surfaced to the UI.** No silent `console.warn` swallowing —
  failed fetch, 403, decode error, corrupt Zarr must reach the user.
- **Tests accompany the code in the same PR.** A module without tests is not done.
- **Pin dependency versions.** No CDN `<script>` tags in the app bundle.

### Definition of done (global)

A task/phase is done when: code is typed and lint-clean; unit/integration tests
for it pass in CI; it works against the demo dataset
(`https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328`);
and no regression in the phase's stated exit criteria.

---

## Skills & capabilities required to develop this

### Agent Skills (use if available in the environment)

- **`frontend-design`** — directly applicable. Invoke it whenever building or
  styling any web UI, React component, panel, control, or layout. It encodes the
  design tokens and styling constraints for this environment and prevents generic
  output. This is the primary skill for Phases 1, 3, 4, and 5.

If the agent runs under a system that auto-discovers `SKILL.md` files, it should
scan for and read the relevant one before writing UI code or producing any file,
per that system's rules.

### Technical competencies the agent must apply (skills in the human sense)

These are not optional; the project cannot be built without working knowledge of:

1. **TypeScript (strict)** and modern build tooling (**Vite**), including WASM
   asset handling and dev-server header config (COOP/COEP).
2. **deck.gl / WebGL** — `OrthographicView`, `ScatterplotLayer`, `PolygonLayer`,
   custom layers, `updateTriggers`, picking, and (Phase 3) Viv's `XRLayer` for
   multi-channel blending.
3. **DuckDB SQL over HTTP** — predicate pushdown, Parquet row-group statistics,
   the `spatial` extension (`ST_Within`, `ST_Point`, `ST_GeomFromText`), and
   duckdb-wasm specifics (integrated web filesystem, `enable_http_metadata_cache`).
4. **Columnar/array formats** — Parquet internals (row groups, footer, column
   chunks), Zarr (chunking, CSC/CSR sparse layout, `.zarr.zip` ZipFileStore over
   Range), and the 10x HDF5 feature-barcode matrix (via **h5wasm**; **jsfive**
   fallback).
5. **Bioimage formats** — OME-TIFF (IFD/SubIFD pyramids, `TileOffsets`/
   `TileByteCounts`, OME-XML), **JPEG-2000** decode (16-bit grayscale), and
   **JPEG XR** (harder; see risk in Phase 3).
6. **Web Workers & performance** — worker pools, transferables, `AbortController`
   cancellation, OPFS/IndexedDB caching, LRU eviction, memory budgeting.
7. **Spatial-omics domain literacy** — Xenium/Visium output contracts,
   microns-vs-pixels, cell segmentation vs spots/bins, QV filtering, gene vs
   control-probe features, clustering/UMAP outputs.
8. **Testing** — Vitest (unit/integration), Playwright (E2E), golden-data
   fixtures.

---

## 0. Where the POC already gets you

The prototype has already de-risked the hardest problems. Port and harden; do not
rebuild from scratch.

**Already proven:**

- **Spatial Parquet querying** via DuckDB-WASM (`spatial` extension). The
  bbox-prefilter-then-exact-test pattern in `selectionToSQL` — avoiding
  `ST_DWithin` so Parquet row-group statistics still prune — is the correct,
  non-obvious trick. Keep it.
- **Per-cell gene expression** from `transcripts.parquet` (spatial + cells-only
  scopes) and `cell_feature_matrix.zarr.zip` (CSC per-cell slicing), unified
  behind one return shape in `gex.js`. The Xenium cell-ID integer↔shifted-hex
  codec (`intToCellId`/`cellIdToInt`) is correct and easy to get wrong — keep it
  verbatim and put it under test.
  *(Note: the POC's third source, `transcripts.zarr.zip`, is being dropped — see
  §1.7.)*
- **16-bit JPEG-2000 OME-TIFF tiling** via geotiff.js (IFD/SubIFD parse) + HTTP
  Range fetch of raw tile bytes + OpenJPEG-WASM decode + percentile windowing.
  Necessary because **Viv/geotiff.js cannot decode JPEG-2000 for >8-bit data**,
  and Xenium morphology is 16-bit grayscale JPEG-2000. The custom path is the
  right call, not reinvention.
- **Cluster annotations** from `analysis.zarr.zip` (`cell_groups` CSR indptr/
  indices mapped through `file_row_number` order).
- **Remote-first loading** from a public HTTPS bundle URL with streamed progress.

**Missing for production** (the rest of this document):

1. Single-file global-state design → untestable, hard to extend to Visium.
2. Image decode on the **main thread** → pan/zoom jank.
3. deck.gl from a **CDN script** → unbundled/unversioned.
4. **httpfs used inconsistently** — boundaries fully downloaded, no metadata
   cache (see §1.3 / Phase 2).
5. **JPEG XR** not handled; **multi-channel** morphology not handled.
6. No HDF5 path (`cell_feature_matrix.h5`).
7. No gene-set scoring, annotation import, or shareable view state.
8. No tests, CI, error boundaries, S3/CORS hardening, or persistent caching.

---

## 1. Architecture decisions

### 1.1 React + TypeScript — **DECISION: yes**

The POC's global-state model already strains. React's component model plus a small
store keeps growing UI (gene sets, annotations, Visium mode, multi-channel
controls) sane; TypeScript catches the bug class that bites here. deck.gl is
framework-agnostic — keep the imperative deck.gl/canvas core and wrap only the
chrome (panels, controls) in React. The non-negotiable part is TypeScript +
modules; React is the recommended default.

### 1.2 State — **DECISION: Zustand**

Tiny, no boilerplate, usable outside React so the deck.gl loop reads/writes the
same store. Heavy data stays out of it (see conventions).

### 1.3 Parquet engine — **DECISION: DuckDB-WASM primary, hyparquet first-paint**

Access patterns (`ST_Within` polygons, bbox range predicates with row-group
skipping, cells↔boundaries joins) need a real engine. Cost: ~40 MB WASM + seconds
of init. Mitigate with **hyparquet (~10 KB)** to read `cells.parquet` centroids
(column projection + Range) for a sub-second overview scatter while DuckDB
initializes lazily in the background (first real spatial query triggers init).

**httpfs must be used correctly (the POC does not):**

- `LOAD httpfs` is **redundant** in duckdb-wasm — the integrated web filesystem
  already does HTTP Range reads. Keep `LOAD spatial` (needed for `ST_*`). Don't
  rely on `LOAD httpfs` for S3 auth semantics.
- **Range-read `cell_boundaries.parquet`** with the same bbox pattern as
  transcripts. The POC fully downloads it via `registerFileBuffer`, which on a
  large slide pulls hundreds of MB when only the viewport is drawn. Buffer only
  truly small files (`cells.parquet` is fine to buffer).
- **`SET enable_http_metadata_cache=true` at boot** (verify support in the wasm
  bundle). Without it, the Parquet footer + a HEAD request are re-fetched on
  *every* viewport/magic-lens query. Also evaluate the ExternalFileCache (RAM
  block cache) in current DuckDB.
- Keep row groups reasonably sized in any data you control so bbox pruning
  fetches few chunks (mitigates the known "HTTP waterfall").

### 1.4 Image layer — **DECISION: custom J2K path; Viv layers for blending only**

Keep the custom J2K tile pipeline for 16-bit Xenium morphology (Viv can't decode
it). Adopt **Viv's `XRLayer`/`MultiscaleImageLayer` for multi-channel compositing
math** (Phase 3), fed already-decoded tiles from the OpenJPEG worker. Reassess
only if 10x ships pyramids Viv loads natively.

### 1.5 Rendering — **DECISION: dual-canvas, fix threading**

deck.gl (Orthographic) for points/polygons; Canvas2D underlay for image tiles.
**Move all decode + heavy parsing into a Web Worker pool** (transferables). Main
thread schedules and draws only. Biggest single UX win.

### 1.6 Data-source abstraction — **capability-based** (this is what makes Visium a drop-in)

Do **not** assume every dataset has every modality. Visium has **no per-molecule
transcripts**, **no pyramidal OME-TIFF** (flat PNG + scalefactors instead), and a
**different renderable unit** (spots/bins, not segmented cells). So the interface
exposes capabilities and tags geometry; it does not hardcode "this is Xenium."

```ts
type Platform = 'xenium' | 'visium' | 'visium-hd';
type ElementGeometry =
  | { kind: 'polygon'; rings: number[][][] }            // Xenium cells
  | { kind: 'circle';  center: [number, number]; diameter: number }  // Visium spots
  | { kind: 'square';  origin: [number, number]; size: number };     // Visium HD bins

interface DatasetMeta {
  platform: Platform;
  units: UnitsDescriptor;        // µm + origin (Xenium) | px + scalefactors (Visium)
  extent: BBox;
  capabilities: {
    transcripts: boolean;        // single-molecule data present?
    cellBoundaries: boolean;     // segmentation polygons present?
    pyramidImage: boolean;       // tiled OME-TIFF vs flat image?
    multiChannel: boolean;
  };
  channels?: ChannelInfo[];
}

interface SpatialDataset {
  meta(): Promise<DatasetMeta>;
  elements(bbox: BBox): Promise<ElementBatch>;     // geometry-tagged: cell | spot | bin
  matrix(ids: string[]): Promise<GexResult>;       // feature-barcode — BOTH platforms
  annotations(): Promise<Annotation[]>;            // clusters, UMAP, custom labels
  image(): Promise<ImageSource | null>;            // union: pyramid | flat+scalefactor
  // Capability-gated. Absent on Visium — UI hides transcript-scope + magic lens.
  transcripts?(sel: Selection, scope: TranscriptScope, minQv: number): Promise<GexResult>;
}

type ImageSource =
  | { kind: 'pyramid'; loader: TiffPyramidLoader }                 // Xenium
  | { kind: 'flat';    url: string; scaleFactor: number; size: [number, number] }; // Visium
```

Rules the implementation must follow:

- The **renderer picks the layer from `elements()` geometry**, not from platform:
  `polygon → PolygonLayer`, `circle → ScatterplotLayer`, `square → a grid/square
  layer`.
- The **image component branches on `ImageSource.kind`**.
- `transcripts` is **optional**; gate transcript-scope and magic-lens UI on
  `capabilities.transcripts`.
- `coords.ts` reads `meta().units`; no platform conditionals leak elsewhere.

Implement `XeniumDataset` first (wrap the existing `gex.js`/loaders behind this).
`VisiumDataset` / `VisiumHDDataset` are later additions — no UI rewrite.

### 1.7 Transcript source — **DECISION: drop `transcripts.zarr.zip`**

`transcripts.parquet` contains everything needed and is strictly better: it
carries `cell_id` (the zarr has **no cell assignment** — the POC returns a
synthetic `"region"` pseudo-cell). Delete `gexFromTranscriptsZarr` (the most
complex, least useful source). The zarr's only unique asset is its `density/`
grids (precomputed per-gene spatial density bins) — note them as an **optional
later accelerator** for whole-slide low-zoom gene coloring (Phase 4), reproducible
via DuckDB binning if needed.

---

## 2. The Xenium output contract (read as-is; never require preprocessing)

Reference: 10x "Understanding Xenium Outputs" (XOA).

| File | Reader | Use |
|---|---|---|
| `experiment.xenium` | `fetch` JSON | panel, chemistry, pixel size (0.2125 µm), software version, **file manifest** |
| `cells.parquet` | hyparquet (first paint) / DuckDB | centroids, `cell_area`, `nucleus_area`, `transcript_counts`, `file_row_number` |
| `cell_boundaries.parquet` | DuckDB **(httpfs Range)** | polygon vertices per `cell_id` |
| `nucleus_boundaries.parquet` | DuckDB | nucleus polygons (optional overlay) |
| `transcripts.parquet` | DuckDB **(httpfs Range)** | per-transcript `cell_id`, `feature_name`, `x/y/z_location`, `qv`, `overlaps_nucleus`, `is_gene` |
| `cell_feature_matrix.zarr.zip` | zarrita | per-cell sparse counts (CSC) |
| `cell_feature_matrix.h5` | **h5wasm** | same matrix, HDF5 alternative |
| `analysis.zarr.zip` | zarrita | clustering, UMAP/tSNE, DE |
| `gene_panel.json` | `fetch` JSON | full target list (drives gene picker before any selection) |
| `morphology_focus/morphology_focus_000N.ome.tif` | geotiff + OpenJPEG | **multi-channel** focus images |
| `morphology_mip.ome.tif` / `morphology.ome.tif` | geotiff + OpenJPEG | DAPI MIP / Z-stack |
| `metrics_summary.csv` | papaparse | QC display |
| ~~`transcripts.zarr.zip`~~ | — | **dropped** (see §1.7); `density/` is an optional later accelerator |

**Gotchas to encode once:**

- **Coordinates:** µm; image origin top-left, Y-down (px = µm / 0.2125). deck.gl
  `OrthographicView flipY:false` is Y-up → Y negated. All conversions in
  `coords.ts`.
- **Cell IDs:** Parquet = shifted-hex string; matrix Zarr = `[prefix, suffix]`
  uint32. Codec must round-trip — unit-test against a real pair.
- **Scope:** `cells-only` vs `spatial` differ by design (extracellular
  transcripts). Keep both, label clearly.
- **Features:** filter `NegControlProbe`, `NegControlCodeword`, `BLANK`,
  `UnassignedCodeword`, `antisense`, `Deprecated` from "genes"; keep for QC.
- **Sizing:** buffer `cells.parquet`; **Range-read** `cell_boundaries.parquet`
  and `transcripts.parquet`.

---

## 3. Phased delivery plan

### Phase 1 — Foundation & migration

Goal: POC parity, but typed, modular, bundled, with off-main-thread decode.

- [ ] `npm create vite@latest` → React + TypeScript. Add ESLint, Prettier,
      Vitest, Playwright.
- [ ] Bundle deck.gl (`deck.gl`, `@deck.gl/core`, `@deck.gl/layers`); remove the
      unpkg `<script>`.
- [ ] `vite.config.ts`: `optimizeDeps.exclude` WASM packages;
      `assetsInclude: ['**/*.wasm']`; dev server COOP/COEP headers (for any COI/
      threaded WASM).
- [ ] Port with types + tests: `coords.ts`, `cellid.ts`, `duckdb.ts` (was
      `quack.js`, with `enable_http_metadata_cache` + no reliance on `LOAD
      httpfs`), `gex.ts` (parquet + CFM zarr only; **delete zarr-transcripts**),
      `tiff/loader.ts`, `tiff/tileCache.ts`, `codecs/jpeg2000.ts`.
- [ ] Define `SpatialDataset` (§1.6); implement `XeniumDataset`.
- [ ] **Worker pool**: J2K decode + windowing in workers (transfer
      `ImageBitmap`). DuckDB in its own worker.
- [ ] Zustand store; React chrome around the deck.gl/canvas core.
- [ ] hyparquet first-paint scatter from `cells.parquet`.

**Definition of done:** feature parity with POC; 60fps pan/zoom with image on;
zero `any` in data layer; deck.gl pinned; `cellid`/`coords`/`gex` unit-tested;
runs against the demo dataset.

### Phase 2 — Robust I/O, caching, S3 hardening

- [ ] S3/CORS playbook (§4); fail loudly if Range unsupported.
- [ ] Range-read `cell_boundaries.parquet` (remove full-download path).
- [ ] OPFS/IndexedDB cache for tiles + Parquet footers; persist the LRU.
- [ ] `AbortController` cancellation per viewport version (extend existing
      versioning to all fetches).
- [ ] Read `experiment.xenium` manifest to know which files exist (replace
      HEAD-guessing in `loadMorphologyImage`).
- [ ] Structured error states surfaced to UI.

**Definition of done:** multi-GB dataset loads from a real S3 bucket; warm second
visit; graceful degradation on flaky network; boundaries never fully downloaded.

### Phase 3 — Imaging: multi-channel + JPEG XR

- [ ] Parse multi-file `morphology_focus_000N.ome.tif` channel set from OME-XML;
      per-channel name/color/contrast.
- [ ] Multi-channel compositing via Viv `XRLayer` (or custom shader) fed decoded
      tiles; per-channel color + min/max + on/off.
- [ ] Z-stack plane selector for `morphology.ome.tif`.
- [ ] Per-channel histogram + auto-contrast.

**Definition of done:** DAPI + boundary + interior composited with independent
controls.

### Phase 4 — Genes, gene sets, annotations

- [ ] Gene picker backed by full `gene_panel.json` (pick before drawing).
- [ ] Whole-slide expression coloring with level-of-detail (density bins low
      zoom, per-cell high zoom). *(Optional accelerator: `transcripts.zarr.zip`
      `density/` grids — see §1.7.)*
- [ ] **Gene sets**: import/paste symbol lists; score cells by sum/mean/z-scored
      signature; color by score; save named sets.
- [ ] **Annotation import**: join user CSV/Parquet `cell_id → label`; color/filter.
- [ ] **ROI annotations**: name/save/reload drawn regions; export `cell_id`s +
      per-cell GEX (extend existing CSV export).
- [ ] UMAP/tSNE panel from `analysis.zarr.zip` with linked brushing.
- [ ] **HDF5 path**: read `cell_feature_matrix.h5` via h5wasm as a `matrix`
      backend (jsfive fallback).

**Definition of done:** pick a marker panel, score a signature, import cell-type
labels, export an ROI's expression — all client-side.

### Phase 5 — Production polish

- [ ] Shareable state in URL hash (dataset URL + view + selection + gene picks).
- [ ] Adaptive performance budget (point cap by device, inflight limits, memory
      ceiling with eviction telemetry).
- [ ] Accessibility, responsive layout, keyboard canvas nav.
- [ ] Error boundaries + "diagnose dataset" diagnostic dump.
- [ ] Privacy-respecting telemetry (load times, failures).
- [ ] User guide + "host your own data" (S3 playbook) docs.

### Phase 5.1 — Transcript display LOD spike

Goal: make raw Xenium transcripts explorable without overwhelming low-zoom views
or the browser. Complete feature-fixing first, then optimization, then use this
phase to prove the transcript display strategy before Visium work resumes.

- [ ] Spike a transcript-rendering source over `transcripts.parquet` using
      DuckDB/Range bbox predicates, QV filtering, optional feature/gene filters,
      and `capabilities.transcripts` gating.
- [ ] At whole-slide and low zoom, show transcripts as aggregated marks, using
      clustered cell-level summaries or high-level FOV/tile buckets rather than
      raw molecule points.
- [ ] At medium zoom, preserve the aggregation strategy with stable data-space
      bins/FOV groups, feature colors, and count summaries so panning does not
      reshuffle marks.
- [ ] At close zoom, switch to exact visible transcripts and render all matching
      molecules as points with picking/hover metadata.
- [ ] Keep transcript queries abortable, viewport-versioned, and bounded by the
      adaptive performance budget; no full-file transcript scans on the main
      thread.
- [ ] Validate interactions with Magic Lens, ROI transcript export, selected gene
      overlays, annotations, and URL/shareable state.

**Definition of done:** low zoom shows useful transcript density/aggregation;
close zoom shows every visible transcript point; switching between levels is
stable, cancelable, and verified against the demo dataset without regressing
existing ROI or Magic Lens transcript workflows.

### Phase 6 — Visium (separate track; enabled by §1.6)

Space Ranger outputs differ structurally — the capability-based interface absorbs
this with no UI changes:

- [ ] `VisiumDataset` / `VisiumHDDataset` implementing `SpatialDataset`:
  - `spatial/tissue_positions.csv` (HD: `tissue_positions.parquet`) →
    `elements()` as `circle` (spots) or `square` (HD bins).
  - `spatial/scalefactors_json.json` + `tissue_hires_image.png` /
    `tissue_lowres_image.png` → `image()` as `{ kind: 'flat', scaleFactor }`
    (no OME-TIFF, no tiling).
  - `filtered_feature_bc_matrix.h5` → `matrix()` via the **same h5wasm path**
    built in Phase 4.
  - `analysis/` → `annotations()`.
  - `capabilities.transcripts = false`, `pyramidImage = false`.
- [ ] Spot/square render layer (reuse Phase 1 layer-from-geometry routing).
- [ ] Visium HD `binned_outputs/` resolution switcher (2/8/16 µm).

**Definition of done:** a Visium dataset renders spots over its tissue image with
gene coloring, gene sets, annotations, and ROI export — reusing the Xenium UI
unchanged.

---

## 4. S3-compatible hosting playbook (do this or nothing loads)

The architecture depends on cross-origin **HTTP Range requests**.

- **CORS:** allow `GET, HEAD`; allow request header `Range`; **expose** response
  headers `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`. Restrict
  `AllowedOrigin` to your domain(s) in production.
- **Verify Range:** `curl -r 0-99 -I https://bucket/.../transcripts.parquet` →
  expect `206` + `Content-Range`. DuckDB also issues a **HEAD per file handle**
  for size — keep HEAD allowed and fast (metadata cache reduces repeats).
- **Zarr `.zip`:** `ZipFileStore.fromUrl` Range-reads the central directory then
  member offsets — Range required. Offer unzipped `.zarr/` too (avoids
  central-directory seeks).
- **No transfer compression** (`Content-Encoding`) on Parquet/Zarr/TIFF — already
  compressed, and gzip breaks Range math.
- **Caching:** long `Cache-Control` + `ETag`; immutable dataset paths.
- **HTTP/2 or HTTP/3** on the CDN — many small Range/chunk requests benefit from
  multiplexing.
- **Cross-origin isolation:** if using a threaded/COI DuckDB bundle or
  SharedArrayBuffer workers, the **site** must send `COOP: same-origin` +
  `COEP: require-corp`, and cross-origin assets `CORP: cross-origin`. Decide
  early — COI enables threading but complicates embedding.

---

## 5. Testing & CI

- **Unit (Vitest):** cell-ID codec round-trip; coordinate conversions; CSC
  slicing; `selectionToSQL`; gene/control filtering; percentile windowing.
- **Golden fixtures:** a tiny synthetic Xenium-shaped bundle (few cells, one
  tile) committed to the repo for offline, deterministic tests.
- **Integration:** duckdb-wasm query vs fixture Parquet; zarrita read vs fixture
  `.zarr.zip`; J2K decode of a known tile → pixel checksum.
- **E2E (Playwright):** load demo → draw circle → assert cell count + top gene;
  toggle image; apply cluster colors.
- **CI (GitHub Actions):** typecheck, lint, unit+integration per PR; build;
  deploy preview; cache WASM artifacts.

---

## 6. Tech stack summary

| Concern | Choice | Note |
|---|---|---|
| Build | Vite + TypeScript (strict) | exclude WASM from optimizeDeps; include `**/*.wasm` |
| UI | React + Zustand | heavy data outside store; use `frontend-design` skill |
| Rendering | deck.gl 9 (Orthographic) + Canvas2D underlay | bundled, pinned |
| Parquet | DuckDB-WASM (`spatial`) + hyparquet first-paint | Range reads; `enable_http_metadata_cache`; `LOAD httpfs` not needed |
| Zarr | zarrita + `@zarrita/storage` | `cell_feature_matrix` + `analysis`; offer unzipped `.zarr/` |
| HDF5 | h5wasm (jsfive fallback) | `cell_feature_matrix.h5` (Xenium) + `filtered_feature_bc_matrix.h5` (Visium) |
| OME-TIFF | geotiff.js (IFD/SubIFD + Range) | tiles only |
| JPEG-2000 | OpenJPEG-WASM (`@cornerstonejs/codec-openjpeg`) | 16-bit, in worker |
| Multi-channel blend | Viv `XRLayer` fed decoded tiles | Phase 3 |
| CSV | papaparse | metrics, annotation import |
| State sharing | URL hash | reproducible links |
| Tests | Vitest + Playwright | golden fixtures |

---

## 7. Top risks & mitigations

1. **JPEG XR immaturity** → spike Phase 3 day 1; JPEG-2000-only fallback +
   optional server transcode. Doesn't block Xenium core.
2. **Main-thread decode jank** → worker pool is a Phase 1 *exit criterion*.
3. **S3 misconfiguration** silently breaks Range → ship a "diagnose dataset"
   check (CORS + Range + key files).
4. **DuckDB 40 MB init latency** → hyparquet first-paint + lazy DuckDB init.
5. **Coordinate/unit bugs** → single tested `coords` module; property-test
   round-trips.
6. **Memory blowup on huge slides** → adaptive point caps, OPFS tile LRU, memory
   telemetry + eviction.

---

## 8. Immediate next steps (start here)

1. Scaffold Vite + TS; pin deck.gl; reproduce POC load + scatter against the demo
   URL in the new structure.
2. Extract and unit-test `cellid.ts` and `coords.ts` first (highest leverage,
   lowest risk).
3. Move J2K decode into a worker; confirm smooth pan/zoom with image on.
4. Write `SpatialDataset` (§1.6); refactor `gex.js` behind `XeniumDataset`;
   delete `gexFromTranscriptsZarr`.
5. Fix httpfs: `enable_http_metadata_cache` at boot; Range-read boundaries.
6. Stand up the S3 diagnostic check; validate Range/CORS on the real bucket.
