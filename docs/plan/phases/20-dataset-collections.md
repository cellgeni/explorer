# Phase 20 — Dataset Collections (Recorded From Git)

Shipped from 2026-11-14 to 2026-11-16 (PRs #102, #104, #106, #108, #114,
#127, #128, #137). Not planned in advance. Requested to browse the sections of one
study together, as the [SPCOX WebAtlas page](https://www.sciatlas.org/SPCOX/)
shows one gene across 18 Xenium sections, without a backend.

Current behaviour is documented in
[`docs/dataset-collections.md`](../../dataset-collections.md); the schema is
[`public/schemas/explorer-collection.v1.json`](../../../public/schemas/explorer-collection.v1.json).

## Product Decisions

- **DECISION:** A collection is a JSON file listing entries that `dataset=`
  can open (a folder, file, store or dataset manifest), each with an optional
  `name` and `group`, plus optional `defaults` for the first dataset opened.
  `collection=<url>` opens it. Validation is strict and reuses the manifest's
  field checks, so errors read the same.
- **DECISION:** Previews are drawn in the browser from each dataset's own
  loaders and per-URL caches, so a previewed dataset also opens faster. No
  server renders them.
- **DECISION:** A collection's datasets are expected to share genes and
  annotation columns. Switching datasets keeps the genes, the `Cell color`
  mode, `Combine genes`, the annotation set with its hidden classes and
  colours, and the metadata column.
- **DECISION:** Collections without a published licence and citation go in
  `docs/collections/`, not `examples/`, where both are required.

## Delivered

- [x] Format and address (#102, 2026-11-14): `parseDatasetCollection`
      (`src/datasets/datasetCollection.ts`) and its schema. `collection=` is
      written to the hash and dropped from the query string. Switching uses
      the shared-link restore path. A dataset outside the collection closes
      it. A link's `view=` now applies only to the dataset it names; before,
      every later dataset in the session kept that camera.
- [x] Previews (#102): `rasterizePreview` bins cells into a canvas, taking the
      highest score per pixel on the main view's square-root scale.
      `CollectionPreviewStore` reads only the cards in view and just beyond,
      four datasets at a time, and nothing while the main view loads. Images
      and Visium HD show "No cells to preview"; a plain `.h5ad` over 64 MiB is
      skipped. `Previews` turns them off.
- [x] Annotations across datasets (#104, 2026-11-15): AnnData classes come in
      category order, so a class gets the same colour in every section.
      Colours are carried through a switch (not written into links).
      Previews draw the annotation set, with hidden classes grey, and count
      the shown classes' cells. `Expand` lays the previews out as a grid over
      the canvas.
- [x] Collection bar icon buttons for Expand and Previews; hidden classes
      fade in the view and the previews (#106, 2026-11-15).
- [x] `docs/collections/spcox.json` (18 Xenium sections and the snRNA-seq
      atlas, AnnData Zarr) and `docs/collections/gbm-space.json` (97 Visium
      sections from 12 patients and a 1,025,329-nucleus atlas, #108).
- [x] Images and label boundaries for AnnData entries (#114, 2026-11-15):
      `image`, `labels`, `coordinates` (`micrometers` or `image-pixels`) and
      `labelColumn`. A collection's images are registered before any dataset
      or preview opens, and a link naming a collection and a dataset waits
      for the collection. H5AD manifests take the same fields
      ([Phase 11](11-dataset-manifest.md)).
- [x] `cellPointScale` (#103) and `geneRange` (#128) defaults. On Auto or a
      percentile top, each preview runs to the percentile of its own drawn
      pixels; a typed top is shared to compare levels (#128, 2026-11-16).
- [x] `collectionView=grid` or `names` keeps the bar's Expand and Previews
      state in the link (#127, 2026-11-16).
- [x] Registered sections side by side (#137, 2026-11-16). Entries with the
      same `coordinateSystem` are registered to each other; the viewer
      registers nothing itself. With one open, the bar gives the others a
      `Show {label} beside` toggle, up to three panels beside the main view
      (two viewers side by side, three in a row, four in a 2×2 grid, stacked
      under 860 px). `LinkedViewChannel` (`src/components/linkedView.ts`)
      gives every viewer one view, followed exactly rather than within
      `equivalentViewState`'s tolerance. Panels (`LinkedSections`) draw the
      collection preview data as 10 µm points, coloured as the main view
      colours cells; `Open` swaps a panel with the main view at the same view.
      `compare=` is written once per panel, in order. The preview store moved
      to App so the bar and the panels share one set of reads, and previews
      no longer drop cells.

Measured in the browser:

- SPCOX: the 8 previews in view fill about 5 s after the first dataset opens;
  a gene change takes about 2.7 s and 1.5 MB; a previewed section opens in
  0.5 s against 2.5 s for one not yet previewed. Per-section Aqp4 maxima equal
  the portal's.
- GBM-space: GFAP maxima match the portal for the 11 sections compared; the
  atlas opens in about 25–30 s.

## Known Gaps

- [ ] Collections cannot be opened from `Load Dataset`. Since 2026-11-19
      the gallery lists collections in `examples/` (a `collectionUrl`
      instead of a `manifestUrl` in `index.json`, which older viewers
      skip), but a card is a `collection=` link that reloads the viewer.
- [ ] No previews by metadata column, and no sorting of previews by
      expression.
- [ ] Class colours are not written into links.
- [ ] No embedding docked next to the spatial view.
- [ ] `labels` needs an `image` to be placed on, and an image group inside a
      SpatialData store is read without the store's transformations.
- [ ] Side-by-side panels show cells only: no image, boundaries, transcripts
      or tools. Every cell is drawn 10 µm across, so Visium spots are smaller
      than in the main view, and Visium HD and image-only datasets have no
      preview, so they cannot be panels.
- [ ] Side by side has unit and App tests but no E2E test of what the
      panels draw (a smoke test opens them only to check that their WebGL
      contexts are given back, #203), and has been checked in the browser
      only on SPCOX sections marked as one coordinate system, which are not
      truly registered.

## Closed Open Items

Found by the [2026-11-16 review](../open-items.md#found-by-the-2026-11-16-review):

- [x] A `compare=` in a link's query string was not removed once the hash
      was written (only `collection=` was), and the hash overrode the query
      string only for the keys it set (`readShareableStateFromLocation`), so
      closing that panel and reloading brought it back. Any value a version
      2 hash leaves out as the default did the same, such as genes removed
      from a `?genes=` link. Since 2026-11-16 a version 2 hash is read as the
      whole link, and once the hash is written the query string keeps only
      keys a link does not set, such as `debug=`
      (`searchWithoutLinkState` in `useShareableUrlHash.ts`). The query
      string's `dataset=` goes too, as the hash names the dataset.
