/// <reference lib="webworker" />

import { cellQueryHandler } from './cellQueryCore'
import type { CellQueryWorkerRequest } from './cellQueryMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handle = cellQueryHandler((response, transfer = []) => {
  workerScope.postMessage(response, transfer)
})

workerScope.onmessage = (event: MessageEvent<CellQueryWorkerRequest>) => {
  handle(event.data)
}
