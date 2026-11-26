# Phase 29 — Python Terminal

Planned 2026-11-26. Requested: a Python terminal in the app, run in the
browser with Pyodide, mainly to choose cells to show, colour or highlight
with code. Two requests the user gave as guides, not as specifications:

- "Cells with gene X over 20 that are within 250 µm of this point; colour
  them all green, with the shade set by each cell's distance to the point."
- "All cells in ROI1 with cell area over 50, and all cells in ROI2 with
  gene Y over 99 counts."

This phase is a proof of concept. It **exposes the data and lets users
write their own helpers**: every cell's position, columns and gene values
as NumPy arrays, the ROIs as vertices, and three calls that draw a result
on the canvas. Helpers such as distances, neighbours and saving classes
wait until users ask for them ([Later](#later)).

The user decided on 2026-11-26 ([Answered Questions](#answered-questions)):

- NumPy is the only package, for the smallest first load (D1).
- `Stop` restarts Python and loses the variables (D2).
- Chrome and Edge only for the proof of concept (D5).
- `others()` in code chooses whether cells outside every result are faded
  or hidden (D7).
- `cells.gene` reads `X` on an H5AD file, with `layer=` for its layers (D6).
- ROIs give their vertices and one helper, `contains` (D9).
- A console REPL, not a script editor (D11).
- `color` (solid and gradient), `highlight` and `show` are the outputs.

The plan rests on a code map made on 2026-11-26 at `25ff4b44`. It is cited
below as `file:line`; line numbers drift as the code changes.

Sizes are for one developer: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

## Goals And Non-Goals

Goals:

- A `Python` floating window, opened from the top bar: a console with a
  prompt, an output log, history and tab completion.
- Python runs in a worker, loaded the first time the window opens. Nothing
  is downloaded for users who never open it.
- A small `explorer` module, imported for the user, with:
  - `cells`, the open dataset's cells as NumPy arrays by overview row;
  - `rois`, the saved selections and imported shapes, as vertices, with
    `contains`;
  - `view` and `cells.selected`, the canvas's view and the selected cell;
  - `color`, `highlight`, `show`, `others` and `clear`, which draw on the
    canvas.
- The same platforms as Cell Query (plan 23-D1): Xenium, Atera, standard
  Visium, MERSCOPE, H5AD (file, reference, Icechunk, AnnData Zarr) and
  SpatialData.
- Gene values for every cell, through the Plots panel's reader and read
  budget.
- Chrome and Edge. Other browsers get a message, not a broken console.
- The axe baseline stays empty and `nativeTitleAudit` passes.

Non-goals:

- Helpers beyond `contains`: distances, neighbours, shapes from code,
  pandas tables. Users write these in the console.
- Saving results as classes or tracks, and CSV export. See [Later](#later).
- Packages other than NumPy.
- Firefox and Safari.
- Writing back to the dataset, or reading files other than through the
  app's readers.
- Code in the link (D12).
- Visium HD bins, image-only datasets, collections as a whole, the 3D view
  and transcripts.

## The Python API

All coordinates are in µm with y pointing down, as the canvas's ruler and
the Cell card show them. They are not deck.gl's coordinates, which negate y
(`deckLayerTypes.ts:11`).

A **mask** is a NumPy `bool` array with one entry per cell, in overview row
order. Masks combine with `&`, `|` and `~`, as NumPy arrays do. Every call
that takes a mask also takes an array of row indices.

### Data

| Expression                      | Gives                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `len(cells)`                    | The number of cells                                                           |
| `cells.id`                      | Cell IDs, as a NumPy array of strings                                         |
| `cells.x`, `cells.y`            | Centroids in µm (`float64`)                                                   |
| `cells.area`                    | Cell area in µm², where the platform gives it; NaN elsewhere                  |
| `cells.transcripts`             | Transcript count, where the platform gives it                                 |
| `cells.nuclei`                  | Nucleus count, where the platform gives it                                    |
| `cells["n_genes"]`              | A metadata track: `float64`, NaN for no value                                 |
| `cells["leiden"]`               | A set, as `Classes`: `.codes` (`int32`, −1 for none) and `.labels`            |
| `cells["leiden"] == "3"`        | A mask: cells in the class, counting cells listed in more than one class      |
| `cells["leiden"].isin([…])`     | A mask: cells in any of the classes                                           |
| `cells.gene("CD3E")`            | The gene's value in every cell (`float32`, 0 where none is stored)            |
| `cells.gene("CD3E", layer="…")` | An H5AD layer instead of `X` (D6)                                             |
| `cells.gene_names`              | The genes the matrix lists                                                    |
| `cells.columns`                 | Each column's name and kind (cell, set, track), as Cell Query lists them      |
| `cells.selected`                | The row of the cell the Cell card shows, or `None`                            |
| `rois`                          | Shapes by name: saved selections (`ROI 1`, …), then imported GeoJSON features |
| `rois["ROI 1"].polygon`         | Vertices as an `(n, 2)` array in µm; a box as its four corners                |
| `rois["ROI 1"].contains(cells)` | A mask: centroids inside the shape, as the canvas's own test decides          |
| `rois.current`                  | The selection drawn but not saved, or `None`                                  |
| `view.center`, `view.bounds`    | The canvas's view in µm                                                       |

Columns are read the first time code uses them and kept for the dataset
(D5). GeoJSON features go by their label, with ` (2)` and so on for
repeats; a MultiPolygon gives a list of `(n, 2)` arrays.

`Pick point` in the window arms one click on the canvas and writes
`(x, y)` in µm into the prompt at the cursor. That answers "this point"
without the user reading coordinates off the ruler.

### Drawing

| Call                                     | Effect                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `color(mask, "green")`                   | The cells in `mask` turn green                                                  |
| `color(mask, "green", by=values)`        | A ramp from pale to full green over `values`; `vmin`, `vmax` and `reverse=True` |
| `color(mask, by=values, cmap="viridis")` | A named colour map instead of a single-hue ramp                                 |
| `highlight(mask, color="white")`         | A ring around each cell in `mask`; their own colours stay                       |
| `show(mask)`                             | Only the cells in `mask` are drawn; `show(None)` draws every cell again         |
| `others("fade")`, `others("hide")`       | Cells in no colour layer are faded (to start with) or not drawn (D7)            |
| `clear()`, `clear("name")`               | Removes every layer, or one                                                     |

Each drawing call takes `name=`. A call without one replaces the layer
called `Result`, so running an input again replaces its result instead of
stacking another (D8). Colours are CSS names or hex. `by=` takes one value
per cell; values outside the mask are ignored, and NaN draws as the ramp's
palest colour.

### The two requests, written in it

```python
import numpy as np

x0, y0 = (5210.4, 3180.9)                  # from Pick point
d = np.hypot(cells.x - x0, cells.y - y0)   # µm
near = (cells.gene("CD3E") > 20) & (d <= 250)
color(near, "green", by=d, reverse=True)   # full green at the point, pale at 250 µm
```

```python
a = rois["ROI 1"].contains(cells) & (cells.area > 50)
b = rois["ROI 2"].contains(cells) & (cells.gene("Y") > 99)
color(a | b, "orange", name="ROI picks")
others("hide")
```

"Gene Y over 99 counts" reads the matrix the app reads: counts on Xenium,
Atera and MERSCOPE, `X` on an H5AD file, which is often normalised. There,
`cells.gene("Y", layer="counts")` reads the counts where the file has them.

## Current State

What the terminal can build on:

- **Rows.** `overviewCells` (`useAppDomainState.ts:405`) holds every cell,
  as `OverviewCellDatum` (`deckLayerTypes.ts:11-30`): ID, position (µm, y
  negated), and where the platform gives them transcript count, area,
  nucleus count and segmentation method. Cell Query's rows are the same
  (plan 23-D1).
- **Columns by row.** `CellQueryStore` (`src/features/query/cellQuery.ts:84`)
  holds number columns as `Float64Array` with NaN, and sets as each row's
  first class with a map for cells in more than one. Its column IDs are
  `cell:…`, `set:<setId>`, `track:<trackId>` and `image:…`
  (`cellQueryModel.ts:91-230`).
- **Reading a column.** `useCellQueryModel` reads sets through the
  annotation loader, tracks through the track loader and saved selections
  through `useSelectionCells`, as `ColumnInput.request()`
  (`useCellQueryModel.ts:696-772`). The reads live in the hook, not in a
  module another caller can use.
- **Genes.** `GeneValuesSource` (`src/data/geneValues.ts:51`) gives a gene's
  stored values by matrix row, and `geneValuesRowIds()` each row's cell ID
  (Xenium's as integer pairs). Xenium, Atera, MERSCOPE, H5AD and SpatialData
  implement it; only Plots uses it. Its budget is `plotReadDecision`
  (`plotsPanelModel.ts:483-499`): read up to 32 MiB, ask up to 256 MiB,
  refuse above. H5AD reads `X` only (`h5adDataset.ts:1016`).
- **Shapes.** Saved selections are `SavedSelection{id,name,color,visible,
selection}` (`selectionListModel.ts:9`), named `ROI 1`, `ROI 2` and so on,
  with `RoiSelection` a box or a lasso in µm (`roiSelection.ts:4`) and
  `roiSelectionContains` (`:136`). Imported GeoJSON features are
  `GeometricAnnotationFeature`s in µm (`geometricAnnotationModel.ts:17`),
  held in `geometricAnnotations` (`useAppDomainState.ts:248`). Nothing
  finds the cells inside an imported shape.
- **Colour.** `createObservationColorizer` (`cellStyling.ts:65`) colours
  by mode; `packCellPointColors` (`cellPointStyle.ts:150`) packs one RGBA
  per overview row for the GPU (`ViewerCore.tsx:989`); boundaries take the
  same colour through `cellColor(cellId)` (`cellBoundaryRenderer.ts:278`).
  The only ramp for a number per cell is `metadataColor`
  (`cellStyling.ts:223-288`).
- **What is missing for drawing.** No colour per cell from outside the
  modes, no ramp but the fixed one, no way to hide cells, and no highlight
  of more than one cell (`viewerSelectionModel.ts:10`).
- **Windows.** A new floating window touches `floatingWindowModel.ts:4-61`,
  `shellLinkModel.ts:12-200`, `TopBar.tsx:91`, `ShellLayout.tsx:124-306`
  and the availability check at `App.tsx:5536`, as `QueryWindow.tsx` does.
- **Workers and headers.** Workers are module workers made with
  `new URL(…, import.meta.url)`. `vite.config.ts:4-7` sends COOP and COEP in
  dev and preview only. GitHub Pages sends neither, so the deployed app has
  no `SharedArrayBuffer` (`docs/architecture.md:894`).

## Product Decisions

- **D1. Pyodide in a dedicated worker, self-hosted, NumPy only.** The
  `pyodide` npm package, pinned, with its runtime files and the NumPy wheel
  copied into the build under `pyodide/` and loaded with `indexURL`
  (working rule: no CDN in the app). No `micropip`. It loads the first time
  the window opens, with progress in the window, and the worker holds the
  interpreter for the tab's life.
- **D2. Stop restarts Python.** Without `SharedArrayBuffer`, Pyodide cannot
  be interrupted, so `Stop` ends the worker and starts a new one. The log
  says the variables were lost. Layers on the canvas stay (D8). Where the
  page happens to be cross-origin isolated (dev, preview), `Stop` raises
  `KeyboardInterrupt` instead.
- **D3. Rows are overview rows** (plan 23-D1). Masks and arrays have one
  entry per cell of the open dataset. In a collection, the open section.
  A mask kept from another dataset is refused with both lengths.
- **D4. The worker asks the app; it never reads data itself.** A typed
  message protocol: the worker asks for a column, gene values, the shapes,
  the view or the selected cell, and sends layers and output. The main
  thread answers through the readers Cell Query and Plots use. Messages of
  unknown type are refused, so code cannot call into the page beyond the
  protocol.
- **D5. Data on demand with JSPI; Chrome and Edge only.** A column or gene
  is read when code first touches it: the Python call blocks on the app's
  answer with Pyodide's `run_sync`, which needs WebAssembly JSPI. The
  window checks for JSPI (`WebAssembly.Suspending`), not the browser's
  name, and without it says the console needs Chrome or Edge. Columns are
  kept per dataset and dropped when the dataset changes. Chrome and Edge
  are what is supported and tested; a browser that has JSPI is let in. The
  spike found `run_sync` working in WebKit 26.4 too.
- **D6. Gene reads keep the Plots budget, and take `layer=`.** Up to
  32 MiB a read goes ahead. Up to 256 MiB, `cells.gene` raises
  `ReadTooLarge` with the size and the call to make:
  `cells.gene("Y", allow_large=True)`. Above that it is refused, as Plots
  refuses. `layer=` reads an H5AD layer (`layers/<name>`, or `raw` for
  `raw/X`) instead of `X`; other platforms raise an error naming the
  matrix they have. Matrix rows join to overview rows once per dataset; a
  cell missing from the matrix is NaN.
- **D7. Colour layers draw over the current colour mode.** An overlay
  applied after the mode's colours, gene expression included: one RGBA and
  one flag per overview row, packed with the mode's colours. `others()`
  sets what cells in no colour layer look like: `fade` (as unclassed cells
  fade today, `cellStyling.ts:43`), the default, or `hide`. With no colour
  layer, `others()` changes nothing. Hidden cells, by `others("hide")` or
  `show`, are not drawn, picked or hovered. Boundaries take the same
  colours through `cellColor`. A packed alpha of 0 does not hide a cell:
  `cellPointLayerColors` (`cellPointStyle.ts:183`) sets every fill's alpha
  from the layer's opacity and only checks for faded cells, so hiding needs
  a flag of its own there.
- **D8. Layers by name, later over earlier.** A cell takes the colour of
  the last colour layer that holds it. An unnamed call replaces `Result`.
  Layers live in the app, not in Python: a restart keeps them, and
  `clear()` removes them. The legend lists them under `Python`, with a
  swatch or a ramp and its range, and a button to clear each.
- **D9. ROIs as data, plus `contains`.** `polygon` gives the vertices.
  `contains` is the one geometry helper: it runs the app's own
  `roiSelectionContains` (and the same test for GeoJSON rings, holes
  included) on the main thread, so a cell is inside in Python exactly when
  the canvas's selection holds it. The mask comes back transferred.
- **D10. Highlight is a ring layer.** A `ScatterplotLayer` of the
  highlighted rows only, stroked, above the cells. It does not re-pack the
  cells' colours.
- **D11. A console like IPython.** `Python` in the top bar beside `Query`
  and `Plots`, a `FloatingWindow` 560 × 420 by default, `panel=python` in
  the link. Output above, the prompt below. `Enter` runs an input that is
  complete (`codeop`) and adds a line otherwise; `Shift+Enter` always adds
  a line; `Up` and `Down` at the first and last line walk the history;
  `Tab` completes names, `cells` columns and gene names (`rlcompleter` plus
  the column list). A value left on the last line prints its repr; arrays
  of a million print NumPy's summary, and a mask prints its count. Output
  is a polite live region and keeps the last 2,000 lines. History is kept
  in `localStorage`, read with `try`/`catch`.
- **D12. No code in the link.** `panel=python` opens the window, and
  nothing else about Python is in the link.

## Architecture

```text
 Python window (React)            Main thread                    Python worker
 ───────────────────────          ─────────────────────────      ──────────────────────────
 prompt, log, Pick point  ─run──▶ TerminalSession ─input────────▶ Pyodide + explorer module
                                  │ ◀──── need(column / gene) ───┤ cells.gene(...) blocks
                                  │ CellColumnReader             │   with run_sync (D5)
                                  │  · overview columns          │
                                  │  · sets, tracks (Cell Query) │
                                  │  · GeneValuesSource + join   │
                                  ├─ columns (transferred) ─────▶│ NumPy arrays, cached
                                  │ ◀──── contains(roi) ─────────┤ rois[...].contains
                                  │ ◀──── layer ─────────────────┤ color(), highlight(), show()
                                  ▼                              │
                     PythonLayerStore → overlay RGBA/flags       │
                     → packCellPointColors, ring layer, legend   │
 log ◀────────────────────────────────────── stdout / stderr / repr
```

- **`CellColumnReader`** is a module, not a hook: given a dataset and a
  column ID it returns a `Float64Array`, codes with labels, or an error.
  Cell Query's hook moves to it (task B), so both share reads and caches.
- **`TerminalSession`** owns the worker, the protocol, `Stop` and the
  restart, and passes requests to the reader and layers to the layer
  store.
- **`PythonLayerStore`** holds the layers by name as typed arrays in
  `#private` fields, out of React props (React 19 dev walks large arrays in
  props). It composes them into one overlay and a legend section, and bumps
  a version the canvas reads once per input run.
- **The `explorer` module** is Python source in the repo
  (`src/python/explorer/`), shipped as a zip next to Pyodide. It is thin:
  objects that ask the bridge for arrays, and argument checks for the
  drawing calls. It runs on CPython against a fake bridge, so it is tested
  with pytest as well as in Pyodide.

## Tasks

- [x] **A. Spike.** (M) Done 2026-11-26; see
      [Spike Results](#spike-results-2026-11-26). A throwaway worker in a
      production build, on the Xenium demo (1,414,155 cells):
  - the first load's bytes and time with NumPy, cold and from the HTTP
    cache, from a host without COOP and COEP;
  - `run_sync` with JSPI in a worker, in Chrome and Edge: a Python call
    blocking on a main-thread read;
  - posting x, y and one gene to Python as typed arrays and making them
    NumPy arrays: time and heap;
  - `roiSelectionContains` over every cell for a 200-vertex lasso: time;
  - packing an overlay into `packCellPointColors`: the time to the redrawn
    canvas.
- [x] **B. `CellColumnReader`.** (M) PR #450. Move Cell Query's column reads out of
      `useCellQueryModel` into a module, with no change in behaviour. Cell
      Query's tests pass unchanged. A refactor, so its own PR.
- [x] **C. Gene values by overview row.** (M) PR #451. Join `GeneValuesSource` reads
      to overview rows once per dataset, Xenium's integer pairs included,
      with the D6 budget. H5AD's `geneValues` takes an optional layer
      (`layers/<name>`, `raw/X`), with its estimate; Plots keeps `X`.
      Tests: the join against a plain lookup (fast-check), missing cells,
      the budget's three outcomes, a layer read on the H5AD fixture.
- [x] **D. Python worker and session.** (M) PR #453. D1, D2, D4, D5. The worker, the
      protocol with types on both ends, `TerminalSession`, `run_sync`
      reads, self-hosted Pyodide copied by the build, progress, `Stop`,
      restart, the JSPI check. Unit tests with a fake worker; one Node test
      that loads the real Pyodide.
- [x] **E. The `explorer` module.** (M) PR #452. `cells`, `Classes`, `rois` with
      `polygon` and `contains`, `view`, `cells.selected`, the drawing calls'
      argument checks, and reprs. pytest on CPython against a fake bridge;
      `contains` checked against `roiSelectionContains` on shared fixtures.
- [x] **F. Python window.** (L) PR #454. D11, D12. `PythonWindow` on
      `FloatingWindow`, the prompt (CodeMirror 6 with Python, loaded with
      the window), the log, history, completion, `Pick point`,
      `panel=python`, a `python` control area in `src/test/controlAreas.ts`
      and `tests/e2e/controls.ts`. Gate as Cell Query is gated (plan 23-D1),
      and on JSPI (D5).
- [x] **G. Layers on the canvas.** (L) PR #456. D7, D8, D10. `PythonLayerStore`;
      the overlay in `packCellPointColors` and the boundary styler; hidden
      cells left out of drawing, picking and hover; the ring layer;
      single-hue ramps and named colour maps; the legend section; screenshots
      (Phase 27) include the layers. Tests: composition against a plain
      loop (fast-check), hidden cells never picked, and the no-redraw test
      (typing and running code that draws nothing must not render DeckGL).
- [ ] **H. Docs and end-to-end tests.** (M) [Docs To Update](#docs-to-update).
      E2E in Chromium on the H5AD fixture with the real Pyodide from the
      build: open the window, run both requests above with the fixture's
      names, check the legend and a cell's colour, `others("hide")`, `Stop`.
      The axe test opens the window empty and with output; the baseline
      stays `{}`. A nightly `@live` test on the Xenium demo records the time
      to the first prompt and to the first coloured canvas.

## Spike Results (2026-11-26)

Task A. A throwaway page and worker, not committed, ran Pyodide 314.0.8
(Python 3.14.2) with NumPy 2.4.6, loaded from the page's own host by
`indexURL`. Synthetic columns of 1,414,155 cells over the Xenium demo's
extent (10.9 × 18.8 mm) stood in for the demo's own, since only their size
matters here. Headless Chromium on the Mac's GPU (Apple M3), Google Chrome
and WebKit 26.4 from Playwright, served without COOP and COEP.

**First load.** The files are the npm package's `pyodide.asm.wasm`
(9.6 MB), `python_stdlib.zip` (2.5 MB), `pyodide.asm.mjs` (1.3 MB),
`pyodide.mjs` and `pyodide-lock.json`, and NumPy's wheel (3.0 MB), fetched
once from Pyodide's release by the name in the lock file and checked
against its SHA-256. That is 16.5 MB, or 9.3 MB gzipped. GitHub Pages
gzips `.wasm`: the deployed DuckDB and OpenJPEG `.wasm` files come with
`content-encoding: gzip`. A server sending gzip and `max-age=600`, as Pages
does, gave in Chrome:

| Network            | Cold (to `import numpy` done) | From the HTTP cache |
| ------------------ | ----------------------------- | ------------------- |
| Local, no throttle | 1.4–1.8 s                     | 1.3 s               |
| 100 Mbps, 40 ms    | 2.3 s                         | 1.4 s               |
| 40 Mbps, 40 ms     | 3.4 s                         | 1.3 s               |
| 10 Mbps, 40 ms     | 9.1 s                         | 1.3 s               |

- From the cache, about 0.9 s goes to starting Pyodide (compiling the
  `.wasm` and unpacking the standard library), 0.15 s to loading NumPy and
  0.23 s to `import numpy`. The heap starts at 45 MB.

**`run_sync` with JSPI.** It works in a module worker in Chromium, Chrome
and WebKit 26.4, from code run with `runPythonAsync`; no `callPromising`
is needed. `can_run_sync()` is true at the top level and inside functions
called from a loop, so a name known only at run time blocks as a literal
one does.

**Columns into NumPy.** The worker asks, the main thread answers with a
transferred typed array, and Python copies it into a NumPy array with
`JsBuffer.assign_to` (one copy):

| Column                 | Round trip | Copy into NumPy |
| ---------------------- | ---------- | --------------- |
| x, `Float64Array`      | 3.1–3.8 ms | 1.5–2.4 ms      |
| y, `Float64Array`      | 3.1 ms     | 2.2–2.5 ms      |
| a gene, `Float32Array` | 0.9–2.5 ms | 0.2–0.5 ms      |

- The first request, written as in [the API](#the-two-requests-written-in-it)
  (`hypot`, two comparisons, `&`), took 30–35 ms in NumPy.
- After x, y, four gene reads, the distances, the masks and the ROI mask,
  the heap was 113 MB.

**ROI test.** A copy of `roiSelectionContains` over every cell for a
200-vertex star lasso about 4 mm across, on the main thread: 83–90 ms,
81,394 cells inside. Python had the mask 84–90 ms after asking.

**Layers back to the app.** A mask (1.4 MB) and a `float32` value per cell
(5.7 MB) copied out of the heap with `to_js(memoryview(…)).slice()` and
transferred: 3.7 ms.

**Overlay and redraw.** In Node, on 1.4 million cells,
`packCellPointColors` took 7–8 ms, an overlay pass over its result (a flag
and an RGBA per row, the other cells faded) 4–6 ms, and
`cellPointLayerColors` 9 ms. On the Xenium demo itself (production build,
GPU WebGL, 1280 × 800), switching `Transcript count` to `Cell area` was
one main-thread task of 290–340 ms, and back 94 ms. Packing is a small
part of that; the rest is the existing React and deck.gl update. A layer
should cost about a colour mode switch, once per input run (D8).

What changed in the plan:

- **D5** lets in any browser with JSPI, as WebKit 26.4 had it; Chrome and
  Edge stay the supported pair. Firefox was not tried.
- **D7** notes that hiding needs a flag in `cellPointLayerColors`, since a
  packed alpha of 0 does not hide a cell.
- NumPy's wheel is not in the npm package. Task D's build step fetches it
  by the lock file's name and checks the SHA-256, or the repo keeps it.

## M1 Notes (2026-11-26)

M1 was built as a stack of PRs, each on the one before: #450 (B), #451 (C),
#452 (E), #453 (D), #454 (F). What changed from the plan while building it:

- The window is offered wherever Cell Query is. Without JSPI it opens and
  says the console needs Chrome or Edge, rather than leaving the toggle out,
  so the reason is visible.
- Until G, `color`, `highlight`, `show` and `others` check their arguments
  and then raise a `DataError` that says drawing comes next.
- Cell Query's `CellColumnReader` is made once in `App` and shared with the
  console, so a set or track is read once for both.
- H5AD layers are read through a new HDF5 worker `tree` request, loaded only
  when asked for; in a file read by range, layers are read in slices so the
  estimate downloads nothing.
- The worker asks Python whether an input is complete before running it and
  posts `started`, so the console logs the input above its output and leaves
  an incomplete one in the prompt.
- The real-Pyodide test runs in Node, which has JSPI from 25; CI's Node 24
  runs it with `--experimental-wasm-jspi`.

On the Xenium demo (1,414,155 cells, production build, Chromium) the prompt
was ready about 1.2 s after the window opened with Pyodide in the browser's
cache, and the columns, a class set and a gene read gave the expected
values.

## M2 Notes (2026-11-26)

M2 (task G) is PR #456. What changed from the plan while building it:

- The store is `PythonLayerStore` in `src/features/python/`; the overlay's
  composition is in `src/rendering/pythonOverlay.ts`, so the canvas reads it
  without importing the console. `PythonSession` calls `onRunEnd` when an
  input ends, finished, failed or stopped, and the store publishes its draft
  then.
- Layers are keyed by kind and name, so an unnamed `color` and an unnamed
  `highlight` in one input are both `Result` and both stay; `clear("name")`
  removes both. A redrawn layer goes on top.
- `clear()` starts over: no layers, no `show`, `others("fade")`.
- Hidden cells take the GPU filter value outlined cells take, so they are
  neither drawn nor picked; outlines of hidden cells are transparent, and
  the pick handlers and `Enter` skip hidden cells, outlines and nuclei.
  Nuclei of hidden cells are still drawn.
- Python's colour layers suppress the gene expression overlay points, which
  would otherwise draw over them; with `show` alone, only hidden cells lose
  theirs.
- Single-hue ramps start at the colour mixed 85% toward white; NaN draws as
  the ramp's low end whatever `reverse` says. Colour maps are matplotlib's at
  17 stops.
- The legend's Python section comes first, and prints in screenshots as a
  list plus a scale per ramp.
- The App-level test of the plan is a hook test (`usePythonConsole.test.tsx`)
  with a fake worker: a draw reaches the overlay once its input ends, and an
  input that draws nothing leaves the overlay's identity unchanged.
  `ViewerCore.test.tsx` checks that such an overlay does not render DeckGL.
- Visium HD bins (grid cells) and the 3D cell view do not take the layers.

On the Xenium demo (1,414,155 cells, production build, Chromium with GPU),
colouring Cluster 3 (118,549 cells) took 2.2 s from `Enter` to the end of
the input, most of it reading the class column; SNAP25 within 2 mm of the
view's centre as a reversed green ramp (19,178 cells), a ring on 1,171 of
them and `others("hide")` in one input took 0.8 s with the gene read;
`show(...)` and `clear()` took about 160 ms each, redraw included. The
legend listed each layer with its count, ramp range and clear buttons.

## Order And Size

| Milestone             | Contents      | Size     |
| --------------------- | ------------- | -------- |
| M0 — Spike            | A             | M        |
| M1 — Console and data | B, C, D, E, F | ~3 weeks |
| M2 — Drawing          | G             | ~1 week  |
| Throughout            | H             | —        |

- M1 is useful on its own: users can count and inspect cells, and see
  which helpers they write before any are built in.
- B is a refactor, so it goes first and alone.
- Tag a release after M1 and after M2.

## Testing

- **pytest on CPython** (installed with `uv`) for the `explorer` module
  against a fake bridge: fast, and run in CI.
- **Vitest** for the reader, the join, the protocol, the session with a
  fake worker, and the layer store. One Node test file loads the real
  Pyodide once and runs both requests on a fixture dataset.
- **`App.test.tsx`** with the Python worker mocked: open the window, a
  layer arrives, the legend and the packed colours change.
- **E2E and accessibility** in task H, Chromium only. Pyodide takes
  seconds to start, so the E2E tests share one page.

## Docs To Update

- `docs/python-api.md`, new: the API above, the two requests, what each
  platform's columns and matrix hold, and the browsers it needs.
- `docs/ui-reference.md`: a Python Window section, Platform Availability,
  Narrow Screens and `panel=python`.
- `docs/user-guide.md`: a walkthrough from a question to a coloured
  canvas.
- `docs/architecture.md`: the Python worker, the protocol, the column
  reader and the layer overlay.
- `README.md`: the build's extra files and their size.
- `PLAN.md`: the row for this phase.

## Risks

| Risk                                    | Effect                                                | Mitigation                                                                  |
| --------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Pyodide's first load is large           | Seconds before the first prompt on a slow link        | Loaded only when the window opens, with progress; cached by the browser; A  |
| `run_sync` misbehaves in a worker       | Data on demand (D5) does not work                     | A: works in a module worker in Chromium, Chrome and WebKit 26.4             |
| Browsers without JSPI                   | No console                                            | The window says so (D5); any browser with JSPI is let in                    |
| No `SharedArrayBuffer` on GitHub Pages  | `Stop` loses the variables                            | D2 says so in the log; layers stay                                          |
| A gene read is large                    | Minutes of reading, or a refused read                 | D6, the Plots budget, with the size in the error                            |
| Columns copied into Python use memory   | A tab with many genes on 1.4 M cells grows by 100s MB | float32 genes; columns per dataset, dropped on a dataset change             |
| Layer changes cost a DeckGL render each | About 9 s per render headless; jank in use            | One version bump per input run, not per call; the no-redraw test            |
| Coordinates confuse users               | Points off by a flip or a unit                        | µm with y down everywhere, as the ruler; `Pick point`; the docs say it      |
| User code reaches the page              | Code changes state outside the protocol               | The worker has no DOM; the main thread accepts only the protocol's messages |

## Answered Questions

The user answered on 2026-11-26:

1. **Packages.** NumPy only, for the smallest first load. Expose the data
   and let users write their own helpers; helpers come later if users ask
   for them (D1).
2. **Cells outside a colour layer.** Chosen in code: faded or hidden
   (D7).
3. **H5AD values.** `X` by default, with `layer=` (D6).
4. **Stop on GitHub Pages.** Restart and lose the variables; no
   cross-origin isolation (D2).
5. **Outputs.** `color`, solid and gradient; `highlight`; `show`. Not
   `save_class` or CSV export.
6. **ROIs.** Vertices and `contains` (D9).
7. **Browsers.** Chrome and Edge only for the proof of concept (D5).
8. **Window.** A console REPL (D11).

## Later

Helpers, when users ask for them:

- Distances and neighbours: `cells.distance(p)`, `cells.near(mask, r)`.
- Shapes from code (`circle`, `polygon`) and `add_roi`.
- `save_class`, `save_track` and `export_csv`, into the app's classes,
  tracks and downloads.
- pandas, and other Pyodide packages.

Reach:

- Firefox and Safari, once they ship JSPI, or with names read from the
  syntax tree before a run.
- Visium HD bins and segmented cells, with `cells` choosing the tier.
- `sections` in a collection: the same API across the sections' cells.
- The 3D view and the section stack drawing the layers.
- Image channel measures as columns, from Phase 26's measurer.
- Embeddings and transcripts as arrays.
- A script editor beside the console.
- A link that pre-fills the prompt with a script, still run by a click.
