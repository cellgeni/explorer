import type { GeneValues, GeneValuesRowIds } from '../data/geneValues'
import type {
  PlotGroupsInput,
  PlotGroupsSummary,
  PlotStatsResult,
} from '../features/plots/plotStats'

// A plot worker holds one dataset's rows, the groups being plotted and the
// genes read (plan 22-D6). Messages are handled in order, so stats asked
// for after `groups` use those groups. Gene values are transferred.

export type PlotStatsWorkerRequest =
  | { readonly type: 'rows'; readonly rowIds: GeneValuesRowIds }
  | { readonly type: 'groups'; readonly id: number; readonly groups: PlotGroupsInput }
  | { readonly type: 'gene'; readonly values: GeneValues }
  | { readonly type: 'stats'; readonly id: number; readonly genes: readonly string[] }

export type PlotStatsWorkerResponse =
  | { readonly type: 'groups'; readonly id: number; readonly summary: PlotGroupsSummary }
  | { readonly type: 'stats'; readonly id: number; readonly result: PlotStatsResult }
  | { readonly type: 'error'; readonly id: number; readonly error: string }
