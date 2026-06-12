export type GeneExpressionTimingStage =
  | 'range-check'
  | 'dataset-cache'
  | 'viewport-cells'
  | 'matrix-cell-id-index'
  | 'matrix-cell-major-indptr'
  | 'matrix-cell-major-ranges'
  | 'matrix-feature-major-selected-genes'
  | 'matrix-read'
  | 'score-cells'

export interface GeneExpressionStageTiming {
  readonly stage: GeneExpressionTimingStage
  readonly label: string
  readonly durationMs: number
  readonly detail?: string
}

export type GeneExpressionStageTimingHandler = (
  timing: GeneExpressionStageTiming,
) => void

export function geneExpressionStageTiming(
  stage: GeneExpressionTimingStage,
  label: string,
  startedAt: number,
  detail?: string,
): GeneExpressionStageTiming {
  return {
    stage,
    label,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(detail === undefined ? {} : { detail }),
  }
}

export function formatGeneExpressionStageTiming(
  timing: GeneExpressionStageTiming,
): string {
  const base = `${timing.label} ${Math.round(timing.durationMs)} ms`
  return timing.detail === undefined ? base : `${base} (${timing.detail})`
}
