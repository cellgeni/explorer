/// <reference lib="webworker" />

import { csvTablesHandler } from './csvTablesCore'
import type { CsvTablesWorkerRequest } from './csvTablesMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handle = csvTablesHandler((response, transfer) => {
  workerScope.postMessage(response, transfer)
})

workerScope.onmessage = (event: MessageEvent<CsvTablesWorkerRequest>) => {
  handle(event.data)
}
