// The Cell Query window's columns and matching (plan 23-A, 23-D4). A store
// holds one dataset's columns by overview row: numbers as `Float64Array`
// with NaN where a cell has no value, and classes as each row's first class
// with a map of further ones, as the plot store keeps them. It runs in the
// query worker, or on the main thread without one.

export type CellQueryNumberOperator = 'between' | 'at-least' | 'at-most'
export type CellQueryCategoryOperator = 'in' | 'not-in'

export interface CellQueryNumberCondition {
  readonly kind: 'number'
  readonly columnId: string
  readonly operator: CellQueryNumberOperator
  // `between` takes both; `at-least` only min, `at-most` only max.
  readonly min: number
  readonly max: number
}

export interface CellQueryCategoryCondition {
  readonly kind: 'category'
  readonly columnId: string
  readonly operator: CellQueryCategoryOperator
  readonly classIds: readonly string[]
}

export type CellQueryCondition = CellQueryNumberCondition | CellQueryCategoryCondition

// The table's sort. The cell ID sorts as `CELL_QUERY_ID_COLUMN`.
export interface CellQuerySort {
  readonly columnId: string
  readonly direction: 'ascending' | 'descending'
}

export const CELL_QUERY_ID_COLUMN = 'cell:id'

export interface CellQueryClassInput {
  readonly id: string
  readonly label: string
  readonly cellIds: readonly string[]
}

// A column read by cell ID: how many of its IDs name no row, so the window
// can say so.
export interface CellQueryColumnSummary {
  readonly unmatchedIds: number
}

export interface CellQueryResult {
  // Matching rows, in the sort's order (row order without one).
  readonly rows: Uint32Array
  readonly total: number
  // Columns the conditions or sort name that the store does not hold;
  // nothing matches until they are set.
  readonly missingColumnIds: readonly string[]
}

export type CellQueryColumnValues =
  | { readonly kind: 'number'; readonly values: Float64Array }
  // Each row's classes, joined with ", "; "" for a row in none.
  | { readonly kind: 'category'; readonly labels: readonly string[] }

interface NumberColumn {
  readonly kind: 'number'
  readonly values: Float64Array
}

interface CategoryColumn {
  readonly kind: 'category'
  readonly classIds: readonly string[]
  readonly labels: readonly string[]
  // Each row's first class, or NO_CLASS.
  readonly first: Int32Array
  // Classes after the first, for rows listed by several.
  readonly extra: ReadonlyMap<number, readonly number[]>
  // Each class's place when sorted by label.
  readonly labelRank: Uint32Array
}

type Column = NumberColumn | CategoryColumn

const NO_CLASS = -1
const labelCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export class CellQueryStore {
  private rowIds: readonly string[] = []
  private rowById: Map<string, number> | null = null
  private readonly columns = new Map<string, Column>()

  get rowCount(): number {
    return this.rowIds.length
  }

  // A new dataset, or new cells: every column goes.
  setRows(ids: readonly string[]): void {
    this.rowIds = ids
    this.rowById = null
    this.columns.clear()
  }

  hasColumn(columnId: string): boolean {
    return this.columns.has(columnId)
  }

  deleteColumn(columnId: string): void {
    this.columns.delete(columnId)
  }

  // A value per row, such as the overview's transcript counts.
  setNumberColumn(columnId: string, values: Float64Array): void {
    if (values.length !== this.rowCount) {
      throw new Error(
        `Column ${columnId} has ${values.length.toLocaleString()} values for ${this.rowCount.toLocaleString()} cells.`,
      )
    }
    this.columns.set(columnId, { kind: 'number', values })
  }

  // Values listed by cell ID, such as a metadata track. Rows not listed have
  // no value.
  setNumberColumnById(
    columnId: string,
    cellIds: readonly string[],
    values: Float64Array,
  ): CellQueryColumnSummary {
    const rowById = this.rowsById()
    const column = new Float64Array(this.rowCount).fill(Number.NaN)
    let unmatchedIds = 0

    cellIds.forEach((cellId, index) => {
      const row = rowById.get(cellId)
      if (row === undefined) {
        unmatchedIds += 1
      } else {
        column[row] = values[index] ?? Number.NaN
      }
    })

    this.columns.set(columnId, { kind: 'number', values: column })
    return { unmatchedIds }
  }

  // Classes listed by cell ID, such as an annotation set or the saved
  // selections. A cell listed twice by one class counts once.
  setCategoryColumn(
    columnId: string,
    classes: readonly CellQueryClassInput[],
  ): CellQueryColumnSummary {
    const rowById = this.rowsById()
    const first = new Int32Array(this.rowCount).fill(NO_CLASS)
    const extra = new Map<number, number[]>()
    let unmatchedIds = 0

    classes.forEach((queryClass, classIndex) => {
      for (const cellId of queryClass.cellIds) {
        const row = rowById.get(cellId)

        if (row === undefined) {
          unmatchedIds += 1
          continue
        }

        const current = first[row] ?? NO_CLASS
        if (current === NO_CLASS) {
          first[row] = classIndex
        } else if (current !== classIndex) {
          const more = extra.get(row) ?? []
          if (!more.includes(classIndex)) more.push(classIndex)
          extra.set(row, more)
        }
      }
    })

    this.columns.set(
      columnId,
      categoryColumn(
        classes.map((queryClass) => queryClass.id),
        classes.map((queryClass) => queryClass.label),
        first,
        extra,
      ),
    )
    return { unmatchedIds }
  }

  // A class per row, by index into `labels` (or -1 for none), such as the
  // overview's segmentation method. Class IDs are the labels.
  setCategoryColumnByRow(
    columnId: string,
    codes: Int32Array,
    labels: readonly string[],
  ): void {
    if (codes.length !== this.rowCount) {
      throw new Error(
        `Column ${columnId} has ${codes.length.toLocaleString()} values for ${this.rowCount.toLocaleString()} cells.`,
      )
    }
    this.columns.set(columnId, categoryColumn(labels, labels, codes, new Map()))
  }

  // The rows matching every condition (23-D3), sorted.
  run(
    conditions: readonly CellQueryCondition[],
    sort: CellQuerySort | null = null,
  ): CellQueryResult {
    const named = [
      ...conditions.map((condition) => condition.columnId),
      ...(sort === null || sort.columnId === CELL_QUERY_ID_COLUMN ? [] : [sort.columnId]),
    ]
    const missingColumnIds = [...new Set(named)].filter((id) => !this.columns.has(id))

    if (missingColumnIds.length > 0) {
      return { rows: new Uint32Array(0), total: this.rowCount, missingColumnIds }
    }

    let rows = new Uint32Array(this.rowCount)
    for (let row = 0; row < rows.length; row += 1) rows[row] = row
    let count = rows.length

    for (const condition of conditions) {
      const test = this.conditionTest(condition)
      let kept = 0

      for (let index = 0; index < count; index += 1) {
        const row = rows[index] ?? 0
        if (test(row)) {
          rows[kept] = row
          kept += 1
        }
      }
      count = kept
    }

    rows = rows.slice(0, count)
    if (sort !== null) this.sortRows(rows, sort)

    return { rows, total: this.rowCount, missingColumnIds: [] }
  }

  // The columns' values for the given rows, in their order. Columns the store
  // does not hold are left out.
  values(
    rows: Uint32Array,
    columnIds: readonly string[],
  ): Readonly<Record<string, CellQueryColumnValues>> {
    const result: Record<string, CellQueryColumnValues> = {}

    for (const columnId of columnIds) {
      if (columnId === CELL_QUERY_ID_COLUMN) {
        result[columnId] = {
          kind: 'category',
          labels: Array.from(rows, (row) => this.rowIds[row] ?? ''),
        }
        continue
      }

      const column = this.columns.get(columnId)
      if (column === undefined) continue

      if (column.kind === 'number') {
        result[columnId] = {
          kind: 'number',
          values: Float64Array.from(rows, (row) => column.values[row] ?? Number.NaN),
        }
      } else {
        result[columnId] = {
          kind: 'category',
          labels: Array.from(rows, (row) => rowClassLabels(column, row)),
        }
      }
    }

    return result
  }

  private rowsById(): Map<string, number> {
    if (this.rowById !== null) return this.rowById

    const rowById = new Map<string, number>()
    this.rowIds.forEach((id, row) => {
      if (!rowById.has(id)) rowById.set(id, row)
    })
    this.rowById = rowById
    return rowById
  }

  private conditionTest(condition: CellQueryCondition): (row: number) => boolean {
    const column = this.columns.get(condition.columnId)

    if (condition.kind === 'number') {
      if (column?.kind !== 'number') return () => false
      const { values } = column
      const { min, max } = condition

      // NaN fails every comparison, so cells without a value never match.
      switch (condition.operator) {
        case 'between':
          return (row) => {
            const value = values[row] ?? Number.NaN
            return value >= min && value <= max
          }
        case 'at-least':
          return (row) => (values[row] ?? Number.NaN) >= min
        case 'at-most':
          return (row) => (values[row] ?? Number.NaN) <= max
      }
    }

    if (column?.kind !== 'category') return () => false

    const chosen = new Uint8Array(column.classIds.length)
    const wanted = new Set(condition.classIds)
    column.classIds.forEach((id, index) => {
      if (wanted.has(id)) chosen[index] = 1
    })
    const inChosen = (row: number): boolean => {
      const first = column.first[row] ?? NO_CLASS
      if (first === NO_CLASS) return false
      if (chosen[first] === 1) return true
      return column.extra.get(row)?.some((index) => chosen[index] === 1) ?? false
    }

    return condition.operator === 'in' ? inChosen : (row) => !inChosen(row)
  }

  // In place. Cells without a value come last either way; ties keep row
  // order.
  private sortRows(rows: Uint32Array, sort: CellQuerySort): void {
    const sign = sort.direction === 'ascending' ? 1 : -1

    if (sort.columnId === CELL_QUERY_ID_COLUMN) {
      const ids = this.rowIds
      rows.sort((a, b) => sign * compareCellIds(ids[a] ?? '', ids[b] ?? '') || a - b)
      return
    }

    const column = this.columns.get(sort.columnId)
    if (column === undefined) return

    if (column.kind === 'number') {
      const { values } = column
      rows.sort((a, b) => {
        const left = values[a] ?? Number.NaN
        const right = values[b] ?? Number.NaN
        const leftMissing = Number.isNaN(left)
        const rightMissing = Number.isNaN(right)
        if (leftMissing || rightMissing) {
          return leftMissing === rightMissing ? a - b : leftMissing ? 1 : -1
        }
        return sign * (left - right) || a - b
      })
      return
    }

    const { first, labelRank } = column
    rows.sort((a, b) => {
      const left = first[a] ?? NO_CLASS
      const right = first[b] ?? NO_CLASS
      if (left === NO_CLASS || right === NO_CLASS) {
        return left === right ? a - b : left === NO_CLASS ? 1 : -1
      }
      return sign * ((labelRank[left] ?? 0) - (labelRank[right] ?? 0)) || a - b
    })
  }
}

function categoryColumn(
  classIds: readonly string[],
  labels: readonly string[],
  first: Int32Array,
  extra: ReadonlyMap<number, readonly number[]>,
): CategoryColumn {
  const order = labels
    .map((label, index) => ({ label, index }))
    .sort((a, b) => labelCollator.compare(a.label, b.label) || a.index - b.index)
  const labelRank = new Uint32Array(labels.length)
  order.forEach((entry, rank) => {
    labelRank[entry.index] = rank
  })

  return { kind: 'category', classIds, labels, first, extra, labelRank }
}

function rowClassLabels(column: CategoryColumn, row: number): string {
  const first = column.first[row] ?? NO_CLASS
  if (first === NO_CLASS) return ''

  const more = column.extra.get(row)
  const label = column.labels[first] ?? ''
  return more === undefined
    ? label
    : [label, ...more.map((index) => column.labels[index] ?? '')].join(', ')
}

const WHOLE_NUMBER = /^(0|[1-9][0-9]*)$/

// Whole numbers by value, as H5AD tables often name cells; anything else by
// character code. A collator would take seconds over a million IDs.
export function compareCellIds(a: string, b: string): number {
  if (WHOLE_NUMBER.test(a) && WHOLE_NUMBER.test(b) && a.length !== b.length) {
    return a.length - b.length
  }
  return a < b ? -1 : a > b ? 1 : 0
}
