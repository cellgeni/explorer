# Stage 2: documentation, schemas, examples (R2)

Coordinator notes, 2026-11-20, commit `6a9a736`. Matrix rows: `../evidence/docs-matrix/coordinator.csv` (DOC-CORE) and `../evidence/docs-matrix/modalities.csv` (DOC-MOD, from worker activation 1). Both are merged into `../DOC_CODE_MATRIX.csv`.

## Checks executed

| Check                              | Command or method                                                                     | Result                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Example and collection files parse | `schemaParserProbes.repro.ts` (runtime parsers) and `schema_validate.py` (jsonschema) | 20 of 20 valid in both                                                                                                     |
| Examples index current             | `node scripts/examples-index.ts --check`                                              | exit 0, no write                                                                                                           |
| Docs JSON blocks                   | the same repro                                                                        | 10 manifest or collection blocks valid; the one schema failure is a kerchunk reference, misclassified by the first attempt |
| Schema versus parser               | 66 inert probes with hand-written expectations                                        | 43 agree; 19 schema-valid but refused by the app; 4 schema-invalid but accepted as documented                              |
| Relative URL resolution            | 7 hand-written cases                                                                  | all match                                                                                                                  |
| Internal links and anchors         | two link checkers                                                                     | 612 links, 0 problems; 22 external links not checked                                                                       |
| Code references in docs            | `check-code-refs.mjs` plus manual check of misses                                     | 609 file references found; 4 stale symbol names                                                                            |
| Share keys                         | `url-keys.mjs` plus manual check                                                      | 2 keys missing from the table; 2 script false positives                                                                    |
| Commands and Node version          | docs versus `package.json` and workflows                                              | match                                                                                                                      |
| Deployment guide                   | `deploy-to-s3.md` versus `release.yml` and `examplesIndex.ts`                         | match by inspection; serving at a subpath and under COOP/COEP left to stage 6                                              |
| Plan records                       | `PLAN.md` status table, `open-items.md`, phase 24                                     | one stale open item                                                                                                        |

## Provisional findings

Severities are provisional until stage 8.

### DOC-01 The docs disagree on Plots for Visium HD (P3)

- Confidence: confirmed by execution (toggle gating) and static proof (panel message, page history).
- `docs/ui-reference.md:195-196` ("no `Plots` or `Query` on Visium HD"; commit `844ec57`, 2026-11-19, the newest statement), `:1405` (availability table "—") and `docs/user-guide.md:433-434` say there is no Plots panel on Visium HD. `docs/modalities/visium-hd.md:191-192` (`3df26dc`, 2026-11-17) says the panel is shown and says it is not available.
- Code does what `visium-hd.md` says: `src/App.tsx:4593-4594` makes Plots available when `capabilities.cells && capabilities.annotations`, both true for Visium HD (`platformAdapter.ts:176-182`); Cell Query is excluded by kind (`App.tsx:4630-4631`), Plots is not. The panel then says "Plots are not available for Visium HD: it has no expression matrix to read by gene" (`usePlotsWorkflow.ts:40-45`), because `VisiumHdDataset` is not a `GeneValuesSource`.
- Evidence: `evidence/repro/docs-core/plotsVisiumHd.repro.ts` (fails against the `ui-reference.md` expectation).
- Correction needs a product decision: hide the toggle on Visium HD as Cell Query does (matching the newest page), or keep it and correct `ui-reference.md` and `user-guide.md`. The message's "no expression matrix" is loose either way: Visium HD has one, just not readable by gene for every bin.

### DOC-02 Four stale code names in the modality pages (P3)

- `csrZarrRowBatches` (`docs/modalities/h5ad.md:262`; current code has `csrLazyRowBatches` in `h5adDataset.ts:4004` and `csrRowBatches` in `geneValues.ts:451`), `openQptiff` (`image.md:218`; now `readQptiffFile`, `tiff/loader.ts:1328`), `probeSpatialDataRoot` (`spatialdata.md:21,152,334`; removed in `404043e`), `readVisiumPlacement` (`visium.md:48`; removed in `d6634fb`).
- Correction: point each sentence at the current function. Which replacement fits needs a read of each sentence.

### DOC-03 Shareable URL table misses two parameters (P3)

- `aimg` (Atera morphology view) and `sectionView` (collection side-by-side or 3D) are read and written by `src/data/shareableState.ts:136,197,489,685` but not listed in `docs/ui-reference.md` "Shareable URL" (1413-1492). They are documented only in `modalities/atera.md:135` and `dataset-collections.md:469`.

### DOC-04 The public schemas pass files the app refuses (P3)

- `docs/dataset-manifest.md:450-458` and `dataset-collections.md:488-497` say editors with `$schema` "flag errors as you type". 19 probe files pass the schema but stop the load: whitespace-only `name` or gene names; `geneRange` `p0`, `p150`, max below min, non-finite values; `options.coordinates` without `files.image`; `options.labelColumn` without `files.labels`; `files.zchunkstore` with an OME-Zarr image; segmentation options without `files.segmentation`; a segmentation file with an unknown extension; a Visium HD `binSize` not in `files.bins`; a duplicated bin; duplicate collection entries (including spelled differently); mixed `z` in one coordinate system; whitespace-only collection entry names.
- Some of these fit JSON Schema (`pattern`, `dependentRequired`, `if`/`then`); duplicates spelled differently and max-above-min do not.
- Correction: add the expressible constraints, and say in both guides that the viewer checks more than the schema.
- Evidence: `evidence/triage/repro-run.log` (rows marked `DISAGREE`), `evidence/fixtures/docs-formats/probes.json`.

### DOC-05 300 MB written for 300 MiB limits (P3)

- `VISIUM_MATRIX_MAX_BYTES` and `MERSCOPE_CSV_MAX_BYTES` are `300 * 1024 * 1024`, and `MERSCOPE_BOUNDARIES_AUTOLOAD_MAX_BYTES` and `MERSCOPE_IMAGE_AUTOLOAD_MAX_BYTES` are `100 * 1024 * 1024` (`merscopeFormat.ts:35,40`) (`visiumFormat.ts:81`, `merscopeFormat.ts:30`). `README.md:143`, `dataset-manifest.md:183` and `host-your-own-data.md:210,245` say 300 MB, and `modalities/visium.md:287-288` and `modalities/merscope.md` (rows DOC-MOD-MER-03 to 05) say 300 MB and 100 MB. The H5AD pages say MiB for the same number.

### DOC-06 `open-items.md` out of step with two phase files (P3, plan record)

- `docs/plan/open-items.md:139-144` lists "no registered test dataset" for the 3D section stack. Phase 24 checked it off on 2026-11-18 (`phases/24-section-stack.md:65-70`, `examples/zenodo/21110855-liver-sections.json`). The rest of the open item still stands.
- `open-items.md` says it lists every unchecked item (lines 1-21), but Phase 25 (done 2026-11-19) has six unchecked known gaps (`phases/25-imported-segmentations.md:78-86`) and `open-items.md` does not mention Phase 25. Phases 22, 23 and 26 have no unchecked boxes; the other phases with open boxes are linked.

### DOC-07 Xenium page gives an incomplete detection fallback (P3)

- `docs/modalities/xenium.md:19-21`: without `experiment.xenium`, detection "moves on to the SpatialData, OME-Zarr, and Visium HD probes". `detectSpatialDatasetLayout` (`datasetFactory.ts:444-500`) also probes Atera (alongside Xenium), then Zarr roots, then standard Visium and MERSCOPE together, then Visium HD. `docs/architecture.md:92-112` has the full order, so the fix is a link there.
- From worker row DOC-MOD-XEN-02, confirmed by the coordinator.

## Worker activation 1 (modality pages)

Sonnet, 12 API turns, 30 tool calls, 287,019 tokens, no nested agents. Effort was **xhigh**, not the medium the plan requires (see `../COVERAGE.md`). 86 rows in `../evidence/docs-matrix/modalities.csv`, notes in `docs-modalities.md`.

Coordinator spot-checks (9 rows: XEN-02, XEN-05, XEN-14, VIS-06, VIS-07, VHD-08, H5AD-07, MER-03, MER-04) and corrections made in the merged matrix:

- XEN-14 "device profiles undocumented": wrong; `docs/architecture.md:646-656` documents them with the same thresholds (`performanceBudget.ts:48-53`). Now matches.
- VHD-08: `visium-hd.md:191-192` matches the code; the contradiction is with `ui-reference.md` and `user-guide.md` (DOC-01).
- VIS-07, MER-03, MER-04, MER-05: marked matches with a unit note; now doc defect under DOC-05.
- VIS-06 (`voff=0` also written when off-tissue is explicitly off, `shareableState.ts:688-690`): left ambiguous, no finding.
- XEN-02: confirmed (DOC-07).

Rows left **not verified** (14): the worker did not read the deciding code, or the claim belongs to a triage lead. They carry over to stage 4: VIS-08, VIS-09, VIS-10, VHD-02, VHD-07, VHD-10, VHD-11, H5AD-09, SD-09, MER-06, MER-08, MER-10, XEN-12, XEN-13.

## Discarded leads

- `debug` and `lensQv` "in the table but not in code": `debug` is read by `appShellModel.ts:89-90`; `lensQv` is documented as ignored.
- `docs/h5ad-reference.md:74` "schema-invalid manifest": it is a kerchunk reference excerpt.
- External names flagged as missing symbols: `SharedArrayBuffer`, `CORSRules`, `HTTPStore`, `RangeIndex`, `AllowedOrigin`, and the pattern `square_NNNum`.
