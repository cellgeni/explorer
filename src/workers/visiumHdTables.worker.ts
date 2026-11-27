/// <reference lib="webworker" />

import { visiumHdTablesHandler } from './visiumHdTablesCore'
import type { VisiumHdTablesWorkerRequest } from './visiumHdTablesMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handle = visiumHdTablesHandler((response, transfer) => {
  workerScope.postMessage(response, transfer)
})

workerScope.onmessage = (event: MessageEvent<VisiumHdTablesWorkerRequest>) => {
  void handle(event.data)
}
