import type { MerscopeTable } from '../datasets/merscopeFormat'
import type { MerscopeTableFiles } from '../datasets/merscopeTableReader'

// A MERSCOPE table worker reads one region's cell_by_gene.csv and
// cell_metadata.csv and exits: it fetches both, parses them into columns,
// joins them, and sends the table back with its arrays transferred.

export interface MerscopeTableWorkerRequest {
  readonly type: 'read'
  readonly files: MerscopeTableFiles
}

export type MerscopeTableWorkerResponse =
  | { readonly type: 'progress'; readonly message: string }
  | { readonly type: 'table'; readonly table: MerscopeTable }
  | { readonly type: 'error'; readonly error: string; readonly errorName?: string }
