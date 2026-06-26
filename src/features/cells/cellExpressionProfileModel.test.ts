import { describe, expect, it } from 'vitest'
import type { GexResult } from '../../data/gexTypes'
import {
  IDLE_CELL_EXPRESSION_PROFILE_STATE,
  cellExpressionProfileFailed,
  cellExpressionProfileLoading,
  cellExpressionProfileReady,
  cellExpressionProfileUnavailable,
  cellExpressionSummaryFromGexCells,
} from './cellExpressionProfileModel'

describe('cellExpressionSummaryFromGexCells', () => {
  it('constructs expression-profile async transitions', () => {
    const selection = { id: 'BC-1', kind: 'bin' as const }
    const expression = { genes: [], totalCount: 0, hitGeneLimit: false }
    const error = { title: 'Failed', message: 'No data' }

    expect(IDLE_CELL_EXPRESSION_PROFILE_STATE).toEqual({ status: 'idle' })
    expect(cellExpressionProfileUnavailable(selection, 'Choose a bin size')).toEqual({
      status: 'unavailable',
      selectionId: 'BC-1',
      selectionKind: 'bin',
      reason: 'Choose a bin size',
    })
    expect(cellExpressionProfileLoading(selection)).toEqual({
      status: 'loading',
      selectionId: 'BC-1',
      selectionKind: 'bin',
    })
    expect(
      cellExpressionProfileReady({ selection, expression, sourceLabel: 'Selected bin' }),
    ).toEqual({
      status: 'ready',
      selectionId: 'BC-1',
      selectionKind: 'bin',
      expression,
      sourceLabel: 'Selected bin',
    })
    expect(cellExpressionProfileFailed(selection, error)).toEqual({
      status: 'error',
      selectionId: 'BC-1',
      selectionKind: 'bin',
      error,
    })
  })

  it('aggregates sparse gene counts across selected matrix rows', () => {
    const matrix: GexResult<string> = {
      geneNames: ['Actb', 'Gad1', 'Snap25'],
      cells: new Map([
        [
          'BC-1',
          {
            geneNames: ['Actb', 'Gad1', 'Zero'],
            counts: [7, 3, 0],
          },
        ],
        [
          'BC-2',
          {
            geneNames: ['Actb', 'Snap25'],
            counts: [2, 1],
          },
        ],
      ]),
    }

    expect(cellExpressionSummaryFromGexCells(matrix, ['BC-1', 'BC-2'])).toEqual({
      genes: [
        { gene: 'Actb', count: 9, percentTotal: 69.23076923076923 },
        { gene: 'Gad1', count: 3, percentTotal: 23.076923076923077 },
        { gene: 'Snap25', count: 1, percentTotal: 7.6923076923076925 },
      ],
      totalCount: 13,
      hitGeneLimit: false,
    })
  })

  it('sorts ties by gene and reports when the gene limit is hit', () => {
    const matrix: GexResult<string> = {
      geneNames: ['B', 'A', 'C'],
      cells: new Map([
        [
          'cell-1',
          {
            geneNames: ['B', 'A', 'C'],
            counts: [2, 2, 1],
          },
        ],
      ]),
    }

    expect(cellExpressionSummaryFromGexCells(matrix, ['cell-1'], 2)).toEqual({
      genes: [
        { gene: 'A', count: 2, percentTotal: 40 },
        { gene: 'B', count: 2, percentTotal: 40 },
      ],
      totalCount: 5,
      hitGeneLimit: true,
    })
  })
})
