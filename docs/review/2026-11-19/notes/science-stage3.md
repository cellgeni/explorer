# Stage 3: shared scientific invariants and recent features (R3)

Coordinator notes, 2026-11-20, commit `6a9a736`. No worker was used. Matrix rows: DOC-SCI in `../DOC_CODE_MATRIX.csv`.

## Scope and depth

| File or area                                                                                               | Depth        | Notes                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/data/cellid.ts`                                                                                       | reviewed     | Xenium ID encoding and its fast twin `xeniumCellIdText` agree (nibble + 97); `asAnyCellId` trims; `asCellId` rejects `UNASSIGNED` (stage 4 lead)                         |
| `src/data/coords.ts`                                                                                       | reviewed     | Screen/data transforms, tile spans, `placeFrameBbox`; `unplaceFrameBbox` correctly uses the transpose of the signed permutation                                          |
| `src/data/roiGeneStats.ts`                                                                                 | reviewed     | `summarizeRoiGeneExpression`: detection is `> 0`, sums come from `aggregateGex`                                                                                          |
| `src/data/gex.ts`                                                                                          | sampled      | `aggregateGex` sums every value it is given; matrix reading left to stage 4                                                                                              |
| `src/data/roiCells.ts`                                                                                     | reviewed     | Xenium path limits to 50,000; the AnnData path does not (SCI-05)                                                                                                         |
| `src/datasets/h5adDataset.ts` (value paths)                                                                | sampled      | `cellFromCountsByColumn`, `h5adMatrixForCells`, `geneExpression`, `cells`, `uniqueNames`                                                                                 |
| `src/rendering/geneExpressionRenderer.ts`                                                                  | sampled      | `geneExpressionScores` (sum, mean, z-score)                                                                                                                              |
| `src/datasets/xeniumDatasetReaders.ts` (expression batch)                                                  | sampled      | Batches omit cells with count `<= 0`                                                                                                                                     |
| `src/features/roi/useRoiWorkflow.ts`, `useMagicLensWorkflow.ts`, `src/features/plots/useSelectionCells.ts` | sampled      | Limit flags and callers of `loadRoiCells`                                                                                                                                |
| `src/features/query/cellQuery.ts`                                                                          | reviewed     | Operators, missing values, class conditions, sorting                                                                                                                     |
| `src/features/collection/sectionStackModel.ts`                                                             | reviewed     | Section choice, frame, opening stretch, model matrix                                                                                                                     |
| `src/features/plots/`                                                                                      | sampled      | Covered by the first attempt's independent oracle (`analysis/plotOracle.repro.ts`, 4 of 4 pass): group counts, means, medians, CSV and Show numbers agree                |
| `src/data/geneValues.ts`, `transcriptZarr.ts`, `useCellQueryModel.ts`                                      | not reviewed | `geneValues` keeps negative values (unit test at `geneValues.test.ts:123`); QV and `valid` handling go to stage 5; asynchronous column loads in Cell Query go to stage 5 |

## Provisional findings

### SCI-01 AnnData reads drop negative values except for a single gene (P2)

- Confidence: confirmed by execution (`evidence/repro/AD/values.repro.ts`) and static proof.
- Platforms: H5AD, AnnData Zarr, reference and Icechunk, and SpatialData tables, wherever `/X` holds negative values (scaled or centred data). Atera and MERSCOPE matrices are counts, so they are not affected in practice.
- Code: `cellFromCountsByColumn` (`src/datasets/h5adDataset.ts:4369-4389`) skips every value `<= 0` unless `includeZeroCounts`, which `h5adMatrixForCells` sets only when one gene is requested (`h5adDataset.ts:3861`).
- Effects:
  - With one selected gene, negative values are kept.
  - With two or more genes, the Sum, Mean and Z-score combinations add only the positive values (`geneExpression`, `h5adDataset.ts:834-836`).
  - ROI gene statistics, which read all genes, sum only positive values, so "Mean per cell", total and "% of total" are wrong. (Corrected in stage 4: the Magic Lens is unavailable on H5AD, Visium, MERSCOPE and SpatialData, `platformAdapter.ts:236-239, 267-270, 298-301, 330-333`, and Atera's matrices are counts, so the lens is not affected.)
  - Plots read values through `geneValues.ts`, which keeps them, so Plots and the ROI panel disagree on the same cells.
- Expected: `docs/ui-reference.md:645-647` defines Mean per cell as "the sum over the sampled cells divided by their number". `ui-reference.md:762` acknowledges matrices with negative values.
- Observed: two cells with stored values −1 and 3 give a mean per cell of 1.5 (expected 1) and a sum of 3 (expected 2), on CSR and dense fixtures.
- Correction: keep non-zero values (`!== 0`) in `cellFromCountsByColumn`; detection stays `> 0` in `roiGeneStats.ts`.
- Regression: `roiGeneStats` and `h5adMatrixForCells` tests with a negative value and two or more genes. `roiGeneStats.test.ts` has no negative case today.

### SCI-02 "Z-score" compares a cell with a population that depends on platform and view (P2)

- Confidence: static proof, plus execution of the scoring function (`evidence/repro/shell-shared/geneZScorePopulation.repro.ts`).
- The help text says Z-score shows "how far each cell's mean is above or below the average cell" (`src/features/shell/helpText.ts:21`). `geneExpressionScores` (`src/rendering/geneExpressionRenderer.ts:307`) takes the mean and SD of the batch it is given. Xenium batches leave out every cell with count `<= 0` (`xeniumDatasetReaders.ts:706-708`, `831-834`). H5AD batches keep zero cells, every Nth one when `sampleStride` is above 1 (`h5adDataset.ts:828-845`). Above the all-cells limit, batches cover the view only.
- Effect: the same cell can change sign. In the repro, a cell 0.19 SD above the population mean is −0.53 SD when non-expressing cells are left out, and 0.80 SD for one view.
- Correction: compute the mean and SD over the dataset's cells, zeros included (or over a fixed sample), or state in the help text and legend which cells it compares against.

### SCI-03 One non-finite stored value breaks z-score colouring and Plots summaries (P3)

- Confidence: confirmed by execution (`AD/values.repro.ts`, `analysis/plotOracle.repro.ts`).
- One NaN in a dense `/X` column makes the batch mean NaN, so no cell gets a z-score. In Plots, the gene's mean and maximum become NaN and its value axis ends at NaN; the median ignores it.
- Expected: R3 asks that missing and non-finite values be distinguished from zero; no page says what NaN in `/X` does.
- Correction: skip non-finite values in `geneExpressionScores` and the Plots summaries, and report how many were skipped.

### SCI-04 Generated suffixes for repeated names can collide with existing names (P3)

- Confidence: confirmed by execution (`AD/values.repro.ts` comment and `AD/axes.repro.ts`) and static proof.
- `uniqueNames` (`h5adDataset.ts:4586-4600`) renames a second `c0` to `c0-2` without checking that `c0-2` is free. With obs names `c0, c0, c0-2`, two rows share `c0-2`, so maps keyed by ID return one row's values for the other. The same function names genes.
- Docs: `docs/modalities/h5ad.md:172,181` ("duplicates get `-2`, `-3`, … suffixes").
- Stage 4 addition: with two genes named `G-2`, the map reads the last such column and Plots the first, and a cell's all-gene profile differs by backend (`AD/axes.repro.ts:200-264`).
- Correction: skip suffixes that are already taken; add a test with an existing `-2` name.

### SCI-05 AnnData ROIs are complete but labelled as cut short at 50,000 cells (P3)

- Confidence: confirmed by execution (`evidence/repro/analysis/roiLimit.repro.ts`) and static proof.
- On H5AD, Visium, SpatialData, Atera and MERSCOPE, `loadActiveRoiCells` (`src/App.tsx:2204-2222`) calls `dataset.cells` without a limit. Every cell comes back. But `useRoiWorkflow.ts:476,481` and `useSelectionCells.ts:81` treat `>= 50,000` as truncated, so the panel shows "50,000+" with the "holds its first cells only" note. The ROI export records `hit_cell_limit: true` (`useRoiWorkflow.ts:799`).
- Docs: `ui-reference.md:658` says `Export Cells` writes up to 50,000 cells. On these platforms it writes all of them.
- Correction: pass the limit on the AnnData path, or set the flag from what the reader reports; align the docs.

## Hypotheses and follow-ups

- **Lasso with a limit (latent):** `AnnDataH5adDataset.cells` applies the limit before the lasso test, so a limited lasso can come back short without reaching the limit (`roiLimit.repro.ts`, second case). The callers that pass a limit (Magic Lens, ROI warm-up) appear to pass boxes. Not verified.
- **Cell Query "Is not one of":** this also matches cells with no class in that set (`cellQuery.ts:315-321`). `ui-reference.md:912-925` does not say so. This is a documentation gap, not a defect.
- **Cell Query asynchronous loads:** stale column loads and row-ID alignment under edits (plan R3) were not reviewed; moved to stage 5.

## Matches recorded

- Cell Query number conditions are inclusive; a missing value never matches; missing values sort last both ways; ties keep row order (`cellQuery.ts:294-356`, `ui-reference.md:908-917`).
- 3D stack: sections need a `z` and at least two in the coordinate system; the parser rejects non-finite or mixed `z` (stage 2 probes C06, C08). Placement negates y around the frame centre consistently. The Depth control's range ×¼ to ×128 matches `MIN/MAX_STACK_DEPTH_SCALE_LOG2` (−2, 7) and `dataset-collections.md:449-452`. Gene colours use each section's own percentile or a typed shared top, as documented.
- Plots: counts, means, medians and the CSV export match the independent oracle on the first attempt's fixture.
