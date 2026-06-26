import type { GexResult } from '../../data/gexTypes'
import {
  CELL_GENE_EXPRESSION_LIMIT,
  type CellGeneExpressionSummary,
  type CellLoadErrorSummary,
} from './cellDetailModel'

export type CellExpressionProfileSelectionKind = 'bin' | 'cell'

export type CellExpressionProfileState<
  ErrorType extends CellLoadErrorSummary = CellLoadErrorSummary,
> =
  | { readonly status: 'idle' }
  | {
      readonly status: 'unavailable'
      readonly selectionId: string
      readonly selectionKind: CellExpressionProfileSelectionKind
      readonly reason: string
    }
  | {
      readonly status: 'loading'
      readonly selectionId: string
      readonly selectionKind: CellExpressionProfileSelectionKind
    }
  | {
      readonly status: 'ready'
      readonly selectionId: string
      readonly selectionKind: CellExpressionProfileSelectionKind
      readonly expression: CellGeneExpressionSummary
      readonly sourceLabel?: string
    }
  | {
      readonly status: 'error'
      readonly selectionId: string
      readonly selectionKind: CellExpressionProfileSelectionKind
      readonly error: ErrorType
    }

export interface CellExpressionProfileSelection {
  readonly id: string
  readonly kind: CellExpressionProfileSelectionKind
}

export const IDLE_CELL_EXPRESSION_PROFILE_STATE: CellExpressionProfileState<never> = {
  status: 'idle',
}

export function cellExpressionProfileUnavailable(
  selection: CellExpressionProfileSelection,
  reason: string,
): CellExpressionProfileState<never> {
  return {
    status: 'unavailable',
    selectionId: selection.id,
    selectionKind: selection.kind,
    reason,
  }
}

export function cellExpressionProfileLoading(
  selection: CellExpressionProfileSelection,
): CellExpressionProfileState<never> {
  return {
    status: 'loading',
    selectionId: selection.id,
    selectionKind: selection.kind,
  }
}

export function cellExpressionProfileReady({
  expression,
  selection,
  sourceLabel,
}: {
  readonly selection: CellExpressionProfileSelection
  readonly expression: CellGeneExpressionSummary
  readonly sourceLabel?: string | undefined
}): CellExpressionProfileState<never> {
  return {
    status: 'ready',
    selectionId: selection.id,
    selectionKind: selection.kind,
    expression,
    ...(sourceLabel === undefined ? {} : { sourceLabel }),
  }
}

export function cellExpressionProfileFailed<ErrorType extends CellLoadErrorSummary>(
  selection: CellExpressionProfileSelection,
  error: ErrorType,
): CellExpressionProfileState<ErrorType> {
  return {
    status: 'error',
    selectionId: selection.id,
    selectionKind: selection.kind,
    error,
  }
}

export function cellExpressionSummaryFromGexCells<ElementId extends string>(
  matrix: GexResult<ElementId>,
  elementIds: readonly ElementId[],
  geneLimit = CELL_GENE_EXPRESSION_LIMIT,
): CellGeneExpressionSummary {
  const totals = new Map<string, number>()

  for (const elementId of elementIds) {
    const cell = matrix.cells.get(elementId)

    if (cell === undefined) {
      continue
    }

    for (let index = 0; index < cell.geneNames.length; index += 1) {
      const gene = cell.geneNames[index]
      const count = cell.counts[index]

      if (
        gene === undefined ||
        count === undefined ||
        !Number.isFinite(count) ||
        count <= 0
      ) {
        continue
      }

      totals.set(gene, (totals.get(gene) ?? 0) + count)
    }
  }

  const sortedGenes = [...totals.entries()]
    .map(([gene, count]) => ({ gene, count }))
    .sort(
      (left, right) => right.count - left.count || left.gene.localeCompare(right.gene),
    )
  const totalCount = sortedGenes.reduce((total, gene) => total + gene.count, 0)
  const normalizedGeneLimit = Math.max(0, Math.floor(geneLimit))
  const visibleGenes = sortedGenes.slice(0, normalizedGeneLimit)

  return {
    genes: visibleGenes.map((gene) => ({
      gene: gene.gene,
      count: gene.count,
      percentTotal: totalCount <= 0 ? 0 : (gene.count / totalCount) * 100,
    })),
    totalCount,
    hitGeneLimit: sortedGenes.length > normalizedGeneLimit,
  }
}

export function cellExpressionProfileMatchesSelection(
  state: CellExpressionProfileState,
  selection: CellExpressionProfileSelection | null,
): boolean {
  return (
    selection !== null &&
    state.status !== 'idle' &&
    state.selectionId === selection.id &&
    state.selectionKind === selection.kind
  )
}
