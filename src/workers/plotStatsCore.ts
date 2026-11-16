import { PlotStatsStore } from '../features/plots/plotStats'
import type { PlotStatsWorkerRequest, PlotStatsWorkerResponse } from './plotStatsMessages'

// Handles one plot worker's messages against a store of its own.
export function plotStatsHandler(
  respond: (response: PlotStatsWorkerResponse) => void,
  store = new PlotStatsStore(),
): (request: PlotStatsWorkerRequest) => void {
  return (request) => {
    switch (request.type) {
      case 'rows':
        store.setRows(request.rowIds)
        return
      case 'gene':
        store.addGene(request.values)
        return
      case 'groups':
      case 'stats':
        try {
          respond(
            request.type === 'groups'
              ? {
                  type: 'groups',
                  id: request.id,
                  summary: store.setGroups(request.groups),
                }
              : { type: 'stats', id: request.id, result: store.stats(request.genes) },
          )
        } catch (cause) {
          respond({
            type: 'error',
            id: request.id,
            error: cause instanceof Error ? cause.message : String(cause),
          })
        }
    }
  }
}
