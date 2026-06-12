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
})
