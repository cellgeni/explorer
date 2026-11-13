/// <reference lib="webworker" />

import { spatialDataShapesHandler } from './spatialDataShapesCore'
import type { SpatialDataShapesWorkerRequest } from './spatialDataShapesMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handle = spatialDataShapesHandler((response, transfer) => {
  workerScope.postMessage(response, transfer)
})

workerScope.onmessage = (event: MessageEvent<SpatialDataShapesWorkerRequest>) => {
  handle(event.data)
}
