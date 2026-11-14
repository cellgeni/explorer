/// <reference lib="webworker" />

import { visiumHdSegmentationIndexHandler } from './visiumHdSegmentationIndexCore'
import type { VisiumHdSegmentationIndexWorkerRequest } from './visiumHdSegmentationIndexMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handle = visiumHdSegmentationIndexHandler((response, transfer) => {
  workerScope.postMessage(response, transfer)
})

workerScope.onmessage = (event: MessageEvent<VisiumHdSegmentationIndexWorkerRequest>) => {
  handle(event.data)
}
