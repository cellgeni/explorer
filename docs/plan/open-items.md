# Open Items

Every unchecked item in this plan. On 2026-11-12 each item was checked against
the code at `35479d6`. None of the items open on 2026-11-09 had been finished;
where part of one exists, a note says which part. Four small items were closed
the same day, and later that day the items sized as half a day or less, except
deploy previews.

This page lists open work only. When an item closes, it moves under Closed Open
Items in the phase or track file it belongs to. The items closed before the
plan was split (2026-11-13) moved there then.

Sequencing:

- [ ] Feature-fix pass: keep recording fixes until correctness is stable.
- [ ] Optimization pass: interaction, memory, fetch/decode concurrency, and
      rendering cost, without behaviour changes.
- [ ] Hosted Visium HD optimization: profiling, segmentation streaming, Feature
      Slice ranges, memory, and bundles.

Reopened by the 2026-11-08 review (marked done before, found incomplete):

- [ ] Diagnostics left as they were on 2026-11-12: the Visium HD per-tier UMAP
      check range-checks one path while the viewer searches the tier's paths
      and then the root's, and the standard Visium analysis check reports the
      last candidate's failure, not the first.

Other gaps found in the review:

- [ ] Visium HD: avoid re-streaming segmentation GeoJSON for every viewport.
- [ ] Byte-range cache keys omit the `ETag`.
- [ ] Range reads have no timeout or retry. On 2026-11-13, 3 of 6 loads of the
      460-plex zip from `ftp.ebi.ac.uk` had one or two range requests that
      took 55–90 s while the requests sent with them finished in under a
      second, and the load waited for them. Zip entries, hyparquet and Zarr
      chunk reads would need a per-request timeout with a retry (see
      [s3-cors-playbook.md](../s3-cors-playbook.md#hosts-that-stall-range-requests)).
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
- [ ] Xenium still loads through free functions in `src/data/` instead of one
      `XeniumDataset` instance; the viewer's µm/px comes from OME-XML while
      `meta()` reads the manifest.
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
      (`labels.embeddingElementPlural`); these strings do not use it.
- [ ] Links do not carry hidden annotation sets (the per-set visibility
      checkbox), only hidden classes. Found 2026-11-12.
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

- [ ] `t`/`z` selection for OME-Zarr, and a `Z plane` control for custom image
      layers (OME-TIFF dataset images have one).
- [ ] H5AD: worker-backed lazy Range reads, `/layers/*` and `/raw/X`, and richer
      schema diagnostics. Partly done: lazy Range reads work through
      kerchunk and Icechunk companions (`6971ceb`, `b71ffc8`), on the main
      thread. Only `/X` is read, and diagnostics check only that the file
      answers Range requests or the repository opens.
- [ ] SpatialData: a table choice, images that are not axis-aligned, `points`
      (transcripts), nucleus boundaries, and viewport-scoped shape reads
      (see [Phase 10](phases/10-spatialdata.md#known-gaps)). Partly done: the
      info drawer picks one image at a time, and the primary table is read.
      The table is picked by name, so a Visium HD store would open on its
      2 µm bins. Images with a flipped or swapped axis (STHELAR's H&E) are
      skipped. Points are not read. Shapes are read whole, in a worker since
      2026-11-13, then filtered to the viewport. spatialdata-io's
      `shapes.parquet` cannot be read by viewport: the 460-plex
      `cell_boundaries` is one row group of 598,222 rows with no per-shape
      bounding-box column.
- [ ] Atera: ROI transcript export, the cell z histogram, Magic Lens, and
      Azimuth colours (see [Phase 12](phases/12-atera.md)).
- [ ] SVS: show the thumbnail, label, and macro images, and draw the minimap
      from the thumbnail.
- [ ] Visium HD dataset annotations from `analysis/` (original Phase 6).
- [ ] The Zarr transcript estimate counts every transcript in a tile, so it
      ignores `Min QV` and `Gene-only calls` (87.5% of a sampled demo tile
      passes the defaults) and assumes even density within each 250 µm tile.
- [ ] Codeword-level density (needs a dataset with `/density/codeword`).
- [ ] Streaming or viewport-scoped 2 µm barcode reads for very large deployments
      (`barcodes.tsv.gz` is still buffered).

Original-brief items with no outcome:

- [ ] `metrics_summary.csv` QC display (not read; papaparse not adopted).
- [ ] `tilesForBbox` returns edge tiles for a bbox wholly outside the image,
      because it clamps tile indices to the grid rather than to the image. For
      `{minX: -500, maxX: -100}` on a 250 × 180 px level with 100 × 80 px tiles
      it returns column 0. The loaders have their own copies
      (`src/tiff/loader.ts:801`, `src/zarr/omeZarrLoader.ts:369`), so a view
      panned off the left or top of an image still requests that edge's
      tiles. Found by the property tests (an `it.todo` in
      `coords.property.test.ts`).
- [ ] Memory ceiling with eviction telemetry beyond tile caches. Partly done:
      budgets scale with device memory, and the tile LRU (with eviction
      telemetry), the OME-Zarr chunk cache and the IndexedDB cache each evict
      on their own. There is no app-wide ceiling.

Testing:

- [ ] Make the coverage job required, once the timing-sensitive `App.test.tsx`
      checks pass under coverage on the runner.
- [ ] The Visium HD Bin card shows "Score 0" for a selected gene the bin
      expresses unless cells are coloured by gene expression: bins only get
      expression counts in that mode, and `activeSelectedGridCell`
      (`App.tsx`) fills in 0. Found 2026-11-12.
- [ ] While a Visium HD tier loads, `Active bins` shows the old count with the
      new size ("54,504 at 2 µm"): `visiumHdControlLoading` keeps `binCount`
      but drops `loadedBinSize`. Found 2026-11-12.
- [ ] Clicking a Visium HD bin selects nothing under software WebGL (headless
      Chromium), because bin picking relies on deck.gl's picking, and bins have
      no coordinate fallback as cells do. Enter at the crosshair works. Not
      root-caused; found 2026-11-12.
- [ ] E2E for SpatialData, OME-Zarr, and image-only sources. Partly done: the
      nightly examples test loads an OME-Zarr and a QPTIFF. Nothing loads
      SpatialData in a browser (`examples/index.json` has no SpatialData
      entry), and no smoke test covers these sources.
- [ ] Deploy previews for pull requests. `pages.yml` deploys only pushes to
      `main`. Checked 2026-11-12: Pages deployed from Actions serves one site
      with no per-PR paths, so a preview URL needs the Pages source switched
      to a `gh-pages` branch (an admin setting) with a folder per PR. A build
      is about 95 MB, 77 MB of it the two DuckDB WASM files, so each push adds
      that to the branch's history and the 1 GB site limit holds about nine
      previews. Without a URL, CI could upload each PR's build as an
      artifact.
- [ ] The golden fixture bundle (a committed, Xenium-shaped one).

Not pursued (recorded as such): transcript LOD options A, D, and E;
client-side simplified boundaries; centroid pseudo-boundaries; JPEG XR; jsfive
until needed; cell-major matrix sidecars; papaparse.
