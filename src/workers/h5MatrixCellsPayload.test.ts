import { describe, expect, it } from 'vitest'
import {
  gexPayloadTransferables,
  packGexResult,
  unpackGexResult,
} from './h5MatrixCellsPayload'

describe('packGexResult', () => {
  it('round-trips cells in order, sharing gene names', () => {
    const cells = new Map([
      ['c', { geneNames: ['Gad1', 'Actb'], counts: [3, 1.5] }],
      ['a', { geneNames: [], counts: [] }],
      ['b', { geneNames: ['Actb'], counts: [7] }],
    ])
    const payload = packGexResult({ geneNames: ['Actb', 'Gad1', 'Unused'], cells })

    expect(payload.names).toEqual(['Gad1', 'Actb'])
    expect(payload.ids).toEqual(['c', 'a', 'b'])
    expect(Array.from(payload.offsets)).toEqual([0, 2, 2, 3])
    expect(Array.from(payload.nameIndices)).toEqual([0, 1, 1])
    expect(Array.from(payload.counts)).toEqual([3, 1.5, 7])

    const result = unpackGexResult<string>(payload)
    expect(result.geneNames).toEqual(['Actb', 'Gad1', 'Unused'])
    expect(Array.from(result.cells)).toEqual(Array.from(cells))
  })

  it('packs an empty result', () => {
    const payload = packGexResult({ geneNames: [], cells: new Map() })

    expect(Array.from(payload.offsets)).toEqual([0])
    expect(unpackGexResult(payload).cells.size).toBe(0)
  })

  it('lists the typed arrays to transfer', () => {
    const payload = packGexResult({
      geneNames: ['Actb'],
      cells: new Map([['a', { geneNames: ['Actb'], counts: [1] }]]),
    })

    expect(gexPayloadTransferables(payload)).toEqual([
      payload.offsets.buffer,
      payload.nameIndices.buffer,
      payload.counts.buffer,
    ])
  })
})
