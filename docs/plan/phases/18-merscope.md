# Phase 18 — Vizgen MERSCOPE Output

Planned 2026-11-14. 18-A (basic support) implemented 2026-11-14; 18-B (image)
not started. Requested: basic support for MERFISH and MERSCOPE data, with
public datasets to test and show. This file records the output layout as
checked against public deposits, the test datasets, and the scope. How the
viewer reads it is in [MERSCOPE](../../modalities/merscope.md).

## Output Folder

A MERSCOPE region folder, as written by the instrument or the Vizgen
Postprocessing Tool (vpt). Checked on BIA S-BIAD3359 `Ctrl173` (2024 run),
S-BIAD2957, S-BIAD4011, S-BIAD2376, S-BIAD1093, S-BIAD3825, Zenodo 13835782
and 11160289, and GEO GSM9427137.

| File                                          | Size seen                            | Format                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cell_by_gene.csv`                            | 3–131 MB                             | Dense counts. Header `cell,<genes…>,Blank-*`; one row per cell                                                                                                                                             |
| `cell_metadata.csv`                           | 0.6–76 MB                            | `EntityID,fov,volume,center_x,center_y,min_x,min_y,max_x,max_y,anisotropy,transcript_count,perimeter_area_ratio,solidity`, then `<stain>_raw,<stain>_high_pass` per stain. µm (volume µm³)                 |
| `cell_boundaries.parquet`                     | 0.8–535 MB                           | GeoParquet 0.4.0, WKB MultiPolygon in µm (usually one ring of 8–156 points). `ID, EntityID, ZIndex, Geometry, Type, ZLevel, Name, ParentID, ParentType`. One row per cell per z plane (7×). One row group  |
| `detected_transcripts.csv`                    | 9.5 MB–35 GB                         | Unnamed index column, `barcode_id, global_x, global_y, global_z, x, y, fov, gene, transcript_id, cell_id`. µm; `global_z` is the plane 0–6; `cell_id` −1 when unassigned. Ordered by FOV, no spatial index |
| `images/mosaic_<stain>_z<k>.tif`              | 1.1–24 GB each (63 files in Ctrl173) | BigTIFF, uint16, uncompressed, one strip, no tiles, no pyramid, no OME-XML. 0.108 µm/px                                                                                                                    |
| `images/micron_to_mosaic_pixel_transform.csv` | < 1 KB                               | 3×3 affine, space-separated, no header: µm → mosaic pixels (Ctrl173: scale 9.2595, translation −30,747.5, −67,805.0)                                                                                       |
| `images/manifest.json`                        | < 16 KB                              | `microns_per_pixel`, `mosaic_width_pixels`, `mosaic_height_pixels`, `bbox_microns`, `mosaic_files` and `mosaic_pyramid_files` (`stain`, `z`, `file_name`)                                                  |
| `*.vzg`                                       | 11–23 GB                             | Zip for the MERSCOPE Vizualizer; every entry deflated. Holds `pictures/pyrmosaic_<stain>_z<k>.tif`, `pictures/manifest.json`, the transform, and Vizgen binary cell and gene arrays                        |
| `summary.png`                                 | < 1 MB                               | Run summary                                                                                                                                                                                                |

Facts that shape the readers:

- **Cell IDs do not fit a JavaScript number.** `EntityID` and `cell` are
  19-digit int64 values such as `1556416100000100001`, above 2^53; the 2022
  release has 38–39-digit IDs. They must be parsed as strings.
- **The CSVs are dense.** `cell_by_gene.csv` writes every zero: Zenodo region 0
  is 101.9 MB for 91,004 cells × 550 columns.
- **Instrument boundaries cannot be read in part.** One row group holds every
  row and Geometry is most of the file, so a viewport read still downloads it
  all (523 MB of Geometry in Ctrl173). Each cell appears once per z plane.
- **Mosaics open, but only zoomed in.** Since the stripped-TIFF reader
  (cellgeni/explorer#94) they open as 256 px tiles cut from bands of whole
  rows, about 84 rows per 8 MiB band at Ctrl173's width of 49,469. With no
  pyramid, a zoomed-out view needs every band, which is the whole 3.76 GB per
  stain and plane, so the edges stay empty until zoomed in.
- **The `.vzg` holds a usable pyramid.** `pyrmosaic_<stain>_z<k>.tif` is a
  BigTIFF whose top-level IFDs are the levels, from full resolution down (8
  levels, 384 px tiles, 32 px at the two smallest), in 30–46 MB per stain and
  plane. Checked on an unzipped copy in S-BIAD3825: level 0 is 20,728 ×
  20,765, the size `pictures/manifest.json` gives for the mosaic. Two
  obstacles: the zip entry is deflated, so it must be fetched and inflated
  whole; and the tiles are 12-bit JPEG (SOF1, `BitsPerSample` 12), which
  browsers cannot decode and geotiff's JPEG decoder clips to 8 bits.
- **Image placement.** The mosaic origin is at `bbox_microns[0..1]`
  (= −translation / scale), not at 0 µm; cell coordinates are stage µm.

Variants:

- GEO prefixes each file (`GSM9427137_EFE_r1_cell_by_gene.csv.gz`) and gzips
  all of them, including `cell_boundaries.parquet.gz`. GEO samples have no
  images.
- Zenodo serves files only through `/api/records/<id>/files/<name>/content`,
  so URLs have no suffix; `/records/<id>/files/<name>` sends no CORS.
- BIA path forms differ per study: S-BIAD3825 and S-BIAD4011 are only under
  `/pub/databases/biostudies/`, the others only under `/biostudies/fire/`.
- The 2022 Vizgen release (Zenodo 11160289): unnamed ID column, counts
  written as `0.0`, `cell_metadata.csv` as
  `,fov,volume,center_x,center_y,min_x,max_x,min_y,max_y`, and transcripts
  without `cell_id`.
- Runs without on-instrument segmentation (S-BIAD1093) have no cell files at
  the region root and 10-column transcripts.
- vpt re-segmentation writes `cellpose_cell_by_gene.csv`,
  `cellpose_micron_space.parquet`, `*_mosaic_space.parquet`,
  `baysor_cell_by_gene.csv`, `baysor_cell_metadata.csv`,
  `baysor_micron_space.parquet`. These Parquet files have 17,500-row groups,
  and newer ones are GeoParquet 1.0.0; the re-segmented metadata has an empty
  `fov` and no stain columns. In S-BIAD2376 the Baysor cell IDs do not match
  `detected_transcripts.csv` `cell_id`; Baysor's assignment is in
  `baysor_segmentation.csv` (`cell`).
- Stains and planes vary: S-BIAD3359 adds protein stains, 2025 S-BIAD2957 runs
  have DAPI and PolyT only, S-BIAD3825 has 8 planes, and S-BIAD2376 has z3
  only and no `images/manifest.json`. Blank columns start at `Blank-0` or
  `Blank-1`.

## Test Datasets

All checked 2026-11-14 with `Origin` + `Range`: CORS `*` and `206`. BIA and
Zenodo hide `Content-Range`; BIA 404s carry no CORS headers.

| Dataset                                        | Tissue                     | Cells × genes            | Files                                                          | Base URL                                                                                                                                 | Licence     |
| ---------------------------------------------- | -------------------------- | ------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| BIA S-BIAD3359 `Ctrl173` (SpatialBench)        | Mouse spleen, with protein | ~158k × 91 (+89 Blank)   | Full layout: 63 mosaics, 11.6 GB `.vzg`; boundaries 535 MB     | `https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/359/S-BIAD3359/Files/MERSCOPE/Ctrl173/` (8 more regions beside it)                         | CC0         |
| BIA S-BIAD4011 `Pt08_PRE`                      | Human head and neck cancer | ~139k × 300 (+15 Blank)  | Standard four files; boundaries 430 MB; no images              | `https://ftp.ebi.ac.uk/pub/databases/biostudies/S-BIAD/011/S-BIAD4011/Files/MERFISH/Pt08_PRE/`                                           | CC0         |
| Zenodo 13835782 hSO/hStrO assembloid, region 0 | Human organoid             | 91,004 × 500 (+50 Blank) | Standard four files with a prefix; boundaries 229 MB           | `https://zenodo.org/api/records/13835782/files/hSO.hStrO_assembloid_region_0_<kind>/content`                                             | CC BY 4.0   |
| BIA S-BIAD2376 `D082` region 0                 | Human skin                 | ~3k × 499                | Baysor and Cellpose variants; 9.5 MB transcripts; z3 mosaics   | `https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/376/S-BIAD2376/Files/nsatlas/merfish/202311011251_D082--5-8--11012023_VMSC02301/region_0/` | CC BY 4.0   |
| BIA S-BIAD3825 (unpacked `.vzg`)               | Human skeletal organoids   | No cell tables           | `pictures/pyrmosaic_*.tif` served unzipped (38 MB for DAPI z3) | `https://ftp.ebi.ac.uk/pub/databases/biostudies/S-BIAD/825/S-BIAD3825/Files/StemCell%20All/<region>/pictures/`                           | CC BY 4.0   |
| GEO GSM9427137 (GSE315408)                     | Human heart                | 12,270 × 479 (+71 Blank) | All gzipped; 3.8 MB transcripts; no images                     | `https://ftp.ncbi.nlm.nih.gov/geo/samples/GSM9427nnn/GSM9427137/suppl/GSM9427137_EFE_r1_`                                                | None stated |

Other readable deposits: BIA S-BIAD2957 (mouse somatosensory cortex, CC BY,
several hundred thousand cells × 721 genes per region, 35 GB transcripts,
21–24 GB mosaics), S-BIAD1093 region 2 (medulloblastoma, CC BY, ~29k × 140
from Cellpose, 1.7 GB mosaics), Zenodo 7852005 (a 129 MB zip of a 400 µm
crop) and 11160289 (the 2022 release), and GEO GSE282127 (an `.h5ad` with
`obsm/spatial`, which already opens as H5AD).

Not readable: Vizgen's own Google Cloud buckets (`public-datasets-vizgen-merfish`,
`vz-ffpe-showcase`, `vz-liver-showcase`, `vz-merfish2-showcase`: anonymous
reads get 403 and preflights no CORS), figshare (the presigned download host
sends no CORS), Dryad (401/403), the scverse example data (no CORS), the Brain
Image Library (connections refused), CELLxGENE MERFISH datasets (not in the
Census buckets), the Salk aging brain on AWS Open Data (one `.tar.gz` of up to
2.2 TB per run), and GEO series that deposit `.vzg.gz` or large deflated zips.
EBI range requests took 7–10 s each on 2026-11-14.

## Decisions

- **D1.** One `merscope` platform, read through the AnnData reader as Phase 14
  reads Space Ranger output: `cell_by_gene.csv` and `cell_metadata.csv` become
  an in-memory AnnData table (`memorySource`). Cells, genes, annotations,
  metadata tracks, ROI, the cell card and selected-gene overlays then use the
  H5AD paths unchanged. `MerscopeDataset` wraps that `AnnDataH5adDataset` as
  `AteraDataset` wraps its matrix, adding boundaries, the image, and the
  overview's transcript counts.
- **D2.** Coordinates are `center_x`, `center_y` as given (stage µm, y down),
  written to `obsm/spatial`. They are not shifted to the mosaic origin, so
  coordinates match Vizgen's tools; the image is placed instead (D9).
- **D3.** Cell IDs stay strings end to end; the two CSVs are joined by ID
  string, not by row order. An empty first header names the ID column (2022
  release). Cells missing from either file are left out and counted in a
  notice.
- **D4.** Both CSVs are fetched whole (gzip detected from the bytes, not the
  suffix) and parsed in a worker straight into CSR arrays and typed obs
  columns, without a row object per cell. Counts may be written as `0.0`.
  Limit: 300 MB per file, as for the Visium matrix.
- **D5.** `Blank-*` columns are left out of `X` and summed into an obs
  `blank_count` track. The AnnData gene list does not filter controls.
- **D6.** `fov` becomes a categorical obs column; `volume`, `transcript_count`,
  `anisotropy`, `perimeter_area_ratio`, `solidity`, and the stain
  intensities become numeric tracks; columns that are empty throughout (vpt's
  `fov`) are dropped. The wrapper's `overview()` maps `transcript_count` into
  each cell's transcript count, as `AteraDataset` maps `transcript_counts`.
  There is no cell area (`volume` is µm³), so the area colour mode stays off.
- **D7.** Boundaries come from `cell_boundaries.parquet` through the
  SpatialData shapes reader (worker, WKB, largest ring of each
  MultiPolygon), extended with an ID column (`EntityID`) and a row filter
  that keeps one `ZIndex` (the middle plane present). Files up to 100 MB load
  with the dataset with cell boundaries on; larger ones start with boundaries
  off and are read whole when turned on, with the size shown. A size the host
  does not send counts as small; BIA and Zenodo send `Content-Length` on
  `HEAD`. Outlines of cells not in the tables are left out. The file is
  fetched in one request (`wholeFile`), not by range: its single row group is
  read whole anyway, and one request beats three on EBI. That also reads
  GEO's `.parquet.gz`.
- **D8.** Detection: `HEAD cell_by_gene.csv` and `cell_metadata.csv`, with
  `cell_boundaries.parquet` for its size, alongside the standard Visium
  probes rather than the first batch: Xenium and Atera folders then make no
  extra requests (the factory tests count them), and on BIA the folder
  listing answers the earlier probes without requests. Both must answer. A
  manifest (`platform: "merscope"`) can relocate every file, which GEO
  prefixes, Zenodo URLs and vpt names need.
- **D9.** The image comes from the `.vzg` pyramid, not the raw mosaics, in a
  second stage (18-B). Read the zip's central directory from its tail, fetch
  one `pictures/pyrmosaic_<stain>_z<k>.tif` entry (30–46 MB) and inflate it
  in a worker (`DecompressionStream('deflate-raw')`), then open it with the
  top-level-IFD pyramid code that QPTIFF and SVS use. Tiles need a 12-bit
  JPEG decoder that keeps 16-bit samples. The image is placed at the
  transform's origin, which the TIFF loader does not support yet (OME-Zarr
  images already take an origin). An unzipped `pyrmosaic` file, as in
  S-BIAD3825, is read by range directly. One stain and plane at a time:
  DAPI at the middle plane first. Once the loader takes an origin, a raw
  mosaic named in a manifest `image` also opens through the stripped-TIFF
  reader, for detail views of deposits without a `.vzg`.
- **D10.** No transcripts in this phase: `detected_transcripts.csv` has no
  spatial order and reaches 35 GB. The `.vzg` binary gene arrays are not
  read.

## Tasks

### 18-A Basic Support

- [x] A. `merscopeFormat.ts`: file roles and defaults, CSV parsers (named or
      unnamed ID column, `Blank-*`, text columns), the join. Unit tests from
      trimmed real headers. The transform and `images/manifest.json` parsing
      moved to 18-B, which is their only reader.
- [x] B. CSV worker (`merscopeTable.worker.ts`): both CSVs fetched, gunzipped
      by magic bytes, parsed straight to CSR and columns, joined; progress
      messages; abort terminates it. Falls back to the main thread without a
      Worker or with a custom fetcher.
- [x] C. `merscopeDataset.ts`: `MerscopeDataset` over an `AnnDataH5adDataset`
      with a `memorySource`; join, `obsm/spatial`, obs columns, units 1 µm
      per unit, overview transcript counts (`transcript_count`, else
      `total_counts`), `summary()`.
- [x] D. Detection, manifest platform `merscope` with its file roles, JSON
      Schema, `docs/dataset-manifest.md`.
- [x] E. Platform adapter: cells, annotations, metadata tracks, cell
      boundaries; no transcripts, no nucleus boundaries.
- [x] F. Boundaries (D7): `idColumn`, `planeColumn` and `wholeFile` in the
      shapes reader and worker; `elements(bbox)` from the shapes; size rule
      and notice.
- [x] G. Diagnostics: both CSVs required (`HEAD`, 300 MB limit); boundaries
      optional; `detected_transcripts.csv` and `images/manifest.json` listed
      when present. The `.vzg` name varies per run, so it is not checked.
- [x] H. Docs: `docs/modalities/merscope.md`, the architecture tables, the user
      guide, the UI reference, and hosting notes.
- [x] I. Tests: unit tests on synthetic fixtures (19- and 38-digit IDs, gzip,
      unnamed ID column, `0.0` counts, Blank columns;
      `src/test/fixtures/merscope/make_fixtures.py`), a routed Playwright
      smoke test, and the nightly `@live` example test against BIA.
- [x] J. Example manifest `examples/bia/S-BIAD2376.json` (D082 region 0,
      Baysor, 3,003 cells × 499 genes, CC BY 4.0). Loads in about 2 s.

### 18-B Image From The `.vzg`

- [ ] K. 12-bit JPEG tile decoding (SOF1) in the tile decode workers, with
      16-bit output. Either extend a pdf.js-style baseline decoder (level
      shift 2048, clamp 4095, `Uint16Array` output) or add a WASM libjpeg
      12-bit build; measure both on Ctrl173 tiles.
- [ ] L. Zip entry reader: central directory (ZIP64), local header, ranged
      fetch of one entry, inflate in a worker, an in-memory range source for
      the TIFF reader; progress and abort.
- [ ] M. Pyramid from top-level IFDs for `pyrmosaic` files (recognized by
      `Software` `tifffile.py` and the shrinking IFD chain), channels named by
      stain from `pictures/manifest.json`, units 0.108 µm/px.
- [ ] N. Image origin in the TIFF loader, from the transform; stain and plane
      picker in the Image section.

## Later

- Transcripts: read whole below a size limit (S-BIAD2376 and GEO samples are
  under 10 MB), or a script that writes a spatially sorted Parquet.
- Boundaries: a script that keeps one z plane and writes spatially sorted row
  groups, so the viewer can read by viewport.
- Raw mosaics for deposits without a `.vzg`: a conversion script to a
  pyramidal OME-TIFF or OME-Zarr, used through a manifest `image`.
- vpt variants found from the folder listing (`cellpose_*`, `baysor_*`)
  without a manifest; older per-FOV HDF5 boundaries
  (`cell_boundaries/feature_data_<fov>.hdf5`).
