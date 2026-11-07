import { describe, expect, it } from 'vitest'
import { intToCellId } from './cellid'
import { parseCustomAnnotationImport, parseCustomAnnotations } from './customAnnotations'

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

  it('keeps labels with colliding slugs as separate annotations', () => {
    const cd16Positive = intToCellId(1, 1)
    const cd16Negative = intToCellId(2, 1)

    expect(
      parseCustomAnnotations(
        `cell_id,label
${cd16Positive},CD16+ NK cells
${cd16Negative},CD16- NK cells`,
        'celltypist.csv',
      ),
    ).toEqual([
      {
        id: 'custom:celltypist-csv:cd16-nk-cells',
        label: 'CD16+ NK cells',
        cellIds: [cd16Positive],
      },
      {
        id: 'custom:celltypist-csv:cd16-nk-cells-2',
        label: 'CD16- NK cells',
        cellIds: [cd16Negative],
      },
    ])
  })

  it('imports wide CSV annotation columns as separate annotation sets', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)
    const cellC = intToCellId(3, 1)

    expect(
      parseCustomAnnotations(
        `cell_id,cell_type,leiden,broad_type
${cellA},T cell,0,Lymphoid
${cellB},B cell,1,Lymphoid
${cellC},T cell,0,`,
        'metadata.csv',
      ),
    ).toEqual([
      {
        id: 'custom:metadata-csv:cell-type:t-cell',
        label: 'cell_type: T cell',
        cellIds: [cellA, cellC],
      },
      {
        id: 'custom:metadata-csv:cell-type:b-cell',
        label: 'cell_type: B cell',
        cellIds: [cellB],
      },
      {
        id: 'custom:metadata-csv:leiden:0',
        label: 'leiden: 0',
        cellIds: [cellA, cellC],
      },
      {
        id: 'custom:metadata-csv:leiden:1',
        label: 'leiden: 1',
        cellIds: [cellB],
      },
      {
        id: 'custom:metadata-csv:broad-type:lymphoid',
        label: 'broad_type: Lymphoid',
        cellIds: [cellA, cellB],
      },
    ])
  })

  it('imports continuous wide CSV columns as metadata tracks', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)
    const cellC = intToCellId(3, 1)

    const imported = parseCustomAnnotationImport(
      `cell_id,cell_type,leiden,confidence,pseudotime
${cellA},T cell,0,0.97,0.1
${cellB},B cell,1,0.83,0.5
${cellC},T cell,0,,0.9`,
      'metadata.csv',
    )

    expect(imported.annotations).toEqual([
      {
        id: 'custom:metadata-csv:cell-type:t-cell',
        label: 'cell_type: T cell',
        cellIds: [cellA, cellC],
      },
      {
        id: 'custom:metadata-csv:cell-type:b-cell',
        label: 'cell_type: B cell',
        cellIds: [cellB],
      },
      {
        id: 'custom:metadata-csv:leiden:0',
        label: 'leiden: 0',
        cellIds: [cellA, cellC],
      },
      {
        id: 'custom:metadata-csv:leiden:1',
        label: 'leiden: 1',
        cellIds: [cellB],
      },
    ])
    expect(imported.metadataTracks).toEqual([
      {
        id: 'metadata:metadata-csv:confidence',
        label: 'confidence',
        values: [
          { cellId: cellA, value: 0.97 },
          { cellId: cellB, value: 0.83 },
        ],
        min: 0.83,
        max: 0.97,
      },
      {
        id: 'metadata:metadata-csv:pseudotime',
        label: 'pseudotime',
        values: [
          { cellId: cellA, value: 0.1 },
          { cellId: cellB, value: 0.5 },
          { cellId: cellC, value: 0.9 },
        ],
        min: 0.1,
        max: 0.9,
      },
    ])
    expect(
      parseCustomAnnotations(`cell_id,confidence\n${cellA},0.5`, 'score.csv'),
    ).toEqual([])
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

  it('rejects AnnData obs names unless obs-name cell IDs are allowed', () => {
    const csv = `cell_id,label,score
AAACATACAACCAC-1,T cell,0.25
AAACATTGAGCTAC-1,B cell,0.75`

    expect(() => parseCustomAnnotationImport(csv, 'obs.csv')).toThrow(
      /Invalid Xenium cell ID: AAACATACAACCAC-1/,
    )
    expect(() =>
      parseCustomAnnotationImport(csv, 'obs.csv', { cellIdFormat: 'xenium' }),
    ).toThrow(/Invalid Xenium cell ID/)
  })

  it('imports CSV labels and metadata tracks keyed by AnnData obs names', () => {
    const imported = parseCustomAnnotationImport(
      `cell_id,cell_type,score
AAACATACAACCAC-1,T cell,0.25
AAACATTGAGCTAC-1,B cell,0.75
cell 3,T cell,0.5`,
      'obs.csv',
      { cellIdFormat: 'obs-name' },
    )

    expect(imported.annotations).toEqual([
      {
        id: 'custom:obs-csv:cell-type:t-cell',
        label: 'cell_type: T cell',
        cellIds: ['AAACATACAACCAC-1', 'cell 3'],
      },
      {
        id: 'custom:obs-csv:cell-type:b-cell',
        label: 'cell_type: B cell',
        cellIds: ['AAACATTGAGCTAC-1'],
      },
    ])
    expect(imported.metadataTracks).toEqual([
      {
        id: 'metadata:obs-csv:score',
        label: 'score',
        values: [
          { cellId: 'AAACATACAACCAC-1', value: 0.25 },
          { cellId: 'AAACATTGAGCTAC-1', value: 0.75 },
          { cellId: 'cell 3', value: 0.5 },
        ],
        min: 0.25,
        max: 0.75,
      },
    ])
  })

  it('imports JSON annotations keyed by AnnData obs names', () => {
    const options = { cellIdFormat: 'obs-name' } as const

    expect(
      parseCustomAnnotations(
        JSON.stringify({ Tumour: ['AAACATACAACCAC-1', 'spot_17'] }),
        'labels.json',
        options,
      ),
    ).toEqual([
      {
        id: 'custom:labels-json:tumour',
        label: 'Tumour',
        cellIds: ['AAACATACAACCAC-1', 'spot_17'],
      },
    ])
    expect(
      parseCustomAnnotations(
        JSON.stringify([
          { label: 'Selected', cellIds: ['spot_1', 'spot_2'] },
          { label: 'Other', cell_id: 'spot_3' },
        ]),
        'rows.json',
        options,
      ),
    ).toEqual([
      {
        id: 'custom:rows-json:selected',
        label: 'Selected',
        cellIds: ['spot_1', 'spot_2'],
      },
      { id: 'custom:rows-json:other', label: 'Other', cellIds: ['spot_3'] },
    ])
    expect(() =>
      parseCustomAnnotations(JSON.stringify({ Empty: ['  '] }), 'empty.json', options),
    ).toThrow(/Cell ID must not be empty/)
  })
})
