import type {
  AnalysisEmbeddingColumns,
  AnalysisEmbeddingKind,
} from '../data/analysisEmbeddings'
import type { CustomAnnotationImportColumns } from '../data/customAnnotations'

// A CSV tables worker parses one CSV and exits: an embedding's projection or
// an imported annotation file. Number columns are transferred back.

export type CsvTablesWorkerRequest =
  | {
      readonly type: 'embedding'
      readonly csv: string
      readonly kind: AnalysisEmbeddingKind
    }
  | {
      readonly type: 'annotations'
      readonly text: string
      readonly fileName: string
      readonly idName: string
    }

export type CsvTablesWorkerResponse =
  | { readonly type: 'embedding'; readonly columns: AnalysisEmbeddingColumns }
  | { readonly type: 'annotations'; readonly parsed: CustomAnnotationImportColumns }
  | { readonly type: 'error'; readonly error: string; readonly errorName?: string }
