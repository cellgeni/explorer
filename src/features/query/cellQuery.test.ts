import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CELL_QUERY_ID_COLUMN,
  CellQueryStore,
  compareCellIds,
  type CellQueryCondition,
} from './cellQuery'

const ROWS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']

function storeWithColumns(): CellQueryStore {
  const store = new CellQueryStore()
  store.setRows(ROWS)
  store.setNumberColumn('cell:area', new Float64Array([10, 25, Number.NaN, 40, 5, 25]))
  store.setCategoryColumn('set:leiden', [
    { id: 'leiden:0', label: 'T cells', cellIds: ['c1', 'c2', 'c2'] },
    { id: 'leiden:1', label: 'B cells', cellIds: ['c3', 'c4'] },
    { id: 'leiden:2', label: 'Myeloid', cellIds: ['c4', 'missing'] },
  ])
  return store
}

function matchedIds(store: CellQueryStore, conditions: readonly CellQueryCondition[]) {
  return Array.from(store.run(conditions).rows, (row) => ROWS[row])
}

describe('cell query store (plan 23-A)', () => {
  it('matches numbers by range, and never a cell without a value', () => {
    const store = storeWithColumns()
    const area = (operator: 'between' | 'at-least' | 'at-most') =>
      ({ kind: 'number', columnId: 'cell:area', operator, min: 10, max: 25 }) as const

    expect(matchedIds(store, [area('between')])).toEqual(['c1', 'c2', 'c6'])
    expect(matchedIds(store, [area('at-least')])).toEqual(['c1', 'c2', 'c4', 'c6'])
    expect(matchedIds(store, [area('at-most')])).toEqual(['c1', 'c2', 'c5', 'c6'])
  })

  it('matches cells in any chosen class, or in none of them', () => {
    const store = storeWithColumns()
    const leiden = (operator: 'in' | 'not-in', classIds: readonly string[]) =>
      ({ kind: 'category', columnId: 'set:leiden', operator, classIds }) as const

    expect(matchedIds(store, [leiden('in', ['leiden:2'])])).toEqual(['c4'])
    expect(matchedIds(store, [leiden('in', ['leiden:0', 'leiden:1'])])).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
    ])
    // c4 is in B cells and Myeloid: leaving out B cells still leaves it out.
    expect(matchedIds(store, [leiden('not-in', ['leiden:1'])])).toEqual([
      'c1',
      'c2',
      'c5',
      'c6',
    ])
  })

  it('combines conditions with AND (23-D3)', () => {
    const store = storeWithColumns()

    expect(
      matchedIds(store, [
        {
          kind: 'category',
          columnId: 'set:leiden',
          operator: 'in',
          classIds: ['leiden:0'],
        },
        { kind: 'number', columnId: 'cell:area', operator: 'at-least', min: 20, max: 0 },
      ]),
    ).toEqual(['c2'])
  })

  it('counts IDs that name no cell, and a class listing a cell twice once', () => {
    const store = new CellQueryStore()
    store.setRows(ROWS)

    expect(
      store.setCategoryColumn('set:x', [
        { id: 'a', label: 'A', cellIds: ['c1', 'c1', 'nope', 'also-not'] },
      ]),
    ).toEqual({ unmatchedIds: 2 })
    expect(store.values(new Uint32Array([0, 1]), ['set:x'])['set:x']).toEqual({
      kind: 'category',
      labels: ['A', ''],
    })
  })

  it('reads number columns by cell ID, leaving other cells without a value', () => {
    const store = new CellQueryStore()
    store.setRows(ROWS)

    expect(
      store.setNumberColumnById(
        'track:score',
        ['c2', 'c5', 'gone'],
        new Float64Array([1.5, 3, 9]),
      ),
    ).toEqual({ unmatchedIds: 1 })

    const values = store.values(new Uint32Array([0, 1, 4]), ['track:score'])[
      'track:score'
    ]
    expect(values?.kind).toBe('number')
    expect(Array.from(values?.kind === 'number' ? values.values : [])).toEqual([
      Number.NaN,
      1.5,
      3,
    ])
  })

  it('says which columns it lacks and matches nothing until they are set', () => {
    const store = storeWithColumns()
    const result = store.run(
      [
        {
          kind: 'number',
          columnId: 'track:unknown',
          operator: 'at-least',
          min: 0,
          max: 0,
        },
      ],
      { columnId: 'set:other', direction: 'ascending' },
    )

    expect(result.missingColumnIds).toEqual(['track:unknown', 'set:other'])
    expect(result.rows).toHaveLength(0)
    expect(result.total).toBe(6)
  })

  it('sorts numbers and classes with missing values last, ties in row order', () => {
    const store = storeWithColumns()
    const sorted = (columnId: string, direction: 'ascending' | 'descending') =>
      Array.from(store.run([], { columnId, direction }).rows, (row) => ROWS[row])

    expect(sorted('cell:area', 'ascending')).toEqual(['c5', 'c1', 'c2', 'c6', 'c4', 'c3'])
    expect(sorted('cell:area', 'descending')).toEqual([
      'c4',
      'c2',
      'c6',
      'c1',
      'c5',
      'c3',
    ])
    // By label: B cells, Myeloid, T cells; c5 and c6 are in no class.
    expect(sorted('set:leiden', 'ascending')).toEqual([
      'c3',
      'c4',
      'c1',
      'c2',
      'c5',
      'c6',
    ])
    expect(sorted(CELL_QUERY_ID_COLUMN, 'descending')).toEqual([
      'c6',
      'c5',
      'c4',
      'c3',
      'c2',
      'c1',
    ])
  })

  it('joins the classes of a cell listed by several', () => {
    const store = storeWithColumns()

    expect(store.values(new Uint32Array([3, 4]), ['set:leiden', 'nope'])).toEqual({
      'set:leiden': { kind: 'category', labels: ['B cells, Myeloid', ''] },
    })
  })

  it('reads a class per row, such as the segmentation method', () => {
    const store = new CellQueryStore()
    store.setRows(['a', 'b', 'c'])
    store.setCategoryColumnByRow('cell:segmentation', new Int32Array([1, -1, 0]), [
      'Boundary',
      'Interior',
    ])

    expect(
      Array.from(
        store.run([
          {
            kind: 'category',
            columnId: 'cell:segmentation',
            operator: 'in',
            classIds: ['Interior'],
          },
        ]).rows,
      ),
    ).toEqual([0])
  })

  it('refuses a column whose length is not the row count', () => {
    const store = new CellQueryStore()
    store.setRows(['a', 'b'])

    expect(() => {
      store.setNumberColumn('cell:area', new Float64Array(3))
    }).toThrow(/3 values for 2 cells/)
  })

  it('sorts whole-number IDs by value', () => {
    expect(['10', '9', '100', 'a2', 'a10'].sort(compareCellIds)).toEqual([
      '9',
      '10',
      '100',
      'a10',
      'a2',
    ])
  })

  it('matches as a plain filter over the same cells does', () => {
    const cellArb = fc.record({
      value: fc.oneof(fc.constant(Number.NaN), fc.integer({ min: -5, max: 5 })),
      classes: fc.uniqueArray(fc.integer({ min: 0, max: 3 }), { maxLength: 2 }),
    })
    const conditionArb = fc.oneof(
      fc.record({
        kind: fc.constant('number' as const),
        columnId: fc.constant('n'),
        operator: fc.constantFrom(
          'between' as const,
          'at-least' as const,
          'at-most' as const,
        ),
        min: fc.integer({ min: -5, max: 5 }),
        max: fc.integer({ min: -5, max: 5 }),
      }),
      fc.record({
        kind: fc.constant('category' as const),
        columnId: fc.constant('k'),
        operator: fc.constantFrom('in' as const, 'not-in' as const),
        classIds: fc.uniqueArray(fc.constantFrom('k0', 'k1', 'k2', 'k3'), {
          maxLength: 3,
        }),
      }),
    )

    fc.assert(
      fc.property(
        fc.array(cellArb, { maxLength: 40 }),
        fc.array(conditionArb, { maxLength: 3 }),
        (cells, conditions) => {
          const ids = cells.map((_, index) => `cell-${index}`)
          const store = new CellQueryStore()
          store.setRows(ids)
          store.setNumberColumn(
            'n',
            Float64Array.from(cells, (cell) => cell.value),
          )
          store.setCategoryColumn(
            'k',
            [0, 1, 2, 3].map((classIndex) => ({
              id: `k${classIndex}`,
              label: `K${classIndex}`,
              cellIds: ids.filter((_, row) => cells[row]?.classes.includes(classIndex)),
            })),
          )

          const expected = cells.flatMap((cell, row) =>
            conditions.every((condition) => {
              if (condition.kind === 'number') {
                const { value } = cell
                if (condition.operator === 'between') {
                  return value >= condition.min && value <= condition.max
                }
                return condition.operator === 'at-least'
                  ? value >= condition.min
                  : value <= condition.max
              }
              const chosen: readonly string[] = condition.classIds
              const inChosen = cell.classes.some((index) => chosen.includes(`k${index}`))
              return condition.operator === 'in' ? inChosen : !inChosen
            })
              ? [row]
              : [],
          )

          expect(Array.from(store.run(conditions).rows)).toEqual(expected)
        },
      ),
    )
  })
})
