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
        cellCount: 2,
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
        cellCount: 3,
        min: 0.1,
        max: 0.9,
      },
    ])
    expect(
      parseCustomAnnotations(`cell_id,confidence\n${cellA},0.5`, 'score.csv'),
    ).toEqual([])
  })

  it('reads spreadsheet and pandas missing tokens in a numeric column as no value', () => {
    const rows = ['cell_id,log_ratio']
    for (let index = 0; index < 100; index += 1) {
      rows.push(`c${index},${(index / 7).toFixed(4)}`)
    }
    rows.push('c-inf,inf', 'c-Inf,-Inf', 'c-na,#N/A', 'c-dash,-', 'c-div,#DIV/0!')

    const imported = parseCustomAnnotationImport(rows.join('\n'), 'ratio.csv')

    expect(imported.annotations).toEqual([])
    expect(imported.metadataTracks).toHaveLength(1)
    expect(imported.metadataTracks[0]).toMatchObject({
      label: 'log_ratio',
      cellCount: 100,
      min: 0,
      max: Number((99 / 7).toFixed(4)),
    })
  })

  it('keeps a column with more than one value in twenty that are not numbers as classes', () => {
    const rows = ['cell_id,stage']
    for (let index = 0; index < 20; index += 1) {
      rows.push(`c${index},${index < 18 ? String(index + 0.5) : 'late'}`)
    }

    const imported = parseCustomAnnotationImport(rows.join('\n'), 'stage.csv')

    expect(imported.metadataTracks).toEqual([])
    expect(imported.annotations).toHaveLength(19)
  })

  it('leaves out a table column with more than 500 classes, and says which', () => {
    const rows = ['cell_id,barcode,cell_type']
    for (let index = 0; index < 2_000; index += 1) {
      rows.push(`c${index},BC${index},${index % 2 === 0 ? 'T' : 'B'}`)
    }

    const imported = parseCustomAnnotationImport(rows.join('\n'), 'obs.csv')

    expect(imported.annotations.map((annotation) => annotation.label).sort()).toEqual([
      'cell_type: B',
      'cell_type: T',
    ])
    expect(imported.skippedColumns).toEqual([{ name: 'barcode', classCount: 2_000 }])
    expect(() =>
      parseCustomAnnotationImport(
        rows.map((row) => row.split(',').slice(0, 2).join(',')).join('\n'),
        'obs.csv',
      ),
    ).toThrow('No column groups the cells: barcode (2,000 classes)')
  })

  it('reads the other columns of a file with a label column', () => {
    const imported = parseCustomAnnotationImport(
      [
        'annotation_id,cell_id,label,score,cell_type',
        'custom:x:a,c1,A,0.5,T',
        'custom:x:a,c2,A,1.5,B',
        'custom:x:b,c3,B,2.25,T',
      ].join('\n'),
      'labels.csv',
    )

    expect(imported.annotations.map((annotation) => annotation.label)).toEqual([
      'A',
      'B',
      'cell_type: T',
      'cell_type: B',
    ])
    expect(imported.annotations[0]?.id).toBe('custom:labels-csv:a')
    expect(imported.metadataTracks).toEqual([
      expect.objectContaining({ label: 'score', cellCount: 3, min: 0.5, max: 2.25 }),
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

  // Each platform names cells its own way; an exported file imports back.
  it('reads Visium barcodes from an annotation export', () => {
    expect(
      parseCustomAnnotations(
        `annotation_id,label,cell_id
analysis:leiden:0,leiden: 0,AAACAAGTATCTCCCA-1
analysis:leiden:0,leiden: 0,AAACACCAATAACTGC-1
analysis:leiden:1,leiden: 1,AAACAGAGCGACTCCT-1`,
        'annotations.csv',
      ),
    ).toEqual([
      {
        id: 'custom:annotations-csv:leiden-0',
        label: 'leiden: 0',
        cellIds: ['AAACAAGTATCTCCCA-1', 'AAACACCAATAACTGC-1'],
      },
      {
        id: 'custom:annotations-csv:leiden-1',
        label: 'leiden: 1',
        cellIds: ['AAACAGAGCGACTCCT-1'],
      },
    ])
  })

  it('reads integer-like SpatialData instance IDs from CSV and JSON', () => {
    const imported = parseCustomAnnotationImport(
      `cell_id,cell_type,score
0,T cell,0.5
1,B cell,0.25
 17 ,T cell,0.75`,
      'instances.csv',
    )

    expect(imported.annotations).toEqual([
      {
        id: 'custom:instances-csv:cell-type:t-cell',
        label: 'cell_type: T cell',
        cellIds: ['0', '17'],
      },
      {
        id: 'custom:instances-csv:cell-type:b-cell',
        label: 'cell_type: B cell',
        cellIds: ['1'],
      },
    ])
    expect(imported.metadataTracks[0]?.values).toEqual([
      { cellId: '0', value: 0.5 },
      { cellId: '1', value: 0.25 },
      { cellId: '17', value: 0.75 },
    ])
    expect(
      parseCustomAnnotations(
        JSON.stringify([
          { label: 'Tumour', cell_id: '3' },
          { label: 'Tumour', cell_id: '4' },
          { label: 'Stroma', cellIds: ['5'] },
        ]),
        'instances.json',
      ),
    ).toEqual([
      { id: 'custom:instances-json:stroma', label: 'Stroma', cellIds: ['5'] },
      { id: 'custom:instances-json:tumour', label: 'Tumour', cellIds: ['3', '4'] },
    ])
  })

  it('rejects an empty JSON cell ID', () => {
    expect(() =>
      parseCustomAnnotations(JSON.stringify({ Tumour: ['3', ' '] }), 'labels.json'),
    ).toThrow('Cell ID is empty.')
  })
})
