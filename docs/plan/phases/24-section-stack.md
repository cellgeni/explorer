# Phase 24 — 3D Section Stack

Implemented 2026-11-18. Not planned in advance. Requested: show consecutive
sections of one block, already registered to each other, in 3D, with cells
and gene expression highlighted through all of them. The sections may be of
any format a collection opens (Xenium, Visium, AnnData).

Current behaviour is documented in
[`docs/dataset-collections.md`](../../dataset-collections.md#3d-stack).

## Product Decisions

- **DECISION:** Stack the sections of a collection's coordinate system, not
  read 3D from SpatialData points or OME-Zarr. Serial sections come from
  several files in their own formats, which the collection already opens and
  registers; SpatialData points are not read yet (see
  [Phase 10](10-spatialdata.md#known-gaps)) and OME-Zarr has no points.
  Reading a SpatialData store's transformations into the same placement is a
  later step.
- **DECISION:** A section's depth is a collection field, `z`, in the units of
  its cells (micrometres). Every section of a coordinate system has one or
  none does, so a stack never guesses an order or spacing; a coordinate
  system without depths can still be shown side by side.
- **DECISION:** The stack draws the collection preview data, as the
  side-by-side panels do: cells, scores and classes, read four at a time. No
  images, boundaries or transcripts.
- **DECISION:** Each section keeps its own gene scale on Auto or a percentile
  top, and a typed top is shared, as in the previews and panels. Sections of
  different platforms (Visium spots, Xenium cells) are not on one scale.
- **DECISION:** The stack opens stretched along z to about a quarter as deep
  as it is wide; `Depth` shows the stretch, ×1 being the true spacing.

## Delivered

- [x] `z` on collection entries (`datasetCollection.ts`, the schema): a
      finite number, needing `coordinateSystem`; a coordinate system that
      mixes entries with and without `z` is refused.
- [x] `stackSections`, `stackFrame`, `openingStackDepthScaleLog2`,
      `sectionModelMatrix` and `stackStatus` (`sectionStackModel.ts`).
- [x] `sectionStackLayers` (`sectionStackLayers.ts`): each section's cells at
      (x, −y), lifted to its depth by a model matrix, so the Depth control
      uploads nothing; cells as billboarded points 10 µm across. Highlighted
      cells (scoring, or in a shown class; all without colouring) write
      depth; the others are a faint outline drawn after them that does not,
      so it never hides them.
- [x] `SectionStackViewer` over the viewer tiles, in a deck.gl `OrbitView`:
      Depth (×¼ to ×128), `Other cells`, the gene scale, reset, `2D View`,
      the sections still being read and those that cannot be shown, and a
      hover tooltip naming the section and the cell, class or score.
- [x] `Stack in 3D` in the collection bar, offered while the open dataset is
      in a coordinate system with depths. Opening a section of a stack keeps
      the 3D view; any other dataset opens in 2D. The stacked sections are
      read as the side-by-side panels are, whether the bar shows them or not.
- [x] `sectionView=3d` in the link; a link's stack opens once the collection
      and its dataset are read. The camera is not kept.
- [x] `sectionOverlay` (`linkedSectionLayers.ts`), shared by the panels and
      the stack.

Checked in the browser with six SPCOX sections given made-up depths (they
are not registered): the sections separate along z as the stack turns, and
hovering names the section and the Aqp4 score.

## Known Gaps

- [x] A truly registered serial-section dataset in the stack (2026-11-18):
      [`examples/zenodo/21110855-liver-sections.json`](../../../examples/zenodo/21110855-liver-sections.json),
      seven LYNX liver Xenium sections 5 µm apart, each opened by a manifest
      in its SpatialData store's `aligned` coordinate system. Pericentral
      CYP3A4 zones run through all seven; the stack settles about 17 s after
      `Stack in 3D` (headless Chromium with the GPU, 34 MB).
- [ ] Cells only: no section images (a coarse level could be a textured
      plane at each depth), boundaries or transcripts.
- [ ] Sections are placed by depth only. Rotation, flips or warping must be
      in the coordinates as read: a SpatialData manifest can choose a
      registering coordinate system, but a per-section transform in the
      collection is not read, and images rotated by it are not shown.
- [ ] Not measured on large stacks (millions of cells). Each section is one
      or two point layers, and picking renders the solid ones on hover.
- [ ] No way to show a range of sections (to see inside the stack), or to
      open a section by clicking it.
- [ ] The 3D camera is not kept in the link.
- [ ] Every cell is drawn 10 µm across, so Visium spots are smaller than in
      the main view, as in the side-by-side panels.
- [ ] No E2E test of what the stack draws. Smoke tests open it only to check
      that its WebGL context is given back (#203) and that axe finds nothing
      (#235).

## Follow-Up (2026-11-20): Cells Placed In 3D In One Dataset

Requested with the EF6 skin file (`aligned_sections_vis.h5ad`, 14 registered
sections, 201,789 cells, in one `.h5ad`): its sections are combined in one
AnnData, registered into one frame, with each cell's section depth in `obs`.
The 2D view drew all fourteen on top of each other, and the stack needs a
collection of separate datasets. Asked: show a dataset whose obsm `spatial`
has three columns in 3D.

- **DECISION:** A third column of obsm `spatial` (or `X_spatial`) is each
  cell's z, in the units of x and y. Other keys' third columns (UMAP, PCA)
  are not depths, and a column that is all one value (zeros padding 2D
  coordinates) or has a non-finite value is ignored. Visium files and
  SpatialData tables place cells in their plane and keep no z.
- **DECISION:** The 2D view is unchanged (every cell in one plane); Cells ›
  Appearance › `View` › `3D` opens the 3D view over the canvas, as the
  Image section's `View` does for a z-stack. One 3D view shows at a time.
- **DECISION:** The 3D view is the stack's viewer with the open dataset as
  its one section and each cell at its own z, so colouring, `Depth`,
  `Other cells`, picking and the gene scale are the stack's. It reads the
  open dataset as a collection preview does (cells, scores, classes), through
  a preview store of its own that reads a large `.h5ad` too, since the main
  view already has it open.
- **DECISION:** `cellView=3d` in the link and `cellView` in manifest
  defaults, as `imageView`.

Delivered:

- [x] `obsmDepths` and `H5adCache.depths` (`h5adDataset.ts`), scaled with
      image-pixel coordinates; `CellOverviewPoint.z`, `OverviewCellDatum.z`.
- [x] `PreviewCells.depths` and `PreviewScores.depths`; the scores read takes
      the cells, to find each scored cell's z (`collectionPreviewData.ts`);
      `openPreviewSource(..., { open: true })` and
      `useOpenDatasetPreviewStore`.
- [x] `sectionStackLayers` draws (x, −y, z) points for cells with depths,
      for cells, scores and classes; `sectionModelMatrix` stretches z, so a
      stack section whose cells have depths is drawn at its z plus theirs;
      `stackDepths`, `stackPickDepth`, `cellViewStatus`.
- [x] `SectionStackViewer` `mode="cells"`: region "3D cells", "N cells, z a
      to b µm", hover "z … µm · cell · class".
- [x] Cells `View` (2D / 3D), shown while the overview cells have z;
      `cellView` link and manifest default; the class-split cache keyed by
      the cells read, not their positions array.

Checked with a copy of the EF6 file whose obsm `spatial` is its
`spatial_3dot` (x, y, z): headless Chromium with the GPU showed the 3D view
3.5 s after the link opened, KRT5 lining the epidermis through the 780 µm,
niches as layers, hover naming the cell's z.

AnnData Zarr stores, and AnnData in Icechunk, build the dataset with the
same `readH5adCacheFromGroup`, so they place cells in 3D with no change of
their own. anndata chunks a large obsm matrix two columns wide, so a store's
z is in chunks of its own, which zarrita's whole-array read joins. The same
copy written by `adata.write_zarr` (100 MB) and served locally showed the 3D
view 1.4 s after the link as Zarr v2 and 1.2 s as Zarr v3, with KRT5
coloured by 2.7 s and 2.4 s. The `stack.zarr` fixture covers it, from
consolidated metadata and from a walk.

Known gaps:

- [ ] A depth only from obsm `spatial`: not an obs column such as `z_um`, nor
      `uns` per-section depths, nor other platforms' z (Xenium cells have
      none; transcripts do).
- [x] The cells of one file cannot be opened a section at a time, nor shown
      side by side: the file is not split into a collection. Closed by the
      next follow-up (#202, 2026-11-20).
- [ ] Other `Cell color` modes (transcript count, cell area, metadata) draw
      every cell grey, as in the stack.
- [ ] No E2E test of what the 3D cell view draws. Smoke tests open it only
      to check that its WebGL context is given back (#203) and that axe finds
      nothing (#235).

## Follow-Up (2026-11-20): Sections Of One Table

Asked with the same EF6 file: open the sections combined in one AnnData as
datasets of their own, the file treated as a collection of sorts, so they
can be stepped through, shown side by side and stacked like a collection's.

- **DECISION:** A section is the rows whose obs column holds one value,
  named by the table's URL and a fragment, `#obs.<column>=<value>`; the
  split is `#obs.<column>`. A fetch drops the fragment and no real dataset
  URL needs one, so a section is a URL like any other: `dataset=` opens it,
  a collection file lists it, the link and the dataset cache key it, with
  no new collection key or link parameter.
- **DECISION:** `collection=` with a table's URL splits it. Without a
  column, by the first obs column named like a section column (`section`,
  `sample`, `library_id`, ...); a table without one stops, listing the
  columns it could be split by. One dataset per value, named by it, in the
  column's order, all in one coordinate system named after the file, since
  they share obsm coordinates; each with a `z` from an obs `z`/`z_…` column,
  else its cells' third obsm `spatial` column, when the section's cells share
  one, and only when every section has one.
- **DECISION:** One read. A section's dataset holds the table's cached
  dataset, retained while held, and is a view of its rows: cell IDs,
  coordinates, depths and obs columns are its rows'; the matrix and obsm are
  the table's, read by the table's rows. Previews of a large `.h5ad`'s
  sections are not refused, since they read the table once in all.
- **DECISION:** Discoverable from the table: the Cells section's
  `Open N Sections` link, shown for an AnnData table opened whole whose
  annotation sets include a column named like a section column.
- **DECISION:** Visium tables are not split: their sections are libraries,
  which the `Library` select already chooses.

Delivered:

- [x] `annDataSections.ts`: section and split URLs, `SECTION_COLUMN_NAMES`.
- [x] `AnnDataH5adDataset` `section` option, `withSection` and the row
      mapping in `matrix()`, `geneExpression()`, `geneValues()` and
      `embeddings()`; `sectionColumns()` and `sections(column)`.
- [x] `detectAnnDataSection` and `sectionSource` in `datasetFactory.ts`;
      `loadDatasetCollection` (`annDataSectionCollection.ts`) as the app's
      collection loader; sections exempt from the preview size refusal.
- [x] A lone section named `table.h5ad · value`; `Open N Sections` in the
      Cells section (`sectionSplitModel.ts`).
- [x] Tests: a tiny `.h5ad` split by strings, codes and numbers, a
      section's reads, release and errors; two sections of the AnnData Zarr
      fixture sharing one read of its obs index; URLs, the loader, the link
      and the name.

Checked on EF6's 116 MB `.h5ad` from Sanger's bucket (14 sections, 201,789
cells), production build, headless Chromium on the Mac's GPU: `collection=`
with the file listed its 14 sections 12 s after the link opened, with
`section_01` (11,832 cells) open; switching to `section_05` took 0.3 s and
the stack of all 14 (z 0 to 780 µm from `z_um`) was ready 0.2 s after
`Stack in 3D`, KRT5 colouring every section and its preview. The
`Open 14 Sections` link on the whole file opened the same collection. A
collection file listing three sections by URL, with its own names and
depths, opened as written.

Known gaps:

- [ ] One column per split, and a value matched as text (a number as
      JavaScript prints it); no section from two columns together.
- [ ] Visium tables are not split, and a split collection's sections cannot
      be shown beside another file's.
- [ ] Each section copies its rows' coordinates and obs columns, about one
      table's worth across all its sections; `embeddings()` reads the
      table's whole obsm matrix for each section.
- [ ] No App test of a split collection, and no E2E test of what it shows:
      a smoke test opens one (`collection=` naming an `.h5ad`) only to check
      the WebGL contexts of its panels and 3D views (#203).
