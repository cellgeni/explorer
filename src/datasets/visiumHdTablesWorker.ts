import { runWorkerOnce, type OneShotWorker } from '../workers/runWorkerOnce'
import type {
  VisiumHdTablesWorkerRequest,
  VisiumHdTablesWorkerResponse,
} from '../workers/visiumHdTablesMessages'
import type {
  VisiumHdBarcodeMapping,
  VisiumHdBarcodeMappingRangesReader,
} from './visiumHdBarcodeMappings'
import type {
  ReadVisiumHdFilteredMatrixBarcodesOptions,
  VisiumHdSquareBarcodeColumns,
} from './visiumHdBarcodes'
import type { VisiumHdBinDescriptor } from './visiumHdDataset'
import type {
  ReadVisiumHdTissuePositionsOptions,
  VisiumHdTissuePositions,
} from './visiumHdOverview'

// Reads Visium HD's large tables in a worker of its own (O16): a tier's
// tissue positions (234k rows at 8 µm), the bins' rows of
// barcode_mappings.parquet, and the 2 µm tier's 3.7M filtered barcodes. The
// worker fetches the file and decodes it, and exits once it has answered; an
// abort terminates it.

export type VisiumHdTablesWorkerLike = OneShotWorker<
  VisiumHdTablesWorkerRequest,
  VisiumHdTablesWorkerResponse
>

export type VisiumHdTablesWorkerFactory = () => VisiumHdTablesWorkerLike

export interface VisiumHdTablesReaders {
  readonly tissuePositions: (
    options: ReadVisiumHdTissuePositionsOptions,
  ) => Promise<VisiumHdTissuePositions>
  readonly barcodeMappingRanges: VisiumHdBarcodeMappingRangesReader
  readonly filteredMatrixBarcodes: (
    baseUrl: string,
    bin: VisiumHdBinDescriptor,
    options: ReadVisiumHdFilteredMatrixBarcodesOptions,
  ) => Promise<VisiumHdSquareBarcodeColumns>
}

// Reads on this thread where there is no Worker (Vitest's jsdom), when the
// read needs something from this thread (a fetcher, file, row reader,
// compressors or byte-range cache), and when the worker fails to run.
export function visiumHdTablesWorkerReaders(
  workerFactory: VisiumHdTablesWorkerFactory | null = typeof Worker === 'undefined'
    ? null
    : createDefaultVisiumHdTablesWorker,
): VisiumHdTablesReaders {
  return {
    tissuePositions: async (options) => {
      const readHere = async () => {
        const { readVisiumHdTissuePositions } = await import('./visiumHdOverview')
        return readVisiumHdTissuePositions(options)
      }

      if (
        workerFactory === null ||
        options.url === undefined ||
        options.file !== undefined ||
        options.fetcher !== undefined ||
        options.compressors !== undefined ||
        options.loadCompressors !== undefined ||
        options.readObjects !== undefined ||
        options.byteRangeCache !== undefined
      ) {
        return readHere()
      }

      return readInWorker<VisiumHdTissuePositions>(
        workerFactory(),
        {
          type: 'positions',
          url: options.url,
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        },
        options.signal,
        readHere,
        (response) => (response.type === 'positions' ? response.positions : undefined),
      )
    },
    barcodeMappingRanges: (request, signal) => {
      const readHere = async () => {
        const { readVisiumHdBarcodeMappingRangesFromSource } =
          await import('./visiumHdBarcodeMappings')
        return readVisiumHdBarcodeMappingRangesFromSource(request)
      }

      return workerFactory === null
        ? readHere()
        : readInWorker<readonly VisiumHdBarcodeMapping[]>(
            workerFactory(),
            { type: 'mapping-ranges', request },
            signal,
            readHere,
            (response) => (response.type === 'mappings' ? response.mappings : undefined),
          )
    },
    filteredMatrixBarcodes: async (baseUrl, bin, options) => {
      const readHere = async () => {
        const { readVisiumHdFilteredMatrixBarcodes } = await import('./visiumHdBarcodes')
        return readVisiumHdFilteredMatrixBarcodes(baseUrl, bin, options)
      }

      if (workerFactory === null || options.fetcher !== undefined) {
        return readHere()
      }

      return readInWorker<VisiumHdSquareBarcodeColumns>(
        workerFactory(),
        {
          type: 'filtered-barcodes',
          baseUrl,
          bin,
          ...(options.maxBarcodeCount === undefined
            ? {}
            : { maxBarcodeCount: options.maxBarcodeCount }),
        },
        options.signal,
        readHere,
        (response) =>
          response.type === 'filtered-barcodes' ? response.barcodes : undefined,
      )
    },
  }
}

export const visiumHdTablesInWorker = visiumHdTablesWorkerReaders()

function readInWorker<Result>(
  worker: VisiumHdTablesWorkerLike,
  request: VisiumHdTablesWorkerRequest,
  signal: AbortSignal | undefined,
  fallback: () => Promise<Result>,
  value: (response: VisiumHdTablesWorkerResponse) => Result | undefined,
): Promise<Result> {
  return runWorkerOnce(worker, request, {
    signal,
    fallback,
    errorName: 'VisiumHdTablesWorkerError',
    onMessage: (response) => {
      if (response.type === 'error') {
        return response
      }

      const result = value(response)

      return result === undefined
        ? { error: `Unexpected Visium HD tables worker response: ${response.type}.` }
        : { value: result }
    },
  })
}

function createDefaultVisiumHdTablesWorker(): VisiumHdTablesWorkerLike {
  return new Worker(new URL('../workers/visiumHdTables.worker.ts', import.meta.url), {
    type: 'module',
  })
}
