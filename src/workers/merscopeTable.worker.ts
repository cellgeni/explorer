/// <reference lib="webworker" />

import { merscopeTableHandler } from './merscopeTableCore'
import type { MerscopeTableWorkerRequest } from './merscopeTableMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handle = merscopeTableHandler((response, transfer) => {
  workerScope.postMessage(response, transfer)
})

workerScope.onmessage = (event: MessageEvent<MerscopeTableWorkerRequest>) => {
  void handle(event.data)
}
