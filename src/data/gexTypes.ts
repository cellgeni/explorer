import type { CellId } from './cellid'
import type { GeneExpressionStageTimingHandler } from './geneExpressionTiming'

export interface GexCell {
  readonly geneNames: readonly string[]
  readonly counts: readonly number[]
}

export interface GexResult<ElementId extends string = CellId> {
  readonly geneNames: readonly string[]
  readonly cells: ReadonlyMap<ElementId, GexCell>
}

export interface CellFeatureMatrixReadOptions {
  readonly signal?: AbortSignal
  readonly onStageTiming?: GeneExpressionStageTimingHandler
  readonly maxFullFileBytes?: number
}
