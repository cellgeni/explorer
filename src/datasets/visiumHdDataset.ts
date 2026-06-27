import { datasetFileUrl } from '../data/datasetFiles'
import type { CellFeatureMatrixReadOptions, GexCell, GexResult } from '../data/gex'
import type {
  VisiumFeatureSliceReadOptions,
  VisiumFeatureSliceTarget,
} from '../data/visiumFeatureSlice'
import type {
  ReadVisiumHdFilteredMatrixBarcodesOptions,
  VisiumHdSquareBarcode,
} from './visiumHdBarcodes'
import {
  filterVisiumHdSegmentationElementsByBbox,
  visiumHdSegmentationInfos,
  type VisiumHdSegmentedOutputPaths,
  type VisiumHdSegmentationKind,
} from './visiumHdSegmentationModel'
import type { ReadVisiumHdSegmentationElementsOptions } from './visiumHdSegmentations'
import {
  type ReadVisiumHdBarcodeMappingsOptions,
  type VisiumHdBarcodeMapping,
  type VisiumHdBarcodeMappingCellAssignment,
} from './visiumHdBarcodeMappings'
import {
  VisiumHdTwoMicrometerOverviewDisabledError,
  normalizeVisiumHdBarcodeMappingRowBudget,
  normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget,
} from './visiumHdStrategy'
import { micrometers } from '../data/coords'
import {
  deriveNestedGridBasis,
  deriveSubdividedGridBasis,
  gridCellCenter,
} from './spatialGrid'
import type { Compressors } from 'hyparquet'
import type { BBox, DataPoint, UnitsDescriptor } from '../data/coords'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  GridCellBatch,
  ImageSource,
  SpatialDataset,
  SpatialElement,
  SpatialElementId,
} from './spatialDataset'
import type {
  ReadVisiumHdBinnedOverviewOptions,
  ReadVisiumHdFeatureGenePanelOptions,
  ReadVisiumHdScalefactorsOptions,
  ReadVisiumHdTissuePositionsOptions,
  VisiumHdBinnedOverview,
  VisiumHdParquetObjectReader,
  VisiumHdScalefactors,
  VisiumHdTissuePositions,
} from './visiumHdOverview'
import type {
  GeneExpressionBatch,
  GeneExpressionGeneCount,
  GeneExpressionQueryOptions,
} from './xeniumDataset'

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
  readonly tissuePositionsReader?: (
    options: ReadVisiumHdTissuePositionsOptions,
  ) => Promise<VisiumHdTissuePositions>
  readonly scalefactorsReader?: (
    url: string,
    options: ReadVisiumHdScalefactorsOptions,
  ) => Promise<VisiumHdScalefactors>
  readonly featureGenePanelReader?: (
    baseUrl: string,
    bin: VisiumHdBinDescriptor,
    options: ReadVisiumHdFeatureGenePanelOptions,
  ) => Promise<readonly string[]>
  readonly filteredMatrixBarcodeReader?: (
    baseUrl: string,
    bin: VisiumHdBinDescriptor,
    options: ReadVisiumHdFilteredMatrixBarcodesOptions,
  ) => Promise<readonly VisiumHdSquareBarcode[]>
  readonly barcodeMappingsReader?: (
    baseUrl: string,
    options: ReadVisiumHdBarcodeMappingsOptions,
  ) => Promise<readonly VisiumHdBarcodeMapping[]>
  readonly barcodeMappingsForCellReader?: VisiumHdBarcodeMappingsForCellReader
  readonly segmentedOutputs?: VisiumHdSegmentedOutputPaths
  readonly segmentationReader?: (
    baseUrl: string,
    options: ReadVisiumHdSegmentationElementsOptions,
  ) => Promise<readonly SpatialElement[]>
  readonly featureMatrixReader?: (
    url: string,
    ids: readonly SpatialElementId[],
    options?: CellFeatureMatrixReadOptions,
  ) => Promise<GexResult<SpatialElementId>>
  readonly featureSliceH5Path?: string
  readonly featureSliceReader?: (
    url: string,
    targets: readonly VisiumFeatureSliceTarget<SpatialElementId>[],
    genes: readonly string[],
    options: VisiumFeatureSliceReadOptions,
  ) => Promise<GexResult<SpatialElementId>>
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

export const DEFAULT_VISIUM_HD_FEATURE_SLICE_BYTE_BUDGET = 128 * 1024 * 1024

const readVisiumHdTissuePositionsLazy = async (
  options: ReadVisiumHdTissuePositionsOptions,
): Promise<VisiumHdTissuePositions> => {
  const { readVisiumHdTissuePositions } = await import('./visiumHdOverview')
  return readVisiumHdTissuePositions(options)
}

const readVisiumHdScalefactorsLazy = async (
  url: string,
  options: ReadVisiumHdScalefactorsOptions,
): Promise<VisiumHdScalefactors> => {
  const { readVisiumHdScalefactors } = await import('./visiumHdOverview')
  return readVisiumHdScalefactors(url, options)
}

const readVisiumHdFeatureGenePanelLazy = async (
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  options: ReadVisiumHdFeatureGenePanelOptions,
): Promise<readonly string[]> => {
  const { readVisiumHdFeatureGenePanel } = await import('./visiumHdOverview')
  return readVisiumHdFeatureGenePanel(baseUrl, bin, options)
}

const readVisiumHdBinnedOverviewLazy = async (
  options: ReadVisiumHdBinnedOverviewOptions,
): Promise<VisiumHdBinnedOverview> => {
  const { readVisiumHdBinnedOverview } = await import('./visiumHdOverview')
  return readVisiumHdBinnedOverview(options)
}

const readVisiumHdFilteredMatrixBarcodesLazy = async (
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  options: ReadVisiumHdFilteredMatrixBarcodesOptions,
): Promise<readonly VisiumHdSquareBarcode[]> => {
  const { readVisiumHdFilteredMatrixBarcodes } = await import('./visiumHdBarcodes')
  return readVisiumHdFilteredMatrixBarcodes(baseUrl, bin, options)
}

const readVisiumHdBarcodeMappingsLazy = async (
  baseUrl: string,
  options: ReadVisiumHdBarcodeMappingsOptions,
): Promise<readonly VisiumHdBarcodeMapping[]> => {
  const { readVisiumHdBarcodeMappings } = await import('./visiumHdBarcodeMappings')
  return readVisiumHdBarcodeMappings(baseUrl, options)
}

const readVisiumHdBarcodeMappingsForCellWithDuckDb: VisiumHdBarcodeMappingsForCellReader =
  async (baseUrl, cellId, options) => {
    const { readVisiumHdBarcodeMappingsForCellWithDuckDb: readWithDuckDb } =
      await import('./visiumHdBarcodeMappingDuckDb')

    return readWithDuckDb(baseUrl, cellId, options)
  }

const readVisiumHdSegmentationElementsLazy = async (
  baseUrl: string,
  options: ReadVisiumHdSegmentationElementsOptions,
): Promise<readonly SpatialElement[]> => {
  const { readVisiumHdSegmentationElements } = await import('./visiumHdSegmentations')
  return readVisiumHdSegmentationElements(baseUrl, options)
}

const gexFromFeatureBarcodeMatrixH5LazyRangeWorkerLazy = async (
  url: string,
  ids: readonly SpatialElementId[],
  options?: CellFeatureMatrixReadOptions,
): Promise<GexResult<SpatialElementId>> => {
  const { gexFromFeatureBarcodeMatrixH5LazyRangeWorker } = await import('../data/gex')
  return gexFromFeatureBarcodeMatrixH5LazyRangeWorker(url, ids, options)
}

const gexFromVisiumFeatureSliceH5Lazy = async (
  url: string,
  targets: readonly VisiumFeatureSliceTarget<SpatialElementId>[],
  genes: readonly string[],
  options: VisiumFeatureSliceReadOptions,
): Promise<GexResult<SpatialElementId>> => {
  const { gexFromVisiumFeatureSliceH5 } = await import('../data/visiumFeatureSlice')
  return gexFromVisiumFeatureSliceH5(url, targets, genes, options)
}

export class VisiumHdDataset implements SpatialDataset<SpatialElementId> {
  readonly baseUrl: string
  readonly bins: readonly VisiumHdBinDescriptor[]
  readonly maxTwoMicrometerFilteredBarcodes: number | undefined
  private readonly defaultBinSizeMicrometers: VisiumHdBinSizeMicrometers
  private readonly fetcher: typeof fetch
  private readonly tissuePositionsReader: (
    options: ReadVisiumHdTissuePositionsOptions,
  ) => Promise<VisiumHdTissuePositions>
  private readonly scalefactorsReader: (
    url: string,
    options: ReadVisiumHdScalefactorsOptions,
  ) => Promise<VisiumHdScalefactors>
  private readonly featureGenePanelReader: (
    baseUrl: string,
    bin: VisiumHdBinDescriptor,
    options: ReadVisiumHdFeatureGenePanelOptions,
  ) => Promise<readonly string[]>
  private readonly filteredMatrixBarcodeReader: (
    baseUrl: string,
    bin: VisiumHdBinDescriptor,
    options: ReadVisiumHdFilteredMatrixBarcodesOptions,
  ) => Promise<readonly VisiumHdSquareBarcode[]>
  private readonly barcodeMappingsReader: (
    baseUrl: string,
    options: ReadVisiumHdBarcodeMappingsOptions,
  ) => Promise<readonly VisiumHdBarcodeMapping[]>
  private readonly barcodeMappingsForCellReader: VisiumHdBarcodeMappingsForCellReader
  private readonly segmentedOutputs: VisiumHdSegmentedOutputPaths | undefined
  private readonly segmentationReader: (
    baseUrl: string,
    options: ReadVisiumHdSegmentationElementsOptions,
  ) => Promise<readonly SpatialElement[]>
  private readonly featureMatrixReader: (
    url: string,
    ids: readonly SpatialElementId[],
    options?: CellFeatureMatrixReadOptions,
  ) => Promise<GexResult<SpatialElementId>>
  private readonly featureSliceH5Path: string
  private readonly featureSliceReader: (
    url: string,
    targets: readonly VisiumFeatureSliceTarget<SpatialElementId>[],
    genes: readonly string[],
    options: VisiumFeatureSliceReadOptions,
  ) => Promise<GexResult<SpatialElementId>>
  private readonly maxInteractiveFeatureSliceBytes: number
  private readonly maxInteractiveSegmentationGeojsonBytes: number | undefined
  private readonly readObjects: VisiumHdParquetObjectReader | undefined
  private readonly loadCompressors: (() => Promise<Compressors>) | undefined
  private readonly byteRangeCache: PersistentByteRangeCache | null | undefined
  private readonly overviewPromises = new Map<
    VisiumHdBinSizeMicrometers,
    Promise<VisiumHdBinnedOverview>
  >()
  private readonly genePanelPromises = new Map<
    VisiumHdBinSizeMicrometers,
    Promise<readonly string[]>
  >()
  private readonly filteredMatrixBarcodePromises = new Map<
    VisiumHdBinSizeMicrometers,
    Promise<readonly VisiumHdSquareBarcode[]>
  >()
  private readonly barcodeMappingPromises = new Map<
    number,
    Promise<readonly VisiumHdBarcodeMapping[]>
  >()
  private readonly barcodeMappingCellPromises = new Map<
    SpatialElementId,
    Promise<readonly VisiumHdBarcodeMapping[]>
  >()
  private readonly segmentationPromises = new Map<
    string,
    Promise<readonly SpatialElement[]>
  >()

  constructor(options: VisiumHdDatasetOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.bins = options.bins
    this.defaultBinSizeMicrometers =
      options.defaultBinSizeMicrometers ?? preferredDefaultBinSize(options.bins)
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.tissuePositionsReader =
      options.tissuePositionsReader ?? readVisiumHdTissuePositionsLazy
    this.scalefactorsReader = options.scalefactorsReader ?? readVisiumHdScalefactorsLazy
    this.featureGenePanelReader =
      options.featureGenePanelReader ?? readVisiumHdFeatureGenePanelLazy
    this.filteredMatrixBarcodeReader =
      options.filteredMatrixBarcodeReader ?? readVisiumHdFilteredMatrixBarcodesLazy
    this.barcodeMappingsReader =
      options.barcodeMappingsReader ?? readVisiumHdBarcodeMappingsLazy
    this.barcodeMappingsForCellReader =
      options.barcodeMappingsForCellReader ?? readVisiumHdBarcodeMappingsForCellWithDuckDb
    this.segmentedOutputs = options.segmentedOutputs
    this.segmentationReader =
      options.segmentationReader ?? readVisiumHdSegmentationElementsLazy
    this.featureMatrixReader =
      options.featureMatrixReader ?? gexFromFeatureBarcodeMatrixH5LazyRangeWorkerLazy
    this.featureSliceH5Path = options.featureSliceH5Path ?? 'feature_slice.h5'
    this.featureSliceReader = options.featureSliceReader ?? gexFromVisiumFeatureSliceH5Lazy
    this.maxTwoMicrometerFilteredBarcodes =
      normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget(
        options.maxTwoMicrometerFilteredBarcodes,
      )
    this.maxInteractiveFeatureSliceBytes =
      options.maxInteractiveFeatureSliceBytes ??
      DEFAULT_VISIUM_HD_FEATURE_SLICE_BYTE_BUDGET
    this.maxInteractiveSegmentationGeojsonBytes =
      options.maxInteractiveSegmentationGeojsonBytes
    this.readObjects = options.readObjects
    this.loadCompressors = options.loadCompressors
    this.byteRangeCache = options.byteRangeCache
  }

  async meta(binSizeMicrometers = this.defaultBinSizeMicrometers): Promise<DatasetMeta> {
    const overview = await this.readBinnedOverview(binSizeMicrometers)
    const segmentations = visiumHdSegmentationInfos(this.segmentedOutputs)

    return {
      platform: 'visium-hd',
      units: unitsFromScalefactors(overview.scalefactors),
      extent: overviewExtent(overview),
      capabilities: {
        transcripts: false,
        cellBoundaries: this.cellSegmentationPath() !== undefined,
        pyramidImage: false,
        multiChannel: false,
      },
      grids: [overview.grid],
      ...(segmentations.length === 0 ? {} : { segmentations }),
    }
  }

  async elements(bbox: BBox): Promise<ElementBatch<SpatialElementId>> {
    const overview = await this.readBinnedOverview()
    const selected = selectGridCellsInBbox(overview, bbox)
    const elements = await this.segmentationElementsWithScalefactors(
      'cell',
      bbox,
      overview.scalefactors,
    )

    return {
      elements,
      gridCells: [selected],
    }
  }

  matrix(
    ids: readonly SpatialElementId[] = [],
    binSizeMicrometers = this.defaultBinSizeMicrometers,
    options: CellFeatureMatrixReadOptions = {},
  ): Promise<GexResult<SpatialElementId>> {
    const bin = findBin(this.bins, binSizeMicrometers)

    return this.featureMatrixReader(
      datasetFileUrl(this.baseUrl, bin.filteredMatrixH5Path),
      ids,
      options,
    )
  }

  genePanel(
    binSizeMicrometers = this.defaultBinSizeMicrometers,
    options: ReadVisiumHdFeatureGenePanelOptions = {},
  ): Promise<readonly string[]> {
    const existing = this.genePanelPromises.get(binSizeMicrometers)

    if (existing !== undefined && options.signal === undefined) {
      return existing
    }

    const bin = findBin(this.bins, binSizeMicrometers)
    const promise = this.featureGenePanelReader(this.baseUrl, bin, {
      fetcher: this.fetcher,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }).catch((error: unknown) => {
      if (this.genePanelPromises.get(binSizeMicrometers) === promise) {
        this.genePanelPromises.delete(binSizeMicrometers)
      }

      throw error
    })

    if (options.signal === undefined) {
      this.genePanelPromises.set(binSizeMicrometers, promise)
    }

    return promise
  }

  annotations(): Promise<readonly Annotation<SpatialElementId>[]> {
    return Promise.reject(visiumHdNotImplementedError('annotation loading'))
  }

  filteredMatrixBarcodes(
    binSizeMicrometers = this.defaultBinSizeMicrometers,
    options: ReadVisiumHdFilteredMatrixBarcodesOptions = {},
  ): Promise<readonly VisiumHdSquareBarcode[]> {
    const existing = this.filteredMatrixBarcodePromises.get(binSizeMicrometers)

    if (existing !== undefined && options.signal === undefined) {
      return existing
    }

    const bin = findBin(this.bins, binSizeMicrometers)
    const promise = this.filteredMatrixBarcodeReader(this.baseUrl, bin, {
      fetcher: this.fetcher,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }).catch((error: unknown) => {
      if (this.filteredMatrixBarcodePromises.get(binSizeMicrometers) === promise) {
        this.filteredMatrixBarcodePromises.delete(binSizeMicrometers)
      }

      throw error
    })

    if (options.signal === undefined) {
      this.filteredMatrixBarcodePromises.set(binSizeMicrometers, promise)
    }

    return promise
  }

  barcodeMappings(
    options: VisiumHdBarcodeMappingQueryOptions,
  ): Promise<readonly VisiumHdBarcodeMapping[]> {
    const maxRows =
      options.maxRows === undefined
        ? undefined
        : normalizeVisiumHdBarcodeMappingRowBudget(options.maxRows)
    const cacheKey = maxRows ?? Number.POSITIVE_INFINITY
    const existing = this.barcodeMappingPromises.get(cacheKey)

    if (existing !== undefined && options.signal === undefined) {
      return existing
    }

    const promise = this.barcodeMappingsReader(this.baseUrl, {
      ...(maxRows === undefined ? {} : { maxRows }),
      fetcher: this.fetcher,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(this.readObjects === undefined ? {} : { readObjects: this.readObjects }),
      ...(this.loadCompressors === undefined
        ? {}
        : { loadCompressors: this.loadCompressors }),
      ...(this.byteRangeCache === undefined
        ? {}
        : { byteRangeCache: this.byteRangeCache }),
    }).catch((error: unknown) => {
      if (this.barcodeMappingPromises.get(cacheKey) === promise) {
        this.barcodeMappingPromises.delete(cacheKey)
      }

      throw error
    })

    if (options.signal === undefined) {
      this.barcodeMappingPromises.set(cacheKey, promise)
    }

    return promise
  }

  barcodeMappingsForCell(
    cellId: SpatialElementId,
    options: VisiumHdBarcodeMappingCellQueryOptions = {},
  ): Promise<readonly VisiumHdBarcodeMapping[]> {
    const existing = this.barcodeMappingCellPromises.get(cellId)

    if (existing !== undefined && options.signal === undefined) {
      return existing
    }

    const promise = this.barcodeMappingsForCellReader(this.baseUrl, cellId, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }).catch((error: unknown) => {
      if (this.barcodeMappingCellPromises.get(cellId) === promise) {
        this.barcodeMappingCellPromises.delete(cellId)
      }

      throw error
    })

    if (options.signal === undefined) {
      this.barcodeMappingCellPromises.set(cellId, promise)
    }

    return promise
  }

  async barcodeMappingAssignments(
    binSizeMicrometers: VisiumHdBinSizeMicrometers,
    binIds: readonly SpatialElementId[],
    options: VisiumHdBarcodeMappingQueryOptions,
  ): Promise<readonly VisiumHdBarcodeMappingCellAssignment[]> {
    if (binIds.length === 0) {
      return []
    }

    const [mappings, barcodeMappingsModule] = await Promise.all([
      this.barcodeMappings(options),
      import('./visiumHdBarcodeMappings'),
    ])

    return barcodeMappingsModule.selectVisiumHdBarcodeMappingAssignments(
      mappings,
      binSizeMicrometers,
      binIds,
    )
  }

  async segmentationElements(
    kind: VisiumHdSegmentationKind,
    bbox: BBox,
    binSizeMicrometers = this.defaultBinSizeMicrometers,
  ): Promise<readonly SpatialElement[]> {
    const overview = await this.readBinnedOverview(binSizeMicrometers)
    return this.segmentationElementsWithScalefactors(kind, bbox, overview.scalefactors)
  }

  async image(
    binSizeMicrometers = this.defaultBinSizeMicrometers,
  ): Promise<ImageSource | null> {
    const overview = await this.readBinnedOverview(binSizeMicrometers)
    const size = flatImageSizeFromScalefactors(overview.scalefactors)

    return {
      kind: 'flat',
      url: datasetFileUrl(this.baseUrl, overview.sourcePaths.tissueHiresImage),
      scaleFactor: overview.scalefactors.tissueHiresScale,
      ...(size === null ? {} : { size }),
    }
  }

  transcripts(): Promise<GexResult<SpatialElementId>> {
    return Promise.reject(
      new Error('Visium HD output does not provide Xenium-style transcript records.'),
    )
  }

  async geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: VisiumHdGeneExpressionQueryOptions = {},
  ): Promise<GeneExpressionBatch> {
    const totalStartedAt = Date.now()
    const selectedGenes = normalizeGeneList(genes)

    if (selectedGenes.length === 0) {
      return {
        cells: [],
        genes: [],
        maxCount: 0,
      }
    }

    const limit = options.limit ?? 5_000
    const sampleStride = normalizeSampleStride(options.sampleStride)
    throwIfAborted(options.signal)
    const viewportBinsStartedAt = Date.now()
    const overview = await this.readBinnedOverview(options.binSizeMicrometers)
    const viewportBins = selectExpressionBinsInBbox(overview, bbox, {
      limit,
      sampleStride,
    })
    const viewportCellsMs = elapsedMs(viewportBinsStartedAt)
    options.onStageTiming?.({
      stage: 'viewport-cells',
      label: 'Viewport bin query',
      durationMs: viewportCellsMs,
      detail: `${viewportBins.length.toLocaleString()} bins, limit ${limit.toLocaleString()}, stride ${sampleStride.toLocaleString()}`,
    })
    throwIfAborted(options.signal)

    if (viewportBins.length === 0) {
      return {
        cells: [],
        genes: selectedGenes,
        maxCount: 0,
        timing: {
          viewportCellsMs,
          matrixReadMs: 0,
          scoreCellsMs: 0,
          totalMs: elapsedMs(totalStartedAt),
        },
      }
    }

    const matrixReadStartedAt = Date.now()
    const matrix = await this.featureSliceReader(
      datasetFileUrl(this.baseUrl, this.featureSliceH5Path),
      viewportBins,
      selectedGenes,
      {
        backend: 'lazy-range-worker',
        binSizeMicrometers: overview.binSizeMicrometers,
        fetcher: this.fetcher,
        maxFullFileBytes: this.maxInteractiveFeatureSliceBytes,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.onStageTiming === undefined
          ? {}
          : { onStageTiming: options.onStageTiming }),
      },
    )
    const matrixReadMs = elapsedMs(matrixReadStartedAt)
    options.onStageTiming?.({
      stage: 'matrix-read',
      label: 'Expression matrix read',
      durationMs: matrixReadMs,
      detail: `${selectedGenes.length.toLocaleString()} genes, ${viewportBins.length.toLocaleString()} bins`,
    })
    throwIfAborted(options.signal)
    const scoreCellsStartedAt = Date.now()
    const selectedGeneSet = new Set(selectedGenes)
    const geneCounts = selectedGeneCounts(matrix, selectedGenes)
    const cells: GeneExpressionBatch['cells'][number][] = []
    let maxCount = 0

    for (const bin of viewportBins) {
      const expression = matrix.cells.get(bin.id)

      if (expression === undefined) {
        continue
      }

      const count = selectedGeneCount(expression, selectedGeneSet)

      if (count <= 0) {
        continue
      }

      cells.push({
        id: bin.id,
        position: bin.position,
        count,
        cellArea: overview.binSizeMicrometers * overview.binSizeMicrometers,
      })
      maxCount = Math.max(maxCount, count)
    }
    const scoreCellsMs = elapsedMs(scoreCellsStartedAt)
    options.onStageTiming?.({
      stage: 'score-cells',
      label: 'Expression scoring',
      durationMs: scoreCellsMs,
      detail: `${cells.length.toLocaleString()} positive bins`,
    })

    return {
      cells,
      genes: selectedGenes,
      geneCounts,
      maxCount,
      timing: {
        viewportCellsMs,
        matrixReadMs,
        scoreCellsMs,
        totalMs: elapsedMs(totalStartedAt),
      },
    }
  }

  readBinnedOverview(
    binSizeMicrometers = this.defaultBinSizeMicrometers,
  ): Promise<VisiumHdBinnedOverview> {
    if (binSizeMicrometers === 2) {
      return this.readTwoMicrometerOverviewFromFilteredBarcodes()
    }

    const existing = this.overviewPromises.get(binSizeMicrometers)

    if (existing !== undefined) {
      return existing
    }

    const bin = findBin(this.bins, binSizeMicrometers)
    const basisSourceBinSize = nestedBasisSourceBinSize(this.bins, binSizeMicrometers)
    const basis =
      basisSourceBinSize === undefined
        ? undefined
        : this.readBinnedOverview(basisSourceBinSize).then((sourceOverview) =>
            deriveNestedGridBasis(
              sourceOverview.grid.basis,
              binSizeMicrometers / basisSourceBinSize,
            ),
          )
    const promise = readVisiumHdBinnedOverviewLazy({
      baseUrl: this.baseUrl,
      bin,
      ...(basis === undefined ? {} : { basis }),
      fetcher: this.fetcher,
      tissuePositionsReader: this.tissuePositionsReader,
      scalefactorsReader: this.scalefactorsReader,
      ...(this.readObjects === undefined ? {} : { readObjects: this.readObjects }),
      ...(this.loadCompressors === undefined
        ? {}
        : { loadCompressors: this.loadCompressors }),
      ...(this.byteRangeCache === undefined
        ? {}
        : { byteRangeCache: this.byteRangeCache }),
    }).catch((error: unknown) => {
      if (this.overviewPromises.get(binSizeMicrometers) === promise) {
        this.overviewPromises.delete(binSizeMicrometers)
      }

      throw error
    })
    this.overviewPromises.set(binSizeMicrometers, promise)
    return promise
  }

  private readTwoMicrometerOverviewFromFilteredBarcodes(): Promise<VisiumHdBinnedOverview> {
    const existing = this.overviewPromises.get(2)

    if (existing !== undefined) {
      return existing
    }

    const bin = findBin(this.bins, 2)
    const sourceBinSize = preferredTwoMicrometerBasisSourceBinSize(this.bins)

    if (sourceBinSize === undefined) {
      return Promise.reject(
        new VisiumHdTwoMicrometerOverviewDisabledError(
          '2 µm overview loading requires a detected 8 µm or 16 µm tier to derive the affine grid basis.',
        ),
      )
    }

    const promise = (async () => {
      const [sourceOverview, scalefactors, barcodes, overviewModule] = await Promise.all([
        this.readBinnedOverview(sourceBinSize),
        this.scalefactorsReader(datasetFileUrl(this.baseUrl, bin.scalefactorsPath), {
          fetcher: this.fetcher,
        }),
        this.filteredMatrixBarcodeReader(this.baseUrl, bin, {
          fetcher: this.fetcher,
          ...(this.maxTwoMicrometerFilteredBarcodes === undefined
            ? {}
            : { maxBarcodeCount: this.maxTwoMicrometerFilteredBarcodes }),
        }),
        import('./visiumHdOverview'),
      ])
      const basis = deriveSubdividedGridBasis(
        sourceOverview.grid.basis,
        sourceOverview.binSizeMicrometers / 2,
      )

      return overviewModule.createVisiumHdBinnedOverviewFromSquareBarcodes(
        bin,
        barcodes,
        scalefactors,
        basis,
      )
    })().catch((error: unknown) => {
      if (this.overviewPromises.get(2) === promise) {
        this.overviewPromises.delete(2)
      }

      throw error
    })

    this.overviewPromises.set(2, promise)
    return promise
  }

  private async segmentationElementsWithScalefactors(
    kind: VisiumHdSegmentationKind,
    bbox: BBox,
    scalefactors: VisiumHdScalefactors,
  ): Promise<readonly SpatialElement[]> {
    const source = this.segmentationSource(kind)

    if (source === undefined) {
      return []
    }

    if (source.sourceKind === 'tiff') {
      const elements = await this.segmentationReader(this.baseUrl, {
        path: source.path,
        scalefactors,
        kind,
        bbox,
        fetcher: this.fetcher,
      })
      return filterVisiumHdSegmentationElementsByBbox(elements, bbox)
    }

    const elements = await this.segmentedElementsForPath(
      source.path,
      kind,
      scalefactors,
      bbox,
    )
    return filterVisiumHdSegmentationElementsByBbox(elements, bbox)
  }

  private segmentedElementsForPath(
    path: string,
    kind: VisiumHdSegmentationKind,
    scalefactors: VisiumHdScalefactors,
    bbox?: BBox,
  ): Promise<readonly SpatialElement[]> {
    const cacheKey = `${path}\n${kind}\n${scalefactors.micronsPerPixel}\n${segmentationBboxCacheKey(
      bbox,
    )}`
    const existing = this.segmentationPromises.get(cacheKey)

    if (existing !== undefined) {
      return existing
    }

    const promise = this.segmentationReader(this.baseUrl, {
      path,
      scalefactors,
      kind,
      fetcher: this.fetcher,
      ...(bbox === undefined ? {} : { bbox, streamGeojson: true }),
      ...(this.maxInteractiveSegmentationGeojsonBytes === undefined
        ? {}
        : { maxFullFileBytes: this.maxInteractiveSegmentationGeojsonBytes }),
    }).catch((error: unknown) => {
      if (this.segmentationPromises.get(cacheKey) === promise) {
        this.segmentationPromises.delete(cacheKey)
      }

      throw error
    })

    this.segmentationPromises.set(cacheKey, promise)
    return promise
  }

  private cellSegmentationPath(): string | undefined {
    return this.segmentationSource('cell')?.path
  }

  private segmentationSource(
    kind: VisiumHdSegmentationKind,
  ): { readonly path: string; readonly sourceKind: 'geojson' | 'tiff' } | undefined {
    if (kind === 'cell') {
      const path =
        this.segmentedOutputs?.cellSegmentationsGeojsonPath ??
        this.segmentedOutputs?.graphclustAnnotatedCellSegmentationsGeojsonPath

      return path === undefined ? undefined : { path, sourceKind: 'geojson' }
    }

    const geojsonPath =
      this.segmentedOutputs?.nucleusSegmentationsGeojsonPath ??
      this.segmentedOutputs?.graphclustAnnotatedNucleusSegmentationsGeojsonPath

    if (geojsonPath !== undefined) {
      return { path: geojsonPath, sourceKind: 'geojson' }
    }

    const tiffPath = this.segmentedOutputs?.nucleusInstanceMaskTiffPath

    return tiffPath === undefined ? undefined : { path: tiffPath, sourceKind: 'tiff' }
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function flatImageSizeFromScalefactors(
  scalefactors: VisiumHdScalefactors,
): readonly [number, number] | null {
  if (
    scalefactors.tissueHiresImageWidth === undefined ||
    scalefactors.tissueHiresImageHeight === undefined
  ) {
    return null
  }

  return [scalefactors.tissueHiresImageWidth, scalefactors.tissueHiresImageHeight]
}

function visiumHdNotImplementedError(capability: string): Error {
  return new Error(`Visium HD ${capability} is not implemented yet.`)
}

function preferredDefaultBinSize(
  bins: readonly VisiumHdBinDescriptor[],
): VisiumHdBinSizeMicrometers {
  if (bins.length === 0) {
    throw new Error('VisiumHdDataset requires at least one binned output descriptor.')
  }

  if (bins.some((bin) => bin.binSizeMicrometers === 16)) {
    return 16
  }

  if (bins.some((bin) => bin.binSizeMicrometers === 8)) {
    return 8
  }

  return bins[0]?.binSizeMicrometers ?? 16
}

function findBin(
  bins: readonly VisiumHdBinDescriptor[],
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
): VisiumHdBinDescriptor {
  const bin = bins.find(
    (candidate) => candidate.binSizeMicrometers === binSizeMicrometers,
  )

  if (bin === undefined) {
    throw new Error(`Visium HD ${binSizeMicrometers} µm binned output is not available.`)
  }

  return bin
}

function preferredTwoMicrometerBasisSourceBinSize(
  bins: readonly VisiumHdBinDescriptor[],
): 8 | 16 | undefined {
  if (bins.some((bin) => bin.binSizeMicrometers === 8)) {
    return 8
  }

  if (bins.some((bin) => bin.binSizeMicrometers === 16)) {
    return 16
  }

  return undefined
}

function nestedBasisSourceBinSize(
  bins: readonly VisiumHdBinDescriptor[],
  targetBinSize: VisiumHdBinSizeMicrometers,
): 8 | undefined {
  if (targetBinSize === 16 && bins.some((bin) => bin.binSizeMicrometers === 8)) {
    return 8
  }

  return undefined
}

function unitsFromScalefactors(scalefactors: VisiumHdScalefactors): UnitsDescriptor {
  return {
    dataUnit: 'micrometer',
    imageUnit: 'pixel',
    micrometersPerPixel: micrometers(scalefactors.micronsPerPixel),
    origin: 'top-left',
    imageYAxis: 'down',
  }
}

function overviewExtent(overview: VisiumHdBinnedOverview): BBox {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let index = 0; index < overview.gridCells.rows.length; index += 1) {
    const row = overview.gridCells.rows[index] ?? 0
    const col = overview.gridCells.cols[index] ?? 0
    const center = gridCellCenter(overview.grid, row, col)

    minX = Math.min(minX, center.x)
    maxX = Math.max(maxX, center.x)
    minY = Math.min(minY, center.y)
    maxY = Math.max(maxY, center.y)
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

function segmentationBboxCacheKey(bbox: BBox | undefined): string {
  if (bbox === undefined) {
    return 'full'
  }

  return [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].join(',')
}

function selectGridCellsInBbox(
  overview: VisiumHdBinnedOverview,
  bbox: BBox,
): GridCellBatch<SpatialElementId> {
  let count = 0

  for (let index = 0; index < overview.gridCells.rows.length; index += 1) {
    const row = overview.gridCells.rows[index] ?? 0
    const col = overview.gridCells.cols[index] ?? 0
    const center = gridCellCenter(overview.grid, row, col)

    if (
      center.x >= bbox.minX &&
      center.x <= bbox.maxX &&
      center.y >= bbox.minY &&
      center.y <= bbox.maxY
    ) {
      count += 1
    }
  }

  const ids = new Array<SpatialElementId>(count)
  const rows = new Int32Array(count)
  const cols = new Int32Array(count)
  let targetIndex = 0

  for (let index = 0; index < overview.gridCells.rows.length; index += 1) {
    const row = overview.gridCells.rows[index] ?? 0
    const col = overview.gridCells.cols[index] ?? 0
    const center = gridCellCenter(overview.grid, row, col)

    if (
      center.x < bbox.minX ||
      center.x > bbox.maxX ||
      center.y < bbox.minY ||
      center.y > bbox.maxY
    ) {
      continue
    }

    ids[targetIndex] = overview.gridCells.ids[index] ?? ''
    rows[targetIndex] = row
    cols[targetIndex] = col
    targetIndex += 1
  }

  return {
    kind: 'grid-cells',
    gridId: overview.grid.id,
    ids,
    rows,
    cols,
  }
}

interface VisiumHdExpressionBin {
  readonly id: SpatialElementId
  readonly row: number
  readonly col: number
  readonly position: DataPoint
}

function selectExpressionBinsInBbox(
  overview: VisiumHdBinnedOverview,
  bbox: BBox,
  options: {
    readonly limit: number
    readonly sampleStride: number
  },
): readonly VisiumHdExpressionBin[] {
  const limit = normalizeLimit(options.limit)

  if (limit === 0) {
    return []
  }

  const bins: VisiumHdExpressionBin[] = []
  let candidateIndex = 0

  for (let index = 0; index < overview.gridCells.rows.length; index += 1) {
    const row = overview.gridCells.rows[index] ?? 0
    const col = overview.gridCells.cols[index] ?? 0
    const center = gridCellCenter(overview.grid, row, col)

    if (
      center.x < bbox.minX ||
      center.x > bbox.maxX ||
      center.y < bbox.minY ||
      center.y > bbox.maxY
    ) {
      continue
    }

    if (candidateIndex % options.sampleStride === 0) {
      bins.push({
        id: overview.gridCells.ids[index] ?? '',
        row,
        col,
        position: center,
      })
    }

    candidateIndex += 1

    if (bins.length >= limit) {
      break
    }
  }

  return bins
}

function selectedGeneCount(cell: GexCell, selectedGeneSet: ReadonlySet<string>): number {
  let total = 0

  for (let index = 0; index < cell.geneNames.length; index += 1) {
    const gene = cell.geneNames[index]
    const count = cell.counts[index]

    if (
      gene !== undefined &&
      count !== undefined &&
      selectedGeneSet.has(gene) &&
      Number.isFinite(count)
    ) {
      total += count
    }
  }

  return total
}

function selectedGeneCounts(
  matrix: GexResult<SpatialElementId>,
  selectedGenes: readonly string[],
): readonly GeneExpressionGeneCount[] {
  const selectedGeneKeys = new Map(
    selectedGenes.map((gene) => [gene.toLocaleLowerCase(), gene]),
  )
  const countsByGene = new Map<string, number>()

  for (const cell of matrix.cells.values()) {
    for (let index = 0; index < cell.geneNames.length; index += 1) {
      const gene = cell.geneNames[index]
      const count = cell.counts[index]

      if (gene === undefined || count === undefined || count <= 0) {
        continue
      }

      const selectedGene = selectedGeneKeys.get(gene.toLocaleLowerCase())

      if (selectedGene === undefined) {
        continue
      }

      countsByGene.set(selectedGene, (countsByGene.get(selectedGene) ?? 0) + count)
    }
  }

  return selectedGenes
    .map((gene) => ({ gene, count: countsByGene.get(gene) ?? 0 }))
    .filter((gene) => gene.count > 0)
    .sort((left, right) => right.count - left.count)
}

function normalizeGeneList(genes: readonly string[]): readonly string[] {
  const selectedGenes: string[] = []
  const seenGenes = new Set<string>()

  for (const gene of genes) {
    const normalizedGene = gene.trim()
    const key = normalizedGene.toLowerCase()

    if (normalizedGene.length === 0 || seenGenes.has(key)) {
      continue
    }

    selectedGenes.push(normalizedGene)
    seenGenes.add(key)
  }

  return selectedGenes
}

function normalizeSampleStride(sampleStride: number | undefined): number {
  if (sampleStride === undefined || !Number.isFinite(sampleStride)) {
    return 1
  }

  return Math.max(1, Math.floor(sampleStride))
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 5_000
  }

  return Math.max(0, Math.floor(limit))
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Visium HD expression request aborted.')
  error.name = 'AbortError'
  return error
}
