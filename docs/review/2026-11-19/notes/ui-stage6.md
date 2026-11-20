# Stage 6: rendering, interaction, performance (R5)

Coordinator notes, 2026-11-20, commit `6a9a736`. No worker was used (sub-agents still run at xhigh effort in this session). No `@live` test was run: the user was asked about the transfer cost before the stage and did not answer, so, as stated then, the hosted datasets were not touched.

## Setup

- Builds: `npm run build` (root base, served by `vite preview` on 4273 with the COOP/COEP headers from `vite.config.ts`), the release-style `npx vite build --base ./` (as `release.yml:46`), and an unminified copy of it for heap snapshots. Build output went to `dist/` (ignored) and the scratchpad.
- Fixtures: `../evidence/runtime/fixtures.mjs --profile` (the first attempt's script, unchanged) plus a 2-channel 4096 × 4096 uint16 pyramidal OME-TIFF (`../evidence/ui-stage6/make_ome_tiff.py`: 512 px deflate tiles, three SubIFD levels). Served by `scripts/range-server.mjs` on 4274.
- Runner: `../evidence/ui-stage6/pw.stage6.config.mjs` starts every server on review ports 4273 to 4276 with no reuse. `serve-sub.mjs` serves a build under `/sub/` with or without COOP/COEP. Specs are `*.s6.mjs`; logs and JSON are beside them and in `out/`.
- Browser: Playwright's headless Chromium with SwiftShader (as CI), except where marked GPU (Metal, `S6_GPU=1`). Memory is the renderer, GPU and network process RSS from `ps` (located with CDP `SystemInfo.getProcessInfo`) and the main thread's JavaScript heap from CDP `Performance.getMetrics`, after `HeapProfiler.collectGarbage` where marked. `performance.measureUserAgentSpecificMemory` is refused by this headless build even when cross-origin isolated, so worker heaps are not measured separately; dedicated workers run in the renderer process, whose RSS includes them.

## Provisional findings

### PERF-01 Every dataset or section switch keeps the previous deck.gl instance, its layers and its WebGL context (P2, candidate P1)

- Confidence: confirmed by execution (heap snapshots, instance counts, heap after garbage collection) and static proof of the retaining path.
- Trigger: `ViewerCore` renders `{hasSpatialData ? <MemoDeckGL …/> : null}` (`src/components/ViewerCore.tsx:2193-2195`), so the Deck unmounts while a dataset loads and a new one mounts after. `@deck.gl/react` calls `Deck.finalize()` (`node_modules/@deck.gl/core/dist/lib/deck.js:289-316`, deck.gl 9.3.2), which never destroys the WebGL device it created. luma.gl 9.3.3's `CanvasContext.destroy()` would stop its observers (`node_modules/@luma.gl/core/dist/index.cjs:2060-2066, 2161-2167`), but nothing calls it, so the device-pixel-ratio `matchMedia` listener stays registered.
- Retaining path (unminified build, `../evidence/ui-stage6/heap-retainers.log`): `MediaQueryList` listener → `_handleDevicePixelRatioChange` → `CanvasObserver` → `WebGLCanvasContext` → `WebGLDevice` → `Deck.props` → `layers` → `PackedCellPointLayer` and its data.
- Observed:
  - Instances after 9 and after 27 collection switches (`heap-count.log`): `Deck`, `WebGLDevice`, `WebGLCanvasContext`, `CanvasObserver` and `LayerManager` 10 → 28 (one per switch); `PackedCellPointLayer` 20 → 56. `AnnDataH5adDataset` stays at 2 and `DatasetCache` at 3, so the dataset cache is not the cause. Between the two snapshots: +45,000 `readMetadata` closures (2,500 per switch, one per cell of a section), +216 `WEBGLBuffer`, +36 shaders and pipelines (`heap-diff.log`).
  - Main-thread heap after garbage collection, switching between three 2,500-cell sections: 12 → 47 MiB over 30 switches, about 1.2 MiB per switch (`out/profile-collection-switches-30-gc.json`). GPU process RSS (SwiftShader) 189 → 928 MiB.
  - Ordinary switches through the Open dataset form leak the same way, in proportion to the cells drawn (`deck-leak-scale*.json`, production build, after garbage collection): each visit to a 20,000-cell H5AD left 5.3 to 5.9 MiB (19.5 → 47.1 MiB over six visits); each visit to the 200,000-cell H5AD left about 50 MiB (92.8 → 142.6 → 192.0 MiB).
- Not observed: a crash or lost context within the bounded runs. The retained heap grows linearly without limit, so a session that flips through a large collection (the SPCOX and GBM-space collections have 18 and 97 sections) keeps every section it has shown.
- Expected: switching replaces the dataset; nothing in `docs/` says earlier views stay in memory.
- Correction: keep one Deck mounted across switches (render it with empty layers instead of unmounting), or destroy the device's canvas context (and lose the WebGL context) when the canvas unmounts. Add a browser test that counts Deck instances or the retained heap after several switches.
- Severity: P2 for now, because no failure was reached. Raise it to P1 in stage 8 if a crash or lost context is shown at realistic sizes.

### IO-02 update: decode worker pools measured (stays P2, candidate P1)

- `io02-workers.swiftshader.log` (production build, the 2-channel OME-TIFF):
  - At load: 10 tile decode workers.
  - Each committed edit (`fill`) adds 5, reaching 160 after 30 edits.
  - Typing a five-digit maximum adds 20, because each keystroke is a new contrast value. After five typed edits there were 260.
  - None closes. A switch to another dataset leaves all 260 alive.
  - Renderer RSS: 317 MiB at load, 902 MiB after 30 edits, 970 MiB at the peak.
- `io02-stress.swiftshader.log`: 60 typed edits gave 1,140 live workers. Renderer RSS moved between 740 MiB and 1,466 MiB (not monotonic). Frames at the check points took 14 to 195 ms. There was no crash in 53 s.
- `tileCacheMaxTiles` (`src/data/performanceBudget.ts`) bounds each tile cache, but no budget bounds the number of pools.

### PERF-02 Detection probes run twice on a cold folder load (P3)

- Confidence: confirmed by execution (`detection-requests.log`, `out/detection-requests.json`); cause from stage 1's `load-trace.md` (`startDatasetLoad` and `createSpatialDataset`, `datasetFactory.ts:1540`, both call `detectSpatialDataset`, which has no memo).
- Visium Space Ranger folder: 42 requests, 27 distinct. The folder listing, `explorer.json` and 13 HEAD probes are each sent twice before the first data read. MERSCOPE folder: 33 requests, 18 distinct. A single H5AD file gets 3 HEADs. Probes in a set run in parallel, so the cost is one extra set of round trips per load.
- Correction: pass the detected layout from `startDatasetLoad` to the factory, or memoise detection per URL for the load.

### UI-01 Image channel histograms carry `aria-label` on an element with no role (P3, accessibility)

- axe `aria-prohibited-attr` (serious) at all three widths: `div[aria-label="rings histogram"]` and `div[aria-label="diagonals histogram"]` on the OME-TIFF, and `.channel-histogram` on the MERSCOPE `.vzg` stain (`a11y-widths.log`). Source: `src/features/morphology/MorphologyChannelControls.tsx:200-202`.
- The empty `tests/e2e/axe-baseline.json` does not catch it, because the axe smoke test scans only the tiny H5AD fixture, which has no image channels (`tests/e2e/app.spec.ts:486-582`).
- Correction: `role="img"` with the label (the `title` already gives the sample count), or `aria-hidden` if the histogram adds nothing for screen readers.

### UI-02 Collection bar buttons are 22 px targets (P3, accessibility)

- axe `target-size` (WCAG 2.2 AA 2.5.8, serious) at 1440 and 1024 px for `Previews`, `Stack in 3D` and `Show S2 beside`, `Show S3 beside` (`a11y-widths-collection.log`). The 22 px size comes from `.collection-bar-action` (`src/styles/collection.css:44-49`); buttons in `CollectionBar.tsx:230, 245, 415`. No smoke test opens a collection.

### UI-03 At intermediate widths the Plots and Cell Query windows open under the Dataset info drawer (P3)

- At 1024 × 768 with Dataset info open, Cell Query opens at x = 132 and Plots at x = 172, under the 380 px drawer. The drawer is drawn on top (`--z-drawer: 14` over `--z-panel: 12`, `src/styles/tokens.css:89-90`), so the window's title, condition picker and left half are hidden and clicks land on the drawer. There is no overlap at 1280 or 1440 px (`drawer-window-overlap.log`, `out/w1024-drawer-Query.png`). The windows are placed from the canvas's right edge (`src/features/shell/floatingWindowModel.ts:11-28`).
- The unchanged smoke suite at 1024 × 768 fails its Cell Query and Plots tests for this reason (17 of 19 pass, `smoke-1024.log`); the tests leave the drawer open after reading the activity log.
- Workaround: close the drawer or drag the window. Correction: keep a new window clear of an open left drawer, or close the drawer when a window opens on a narrow canvas.

## Measurements without a finding

| Area                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Subpath and headers     | The release-style build under `/sub/` with COOP/COEP, the same without any isolation header, and the default build at `/` all open the 95 MB H5AD (range reads), the OME-TIFF, the SpatialData store, the MERSCOPE folder and the Icechunk AnnData. Workers load from `/sub/assets/`; no app request fails; `crossOriginIsolated` is true, false and true. The console 404s are the expected optional-file probes. Not exercised: DuckDB-WASM (no Xenium fixture) and the OpenJPEG module (no JPEG 2000 fixture). | `serving.log`, `out/serving.json`                                          |
| Initial load (profile)  | `scripts/profile-load.mjs` unchanged, 3 runs, 200,000 × 500 H5AD: load 6.78 to 6.97 s and gene change 6.51 to 6.66 s, of which `(program)` (SwiftShader drawing, per `docs/profiling.md`) is 6.15 to 6.28 s; the app's own chunks stay under 190 ms per phase. 19 requests, 95.1 MB. Status line identical each run (20,075 positive cells across 200,000).                                                                                                                                                       | `out/profile-load.jsonl`, `profile-ac.log`                                 |
| GPU versus SwiftShader  | The same load is ready in 1.0 to 1.1 s with Metal against 6.8 to 7.1 s with SwiftShader, so CI timings are dominated by software drawing.                                                                                                                                                                                                                                                                                                                                                                         | `out/profile-cold-warm-gpu.json`, `out/profile-cold-warm-swiftshader.json` |
| Cold versus warm        | A reload in the same context transfers the same 95.1 MB in 22 requests and is no faster. Documented: H5AD reads are not in the persistent cache (`docs/architecture.md:416`) and the range path reads `/X` whole at load (`docs/modalities/h5ad.md:70-74`).                                                                                                                                                                                                                                                       | as above                                                                   |
| Collection switches     | 0.65 to 1.4 s per switch between 2,500-cell sections, 4 requests each (the section is re-read); old HDF5 workers close (2 alive throughout). Retention is PERF-01.                                                                                                                                                                                                                                                                                                                                                | `out/profile-collection-switches-*.json`                                   |
| Repeated TIFF ranges    | The coarsest tile of channel 1 is fetched three times on a cold load (one aborted): the main view, minimap and auto-contrast each keep their own tile store, as `morphologyTileStore.ts:34-43` describes.                                                                                                                                                                                                                                                                                                         | `out/detection-requests.json`                                              |
| Layout at three widths  | No horizontal page scroll at 1440, 1024 or 390 px in 7 states. The collection's section strip scrolls sideways (`overflow-x: auto`) and works at 390 px with the layer sheet closed; it sits under the open sheet. One or two unlabelled controls per state lie off-screen and were not identified.                                                                                                                                                                                                               | `a11y-widths.log`, `collection-narrow-*.log`                               |
| Narrow screens          | Matches `docs/ui-reference.md:1367-1386`: the window toggles fold into the `Panels` menu and the layer panel becomes a bottom sheet.                                                                                                                                                                                                                                                                                                                                                                              | screenshots `out/w390-*.png`                                               |
| Escape and focus return | At 1440 px, Embedding, Plots, Query, Help, Settings, Open dataset and Dataset info open from the keyboard, close on Escape and return focus to their button; Share copies the link at once and keeps focus. At 390 px the same holds for the five visible toggles; the `Panels` menu items were not tested. Matches `ui-reference.md:733-736`.                                                                                                                                                                    | `out/focus-return.json`                                                    |
| Wrong parameter         | `#dataset=` naming a collection file shows "this is a dataset collection; open it with collection= …".                                                                                                                                                                                                                                                                                                                                                                                                            | `out/w390-collection.png` (first run)                                      |
| Smoke suite at 390 px   | 3 of 19 pass. The failures wait for the layer section buttons, the `Panels` group or the `Tools` toolbar, which the narrow layout folds away; they are limits of `tests/e2e/controls.ts`, not app defects. No E2E test covers the narrow layout (stage 7 lead).                                                                                                                                                                                                                                                   | `smoke-390.log`                                                            |
| Pixel size              | The OME-TIFF fixture has a TIFF resolution tag but no `PhysicalSizeX`, and the scale bar uses 0.2125 µm/px, as documented (`docs/modalities/image.md:204`). Whether the UI says the scale is assumed was not checked.                                                                                                                                                                                                                                                                                             | `out/io02-stress-end.png`                                                  |

## User-journey checklist (R5)

| Journey                                   | Coverage this stage                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Open a source, missing optional assets | 7 sources at three widths; probes for optional files are the console 404s. In-app notices for missing assets were not reviewed one by one |
| 2 to 6. Genes, annotations, ROI, plots    | The unchanged smoke suite at 1280 (baseline, 19 of 19) and 1024 px (17 of 19, UI-03); not at 390 px (helper limits)                       |
| 5. Image channels                         | 35 contrast edits and 60 typed edits on the OME-TIFF (IO-02); Z planes and transcripts not exercised                                      |
| 7. Share and reopen                       | Only through the smoke suite (H5AD metadata link, Visium library link); collection context not reopened in a browser                      |
| 8. Switch datasets and sections           | 30 collection switches, 6 + 3 dataset switches (PERF-01); side-by-side opened at 390 px; 3D stack not opened                              |
| 9. Recover, retry, cancel                 | Wrong-parameter error only; failed reads and cancel are covered by stage 5's repros and LIF-01                                            |

Canvas hit testing, cross-selection, legends, coordinate readouts and picking were not exercised beyond the smoke suite's keyboard journey (cell at the view centre, Box selection of the view).

## Depth

| Area                                                                 | Depth        |
| -------------------------------------------------------------------- | ------------ |
| `src/components/ViewerCore.tsx` (Deck mount)                         | sampled      |
| `src/rendering/morphologyTileStore.ts`, `src/tiff/tileCache.ts`      | sampled      |
| `src/workers/tileDecodePool.ts`                                      | sampled      |
| `src/features/morphology/MorphologyChannelControls.tsx`              | sampled      |
| `src/features/collection/CollectionBar.tsx`, `styles/collection.css` | sampled      |
| `src/features/shell/floatingWindowModel.ts`, `styles/tokens.css`     | sampled      |
| `src/data/performanceBudget.ts`                                      | reviewed     |
| `tests/e2e/axe.ts`, `axe-baseline.json`, axe and keyboard tests      | reviewed     |
| `scripts/profile-load.mjs`, `docs/profiling.md`                      | reviewed     |
| `vite.config.ts` headers, `release.yml` build, `deploy-to-s3.md`     | reviewed     |
| `scripts/review-tasks.mjs`                                           | not reviewed |
