# Stage 4: platform and backend matrix (R3)

Coordinator notes, 2026-11-20, commit `6a9a736`. No worker was used: the plan put one on the image readers, but sub-agents run at xhigh effort in this session and the user has not chosen how to handle that. Repro rerun: `../evidence/platforms-stage4/repro-run.log` (11 files, 58 tests, 51 pass, 7 fail: the same 7 as in stage 1). The live Xenium repro was not rerun; its earlier log (`../evidence/platforms/xenium-zarr-ids-live.log`, 2026-11-19) is used with the arithmetic rechecked below.

## Scenario matrix

"Repro" means a review repro in `../evidence/repro/` with hand-written or numpy expectations. "Test" means an existing test that passed in the baseline; for those, the assertion was read, not re-derived.

| Platform or backend | Success case                                                                                                                                                                                                                      | Failure or unsupported case                                                                                                           | Findings                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Xenium              | Repro `platforms/xenium-duckdb`: XOA 2.x nuclei by `label_id`, XOA 1.x fallback to one nucleus per cell, selected-gene counts follow cell IDs when `cells.parquet` is in another order than the matrix (real DuckDB-WASM, 3 pass) | Same repro: XOA 1.0.x `int32` `cell_id` is refused with "Expected viewport cell row cell_id to be a string." (documented unsupported) | PLT-01, PLT-02, PLT-03  |
| Atera               | Test `ateraDataset.test.ts:223` (overview from matrix obs and `cells.zarr.zip`), sampled                                                                                                                                          | Test `ateraDataset.test.ts:530` (CSC feature count mismatch rejects; asserts any error)                                               | none                    |
| Standard Visium     | Repro `platforms/visium-readers`: 11 cases (axis order, scale applied once, hires alignment, CSC by barcode, MEX 1-based joins, `in_tissue`, feature types)                                                                       | Same repro: matrix barcodes without the `-1` suffix of the positions fail with a clear error                                          | PLT-08                  |
| Visium HD           | Test `visiumHdDataset.test.ts:1184` (2 µm-only bins placed by the `feature_slice.h5` transform); matrix rows VHD-02, VHD-07, VHD-10 checked in code                                                                               | Test `visiumHdDataset.test.ts:1234` (2 µm-only dataset whose Feature Slice cannot place its bins: error names the file)               | none new                |
| H5AD                | Repro `AD/axes`: coordinates match numpy for CSR, CSC and dense `/X`, whole and range-read                                                                                                                                        | Test `h5adDataset.test.ts:1745-1756`: a 350 MB file on a host that ignores Range is refused with the size message                     | SCI-01, SCI-03, SCI-04  |
| AnnData Zarr        | Repro `AD/axes` (`csr/zarr`, `dense/zarr`)                                                                                                                                                                                        | As H5AD (shared reader)                                                                                                               | SCI-04 (backend spread) |
| Reference, Icechunk | Tests `h5adDataset.test.ts:927` (oversized H5AD through a kerchunk companion), `:1191`, `:1274` (Icechunk companion and native)                                                                                                   | Test `datasetFactory.test.ts:1925`: an Icechunk URL with no repository gives `IcechunkRepositoryUnavailableError`                     | none                    |
| SpatialData         | Repro `AD/spatialdata-int64`, control case: instance IDs below 2^53 place every row                                                                                                                                               | Same repro: IDs above 2^53 place no row and the load fails                                                                            | PLT-04                  |
| Images              | Repro `imaging/tiffFormats`: planar RGB LZW with predictor and zstd tiles decode with 0 differences; `imaging/cellImageMeasureOracle`: 0 mismatches for TIFF and OME-Zarr                                                         | Same repro: float32 tiles refused with "Only 8-bit and 16-bit tiles are supported" (documented, `image.md:172`)                       | PLT-09                  |
| MERSCOPE            | Repro `platforms/merscope-csv-join`: 19-digit IDs stay exact strings through the join, BOM, CRLF, reordering, Blank columns summed; `merscope-vzg-placement` isotropic case spans the manifest bbox exactly                       | Repro `merscope-size-limit`, first case: a gzipped CSV inflating just past 300 MiB gives the documented size message                  | PLT-05, PLT-06, PLT-07  |
| Collections         | Stage 2 probes: every example collection parses through the runtime parser; stage 3: 3D stack model                                                                                                                               | Tests `datasetCollection.test.ts:106` (not version 1), `:220` (same dataset twice); stage 2 probes C06, C08 (non-finite or mixed `z`) | DOC-04 (schema gap)     |

## Provisional findings

### PLT-01 ROI transcript export fails on current Xenium output (P1)

- Confidence: confirmed by execution (`platforms/xenium-duckdb.repro.ts`, real DuckDB-WASM) and static proof; live data shows the input occurs.
- XOA 1.3 and later write `cell_id = "UNASSIGNED"` in `transcripts.parquet` for transcripts outside every cell. The demo's first row group has 2,330 such rows of 262,144, 1,808 of them gene calls with QV ≥ 20 (`../evidence/platforms/xenium-demo-transcripts-unassigned.log`).
- `Export Transcripts` reads `transcripts.parquet` with DuckDB (`loadDatasetRoiTranscripts`, `src/data/roiTranscripts.ts:22-53` → `readXeniumTranscriptsInBbox` / `ForSelection`, `xeniumDatasetReaders.ts:476-540`). Each row goes through `parseTranscriptExportRow` (`xeniumDatasetRows.ts:124-149`), which keeps `null` but passes any string to `asCellId` (`cellid.ts:41-46`). `UNASSIGNED` fails `/^[a-p]{8}-\d+$/`, so the whole export rejects with "Invalid Xenium cell ID: UNASSIGNED."
- At 0.7% of QV ≥ 20 rows, almost any selection of more than a few hundred transcripts holds one, so the export fails on the demo and on all current XOA output.
- The same parse (`parseTranscriptPointRow`, `xeniumDatasetRows.ts:264-300`) serves the Parquet exact-point fallback and the cell-ID enrichment of Zarr points (PLT-02).
- Docs: `docs/modalities/xenium.md:50` ("ROI transcript CSV"), `ui-reference.md:658`.
- Existing tests use `null` for unassigned rows; none has `UNASSIGNED`.
- Correction: map `UNASSIGNED` (and other non-ID strings, with a count) to `null` in both row parsers, or `NULLIF(cell_id, 'UNASSIGNED')` in the SQL; add a fixture row.
- Severity: P1 because a documented workflow is unusable on the registered demo. Revisit in stage 8 if ROI transcript export is judged a minor path.

### PLT-02 Exact transcripts from the Zarr never get their cell (P2)

- Confidence: confirmed by execution on live data (first attempt's run, 2026-11-19, `../evidence/platforms/xenium-zarr-ids-live.log`), with the arithmetic rechecked; static proof for the merge.
- `mergeTranscriptPointMetadata` (`transcriptOverlay.ts:373-409`) joins Zarr points to Parquet rows on `fovName + transcriptId` (`transcriptPointMetadataKey`, line 643). The Zarr reader takes `transcriptId` from `id[row, 0]` (`transcriptZarr.ts:262`), a uint32. Parquet's `transcript_id` is a uint64: for the demo point at (220.70, 1464.42) it is 281668250306971 = 65581 × 2^32 + 67995, and the Zarr gives 67995. The keys never match, so no Zarr point gets its cell ID, nucleus overlap or distance, and the Transcript card shows no cell.
- When the view holds an `UNASSIGNED` row, the enrichment query rejects (PLT-01) and a notice says "Parquet metadata enrichment failed" (`transcriptOverlay.ts:455-466`).
- Docs: `xenium.md:50` lists "cell IDs for Zarr points" as what `transcripts.parquet` provides.
- Tests use the same small ID on both sides (`transcriptOverlay.test.ts:176-210`).
- Correction: key on the low 32 bits of the Parquet ID (or rebuild the Zarr ID with its high word) after checking the layout on a second XOA version; add a fixture with a 64-bit ID.

### PLT-03 Zoomed-out transcript density shows sampled counts as "Count" (P2)

- Confidence: static proof, plus the first attempt's live totals per level.
- All-feature density squares come from the grid level that fits the view (`chooseTranscriptGridLevel`, `transcriptZarr.ts:462-490`) and carry that level's `grid_number_objects` (`readGridLevels`, `:1342-1365`). The code itself notes that coarser levels hold a sample, "level 1 holds 76% and level 7 1%" (`:544-546`). The hover and the Transcript card print the number as "Count" (`viewerHoverTooltips.tsx:300-303`, `TranscriptStatusPanel.tsx:250-253`).
- Live totals over the whole demo slide: 554,699,029 at level 0, 423,752,521 at level 1, 5,292,443 at level 7.
- Colours are normalised per square size, so the picture is right; the numbers are low by up to 100×.
- Correction: scale counts by the level's ratio to level 0, or label them as sampled; or take squares from level 0 sums.

### PLT-04 SpatialData tables with 64-bit instance IDs above 2^53 do not load (P2)

- Confidence: confirmed by execution (`AD/spatialdata-int64.repro.ts`, real shapes reader on a pyarrow file) and static proof.
- The table's instance-key column is read through `readObsColumnValues` (`h5adDataset.ts:3498-3530`), which turns a `BigInt64Array` into numbers (`numericArrayToNumbers`, line 3521), so IDs above 2^53 round. The shapes side keeps the exact `bigint` text (`instanceIdString`, `spatialDataShapes.ts:396-408`). The join (`spatialDataDataset.ts:773-782`) then matches nothing and the load fails with "rows did not match any … instances" (line 869). In the repro three distinct IDs round to one number.
- spatialdata-io keeps MERSCOPE `EntityID`s (19 digits) as the instance key, so its MERSCOPE stores are affected. Workaround: open the native MERSCOPE output.
- Correction: read integer instance keys as `bigint` text, as the shapes side does.

### PLT-05 MERSCOPE CSVs with quoted commas are refused (P3)

- Confidence: confirmed by execution (`platforms/merscope-csv-join.repro.ts`, 2 cases).
- The CSV reader splits on every comma; quotes are only stripped from whole fields (`splitHeader`, `merscopeFormat.ts:734-739`; `forEachRow`). A quoted value with a comma (`"T cell, CD4+"`, as pandas writes it) gives "cell_metadata.csv row 1 has 5 fields; the header has 4." and the load stops. A doubled quote stays doubled (`a ""b""`).
- Vizgen's own columns are numeric; added annotation columns are where this occurs. No page says quoting is unsupported.
- Correction: RFC 4180 field parsing, or say in `merscope.md` which CSVs are accepted.

### PLT-06 A gzipped MERSCOPE CSV is inflated whole before its size is checked (P3)

- Confidence: confirmed by execution (`platforms/merscope-size-limit.repro.ts`) and static proof.
- `merscopeTableReader.ts:79-98` checks `Content-Length` and the compressed size, then decodes the whole text and checks its length. Between 300 MiB and the engine's string limit (0x1fffffe8, about 512 MiB) the file is inflated and decoded before it is refused; above that the user gets "Cannot create a string longer than 0x1fffffe8 characters" instead of the documented size message (`merscope.md:65-66`).
- Correction: count inflated bytes while streaming and stop at the limit. Stage 5 looks at unbounded inflation in other readers.

### PLT-07 Anisotropic `.vzg` transforms are averaged (P3)

- Confidence: confirmed by execution on a synthetic `.vzg` (`platforms/merscope-vzg-placement.repro.ts`).
- `parseMerscopeTransform` (`merscopeFormat.ts:149-174`) refuses shear but returns one `micronsPerPixel = 2 / (scaleX + scaleY)`, so a transform with scale 2 and 4 places the image at 1/3 µm per pixel on both axes: x ends at 1066.7 instead of 1100, y at 3053.3 instead of 3040.
- Vizgen transforms are isotropic in the public datasets seen, so the real impact is unknown.
- Correction: refuse unequal scales with a message, or carry per-axis scale.

### PLT-08 A gzipped `.h5` named in a Visium manifest fails (P3)

- Confidence: confirmed by execution (`platforms/visium-h5-gzip.repro.ts`).
- `dataset-manifest.md:176-177` says every standard Visium file "is read whole … and gzipped copies (`.gz`) work"; `visium.md:62-64` says a manifest "can rename or move every Space Ranger file, including gzipped ones". A manifest naming `GSM1_filtered_feature_bc_matrix.h5.gz` fails with "The file is not a readable HDF5 file." The `.mtx.gz`, `.csv.gz`, `.json.gz` and image `.gz` cases work.
- Correction: gunzip the `.h5` before opening it (it is read whole), or make the docs name the exception.

### PLT-09 The TIFF reader mis-reads four uncommon layouts without saying so (P3)

- Confidence: confirmed by execution on synthetic files (`imaging/tiffFormats.repro.ts`, observations in `../evidence/imaging/tiffFormats.out.txt`), static proof for (a) and (d).
- (a) Every SubIFD level takes level 0's tile size (`src/tiff/loader.ts:412-438`; the comment says "Tiled levels keep their tiles"). A level tiled differently decodes wrong: 1,520 of 1,536 pixels differ.
- (b) `PhysicalSizeY` is not read; OME-TIFF placement uses `PhysicalSizeX` for both axes, so an image with 0.5 × 1.0 µm pixels is half height. Per-cell image measurement then disagrees with the oracle for 64 of 67 cells (`../evidence/imaging/cellImageMeasureOracle.out.txt`).
- (c) Signed 16-bit samples (`SampleFormat` 2) are read as unsigned (−500 becomes 65036) while the contrast window is −32768 to 32767. `image.md:172` says 8- or 16-bit, without the signed case.
- (d) A tile with no `Compression` tag is sent to the JPEG 2000 decoder (`src/codecs/tiffTile.ts:60-65`); TIFF's default is 1 (none). The open fails with "JPEG-2000 decode returned invalid dimensions 0x0."
- Writers seen in the docs (tifffile, Bio-Formats, Xenium, PhenoCycler) use one tile size, isotropic pixels, unsigned samples and write the tag, so all four are rare. (a) and (b) give a wrong image with no error.
- Correction: per-level tile size; read `PhysicalSizeY` or refuse unequal sizes; handle or refuse signed samples; default a missing tag to 1.

### PLT-10 `spatialdata.md` says zips hold only SpatialData (P3, documentation)

- `docs/modalities/spatialdata.md:48-49`: "A zip holding any other Zarr store is an error, since only SpatialData is read from zips." `detectZarrZip` also opens a zipped OME-Zarr image (`datasetFactory.ts:644-653`), as `image.md:24` says.

## Additions to earlier findings

- **SCI-01 is narrower than written.** Magic Lens is unavailable on H5AD, Visium, MERSCOPE and SpatialData (`platformAdapter.ts:236-239, 267-270, 298-301, 330-333`). Atera has it, but its matrices are counts. The negative-value loss affects multi-gene colouring and ROI gene statistics, not the Magic Lens. `science-stage3.md` is corrected.
- **SCI-04 has a second effect.** With two genes named `G-2` after suffixing, the map reads the last such column and Plots the first, and a cell's all-gene profile differs by backend: CSR keeps both columns, dense and in-memory CSC report column 2 twice, dense Zarr once (`AD/axes.repro.ts:200-264`).

## Matrix rows carried from stage 2

| Row     | Result                                                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XEN-12  | code defect: PLT-01, PLT-02                                                                                                                                                 |
| XEN-13  | matches: `MAGIC_LENS_GENE_STATS_LIMIT` limits the number of genes listed (`roiGeneStats.ts:113,148`), not cells. The worker's reading was wrong                             |
| VIS-08  | matches: `VISIUM_SPOT_DIAMETER_MICROMETERS = 55` (`visiumFormat.ts:14`) sets the spot area and polygons (`h5adDataset.ts:1415-1418, 1641-1648`); 65 µm is not used for them |
| VIS-09  | matches: `VISIUM_PLATFORM_ADAPTER` (`platformAdapter.ts:246-273`)                                                                                                           |
| VIS-10  | code defect: PLT-08                                                                                                                                                         |
| VHD-02  | matches: 8 entries in `VISIUM_HD_SEGMENTED_OUTPUT_PROBES` (`datasetFactory.ts:199-245`)                                                                                     |
| VHD-07  | matches: `readVisiumHdGeneExpression` gets only the Feature Slice path and reader (`visiumHdDatasetReaders.ts:691-708`)                                                     |
| VHD-10  | matches: thrown at `visiumHdDatasetReaders.ts:836-838` and `:868-871`, both naming the file                                                                                 |
| VHD-11  | matches the page: the app never passes `visiumHdMaxTwoMicrometerFilteredBarcodes` (only `datasetFactory.ts` and tests use it), so no budget applies. Unused option: stage 7 |
| H5AD-09 | matches: `H5AD_PLATFORM_ADAPTER` (`platformAdapter.ts:213-241`): transcripts and nucleus boundaries off, Magic Lens "Unavailable for H5AD"                                  |
| SD-09   | matches (`datasetFactory.ts:625-642`); the page's next sentence is PLT-10                                                                                                   |
| MER-06  | matches by execution (`merscope-csv-join.repro.ts`, first test)                                                                                                             |
| MER-08  | matches (`merscopeDataset.ts:549-550`)                                                                                                                                      |
| MER-10  | code defect: PLT-06                                                                                                                                                         |

## Observations, not findings

- Duplicate barcode rows in a Visium positions file resolve silently to the last row (`visium-readers.repro.ts:374`). Space Ranger does not write duplicates.
- The first attempt's TIFF and Zarr repros assert `toBeTruthy()` on observations; their evidence is in the `.out.txt` files, not in pass or fail.
- `ateraDataset.test.ts:530` asserts that some error is thrown, not which one (stage 7).
- Reference and Icechunk backends are covered by existing tests only; no independent oracle was run for them.

## Depth

| File or area                                                                                                    | Depth                              |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `xeniumDatasetRows.ts` (transcript parsers), `roiTranscripts.ts`, `transcriptOverlay.ts` (merge)                | reviewed                           |
| `xeniumDatasetReaders.ts` (transcript SQL), `transcriptZarr.ts` (levels, IDs)                                   | sampled                            |
| `merscopeTableReader.ts`, `merscopeFormat.ts` (transform, header split, middle plane)                           | reviewed                           |
| `merscopeDataset.ts` (image options)                                                                            | sampled                            |
| `platformAdapter.ts`                                                                                            | reviewed                           |
| `spatialDataDataset.ts` (join), `spatialDataShapes.ts` (`instanceIdString`), `h5adDataset.ts` (obs column read) | sampled                            |
| `visiumHdDatasetReaders.ts`, `visiumFormat.ts`, `datasetFactory.ts` (zip detection, HD probes)                  | sampled                            |
| `src/tiff/loader.ts` (level tile size), `src/codecs/tiffTile.ts` (decoder choice)                               | sampled                            |
| Atera, Icechunk, reference readers                                                                              | not reviewed beyond existing tests |
