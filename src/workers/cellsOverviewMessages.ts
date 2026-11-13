import type { CellsOverviewColumns } from '../data/hyparquetCells'

// A cells overview worker reads one cells.parquet overview and exits: it
// fetches and decodes the columns with hyparquet and sends them back as
// `CellsOverviewColumns`.

export interface CellsOverviewWorkerRequest {
  readonly url: string
  readonly includeCellIds: boolean
  readonly limit?: number
}

export type CellsOverviewWorkerResponse =
  | { readonly ok: true; readonly columns: CellsOverviewColumns }
  | { readonly ok: false; readonly error: string; readonly errorName?: string }
