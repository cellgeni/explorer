# Atera Modality

How the viewer detects and reads a 10x Atera Onboard Analysis output folder.
Atera is the successor to Xenium; its bundle has no Parquet files. Cells,
boundaries, the cell-feature matrix, and transcripts are all zipped Zarr v2
stores, and the matrices are AnnData. The viewer therefore reads Atera
through the same AnnData table readers as H5AD and SpatialData, plus
Atera-specific readers for boundaries, selected-gene expression, and
selected-gene transcripts. For
hosting requirements see
[Host your own data](../host-your-own-data.md#host-your-own-atera-data).

10x documents the bundle under
[Atera output files at a glance](https://www.10xgenomics.com/support/software/atera-onboard-analysis/latest/analysis/output-at-a-glance).
The layouts below were checked against a human whole-transcriptome kidney run
(`experiment.spatial` 1.2, `cells.zarr.zip` 6.3, `transcripts.zarr.zip` 6.0,
`binned_transcripts.zarr.zip` 1.0).

## Detection

`detectSpatialDataset` (`src/datasets/datasetFactory.ts`) probes
`explorer.json`, `experiment.xenium`, and `experiment.spatial` together. A
[dataset manifest](../dataset-manifest.md) wins, then `experiment.xenium`
(Xenium), then a `2xx` for `experiment.spatial` (Atera). Its body is not read
at detection time.

### Zipped Runs

A whole output folder zipped into one file, such as
`Atera_v1_WTA_S4C_Breast_Cancer_FF_outs.zip`, opens from its URL. A `.zip`
URL is first tried as a zipped Zarr store (`detectZarrZip`); when the zip
holds no Zarr metadata, detection reads its central directory
(`readZipDirectory`, `src/data/zipArchive.ts`) and looks for
`experiment.spatial` at the top of the zip or in the shallowest folder holding
it, such as `outs/` (`zipFolderRoot`, ignoring `__MACOSX/`). The zip is then
registered as the run's folder (`registerZipFolder`, `src/data/zipFolder.ts`)
and the dataset's base URL is the zip's URL, so `<zip url>/cells.zarr.zip`
names `outs/cells.zarr.zip` in the zip.

The page's `fetch` answers those URLs from the zip, so every reader and
diagnostic below works unchanged: `HEAD` from the directory (size, the zip's
ETag), and `GET` with or without a `Range` as one range request of the zip at
the entry's data offset, which is read once per file from its local header.
Requests to the zip skip the HTTP cache (`cache: 'no-store'`), because
Chromium serialises requests that share a URL's cache entry and every file is
now one URL. The zipped stores and TIFF tiles still use the byte-range cache,
keyed by the inner URL and versioned by the zip's ETag.

Only stored (uncompressed) entries can be read in parts. A zip whose
`cell_feature_matrix.zarr.zip` is deflated is refused at detection, with
advice to zip with `zip -0 -r` or host the folder unzipped; other deflated
files are read whole (and ranges of them only under 32 MiB), so a deflated
TIFF or transcript zip fails when used. A zip holding a Xenium run
(`experiment.xenium`) is refused: Xenium reads Parquet in workers, which do not
see the zip. Detecting the same zip again in a page reuses the registered
directory, so only the `HEAD` probe is repeated.

Measured 2026-11-18 on the 89 GB breast cancer run on Sanger S3 (23 entries,
all stored), with Playwright on the dev server: the overview of 485,985 cells
appears in 9–12 s. Detection costs the `HEAD` probe and two reads of the zip's
tail (the Zarr store attempt, then `readZipDirectory`); each file opened
costs one 30-byte local-header read, and every request goes to the zip's own
URL.

## File Locations

Each file is located by, in order: the dataset manifest's `files` entry, the
path in `experiment.spatial` `explorer_files` (or `images` for the morphology
image), then the standard name. `AteraDataset.fileUrl(role)`
(`src/datasets/ateraDataset.ts`) applies this order; diagnostics use the same
order. Diagnostics range-check every role and the morphology image; a missing
matrix or `cells.zarr.zip` fails, and a missing transcript zip or image only
warns.

| Role                   | `experiment.spatial` key                        | Standard name                      |
| ---------------------- | ----------------------------------------------- | ---------------------------------- |
| `experiment`           | —                                               | `experiment.spatial`               |
| `cells`                | `explorer_files.cells_zarr_filepath`            | `cells.zarr.zip`                   |
| `cellFeatureMatrix`    | `explorer_files.cell_feature_zarr_filepath`     | `cell_feature_matrix.zarr.zip`     |
| `cscCellFeatureMatrix` | `explorer_files.cell_feature_viz_zarr_filepath` | `csc_cell_feature_matrix.zarr.zip` |
| `transcripts`          | `explorer_files.transcripts_zarr_filepath`      | `transcripts.zarr.zip`             |
| `binnedTranscripts`    | `explorer_files.transcripts_viz_zarr_filepath`  | `binned_transcripts.zarr.zip`      |
| `morphology`           | `images.morphology_2d_filepath`                 | —                                  |
| `morphology3d`         | `images.morphology_3d_filepath`                 | —                                  |

## Files Read

| File                                   | Required        | Library                                     | What is read                                                                                                                                                                                                         | Used for                                                                             |
| -------------------------------------- | --------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `experiment.spatial`                   | Yes             | fetch + JSON                                | `pixel_size`, `images.morphology_2d_filepath` and `morphology_3d_filepath`, `explorer_files`, panel name, cell count                                                                                                 | Detection, file locations, units, diagnostics                                        |
| `cell_feature_matrix.zarr.zip`         | Yes             | `zarrita` + `ZipFileStore`, AnnData readers | `obs` (`barcode` index, `centroid_column`/`centroid_row` in µm, counts, areas, `filtered`, `leiden_res_*`, `azimuth_*` with their `color`), `obsm/X_umap`, `X_pca`, `var/feature_name`, `feature_type`, CSR `X` rows | Overview, gene list, annotations, metadata tracks, embeddings, ROI, cell, Magic Lens |
| `csc_cell_feature_matrix.zarr.zip`     | Yes             | `zarrita` + `ZipFileStore`                  | CSC `X/indptr`, then `X/indices` and `X/data` slices for each selected gene                                                                                                                                          | Selected-gene overlay                                                                |
| `cells.zarr.zip`                       | For boundaries  | `zarrita` + `ZipFileStore`                  | `bboxes`, `gridded_polygon_sets/{0,1}` tiles, `cell_summary` `nucleus_count` column, `polygon_sets/1/method`, root `segmentation_methods`                                                                            | Cell and nucleus boundaries, nucleus counts, segmentation method                     |
| `morphology_2d/ch000N_*.ome.tif`       | For the image   | `geotiff` + range tile reads                | Multi-file OME-TIFF: OME-XML channel list with `TiffData/UUID FileName`, SubIFD pyramid, JPEG 2000 tiles                                                                                                             | Image layer with one channel per stain                                               |
| `morphology_3d/ch0000_dapi_3d.ome.tif` | When chosen     | `geotiff` + range tile reads                | One OME-TIFF: one `TiffData` of 15 planes, so IFD N is plane N, each with its own SubIFD pyramid; `PhysicalSizeZ` 3 µm                                                                                               | 3D DAPI image with a `Z plane` control                                               |
| `binned_transcripts.zarr.zip`          | For transcripts | `zarrita` + `ZipFileStore`, nested zips     | Root `gene_names`, `grid_size`, `grid_keys`, `origin`; `gene/<index>.zip` for each selected gene: `grid/.zattrs`, then `grid/<x>,<y>/{indptr,indices,data}`                                                          | Selected-gene density and the exact-point estimate                                   |
| `transcripts.zarr.zip`                 | For transcripts | `zarrita` + `ZipFileStore`                  | Root `gene_names`, `grid/.zattrs`; per visible tile `gene_offset`, then each selected gene's rows of `location`, `quality_score`, `cell_id`, `overlaps_nucleus`                                                      | Exact points, density at a `Min QV` other than 20, ROI export, cell z histogram      |

Not read: `diffexp_genes/`, the HTML summaries,
`panel_config.json`, `metrics_summary_*.csv`, the FOV location files, and
`overview_scan.png`. In `transcripts.zarr.zip`, `codeword_identity` and the
`codeword_*` and `gene_category` metadata are not read.
`cells.zarr.zip` `masks` and full-precision `polygon_sets` vertices are also
not read.

## Coordinates And Units

- Data coordinates are micrometres. Cell positions are the matrix
  `obs/centroid_column` (x) and `obs/centroid_row` (y); despite the names,
  both are in µm and match `cell_summary` in `cells.zarr.zip`.
- `meta().units` uses `experiment.spatial` `pixel_size` (default 0.2125
  µm/px). The image layer uses the OME-XML `PhysicalSizeX` of the morphology
  image, which matches it.
- Cell IDs are the matrix `obs/barcode` strings (Xenium-style `aaaahcoa-1`).
  Matrix rows, `cells.zarr.zip` cell rows, and polygon `cell_index` values
  share one order.

## Load Sequence

`useDatasetLifecycle` sets the platform to `atera` (cell boundaries on,
nucleus boundaries off by default), then:

1. `AteraDataset` lists the entries of `cell_feature_matrix.zarr.zip` and
   fetches the metadata of `X`, `obs`, `obsm`, and `var/{feature_name,
feature_id, feature_type}` in parallel (16 at a time). The hundreds of
   `var/de_*` differential-expression columns are left closed. The metadata is
   served from memory to `AnnDataH5adDataset` through `consolidatedZarrStore`.
2. `loadAnnDataOverview` awaits `overview()`, `genePanel()`,
   `annotationGroups()`, `embeddingOptions()`, and `metadataTracks()`. The
   overview adds `transcript_counts` and `cell_area` from `obs`, and nucleus
   counts and segmentation methods from `cells.zarr.zip` when it can be read.
3. The morphology image loads in the background through `loadMorphologyImage`
   with one candidate, the same path as a Xenium `morphology_focus` image: the
   `experiment.spatial` 2D image, or the 3D DAPI stack when the link says
   `aimg=3d` (see [Morphology Image](#morphology-image)).

On the reference run (93,864 cells, 24,674 features) the dataset is ready in
about 4 s from a cold cache.

## Feature Read Paths

### Cell And Nucleus Boundaries

`gridded_polygon_sets/1` (cells) and `/0` (nuclei) tile every polygon by
centroid into squares of `grid_size` µm (500) at level 0, doubling per level
(five levels). Every level holds every polygon; coarser levels have fewer
vertices (about 24 at level 0, 5 at level 4). For a request:

1. `ateraPolygonGridLevelForBbox` picks the coarsest level whose tiles are at
   most a quarter of the request's longer side.
2. Tiles that intersect the request padded by the largest cell extent are
   read (`cell_index`, `num_vertices`, `relative_vertices`).
3. `relative_vertices` bytes are scaled into each cell's `bboxes` entry:
   `x = minX + v / 255 × (maxX − minX)`. Nuclei use the bounding box of the
   cell they belong to.
4. Polygons whose box misses the request are dropped. A cell's second and
   later nuclei get ids `<barcode>#nucleus-N`.

Decoded tiles are cached (256 tiles), so panning reuses element objects. The
app's `Boundary limit` gate still applies.

### Selected-Gene Expression

`geneExpression(bbox, genes)` reads each gene as a whole column of the CSC
matrix: one `indptr` lookup, then the `X/indices` and `X/data` chunks that
cover it (1,000,000 values per chunk; about 1.7 MB for a typical gene). The
columns of the last 64 genes are cached, so later viewports cost no reads.
Counts are summed per cell, and cells in the box are returned; cells without
expression are kept every `sampleStride`-th.

### Transcripts

Both transcript stores split the slide into 2,000 µm tiles keyed `<x>,<y>`
(keys can be negative, such as `-1,2`) and list `gene_names` in matrix feature
order. Transcripts are stored per gene, so the viewer shows them for selected
genes only. `loadPlatformTranscriptCapabilities`, `…Aggregates`, and
`…Viewport` (`src/features/app-shell/platformAdapter.ts`) route Atera to
`AteraDataset`, which delegates to `AteraTranscripts`
(`src/datasets/ateraTranscripts.ts`); other platforms keep the Xenium loaders.

**Capabilities.** Opening the Transcripts section or overlay opens both zips
and reads their root attributes (and the zip directories, which later requests
reuse). The result is `{ rawParquet: false, nativeZarr, geneRanges }`:
`nativeZarr` for the binned store, `geneRanges` for `transcripts.zarr.zip`.
`geneRanges` being present is what sends `useTranscriptWorkflow` down the
per-gene branch; the source shows as "Per-gene LOD + exact". Without a
readable binned store it shows "Per-gene, LOD unreadable", and nothing is
drawn, since exact reads are sized by the density's count.

**Density.** Each gene in `binned_transcripts.zarr.zip` is a zip stored
inside the outer zip, `gene/<gene_index>.zip` (about 50–190 KB; genes without
transcripts have none). It is read in one request and opened in memory. Its
`grid/.zattrs` lists the gene's tiles and the bin grid (400 × 400). Each tile
is a CSR matrix of 5 µm bins counting QV ≥ 20 transcripts, rows = y bins,
columns = x bins, from the tile corner; `indices` and `indptr` use the
numcodecs `delta` filter. For a request:

1. `ateraDensityBinSize` doubles the 5 µm bin until the view spans at most
   1,500 squares, aligned to the coordinate origin.
2. Tiles of each selected gene that touch the squares covering the view are
   decoded (and cached).
3. `aggregateAteraBinnedTiles` sums native bins into squares, whole at the
   view's edges, and keeps each gene's count and count-weighted centre, for
   the hover card and gene markers. It also counts native bins whose centre
   lies in the view: the selected-gene estimate.

The squares use the `Density color` scale, or are drawn as gene markers
([UI reference](../ui-reference.md#transcripts)). On the reference run a
whole-slide UMOD request is 165 squares of 640 µm that sum to the stored
1,914,072.

**Density at another `Min QV`.** The binned store counts QV ≥ 20 only, so at
any other `Min QV` the squares come from `transcripts.zarr.zip` instead
(`AteraTranscripts.aggregates`):

1. The square size is chosen as above, from 5 µm bins.
2. Each selected gene's `[start, end)` rows in the tiles under the squares
   are added up from `gene_offset`. Over `ATERA_QV_DENSITY_ROW_LIMIT`
   (2,000,000 rows, about 28 MB of `location` and `quality_score`), the
   binned QV ≥ 20 squares are shown instead, and the panel message names
   the row count and asks for a closer view or fewer genes.
3. Otherwise each range's `location` and `quality_score` are read whole
   (both cached), and transcripts at `Min QV` or above are counted into the
   squares; those inside the view are the estimate.

The panel message says which QV the squares count from ("at QV 30+ from
transcripts.zarr.zip"). On the reference run at QV 30, whole-slide NPHS1 is
88 squares from `transcripts.zarr.zip`; whole-slide UMOD needs 2,142,840 rows,
so it shows the QV ≥ 20 squares and says why. Xenium density does not follow
`Min QV`.

**Choosing density or points.** The estimate, not the all-transcript cell
estimate, goes to `planTranscriptLod`: Auto shows exact points when it fits
the `Exact budget`, density otherwise; the manual-load prompt at 80% of the
budget applies as for Xenium. The `Exact points` meter shows this count. It
follows `Min QV` when the density does.

**Exact points.** For each visible tile, `gene_offset` (`[genes, 2]` uint32)
gives each selected gene's `[start, end)` rows; tiles are sorted by gene. The
rows within a gene are not spatially sorted, so the whole range is read: at
most about 175,000 rows per gene per tile on the reference run, two or three
`location` chunks. Then:

1. `location` (`[N, 3]` float32, Fortran order) is filtered by the view.
2. `quality_score` (`[N, 1]` float16) is read for the span of rows still in
   the view and filtered by `Min QV`. It is opened as uint16 and decoded by
   `halfFloatToNumber`, since zarrita needs `Float16Array` for float16.
3. Over the `Exact budget`, only the first `Exact budget` points are kept, as
   on Xenium, and the layer reports that the limit was hit.
4. `cell_id` (`[N, 2]` uint32, Fortran order: prefix and dataset suffix) and
   `overlaps_nucleus` are read for the remaining span. Prefix and suffix
   become the matrix barcode (`intToCellId`); both `0xFFFFFFFF` means
   unassigned.

Points have id `<tile>:<row>`, no FOV, `isGene: true`, and z from
`location`. On the reference run 1,031 exact QV ≥ 20 points of UMOD and NPHS1
in a 600 × 400 µm box matched the binned estimate exactly; a 256 × 192 µm view
of 7,645 points took about 5 s cold and 1.4 s with the range cache warm.

Each step waits for the one before, so round trips add up. Opening a shared
link at about 150 ms from the host, on a slow CPU, while boundaries and
expression also load, the E2E test's 8,546-point UMOD view took about 25 s.
Exact loads are therefore not cut off: after 12 s the panel says the points
are still loading.

**All features.** With no genes selected, or the Feature filter on All
features, the layer is cell-summary squares built from the overview's
`obs/transcript_counts`, with a message asking for a gene filter; Exact waits
with the same request. All-gene native density or points would mean reading
every gene's zip or rows.

**ROI export and the cell z histogram.** Both read the selected genes through
the exact-point reader (`loadPlatformRoiTranscripts` and
`loadPlatformCellTranscriptDistribution` in `platformAdapter.ts`), which
takes a `contains` test so that only points inside the lasso or the cell
outline count toward the limit:

- `Export Transcripts` reads the ROI's bounding box at QV ≥ 20, up to 100,000
  rows, into the same CSV columns as Xenium. With no genes selected it fails
  and asks for genes. A box of about 110 × 70 µm on UMOD-rich tubules gave
  1,013 rows in 0.25 s, the tiles already read for exact points.
- The Cell card's `Z-axis transcripts` histogram counts the selected genes'
  transcripts inside the cell outline, at QV ≥ 20, and names the genes; with
  none selected it asks for some. On the reference run an epithelial cell's
  45 UMOD transcripts (z 18.8–21.8 µm) took 2.4–2.7 s after the cell opened.

Xenium exports and bins every feature in the ROI or cell. Here every gene would
mean reading every row of each tile (up to 52 million), so the selection is
the gene filter, as for the transcript layer.

### Gene List

`var/feature_name` rows whose `var/feature_type` is `Gene Expression`. Control
probes and codewords stay in the matrix (and in cell and ROI profiles) but are
not offered in the gene list.

### Annotations, Metadata Tracks, And Embeddings

These come from the AnnData readers (see [H5AD](./h5ad.md)):

- Categorical `obs` columns (`leiden_res_1.0`, `azimuth_broad`,
  `azimuth_coarse`, `azimuth_fine`, `azimuth_full_hierarchy`) are annotation
  sets. The Azimuth columns keep a colour per category in `obs/<column>/color`
  (int32 `0xRRGGBBAA`, alpha always 255), which classes take until the user
  picks another; Leiden classes take the viewer palette.
- Numeric `obs` columns are metadata tracks, except `cell_id`,
  `centroid_column`, and `centroid_row`. The boolean `filtered` column (cells
  kept for secondary analysis) is a 0/1 track.
- `obsm/X_umap` and `obsm/X_pca` are embeddings.

### Plots Panel

`geneValues(genes)` reads each gene's column of the CSC matrix, four at a
time, through the same 64-gene cache as the expression overlay. Rows are the
matrix's, which the CSC shares. On the kidney run, three genes by
`azimuth_coarse` (47 classes) plot in 2.3 s from opening the panel.

### Selected Cell, ROI, And Magic Lens

- Cell profile: one CSR row of `cell_feature_matrix.zarr.zip`.
- Cell z histogram and ROI transcript export: the selected genes' transcripts
  (see [Transcripts](#transcripts)).
- ROI cells: AnnData bounding-box and lasso queries, with transcript counts
  and areas from the overview.
- ROI gene stats: CSR rows for a sample of ROI cells (`matrix(ids)`), the same
  as H5AD. Matrix rows are ordered by cell id, which keeps nearby cells in
  nearby chunks.
- Magic Lens: the same two reads, through the AnnData ROI loaders
  (`loadActiveRoiCells` and `loadActiveRoiGeneStats` in `App.tsx`): the cells
  in the lens (up to 25,000), then their CSR rows. The transcript total is the
  sum of the cells' `transcript_counts`. A CSR chunk pair holds about 400
  cells (1.8 MB compressed), so a cursor lens reads a few chunks; at 4 px/µm,
  Summarise View over 368 cells took 3.4 s.

### Morphology Image

The 2D multi-focus image is shown by default. When `experiment.spatial` (or a
manifest's `morphology3d`) also names the 3D DAPI stack, the Image section
offers `Morphology`: `2D (all stains)` or `3D DAPI stack`. A change reloads
the dataset with `aimg=3d` in the link, as a MERSCOPE stain change does
(`useAteraImageWorkflow`); the matrix is not read again, and the view, genes,
and layers carry over. The stack's 15 planes get the `Z plane` control,
opening at the middle plane (8 of 15, z = 21 µm), and `z=` in the link keeps
the plane. The stack opens without a manifest's `morphologyZchunkstore`,
which covers the 2D channel files only. On the reference run the switch took
1.7 s to show plane 8.

## Caching

- IndexedDB byte-range cache (`src/data/persistentByteRangeCache.ts`) for every
  zip read, including the zip central directories, through
  `cachedZipFileStoreFromUrl` / `cachedZipFileStoreWithEntries`
  (`src/zarr/cachedZipStore.ts`).
- In memory: the AnnData table, overview index, CSC `indptr`, gene columns,
  `cells.zarr.zip` `bboxes` and grid attributes, and decoded polygon tiles.
- In memory, for transcripts: both stores' root attributes, the last 32
  genes' binned zips and their decoded tiles, each tile's `gene_offset`, and
  the last 48 gene-tile `location` ranges. Panning within loaded tiles reads
  only `quality_score`, `cell_id`, and `overlaps_nucleus` again, from the
  byte-range cache. Density at a `Min QV` other than 20 also keeps the last 48
  gene-tile `quality_score` ranges, decoded.

## Source Files

| File                                                | Role                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/datasets/ateraFormat.ts`                       | File roles, `experiment.spatial` parsing, polygon grid codecs, transcript grids, density binning |
| `src/datasets/ateraDataset.ts`                      | `AteraDataset`: table, overview, CSC genes, boundaries, image                                    |
| `src/datasets/ateraTranscripts.ts`                  | `AteraTranscripts`: capabilities, per-gene density, exact points                                 |
| `src/features/transcripts/useTranscriptWorkflow.ts` | Per-gene branch: cell summary, density, estimate, exact                                          |
| `src/zarr/cachedZipStore.ts`                        | Range-cached zip stores and entry listing                                                        |
| `src/data/zipFolder.ts`                             | Zipped run folders: registry and the `fetch` wrapper that reads files from the zip               |
| `src/datasets/h5adDataset.ts`                       | AnnData readers used for the matrix                                                              |
| `src/datasets/datasetFactory.ts`                    | `experiment.spatial` probe and construction                                                      |
| `src/features/app-shell/platformAdapter.ts`         | `atera` adapter, boundary and transcript routing                                                 |
| `src/features/app-shell/useDatasetLifecycle.ts`     | Atera load branch, 2D or 3D image                                                                |
| `src/features/app-shell/useAteraImageWorkflow.ts`   | `Morphology` choice: reload with `aimg`                                                          |
| `src/data/roiTranscripts.ts`                        | `loadPerGeneRoiTranscripts`: selected-gene ROI export                                            |
| `src/data/datasetCellTranscripts.ts`                | `loadPerGeneCellTranscriptDistribution`: selected-gene cell z histogram                          |
| `src/data/datasetDiagnostics.ts`                    | Atera diagnostics                                                                                |

## Known Limitations

- Transcripts are shown, exported, and binned by z for selected genes only
  (see [Transcripts](#transcripts)).
- At a `Min QV` other than 20, a view whose selected genes have more than
  2,000,000 rows in the tiles under it shows the QV ≥ 20 squares, and says so.
- One morphology image at a time: the 2D image or the 3D DAPI stack.
- A zipped run must store its zips and OME-TIFFs uncompressed (see
  [Zipped runs](#zipped-runs)); only Atera runs open from a zip.
- Leiden classes have no stored colours; they take the viewer palette.
