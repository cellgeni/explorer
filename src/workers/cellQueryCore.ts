import { CellQueryStore, type CellQueryColumnSummary } from '../features/query/cellQuery'
import type {
  CellQueryColumnRequest,
  CellQueryWorkerRequest,
  CellQueryWorkerResponse,
} from './cellQueryMessages'

// Handles one query worker's messages against a store of its own.
export function cellQueryHandler(
  respond: (response: CellQueryWorkerResponse, transfer?: Transferable[]) => void,
  store = new CellQueryStore(),
): (request: CellQueryWorkerRequest) => void {
  return (request) => {
    switch (request.type) {
      case 'rows':
        store.setRows(request.ids)
        return
      case 'delete-column':
        store.deleteColumn(request.columnId)
        return
      case 'number-column':
      case 'number-column-by-id':
      case 'category-column':
      case 'category-column-by-row':
      case 'run':
      case 'values':
        try {
          if (request.type === 'run') {
            const result = store.run(request.conditions, request.sort)
            respond({ type: 'result', id: request.id, result }, [result.rows.buffer])
          } else if (request.type === 'values') {
            respond({
              type: 'values',
              id: request.id,
              values: store.values(request.rows, request.columnIds),
            })
          } else {
            respond({
              type: 'summary',
              id: request.id,
              summary: applyColumnRequest(store, request),
            })
          }
        } catch (cause) {
          respond({
            type: 'error',
            id: request.id,
            error: cause instanceof Error ? cause.message : String(cause),
          })
        }
    }
  }
}

// Sets a column on a store, the worker's or the main thread's.
export function applyColumnRequest(
  store: CellQueryStore,
  request: CellQueryColumnRequest,
): CellQueryColumnSummary {
  switch (request.type) {
    case 'number-column':
      store.setNumberColumn(request.columnId, request.values)
      return { unmatchedIds: 0 }
    case 'number-column-by-id':
      return store.setNumberColumnById(request.columnId, request.cellIds, request.values)
    case 'category-column':
      return store.setCategoryColumn(request.columnId, request.classes)
    case 'category-column-by-row':
      store.setCategoryColumnByRow(request.columnId, request.codes, request.labels)
      return { unmatchedIds: 0 }
  }
}
