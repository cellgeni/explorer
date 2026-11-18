# Phase 23 — Cell Query

Planned 2026-11-18. Not started. Requested: filter the cells of a dataset by
their observations, classes, annotations and metadata, list the cells that
match in a table, and show a picture of each cell in its row.

The scope is a floating Cell Query window with two parts:

- conditions on the columns the app already reads, and a table of the cells
  that match, linked to the canvas (M1);
- a picture of each listed cell, cut from the dataset's image with the
  canvas's channels and contrast, with the cell's outline (M2).

The decisions below are **proposed** defaults, not yet confirmed by the user.
[Questions For The User](#questions-for-the-user) lists the ones that change
the size.

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
- The matches can be shown on the canvas, saved as a class, and exported as
  CSV.
- A picture of each listed cell, drawn only for the rows on screen.
- The axe baseline stays empty and `nativeTitleAudit` passes.

Non-goals:

- Conditions on gene expression. See [Later](#later).
- Nested or OR-combined conditions (D3).
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
- **Fading only under Annotations.** Cells in no shown class fade
  (`UNCLASSED_CELL_COLOR`, `cellStyling.ts:43` and `:126`), but only when
  cells are coloured by annotations. Other colour modes have no way to fade a
  set of cells.
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

## Product Decisions (Proposed)

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
- **D7. Matches show on the canvas by fading the rest,** in every colour
  mode, under a `Show on canvas` checkbox (on). The fade is applied where
  colours are packed (`packCellPointColors`, `ViewerCore.tsx:906`) and in the
  boundary styler, so cells keep their colours.
- **D8. Save and export.** `Save as class` adds the matches as one class of
  a `query:` set, as `Save ROI` adds a `roi:` class, so Plots can group by it
  and the annotations export includes it. `Export CSV` writes the table's
  columns for every match.
- **D9. A window like Plots.** `Show Query` sits with `Show Embedding` and
  `Show Plots` in Cells › Panels. The window is 520 × 460 by default and at
  least 360 × 300, placed beside the other windows as Plots is (plan 22-D8),
  full width under 860 px. The link keeps it as `panel=query`, and the
  conditions as `query=`.
- **D10. A picture per row (M2).** Each row starts with a picture centred on
  the cell, drawn by `MorphologyCanvas` with the canvas's channels, colours
  and contrast; flat Visium images too. `Picture` offers Off, 20 µm, 40 µm
  and 80 µm across; 40 µm is the default when the dataset has an image, and
  rows grow from 28 to 72 px. The cell's outline is drawn over it where the
  dataset has boundaries, a spot's circle on Visium, and otherwise a ring at
  the cell's position.
- **D11. Pictures share one tile store.** The per-channel `TileCache` and
  `TileRequestScheduler` move out of `MorphologyCanvas` into a store that
  canvases can share. Pictures share one, with at most 6 requests in flight
  in all, no prefetch margin, and rows in view first. The main view and the
  minimap keep their own.
- **D12. Pictures for rows on screen only.** A picture is requested 150 ms
  after its row stops moving and cancelled when its row leaves the view.

## Questions For The User

1. AND only (D3), or AND/OR groups? Groups add a condition tree to the
   editor, the worker and the link: about one more week.
2. Fade the rest of the canvas in every colour mode (D7), or show matches
   only through `Save as class`? The second saves task E.
3. A fixed picture size (D10), or one fitted to each cell's outline? Fitting
   needs the outline before the picture.
4. Outlines on pictures (D10)? Without them task I goes, and pictures need
   no boundary reads.
5. Standard Visium spots in scope (D1)?

## Tasks

- [ ] **A. Query columns and worker.** (M)
  - `queryWorker.ts` and a pure `cellQuery` module with `setRows(ids)`, once
    per dataset, and `setCategoryColumn(id, classes)`,
    `setNumberColumn(id, values)`, `match(conditions)`,
    `sort(column, direction)` and `rows(from, count, columns)`.
  - Overview columns go in as typed arrays; tracks as `{ cellId, value }`
    lists, joined by ID in the worker.
  - Tests, with fast-check: the worker's matches equal a plain filter over
    the same cells; missing values never match; a class listing a cell twice
    counts it once; unmatched IDs are counted and reported.
- [ ] **B. Conditions editor.** (M) Column picker grouped as Classes,
      Metadata and Cell; operators per kind (D2); a class pick-list with
      search for sets with many classes; number fields with the column's
      range from the track's `min` and `max`. The match count, and each
      column's loading or error state.
- [ ] **C. Result table.** (M) Virtualised rows (D5), sticky header, sort
      by header click, `Add column`, cut-short cells with the full text in
      `title`. A pure `cellQueryTableModel` with tests for paging and
      sorting.
- [ ] **D. Window, link and selection.** (M)
  - `QueryWindow` on `FloatingWindow`, `Show Query` in Cells › Panels,
    placement and the narrow-screen rule (D9).
  - `panel=query` in `shellLinkModel.ts`; `query=` in `shareableState.ts`,
    with a round-trip test.
  - Row click and keyboard selection (D6).
  - A `query` control area in `src/test/controlAreas.ts`,
    `src/test/appTestHarness.ts` and `tests/e2e/controls.ts`. Gate on the
    platform adapter's `cells` capability and D1.
- [ ] **E. Fade on the canvas.** (M) A row mask into the packed point
      colours and the boundary styler (D7), in every colour mode. One
      repack per applied query, not per keystroke.
- [ ] **F. Save as class and export.** (S) D8.
- [ ] **G. Shared tile store.** (M) Move the per-channel cache and scheduler
      out of `MorphologyCanvas` into a store that can be passed in (D11).
      A refactor with no change in behaviour: the main view, minimap and
      slide images keep their own store, and their tests pass unchanged.
- [ ] **H. Cell pictures.** (M) A `CellPicture` component: a small
      `MorphologyCanvas` on the shared store, with a view state centred on
      the cell at the chosen field (D10), the outline as SVG above it, and
      the D12 timing. A `Picture` control. Datasets without an image show
      the outline alone.
- [ ] **I. Outlines for a page of cells.** (M) One boundary read for the
      rows in view, not one per cell: an optional dataset method
      `boundariesForCells(ids)`, a `cell_id IN (…)` query on Xenium and the
      readers' own lookups elsewhere, falling back to a query per cell.
      Measure on the Xenium demo before choosing.
- [ ] **J. Docs and end-to-end tests.** (M) Docs listed in
      [Docs To Update](#docs-to-update). E2E on fixtures: open Cell Query
      on the H5AD fixture, add a class and a number condition, sort, select
      a row, export CSV. The axe smoke test opens the window empty and with
      a result, and the baseline stays `{}`. A nightly `@live` test on the
      Xenium demo records the time to the first count and to the first page
      of pictures.

## Order And Size

| Milestone            | Contents         | Size          |
| -------------------- | ---------------- | ------------- |
| M1 — Query and table | A, B, C, D, E, F | about 3 weeks |
| M2 — Pictures        | G, then H and I  | about 2 weeks |
| Throughout           | J                | —             |

- M1 is useful on its own, and M2 can be measured on real result lists.
- G is a refactor, so it is its own PR, before H.
- The total is about 5 weeks. Question 1 adds about a week; question 2
  (fade through `Save as class` only) and question 4 (no outlines) each
  save about 3 days.
- Tag a release after M1 and after M2.

## Testing

- **Unit.** `cellQuery` against a plain filter (fast-check), the table model,
  the `query=` round trip, the picture view state for a cell and a field, and
  the shared store's request limit and cancellation.
- **Component.** The conditions editor and the table from fixtures; pictures
  with a mocked loader, as `MorphologyCanvas.test.tsx` does.
- **`App.test.tsx`.** Open Cell Query from Cells, add a condition on a set,
  check the count, click a row and check the Cell card and the view. Tests
  route their reads through `offlineFetch`.
- **E2E and accessibility.** Task J. `nativeTitleAudit` covers every new
  button, field and picture.
- **Redraw guard.** The window sits outside `MemoDeckGL` and goes in the
  no-redraw test: scrolling the table and loading pictures must not render
  DeckGL, which costs about 9 s per render in headless runs. Applying a query
  with `Show on canvas` renders it once.

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
| Fading repacks every cell's colour                         | Each applied query costs what a colour mode change costs   | Repack per applied query, after the 250 ms wait; the redraw guard                             |
| Pictures are slow from a distant host                      | A page fills in seconds: matches are spread over the slide | Shared store, 6 requests, rows in view only, the 80 µm field reads a coarser level, `Off`     |
| Outline lookups are slow                                   | Pictures wait for outlines, or outlines arrive late        | Draw the picture first; one read per page (task I); a ring at the position as fallback        |
| Picture tiles use too much memory                          | Many full-resolution tiles across the slide                | One bounded cache for all pictures, least recently used out                                   |
| Large typed arrays pass through React props                | React 19 dev walks them on every render; dev tabs crash    | Columns and masks stay in the worker or in `#private` fields, not props                       |
| The picture and the canvas disagree                        | Channels or contrast differ                                | Pictures take `morphologyCanvasChannels`, the canvas's own list                               |

## Later

- AND/OR groups (question 1).
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
