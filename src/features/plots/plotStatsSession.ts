import type { GeneValues } from '../../data/geneValues'
import type {
  PlotStatsWorkerRequest,
  PlotStatsWorkerResponse,
} from '../../workers/plotStatsMessages'
import {
  PlotStatsStore,
  type PlotGroupsInput,
  type PlotGroupsSummary,
  type PlotStatsResult,
} from './plotStats'

// The Plots panel's link to its numbers (plan 22-D6): a worker of its own
// per dataset, so mapping a million cell IDs to rows and summing genes stay
// off the main thread. Without a Worker (Vitest's jsdom), or once the worker
// fails, the same store runs on this thread; it is given the rows and groups
// again, and genes it lacks come back as missing, to be read again.

export interface PlotStatsSession {
  setRows(rowIds: readonly string[]): void
  setGroups(groups: PlotGroupsInput): Promise<PlotGroupsSummary>
  // Hands the values' buffers over; they are empty here afterwards.
  addGene(values: GeneValues): void
  stats(genes: readonly string[]): Promise<PlotStatsResult>
  dispose(): void
}

export interface PlotStatsWorkerLike {
  onmessage: ((event: MessageEvent<PlotStatsWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: PlotStatsWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export type PlotStatsWorkerFactory = () => PlotStatsWorkerLike

type PendingRequest =
  | {
      readonly type: 'groups'
      readonly groups: PlotGroupsInput
      readonly resolve: (summary: PlotGroupsSummary) => void
      readonly reject: (error: Error) => void
    }
  | {
      readonly type: 'stats'
      readonly genes: readonly string[]
      readonly resolve: (result: PlotStatsResult) => void
      readonly reject: (error: Error) => void
    }

export function createPlotStatsSession(
  workerFactory: PlotStatsWorkerFactory | null = typeof Worker === 'undefined'
    ? null
    : createDefaultPlotStatsWorker,
): PlotStatsSession {
  let worker = workerFactory === null ? null : startWorker(workerFactory)
  let store = worker === null ? new PlotStatsStore() : null
  let disposed = false
  let nextId = 0
  const pending = new Map<number, PendingRequest>()
  // What the store needs again if the worker fails.
  let rows: readonly string[] | null = null
  let groups: PlotGroupsInput | null = null

  function startWorker(factory: PlotStatsWorkerFactory): PlotStatsWorkerLike | null {
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

  function handleResponse(response: PlotStatsWorkerResponse): void {
    const request = pending.get(response.id)
    if (request === undefined) return
    pending.delete(response.id)

    if (response.type === 'error') {
      request.reject(new Error(response.error))
    } else if (response.type === 'groups' && request.type === 'groups') {
      request.resolve(response.summary)
    } else if (response.type === 'stats' && request.type === 'stats') {
      request.resolve(response.result)
    }
  }

  function fallBackToThisThread(): void {
    if (worker === null || disposed) return
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    worker = null
    const local = new PlotStatsStore()
    store = local
    if (rows !== null) local.setRows(rows)
    if (groups !== null) local.setGroups(groups)

    const requests = [...pending.values()]
    pending.clear()
    for (const request of requests) runOnThisThread(local, request)
  }

  function runOnThisThread(local: PlotStatsStore, request: PendingRequest): void {
    try {
      if (request.type === 'groups') request.resolve(local.setGroups(request.groups))
      else request.resolve(local.stats(request.genes))
    } catch (cause) {
      request.reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  function send(request: PendingRequest): void {
    if (disposed) {
      request.reject(new DOMException('Plot statistics closed', 'AbortError'))
      return
    }

    if (worker === null) {
      runOnThisThread(store ?? new PlotStatsStore(), request)
      return
    }

    const id = nextId
    nextId += 1
    pending.set(id, request)
    worker.postMessage(
      request.type === 'groups'
        ? { type: 'groups', id, groups: request.groups }
        : { type: 'stats', id, genes: request.genes },
    )
  }

  return {
    setRows(rowIds) {
      rows = rowIds
      groups = null
      if (worker === null) store?.setRows(rowIds)
      else worker.postMessage({ type: 'rows', rowIds })
    },
    setGroups(input) {
      groups = input
      return new Promise((resolve, reject) => {
        send({ type: 'groups', groups: input, resolve, reject })
      })
    },
    addGene(values) {
      if (disposed) return
      if (worker === null) {
        store?.addGene(values)
        return
      }
      worker.postMessage({ type: 'gene', values }, [
        values.rows.buffer,
        values.values.buffer,
      ])
    },
    stats(genes) {
      return new Promise((resolve, reject) => {
        send({ type: 'stats', genes, resolve, reject })
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
      for (const request of pending.values()) {
        request.reject(new DOMException('Plot statistics closed', 'AbortError'))
      }
      pending.clear()
    },
  }
}

function createDefaultPlotStatsWorker(): PlotStatsWorkerLike {
  return new Worker(new URL('../../workers/plotStats.worker.ts', import.meta.url), {
    type: 'module',
  })
}
