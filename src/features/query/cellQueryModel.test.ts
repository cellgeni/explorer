import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CellQueryCondition } from './cellQuery'
import {
  cellQueryColumns,
  cellQueryImageColumns,
  defaultCellQueryCondition,
  defaultQueryClassName,
  formatCellQueryLink,
  formatCellQueryNumber,
  imageColumn,
  imageColumnId,
  isConditionComplete,
  overviewCellColumns,
  overviewNumberColumn,
  overviewSegmentationColumn,
  parseCellQueryLink,
  parseImageColumnId,
  queryClassId,
  withNumberOperator,
  type CellQueryImageChannelOption,
  type CellQueryImageColumnSpec,
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

describe('image columns (plan 26-D1, D9)', () => {
  const DAPI: CellQueryImageChannelOption = {
    id: 'Channel:0',
    name: 'DAPI',
    levels: [0.2125, 0.425, 0.8500331, 1.7],
    defaultLevel: 2,
    threshold: 2176,
  }

  it('writes the statistic, level, plane, threshold and radius before the channel', () => {
    expect(imageColumnId({ stat: 'mean', level: 2, channelId: 'Channel:0' })).toBe(
      'image:mean:2:Channel:0',
    )
    expect(
      imageColumnId({
        stat: 'above',
        level: 1,
        z: 3,
        threshold: 2176,
        radius: 5,
        channelId: 'layer:Channel:1',
      }),
    ).toBe('image:above:1:z3:t2176:r5:layer:Channel:1')
    // A time point follows the plane (plan 28).
    expect(
      imageColumnId({
        stat: 'above',
        level: 1,
        z: 3,
        timePoint: 21,
        threshold: 2176,
        channelId: 'Channel:1',
      }),
    ).toBe('image:above:1:z3:time21:t2176:Channel:1')
    // The mean has no threshold.
    expect(
      imageColumnId({ stat: 'mean', level: 2, threshold: 9, channelId: 'Channel:0' }),
    ).toBe('image:mean:2:Channel:0')
  })

  it('reads the IDs back, channels with colons included', () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            stat: fc.constantFrom('mean' as const, 'above' as const),
            level: fc.nat(12),
            z: fc.nat(200),
            timePoint: fc.nat(1000),
            // A link writes -0 as 0.
            threshold: fc
              .double({ min: -1e6, max: 1e6, noNaN: true })
              .map((value) => value + 0),
            radius: fc.double({ min: 0.01, max: 100, noNaN: true }),
            channelId: fc.constantFrom('Channel:0', 'layer:Channel:12', 'DAPI'),
          },
          { requiredKeys: ['stat', 'level', 'channelId'] },
        ),
        (spec) => {
          const { threshold, ...rest } = spec
          const expected: CellQueryImageColumnSpec =
            spec.stat === 'above' && threshold !== undefined ? spec : rest
          expect(parseImageColumnId(imageColumnId(spec))).toEqual(expected)
        },
      ),
    )
  })

  it('reads nothing from IDs that are not image columns', () => {
    for (const id of [
      'cell:area',
      'image:max:2:Channel:0',
      'image:mean:two:Channel:0',
      'image:mean:2',
      'image:mean:2:r0:Channel:0',
    ]) {
      expect(parseImageColumnId(id)).toBeNull()
    }
  })

  it('names the channel, statistic and level in the label', () => {
    expect(
      imageColumn({ stat: 'mean', level: 2, channelId: 'Channel:0' }, DAPI),
    ).toMatchObject({
      label: 'DAPI mean (0.85 µm/px)',
      kind: 'number',
      group: 'Image',
    })
    expect(
      imageColumn(
        {
          stat: 'above',
          level: 1,
          z: 4,
          threshold: 2176,
          radius: 5,
          channelId: 'Channel:0',
        },
        DAPI,
      ).label,
    ).toBe('DAPI % above 2,176 (z 4, 0.42 µm/px, radius 5 µm)')
  })

  it('lists each channel at its default level, waiting for a threshold where needed', () => {
    const columns = cellQueryImageColumns({
      channels: [DAPI, { ...DAPI, id: 'Channel:1', name: '18S', threshold: 'finding' }],
      z: undefined,
      radius: undefined,
      channelsInUse: [],
    })

    expect(columns.map((column) => [column.id, column.disabled])).toEqual([
      ['image:mean:2:Channel:0', undefined],
      ['image:above:2:t2176:Channel:0', undefined],
      ['image:mean:2:Channel:1', undefined],
      ['image:above:2:Channel:1', 'Finding a threshold…'],
    ])
  })

  it('lists a fourth channel but cannot add it while three are in use', () => {
    const channels = ['A', 'B', 'C', 'D'].map((name, index) => ({
      ...DAPI,
      id: `Channel:${index.toString()}`,
      name,
    }))
    const columns = cellQueryImageColumns({
      channels,
      z: 2,
      radius: 5,
      channelsInUse: ['Channel:0', 'Channel:1', 'Channel:2'],
    })

    expect(
      columns.find((column) => column.id === 'image:mean:2:z2:r5:Channel:0')?.disabled,
    ).toBeUndefined()
    expect(
      columns.find((column) => column.id === 'image:mean:2:z2:r5:Channel:3')?.disabled,
    ).toBe('Up to 3 channels are measured at a time: A, B and C are in use.')
  })

  it('starts a condition at half the pixels above, or a mean at the threshold', () => {
    const above = imageColumn(
      { stat: 'above', level: 2, threshold: 2176, channelId: 'Channel:0' },
      DAPI,
    )
    const mean = imageColumn({ stat: 'mean', level: 2, channelId: 'Channel:0' }, DAPI)

    expect(defaultCellQueryCondition(above, 2176)).toMatchObject({
      operator: 'at-least',
      min: 50,
    })
    expect(defaultCellQueryCondition(mean, 2176)).toMatchObject({
      operator: 'at-least',
      min: 2176,
    })
  })

  it('keeps image conditions in the link', () => {
    const conditions: CellQueryCondition[] = [
      {
        kind: 'number',
        columnId: 'image:above:2:t2176:Channel:0',
        operator: 'at-least',
        min: 40,
        max: Infinity,
      },
      {
        kind: 'number',
        columnId: 'image:mean:2:r5:Channel:0',
        operator: 'at-least',
        min: 300,
        max: Infinity,
      },
    ]
    const link = formatCellQueryLink(conditions)

    expect(link).toBe(
      'image:above:2:t2176:Channel:0|at-least|40;image:mean:2:r5:Channel:0|at-least|300',
    )
    expect(parseCellQueryLink(link)).toEqual(conditions)
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
