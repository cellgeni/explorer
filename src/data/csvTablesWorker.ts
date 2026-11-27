import { runWorkerOnce, type OneShotWorker } from '../workers/runWorkerOnce'
import type {
  CsvTablesWorkerRequest,
  CsvTablesWorkerResponse,
} from '../workers/csvTablesMessages'
import {
  parseAnalysisEmbeddingColumns,
  type AnalysisEmbeddingColumnsParser,
} from './analysisEmbeddings'
import {
  customAnnotationImportFromColumns,
  parseCustomAnnotationImport,
  type CustomAnnotationImport,
} from './customAnnotations'

// Parses large CSV files in a worker of its own (O18): an embedding's
// projection, and an annotation file imported or named by `annotationUrl=`.
// At a million rows each parse held the main thread for 0.3-0.7 s. The text
// is cloned to the worker, which sends columns back; the worker exits once it
// has answered.

export type CsvTablesWorkerLike = OneShotWorker<
  CsvTablesWorkerRequest,
  CsvTablesWorkerResponse
>

export type CsvTablesWorkerFactory = () => CsvTablesWorkerLike

export type CustomAnnotationImportParser = (
  text: string,
  fileName: string,
  idName: string,
) => Promise<CustomAnnotationImport>

export interface CsvTablesReaders {
  readonly embeddingColumns: AnalysisEmbeddingColumnsParser
  readonly annotationImport: CustomAnnotationImportParser
}

// Parses on this thread where there is no Worker (Vitest's jsdom) and when the
// worker fails to run.
export function csvTablesWorkerReaders(
  workerFactory: CsvTablesWorkerFactory | null = typeof Worker === 'undefined'
    ? null
    : createDefaultCsvTablesWorker,
): CsvTablesReaders {
  return {
    embeddingColumns: async (csv, kind, signal) => {
      const parseHere = async () => parseAnalysisEmbeddingColumns(csv, kind)

      return workerFactory === null
        ? parseHere()
        : runWorkerOnce(
            workerFactory(),
            { type: 'embedding', csv, kind },
            {
              signal,
              fallback: parseHere,
              errorName: 'CsvTablesWorkerError',
              onMessage: (response) =>
                response.type === 'embedding'
                  ? { value: response.columns }
                  : response.type === 'error'
                    ? response
                    : { error: 'The CSV worker answered with another table.' },
            },
          )
    },
    annotationImport: async (text, fileName, idName) => {
      const parseHere = async () => parseCustomAnnotationImport(text, fileName, idName)

      return workerFactory === null
        ? parseHere()
        : runWorkerOnce(
            workerFactory(),
            { type: 'annotations', text, fileName, idName },
            {
              fallback: parseHere,
              errorName: 'CsvTablesWorkerError',
              onMessage: (response) =>
                response.type === 'annotations'
                  ? { value: customAnnotationImportFromColumns(response.parsed) }
                  : response.type === 'error'
                    ? response
                    : { error: 'The CSV worker answered with another table.' },
            },
          )
    },
  }
}

export const csvTablesInWorker = csvTablesWorkerReaders()

function createDefaultCsvTablesWorker(): CsvTablesWorkerLike {
  return new Worker(new URL('../workers/csvTables.worker.ts', import.meta.url), {
    type: 'module',
  })
}
