/// <reference lib="webworker" />

import { featureBarcodeMexHandler } from './featureBarcodeMexCore'
import type { FeatureBarcodeMexWorkerRequest } from './featureBarcodeMexMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handle = featureBarcodeMexHandler((response, transfer) => {
  workerScope.postMessage(response, transfer)
})

workerScope.onmessage = (event: MessageEvent<FeatureBarcodeMexWorkerRequest>) => {
  void handle(event.data)
}
