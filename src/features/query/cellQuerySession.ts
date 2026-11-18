import { applyColumnRequest } from '../../workers/cellQueryCore'
import type {
  CellQueryColumnRequest,
  CellQueryWorkerRequest,
  CellQueryWorkerResponse,
} from '../../workers/cellQueryMessages'
import {
  CellQueryStore,
  type CellQueryColumnSummary,
  type CellQueryColumnValues,
  type CellQueryCondition,
  type CellQueryResult,
  type CellQuerySort,
} from './cellQuery'

// The Cell Query window's link to its columns (plan 23-D4): a worker of its
// own per dataset, so mapping a million cell IDs to rows, matching and
// sorting stay off the main thread. Without a Worker (Vitest's jsdom), or
// once the worker fails, the same store runs on this thread, given the rows
// and columns again.

export type CellQueryValues = Readonly<Record<string, CellQueryColumnValues>>

export interface CellQuerySession {
  setRows(ids: readonly string[]): void
  setColumn(request: CellQueryColumnRequest): Promise<CellQueryColumnSummary>
  deleteColumn(columnId: string): void
  run(
    conditions: readonly CellQueryCondition[],
    sort: CellQuerySort | null,
  ): Promise<CellQueryResult>
  values(rows: Uint32Array, columnIds: readonly string[]): Promise<CellQueryValues>
  dispose(): void
}

export interface CellQueryWorkerLike {
  onmessage: ((event: MessageEvent<CellQueryWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: CellQueryWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export type CellQueryWorkerFactory = () => CellQueryWorkerLike

type PendingRequest =
  | {
      readonly type: 'column'
      readonly request: CellQueryColumnRequest
      readonly resolve: (summary: CellQueryColumnSummary) => void
      readonly reject: (error: Error) => void
    }
  | {
      readonly type: 'run'
      readonly conditions: readonly CellQueryCondition[]
      readonly sort: CellQuerySort | null
      readonly resolve: (result: CellQueryResult) => void
      readonly reject: (error: Error) => void
    }
  | {
      readonly type: 'values'
      readonly rows: Uint32Array
      readonly columnIds: readonly string[]
      readonly resolve: (values: CellQueryValues) => void
      readonly reject: (error: Error) => void
    }

export function createCellQuerySession(
  workerFactory: CellQueryWorkerFactory | null = typeof Worker === 'undefined'
    ? null
    : createDefaultCellQueryWorker,
): CellQuerySession {
  let worker = workerFactory === null ? null : startWorker(workerFactory)
  let store = worker === null ? new CellQueryStore() : null
  let disposed = false
  let nextId = 0
  const pending = new Map<number, PendingRequest>()
  // What the store needs again if the worker fails.
  let rows: readonly string[] | null = null
  const columns = new Map<string, CellQueryColumnRequest>()

  function startWorker(factory: CellQueryWorkerFactory): CellQueryWorkerLike | null {
    try {
      const started = factory()
      started.onmessage = (event) => {
        handleResponse(event.data)
      }
      started.onerror = (event) => {
        event.preventDefault()
        fallBackToThisThread()
      }
      return started
    } catch {
      return null
    }
  }

  function handleResponse(response: CellQueryWorkerResponse): void {
    const request = pending.get(response.id)
    if (request === undefined) return
    pending.delete(response.id)

    if (response.type === 'error') {
      request.reject(new Error(response.error))
    } else if (response.type === 'summary' && request.type === 'column') {
      request.resolve(response.summary)
    } else if (response.type === 'result' && request.type === 'run') {
      request.resolve(response.result)
    } else if (response.type === 'values' && request.type === 'values') {
      request.resolve(response.values)
    }
  }

  function fallBackToThisThread(): void {
    if (worker === null || disposed) return
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    worker = null
    const local = new CellQueryStore()
    store = local
    if (rows !== null) local.setRows(rows)
    for (const column of columns.values()) {
      try {
        applyColumnRequest(local, column)
      } catch {
        // The column's own request reports the error.
      }
    }

    const requests = [...pending.values()]
    pending.clear()
    for (const request of requests) runOnThisThread(local, request)
  }

  function runOnThisThread(local: CellQueryStore, request: PendingRequest): void {
    try {
      switch (request.type) {
        case 'column':
          request.resolve(applyColumnRequest(local, request.request))
          return
        case 'run':
          request.resolve(local.run(request.conditions, request.sort))
          return
        case 'values':
          request.resolve(local.values(request.rows, request.columnIds))
      }
    } catch (cause) {
      request.reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  function send(request: PendingRequest): void {
    if (disposed) {
      request.reject(new DOMException('Cell query closed', 'AbortError'))
      return
    }

    if (worker === null) {
      runOnThisThread(store ?? new CellQueryStore(), request)
      return
    }

    const id = nextId
    nextId += 1
    pending.set(id, request)

    switch (request.type) {
      case 'column':
        worker.postMessage({ ...request.request, id })
        return
      case 'run':
        worker.postMessage({
          type: 'run',
          id,
          conditions: request.conditions,
          sort: request.sort,
        })
        return
      case 'values':
        worker.postMessage({
          type: 'values',
          id,
          rows: request.rows,
          columnIds: request.columnIds,
        })
    }
  }

  return {
    setRows(ids) {
      rows = ids
      columns.clear()
      if (worker === null) store?.setRows(ids)
      else worker.postMessage({ type: 'rows', ids })
    },
    setColumn(request) {
      columns.set(request.columnId, request)
      return new Promise((resolve, reject) => {
        send({ type: 'column', request, resolve, reject })
      })
    },
    deleteColumn(columnId) {
      columns.delete(columnId)
      if (disposed) return
      if (worker === null) store?.deleteColumn(columnId)
      else worker.postMessage({ type: 'delete-column', columnId })
    },
    run(conditions, sort) {
      return new Promise((resolve, reject) => {
        send({ type: 'run', conditions, sort, resolve, reject })
      })
    },
    values(rowsToRead, columnIds) {
      return new Promise((resolve, reject) => {
        send({ type: 'values', rows: rowsToRead, columnIds, resolve, reject })
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (worker !== null) {
        worker.onmessage = null
        worker.onerror = null
        worker.terminate()
        worker = null
      }
      store = null
      columns.clear()
      for (const request of pending.values()) {
        request.reject(new DOMException('Cell query closed', 'AbortError'))
      }
      pending.clear()
    },
  }
}

function createDefaultCellQueryWorker(): CellQueryWorkerLike {
  return new Worker(new URL('../../workers/cellQuery.worker.ts', import.meta.url), {
    type: 'module',
  })
}
