/// <reference lib="webworker" />

import { zipEntryHandler } from './zipEntryCore'
import type { ZipEntryWorkerRequest } from './zipEntryMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handle = zipEntryHandler((response, transfer) => {
  workerScope.postMessage(response, transfer)
})

workerScope.onmessage = (event: MessageEvent<ZipEntryWorkerRequest>) => {
  void handle(event.data)
}
