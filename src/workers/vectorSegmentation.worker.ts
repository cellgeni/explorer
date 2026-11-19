/// <reference lib="webworker" />

import { vectorSegmentationHandler } from './vectorSegmentationCore'
import type { VectorSegmentationWorkerRequest } from './vectorSegmentationMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handle = vectorSegmentationHandler((response, transfer) => {
  workerScope.postMessage(response, transfer)
})

workerScope.onmessage = (event: MessageEvent<VectorSegmentationWorkerRequest>) => {
  handle(event.data)
}
