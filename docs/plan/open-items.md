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

This page lists open work only. When an item closes, it moves under Closed Open
Items in the phase or track file it belongs to. The items closed before the
plan was split (2026-11-13) moved there then.

Sequencing:

- [ ] Feature-fix pass: keep recording fixes until correctness is stable.
- [ ] Optimization pass: interaction, memory, fetch/decode concurrency, and
      rendering cost, without behaviour changes.
- [ ] Hosted Visium HD optimization: profiling, segmentation streaming, Feature
      Slice ranges, memory, and bundles. Partly done: Feature Slice and
      matrix reads go through the range-read H5 worker (#122,
      `visiumFeatureSlice.ts`), and segmentation GeoJSON is parsed once, in a
      worker (`visiumHdSegmentationIndex.worker.ts`). Profiling, memory,
      bundles and the main-thread Parquet reads (below) are left.

Other gaps found in the review:

- [ ] Range reads have no timeout or retry. On 2026-11-13, 3 of 6 loads of the
      460-plex zip from `ftp.ebi.ac.uk` had one or two range requests that
      took 55–90 s while the requests sent with them finished in under a
      second, and the load waited for them. Zip entries, hyparquet and Zarr
      chunk reads would need a per-request timeout with a retry (see
      [s3-cors-playbook.md](../s3-cors-playbook.md#hosts-that-stall-range-requests)).
      Partly done: the H5 worker's range reads time out after 120 s and are
      tried three times (`h5RangeFile.ts`), and detection probes use
      `fetchWithTimeout` (`datasetFactory.ts`). Zip entries
      (`cachedZipStore.ts`), hyparquet (`hyparquetCells.ts`) and the Zarr
      `FetchStore` (`zarrStores.ts`) still have neither.
- [ ] Main-thread exceptions to the worker convention: hyparquet reads other
      than the Xenium overview and SpatialData shapes (Visium HD positions and
      barcode mappings), and the fetching and assembly in zarrita reads. The
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
- [ ] Dataset instances are cached per URL for the life of the tab
      (`datasetFactory.ts`, `xeniumDatasetCache.ts`) and never released. A
      `XeniumDataset` keeps its DuckDB worker after its first query, and
      nothing calls the client's `close()` (`src/data/duckdb.ts`), so each
      Xenium dataset opened in a tab can leave up to three DuckDB workers
      running until reload. Found 2026-11-14. Other per-URL caches that are
      never released (found 2026-11-16): one h5wasm worker per matrix file
      (`h5MatrixCache` in `gex.ts`, which also keeps `h5WorkerFile.ts`'s
      `FinalizationRegistry` from closing it), the Feature Slice files
      (`visiumFeatureSlice.ts`), transcript Zarr metadata
      (`transcriptZarr.ts`), the TIFF loader's caches, zip and Icechunk
      stores (`zarrZipStore.ts`, `icechunkStore.ts`), and the H5AD tissue
      image blob URLs, which are never revoked (`h5adDataset.ts`). Collections
      make this matter more, since one tab can now open many datasets. One
      `releaseDataset(url)` could cover them all.
- [ ] Visium HD: with only a 2 µm tier the default load fails, and 2 µm
      detection needs a positions file that is never read.
- [ ] Dataset manifest: declare files absent; set the H5AD coordinate key,
      annotation set, channel colours and contrast, and initial camera (see
      [Phase 11](phases/11-dataset-manifest.md)).

Found by the [15.5-E](phases/15-interface-redesign.md#155-close-out) re-run (2026-11-12):

- [ ] A raised toast can cover an open card: at 1024 px with the layer panel
      open the canvas is 664 px wide and the card stack 360 px, so no position
      clears the card, the legend and the minimap at once. Under 860 px a
      toast still sits over the card sheet. Found 2026-11-12.
- [ ] Visium says "cells" in the Clusters set total, the Metadata track counts
      (which also count every obs row, 4,992 on the Census file, not the 370
      placed spots) and the gene summary ("positive cells across 370 slide
      cells"). The Visium adapter already has the noun "spots"
      (`labels.embeddingElementPlural`); these strings do not use it. They are
      hard-coded in `AnnotationsSectionBlocks.tsx` (set total, track counts)
      and `geneControlsModel.ts` (gene summary). Rechecked 2026-11-16.
- [ ] Links do not carry hidden annotation sets (the set's eye button, a
      checkbox until 2026-11-15), only hidden classes. Found 2026-11-12.
- [ ] A link with both `groups=` and `annotationUrl=` can lose the imported
      labels: loading a set replaces all labels, so an import that finishes
      first is dropped. Found by reading the code on 2026-11-12.
- [ ] The Xenium demo blocks the main thread for up to 4 s at a time in the
      first 30 s after load; see the main-thread exceptions above. 15.5-E put
      this on the viewport warm-up ("Preparing cell feature matrix"). CPU
      profiles over CDP on 2026-11-12 (headless Chromium with GPU, fresh and
      warm profiles; stalls of up to 1.8 s here) put it on the load instead:
      hyparquet decoding `cells.parquet` for the overview (0.4–0.6 s; in a
      worker since 2026-11-13), the first render with the overview layer
      build (2.3–3.0 s), and the first JPEG 2000 morphology decode
      (0.6–0.7 s). The warm-up's cell query runs in DuckDB's worker. The H5
      download (above) was not part of these: its
      1.3–1.7 s block came when the download ended, 63–70 s after load, and
      would land in the first 30 s only above about 20 MB/s. That block is
      gone with the fix.

Features:

- [ ] `t` selection for OME-Zarr, and a `Z plane` control for custom image
      layers (OME-TIFF and OME-Zarr dataset images have one).
- [ ] H5AD: worker-backed lazy Range reads, `/layers/*` and `/raw/X`, and richer
      schema diagnostics. Partly done: lazy Range reads work through
      kerchunk and Icechunk companions (`6971ceb`, `b71ffc8`), on the main
      thread. A plain `.h5ad` is decoded in the H5 worker (`82fb292`), but is
      still downloaded whole, up to the 300 MB limit; the worker's range-read
      path (`openH5WorkerFileFromUrl`) serves only Xenium and Visium HD. Only `/X` is read.
      Diagnostics check that the file answers Range requests, or, for an
      Icechunk repository or an AnnData Zarr store, read the first `/X`
      chunk. Rechecked 2026-11-16.
- [ ] AnnData Zarr: stores without a root `encoding-type`, zipped stores,
      node names with `#` or `?`, and an abort signal for `matrix()` (see
      [Phase 7](phases/07-h5ad.md#anndata-zarr-stores-2026-11-14)).
- [ ] SpatialData: images that are not axis-aligned, `points` (transcripts),
      nucleus boundaries, and viewport-scoped shape reads; also labels drawn
      as a raster rather than traced outlines, labels' other z planes,
      polygons with holes or several parts (only the outer ring of the
      largest part is kept), and diagnostics beyond the first chunk of the
      coarsest level (see
      [Phase 10](phases/10-spatialdata.md#known-gaps)). Partly done: the info
      drawer picks one table and one image at a time (a Visium HD store opens
      on its coarsest bins). Images with a flipped or swapped axis (STHELAR's
      H&E) are skipped. Points are not read. Shapes are read whole, in a worker since
      2026-11-13, then filtered to the viewport. spatialdata-io's
      `shapes.parquet` cannot be read by viewport: the 460-plex
      `cell_boundaries` is one row group of 598,222 rows with no per-shape
      bounding-box column.
- [ ] Atera: ROI transcript export, the cell z histogram, Magic Lens, and
      Azimuth colours; density that follows `Min QV` (it always counts
      QV ≥ 20, the binned store's threshold); and the 3D DAPI stack shown with
      the dataset (see [Phase 12](phases/12-atera.md#known-gaps)).
- [ ] Collections: list them in the start-screen gallery and `Load Dataset`,
      previews by metadata and sorted by expression, class colours in links,
      an embedding beside the view, `labels` without an `image`, and the
      transformations of an image group inside a SpatialData store.
      Side-by-side panels show cells only (no image, boundaries, transcripts
      or tools), and Visium HD and image-only datasets cannot be panels (see
      [Phase 20](phases/20-dataset-collections.md#known-gaps)).
- [ ] Store and file browser: non-Zarr files in consolidated stores read over
      HTTP, and SpatialData points as one table rather than part by part;
      also min and max for binary columns, Rows for writers that store a
      column chunk as one page (fastparquet), and the drawer covering the
      open-dataset form in a narrow window (see
      [Phase 21](phases/21-structure-browser.md#known-gaps)). Partly done:
      Browse File is offered for a SpatialData shapes element's
      `shapes.parquet` that a consolidated store does not list
      (`parquetFileOf` in `storeStructureModel.ts`).
- [ ] SVS: show the thumbnail, label, and macro images, and draw the minimap
      from the thumbnail. Also: read runs of adjacent tiles for QPTIFF and
      OME-TIFF too (SVS only now), stop tiles waiting on a shared run from
      holding scheduler slots, and try a fluorescence SVS (see
      [Phase 16](phases/16-svs.md#known-gaps)).
- [ ] NDPI: files over 4 GB (64-bit offsets; test files and what support
      needs in [Phase 19](phases/19-ndpi.md#64-bit-ndpi-files-over-4-gb)),
      NDPI URLs without a `.ndpi` suffix, a `Z plane` control for other focal
      planes, the macro image, and decoding blocks with the browser's JPEG
      decoder (see [Phase 19](phases/19-ndpi.md#known-gaps)). Also: a level
      whose restart intervals do not divide its MCU rows fails when its tiles
      load rather than at open, and no fluorescence NDPI has been tried.
- [ ] Visium HD dataset annotations from `analysis/` (original Phase 6).
- [ ] The Zarr transcript estimate counts every transcript in a tile, so it
      ignores `Min QV` and `Gene-only calls` (87.5% of a sampled demo tile
      passes the defaults) and assumes even density within each 250 µm tile.
- [ ] Codeword-level density (needs a dataset with `/density/codeword`).
- [ ] Streaming or viewport-scoped 2 µm barcode reads for very large deployments
      (`barcodes.tsv.gz` is still buffered).

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
      protecting it with the existing checks comes first.
- [ ] The Visium HD Bin card shows "Score 0" for a selected gene the bin
      expresses unless cells are coloured by gene expression: bins only get
      expression counts in that mode, and `activeSelectedGridCell`
      (`App.tsx`) fills in 0. Found 2026-11-12.
- [ ] Clicking a Visium HD bin selects nothing under software WebGL (headless
      Chromium), because bin picking relies on deck.gl's picking, and bins have
      no coordinate fallback as cells do. Enter at the crosshair works. Not
      root-caused; found 2026-11-12. `gridCellAtPoint`
      (`viewerKeyboardPick.ts`), which Enter uses, could back clicks too.
- [ ] E2E for SpatialData, OME-Zarr, and image-only sources. Partly done: the
      nightly examples test loads an OME-Zarr, a QPTIFF, and a SpatialData
      store (Zarr v2 with circle shapes). No smoke test covers these sources,
      and zipped, Zarr v3, Icechunk, and labels-annotated SpatialData stores
      are tested by hand.
- [ ] E2E for features that shipped without it: dataset collections
      (including side by side and `compare=`), Browse Store and Browse File,
      SVS, NDPI and plain TIFF, GeoJSON import and export, and load errors.
      Every test runs in desktop Chromium, none at a narrow width, and the
      axe walk does not reach the collection bar, side-by-side panels or the
      structure drawer. The Xenium and Visium HD live tests fail rather than
      skip when Sanger storage is down. Details in
      [Testing And CI](engineering.md#open). Found 2026-11-16.
- [ ] Unit coverage gaps in rendering, picking and workers: `gridBinLayer.ts`,
      `viewerPicking.ts`, the chunk cache in `zarrDecode.worker.ts`,
      `visiumHdOverview.ts`, `omeZarrPixels.ts`, and S3 listing pagination
      in `zarrFolderLister.ts` (see [Testing And CI](engineering.md#open)).
      Found 2026-11-16.
- [ ] Deploy previews for pull requests. `pages.yml` deploys only pushes to
      `main`. Checked 2026-11-12: Pages deployed from Actions serves one site
      with no per-PR paths, so a preview URL needs the Pages source switched
      to a `gh-pages` branch (an admin setting) with a folder per PR. A build
      is about 95 MB, 77 MB of it the two DuckDB WASM files, so each push adds
      that to the branch's history and the 1 GB site limit holds about nine
      previews. Without a URL, CI could upload each PR's build as an
      artifact.
- [ ] The golden fixture bundle (a committed, Xenium-shaped one).

## Known Gaps From The Phase Files

Open items that only their phase files listed, indexed on 2026-11-16. The
phase files hold the details; gaps that belong with an item above were added
to it.

- [ ] GeoJSON: `id` and `visible` properties are not imported, and shapes are
      not saved in the shareable URL
      ([Phase 8](phases/08-image-only-geojson.md#known-gaps)).
- [ ] OME-Zarr chunks read over HTTP are not kept in the IndexedDB cache;
      only zipped stores use it ([Phase 9](phases/09-ome-zarr.md)).
- [ ] QPTIFF: the stripped smallest pyramid level is not shown; auto-contrast
      reads the coarsest level's tiles one at a time, about 15 s per channel
      against EBI; and a QPTIFF cannot be placed over Xenium
      ([Phase 13](phases/13-qptiff.md#known-gaps)).
- [ ] Standard Visium: `spaceranger aggr` output is not detected, the
      full-resolution microscope image is not shown, and k-means clusterings
      and `spatial_enrichment.csv` are not read
      ([Phase 14](phases/14-standard-visium.md#known-gaps)).
- [ ] Xenium nucleus boundaries: cell and nucleus outlines are drawn together
      once both queries finish (cold, the cells wait about 4 s for the
      nuclei); a failed nucleus read clears the cell outlines too; ticking
      either checkbox requests both again; nuclei cannot be picked or
      hovered; and files without `label_id` are covered by a unit test only
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

Dependencies (the `h5wasm` preload and the unused `deck.gl` package are
closed; see
[Optimization Pass](phases/optimization-pass.md#closed-open-items)):

- [ ] hyparquet stays at 1.26.0 for `patches/hyparquet+1.26.0.patch` while
      1.33.0 is out. `npm audit --omit=dev` reports one moderate advisory,
      `qs` through duckdb-wasm. Nothing in CI audits dependencies, and there
      is no Dependabot.

Correctness and robustness:

- [ ] Cancelling a load, or opening another dataset, does not stop the old
      dataset's reads. `getSpatialDataset` (`cachedSpatialDataset` in
      `datasetFactory.ts`) takes no signal, and `useDatasetLifecycle.ts`
      calls it, `overview()` and `readBinnedOverview()` without the load's
      signal. A whole-file H5AD download, up to 300 MB, carries on after
      "Cancelled loading", competes with the next load, and stays cached.
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
      failures visible.
- [ ] DuckDB extension failures are dropped: `createDuckDbClient` calls
      `configureDuckDb(conn)` without `onHttpfsLoadError` or
      `onSpatialLoadError` (`duckdb.ts`). If `LOAD spatial` fails, nothing
      says so, and the polygon ROI, the one spatial query (`gexSelection.ts`),
      fails later with a catalog error. The extensions are fetched from
      DuckDB's extension repository at run time, outside the lockfile.
- [ ] When a Zarr decode worker fails, its chunks decode on the main thread
      with no notice (`workerZarrCodecs.ts`).
- [ ] `annotationUrl=` reads the whole response with `response.text()`
      (`useAnnotationWorkflow.ts`), with no byte limit, unlike the H5AD and
      segmentation loaders, and parses it on the main thread, so a link to a
      large file can stall or crash the tab.
- [ ] CSV exports do not neutralise a leading `=`, `+`, `-` or `@`, so a cell
      ID or label from a remote dataset or an `annotationUrl=` import can run
      as a formula when the file is opened in a spreadsheet. `csvEscape` has
      three copies (`roiModel.ts`, `visiumHdRoiModel.ts`,
      `annotationModel.ts`).
- [ ] A `compare=` in a link's query string is not removed once the hash is
      written (only `collection=` is, in `useShareableUrlHash.ts`), and the
      hash overrides the query string only for the keys it sets
      (`readShareableStateFromLocation`). Closing that panel and reloading
      brings it back.

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
      about 1,350 lines with a branch per platform. `h5adDataset.ts` (4,229
      lines), `tiff/loader.ts`, `datasetFactory.ts` and
      `datasetDiagnostics.ts` each hold parts that could stand alone:
      matrix reading, the NDPI, QPTIFF and SVS pyramids, detection, and the
      SpatialData and Visium HD runners.
- [ ] Helpers are copied rather than shared: `throwIfAborted` is defined 28
      times, `abortError` and `isAbortError` 40 times between them,
      `csvEscape` three times, `parseCsvRows` twice, and the six one-shot
      worker wrappers are near copies of each other.
- [ ] A type-aware ESLint pass found no floating promises and one misused one
      (`handleDatasetSubmit`, an async function used as a submit handler in
      `App.tsx`). Turning on `no-floating-promises` and `no-misused-promises`
      would keep it that way.

## Not Pursued

Recorded as such: transcript LOD options A, D, and E;
client-side simplified boundaries; centroid pseudo-boundaries; JPEG XR; jsfive
until needed; cell-major matrix sidecars; papaparse.
