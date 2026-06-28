import {
  VisiumHdDatasetReaderController,
  type VisiumHdBarcodeMappingsReader,
  type VisiumHdFeatureGenePanelReader,
  type VisiumHdFeatureMatrixReader,
  type VisiumHdFeatureSliceReader,
  type VisiumHdFilteredMatrixBarcodeReader,
  type VisiumHdScalefactorsReader,
  type VisiumHdSegmentationReader,
  type VisiumHdTissuePositionsReader,
} from './visiumHdDatasetReaders'
import type { CellFeatureMatrixReadOptions, GexResult } from '../data/gex'
import type {
  ReadVisiumHdFilteredMatrixBarcodesOptions,
  VisiumHdSquareBarcode,
} from './visiumHdBarcodes'
import type {
  VisiumHdSegmentedOutputPaths,
  VisiumHdSegmentationKind,
} from './visiumHdSegmentationModel'
import type {
  VisiumHdBarcodeMapping,
  VisiumHdBarcodeMappingCellAssignment,
} from './visiumHdBarcodeMappings'
import type { Compressors } from 'hyparquet'
import type { BBox } from '../data/coords'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
  SpatialElement,
  SpatialElementId,
} from './spatialDataset'
import type {
  ReadVisiumHdFeatureGenePanelOptions,
  VisiumHdBinnedOverview,
  VisiumHdParquetObjectReader,
} from './visiumHdOverview'
import type { GeneExpressionBatch, GeneExpressionQueryOptions } from './xeniumDataset'

export { DEFAULT_VISIUM_HD_FEATURE_SLICE_BYTE_BUDGET } from './visiumHdDatasetReaders'

export type {
  CreateVisiumHdBinnedOverviewOptions,
  ReadVisiumHdBinnedOverviewOptions,
  ReadVisiumHdFeatureGenePanelOptions,
  ReadVisiumHdScalefactorsOptions,
  ReadVisiumHdTissuePositionsOptions,
  VisiumHdBinnedOverview,
  VisiumHdParquetObjectReader,
  VisiumHdParquetReadObjectsOptions,
  VisiumHdScalefactors,
  VisiumHdTissuePositions,
} from './visiumHdOverview'

export type VisiumHdBinSizeMicrometers = 2 | 8 | 16

export interface VisiumHdBinDescriptor {
  readonly binSizeMicrometers: VisiumHdBinSizeMicrometers
  readonly outputPath: string
  readonly tissuePositionsPath: string
  readonly scalefactorsPath: string
  readonly filteredMatrixH5Path: string
}

export interface VisiumHdDatasetOptions {
  readonly baseUrl: string
  readonly bins: readonly VisiumHdBinDescriptor[]
  readonly defaultBinSizeMicrometers?: VisiumHdBinSizeMicrometers
  readonly fetcher?: typeof fetch
  readonly tissuePositionsReader?: VisiumHdTissuePositionsReader
  readonly scalefactorsReader?: VisiumHdScalefactorsReader
  readonly featureGenePanelReader?: VisiumHdFeatureGenePanelReader
  readonly filteredMatrixBarcodeReader?: VisiumHdFilteredMatrixBarcodeReader
  readonly barcodeMappingsReader?: VisiumHdBarcodeMappingsReader
  readonly barcodeMappingsForCellReader?: VisiumHdBarcodeMappingsForCellReader
  readonly segmentedOutputs?: VisiumHdSegmentedOutputPaths
  readonly segmentationReader?: VisiumHdSegmentationReader
  readonly featureMatrixReader?: VisiumHdFeatureMatrixReader
  readonly featureSliceH5Path?: string
  readonly featureSliceReader?: VisiumHdFeatureSliceReader
  readonly maxTwoMicrometerFilteredBarcodes?: number
  readonly maxInteractiveFeatureSliceBytes?: number
  readonly maxInteractiveSegmentationGeojsonBytes?: number
  readonly readObjects?: VisiumHdParquetObjectReader
  readonly loadCompressors?: () => Promise<Compressors>
  readonly byteRangeCache?: PersistentByteRangeCache | null
}

export interface VisiumHdGeneExpressionQueryOptions extends GeneExpressionQueryOptions {
  readonly binSizeMicrometers?: VisiumHdBinSizeMicrometers
}

export interface VisiumHdBarcodeMappingQueryOptions {
  readonly maxRows?: number
  readonly signal?: AbortSignal
}

export interface VisiumHdBarcodeMappingCellQueryOptions {
  readonly signal?: AbortSignal
}

export type VisiumHdBarcodeMappingsForCellReader = (
  baseUrl: string,
  cellId: SpatialElementId,
  options: VisiumHdBarcodeMappingCellQueryOptions,
) => Promise<readonly VisiumHdBarcodeMapping[]>

export class VisiumHdDataset implements SpatialDataset<SpatialElementId> {
  readonly baseUrl: string
  readonly bins: readonly VisiumHdBinDescriptor[]
  readonly maxTwoMicrometerFilteredBarcodes: number | undefined
  private readonly readers: VisiumHdDatasetReaderController

  constructor(options: VisiumHdDatasetOptions) {
    this.readers = new VisiumHdDatasetReaderController(options)
    this.baseUrl = this.readers.baseUrl
    this.bins = this.readers.bins
    this.maxTwoMicrometerFilteredBarcodes = this.readers.maxTwoMicrometerFilteredBarcodes
  }

  meta(binSizeMicrometers?: VisiumHdBinSizeMicrometers): Promise<DatasetMeta> {
    return this.readers.meta(binSizeMicrometers)
  }

  elements(bbox: BBox): Promise<ElementBatch<SpatialElementId>> {
    return this.readers.elements(bbox)
  }

  matrix(
    ids: readonly SpatialElementId[] = [],
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
    options: CellFeatureMatrixReadOptions = {},
  ): Promise<GexResult<SpatialElementId>> {
    return this.readers.matrix(ids, binSizeMicrometers, options)
  }

  genePanel(
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
    options: ReadVisiumHdFeatureGenePanelOptions = {},
  ): Promise<readonly string[]> {
    return this.readers.genePanel(binSizeMicrometers, options)
  }

  annotations(): Promise<readonly Annotation<SpatialElementId>[]> {
    return Promise.reject(visiumHdNotImplementedError('annotation loading'))
  }

  filteredMatrixBarcodes(
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
    options: ReadVisiumHdFilteredMatrixBarcodesOptions = {},
  ): Promise<readonly VisiumHdSquareBarcode[]> {
    return this.readers.filteredMatrixBarcodes(binSizeMicrometers, options)
  }

  barcodeMappings(
    options: VisiumHdBarcodeMappingQueryOptions,
  ): Promise<readonly VisiumHdBarcodeMapping[]> {
    return this.readers.barcodeMappings(options)
  }

  barcodeMappingsForCell(
    cellId: SpatialElementId,
    options: VisiumHdBarcodeMappingCellQueryOptions = {},
  ): Promise<readonly VisiumHdBarcodeMapping[]> {
    return this.readers.barcodeMappingsForCell(cellId, options)
  }

  barcodeMappingAssignments(
    binSizeMicrometers: VisiumHdBinSizeMicrometers,
    binIds: readonly SpatialElementId[],
    options: VisiumHdBarcodeMappingQueryOptions,
  ): Promise<readonly VisiumHdBarcodeMappingCellAssignment[]> {
    return this.readers.barcodeMappingAssignments(binSizeMicrometers, binIds, options)
  }

  segmentationElements(
    kind: VisiumHdSegmentationKind,
    bbox: BBox,
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
  ): Promise<readonly SpatialElement[]> {
    return this.readers.segmentationElements(kind, bbox, binSizeMicrometers)
  }

  image(binSizeMicrometers?: VisiumHdBinSizeMicrometers): Promise<ImageSource | null> {
    return this.readers.image(binSizeMicrometers)
  }

  transcripts(): Promise<GexResult<SpatialElementId>> {
    return Promise.reject(
      new Error('Visium HD output does not provide Xenium-style transcript records.'),
    )
  }

  geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: VisiumHdGeneExpressionQueryOptions = {},
  ): Promise<GeneExpressionBatch> {
    return this.readers.geneExpression(bbox, genes, options)
  }

  readBinnedOverview(
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
  ): Promise<VisiumHdBinnedOverview> {
    return this.readers.readBinnedOverview(binSizeMicrometers)
  }
}

function visiumHdNotImplementedError(capability: string): Error {
  return new Error(`Visium HD ${capability} is not implemented yet.`)
}
