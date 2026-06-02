import { describe, expect, it } from 'vitest'
import { intToCellId } from './cellid'
import { parseCustomAnnotations } from './customAnnotations'

describe('custom annotations', () => {
  it('groups CSV rows by label', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)
    const cellC = intToCellId(3, 1)

    expect(
      parseCustomAnnotations(
        `cell_id,label
${cellA},Layer 1
${cellB},Layer 2
${cellC},Layer 1`,
        'layers.csv',
      ),
    ).toEqual([
      {
        id: 'custom:layers-csv:layer-1',
        label: 'Layer 1',
        cellIds: [cellA, cellC],
      },
      {
        id: 'custom:layers-csv:layer-2',
        label: 'Layer 2',
        cellIds: [cellB],
      },
    ])
  })

  it('reads JSON label-to-cells objects', () => {
    const cellA = intToCellId(1, 1)

    expect(
      parseCustomAnnotations(JSON.stringify({ Astrocytes: [cellA] }), 'labels.json'),
    ).toEqual([
      {
        id: 'custom:labels-json:astrocytes',
        label: 'Astrocytes',
        cellIds: [cellA],
      },
    ])
  })

  it('reads JSON row arrays with label and cellIds fields', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)

    expect(
      parseCustomAnnotations(
        JSON.stringify([{ label: 'Selected', cellIds: [cellA, cellB] }]),
        'roi.json',
      ),
    ).toEqual([
      {
        id: 'custom:roi-json:selected',
        label: 'Selected',
        cellIds: [cellA, cellB],
      },
    ])
  })
})
