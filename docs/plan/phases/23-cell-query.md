# Phase 23 — Cell Query

Planned 2026-11-18. M1 (query and table) implemented 2026-11-18; see
[M1 Progress](#m1-progress). M2 (pictures) implemented 2026-11-18; see
[M2 Progress](#m2-progress). Requested: filter the cells of a dataset by
their observations, classes, annotations and metadata, list the cells that
match in a table, and show a picture of each cell in its row.

The scope is a floating Cell Query window with two parts:

- conditions on the columns the app already reads, and a table of the cells
  that match, linked to the canvas (M1);
- a picture of each listed cell, cut from the dataset's image with the
  canvas's channels and contrast, with the cell's outline (M2).

The user decided on 2026-11-18:

- Conditions combine with AND only (D3).
- The canvas shows matches only once they are saved with `Save as class`
  (D7). The window does not fade cells as conditions change.
- Pictures have a fixed field, chosen in `Picture`, not one fitted to each
  cell (D10).
- Pictures show the cell's outline (D10).
- Standard Visium spots are in scope (D1).

The plan rests on a code map made on 2026-11-18 at `ba01d76`. It is cited
below as `file:line`; line numbers drift as the code changes.

Sizes are for one developer: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

## Goals And Non-Goals

Goals:

- One Cell Query window, opened from Cells › Panels, that lists the cells
  matching a set of conditions on the dataset's columns.
- Conditions on every cell of the dataset, not the viewport.
- Xenium, Atera, standard Visium, MERSCOPE, H5AD (file, reference, Icechunk,
  AnnData Zarr) and SpatialData.
- Clicking a row selects the cell and moves the view to it.
- The matches can be saved as a class, which shows them on the canvas, and
  exported as CSV.
- A picture of each listed cell, drawn only for the rows on screen.
- The axe baseline stays empty and `nativeTitleAudit` passes.

Non-goals:

- Conditions on gene expression. See [Later](#later).
- Nested or OR-combined conditions (D3).
- Fading the cells that do not match as conditions change (D7). See
  [Later](#later).
- Visium HD. Its bins are grid cells, not overview cells, and number in the
  millions at 2 µm. See [Later](#later).
- Image-only datasets, which have no cells, and collections (one dataset at
  a time).
- Editing or writing back the dataset's columns.

## Current State

What the window can take as it is:

- **Rows.** `overviewCells` (`useAppDomainState.ts:384`) holds every cell of
  the dataset: the overview is read with `limit: null`
  (`useDatasetLifecycle.ts:2184`). Each is an `OverviewCellDatum`
  (`deckLayerTypes.ts:11`) with an ID, a position, and where the platform
  gives them a transcript count, cell area, nucleus count and segmentation
  method. `overviewCellById` (`App.tsx:1182`) maps IDs to cells.
- **Category columns.** Annotation sets are listed by the Clusters list and
  read one at a time with `AnnotationLoader` and a `groupId`
  (`appDependencies.ts:118`), as the Plots panel reads a set the list has not
  loaded (`useDatasetSetAnnotations.ts`). A class is a list of cell IDs
  (`Annotation`, `spatialDataset.ts:147`). Imported files (`custom:…`) and
  selections kept with `Save ROI` (`roi:…`, `useAnnotationWorkflow.ts:615`)
  join the same state as their own sets.
- **Number columns.** Metadata tracks are listed without values and read on
  demand as `{ cellId, value }` lists: `metadataTracks()` and
  `metadataTrackValues(trackId)` on H5AD (`h5adDataset.ts:975`), Atera
  (`ateraDataset.ts:440`), MERSCOPE (`merscopeDataset.ts:355`) and
  SpatialData (`spatialDataDataset.ts:505`). Xenium has none beyond the
  overview columns.
- **Joining IDs to rows.** `PlotStatsStore.setGroups` (`plotStats.ts:150`)
  maps class IDs to rows in the plot worker. It grouped the 1.4 million cells
  of the Xenium demo within 0.7 s ([Phase 22, M2](22-plots-panel.md#m2-progress)).
- **Showing a set of cells.** `Save ROI` adds its cells as a `roi:` class
  ahead of the others and colours cells by annotations
  (`useAnnotationWorkflow.ts:615`). The first class listing a cell gives its
  colour, and cells in no shown class fade (`cellStyling.ts:111`,
  `UNCLASSED_CELL_COLOR` at `:43`).
- **Select and focus.** `handleEmbeddingCellSelect`
  (`useAnalysisEmbeddingWorkflow.ts:176`) selects a cell by ID and calls
  `focusSpatialViewOnCell` (`App.tsx:1456`). The Cell card opens as for a
  click on the canvas.
- **A floating window.** `FloatingWindow`, under `PlotsWindow.tsx` and
  `EmbeddingWindow.tsx`. Window ids for the link are in `shellLinkModel.ts:12`
  and sizes in `floatingWindowModel.ts:4`.
- **A virtualised list.** `GeneOptionList.tsx` draws only the rows in view,
  at a fixed row height with overscan.
- **CSV.** `formatCsv` (`csv.ts:13`) and `downloadTextFile`
  (`appRuntimeModel.ts:472`).
- **A picture renderer outside deck.gl.** `MorphologyCanvas` draws image
  tiles on a 2D canvas for a view state. The main view
  (`ViewerCore.tsx:2171`), the minimap (`ViewerMinimap.tsx:95`) and the SVS
  slide images (`SlideImages.tsx:146`) each use it. It reads every image
  format through `ImagePyramidLoader` (`imagePyramid.ts:108`), and the flat
  Visium images through `flatImage`. `morphologyCanvasChannels`
  (`useViewerLayerData.ts:339`) gives the canvas's channels with their
  colours and contrast.
- **One cell's outline.** `loadSelectedCellBoundary`
  (`cellDetailModel.ts:207`) finds a cell's polygon with a
  `BoundaryElementsLoader` query around it (`appDependencies.ts:107`), for
  the Cell card.

What is missing:

- **No columns by row.** Classes come as ID lists per class, tracks as
  `{ cellId, value }` lists, and overview columns as fields of objects.
  Nothing holds several of them by row, except the plot store for one set.
- **No shared tile cache.** Each `MorphologyCanvas` makes its own
  `TileCache` and `TileRequestScheduler` per channel
  (`MorphologyCanvas.tsx:469` and `:483`), with up to 4 requests in flight
  (`MorphologyCanvas.tsx:25`). Twenty pictures would make up to 80 requests
  at once, and decode a tile shared by neighbouring cells once per picture.
- **Outlines one cell at a time.** On Xenium each lookup is a DuckDB join of
  `cells.parquet` and `cell_boundaries.parquet` over HTTP
  (`xeniumDataset.ts:358`), on one connection.
- **No table component.** The app's three `<table>`s (`ParquetRowsPanel`,
  `ParquetStructureView`, the Plots `Show numbers` table) draw every row.

## Product Decisions

- **D1. Rows are the dataset's cells.** Every cell in `overviewCells`, or
  spot on standard Visium. Not Visium HD bins, not image-only datasets. In a
  collection, the open section.
- **D2. Columns are what the app already reads.**
  - Every annotation set the Clusters list offers, with imported sets and
    saved selections: `is one of` or `is not one of` a pick-list of classes.
  - Metadata tracks: `between`, `at least`, `at most`. A cell with no value
    never matches.
  - Overview columns, where the platform fills them: transcript count, cell
    area and nucleus count as numbers, segmentation method as a category.

  A column is read the first time a condition or a table column uses it,
  and kept for the dataset.

- **D3. Conditions combine with AND.** Classes in one condition combine with
  OR. No nesting. Saved selections as a column cover "in this region".
- **D4. Matching runs in a worker, by row.** A query worker holds the columns
  by overview row: `Float64Array` with `NaN` for missing values, and 16-bit
  class codes with a map for cells in two classes, as the plot store does.
  IDs are mapped to rows once per dataset in the worker. A match is a
  `Uint32Array` of rows, transferred. Edits wait 250 ms; the window shows the
  count as conditions change.
- **D5. A virtualised table.** Rows of fixed height, drawn as
  `GeneOptionList` draws, with no table dependency. Columns: cell ID, a
  column for each condition, and columns the user adds. Sorting by any
  column runs in the worker, which sends the values of the rows in view
  only. Every match is listed: only rows in view are drawn.
- **D6. A row click selects the cell** and moves the view to it, as the
  Embedding panel does (`handleEmbeddingCellSelect`). Arrow keys move
  through rows and Enter selects.
- **D7. Matches show on the canvas once saved.** The window leaves the
  canvas as it is while conditions change. `Save as class` adds the matches
  as one class of a `query:` set ahead of the others and colours cells by
  annotations, as `Save ROI` does: matches take the class colour, and hiding
  the other sets leaves only them, with every other cell faded. Each save
  adds a class, named `Query 1`, `Query 2` and so on, or the name typed
  beside the button. Plots can group by it, and the annotations export
  includes it.
- **D8. Export.** `Export CSV` writes the table's columns for every match.
- **D9. A window like Plots.** `Show Query` sits with `Show Embedding` and
  `Show Plots` in Cells › Panels (**Superseded 2026-11-19:** `Query` in the
  top bar, [Phase 15](15-interface-redesign.md#additions-after-the-close-out)). The window is 520 × 460 by default and at
  least 360 × 300, placed beside the other windows as Plots is (plan 22-D8),
  full width under 860 px. The link keeps it as `panel=query`, and the
  conditions as `query=`.
- **D10. A picture per row (M2).** Each row starts with a picture centred on
  the cell, drawn by `MorphologyCanvas` with the canvas's channels, colours
  and contrast; flat Visium images too. `Picture` offers Off, 20 µm, 40 µm
  and 80 µm across, the same for every row; 40 µm is the default when the
  dataset has an image, and rows grow from 28 to 72 px. The cell's outline
  is drawn over it where the dataset has boundaries, a spot's circle on
  Visium, and otherwise a ring at the cell's position.
- **D11. Pictures share one tile store.** The per-channel `TileCache` and
  `TileRequestScheduler` move out of `MorphologyCanvas` into a store that
  canvases can share. Pictures share one, with at most 6 requests in flight
  in all, no prefetch margin, and rows in view first. The main view and the
  minimap keep their own.
- **D12. Pictures for rows on screen only.** A picture is requested 150 ms
  after its row stops moving and cancelled when its row leaves the view.

## Tasks

- [x] **A. Query columns and worker.** (M) Done in M1.
  - `queryWorker.ts` and a pure `cellQuery` module with `setRows(ids)`, once
    per dataset, and `setCategoryColumn(id, classes)`,
    `setNumberColumn(id, values)`, `match(conditions)`,
    `sort(column, direction)` and `rows(from, count, columns)`.
  - Overview columns go in as typed arrays; tracks as `{ cellId, value }`
    lists, joined by ID in the worker.
  - Tests, with fast-check: the worker's matches equal a plain filter over
    the same cells; missing values never match; a class listing a cell twice
    counts it once; unmatched IDs are counted and reported.
- [x] **B. Conditions editor.** (M) Done in M1. Column picker grouped as Classes,
      Metadata and Cell; operators per kind (D2); a class pick-list with
      search for sets with many classes; number fields with the column's
      range from the track's `min` and `max`. The match count, and each
      column's loading or error state.
- [x] **C. Result table.** (M) Done in M1. Virtualised rows (D5), sticky header, sort
      by header click, `Add column`, cut-short cells with the full text in
      `title`. A pure `cellQueryTableModel` with tests for paging and
      sorting.
- [x] **D. Window, link and selection.** (M) Done in M1.
  - `QueryWindow` on `FloatingWindow`, `Show Query` in Cells › Panels,
    placement and the narrow-screen rule (D9).
  - `panel=query` in `shellLinkModel.ts`; `query=` in `shareableState.ts`,
    with a round-trip test.
  - Row click and keyboard selection (D6).
  - A `query` control area in `src/test/controlAreas.ts`,
    `src/test/appTestHarness.ts` and `tests/e2e/controls.ts`. Gate on the
    platform adapter's `cells` capability and D1.
- [x] **E. Save as class and export.** (S) Done in M1. D7 and D8. Tests: a saved class
      lists the matches, colours them and appears under Plots' `Group by`;
      the CSV matches the table.
- [x] **F. Shared tile store.** (M) Done in M2. Move the per-channel cache
      and scheduler out of `MorphologyCanvas` into a store that can be
      passed in (D11). A refactor with no change in behaviour: the main
      view, minimap and slide images keep their own store, and their tests
      pass unchanged.
- [x] **G. Cell pictures.** (M) Done in M2. A `CellPicture` component: a
      small `MorphologyCanvas` on the shared store, with a view state
      centred on the cell at the chosen field (D10), the outline as SVG
      above it, and the D12 timing. A `Picture` control. Datasets without an
      image show the outline alone.
- [x] **H. Outlines for a page of cells.** (M) Done in M2. One boundary read
      for the rows in view, not one per cell: an optional dataset method
      (`cellOutlines`), a windowed query on Xenium (measured below; a
      `cell_id IN (…)` query was no faster), falling back to a query per
      cell elsewhere.
- [x] **I. Docs and end-to-end tests.** (M) M1's docs, smoke and axe tests
      and the nightly test's time to the first count; M2's docs and the
      nightly test's time to the first page of pictures. Docs listed in
      [Docs To Update](#docs-to-update). E2E on fixtures: open Cell Query
      on the H5AD fixture, add a class and a number condition, sort, select
      a row, save the matches as a class, export CSV. The axe smoke test
      opens the window empty and with a result, and the baseline stays
      `{}`. A nightly `@live` test on the Xenium demo records the time to
      the first count and to the first page of pictures.

## Order And Size

| Milestone            | Contents        | Size              |
| -------------------- | --------------- | ----------------- |
| M1 — Query and table | A, B, C, D, E   | Done (2026-11-18) |
| M2 — Pictures        | F, then G and H | Done (2026-11-18) |
| Throughout           | I               | —                 |

- M1 is useful on its own, and M2 can be measured on real result lists.
- F is a refactor, so it is its own PR, before G.
- The total is about 4½ weeks.
- Tag a release after M1 and after M2.

## M1 Progress

Implemented 2026-11-18 (branch `claude/cell-query-m1`, on the plan's
branch). The window finds cells on every platform with cells or spots but
Visium HD. Checked in the browser on the CELLxGENE Census Visium `.h5ad`
(GSM6592057: `pathologist_annotation` and the T-cells score) and the Xenium
demo (transcript count and graphclust).

Built:

- **A.** `CellQueryStore` (`src/features/query/cellQuery.ts`) holds columns
  by overview row: numbers as `Float64Array` with NaN for no value, classes
  as each row's first class with a map of further ones. `run` filters the
  rows condition by condition and sorts them; `values` gives the columns'
  values for given rows. It runs in `cellQuery.worker.ts` through
  `createCellQuerySession`, which replays the rows and columns on the main
  thread if the worker fails, or without one. A fast-check test matches it
  against a plain filter.
- **B.** `cellQueryModel.ts` lists the columns (`Cell`, `Classes`,
  `Metadata`), each condition's start, and `query=`. `useCellQueryModel`
  reads a column the first time a condition, table column or sort uses it:
  dataset sets through the annotation loader and metadata tracks through the
  track loader (`useOnDemandLoads`), saved selections through
  `useSelectionCells`. `CellQueryPanel` is the editor.
- **C.** `CellQueryTable`: a sticky header with sort buttons, rows of 28 px
  of which only those in view are drawn, an ID button per row, arrow keys,
  Page Up, Page Down, Home and End.
- **D.** `QueryWindow` on `FloatingWindow`, `Show Query` in Cells › Panels,
  `panel=query` and `query=`, placement left of the Embedding and Plots
  windows (Plots now reports its width), one window at a time under 860 px.
  A row click calls the Embedding panel's `handleEmbeddingCellSelect`. A
  `query` control area in the test helpers.
- **E.** `handleSaveQueryAnnotation` in the annotation workflow; `Export
CSV` reads every match from the worker in chunks of 20,000 rows.
- **I, in part.** UI reference, user guide and architecture. Unit tests for
  the store, session, model and link; a component test of the panel on the
  real hook; ShellLayout tests (placement, narrow screens, no viewer render
  while scrolling); an `App.test.tsx` test from a link to a saved class; an
  E2E smoke test (condition, row click, CSV, class); the axe test opens the
  window empty and with a result, and the baseline stays `{}`; a nightly
  `@live` test on the Xenium demo.

Measured on the Xenium demo, 1,414,155 cells (dev build, browser pane):

| Step                                                   | Time                              |
| ------------------------------------------------------ | --------------------------------- |
| Link to the first count (transcripts at least 400)     | 14 s, mostly the dataset's load   |
| Same, headless with software WebGL (`@live` test)      | 37 s                              |
| First read of graphclust's classes for the query       | 5.0 s                             |
| Ticking a class to the new count (87,568 match)        | 0.38 s, with the 250 ms wait      |
| Sorting 318,600 matches by transcript count            | 1.2 s, with the 250 ms wait       |
| Posting 1.4 million cell IDs to a worker (main thread) | 22 ms; building the ID list 10 ms |

Changed from the plan while building:

- **The table keeps its values itself** (D5). The hook gives it
  `readValues(start, end)`; the pages it has read and the rows in view are
  the table's state, so scrolling renders the table alone, not App.
- **Saved classes are a set of their own**, Queries (`query:` IDs), rather
  than joining Save ROI's classes in "Loaded annotations". Plots' default set
  skips them as it skips `roi:` classes.
- **"Not on the map" notes only for imported sets.** A dataset's own columns
  list cells the map leaves out, such as 4,622 Visium spots off the tissue,
  which said nothing useful.
- **A cell column is offered when some cell has a value other than 0**, as
  H5AD cells carry a transcript count of 0.
- **Numbers in the link are written in full** (`String(value)`), so a bound
  at a column's lowest value keeps that cell; `At least` and `At most` write
  only the bound they use. Values under 0.001 show in exponent form, so
  3.9e-14 does not read as 0.
- **Conditions stay when the dataset changes.** One on a column the new
  dataset does not list says so and is left out; sections of a collection
  often share their columns.
- **A dataset set Clusters loads later keeps being read alone** for a
  condition on it, so the condition and the link stay as they were.
- **The window mounts the first time it opens, and draws its body only
  while open.** Mounted and drawn while closed, as the Plots window is, it
  rendered with every App update during a load: a collection App test took
  0.3 s longer (1.55 s against 1.27 s) and its 1 s wait failed under the
  full suite's load. It still stays mounted after closing, to keep its size.

Left for M2 as planned: F (shared tile store), G (cell pictures), H
(outlines for a page of cells), and the nightly test's first page of
pictures (I).

## M2 Progress

Implemented 2026-11-18 (branch `claude/cell-query-tile-store`, on M1's
branch). Checked in the browser on the Xenium demo.

Built:

- **F.** `MorphologyTileStore` (`src/rendering/morphologyTileStore.ts`)
  holds a `TileCache` and `TileRequestScheduler` per channel and contrast,
  and decodes a flat image once. `MorphologyCanvas` takes one as
  `tileStore`, or makes its own as before. The scheduler now takes the
  wanted tiles of several canvases (`client`, `priority`) and releases one
  canvas without cancelling tiles another still wants; `TileRequestSlots`
  caps the requests of several schedulers. The canvas, minimap and slide
  image tests pass unchanged.
- **G.** `CellPicture` and `cellPictureModel.ts`: a 64 px picture centred
  on the cell, in 72 px rows, with the outline as SVG (D10). `Picture` in
  the actions offers `No pictures`, 20, 40 and 80 µm. Checked on standard
  Visium too (the Census `.h5ad`): the hires image with each spot's circle. Only rows in view have
  pictures; a row's picture is read once the table has stopped scrolling for
  150 ms, highest rows first, and a row that leaves the view releases its
  requests (D12). The pictures' store allows 6 requests in flight in all and
  reads no prefetch margin (D11).
- **H.** `CellOutlineReader` reads the outlines of the rows in view as one
  page and keeps them for the dataset. `loadPlatformCellOutlines` uses a
  dataset's `cellOutlines` where it has one, and otherwise the Cell card's
  box read around each cell, three at a time. Xenium's `cellOutlines` reads
  each cell from the rows of `cell_boundaries.parquet` around its overview
  row times the vertices per cell, in one `UNION ALL` query per page.
- **I.** UI reference, user guide and architecture; unit tests for the
  shared scheduler and store, the picture model, the outline reader, the
  Xenium query and the platform loader; component tests of the pictures on
  the real hook and of the D12 timing; the nightly `@live` test records the
  time to the first page of pictures.

Measured on the Xenium demo (dev build, browser pane, 1,414,155 cells, 36
row groups of a million vertices in `cell_boundaries.parquet`, 25 vertices
per cell but for a few). The `cell_id` column has no statistics, and each
row group's vertices span much of the slide, so a cell's 50 µm box still
overlaps 4 to 9 row groups:

| Outlines of 12 cells spread over the slide                           | Time                        |
| -------------------------------------------------------------------- | --------------------------- |
| The Cell card's box read, one cell at a time                         | about 450 ms a cell, warm   |
| One query per cell on the boundaries alone, by box                   | about 200 ms a cell, warm   |
| The same, joined with `UNION ALL`                                    | 8.6 s cold, 3.0 s warm      |
| `cell_id IN (…)` over the whole file                                 | 5.7 s cold, 2.0 s warm      |
| **Rows around overview row × 25, by `file_row_number`, `UNION ALL`** | **2.8 s cold, 0.73 s warm** |
| The same, one cell                                                   | 51 ms                       |

- After sorting 318,600 matches by transcript count, the new rows showed in
  0.9 s and every outline of the page (9 rows) in 1.8 s.
- The first page after opening the link waits for DuckDB to start: 2
  outlines in 4.4 s.
- The nightly `@live` test, headless with software WebGL: the first count
  27.6 s after opening the link, and the first page of pictures with
  outlines 2.9 s later (30.5 s).
- A cell's vertices started at most 27,352 rows before its row × 25; the
  window is 30,000 rows or 0.2% of the file either side, whichever is more.

Changed from the plan while building:

- **Outlines by row, not by ID.** The plan's `cell_id IN (…)` query reads
  the whole `cell_id` column (2 s warm for any page). Each cell's own row
  window lets DuckDB skip all but one row group. The window's bounds are
  cast to `BIGINT`: a number parameter binds as `DOUBLE`, and the cast
  column then skips nothing (4.9 s for 5 cells).
- **The method is `cellOutlines(cells)`**, given each cell's overview row
  and box as well as its ID, so a dataset can find it by either.
- **Visium spots start at 80 µm**, the smallest field that shows a whole
  55 µm spot with a margin; 40 µm would cut its circle off.
- **Pictures show the image even when the canvas hides it**, so the image
  checkbox and opacity are for the canvas alone.
- **The flat Visium image is decoded once per store**, not once per
  canvas: a picture each would hold a copy of the whole image.
- **A page's outlines read after it has scrolled away are kept**, as they
  were read.

- **Unit.** `cellQuery` against a plain filter (fast-check), the table model,
  the `query=` round trip, the picture view state for a cell and a field, and
  the shared store's request limit and cancellation.
- **Component.** The conditions editor and the table from fixtures; pictures
  with a mocked loader, as `MorphologyCanvas.test.tsx` does.
- **`App.test.tsx`.** Open Cell Query from Cells, add a condition on a set,
  check the count, click a row and check the Cell card and the view, then
  save the matches as a class. Tests route their reads through
  `offlineFetch`.
- **E2E and accessibility.** Task I. `nativeTitleAudit` covers every new
  button, field and picture.
- **Redraw guard.** The window sits outside `MemoDeckGL` and goes in the
  no-redraw test: editing conditions, scrolling the table and loading
  pictures must not render DeckGL, which costs about 9 s per render in
  headless runs. `Save as class` renders it once, as `Save ROI` does.

## Docs To Update

- `docs/ui-reference.md`: a Cell Query Panel section beside Plots Panel, and
  Platform Availability, Narrow Screens and the `panel=` and `query=` URL
  keys.
- `docs/user-guide.md`: a walkthrough from a condition to a saved class.
- `docs/architecture.md`: the query worker and the shared tile store.
- `PLAN.md`: the row for this phase.

## Risks

| Risk                                                       | Effect                                                     | Mitigation                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Sending 1.4 million cell IDs to the worker stalls the page | A pause when the window first opens on a large dataset     | Send once per dataset and measure; Xenium IDs as integer pairs, as the plot worker takes them |
| The canvas does not follow the conditions                  | Users expect the matches to show as they edit              | The count and `Save as class` sit together, and the window says matches show once saved       |
| Saved classes pile up                                      | Each save adds a class to the legend and the Clusters list | Each is named and can be removed, with undo, as any class can                                 |
| Pictures are slow from a distant host                      | A page fills in seconds: matches are spread over the slide | Shared store, 6 requests, rows in view only, the 80 µm field reads a coarser level, `Off`     |
| Outline lookups are slow                                   | Pictures wait for outlines, or outlines arrive late        | Draw the picture first; one read per page (task H); a ring at the position as fallback        |
| Picture tiles use too much memory                          | Many full-resolution tiles across the slide                | One bounded cache for all pictures, least recently used out                                   |
| Large typed arrays pass through React props                | React 19 dev walks them on every render; dev tabs crash    | Columns and matches stay in the worker or in `#private` fields, not props                     |
| The picture and the canvas disagree                        | Channels or contrast differ                                | Pictures take `morphologyCanvasChannels`, the canvas's own list                               |

## Later

- AND/OR groups: a condition tree in the editor, the worker and the link,
  about one more week.
- Fading the cells that do not match as conditions change, in every colour
  mode: a row mask where point colours are packed (`packCellPointColors`,
  `ViewerCore.tsx:906`) and in the boundary styler, about M.
- Pictures fitted to each cell's outline.
- Conditions on gene expression, for example "CD3E above 2". The Plots
  panel's whole-dataset reader (`GeneValuesSource`, `geneValues.ts:50`) and
  read budget (`plotReadDecision`, `plotsPanelModel.ts:489`) make this about
  M.
- Text conditions on cell IDs.
- Visium HD bins and segmented cells.
- A gallery view: larger pictures in a grid.
- Exporting the pictures as one image.
- Neighbourhood conditions: within a distance of a class.
- Queries across the sections of a collection.
