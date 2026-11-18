import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CellQueryCondition } from './cellQuery'
import {
  cellQueryColumns,
  defaultCellQueryCondition,
  defaultQueryClassName,
  formatCellQueryLink,
  formatCellQueryNumber,
  isConditionComplete,
  overviewCellColumns,
  overviewNumberColumn,
  overviewSegmentationColumn,
  parseCellQueryLink,
  queryClassId,
  withNumberOperator,
} from './cellQueryModel'

const CELLS = [
  { transcriptCount: 12, cellArea: 40.5, segmentationMethod: 'Interior' },
  { transcriptCount: 0, cellArea: 10, segmentationMethod: 'Boundary' },
  { transcriptCount: 7, segmentationMethod: 'Interior' },
]

describe('cell query columns (plan 23-D2)', () => {
  it('offers the overview columns a platform fills, with their ranges', () => {
    const columns = overviewCellColumns(CELLS)

    expect(columns).toEqual({
      numbers: {
        transcriptCount: { min: 0, max: 12 },
        cellArea: { min: 10, max: 40.5 },
      },
      segmentationMethods: ['Interior', 'Boundary'],
    })
    // H5AD cells all carry a count of 0, which says nothing.
    expect(overviewCellColumns([{ transcriptCount: 0 }, { transcriptCount: 0 }])).toEqual(
      {
        numbers: {},
        segmentationMethods: [],
      },
    )
  })

  it('builds a column per cell, NaN or -1 where a cell has no value', () => {
    expect(Array.from(overviewNumberColumn(CELLS, 'cellArea'))).toEqual([
      40.5,
      10,
      Number.NaN,
    ])
    expect(
      Array.from(overviewSegmentationColumn([...CELLS, {}], ['Interior', 'Boundary'])),
    ).toEqual([0, 1, 0, -1])
  })

  it('lists the cell, class and metadata columns in that order', () => {
    const columns = cellQueryColumns({
      cellColumns: overviewCellColumns(CELLS),
      setOptions: [
        { id: 'analysis:leiden', label: 'leiden', classCount: 8, kind: 'loaded' },
        {
          id: 'saved-selections',
          label: 'Selections',
          classCount: 2,
          kind: 'selections',
        },
      ],
      tracks: [
        { id: 'h5ad:score', label: 'score', values: null, cellCount: 3, min: -1, max: 2 },
      ],
    })

    expect(columns.map((column) => [column.id, column.group, column.kind])).toEqual([
      ['cell:transcripts', 'Cell', 'number'],
      ['cell:area', 'Cell', 'number'],
      ['cell:segmentation', 'Cell', 'category'],
      ['set:analysis:leiden', 'Classes', 'category'],
      ['set:saved-selections', 'Classes', 'category'],
      ['track:h5ad:score', 'Metadata', 'number'],
    ])
    expect(columns[1]).toMatchObject({ label: 'Cell area', unit: 'µm²' })
    expect(columns[5]).toMatchObject({ range: { min: -1, max: 2 } })
  })
})

describe('cell query conditions (plan 23-B, 23-D3)', () => {
  it('starts a number condition at the whole range and a class condition empty', () => {
    const [transcripts, , segmentation] = cellQueryColumns({
      cellColumns: overviewCellColumns(CELLS),
      setOptions: [],
      tracks: [],
    })

    expect(transcripts && defaultCellQueryCondition(transcripts)).toEqual({
      kind: 'number',
      columnId: 'cell:transcripts',
      operator: 'between',
      min: 0,
      max: 12,
    })
    const classes = segmentation && defaultCellQueryCondition(segmentation)
    expect(classes).toEqual({
      kind: 'category',
      columnId: 'cell:segmentation',
      operator: 'in',
      classIds: [],
    })
    expect(classes && isConditionComplete(classes)).toBe(false)
  })

  it('keeps a shared bound when the operator changes, filling the other from the range', () => {
    const atLeast: CellQueryCondition = {
      kind: 'number',
      columnId: 'cell:area',
      operator: 'at-least',
      min: 20,
      max: Infinity,
    }

    expect(
      atLeast.kind === 'number' &&
        withNumberOperator(atLeast, 'between', { min: 0, max: 50 }),
    ).toMatchObject({ operator: 'between', min: 20, max: 50 })
    expect(isConditionComplete(atLeast)).toBe(true)
  })
})

describe('query= (plan 23-D9)', () => {
  it('writes and reads conditions, escaping the separators in IDs', () => {
    const conditions: readonly CellQueryCondition[] = [
      {
        kind: 'category',
        columnId: 'set:custom:my-file:set',
        operator: 'not-in',
        classIds: ['a,b', 'c;d', 'e|f', '50%'],
      },
      { kind: 'number', columnId: 'cell:area', operator: 'between', min: 1.5, max: 20 },
      {
        kind: 'number',
        columnId: 'track:x',
        operator: 'at-least',
        min: -3,
        max: Infinity,
      },
      {
        kind: 'number',
        columnId: 'track:y',
        operator: 'at-most',
        min: -Infinity,
        max: 0.1,
      },
    ]
    const link = formatCellQueryLink(conditions)

    expect(link).toBe(
      'set:custom:my-file:set|not-in|a%2Cb,c%3Bd,e%7Cf,50%25;cell:area|between|1.5,20;track:x|at-least|-3;track:y|at-most|0.1',
    )
    expect(parseCellQueryLink(link)).toEqual(conditions)
    expect(formatCellQueryLink([])).toBeUndefined()
  })

  it('drops conditions that do not parse', () => {
    expect(
      parseCellQueryLink(
        'cell:area|between|1;|in|a;x|nope|1;track:t|at-least|abc;set:s|in|',
      ),
    ).toEqual([{ kind: 'category', columnId: 'set:s', operator: 'in', classIds: [] }])
  })

  it('round-trips any number', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (value) => {
        const [condition] = parseCellQueryLink(
          formatCellQueryLink([
            {
              kind: 'number',
              columnId: 'n',
              operator: 'between',
              min: value,
              max: value,
            },
          ]),
        )
        // -0 reads back as 0, which compares the same.
        const expected = value === 0 ? 0 : value
        expect(condition).toMatchObject({ min: expected, max: expected })
      }),
    )
  })
})

describe('cell query text', () => {
  it('formats whole numbers, decimals and very small values', () => {
    expect(formatCellQueryNumber(1234)).toBe('1,234')
    expect(formatCellQueryNumber(12.3456)).toBe('12.35')
    expect(formatCellQueryNumber(3.932982e-14)).toBe('3.93e-14')
    expect(formatCellQueryNumber(Number.NaN)).toBe('')
  })

  it('numbers saved classes after the highest kept', () => {
    const annotations = [
      { id: 'query:2:t-cells', label: 'T cells', cellIds: [] },
      { id: 'roi:5:roi-5', label: 'ROI 5', cellIds: [] },
    ]

    expect(queryClassId(annotations, 'Tumour edge')).toEqual({
      id: 'query:3:tumour-edge',
      number: 3,
    })
    expect(defaultQueryClassName(annotations)).toBe('Query 3')
    expect(defaultQueryClassName([])).toBe('Query 1')
  })
})
