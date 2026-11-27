import { readVisiumHdBarcodeMappingRangesFromSource } from '../datasets/visiumHdBarcodeMappings'
import { readVisiumHdFilteredMatrixBarcodes } from '../datasets/visiumHdBarcodes'
import { readVisiumHdTissuePositions } from '../datasets/visiumHdOverview'
import type {
  VisiumHdTablesWorkerRequest,
  VisiumHdTablesWorkerResponse,
} from './visiumHdTablesMessages'

export type VisiumHdTablesResponder = (
  response: VisiumHdTablesWorkerResponse,
  transfer: Transferable[],
) => void

// Handles a worker's one request: the table, or an error with its name.
export function visiumHdTablesHandler(
  respond: VisiumHdTablesResponder,
): (request: VisiumHdTablesWorkerRequest) => Promise<void> {
  return (request) =>
    readTable(request).then(
      ([response, transfer]) => {
        respond(response, transfer)
      },
      (cause: unknown) => {
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
      },
    )
}

async function readTable(
  request: VisiumHdTablesWorkerRequest,
): Promise<[VisiumHdTablesWorkerResponse, Transferable[]]> {
  switch (request.type) {
    case 'positions': {
      const positions = await readVisiumHdTissuePositions({
        url: request.url,
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      })

      return [
        { type: 'positions', positions },
        [
          positions.inTissue.buffer,
          positions.arrayRows.buffer,
          positions.arrayCols.buffer,
          positions.fullresRows.buffer,
          positions.fullresCols.buffer,
        ],
      ]
    }
    case 'mapping-ranges':
      return [
        {
          type: 'mappings',
          mappings: await readVisiumHdBarcodeMappingRangesFromSource(request.request),
        },
        [],
      ]
    case 'filtered-barcodes': {
      const barcodes = await readVisiumHdFilteredMatrixBarcodes(
        request.baseUrl,
        request.bin,
        request.maxBarcodeCount === undefined
          ? {}
          : { maxBarcodeCount: request.maxBarcodeCount },
      )

      return [
        { type: 'filtered-barcodes', barcodes },
        [barcodes.rows.buffer, barcodes.cols.buffer],
      ]
    }
  }
}
