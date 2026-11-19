# Phase 22 — Plots Panel

Planned 2026-11-16. M1 (dot plot on loaded data) and M2 (datasets read over
HTTP) implemented 2026-11-16, M3 (violin and heatmap) 2026-11-17; see
[M1 Progress](#m1-progress), [M2 Progress](#m2-progress) and
[M3 Progress](#m3-progress). Requested: exploratory plots like those in
Scanpy, Seurat and CELLxGENE VIP, client side. The scope is a floating Plots
panel with three plots of the selected genes, grouped by the classes of an
annotation set, with the active selection as an extra group:

- a dot plot;
- a violin plot;
- a group-mean heatmap.

The user decided on 2026-11-16:

- Phase 15's non-goal stands: no differential expression between arbitrary
  groups and no clustering. The plots summarise what the dataset already
  holds. They rank nothing and test nothing.
- Only the three plots above in this phase.
- SVG for the dot plot and violin, which is accessible and exports for
  figures; canvas for the heatmap.

The plan rests on a code map made on 2026-11-16 at `bea26d2`, rechecked the
same day at `4038ada`. It is cited below as `file:line`; line numbers drift as
the code changes.

Sizes are for one developer: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

## Goals And Non-Goals

Goals:

- One Plots panel, opened from the Cells section, that plots each selected
  gene against the classes of an annotation set and the active selection.
- Values from every cell of the dataset, not the viewport, so the plots do not
  change as the view moves.
- Xenium, Atera, standard Visium, MERSCOPE, H5AD (file, reference, Icechunk,
  AnnData Zarr) and SpatialData.
- Each plot exports as SVG, with a CSV of the numbers behind it.
- The axe baseline stays empty and `nativeTitleAudit` passes.

Non-goals:

- Differential expression, marker ranking between groups, p-values, and
  clustering (Phase 15 non-goal, kept 2026-11-16). That includes ordering
  groups by a dendrogram, which clusters the groups. The Selection card's
  Enriched genes ranking stays as it is.
- Normalisation by library size. Values are what the matrix stores, with an
  optional log1p display (D4).
- Reading `/raw` or `/layers` of AnnData.
- Visium HD. Its bins have no annotation sets: `annotations()` rejects
  (`visiumHdDataset.ts:159`) and `capabilities.annotations` is `false`
  (`platformAdapter.ts:194`). See [Later](#later).
- Image-only datasets, and collections (one dataset at a time).
- Plots beyond the three above. Candidates are under [Later](#later).

## Current State

What the panel can take as it is:

- **Selected genes.** `selectedGenes` is React state
  (`useAppDomainState.ts:487`), kept sorted by `toggleGene` (`App.tsx:2092`),
  in the link as `genes=`.
- **Annotation classes.** `annotationState` holds the loaded classes and the
  set's `groupId`. `annotationStyleColors` (`useViewerLayerData.ts:167`) gives
  `{ id, label, cellIds, color }` per class with the legend's colours, and
  `visibleAnnotationState` (`App.tsx:876`) leaves out hidden sets and classes
  (`hiddenClasses=`). The Embedding panel already takes these
  (`App.tsx:4156`). Labels arrive as one list of cell IDs per class
  (`Annotation`, `spatialDataset.ts:145`). Imported files (`custom:…`) and
  saved selections (`roi:…`) join the same state as their own sets.
- **Active selection.** `roiCellIds`, from `platformRoiElementIds`
  (`platformAdapter.ts:466`), lists its members on every platform. The
  Embedding panel uses it too. Xenium ROI queries stop at 50,000 cells
  (`roiCells.ts:8`); AnnData has no limit.
- **A floating window.** `EmbeddingWindow.tsx`: 360 × 400 by default, at
  least 280 × 260, a resize grip, Escape to close, focus return, `hidden`
  while closed, full width under 860 px. It opens from
  Cells › `Show Embedding`, and `panel=embedding` keeps it in the link
  (`shellLinkModel.ts:12`).
- **Stats for one group.** `summarizeRoiGeneExpression`
  (`roiGeneStats.ts:104`) already computes detected cells, % of cells and mean
  per cell for each gene.
- **Downloads.** `downloadTextFile` (`appRuntimeModel.ts:462`) writes text
  files. There is no helper for binary files.

What is missing:

- **No read gives a gene's value in every cell.**
  `geneExpression(bbox, genes)` sums the selected genes into one score per
  cell and is bounded by the view, a limit and a stride (`xeniumDataset.ts:104`,
  `h5adDataset.ts:734`). `matrix(ids)` reads every gene for the cells it is
  given. Neither can feed a plot.
- **Several reads drop values of 0 or less** (`h5adDataset.ts:3790`,
  `xeniumDatasetReaders.ts:618`, `visiumFeatureSliceH5.ts:192`). That is right
  for colouring, but a violin of a scaled `X` with negative values would be
  wrong.
- **No charts to reuse.** The app has no SVG charts. Its two histograms are
  CSS grids of `<span>` bars (`CellInfoPanel.tsx:205`,
  `MorphologyChannelControls.tsx:189`). The Embedding canvas hard-codes its
  colours (`EmbeddingPanel.tsx:339`) because a canvas cannot read CSS
  variables.

Readers that already read one gene across the whole dataset, inside the
platforms:

| Platform                                                 | Reader to build on                                                                                                                              | Matrix layout                                        | One gene, every cell                                                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Xenium                                                   | `selectedGeneRowsFromCellFeatureMatrixZarr` (`gex.ts:519`): each gene's expressing rows and counts, by matrix row. Up to 32 genes (`gex.ts:96`) | Feature-major `cell_features`, in every XOA version  | SNAP25 on the 1.4M-cell demo: 2.1 s cold ([optimization pass](optimization-pass.md)). Graph clusters are also stored by matrix row (`analysisAnnotations.ts:92`)                           |
| Atera                                                    | private `geneColumn` (`ateraDataset.ts:710`), last 64 genes cached                                                                              | CSC `csc_cell_feature_matrix.zarr.zip`               | About 1.7 MB for a typical gene ([Atera](../../modalities/atera.md))                                                                                                                       |
| Standard Visium, MERSCOPE, H5AD up to 300 MiB            | `h5adMatrixForCells` (`h5adDataset.ts:3307`), which keeps values per gene                                                                       | In memory after load: CSR, CSC or dense              | No reads. A CSR scan over every non-zero on the main thread: 230–270 ms per gene on the SpatialData Visium table ([open items](../open-items.md))                                          |
| H5AD by reference or Icechunk, AnnData Zarr, SpatialData | The same code, as `csc-zarr`, `csr-zarr` or dense Zarr                                                                                          | `indptr` in memory; `data` and `indices` read lazily | CSC: one column slice. CSR: all of `/X`. Heart file, MYH7: CSC 2 requests, 0.04 MB, 0.17 s; CSR 770 requests, 4.6 MB, 19.6 s ([H5AD reference](../../h5ad-reference.md)). Dense: see below |

Dense Zarr depends on the chunks. The hindlimb store, chunked by gene, reads one
4.8 MiB chunk per gene. Zarr's default chunks for the same shape (1,969 × 406)
would read 64 chunks, about 195 MiB decoded, for one gene.

## Product Decisions

- **D1. The panel uses the app's genes.** It plots the selected genes in the
  order of the gene chips, each gene on its own. `Combine genes` does not
  apply. The panel has no gene picker of its own. Up to 32 genes, the
  Xenium reader's limit; with more selected, it plots the first 32 and says
  so.
- **D2. Groups are the classes of one set.** `Group by` lists the sets loaded
  in the Annotations section: the dataset's set, each imported file's sets,
  and the selections kept with `Save ROI`. It defaults to the dataset's set
  (`groups=`). Classes of a set are matched by the `${groupId}:` id prefix,
  not by
  `annotationSetIdForAnnotation`, which gives a different id for Xenium
  (`annotationModel.ts:165`). Classes keep the legend's order and colours.
  Hidden classes are left out, and the panel says how many. Dot plot and
  violin show up to 60 classes and the heatmap up to 500. Over that, the
  panel shows the first ones in legend order and says to hide classes to
  choose others.
- **D3. The selection is an extra group.** With a selection active, one more
  group named after it ("ROI 1"), in its selection colour, comes first. Its
  cells stay in their classes too, so it overlaps them. Only the active
  selection is a group; selections kept with `Save ROI` are a set under
  `Group by` (D2). When the Xenium ROI query stopped at 50,000 cells, the
  group is those cells and says so.
- **D4. Values as stored, with a log1p display.** Xenium, Atera, standard
  Visium and MERSCOPE give raw counts; AnnData gives whatever `X` holds.
  `Scale` offers `log1p` and `As stored`. The default is `log1p` when every
  value read is a whole number, and `As stored` otherwise. Means, quartiles
  and densities are taken after the transform. "% expressing" is the share of
  cells with a stored value above 0, as in the Selection card. When `X` holds
  negative values, `log1p` is disabled and the panel says the values look
  scaled. Axis titles name the transform: "log1p(counts)", "X".
- **D5. Every cell counts; nothing is sampled.** Readers return each gene's
  non-zero rows. Zeros are implied: a group's zero count is its size less its
  non-zero rows. That makes every number exact and the cost O(non-zeros).
  Violins come from a histogram of each group's values, on one grid for all
  groups of a gene, smoothed with a Gaussian kernel. Quartiles come from
  sorting the non-zero values with the zeros counted. No jittered points.
- **D6. Groups join by matrix row, in a worker.** A group is a code per
  matrix row (`Uint16Array`, or `Uint32Array` above 65,535 classes) plus a
  member list for the selection. Where a dataset already holds labels by row,
  as Xenium graph clusters (`analysisAnnotations.ts:92`) and H5AD categorical
  codes (`h5adDataset.ts:282`) do, they are used as they are. Imported files
  and the selection come as cell IDs. They are mapped to rows in the worker,
  because building a `Map` of a million IDs on the main thread took 1–2 s
  during load. Statistics are computed in a new plot worker. The main thread
  only draws.
- **D7. A read budget, checked before reading.** Each backend estimates the
  bytes the selected genes need before it reads. Xenium, Atera, CSC and
  in-memory tables always pass. CSR over HTTP needs all of `/X`, and dense
  Zarr needs every chunk that holds the genes. Up to 32 MiB the panel reads
  at once. Between 32 and 256 MiB it shows the estimate and waits for
  `Read`. Over 256 MiB, the same budget as
  `DENSE_ZARR_CELL_PROFILE_MAX_BYTES` (`h5adDataset.ts:434`), it says why and
  reads nothing. Xenium output with no readable `cell_feature_matrix.zarr.zip`
  is not offered.
- **D8. A window like Embedding.** `Show Plots` sits beside `Show Embedding`
  in the Cells section (**Superseded 2026-11-19:** both are top bar toggles,
  [Phase 15](15-interface-redesign.md#additions-after-the-close-out)). The window is 480 × 420 by default and at least
  320 × 280. It stays in the link as `panel=plots`, with the plot as
  `plot=dot|violin|heatmap`. It opens at the top right; when Embedding is
  open, it opens to the left of it (**Changed 2026-11-19:** at full size as
  far left as it fits, over Embedding, when the canvas is too narrow for both;
  [Phase 15](15-interface-redesign.md#additions-after-the-close-out)). Under
  860 px both are full width, so
  opening one closes the other. The controls are `Plot` (Dot plot, Violin,
  Heatmap), `Group by`, `Scale`, and for the dot plot and heatmap `Colour`
  (Shared across genes, Per gene, like Scanpy's `standard_scale='var'`).
  Colours use the `Gene scale` palette.
- **D9. SVG for dot plot and violin, canvas for the heatmap.** The SVG plots
  are React components drawn from a plot model and styled with the CSS
  tokens. Each mark has a `<title>` for hover. The `<svg>` has `role="img"`
  and a summary label. `Show numbers` swaps the plot for a table of the same
  values, which is also the accessible alternative. The heatmap is a canvas,
  scaled for the device pixel ratio like the Embedding plot. It reads its
  colours from the tokens with `getComputedStyle` once, so they are not
  hard-coded. Its group and gene labels are DOM text around the canvas, and
  hover is a hit test on the grid. The canvas suits sets with hundreds of
  classes: 500 × 32 is 16,000 squares.
- **D10. Export from the model.** `Export SVG` writes each plot from its
  model, with colours and fonts inlined so the file renders outside the app.
  The heatmap's SVG is written from the model too, so it does not depend on
  the canvas. `Export PNG` (heatmap) and `Export CSV` (every plot: group,
  gene, cells, % expressing, mean, median, quartiles) as well. File names are
  `{dataset}-{plot}-{set}.{ext}`.
- **D11. Hover only.** Tooltips give the group, gene, cells, % expressing,
  mean and median. Clicks do nothing in this phase: hiding a class from the
  plot would also hide it on the canvas (D2), and making a gene the only
  selected gene would cut the plot to that gene.
- **D12. Reads arrive gene by gene.** Plots draw each gene as it arrives,
  under "Reading 12 of 32 genes" with `Cancel`. Changing the genes, set or
  dataset cancels the reads in flight. Each gene's error is shown in its row
  or column; the rest still plot. Gene values are cached per dataset in a
  128 MiB LRU in the worker, and the statistics are kept, so changing `Plot`
  or `Scale` reads nothing.

## Tasks

- [x] **A. Whole-dataset gene reader.** (L) In memory done (M1); HTTP,
      Xenium, Atera and the budget done (M2).
  - Add an optional dataset method, `geneValues(genes, { signal })`. It
    returns the matrix row count and, for each gene, `rows: Uint32Array` and
    `values: Float32Array` of its non-zero cells, with negative values kept.
    Add `estimateGeneValuesBytes(genes)` for D7.
  - Backends:
    - Xenium: `selectedGeneRowsFromCellFeatureMatrixZarr`, in batches of 32.
    - Atera: `geneColumn`.
    - AnnData in memory: one pass over the non-zeros for all genes at once,
      looking up each gene index in a table, so 32 genes cost one scan.
      Yield between chunks. This also serves standard Visium and MERSCOPE.
    - AnnData over HTTP: column slices for CSC; the gene's chunks for dense
      Zarr; batched reads of all of `/X` for CSR, under the budget.
  - Expose row identity: `cellIdForRow`, and for Xenium the matrix row of
    `cells.parquet` cells, using the row-alignment check the expression
    overlay already makes once per dataset.
  - Tests: each backend on the existing fixtures. A property test that values
    match `matrix(ids)` for sampled cells. Negative values kept. The budget
    refuses without a request.
- [x] **B. Groups by row.** (M) Done in M1; the selection is a row mask, not
      a sorted list. Row-indexed labels were dropped in M2: joining by ID is
      fast enough on 1.4 million cells (see [M2 Progress](#m2-progress)).
  - `groupCodes(set)` returns a code per row and the classes in legend
    order. It uses row-indexed labels where a dataset has them (D6), and maps
    cell IDs to rows in the worker otherwise.
  - The selection is a sorted `Uint32Array` of rows.
  - The panel reports cells whose IDs match no row, and cells listed in
    two classes of one imported set (counted in both).
  - Tests: Xenium graph clusters by row; H5AD codes; an imported CSV with
    missing and repeated IDs; a selection that overlaps classes.
- [x] **C. Plot statistics worker.** (M) Counts and means done (M1);
      quartiles and densities done (M3).
  - A pure `plotStats` module and `plotStats.worker.ts`. Per gene and group:
    cells, cells expressing, % expressing, mean, median, quartiles, minimum,
    maximum, and a density on a 128-step grid. Zeros implied from the group
    size (D5). Transform applied first (D4).
  - Transfers typed arrays in and out; computes a gene as it arrives.
  - Tests, with fast-check: means and quartiles match a dense computation;
    % in 0–100; each density sums to 1; an empty group gives no density, not
    `NaN`.
- [x] **D. Plots window and wiring.** (M) Done in M1; `Plot` and `plot=`
      done (M3).
  - Extract the shared parts of `EmbeddingWindow` (resize grip, Escape,
    focus return, clamping) into a `FloatingWindow`, without changing the
    Embedding window's behaviour. Then build `PlotsWindow` on it.
  - `Show Plots` in the Cells section, `panel=plots` and `plot=` in
    `shellLinkModel.ts` and `shareableState.ts`, placement beside Embedding
    (D8), and the narrow-screen rule.
  - Controls of D8, and the states: no genes selected, no set loaded, over
    the budget, reading, cancelled, errors.
  - A pure `plotsPanelModel` with tests. A `plots` control area in
    `src/test/controlAreas.ts`, `src/test/appTestHarness.ts` and
    `tests/e2e/controls.ts`. Gate on the platform adapter's `cells` and
    `annotations` capabilities.
- [x] **E. Dot plot (SVG).** (M) Groups down, genes across, as in Scanpy. Dot
      area for % expressing, with a size legend (20, 40, 60, 80, 100 %). Dot
      colour for mean, with a colour bar. Long labels are cut short with the
      full text in `<title>`. `Show numbers` table.
- [x] **F. Violin (SVG).** (M) One row per gene, a violin per group, so
      several genes stack as in Scanpy's stacked violin. Every violin has the
      same maximum width. A box for the quartiles and a line at the median.
      `Include zeros` (on) shows the zero spike that dominates sparse genes;
      off shows expressing cells only and says so in the axis title.
- [x] **G. Group-mean heatmap (canvas).** (M) Groups down, genes across.
      Colours from the tokens and the Gene scale palette, DOM labels, hover
      by hit test, and `Colour` shared or per gene (D8). It goes in the
      no-redraw test with the other overlays.
- [x] **H. Export.** (S) SVG and CSV done (M1); PNG done (M3). `downloadBlob` beside `downloadTextFile` for PNG.
      SVG, PNG and CSV as in D10. Tests check that an exported SVG parses and
      holds a mark per group and gene, and that the CSV matches the plot
      model.
- [x] **I. Docs and end-to-end tests.** (M) Docs, smoke and axe tests for
      M1 and M2, and the nightly Xenium test, done; switching plots and the
      PNG done (M3).
  - Docs listed in [Docs To Update](#docs-to-update).
  - E2E on fixtures: open Plots on the H5AD fixture, switch the three plots,
    export a CSV. The axe smoke test opens Plots empty and loaded, and the
    baseline stays `{}`.
  - One nightly live test on the Xenium demo with SNAP25 and the graph
    clusters, recording the time to the first plot.

## Order And Size

| Milestone                    | Contents                                                                   | Size          |
| ---------------------------- | -------------------------------------------------------------------------- | ------------- |
| M1 — Dot plot on loaded data | A (in-memory backend), B, C (counts and means only), D, E, H (SVG and CSV) | about 3 weeks |
| M2 — Datasets read over HTTP | A (Xenium, Atera, AnnData over HTTP, the budget)                           | about 1 week  |
| M3 — Violin and heatmap      | C (quartiles and densities), F, G, H (PNG)                                 | about 2 weeks |
| Throughout                   | I                                                                          | —             |

- M1 works on standard Visium, MERSCOPE and H5AD files up to 300 MiB, where
  the matrix is already in memory, so it is useful before any new read path.
- The total is about 6 weeks. This is more than the "M–L" given on
  2026-11-16 before the code map. That estimate counted the panel and plots,
  but no read today gives a gene in every cell (task A).
- Tag a release after M1 and after M3.

## M1 Progress

Implemented 2026-11-16 (branch `claude/plots-panel-m1`). The dot plot works on
standard Visium, MERSCOPE and `.h5ad` files read whole. Other datasets say
the panel is not available yet. Checked in the browser on the CELLxGENE
Census Visium `.h5ad` (GSM6592057), plotting `pathologist_annotation` and a
box selection.

Built:

- **A, in memory.** `geneValues`, `geneValuesRowIds` and
  `estimateGeneValuesRead` on `AnnDataH5adDataset`, delegated by
  `MerscopeDataset` (`src/data/geneValues.ts`). CSR is one scan for all the
  genes, yielding every million stored values; CSC and dense are read per
  gene. A matrix read over HTTP gives `{ kind: 'unavailable' }`.
- **B and C, counts and means.** `PlotStatsStore` (`plotStats.ts`) maps class
  and selection IDs to rows once per set, then sums each gene's stored values
  into the groups of their rows. It runs in `plotStats.worker.ts` through
  `createPlotStatsSession`, or on the main thread without a worker. It keeps
  up to 128 MiB of gene values, least recently used first out.
- **D.** `FloatingWindow`, extracted from `EmbeddingWindow` with no change to
  the Embedding window's behaviour. `PlotsWindow` opens from Cells ›
  `Show Plots`, sits left of an open Embedding window, and under 860 px
  closes the other window. The link keeps it as `panel=plots`.
  `usePlotsWorkflow` reads only genes the worker lacks. `usePlotsModel`
  holds `Group by`, `Scale`, `Colour` and `Show numbers`.
- **E.** The dot plot is built as an SVG node tree (`dotPlot.ts`,
  `svgMarkup.ts`). React renders that tree in the panel, and the same tree
  is written out for export.
- **H, SVG and CSV.** `Export SVG` writes colours and the font out from the
  tokens. `Export CSV` holds both means.
- **I, in part.** The UI reference, user guide and architecture docs. A
  `plots` control area. An `App.test.tsx` test (link, numbers, no re-read,
  a drawn selection). A smoke E2E test that exports the CSV. The axe smoke
  test covers Plots empty and with a dot plot; the baseline stays `{}`.

Changed from the plan while building:

- **Sets are grouped as the Clusters lists group them**
  (`annotationSetGrouping`), not by the `${groupId}:` prefix (D2). The lists
  already give one id per set on every platform, Xenium included, and
  hidden sets use the same ids. The default is the first set with a class
  that is not a saved selection, since `Save ROI` puts its class first.
- **Codes are 16-bit with a map of further classes** for cells that two
  classes list (D6). Plots cap classes far below 65,535, so `Uint32Array`
  codes are not needed.
- **Row-indexed labels are not used yet** (B). Every set's IDs are mapped in
  the worker, which is fast at the sizes M1 reads. Using Xenium graph
  clusters and H5AD codes by row moves to M2, with the Xenium reader.
- **Both sums are kept.** The worker sums the stored values and their log1p
  together, so changing `Scale` computes nothing.
- **`Plot` and `plot=` wait for M3.** There is only one plot until then.
- **`downloadBlob` waits for PNG (M3).** SVG and CSV are text.
- **Cells › Embedding became Cells › Panels.** It holds `Show Embedding` and
  `Show Plots` side by side. Visium HD, whose bins have no sets, has no
  `Show Plots`. **Superseded (2026-11-19):** the toggles are in the top bar.

Left for M2 and M3 as planned: the Xenium, Atera and HTTP AnnData readers, and
the D7 budget (M2); quartiles, densities, the violin, the heatmap and PNG
export (M3); the nightly live test (I).

## M2 Progress

Implemented 2026-11-16 (branch `claude/plots-panel-m2`, on M1). The panel
reads every platform but Visium HD: Xenium, Atera, and AnnData and
SpatialData tables read over HTTP. Checked in the browser on the Xenium demo,
the Atera kidney run, the SpatialData Visium store and the hindlimb AnnData
Zarr store.

Built:

- **A, over HTTP.** Three readers in `geneValues.ts`, each given the
  dataset's own reads: `geneValuesFromColumnSlices` (CSC over HTTP, Atera's
  CSC, Xenium's feature-major `cell_features`), `geneValuesFromCsrBatches`
  (all of a CSR `X`, in batches of whole rows, every gene in one pass) and
  `geneValuesFromDenseChunks` (the dense Zarr chunks that hold the genes,
  each read once). Each has an estimate beside it.
- **Xenium.** `geneValuesFromCellFeatureMatrixZarr` and its estimate
  (`gex.ts`) read `cell_features/indptr` once per dataset, then each gene's
  slice. Row IDs go to the worker as the `cell_id` integer pairs
  (`GeneValuesRowIds`), and the worker makes them text with
  `xeniumCellIdText`, built from character codes.
- **Atera** reads the CSC columns through the overlay's gene cache.
  **SpatialData** delegates to its table.
- **The budget (D7).** `estimateGeneValuesRead` gives the bytes a read
  decodes and a sentence on how the layout sets them. The workflow reads up
  to 32 MiB at once; to 256 MiB it waits for `Read`; over that it refuses,
  keeping the genes already plotted. `plotReadDecision` holds the rule.
- **I.** A nightly `@live` test plots SNAP25 by the Xenium graph clusters and
  records the time to the first plot. Docs: UI reference, user guide,
  architecture, the H5AD, Xenium, Atera and SpatialData modality pages and
  the H5AD reference's CSR or CSC table.

Measured in Chromium with the GPU (Playwright, from Sanger's network):

| Dataset                                  | Read                                       | Time                     | Requests, download |
| ---------------------------------------- | ------------------------------------------ | ------------------------ | ------------------ |
| Xenium demo, 1.4 M cells, graph clusters | SNAP25, feature-major slice                | 0.7 s after the clusters | Included in load   |
| Atera kidney, 93,864 cells, 47 classes   | 3 genes, CSC columns                       | 2.3 s from opening       | 262, 7.3 MB        |
| SpatialData Visium, CSR, 29.7 M values   | 2 genes, all of `X` after `Read` (227 MiB) | 7.3 s                    | 525, 16 MB         |
| Hindlimb AnnData Zarr, dense by gene     | 3 genes, one chunk each                    | 0.4 s                    | 7, 2.7 MB          |

No run had a main-thread task over 200 ms that the same link without the
panel did not have. On the Xenium demo a box selection's group held 5,303
cells, as the Selection card did, with no unmatched IDs.

Changed from the plan while building:

- **Row-indexed labels are not used** (B, D6). Joining by cell ID in the
  worker grouped 1.4 million Xenium cells within the 0.7 s above. The
  Xenium IDs are what cost time, and the worker now makes them. Using
  graph-cluster rows or H5AD codes directly would mean a second annotation
  format through the app for no measured gain.
- **Sizes are bytes decoded, not downloaded.** Chunk sizes on the server are
  not known without a request per chunk. The panel says "uncompressed".
  The SpatialData Visium table is 227 MiB of values and indices but 16 MB to
  download.
- **`Read` covers later reads up to its size.** A CSR matrix reads all of
  `X` for any gene, so asking again for each gene added would repeat the
  same question.
- **No alignment check for Xenium rows.** The panel joins by cell ID, so
  matrix rows and `cells.parquet` rows need not agree.
- **A Xenium output without `cell_feature_matrix.zarr.zip` fails** with a
  message naming the file (and `Try again`), rather than being hidden. The
  file is missing only from hand-made outputs, and a network error looks the
  same until it is retried.

Left for M3 as planned: quartiles, densities, the violin, the heatmap, PNG
export, and `Plot` with `plot=`.

## M3 Progress

Implemented 2026-11-17 (branch `claude/plots-panel-m3`, on M2). The panel
draws all three plots. Checked in Chromium with the GPU on the Atera kidney
run (3 genes by 47 classes) and the Xenium demo (2 genes by 24 graph clusters
and a box selection), including each plot's PNG export.

Built:

- **C, quartiles and densities.** For each gene the worker sorts each
  group's stored values once, places the implied zeros among them, and
  gives the minimum, quartiles, median and maximum on both scales, for every
  cell and for the expressing cells (`PlotDistribution`, `plotStats.ts`).
  Quartiles are interpolated linearly, as numpy's default. Densities are 128
  steps of the gene's range, each value split between its two nearest
  steps, smoothed with a Gaussian of Scott's width (scipy's `gaussian_kde`,
  behind seaborn's and Scanpy's violins) reflected at both ends. Tests check
  them against a dense computation with fast-check, and that each density
  sums to 1.
- **D, `Plot` and `plot=`.** `Plot` (Dot plot, Violin, Heatmap) sits first
  in the controls; App keeps it, seeded from `plot=` and written back with
  the link. `Colour` shows for the dot plot and heatmap, `Include zeros` for
  the violin. The class limit follows the plot: 60, 60 and 500.
- **F.** `violinPlot.ts` builds the model, the SVG and the table. Rows are
  96, 72 or 60 px tall for up to 3, 8 or more genes.
- **G.** `HeatmapFigure` draws the tiles on a canvas for the device pixel
  ratio, with the labels and colour bar as DOM text and hover by the tile
  under the pointer. Its hover state stays in the component; a shell test
  checks that hovering renders the viewer no more. Its SVG is the dot plot's
  grid with tiles (`meansGridSvg`).
- **H.** `Export PNG` draws the plot's SVG on a canvas at twice its size
  (`svgPngBlob`, `downloadBlob`). The CSV is on the plot's scale with a
  `values` column, and adds the median, quartiles, minimum and maximum, and
  the median and quartiles of expressing cells.
- **I.** The smoke E2E test switches to the violin and heatmap, hovers a
  tile, checks `plot=` and exports a PNG; the axe test covers both plots and
  the baseline stays `{}`. `App.test.tsx` switches plots without a second
  read. Docs: UI reference (controls, method, `plot=`), user guide,
  architecture.

Measured in Chromium (Playwright, Metal):

| Dataset                               | Switch to violin | Switch to heatmap | Stats after the read |
| ------------------------------------- | ---------------- | ----------------- | -------------------- |
| Atera kidney, 93,864 cells, 47 groups | 134 ms           | 32 ms             | —                    |
| Xenium demo, 1.4 M cells, 25 groups   | 82 ms            | 85 ms             | 0.2 s for 2 genes    |

The switch times include Playwright's round trips. On the Xenium demo the
link with the panel had the same main-thread tasks over 200 ms as the link
without it, all during the dataset's load.

Changed from the plan while building:

- **PNG for every plot**, not only the heatmap: the PNG is drawn from the
  SVG, so it costs nothing more per plot.
- **No whiskers.** A line from each group's lowest to highest value drew the
  eye to single outlying cells on sparse genes; the plan's box and median
  line remain, and the violin itself runs from the lowest to the highest
  value.
- **The CSV is on the plot's scale** with a `values` column, in place of
  M1's `mean` and `mean_log1p`, so its medians and quartiles match the
  plot.
- **Densities for up to 64 groups.** The heatmap shows up to 500 classes
  and needs no densities, so the worker skips them past 64 groups.
- **Labels on the canvas side are DOM text, the canvas is `aria-hidden`**,
  and the figure around it is the labelled image, so the canvas has no
  native title competing with the hover text.

## Testing

- **Unit.** Pure tests for `plotStats`, `groupCodes`, `plotsPanelModel`, each
  backend of `geneValues`, and the plot models behind the SVGs.
- **Component.** The SVG plots render from fixtures; assertions are on marks
  and labels, not pixels. The heatmap's canvas is mocked as in
  `EmbeddingPanel.test.tsx`, and its model is tested on its own.
- **`App.test.tsx`.** Open Plots from Cells, load an annotation set, check
  the dot plot's rows, switch `Group by`, and draw a selection to add its
  group. Tests route their reads through `offlineFetch`.
- **E2E and accessibility.** Task I. `nativeTitleAudit` covers every new
  button, select and canvas.
- **Redraw guard.** The Plots window sits outside `MemoDeckGL` and goes in
  the no-redraw test, since each DeckGL render costs about 9 s in headless
  runs.

## Docs To Update

- `docs/ui-reference.md`: a Plots Panel section beside Embedding Panel, with a
  method note: values as stored, the log1p display, "% expressing" as values
  above 0, implied zeros, and that the plots compare nothing statistically.
  Also Platform Availability, Narrow Screens and the `panel=` and `plot=` URL
  keys.
- `docs/user-guide.md`: a walkthrough from selecting genes to an exported
  dot plot.
- `docs/architecture.md`: `geneValues`, the plot worker, and the join by
  row.
- `docs/modalities/*.md` and `docs/h5ad-reference.md`: which layouts hit the
  budget (CSR over HTTP, dense Zarr with wide chunks) and what the panel
  says.
- `PLAN.md`: the row for this phase.

## Risks

| Risk                                                               | Effect                                             | Mitigation                                                                                |
| ------------------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Plots read as differential expression                              | Users draw conclusions the plots do not support    | The method note; no p-values or ranking; the selection group says it overlaps the classes |
| AnnData scans and zarrita reads run on the main thread (open item) | Stutter while 32 genes are read on a large table   | One pass for all genes (task A); yield between chunks; statistics in the worker           |
| Gene values use too much memory                                    | A dense or scaled `X` holds a value for every cell | 128 MiB LRU per dataset; statistics kept after values are evicted                         |
| CSR over HTTP is slow under the budget too                         | A 200 MiB read can take minutes from a slow host   | Over 32 MiB the panel shows the estimate and waits for `Read` (D7)                        |
| Matrix rows and `cells.parquet` rows disagree on Xenium            | Cells land in the wrong groups                     | Reuse the overlay's row-alignment check; on a mismatch, map by cell ID in the worker      |
| The panel and the legend disagree on classes                       | Confusing counts                                   | Both take `visibleAnnotationState`; the panel says how many classes are hidden            |
| A second floating window crowds the canvas                         | The Plots and Embedding windows cover each other   | D8 placement; one at a time under 860 px                                                  |

## Later

Not in this phase. None of these is differential expression or clustering.

- A cells × genes heatmap, with cells sampled per group.
- Violins with jittered points.
- Plots of numeric obs columns per class (counts, area, genes per cell).
- Class shares per selection or section.
- Gene against gene, coloured by class.
- Clicking a group to show it on the canvas.
- Reordering genes in the panel.
- Visium HD, once its bins have classes.
