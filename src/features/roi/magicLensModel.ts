export type MagicLensScope = 'cursor' | 'viewport' | 'roi'

export interface MagicLensSummary {
  readonly transcriptCount: number
  readonly cellCount: number
  readonly geneCount: number
  readonly selectedGeneTranscriptCount: number
  readonly topGenes: readonly MagicLensGeneSummary[]
  readonly hitLimit: boolean
}

interface MagicLensGeneSummary {
  readonly gene: string
  readonly count: number
  readonly percentTotal: number
  readonly selected: boolean
}

export function magicLensScopeLabel(scope: MagicLensScope): string {
  if (scope === 'cursor') {
    return 'Cursor'
  }

  return scope === 'roi' ? 'ROI' : 'Viewport'
}
