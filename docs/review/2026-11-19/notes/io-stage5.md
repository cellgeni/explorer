# Stage 5: I/O, cancellation, caches, trust boundaries (R4)

Coordinator notes, 2026-11-20, commit `6a9a736`. No worker was used: the plan put one on the failure-injection matrix, but sub-agents run at xhigh effort in this session. The failure matrix below is from reading each reader's response handling; execution evidence comes from the first attempt's repros, reread and rechecked against the code. No new browser run was made; stage 6 has the browser time.

## Reader and HTTP error matrix

"Refused" means the read fails with an error naming the problem. Content-Range is often hidden by CORS, so most readers check status and length instead.

| Reader                                                                     | 200 to a Range request               | Short 206 body                         | Content-Range        | HTTP error                                       | Retry                                  | Timeout |
| -------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------- | -------------------- | ------------------------------------------------ | -------------------------------------- | ------- |
| Range probe (`rangeSupport.ts`)                                            | refused, says the host ignores Range | n/a                                    | not read             | 403 and 404 explained (`hostResponses.ts`)       | no                                     | no      |
| H5 worker (`h5RangeFile.ts:94-148`)                                        | refused                              | refused (`byteLength !== end - start`) | total size only      | refused, not retried                             | dropped connection or timeout, 3 tries | 120 s   |
| Zarr zip (`cachedZipStore.ts:131-170`)                                     | refused                              | refused                                | checked when visible | refused                                          | no                                     | no      |
| Zip entries and zipped folders (`zipArchive.ts:383-400`, `zipFolder.ts`)   | refused                              | refused ("came back short")            | not needed           | refused                                          | no                                     | no      |
| TIFF tiles (`src/tiff/loader.ts:2499-2526`)                                | refused (status)                     | **accepted, then cached** (IO-01)      | not checked          | refused                                          | no                                     | no      |
| Parquet footers (hyparquet `asyncBufferFromUrl` + `cacheFooterByteRanges`) | sliced from the whole body           | **accepted, then cached** (IO-01)      | not checked          | refused                                          | no                                     | no      |
| Zarr over HTTP (`zarrStores.ts:52-75`)                                     | (whole chunk objects)                | not checked                            | not checked          | 403 read as missing (S3 behaviour), else refused | no                                     | no      |
| Icechunk (`icechunkStore.ts:255-272`)                                      | sliced from the whole body           | not checked                            | not checked          | 403 and 404 as missing                           | no                                     | no      |
| DuckDB-WASM `httpfs` (Xenium Parquet)                                      | not inspected                        | not inspected                          | —                    | —                                                | —                                      | —       |

No timeout or retry outside the H5 worker and detection: known-open (`open-items.md`, "Range reads have no timeout or retry"), still present.

## Provisional findings

### LIF-01 A cancelled or failed view change leaves the hidden view in charge (P1)

- Confidence: confirmed by execution with the production `App` and lifecycle, only dataset I/O faked (`lifecycle/visium-library-cancel.repro.ts`, `lifecycle/spatialdata-view-cancel.repro.ts`, 4 failing cases); static proof for the cause.
- A Visium library switch or a SpatialData table, coordinate system or image change reloads the same URL. Before the reload starts:
  - `handleVisiumViewChange` (`useVisiumControlsWorkflow.ts:150-176`) marks the control as loading with the new library and writes it into the share state (`initialShareableStateRef`).
  - `handleSpatialDataSelectionChange` (`App.tsx:3670-3676`) registers the new selection globally (`setSpatialDataSelection`), which keys the dataset instance cache (`datasetFactory.ts:1717-1724`).
  - The reload calls `setVisiumView` on the shared, cached `AnnDataH5adDataset`, which switches the instance in place (`h5adDataset.ts:750-762`).
- `cancelDatasetLoad` (`useDatasetLifecycle.ts:2312-2323`) aborts the pending load and clears its state, and a failed load ends the same way, but neither undoes these three changes.
- Observed after Cancel (or failure) with library A or coordinate system `global` still on screen:
  - The library or coordinate-system control shows the new value and stays disabled, so the user cannot choose again without reloading the page.
  - The link describes the hidden view (`hashHasSdCsPixels: true`).
  - Later reads go to the hidden view: SpatialData annotations are read from `pixels`, and the Visium instance answers for library B.
- Docs: `user-guide.md:118-121`: "a cancelled dataset load keeps the dataset already open". Opening a different URL and cancelling works (`App.test.tsx:2869`); only same-URL view changes break.
- Correction: register the view, mutate the instance and write the share state only when the load commits, or restore them in `cancelDatasetLoad` and on failure. Give Visium libraries their own instances, as SpatialData selections already have.
- Severity: P1 because reads come from another section or coordinate system than the one shown, and the user cannot recover in place. The trigger is narrow (a cancelled or failed view change), so revisit in stage 8.

### IO-01 A short range body is cached and served to every later load (P2)

- Confidence: confirmed by execution against stub hosts (`io/byteRangeCacheShortBody.repro.ts`, 3 pass); static proof that nothing checks the length; the trigger is recorded in the code but was not reproduced in a browser.
- `fetchByteRangeWithCache` (`persistentByteRangeCache.ts:116-133`) writes whatever `fetchRange` returns into IndexedDB. Two callers do not check the body length: TIFF tiles (`loader.ts:2499-2526` checks only status 206) and Parquet footers (`cacheFooterByteRanges`, `:136-178`, over hyparquet, which checks only status). The zip reader does check (`cachedZipStore.ts`), and its control case caches nothing.
- In the repro, a host that returns half of each range poisons the Parquet footer: the next load, from a fixed host, fails "parquet file invalid" without asking the host, because the footer comes from IndexedDB. A TIFF tile namespace keeps 40 bytes for a 100-byte range.
- Trigger: `zarrStores.ts:54-58` records that Chromium's HTTP cache "can get a truncated body" when two Range requests for the same bytes run at once, which is why Zarr and TIFF ranges use `cache: 'no-store'`. The Parquet footer is fetched without `no-store` by the warm-up (`datasetWarmup.ts:125-143`) and by the overview reader (`hyparquetCells.ts:189-210`), for the same bytes. The first attempt's browser check (`io/chromiumSameRange.repro.mjs`) never completed.
- Consequence: the dataset fails on every reload, for that file version, until the user clears site data.
- Correction: check `bytes.byteLength === end - start` in `fetchByteRangeWithCache` before storing (and returning); use `no-store` for footer ranges.

### IO-02 Tile decode workers are never ended; a contrast edit adds a pool (P2)

- Confidence: confirmed by execution (`imaging/tilePoolLifetime.repro.ts`: 28 workers created, 0 ended, over the first contrast, five edits and a dataset switch, including after `store.dispose()`) and by the first attempt's production-build browser run (`../evidence/imaging/workerCount.browser.log`: 16 workers at load, then 24, 32, 40, 48, 56 after five edits of one channel's maximum on a 2-channel OME-TIFF). Static proof of the cause.
- `TileCache` (`src/tiff/tileCache.ts:103`) calls `createWorkerTileDecoder()`, which makes a new `TileDecodeWorkerPool` (`src/workers/tileDecodePool.ts:303-307`, up to 4 workers) and keeps only a closure over it. Nothing can call `terminate()` (`:166`). The canvas keys its tile caches by channel, image URL and contrast, so each contrast value gets a new cache and a new pool.
- Not in `open-items.md` (its "never released" list covers per-URL caches, not per-contrast pools).
- Stage 6 measures memory over about 30 edits, which decides whether this is a P1 resource failure.
- Correction: one shared decode pool (as `sharedStripDecodePool` already is), or terminate a cache's pool when the store drops it.

### TRUST-01 Signed URLs are kept in recent history and share links (P3)

- Confidence: static proof.
- The app accepts presigned and token-bearing URLs and keeps their query string (`docs/h5ad-reference.md:459-461`, `modalities/h5ad.md:92-93`; the access-denied message suggests "a public or presigned address", `loadErrorModel.ts:705`). The full URL goes into `localStorage` (`recentDatasets.ts`, up to 8 entries, no expiry) and into the share link's `dataset=`.
- Impact is limited: the token is the user's own, and sharing it is how a presigned link works. But nothing says the recent list keeps it.
- Correction: drop query strings from the recent list (or mark such entries), and say in the docs that share links carry the token.

## Known items reconfirmed (status: known-open)

| Item (`open-items.md`)                                               | Evidence now                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Range reads have no timeout or retry                                 | Matrix above: only the H5 worker retries and times out                                                                                                                                                                                                 |
| Cancelling a load does not stop the old dataset's reads              | `cachedSpatialDataset` and `createSpatialDataset` take no signal (`datasetFactory.ts:1712-1740`); not measured                                                                                                                                         |
| Per-URL caches never released, including H5AD tissue image blob URLs | Module-level maps in `gex.ts:108-110`, `zarrZipStore.ts:70`, `icechunkStore.ts:78`, `omeZarrLoader.ts:1696`, `folderListing.ts:36`, `zipFolder.ts:67`; `h5adDataset.ts:1370,1638` create blob URLs and `dispose()` (`:1449-1456`) does not revoke them |
| Optional reads treat any failure as absent                           | For example `transcriptZarr.ts:1337-1339` (`catch { return null }`); `visiumHdClusters.test.ts:80` asserts the design                                                                                                                                  |

## Checked, no finding

- **HDF5 errors.** Every worker operation calls `throwRangeError` after its h5wasm calls, and the catch reports the range error before whatever h5wasm threw (`h5FileCore.ts:110-232, 263-269`). `visiumFeatureSlice.ts` reads the whole file into memory, so no range errors apply.
- **SQL.** Every value from a dataset is a `?` parameter. The spliced fragments are constants (`OVERVIEW_*_COLUMNS`, `', b.label_id'`), `betweenSql` placeholders, or numbers from the user's drawing passed as a WKT parameter (`gexSelection.ts:75-82`).
- **HTML and SVG.** No `dangerouslySetInnerHTML`, `innerHTML` or `insertAdjacentHTML` in `src/`.
- **Links.** Manifest and example source URLs must be http(s) (`datasetManifest.ts:901`, `examplesIndex.ts:72-110`); external links have `rel="noreferrer"` or `"noopener noreferrer"`.
- **CSV export.** Every export goes through `formatCsv` (`src/utils/csv.ts`): RFC 4180 quoting and a `'` guard against formula injection, with numbers left as numbers.
- **Share-link lists.** Lists are comma-separated; annotation group IDs are slugged, so they never contain commas. A gene name with a comma would split (no such gene seen).
- **ZIP.** ZIP64 directories and extra fields are read; only stored and deflated entries are accepted; a deflated entry cannot grow past its directory size (`zipArchive.ts:253-262`); `__MACOSX/` is ignored.
- **Dataset instance cache.** A failed load's promise is evicted, so a retry starts again (`datasetCache.ts:88-91`).
- **Cell Query column loads.** The column session is rebuilt per dataset URL and cell list and disposed on change; every result is dropped if its session was replaced (`useCellQueryModel.ts:653-743`).
- **Third-party.** DuckDB-WASM downloads `httpfs`, `parquet` and `spatial` from `extensions.duckdb.org`, as `architecture.md:401-406` and `user-guide.md:367-369` say. The hyparquet patch (16 lines) has a passing repro; its full review stays in stage 7.

## Observations, not findings

- Gzipped text files other than MERSCOPE's CSVs (Visium positions and scalefactors, Visium HD feature rows, MEX barcode and feature lists, GeoJSON) inflate without a decoded-size limit (`readMaybeGzipText.ts`, `forEachMaybeGzipLine`). A hostile file can only exhaust the user's own tab. The MEX matrix is limited by compressed bytes (`featureBarcodeMex.ts:442-492`).
- `byteRangeFileVersion` falls back to the file size alone when the validator is hidden by CORS (`persistentByteRangeCache.ts:186-200`), so a file rewritten in place with the same size serves stale ranges. Documented in the code comment.
- A zip entry's output buffer is allocated at the directory's declared size before reading (`zipArchive.ts:254`); callers check sizes first where it matters (MERSCOPE autoload limit).
- The plan's race "open A, start B, cancel B, open C" with different URLs is covered by `App.test.tsx:2869` for A and B; C and slow or failing B with different URLs were not run.

## Depth

| File or area                                                                                                    | Depth        |
| --------------------------------------------------------------------------------------------------------------- | ------------ |
| `persistentByteRangeCache.ts`, `h5RangeFile.ts`, `h5FileCore.ts` (error path), `src/utils/csv.ts`               | reviewed     |
| `useVisiumControlsWorkflow.ts`, `useDatasetLifecycle.ts` (cancel), `App.tsx` (SpatialData view change)          | sampled      |
| `cachedZipStore.ts`, `zipArchive.ts`, `zarrStores.ts`, `icechunkStore.ts`, `rangeSupport.ts`, `datasetCache.ts` | sampled      |
| `tileDecodePool.ts`, `tileCache.ts` (pool creation)                                                             | sampled      |
| `useCellQueryModel.ts` (session lifecycle), `recentDatasets.ts`, `examplesIndex.ts`, DuckDB SQL builders        | sampled      |
| DuckDB-WASM `httpfs`, `cellImageMeasurer.ts`, Atera readers                                                     | not reviewed |
