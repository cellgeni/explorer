/// <reference lib="webworker" />

import { handleCellsOverviewRequest } from './cellsOverviewCore'
import type { CellsOverviewWorkerRequest } from './cellsOverviewMessages'

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<CellsOverviewWorkerRequest>) => {
  void handleCellsOverviewRequest(event.data, (response, transfer) => {
    workerScope.postMessage(response, transfer)
  })
}
