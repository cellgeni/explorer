import {
  readCellsOverviewColumns,
  type CellsOverviewColumns,
} from '../data/hyparquetCells'
import type {
  CellsOverviewWorkerRequest,
  CellsOverviewWorkerResponse,
} from './cellsOverviewMessages'

export type CellsOverviewResponder = (
  response: CellsOverviewWorkerResponse,
  transfer: Transferable[],
) => void

export async function handleCellsOverviewRequest(
  request: CellsOverviewWorkerRequest,
  respond: CellsOverviewResponder,
): Promise<void> {
  try {
    const columns = await readCellsOverviewColumns({
      url: request.url,
      includeCellIds: request.includeCellIds,
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    })
    respond({ ok: true, columns }, cellsOverviewTransferables(columns))
  } catch (cause) {
    // The name is kept: the main thread falls back to DuckDB on a
    // `ParquetDecodeError`, and load errors are classified by name.
    respond(
      {
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
        ...(cause instanceof Error && cause.name.length > 0
          ? { errorName: cause.name }
          : {}),
      },
      [],
    )
  }
}

// Each typed array has a buffer of its own.
export function cellsOverviewTransferables(
  columns: CellsOverviewColumns,
): Transferable[] {
  return [
    columns.x,
    columns.y,
    columns.transcriptCounts,
    columns.cellAreas,
    columns.nucleusCounts,
    columns.segmentationMethodIndices,
  ].flatMap((values) => (values === null ? [] : [values.buffer]))
}
