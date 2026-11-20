# MERSCOPE Modality

How the viewer reads Vizgen MERSCOPE output: one region folder as the
instrument writes it, or as the Vizgen Postprocessing Tool (vpt) writes a
re-segmentation. The cell tables become an in-memory AnnData table, as for
[standard Visium](./visium.md), so cells, genes, annotations, metadata
tracks, ROI, and expression use the [H5AD read paths](./h5ad.md#feature-read-paths).
Cell outlines come from the boundary GeoParquet, and the image from the
pyramids in the run's `.vzg` file, one stain and z plane at a time.
Transcripts are not read (plan [Phase 18](../plan/phases/18-merscope.md)).
For hosting requirements see
[Host your own data](../host-your-own-data.md#host-your-own-merscope-data).

## Detection

### Region Folder

`detectSpatialDataset` (`src/datasets/datasetFactory.ts`) tries MERSCOPE
after the `experiment.xenium`, `experiment.spatial`, and root Zarr metadata
probes, alongside the standard Visium probes, so other datasets make no extra
requests. Three `HEAD` requests run in parallel (`probeMerscopeOutputs`):

| Path                      | Needed                                          |
| ------------------------- | ----------------------------------------------- |
| `cell_by_gene.csv`        | Yes                                             |
| `cell_metadata.csv`       | Yes                                             |
| `cell_boundaries.parquet` | No; its `Content-Length` sets the boundary rule |

The `.vzg` is named after the run and region
(`202402231759_…_VMSC04501_region_0.vzg`), so it cannot be probed for: it is
taken from the folder's index page when that lists exactly one (BIA does), or
from the manifest's `vzg`.

`createSpatialDataset` lazy-imports `MerscopeDataset`
(`src/datasets/merscopeDataset.ts`).

### Dataset Manifest

A [dataset manifest](../dataset-manifest.md#merscope) with
`"platform": "merscope"` can name each of the three files and the `.vzg`. Files it names
must answer `HEAD`; files it leaves out are probed at the instrument's names,
and missing boundaries are left out. Three layouts need one:

- **vpt re-segmentation**: `cellpose_cell_by_gene.csv`,
  `cellpose_cell_metadata.csv`, `cellpose_micron_space.parquet`, or the same
  with `baysor_`.
- **GEO**: every file prefixed with the sample and gzipped, such as
  `GSM9427137_EFE_r1_cell_by_gene.csv.gz` and
  `GSM9427137_EFE_r1_cell_boundaries.parquet.gz`.
- **Zenodo**: files are served at `/api/records/<id>/files/<name>/content`
  URLs without a suffix.

## Files Read

| File                                                         | Required | Library                                                             | What is read                                                                                                                                      | Used for                           |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `cell_by_gene.csv`                                           | Yes      | fetch whole, gunzip when gzipped, parsed in a worker (up to 300 MB) | Cell ID (first column), one column per gene, `Blank-*` columns                                                                                    | Cells, genes, expression           |
| `cell_metadata.csv`                                          | Yes      | fetch whole, gunzip when gzipped, parsed in a worker (up to 300 MB) | Cell ID (first column), `center_x`, `center_y`, `fov`, `volume`, `transcript_count`, shape columns, `<stain>_raw` and `<stain>_high_pass`, others | Positions, metadata tracks, counts |
| `cell_boundaries.parquet` or `<method>_micron_space.parquet` | No       | fetch whole, gunzip when gzipped, `hyparquet` in the shapes worker  | `Geometry` (WKB MultiPolygon in µm), `EntityID`, `ZIndex`                                                                                         | Cell boundaries                    |
| `<run>_region_<n>.vzg` (zip)                                 | No       | byte ranges; one entry inflated in a worker; `geotiff` from memory  | Central directory, `pictures/manifest.json`, `pictures/micron_to_mosaic_pixel_transform.csv`, one `pictures/pyrmosaic_<stain>_z<k>.tif`           | Image                              |

Both CSVs are fetched and parsed in one worker (`merscopeTable.worker.ts`):
the parser scans the text once and writes counts straight into CSR arrays,
without an object per cell. Fields follow RFC 4180: a quoted field may hold
commas, line breaks and `""` for a quote, and an unclosed quote fails with
its row. A byte order mark and `\r\n` line ends are read too. Gzip is
recognised from the first two bytes, not the file name. A `Content-Length`
above 300 MB fails the load with the file's size. So does a gzipped file
whose trailer gives an inflated size above it, before anything is inflated;
one whose trailer understates its size (more than 4 GiB, or several gzip
members) stops inflating once past 300 MB.

The table it builds (`merscopeTable` in `src/datasets/merscopeFormat.ts`):

- **Rows** are the cells in both files, joined by ID in `cell_by_gene.csv`
  order. IDs are 19-digit int64 values (38 digits in the 2022 release), above
  JavaScript's exact integer range, so they stay strings. Cells in only one
  file are left out and counted in a notice.
- **X**: gene counts as CSR. Counts written as `0.0` are read.
- **var**: the gene columns. `Blank-*` control columns are not genes: they
  are summed per cell into the `blank_count` track instead.
- **obsm**: `spatial` from `center_x`, `center_y`, in stage micrometres as
  written.
- **obs**: `fov` as categories, which makes it an annotation set; every other
  metadata column as a number, or as categories when a value is not a number.
  `center_*`, `min_*`, and `max_*` place the cell and are not tracks. Columns
  empty in every cell (vpt writes an empty `fov`) are left out. Two columns
  are added: `total_counts` (the gene counts' sum) and `blank_count`.

## Coordinates And Units

Data coordinates are micrometres, as written: MERSCOPE writes stage
coordinates, so a region starts thousands of micrometres from 0. The viewer
does not shift them, so positions match Vizgen's tools. One data unit is one
micrometre.

## Load Sequence

`useDatasetLifecycle` (`src/features/app-shell/useDatasetLifecycle.ts`):

1. Sets the platform to `merscope`. `Cell boundaries` starts on when the
   boundary file is at most 100 MB, or its size is unknown.
2. Reads the tables and runs the shared AnnData overview (cells, genes,
   annotation sets, embedding options, metadata tracks). Each cell's
   transcript count is `transcript_count`, else `total_counts`.
3. Logs the table summary: Blank columns, empty columns left out, and the
   boundary file and size.
4. Raises a notice when cells are in only one table, and when a boundary file
   over 100 MB starts with boundaries off.
5. With a `.vzg` and `Morphology image` on, reads its directory, manifest,
   and transform, fills the Image section's Stain and Plane controls, and
   loads the chosen image in the background (see [Image](#image)).

Gating is in `MERSCOPE_PLATFORM_ADAPTER`
(`src/features/app-shell/platformAdapter.ts`): AnnData workflows and cell
boundaries from `dataset.elements(bbox)`; transcripts, nucleus boundaries,
and Magic Lens are off.

## Image

The `.vzg` (the MERSCOPE Vizualizer file, 11-23 GB) is a ZIP64 zip with one
image pyramid per stain and z plane, `pictures/pyrmosaic_<stain>_z<k>.tif`:
a BigTIFF of 12-bit JPEG tiles (384 px) whose levels are pages, from the
full mosaic (0.108 µm per pixel) down. Every entry is deflated, and a
deflate stream cannot be read from the middle, so an image is read whole:

1. `readZipDirectory` (`src/data/zipArchive.ts`) reads the central directory
   from the archive's tail (one `HEAD` and one or two ranges), then the
   image manifest and transform entries.
2. `imageSource({ stain, z })` fetches the pyramid's entry in one ranged
   request and inflates it with `DecompressionStream('deflate-raw')` in a
   worker (`zipEntry.worker.ts`), logging progress.
3. The TIFF is opened from memory as a [page
   pyramid](./image.md#page-pyramids) at the transform's origin
   (−translation ÷ scale, the mosaic's `bbox_microns` corner, in stage µm)
   and pixel size. Its tiles decode as 12-bit JPEG
   ([Codecs](./image.md#codecs)). The image is drawn with square pixels, so
   a transform whose x and y scales differ by more than 0.1%, or that shears,
   is refused with a message naming the scales.

The image is one channel, named after the stain. The Image section's
`Stain` (or None) and `Plane` controls choose it; each plane option shows its
size in the zip. A change reloads the dataset with the choice, as a Visium
library change does: the dataset instance is cached, so the tables are not
read again, and the view, genes, and layers carry over. The choice is kept in
the link as `mimg=<stain>_z<plane>` or `mimg=none`. Choosing a stain loads it
even with `Morphology image` off.

Sizes vary with the region: Ctrl173 (BIA S-BIAD3359, 49,469 × 37,959 px)
has DAPI at 317 MB per plane and BFP at 63 MB, while small regions are tens
of MB. The default, DAPI at the middle plane (else the first stain's), loads
with the dataset only when it is at most 100 MB; otherwise a notice says to
choose a stain. The last image read is kept, so a reload for the same image
does not download it again; others are downloaded when chosen.

## Cell Boundaries

The boundary file holds one row per cell per z plane (7 in instrument
output), in one row group, so it cannot be read by viewport. The first
`elements(bbox)` call reads it whole, in the shapes worker
(`readSpatialDataShapesInWorker` with `idColumn` `EntityID`, `planeColumn`
`ZIndex`, and `wholeFile`):

- Only the middle plane present is kept (plane 3 of 0-6). Outlines in the
  checked deposits are the same on every plane.
- Of a MultiPolygon, the largest polygon's outer ring is drawn.
- Outlines of cells the tables do not hold are left out. When none match,
  the boundary layer reports that the files may come from different
  segmentations.

Later viewport requests filter the kept outlines by their bounds and reuse
the elements of cells still in view.

## Diagnostics

`runMerscopeDiagnostics` (`src/data/datasetDiagnostics.ts`) checks both CSVs
with `HEAD` (each fails above 300 MB), the boundary file as optional, and the
`.vzg` with a byte-range request (optional; a warning says to name it in the
manifest when it was not found). The tables and boundaries need no Range
support: they are read whole. `detected_transcripts.csv` and
`images/manifest.json` are listed when present, marked as not shown yet.

## Source Files

| File                                                                                      | Role                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `src/datasets/merscopeFormat.ts`                                                          | File names, limits, CSV parsers, join into the table          |
| `src/datasets/merscopeTableReader.ts`, `merscopeTableWorker.ts`                           | Fetch and gunzip, worker client                               |
| `src/workers/merscopeTable.worker.ts`, `merscopeTableCore.ts`, `merscopeTableMessages.ts` | Table worker                                                  |
| `src/datasets/merscopeDataset.ts`                                                         | `MerscopeDataset`: AnnData table, boundaries, overview, image |
| `src/data/zipArchive.ts`, `zipEntryWorker.ts`, `src/workers/zipEntry*.ts`                 | ZIP64 directory, one entry fetched and inflated in a worker   |
| `src/tiff/loader.ts`, `src/codecs/jpegSequential.ts`                                      | Page pyramids from memory with an origin; 12-bit JPEG         |
| `src/features/dataset/merscopeImageModel.ts`, `useMerscopeImageWorkflow.ts`               | Stain and plane controls, link value, reload                  |
| `src/datasets/spatialDataShapes.ts`, `spatialDataShapesWorker.ts`                         | GeoParquet outlines, ID column, plane filter, whole reads     |
| `src/datasets/datasetFactory.ts`                                                          | Folder and manifest detection, construction                   |
| `src/features/app-shell/useDatasetLifecycle.ts`                                           | Load sequence, boundary size rule, notices                    |
| `src/features/app-shell/platformAdapter.ts`                                               | `MERSCOPE_PLATFORM_ADAPTER`                                   |
| `src/data/datasetDiagnostics.ts`                                                          | `runMerscopeDiagnostics`                                      |

## Known Limitations

- Images come only from the `.vzg`. The raw mosaics in `images/` are
  single uncompressed strips without a pyramid (3.8 GB per stain and plane
  for Ctrl173) and are not used; deposits without a `.vzg` have no image.
- One stain and plane at a time, each read whole: up to a few hundred MB
  per image for large regions, held in memory while shown. The two smallest
  pyramid levels (32 px tiles) are left out.
- No transcripts: `detected_transcripts.csv` has no spatial order and reaches
  35 GB.
- Each CSV is read whole, up to 300 MB; large regions need splitting or
  conversion to `.h5ad`.
- The boundary file is read whole, up to several hundred MB for large
  regions; such files start with boundaries off.
- vpt outputs and GEO deposits need a manifest; the viewer does not search a
  folder for `cellpose_*` or `baysor_*` files.
- The older per-FOV HDF5 boundaries (`cell_boundaries/feature_data_<fov>.hdf5`)
  are not read.
- One plane's outlines are drawn; 3D cell shapes are not.
- Magic Lens is unavailable, as for H5AD.
