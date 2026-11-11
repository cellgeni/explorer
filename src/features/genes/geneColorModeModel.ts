import type { ObservationColorMode } from '../../rendering/cellStyling'

// The colour mode after the gene list changes (UNIFIED_PLAN.md, D2). Adding
// genes from the gene controls colours cells by expression, and removing the
// last gene goes back to the mode used before. Other changes, such as adding a
// transcript feature, keep the mode.
export function colorModeAfterGeneChange(
  mode: ObservationColorMode,
  modeBeforeGenes: ObservationColorMode,
  change: { readonly added: boolean; readonly geneCount: number },
): ObservationColorMode {
  if (change.geneCount === 0) {
    return mode === 'gene-expression' ? modeBeforeGenes : mode
  }

  return change.added ? 'gene-expression' : mode
}
