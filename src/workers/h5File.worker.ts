/// <reference lib="webworker" />

import { createH5FileHandler } from './h5FileCore'
import type { H5FileWorkerRequest } from './h5FileMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handler = createH5FileHandler((response, transfer) => {
  workerScope.postMessage(response, transfer)
})

workerScope.onmessage = (event: MessageEvent<H5FileWorkerRequest>) => {
  void handler.handle(event.data)
}
