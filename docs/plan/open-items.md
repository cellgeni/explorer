# Open Items

Every unchecked item in this plan. On 2026-11-12 each item was checked against
the code at `35479d6`. None of the items open on 2026-11-09 had been finished;
where part of one exists, a note says which part. Four small items were closed
the same day, and later that day the items sized as half a day or less, except
deploy previews. On 2026-11-16 the PRs merged since the split (#82 to #129)
were checked against the plan. The gaps in work it had missed are listed
here and in Phases 7, 20 and 21.

Later on 2026-11-16 a project review rechecked every item against the code at
`bea26d2`. None had closed (PRs #130 to #138 closed none of them); notes say
where part of one now exists. The review also indexed the Known Gaps that
only the phase files listed (under each feature below, or
[Known Gaps From The Phase Files](#known-gaps-from-the-phase-files)), and
recorded what a read of the code found that no file had
([Found By The 2026-11-16 Review](#found-by-the-2026-11-16-review)).

On 2026-11-24, after the ten-pass
[code review](phases/feature-fix-pass.md#code-review-2026-11-19-to-2026-11-24)
and its fixes (#203 to #424), every item was checked again against the code
at `24f0fd2`. None had closed. Parts of 11 had, and their notes now say
which; wording the code no longer matched was corrected, and gaps that only
the phase files listed were added to their items. One item was added: the
review's single-key shortcut lead, as decided on 2026-11-24.

This page lists open work only. When an item closes, it moves under Closed Open
Items in the phase or track file it belongs to. The items closed before the
plan was split (2026-11-13) moved there then.

Sequencing:

- [ ] Feature-fix pass: keep recording fixes until correctness is stable (see
      [Feature-Fix Pass](phases/feature-fix-pass.md)).
- [ ] Optimization pass: interaction, memory, fetch/decode concurrency, and
      rendering cost, without behaviour changes. Planned 2026-11-25 as 21
      tasks in six milestones
      ([Plan](phases/optimization-pass.md#plan-2026-11-25)), which lists the
      items on this page that each task takes.

Other gaps found in the review:

- [ ] Main-thread exceptions to the worker convention: hyparquet reads other
      than the Xenium overview, SpatialData shapes and imported vector
      segmentations, which have workers of their own (Visium HD positions and
      barcode mappings; the positions decode for about 0.6 s in short tasks,
      measured 2026-11-17), and the fetching and assembly in zarrita reads. The
      AnnData table code also runs there, for both H5AD backends. On the
      598,222-cell 460-plex zip that is making the cell IDs unique (about 240 ms
      in one task, a `Map` of all 598,222), converting numeric columns to number
      arrays (110–145 ms over 20 columns) and counting the distinct values of
      string columns (about 110 ms); the CSR scan for a gene took 230–270 ms on
      the SpatialData Visium table. The moves so far, with their measurements,
      are under
      [Worker Moves](phases/optimization-pass.md#worker-moves-2026-11-13).
      Not listed until 2026-11-16: an annotation file named by
      `annotationUrl=` (`customAnnotations.ts`) and an embedding's projection
      CSV (`analysisEmbeddings.ts`) are parsed there too.
- [ ] Per-URL caches that are never released (found 2026-11-16): one
      h5wasm worker per matrix file (`h5MatrixCache` in `gex.ts`, which also
      keeps `h5WorkerFile.ts`'s `FinalizationRegistry` from closing it), the
      Feature Slice files (`visiumFeatureSlice.ts`), transcript Zarr metadata
      (`transcriptZarr.ts`) and the TIFF loader's open files and pyramids
      (`clearOpenTiffFiles` is called only by tests). Collections make this
      matter more, since one tab can now open many datasets. Zip and
      Icechunk stores were listed here too, but each keeps only the four used
      last (`zarrZipStore.ts`, `icechunkStore.ts`), and the H5AD tissue image
      blob URLs are shared per library and revoked when the dataset is
      disposed (#301, 2026-11-22). The dataset instances themselves are
      bounded since 2026-11-18 (`datasetCache.ts`): the viewer retains the
      dataset it shows, a preview the one it reads, and of the rest the two
      used last are kept; older ones are disposed, which closes a
      `XeniumDataset`'s DuckDB client and an H5AD's file worker. These caches
      could hang off the same retain.
- [ ] Dataset manifest: declare files absent; set the H5AD coordinate key,
      annotation set, channel colours and contrast, and initial camera (see
      [Phase 11](phases/11-dataset-manifest.md)).

Found by the [15.5-E](phases/15-interface-redesign.md#155-close-out) re-run (2026-11-12):

- [ ] A raised toast can cover an open card: at 1024 px with the layer panel
      open the canvas is 664 px wide and the card stack 360 px, so no position
      clears the card, the legend and the minimap at once: `ShellLayout`
      raises a toast clear of the legend and the minimap only. Found
      2026-11-12. Partly done: under 860 px toasts rise above a docked card's
      sheet (#408, 2026-11-24).
- [ ] The Xenium demo blocks the main thread for up to 4 s at a time in the
      first 30 s after load; see the main-thread exceptions above. 15.5-E put
      this on the viewport warm-up ("Preparing cell feature matrix"). CPU
      profiles over CDP on 2026-11-12 (headless Chromium with GPU, fresh and
      warm profiles; stalls of up to 1.8 s here) put it on the load instead:
      hyparquet decoding `cells.parquet` for the overview (0.4–0.6 s; in a
      worker since 2026-11-13), the first render with the overview layer
      build (2.3–3.0 s), and the first JPEG 2000 morphology decode
      (0.6–0.7 s; auto-contrast's, in workers since 2026-11-13). The
      warm-up's cell query runs in DuckDB's worker. The H5 download (above)
      was not part of these: its 1.3–1.7 s block came when the download
      ended, 63–70 s after load, and would land in the first 30 s only above
      about 20 MB/s. That block is gone with the fix. Of the three, only the
      first render with the overview layer build is still on the main
      thread; the stalls have not been measured again since.

Decided after the
[code review](phases/feature-fix-pass.md#code-review-2026-11-19-to-2026-11-24)
(2026-11-24):

- [ ] A Settings switch that turns the single-key shortcuts off (the tool
      letters, `F`, `\` and `?`), on by default and remembered in the
      browser. They work anywhere but in a text field and cannot be turned
      off, remapped or limited to the focused view, as WCAG 2.1.4 asks; 10x
      Explorer's shortcuts work the same way. The review left this as a lead for a
      decision.

Added 2026-11-26:

- [ ] Xenium runs zipped whole. A `.zip` holding `experiment.xenium` is
      detected as a Xenium run and refused, because only the main thread's
      `fetch` answers `<zip url>/<path>` from the zip (`zipFolder.ts`), and
      Xenium reads in workers: DuckDB, the H5 matrix and the Parquet
      workers. Atera runs open from a zip since 2026-11-18 (see
      [Phase 12](phases/12-atera.md#zipped-runs)). The workers would need the
      zip's directory to turn inner paths into byte ranges themselves. The
      one public Xenium zip found, GEO GSM7780153 (XOA 1.0.1, 9.9 GB), stores
      its four `*.zarr.zip` but deflates everything else, the morphology
      TIFFs (628 MB to 5.2 GB) included, so its image cannot be read by tile.

Features:

- [ ] `t` selection for OME-Zarr, and a `Z plane` control for custom image
      layers (OME-TIFF and OME-Zarr dataset images have one). The 3D view
      does not show OME-TIFF z-stacks or custom layers, nor cells and
      transcripts in 3D, does not know the GPU's real 3D texture limit, and
      is not kept in the link (see
      [Phase 9](phases/09-ome-zarr.md)). Time points, Play and labels that
      follow the image's plane are in [Phase 28](phases/28-time-points.md)
      (PR 431, 2026-11-25). Its M4 has not been implemented: the screenshot
      PNG's time point, Cell Query paused during Play, the docs pass, the
      SpatialData `t` fixture, end-to-end, axe and nightly live tests
      ([M4 Status](phases/28-time-points.md#m4-status-2026-11-25)). Only the
      3D view at a time point and two gallery examples were built.
- [ ] H5AD: `/layers/*` and `/raw/X`, and richer schema diagnostics. Only
      `/X` is read. Worker-backed lazy Range reads are done (2026-11-17): a
      plain `.h5ad` over 64 MiB is read by range in the H5 worker, walking
      only the groups the viewer reads, and one over 300 MiB opens without a
      companion, which is read only when the file cannot be read by range
      ([Phase 7](phases/07-h5ad.md#range-reads-2026-11-17)).
      Diagnostics check that the file answers Range requests (a warning, not
      a failure, for a file of up to 300 MiB, which is downloaded whole; #370,
      2026-11-23), or, for an Icechunk repository or an AnnData Zarr store,
      read the first `/X` chunk; they do not check that the walk stays small.
      Collection previews still refuse a plain `.h5ad` over 64 MiB.
- [ ] AnnData Zarr: zipped stores, stores written before anndata 0.8 (no
      root `encoding-type`) at a URL that does not end in `.zarr`, and an
      abort signal for `matrix()` (see
      [Phase 7](phases/07-h5ad.md#anndata-zarr-stores-2026-11-14)). Partly
      done: pre-0.8 stores at a `.zarr` URL open by their `obs` dataframe
      (#170, 2026-11-18), and node names with `%`, `#` or `?` open (#274,
      2026-11-21).
- [ ] SpatialData: rotated or sheared images, `points` (transcripts), Magic
      Lens, and viewport-scoped shape reads; also labels drawn as a raster
      rather than traced outlines, nucleus labels,
      polygons with holes or several parts (only the outer ring of the
      largest part is kept), and HTTP diagnostics beyond the first 2,000
      table chunks (string arrays first since #369, 2026-11-23) and the
      first chunk of the coarsest level (see
      [Phase 10](phases/10-spatialdata.md#known-gaps)). Partly done: the info
      drawer picks one table and one image at a time (a Visium HD store opens
      on its coarsest bins). Since 2026-11-17 nucleus shapes are drawn,
      flipped and axis-swapped images (STHELAR's H&E) are shown, and zipped
      stores have every chunk diagnosed. Points are not read; the 460-plex
      store's carry x/y row-group statistics but no page index, so a 100 µm
      view would read 4.7 million rows. Shapes are read whole, in a worker
      since 2026-11-13, then filtered to the viewport. spatialdata-io's
      `shapes.parquet` cannot be read by viewport: the 460-plex
      `cell_boundaries` is one row group of 598,222 rows with no per-shape
      bounding-box column. Since 2026-11-18 the image opens alongside the
      table when the units are known without it (an override, declared axis
      units, or a Xenium table's `pixel_size`). With estimated units it still
      waits for the region shapes; it could open at 1 µm per unit and be
      rescaled. The cells wait for the region shapes even when
      `obsm/spatial` could place them.
- [ ] Collections: open them from `Load Dataset` (the start-screen gallery
      lists them since 2026-11-19, as a `collection=` link that reloads the
      viewer), previews by metadata and sorted by expression, class colours
      in links, an embedding beside the view, `labels` without an `image`,
      and the transformations of an image group inside a SpatialData store.
      Side-by-side panels show cells only (no image, boundaries, transcripts
      or tools), and Visium HD and image-only datasets cannot be panels (see
      [Phase 20](phases/20-dataset-collections.md#known-gaps)).
- [ ] 3D section stack: cells only (no section images, boundaries or
      transcripts), placed by depth only (no per-section transform or
      SpatialData transformations), not measured on large stacks, no section
      range or click to open, camera not in the link, every cell drawn 10 µm
      across, and no E2E test of what it draws, since smoke tests open the
      stack, the 3D cell view and a table split into sections only to check
      WebGL contexts and axe (see
      [Phase 24](phases/24-section-stack.md#known-gaps)). The 3D view of one
      dataset's cells takes z only from a third obsm `spatial` column (see the
      [follow-up](phases/24-section-stack.md#follow-up-2026-11-20-cells-placed-in-3d-in-one-dataset)).
      A table's sections split by one obs column, and not a Visium table's
      (see [Sections Of One Table](phases/24-section-stack.md#follow-up-2026-11-20-sections-of-one-table)).
- [ ] Imported segmentations: outlines take no part in ROI selections, the
      Selection card or Cell Query, so there is no table to count or export;
      GeoJSON class names and colours (QuPath's `classification`) are not
      read; Cellpose's stripped masks decode whole rows across the slide for
      each view; a Zarr label image cannot be picked as a local folder; other
      platforms cannot import one; and no test has used a real Cellpose run
      over a hosted NDPI (see
      [Phase 25](phases/25-imported-segmentations.md#known-gaps)).
- [ ] Store and file browser: non-Zarr files in consolidated stores read over
      HTTP, and SpatialData points as one table rather than part by part;
      also min and max for binary columns, Rows for writers that store a
      column chunk as one page (fastparquet; since #387, 2026-11-24, Rows
      reads 40 columns at a time, so such a chunk is read whole for each of
      the first 40), the drawer covering the open-dataset form in a narrow
      window, HDF5 browsed only from the dataset field (not from a store's
      tree, a zip or a local file), and HDF5 plugin filters (LZF, Blosc,
      bitshuffle, Zstandard) with no decoder (see
      [Phase 21](phases/21-structure-browser.md#known-gaps)). Partly done:
      Browse File is offered for a SpatialData shapes element's
      `shapes.parquet` that a consolidated store does not list
      (`parquetFileOf` in `storeStructureModel.ts`).
- [ ] SVS: read an Aperio FL scan's `.afi` file as one image with a channel
      per listed file (each file opens on its own now). Also: Zenodo's
      `/api/records/…/content` URLs are not detected (see
      [Phase 16](phases/16-svs.md#known-gaps)).
- [ ] NDPI: files over 4 GB (64-bit offsets; test files and what support
      needs in [Phase 19](phases/19-ndpi.md#64-bit-ndpi-files-over-4-gb)),
      NDPI URLs without a `.ndpi` suffix (a manifest image under 4 GB is
      recognised by its format tag), a `Z plane` control for other focal
      planes, the macro image, and decoding blocks with the browser's JPEG
      decoder (see [Phase 19](phases/19-ndpi.md#known-gaps)). Also: a level
      whose restart intervals do not divide its MCU rows fails when its tiles
      load rather than at open, and no fluorescence NDPI has been tried.
- [ ] The Zarr transcript estimate counts every transcript in a tile, so it
      ignores `Min QV` and `Gene-only calls` (87.5% of a sampled demo tile
      passes the defaults) and assumes even density within each 250 µm tile.
- [ ] Codeword-level density (needs a dataset with `/density/codeword`).

Original-brief items with no outcome:

- [ ] `metrics_summary.csv` QC display (not read; papaparse not adopted).
- [ ] Memory ceiling with eviction telemetry beyond tile caches. Partly done:
      budgets scale with device memory, and the tile LRU (with eviction
      telemetry), the OME-Zarr chunk cache and the IndexedDB cache each evict
      on their own. There is no app-wide ceiling.

Testing:

- [ ] Make the coverage job required, once the timing-sensitive `App.test.tsx`
      checks pass under coverage on the runner. The condition is met: the job
      passed in all 87 completed CI runs of 2026-11-15 and 2026-11-16. Left:
      drop `continue-on-error` from `ci.yml` and make the job a required check
      (an admin setting); see
      [Testing And CI](engineering.md#testing-and-ci). `main` has no branch
      protection or rulesets, so today no check blocks a merge at all;
      protecting it with the existing checks comes first. On 2026-11-24 the
      coverage job failed on #409 and #411, and the required job on #412 and
      #420, from a flaky `MorphologyCanvas` tile-retry test (added in #405,
      fixed in #426: an early timer now waits for the cache's retry time)
      and `App.test.tsx` timeouts.
- [ ] E2E for SpatialData, OME-Zarr, and image-only sources. Partly done: the
      nightly examples test loads an OME-Zarr, a QPTIFF, and a SpatialData
      store (Zarr v2 with circle shapes). Smoke tests load a Zarr v3
      SpatialData store with an image, circles and a sharded table (#197), an
      OME-Zarr z-stack in the 3D view (#203), and OME-TIFF images and a plain
      TIFF with a label mask (#193, #205, #234, #255); a live test loads a
      zipped SpatialData store (STHELAR, #162). Icechunk and
      labels-annotated SpatialData stores are tested by hand.
- [ ] E2E for features that shipped without it: `compare=` and the
      collection grid, Browse Store and Browse File, SVS, NDPI, GeoJSON
      import and export, and load errors. Every test runs in desktop
      Chromium. The axe walk does not reach side-by-side panels or the
      structure drawer. The Xenium, Visium HD and STHELAR live tests and the
      nightly examples fail rather than skip when their storage is down.
      Details in [Testing And CI](engineering.md#open). Found 2026-11-16.
      Partly done: smoke tests open collections (the bar, previews, Expand,
      side by side and Stack in 3D) and a plain TIFF (#193, #203, #206, #218,
      #235, #407); smoke tests run at 390 × 844, 320 × 640, 844 × 390 and
      320 × 180 as well as the desktop size (#206, #234, #406, #407); and the
      axe walk reaches the collection bar and the 3D views (#206, #235).
- [ ] Unit coverage gaps in rendering and workers: `gridBinLayer.ts`, the
      chunk cache in `zarrDecode.worker.ts`, `visiumHdOverview.ts`,
      `omeZarrPixels.ts`, and S3 listing pagination in `zarrFolderLister.ts`
      (see [Testing And CI](engineering.md#open)). Found 2026-11-16. Partly
      done: `viewerPicking.ts` is now reached through the `ViewerCore` tests
      (82% of lines on 2026-11-24, from 28%).
- [ ] Deploy previews for pull requests. `pages.yml` deploys only pushes to
      `main`. Checked 2026-11-12: Pages deployed from Actions serves one site
      with no per-PR paths, so a preview URL needs the Pages source switched
      to a `gh-pages` branch (an admin setting) with a folder per PR. A build
      is about 95 MB, 77 MB of it the two DuckDB WASM files, so each push adds
      that to the branch's history and the 1 GB site limit holds about nine
      previews. Without a URL, CI could upload each PR's build as an
      artifact.
- [ ] The golden fixture bundle (a committed, Xenium-shaped one).
- [ ] Restore `--audit-level=high` for the dev tools' audit in `audit.yml`
      once `picomatch` fixes
      [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
      (high, ReDoS, every release up to 4.0.7, which was still the latest on
      2026-11-24). Since 2026-11-17 it fails only on critical advisories (see
      [Testing And CI](engineering.md#open)).

## Known Gaps From The Phase Files

Open items that only their phase files listed, indexed on 2026-11-16. The
phase files hold the details; gaps that belong with an item above were added
to it.

- [ ] GeoJSON: the `visible` property is not imported, and shapes are not
      saved in the shareable URL
      ([Phase 8](phases/08-image-only-geojson.md#known-gaps)). Partly done: a
      feature's `id` is kept as its object ID and exported again (#288,
      2026-11-22).
- [ ] OME-Zarr chunks read over HTTP are not kept in the IndexedDB cache;
      only zipped stores use it ([Phase 9](phases/09-ome-zarr.md)).
- [ ] QPTIFF: the stripped smallest pyramid level is not shown, and a QPTIFF
      cannot be placed over Xenium
      ([Phase 13](phases/13-qptiff.md#known-gaps)).
- [ ] Standard Visium: `spaceranger aggr` output is not detected, the
      full-resolution microscope image is not shown, and k-means clusterings
      and `spatial_enrichment.csv` are not read
      ([Phase 14](phases/14-standard-visium.md#known-gaps)).
- [ ] Xenium nucleus boundaries: with both outline types on and cold, the
      nuclei are drawn about 7 s after the cells, since both queries share
      one DuckDB instance (a second instance delayed the cells: O12,
      2026-11-26); on Visium HD, bins take the pointer from cell and
      nucleus outlines
      ([Phase 17](phases/17-xenium-nucleus-boundaries.md#known-gaps)).
- [ ] MERSCOPE: transcripts are not read; boundaries are not read by viewport;
      deposits without a `.vzg` show no image; inflated `.vzg` pyramids are
      downloaded again on reload; one stain shows at a time; vpt `cellpose_*`
      and `baysor_*` variants need a manifest; and per-FOV HDF5 boundaries are
      not read ([Phase 18](phases/18-merscope.md#later)).

## Found By The 2026-11-16 Review

A read of the code at `bea26d2` against the conventions in
[PLAN.md](../../PLAN.md#conventions-for-every-task). None of these was
recorded before.

Dependencies (the `h5wasm` preload, the unused `deck.gl` package and the
dev tool advisories are closed; see
[Optimization Pass](phases/optimization-pass.md#closed-open-items)):

- [ ] hyparquet stays at 1.26.0 for `patches/hyparquet+1.26.0.patch` while
      1.33.2 is out (2026-11-24); `hyparquet-compressors` 1.1.1 and `zarrita`
      0.7.3 carry patches too since 2026-11-21 (#284, #274). There is no
      Dependabot, so updates are made by hand.
      Since 2026-11-16 `audit.yml` flags advisories; the dev tools' 21 (8
      high) had built up unseen before then.

Correctness and robustness:

- [ ] Optional reads treat any failure as "absent", although a zip's central
      directory lists every entry, so S3's 403 for missing keys does not
      apply. A failed read of a transcript zip's density metadata leaves
      the dataset with no density until reload (`loadDensityGeneMetadata` in
      `transcriptZarr.ts`, cached with the store's metadata); a tile whose
      `valid` array fails to open counts every transcript as valid
      (`openOptionalZarrArray`); Atera's nucleus polygon grid and
      segmentation method turn any failure into "absent" too
      (`ateraDataset.ts`). Catching only zarrita's `NotFoundError`, as
      `ateraDataset.ts` already does for feature types, would keep transient
      failures visible. Partly done: the transcript density metadata and a
      tile's optional arrays (#336, 2026-11-22) and Atera's nucleus polygon
      grid (#297, 2026-11-22) count only a missing node as absent, and are
      read again after any other failure. Atera's segmentation method
      (`polygon_sets/1/method`) still turns any failure into "absent", and a
      failed read of its cell details (`cellDetails()`) is noted in the
      activity log but then treated as absent for the session.

Rendering:

- [ ] Every expression batch recolours every cell: `packCellPointColors` runs
      over all cells (`ViewerCore.tsx`). Above 500,000 cells
      (`GENE_EXPRESSION_AUTO_ALL_CELLS_LIMIT`) expression is read by
      viewport, so on large Xenium datasets this runs on pan and zoom.
      Boundaries are restyled into a new array for each batch as well
      (`App.tsx`). Patching only the cells in the old and new batch would
      avoid both.
- [ ] Hovering transcripts sets App state to a new object on every pointer
      move (`onTranscriptHover`), so App re-renders as the pointer moves. It
      only needs to change when the hovered transcript does.

Code structure:

- [ ] `startDatasetLoad` (`useDatasetLifecycle.ts`) is one async function of
      about 1,480 lines (1,350 on 2026-11-16) with a branch per platform.
      `h5adDataset.ts` (5,470 lines, from 4,229), `tiff/loader.ts` (3,395),
      `datasetFactory.ts` (2,350) and `datasetDiagnostics.ts` (2,320) each
      hold parts that could stand alone: matrix reading, the NDPI, QPTIFF
      and SVS pyramids, detection, and the SpatialData and Visium HD
      runners.
- [ ] `parseCsvRows` is defined twice.
- [ ] A type-aware ESLint pass found no floating promises and one misused one
      (`handleDatasetSubmit` in `useDatasetLifecycle.ts`, an async function
      passed through `App.tsx` as the dataset form's submit handler).
      Turning on `no-floating-promises` and `no-misused-promises` would keep
      it that way.

## Not Pursued

Recorded as such: transcript LOD options A, D, and E;
client-side simplified boundaries; centroid pseudo-boundaries; JPEG XR; jsfive
until needed; cell-major matrix sidecars; papaparse.
