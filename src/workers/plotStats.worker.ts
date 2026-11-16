/// <reference lib="webworker" />

import { plotStatsHandler } from './plotStatsCore'
import type { PlotStatsWorkerRequest } from './plotStatsMessages'

const workerScope = self as DedicatedWorkerGlobalScope
const handle = plotStatsHandler((response) => {
  workerScope.postMessage(response)
})

workerScope.onmessage = (event: MessageEvent<PlotStatsWorkerRequest>) => {
  handle(event.data)
}
