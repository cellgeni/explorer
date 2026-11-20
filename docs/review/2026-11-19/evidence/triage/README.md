# Triage of the first attempt's output

The first attempt (2026-11-19, 36 Opus 5.5 agents, stopped before consolidation) left reproductions, scripts, logs, fixtures and screenshots under `evidence/`. None of it had been checked by the coordinator. This file records what each item is and where it gets verified. Nothing was deleted or edited.

Every item stays a **lead** until the stage named below rereads it and confirms its expected values and its call path. A failing repro means the code differs from the repro's expected value. That is a defect only if the expectation is correct.

## Repro run on 2026-11-20

Command, from the repository root, with the one live-data repro left out:

```sh
npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts --exclude '**/xenium-zarr-ids-live.repro.ts'
```

Result: 25 files, 192 tests, 180 passed, 12 failed, in 8 s. Log in `repro-run.log`, per-test results in `repro-run.json`.

### Failing: the code differs from the repro's stated expectation

| Repro                               | Failing case                                                                                                     | Expectation source the repro names                                                                                           | Stage |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----- |
| `docs-core/plotsVisiumHd`           | Plots toggle shown on Visium HD                                                                                  | `user-guide.md`, `ui-reference.md` say no Plots on Visium HD                                                                 | 2     |
| `lifecycle/spatialdata-view-cancel` | 2 of 2: after a cancelled or failed view change, reads, controls and link follow the view not shown              | Plan 15.1-F, `cancelDatasetLoad` comment                                                                                     | 5     |
| `lifecycle/visium-library-cancel`   | 2 of 2: after a cancelled library switch, the control and the shared instance stay on the library not shown      | Plan 15.1-F                                                                                                                  | 5     |
| `platforms/merscope-csv-join`       | 2 of 7: quoted comma and escaped quote in CSV values (RFC 4180)                                                  | RFC 4180                                                                                                                     | 4     |
| `platforms/merscope-size-limit`     | 1 of 2: gzipped CSV inflating to 520 MiB gives the engine's string-length error, not the documented size message | `docs/modalities/merscope.md` "Files Read"                                                                                   | 4     |
| `platforms/merscope-vzg-placement`  | 1 of 2: anisotropic `micron_to_mosaic_pixel_transform`                                                           | Hand-computed bounds                                                                                                         | 4     |
| `platforms/visium-h5-gzip`          | 1 of 2: a manifest naming `filtered_feature_bc_matrix.h5.gz` fails to load                                       | `host-your-own-data.md`, `dataset-manifest.md#standard-visium`                                                               | 2, 4  |
| `platforms/xenium-duckdb`           | 2 of 6: `UNASSIGNED` cell ID in `transcripts.parquet` rejects ROI transcript export and exact transcripts        | XOA 1.3+ output; the live demo has 2,330 such rows in its first 262,144 (`platforms/xenium-demo-transcripts-unassigned.log`) | 4     |

### Passing, but written to show a defect

| Repro                                    | What it claims to show                                                                                                                                            | Stage |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `AD/spatialdata-int64`                   | SpatialData int64 instance IDs above 2^53 place no rows: the table side rounds them, the shapes side does not                                                     | 4     |
| `AD/values`                              | ROI gene statistics over negative `X` values; one NaN stored value turns a whole z-score batch NaN                                                                | 3     |
| `analysis/roiLimit`                      | AnnData-family ROIs return every cell yet are flagged as cut short; a limit applied before the lasso test (latent)                                                | 3     |
| `io/byteRangeCacheShortBody`             | The IndexedDB byte-range cache stores a short 206 body and serves it to later loads (Parquet footer, TIFF tiles); the zip reader refuses one                      | 5     |
| `imaging/tilePoolLifetime`               | Tile decode workers started per contrast edit are not ended; `imaging/workerCount.browser.log` shows 16 workers at load and 8 more per edit (56 after five edits) | 5, 6  |
| `shell-shared/geneZScorePopulation`      | "Combine genes: Z-score" depends on which cells the reader returns (Xenium omits zero cells, H5AD does not)                                                       | 3     |
| `shell-shared/visiumHdScaleKeyAcrossLod` | Visium HD colour-scale key across levels of detail                                                                                                                | 3     |
| `quality/staleChunkError`                | A lazy chunk missing after a redeploy is reported in Chromium, Firefox and Safari as a dataset network error ("Check dataset URL, CORS, and network access")      | 7     |

### Passing: correctness or contract evidence

| Repro                               | What it checks                                                                                                                                                               | Stage |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `AD/axes`                           | AnnData axes, IDs and values per backend against numpy expectations (`fixtures/AD/expected.json`); writes `AD/axes-observations.json`                                        | 4     |
| `analysis/plotOracle`               | Plots group counts, means and medians and their CSV export against an independent oracle                                                                                     | 3     |
| `docs-formats/schemaParserProbes`   | 103 manifest and collection probes, examples and docs JSON blocks through the runtime parsers, compared with `schema_validate.py`                                            | 2     |
| `imaging/cellImageMeasureOracle`    | Phase 26 per-cell image measurement against a numpy oracle (OME-TIFF and OME-Zarr)                                                                                           | 3, 4  |
| `imaging/tiffFormats`               | Seven TIFF variants (SubIFD tile sizes, anisotropic pixels, planar RGB LZW, zstd, float32, int16, no Compression tag)                                                        | 4     |
| `platforms/visium-readers`          | 12 Space Ranger cases: axis order, scale, hires alignment, CSC matrix, MEX joins, `in_tissue`; one case records that duplicate barcode rows resolve silently to the last row | 4     |
| `quality/hyparquetPatch`            | The hyparquet patch is applied, still needed, and its regression input reaches the patched branch                                                                            | 7     |
| `shell-shared/cellShapeTranslation` | Cell shape metrics do not depend on slide position                                                                                                                           | 3     |
| `smoke`                             | The repro config works                                                                                                                                                       | —     |

### Not rerun

| Item                                      | Reason                                                                                          | Stage        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------ |
| `platforms/xenium-zarr-ids-live.repro.ts` | Reads the Sanger Xenium demo over the network; earlier log `platforms/xenium-zarr-ids-live.log` | 4, if needed |
| `io/chromiumSameRange.repro.mjs`          | Browser script; its log is empty, so it never completed                                         | 5            |
| `imaging/workerCount.browser.mjs`         | Browser script; earlier log kept                                                                | 5, 6         |

## Scripts and logs that are not repros

| Item                                                         | Earlier result                                                                                                                                     | Stage             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `docs-core/check-links.mjs`                                  | 43 files, 0 link problems                                                                                                                          | 2                 |
| `docs-formats/check-links.mjs`                               | 60 Markdown files, 612 internal links, 0 problems; 22 external targets listed, not checked                                                         | 2                 |
| `docs-formats/check-code-refs.mjs`                           | 609 file references all found; 10 of 571 code-like spans not found in code (for example `csrZarrRowBatches`, `openQptiff`, `probeSpatialDataRoot`) | 2                 |
| `docs-formats/schema_validate.py`                            | 66 probes match; 20 example and collection files valid; one docs JSON block (`docs/h5ad-reference.md` line 74) fails the manifest schema           | 2                 |
| `docs-formats/examples-copy/` and `examples-index-check.log` | Index regenerated in a copy: no diff                                                                                                               | 2                 |
| `docs-core/url-keys.mjs`                                     | Share keys in code but not in the docs table: `aimg`, `sectionView`; in the table but not in code: `debug`, `lensQv`                               | 2                 |
| `docs-core/gh-main-protection.log`                           | `main` has no branch protection (read-only `gh api` call)                                                                                          | 7                 |
| `platforms/*.mjs`, `platforms/*.py`, `platforms/*.log`       | Live-data probes of the Atera, Xenium, MERSCOPE and Visium HD test datasets                                                                        | 4                 |
| `runtime/`                                                   | Scripts and 10 screenshots opening five fixture datasets at 1440 px                                                                                | 6                 |
| `fixtures/`                                                  | 201 files, 1.2 MB: AnnData (148, with `make_fixtures.py` and `expected.json`), imaging (50), docs-formats (1), platforms (2)                       | with their repros |
