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
      [`docs/collections/lynx-liver.json`](../../collections/lynx-liver.json),
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
- [ ] Unit and App tests only; no E2E test.
