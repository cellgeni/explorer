# MERSCOPE Modality

How the viewer reads Vizgen MERSCOPE output: one region folder as the
instrument writes it, or as the Vizgen Postprocessing Tool (vpt) writes a
re-segmentation. The cell tables become an in-memory AnnData table, as for
[standard Visium](./visium.md), so cells, genes, annotations, metadata
tracks, ROI, and expression use the [H5AD read paths](./h5ad.md#feature-read-paths).
Cell outlines come from the boundary GeoParquet. Images and transcripts are
not read yet (plan [Phase 18](../plan/phases/18-merscope.md), stage 18-B).
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

`createSpatialDataset` lazy-imports `MerscopeDataset`
(`src/datasets/merscopeDataset.ts`).

### Dataset Manifest

A [dataset manifest](../dataset-manifest.md#merscope) with
`"platform": "merscope"` can name each of the three files. Files it names
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

Both CSVs are fetched and parsed in one worker (`merscopeTable.worker.ts`):
the parser scans the text once and writes counts straight into CSR arrays,
without an object per cell. Gzip is recognised from the first two bytes, not
the file name. A `Content-Length` above 300 MB, or a gzipped file that
inflates past it, fails the load with the file's size.

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

Gating is in `MERSCOPE_PLATFORM_ADAPTER`
(`src/features/app-shell/platformAdapter.ts`): AnnData workflows and cell
boundaries from `dataset.elements(bbox)`; transcripts, nucleus boundaries,
images, and Magic Lens are off.

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
with `HEAD` (each fails above 300 MB) and the boundary file as optional. No
Range support is needed: every file is read whole. `detected_transcripts.csv`
and `images/manifest.json` are listed when present, marked as not shown yet.

## Source Files

| File                                                                                      | Role                                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/datasets/merscopeFormat.ts`                                                          | File names, limits, CSV parsers, join into the table      |
| `src/datasets/merscopeTableReader.ts`, `merscopeTableWorker.ts`                           | Fetch and gunzip, worker client                           |
| `src/workers/merscopeTable.worker.ts`, `merscopeTableCore.ts`, `merscopeTableMessages.ts` | Table worker                                              |
| `src/datasets/merscopeDataset.ts`                                                         | `MerscopeDataset`: AnnData table, boundaries, overview    |
| `src/datasets/spatialDataShapes.ts`, `spatialDataShapesWorker.ts`                         | GeoParquet outlines, ID column, plane filter, whole reads |
| `src/datasets/datasetFactory.ts`                                                          | Folder and manifest detection, construction               |
| `src/features/app-shell/useDatasetLifecycle.ts`                                           | Load sequence, boundary size rule, notices                |
| `src/features/app-shell/platformAdapter.ts`                                               | `MERSCOPE_PLATFORM_ADAPTER`                               |
| `src/data/datasetDiagnostics.ts`                                                          | `runMerscopeDiagnostics`                                  |

## Known Limitations

- No images. Mosaics in `images/` are single uncompressed strips without a
  pyramid, and the `.vzg` pyramids are 12-bit JPEG inside a zip; both are
  planned (stage 18-B).
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
