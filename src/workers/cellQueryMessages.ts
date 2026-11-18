import type {
  CellQueryClassInput,
  CellQueryColumnSummary,
  CellQueryColumnValues,
  CellQueryCondition,
  CellQueryResult,
  CellQuerySort,
} from '../features/query/cellQuery'

// A query worker holds one dataset's rows and the columns the Cell Query
// window uses (plan 23-D4). Messages are handled in order, so a run sent
// after a column uses it. Matching rows come back transferred.

export type CellQueryColumnRequest =
  | {
      readonly type: 'number-column'
      readonly columnId: string
      readonly values: Float64Array
    }
  | {
      readonly type: 'number-column-by-id'
      readonly columnId: string
      readonly cellIds: readonly string[]
      readonly values: Float64Array
    }
  | {
      readonly type: 'category-column'
      readonly columnId: string
      readonly classes: readonly CellQueryClassInput[]
    }
  | {
      readonly type: 'category-column-by-row'
      readonly columnId: string
      readonly codes: Int32Array
      readonly labels: readonly string[]
    }

export type CellQueryWorkerRequest =
  | { readonly type: 'rows'; readonly ids: readonly string[] }
  | (CellQueryColumnRequest & { readonly id: number })
  | { readonly type: 'delete-column'; readonly columnId: string }
  | {
      readonly type: 'run'
      readonly id: number
      readonly conditions: readonly CellQueryCondition[]
      readonly sort: CellQuerySort | null
    }
  | {
      readonly type: 'values'
      readonly id: number
      readonly rows: Uint32Array
      readonly columnIds: readonly string[]
    }

export type CellQueryWorkerResponse =
  | {
      readonly type: 'summary'
      readonly id: number
      readonly summary: CellQueryColumnSummary
    }
  | { readonly type: 'result'; readonly id: number; readonly result: CellQueryResult }
  | {
      readonly type: 'values'
      readonly id: number
      readonly values: Readonly<Record<string, CellQueryColumnValues>>
    }
  | { readonly type: 'error'; readonly id: number; readonly error: string }
