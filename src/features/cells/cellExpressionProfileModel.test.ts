import { describe, expect, it } from 'vitest'
import type { GexResult } from '../../data/gexTypes'
import { cellExpressionSummaryFromGexCells } from './cellExpressionProfileModel'

describe('cellExpressionSummaryFromGexCells', () => {
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
