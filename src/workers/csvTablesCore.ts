import { parseAnalysisEmbeddingColumns } from '../data/analysisEmbeddings'
import {
  customAnnotationImportToColumns,
  parseCustomAnnotationImport,
} from '../data/customAnnotations'
import type { CsvTablesWorkerRequest, CsvTablesWorkerResponse } from './csvTablesMessages'

export type CsvTablesResponder = (
  response: CsvTablesWorkerResponse,
  transfer: Transferable[],
) => void

// Handles a worker's one request: the parsed table, or an error with its
// name.
export function csvTablesHandler(
  respond: CsvTablesResponder,
): (request: CsvTablesWorkerRequest) => void {
  return (request) => {
    try {
      if (request.type === 'embedding') {
        const columns = parseAnalysisEmbeddingColumns(request.csv, request.kind)
        respond({ type: 'embedding', columns }, [columns.x.buffer, columns.y.buffer])
        return
      }

      const parsed = customAnnotationImportToColumns(
        parseCustomAnnotationImport(request.text, request.fileName, request.idName),
      )
      respond(
        { type: 'annotations', parsed },
        parsed.metadataTracks.flatMap((track) =>
          track.values === null ? [] : [track.values.values.buffer],
        ),
      )
    } catch (cause) {
      respond(
        {
          type: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
          ...(cause instanceof Error && cause.name.length > 0
            ? { errorName: cause.name }
            : {}),
        },
        [],
      )
    }
  }
}
