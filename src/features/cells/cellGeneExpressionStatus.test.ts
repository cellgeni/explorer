import { describe, expect, it } from 'vitest'
import {
  expressionStatusLabel,
  type CellGeneExpressionStatus,
} from './cellGeneExpressionStatus'

describe('expressionStatusLabel', () => {
  it.each<[CellGeneExpressionStatus['status'], string]>([
    ['loading', 'Loading'],
    ['error', 'Error'],
    ['unavailable', 'Unavailable'],
    ['idle', 'Unavailable'],
  ])('labels a %s status "%s"', (status, label) => {
    expect(
      expressionStatusLabel({ status, message: 'Reading cell_feature_matrix' }),
    ).toBe(label)
  })

  it('labels a missing status "Unavailable"', () => {
    expect(expressionStatusLabel(undefined)).toBe('Unavailable')
  })

  it('uses the status, not the message', () => {
    expect(expressionStatusLabel({ status: 'error', message: 'Loading' })).toBe('Error')
    expect(expressionStatusLabel({ status: 'idle', message: '' })).toBe('Unavailable')
  })
})
