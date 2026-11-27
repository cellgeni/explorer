import type { VisiumHdBarcodeMapping } from '../datasets/visiumHdBarcodeMappings'
import type { VisiumHdBarcodeMappingRangesRequest } from '../datasets/visiumHdBarcodeMappings'
import type { VisiumHdSquareBarcodeColumns } from '../datasets/visiumHdBarcodes'
import type { VisiumHdBinDescriptor } from '../datasets/visiumHdDataset'
import type { VisiumHdTissuePositions } from '../datasets/visiumHdOverview'

// A Visium HD tables worker reads one table and exits: a tier's tissue
// positions, the bins' rows of barcode_mappings.parquet, or the 2 µm tier's
// filtered barcodes. Arrays of numbers are transferred back.

export type VisiumHdTablesWorkerRequest =
  | { readonly type: 'positions'; readonly url: string; readonly limit?: number }
  | {
      readonly type: 'mapping-ranges'
      readonly request: VisiumHdBarcodeMappingRangesRequest
    }
  | {
      readonly type: 'filtered-barcodes'
      readonly baseUrl: string
      readonly bin: VisiumHdBinDescriptor
      readonly maxBarcodeCount?: number
    }

export type VisiumHdTablesWorkerResponse =
  | { readonly type: 'positions'; readonly positions: VisiumHdTissuePositions }
  | {
      readonly type: 'mappings'
      readonly mappings: readonly VisiumHdBarcodeMapping[]
    }
  | {
      readonly type: 'filtered-barcodes'
      readonly barcodes: VisiumHdSquareBarcodeColumns
    }
  | { readonly type: 'error'; readonly error: string; readonly errorName?: string }
