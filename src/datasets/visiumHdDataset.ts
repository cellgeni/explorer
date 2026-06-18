import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet'
import { datasetFileUrl } from '../data/datasetFiles'
import {
  gexFromFeatureBarcodeMatrixH5,
  isGeneFeature,
  type CellFeatureMatrixReadOptions,
  type GexCell,
  type GexResult,
} from '../data/gex'
import {
  gexFromVisiumFeatureSliceH5,
  type VisiumFeatureSliceReadOptions,
  type VisiumFeatureSliceTarget,
} from '../data/visiumFeatureSlice'
import { readMaybeGzipText } from '../data/readMaybeGzipText'
import {
  readVisiumHdFilteredMatrixBarcodes,
  type ReadVisiumHdFilteredMatrixBarcodesOptions,
  type VisiumHdSquareBarcode,
} from './visiumHdBarcodes'
import {
  filterVisiumHdSegmentationElementsByBbox,
  readVisiumHdSegmentationElements,
  visiumHdSegmentationInfos,
  type ReadVisiumHdSegmentationElementsOptions,
  type VisiumHdSegmentedOutputPaths,
  type VisiumHdSegmentationKind,
} from './visiumHdSegmentations'
import {
  normalizeVisiumHdBarcodeMappingRowBudget,
  readVisiumHdBarcodeMappings,
  selectVisiumHdBarcodeMappingAssignments,
  type ReadVisiumHdBarcodeMappingsOptions,
  type VisiumHdBarcodeMapping,
  type VisiumHdBarcodeMappingCellAssignment,
} from './visiumHdBarcodeMappings'
import {
  VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
  VisiumHdTwoMicrometerOverviewDisabledError,
  normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget,
} from './visiumHdStrategy'
import { micrometers } from '../data/coords'
import {
  cacheFooterByteRanges,
  defaultPersistentByteRangeCache,
} from '../data/persistentByteRangeCache'
import {
  deriveNestedGridBasis,
  deriveSubdividedGridBasis,
  fitGridBasis,
  gridCellCenter,
} from './spatialGrid'
import type { AsyncBuffer, Compressors } from 'hyparquet'
import type { BBox, DataPoint, UnitsDescriptor } from '../data/coords'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  GridCellBatch,
  ImageSource,
  SpatialGrid,
  SpatialGridBasis,
  SpatialDataset,
  SpatialElement,
  SpatialElementId,
} from './spatialDataset'
import type { GeneExpressionBatch, GeneExpressionQueryOptions } from './xeniumDataset'

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
  readonly maxInteractiveMatrixBytes?: number
  readonly maxInteractiveFeatureSliceBytes?: number
  readonly maxInteractiveSegmentationGeojsonBytes?: number
  readonly readObjects?: VisiumHdParquetObjectReader
  readonly loadCompressors?: () => Promise<Compressors>
  readonly byteRangeCache?: PersistentByteRangeCache | null
}

export interface VisiumHdScalefactors {
  readonly micronsPerPixel: number
  readonly tissueHiresScale: number
  readonly tissueLowresScale: number
  readonly binSizeMicrometers?: number
  readonly spotDiameterFullres?: number
  readonly registrationTargetImageScale?: number
  readonly tissueHiresImageWidth?: number
  readonly tissueHiresImageHeight?: number
  readonly tissueLowresImageWidth?: number
  readonly tissueLowresImageHeight?: number
}

export interface VisiumHdBinnedOverview {
  readonly binSizeMicrometers: VisiumHdBinSizeMicrometers
  readonly scalefactors: VisiumHdScalefactors
  readonly grid: SpatialGrid
  readonly gridCells: GridCellBatch<SpatialElementId>
  readonly fullresRows: Float64Array
  readonly fullresCols: Float64Array
  readonly inTissue: Uint8Array
  readonly sourcePaths: {
    readonly tissuePositions: string
    readonly scalefactors: string
    readonly tissueHiresImage: string
    readonly tissueLowresImage: string
    readonly filteredMatrixH5: string
    readonly filteredMatrixBarcodes?: string
  }
}

export interface VisiumHdTissuePositions {
  readonly ids: readonly SpatialElementId[]
  readonly inTissue: Uint8Array
  readonly arrayRows: Int32Array
  readonly arrayCols: Int32Array
  readonly fullresRows: Float64Array
  readonly fullresCols: Float64Array
}

export interface ReadVisiumHdScalefactorsOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export interface ReadVisiumHdTissuePositionsOptions {
  readonly url?: string
  readonly file?: AsyncBuffer
  readonly limit?: number
  readonly fetcher?: typeof fetch
  readonly compressors?: Compressors
  readonly loadCompressors?: () => Promise<Compressors>
  readonly readObjects?: VisiumHdParquetObjectReader
  readonly byteRangeCache?: PersistentByteRangeCache | null
  readonly signal?: AbortSignal
}

export interface ReadVisiumHdFeatureGenePanelOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export interface VisiumHdGeneExpressionQueryOptions extends GeneExpressionQueryOptions {
  readonly binSizeMicrometers?: VisiumHdBinSizeMicrometers
}

export interface VisiumHdBarcodeMappingQueryOptions {
  readonly maxRows: number
  readonly signal?: AbortSignal
}

export interface ReadVisiumHdBinnedOverviewOptions {
  readonly baseUrl: string
  readonly bin: VisiumHdBinDescriptor
  readonly includeOutOfTissue?: boolean
  readonly maxBasisFitSamples?: number
  readonly basis?: SpatialGridBasis | Promise<SpatialGridBasis>
  readonly fetcher?: typeof fetch
  readonly tissuePositionsReader?: (
    options: ReadVisiumHdTissuePositionsOptions,
  ) => Promise<VisiumHdTissuePositions>
  readonly scalefactorsReader?: (
    url: string,
    options: ReadVisiumHdScalefactorsOptions,
  ) => Promise<VisiumHdScalefactors>
  readonly readObjects?: VisiumHdParquetObjectReader
  readonly loadCompressors?: () => Promise<Compressors>
  readonly byteRangeCache?: PersistentByteRangeCache | null
  readonly signal?: AbortSignal
}

export interface CreateVisiumHdBinnedOverviewOptions {
  readonly includeOutOfTissue?: boolean
  readonly maxBasisFitSamples?: number
  readonly basis?: SpatialGridBasis
}

export interface VisiumHdParquetReadObjectsOptions {
  readonly file: AsyncBuffer
  readonly columns: readonly string[]
  readonly rowFormat: 'object'
  readonly rowEnd?: number
  readonly compressors?: Compressors
}

export type VisiumHdParquetObjectReader = (
  options: VisiumHdParquetReadObjectsOptions,
) => Promise<readonly Record<string, unknown>[]>

export const VISIUM_HD_TISSUE_POSITION_COLUMNS = [
  'barcode',
  'in_tissue',
  'array_row',
  'array_col',
  'pxl_row_in_fullres',
  'pxl_col_in_fullres',
] as const

export class VisiumHdTissuePositionsDecodeError extends Error {
  override readonly name = 'ParquetDecodeError'
}

const DEFAULT_VISIUM_HD_MAX_BASIS_FIT_SAMPLES = 10_000
export const DEFAULT_VISIUM_HD_INTERACTIVE_MATRIX_BYTE_BUDGET = 64 * 1024 * 1024
export const DEFAULT_VISIUM_HD_FEATURE_SLICE_BYTE_BUDGET = 128 * 1024 * 1024

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
  private readonly maxInteractiveMatrixBytes: number
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
      options.tissuePositionsReader ?? readVisiumHdTissuePositions
    this.scalefactorsReader = options.scalefactorsReader ?? readVisiumHdScalefactors
    this.featureGenePanelReader =
      options.featureGenePanelReader ?? readVisiumHdFeatureGenePanel
    this.filteredMatrixBarcodeReader =
      options.filteredMatrixBarcodeReader ?? readVisiumHdFilteredMatrixBarcodes
    this.barcodeMappingsReader =
      options.barcodeMappingsReader ?? readVisiumHdBarcodeMappings
    this.segmentedOutputs = options.segmentedOutputs
    this.segmentationReader =
      options.segmentationReader ?? readVisiumHdSegmentationElements
    this.featureMatrixReader =
      options.featureMatrixReader ?? gexFromFeatureBarcodeMatrixH5
    this.featureSliceH5Path = options.featureSliceH5Path ?? 'feature_slice.h5'
    this.featureSliceReader = options.featureSliceReader ?? gexFromVisiumFeatureSliceH5
    this.maxTwoMicrometerFilteredBarcodes =
      normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget(
        options.maxTwoMicrometerFilteredBarcodes,
      )
    this.maxInteractiveMatrixBytes =
      options.maxInteractiveMatrixBytes ??
      DEFAULT_VISIUM_HD_INTERACTIVE_MATRIX_BYTE_BUDGET
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
      {
        ...options,
        maxFullFileBytes: options.maxFullFileBytes ?? this.maxInteractiveMatrixBytes,
      },
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
    const maxRows = normalizeVisiumHdBarcodeMappingRowBudget(options.maxRows)
    const existing = this.barcodeMappingPromises.get(maxRows)

    if (existing !== undefined && options.signal === undefined) {
      return existing
    }

    const promise = this.barcodeMappingsReader(this.baseUrl, {
      maxRows,
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
      if (this.barcodeMappingPromises.get(maxRows) === promise) {
        this.barcodeMappingPromises.delete(maxRows)
      }

      throw error
    })

    if (options.signal === undefined) {
      this.barcodeMappingPromises.set(maxRows, promise)
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

    const mappings = await this.barcodeMappings(options)

    return selectVisiumHdBarcodeMappingAssignments(mappings, binSizeMicrometers, binIds)
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
      if (this.maxTwoMicrometerFilteredBarcodes === undefined) {
        return Promise.reject(
          new VisiumHdTwoMicrometerOverviewDisabledError(
            VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
          ),
        )
      }

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
    const promise = readVisiumHdBinnedOverview({
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

    const maxBarcodeCount = this.maxTwoMicrometerFilteredBarcodes

    if (maxBarcodeCount === undefined) {
      return Promise.reject(
        new VisiumHdTwoMicrometerOverviewDisabledError(
          VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
        ),
      )
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
      const [sourceOverview, scalefactors, barcodes] = await Promise.all([
        this.readBinnedOverview(sourceBinSize),
        this.scalefactorsReader(datasetFileUrl(this.baseUrl, bin.scalefactorsPath), {
          fetcher: this.fetcher,
        }),
        this.filteredMatrixBarcodeReader(this.baseUrl, bin, {
          fetcher: this.fetcher,
          maxBarcodeCount,
        }),
      ])
      const basis = deriveSubdividedGridBasis(
        sourceOverview.grid.basis,
        sourceOverview.binSizeMicrometers / 2,
      )

      return createVisiumHdBinnedOverviewFromSquareBarcodes(
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

    const elements = await this.segmentedElementsForPath(source.path, kind, scalefactors)
    return filterVisiumHdSegmentationElementsByBbox(elements, bbox)
  }

  private segmentedElementsForPath(
    path: string,
    kind: VisiumHdSegmentationKind,
    scalefactors: VisiumHdScalefactors,
  ): Promise<readonly SpatialElement[]> {
    const cacheKey = `${path}\n${kind}\n${scalefactors.micronsPerPixel}`
    const existing = this.segmentationPromises.get(cacheKey)

    if (existing !== undefined) {
      return existing
    }

    const promise = this.segmentationReader(this.baseUrl, {
      path,
      scalefactors,
      kind,
      fetcher: this.fetcher,
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

export async function readVisiumHdBinnedOverview(
  options: ReadVisiumHdBinnedOverviewOptions,
): Promise<VisiumHdBinnedOverview> {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const tissuePositionsUrl = datasetFileUrl(baseUrl, options.bin.tissuePositionsPath)
  const scalefactorsUrl = datasetFileUrl(baseUrl, options.bin.scalefactorsPath)
  const [positions, scalefactors, basis] = await Promise.all([
    (options.tissuePositionsReader ?? readVisiumHdTissuePositions)({
      url: tissuePositionsUrl,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.readObjects === undefined ? {} : { readObjects: options.readObjects }),
      ...(options.loadCompressors === undefined
        ? {}
        : { loadCompressors: options.loadCompressors }),
      ...(options.byteRangeCache === undefined
        ? {}
        : { byteRangeCache: options.byteRangeCache }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
    (options.scalefactorsReader ?? readVisiumHdScalefactors)(scalefactorsUrl, {
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
    options.basis,
  ])

  return createVisiumHdBinnedOverview(options.bin, positions, scalefactors, {
    ...(options.includeOutOfTissue === undefined
      ? {}
      : { includeOutOfTissue: options.includeOutOfTissue }),
    ...(options.maxBasisFitSamples === undefined
      ? {}
      : { maxBasisFitSamples: options.maxBasisFitSamples }),
    ...(basis === undefined ? {} : { basis }),
  })
}

export async function readVisiumHdScalefactors(
  url: string,
  options: ReadVisiumHdScalefactorsOptions = {},
): Promise<VisiumHdScalefactors> {
  const response = await (options.fetcher ?? fetch)(url, {
    method: 'GET',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  if (!response.ok) {
    throw new Error(
      `Unable to read Visium HD scalefactors at ${url}: HTTP ${response.status}`,
    )
  }

  return parseVisiumHdScalefactors(await response.json())
}

export async function readVisiumHdFeatureGenePanel(
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  options: ReadVisiumHdFeatureGenePanelOptions = {},
): Promise<readonly string[]> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const url = datasetFileUrl(
    normalizeBaseUrl(baseUrl),
    `${bin.outputPath}/filtered_feature_bc_matrix/features.tsv.gz`,
  )
  const response =
    options.signal === undefined
      ? await fetcher(url)
      : await fetcher(url, { signal: options.signal })

  if (!response.ok) {
    throw new Error(`Unable to load Visium HD features.tsv.gz: HTTP ${response.status}.`)
  }

  return parseVisiumHdFeatureRows(await readMaybeGzipText(response))
}

export function parseVisiumHdFeatureRows(text: string): readonly string[] {
  const genes = new Set<string>()

  for (const line of text.split(/\r?\n/)) {
    const trimmedLine = line.trim()

    if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) {
      continue
    }

    const columns = trimmedLine.split('\t')
    const geneName = (columns[1] ?? columns[0] ?? '').trim()
    const featureType = columns[2]?.trim()

    if (geneName.length > 0 && isGeneFeature(geneName, featureType)) {
      genes.add(geneName)
    }
  }

  return [...genes].sort((a, b) => a.localeCompare(b))
}

export function parseVisiumHdScalefactors(value: unknown): VisiumHdScalefactors {
  if (value === null || typeof value !== 'object') {
    throw new Error('Expected Visium HD scalefactors JSON to be an object.')
  }

  const source = value as Record<string, unknown>

  return {
    micronsPerPixel: readJsonNumber(source, 'microns_per_pixel'),
    tissueHiresScale: readJsonNumber(source, 'tissue_hires_scalef'),
    tissueLowresScale: readJsonNumber(source, 'tissue_lowres_scalef'),
    ...readOptionalJsonNumber(source, 'bin_size_um', 'binSizeMicrometers'),
    ...readOptionalJsonNumber(source, 'spot_diameter_fullres', 'spotDiameterFullres'),
    ...readOptionalJsonNumber(
      source,
      'tissue_hires_image_width',
      'tissueHiresImageWidth',
    ),
    ...readOptionalJsonNumber(
      source,
      'tissue_hires_image_height',
      'tissueHiresImageHeight',
    ),
    ...readOptionalJsonNumber(
      source,
      'tissue_lowres_image_width',
      'tissueLowresImageWidth',
    ),
    ...readOptionalJsonNumber(
      source,
      'tissue_lowres_image_height',
      'tissueLowresImageHeight',
    ),
    ...readOptionalRegistrationTargetImageScale(source),
  }
}

export async function readVisiumHdTissuePositions(
  options: ReadVisiumHdTissuePositionsOptions,
): Promise<VisiumHdTissuePositions> {
  const file = options.file ?? (await visiumHdFileFromUrl(options))
  const compressors =
    options.compressors ?? (await (options.loadCompressors ?? loadDefaultCompressors)())
  const rows = await readVisiumHdPositionRowsWithContext({
    file,
    columns: VISIUM_HD_TISSUE_POSITION_COLUMNS,
    rowFormat: 'object',
    compressors,
    ...(options.limit === undefined ? {} : { rowEnd: options.limit }),
    readObjects: options.readObjects ?? readHyparquetObjects,
    url: options.url,
  })

  return parseVisiumHdTissuePositionRows(rows)
}

export function parseVisiumHdTissuePositionRows(
  rows: readonly Record<string, unknown>[],
): VisiumHdTissuePositions {
  const ids = new Array<SpatialElementId>(rows.length)
  const inTissue = new Uint8Array(rows.length)
  const arrayRows = new Int32Array(rows.length)
  const arrayCols = new Int32Array(rows.length)
  const fullresRows = new Float64Array(rows.length)
  const fullresCols = new Float64Array(rows.length)

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]

    if (row === undefined) {
      throw new Error(`Missing Visium HD tissue position row ${index}.`)
    }

    const barcode = row.barcode

    if (typeof barcode !== 'string') {
      throw new Error('Expected tissue_positions.parquet barcode to be a string.')
    }

    ids[index] = barcode
    inTissue[index] = readInTissue(row)
    arrayRows[index] = readIntegerColumn(row, 'array_row')
    arrayCols[index] = readIntegerColumn(row, 'array_col')
    fullresRows[index] = readNumericColumn(row, 'pxl_row_in_fullres')
    fullresCols[index] = readNumericColumn(row, 'pxl_col_in_fullres')
  }

  return {
    ids,
    inTissue,
    arrayRows,
    arrayCols,
    fullresRows,
    fullresCols,
  }
}

export function createVisiumHdBinnedOverview(
  bin: VisiumHdBinDescriptor,
  positions: VisiumHdTissuePositions,
  scalefactors: VisiumHdScalefactors,
  options: CreateVisiumHdBinnedOverviewOptions = {},
): VisiumHdBinnedOverview {
  const retainedCount = countRetainedPositions(positions, options)

  if (retainedCount === 0) {
    throw new Error(
      'No Visium HD tissue positions were retained for the binned overview.',
    )
  }

  const ids = new Array<SpatialElementId>(retainedCount)
  const rows = new Int32Array(retainedCount)
  const cols = new Int32Array(retainedCount)
  const fullresRows = new Float64Array(retainedCount)
  const fullresCols = new Float64Array(retainedCount)
  const inTissue = new Uint8Array(retainedCount)
  const basisSamples: {
    readonly row: number
    readonly col: number
    readonly point: DataPoint
  }[] = []
  const sampleStride =
    options.basis === undefined
      ? basisSampleStride(retainedCount, options.maxBasisFitSamples)
      : 1
  let targetIndex = 0
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minCol = Number.POSITIVE_INFINITY
  let maxCol = Number.NEGATIVE_INFINITY

  for (let sourceIndex = 0; sourceIndex < positions.ids.length; sourceIndex += 1) {
    if (!shouldRetainPosition(positions, sourceIndex, options)) {
      continue
    }

    const arrayRow = positions.arrayRows[sourceIndex] ?? 0
    const arrayCol = positions.arrayCols[sourceIndex] ?? 0
    const fullresRow = positions.fullresRows[sourceIndex] ?? 0
    const fullresCol = positions.fullresCols[sourceIndex] ?? 0
    const point = fullresPixelCenterToDataPoint(fullresRow, fullresCol, scalefactors)

    ids[targetIndex] = positions.ids[sourceIndex] ?? ''
    rows[targetIndex] = arrayRow
    cols[targetIndex] = arrayCol
    fullresRows[targetIndex] = fullresRow
    fullresCols[targetIndex] = fullresCol
    inTissue[targetIndex] = positions.inTissue[sourceIndex] ?? 0

    if (
      options.basis === undefined &&
      (targetIndex % sampleStride === 0 || basisSamples.length < 3)
    ) {
      basisSamples.push({ row: arrayRow, col: arrayCol, point })
    }

    minRow = Math.min(minRow, arrayRow)
    maxRow = Math.max(maxRow, arrayRow)
    minCol = Math.min(minCol, arrayCol)
    maxCol = Math.max(maxCol, arrayCol)
    targetIndex += 1
  }

  const grid: SpatialGrid = {
    id: visiumHdGridId(bin.binSizeMicrometers),
    binSizeMicrometers: micrometers(bin.binSizeMicrometers),
    basis: options.basis ?? fitGridBasis(basisSamples),
    bounds: {
      minRow,
      maxRow,
      minCol,
      maxCol,
    },
  }

  return {
    binSizeMicrometers: bin.binSizeMicrometers,
    scalefactors,
    grid,
    gridCells: {
      kind: 'grid-cells',
      gridId: grid.id,
      ids,
      rows,
      cols,
    },
    fullresRows,
    fullresCols,
    inTissue,
    sourcePaths: {
      tissuePositions: bin.tissuePositionsPath,
      scalefactors: bin.scalefactorsPath,
      tissueHiresImage: `${bin.outputPath}/spatial/tissue_hires_image.png`,
      tissueLowresImage: `${bin.outputPath}/spatial/tissue_lowres_image.png`,
      filteredMatrixH5: bin.filteredMatrixH5Path,
      filteredMatrixBarcodes: `${bin.outputPath}/filtered_feature_bc_matrix/barcodes.tsv.gz`,
    },
  }
}

export function createVisiumHdBinnedOverviewFromSquareBarcodes(
  bin: VisiumHdBinDescriptor,
  barcodes: readonly VisiumHdSquareBarcode[],
  scalefactors: VisiumHdScalefactors,
  basis: SpatialGridBasis,
): VisiumHdBinnedOverview {
  if (barcodes.length === 0) {
    throw new Error(
      'No Visium HD filtered matrix barcodes were available for the binned overview.',
    )
  }

  const ids = new Array<SpatialElementId>(barcodes.length)
  const rows = new Int32Array(barcodes.length)
  const cols = new Int32Array(barcodes.length)
  const fullresRows = new Float64Array(barcodes.length)
  const fullresCols = new Float64Array(barcodes.length)
  const inTissue = new Uint8Array(barcodes.length)
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minCol = Number.POSITIVE_INFINITY
  let maxCol = Number.NEGATIVE_INFINITY

  for (let index = 0; index < barcodes.length; index += 1) {
    const barcode = barcodes[index]

    if (barcode === undefined) {
      throw new Error(`Missing Visium HD barcode row ${index}.`)
    }

    if (barcode.binSizeMicrometers !== bin.binSizeMicrometers) {
      throw new Error(
        `Expected ${bin.binSizeMicrometers} µm barcode, received ${barcode.binSizeMicrometers} µm: ${barcode.barcode}`,
      )
    }

    const center = gridCellCenter(basis, barcode.row, barcode.col)

    ids[index] = barcode.barcode
    rows[index] = barcode.row
    cols[index] = barcode.col
    fullresRows[index] = dataPointToFullresRow(center, scalefactors)
    fullresCols[index] = dataPointToFullresCol(center, scalefactors)
    inTissue[index] = 1
    minRow = Math.min(minRow, barcode.row)
    maxRow = Math.max(maxRow, barcode.row)
    minCol = Math.min(minCol, barcode.col)
    maxCol = Math.max(maxCol, barcode.col)
  }

  const grid: SpatialGrid = {
    id: visiumHdGridId(bin.binSizeMicrometers),
    binSizeMicrometers: micrometers(bin.binSizeMicrometers),
    basis,
    bounds: {
      minRow,
      maxRow,
      minCol,
      maxCol,
    },
  }

  return {
    binSizeMicrometers: bin.binSizeMicrometers,
    scalefactors,
    grid,
    gridCells: {
      kind: 'grid-cells',
      gridId: grid.id,
      ids,
      rows,
      cols,
    },
    fullresRows,
    fullresCols,
    inTissue,
    sourcePaths: {
      tissuePositions: bin.tissuePositionsPath,
      scalefactors: bin.scalefactorsPath,
      tissueHiresImage: `${bin.outputPath}/spatial/tissue_hires_image.png`,
      tissueLowresImage: `${bin.outputPath}/spatial/tissue_lowres_image.png`,
      filteredMatrixH5: bin.filteredMatrixH5Path,
      filteredMatrixBarcodes: `${bin.outputPath}/filtered_feature_bc_matrix/barcodes.tsv.gz`,
    },
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

function visiumHdGridId(binSizeMicrometers: VisiumHdBinSizeMicrometers): string {
  return `visium-hd-square-${String(binSizeMicrometers).padStart(3, '0')}um`
}

function fullresPixelCenterToDataPoint(
  fullresRow: number,
  fullresCol: number,
  scalefactors: VisiumHdScalefactors,
): DataPoint {
  return {
    x: micrometers(fullresCol * scalefactors.micronsPerPixel),
    y: micrometers(fullresRow * scalefactors.micronsPerPixel),
  }
}

function dataPointToFullresRow(
  point: DataPoint,
  scalefactors: VisiumHdScalefactors,
): number {
  return point.y / scalefactors.micronsPerPixel
}

function dataPointToFullresCol(
  point: DataPoint,
  scalefactors: VisiumHdScalefactors,
): number {
  return point.x / scalefactors.micronsPerPixel
}

function countRetainedPositions(
  positions: VisiumHdTissuePositions,
  options: CreateVisiumHdBinnedOverviewOptions,
): number {
  let count = 0

  for (let index = 0; index < positions.ids.length; index += 1) {
    if (shouldRetainPosition(positions, index, options)) {
      count += 1
    }
  }

  return count
}

function shouldRetainPosition(
  positions: VisiumHdTissuePositions,
  index: number,
  options: CreateVisiumHdBinnedOverviewOptions,
): boolean {
  return options.includeOutOfTissue === true || positions.inTissue[index] === 1
}

function basisSampleStride(
  retainedCount: number,
  maxBasisFitSamples = DEFAULT_VISIUM_HD_MAX_BASIS_FIT_SAMPLES,
): number {
  if (!Number.isFinite(maxBasisFitSamples) || maxBasisFitSamples < 3) {
    throw new RangeError('Visium HD basis fitting needs at least three samples.')
  }

  return Math.max(1, Math.ceil(retainedCount / maxBasisFitSamples))
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

async function visiumHdFileFromUrl(
  options: ReadVisiumHdTissuePositionsOptions,
): Promise<AsyncBuffer> {
  if (options.url === undefined) {
    throw new Error('readVisiumHdTissuePositions requires either url or file.')
  }

  const file = await asyncBufferFromUrl({
    url: options.url,
    ...(options.fetcher === undefined ? {} : { fetch: options.fetcher }),
    ...(options.signal === undefined ? {} : { requestInit: { signal: options.signal } }),
  })
  const byteRangeCache =
    options.byteRangeCache === undefined
      ? defaultPersistentByteRangeCache()
      : options.byteRangeCache

  return cacheFooterByteRanges(file, {
    cache: byteRangeCache,
    url: options.url,
  }) as AsyncBuffer
}

async function readHyparquetObjects(
  options: VisiumHdParquetReadObjectsOptions,
): Promise<readonly Record<string, unknown>[]> {
  return (await parquetReadObjects({
    file: options.file,
    columns: [...options.columns],
    rowFormat: options.rowFormat,
    ...(options.compressors === undefined ? {} : { compressors: options.compressors }),
    ...(options.rowEnd === undefined ? {} : { rowEnd: options.rowEnd }),
  })) as readonly Record<string, unknown>[]
}

async function readVisiumHdPositionRowsWithContext(
  options: VisiumHdParquetReadObjectsOptions & {
    readonly readObjects: VisiumHdParquetObjectReader
    readonly url: string | undefined
  },
): Promise<readonly Record<string, unknown>[]> {
  try {
    return await options.readObjects({
      file: options.file,
      columns: options.columns,
      rowFormat: options.rowFormat,
      ...(options.compressors === undefined ? {} : { compressors: options.compressors }),
      ...(options.rowEnd === undefined ? {} : { rowEnd: options.rowEnd }),
    })
  } catch (error) {
    if (isLowLevelParquetReadFailure(error)) {
      throw createTissuePositionsDecodeError(error, options.columns, options.url)
    }

    throw error
  }
}

async function loadDefaultCompressors(): Promise<Compressors> {
  const { compressors } = await import('hyparquet-compressors')
  return compressors
}

function readJsonNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key]

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  throw new Error(`Expected Visium HD scalefactors ${key} to be a finite number.`)
}

function readOptionalJsonNumber<
  OutputKey extends keyof Pick<
    VisiumHdScalefactors,
    | 'binSizeMicrometers'
    | 'spotDiameterFullres'
    | 'registrationTargetImageScale'
    | 'tissueHiresImageWidth'
    | 'tissueHiresImageHeight'
    | 'tissueLowresImageWidth'
    | 'tissueLowresImageHeight'
  >,
>(
  source: Record<string, unknown>,
  jsonKey: string,
  outputKey: OutputKey,
): Pick<VisiumHdScalefactors, OutputKey> | Record<string, never> {
  const value = source[jsonKey]

  if (value === undefined || value === null) {
    return {}
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return { [outputKey]: value } as Pick<VisiumHdScalefactors, OutputKey>
  }

  throw new Error(`Expected Visium HD scalefactors ${jsonKey} to be a finite number.`)
}

function readOptionalRegistrationTargetImageScale(
  source: Record<string, unknown>,
): Pick<VisiumHdScalefactors, 'registrationTargetImageScale'> | Record<string, never> {
  if (source.regist_target_img_scalef !== undefined) {
    return readOptionalJsonNumber(
      source,
      'regist_target_img_scalef',
      'registrationTargetImageScale',
    )
  }

  return readOptionalJsonNumber(
    source,
    'registration_target_image_scale',
    'registrationTargetImageScale',
  )
}

function readInTissue(row: Record<string, unknown>): 0 | 1 {
  const value = row.in_tissue

  if (value === true || value === 1 || value === 1n) {
    return 1
  }

  if (value === false || value === 0 || value === 0n) {
    return 0
  }

  throw new Error('Expected tissue_positions.parquet in_tissue to be 0 or 1.')
}

function readIntegerColumn(row: Record<string, unknown>, key: string): number {
  const value = readNumericColumn(row, key)

  if (!Number.isInteger(value)) {
    throw new Error(`Expected tissue_positions.parquet ${key} to be an integer.`)
  }

  return value
}

function readNumericColumn(row: Record<string, unknown>, key: string): number {
  const value = row[key]

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  throw new Error(`Expected tissue_positions.parquet ${key} to be numeric.`)
}

function isLowLevelParquetReadFailure(error: unknown): boolean {
  const message = readUnknownErrorMessage(error).toLowerCase()

  return (
    message.includes('offset is outside the bounds of the dataview') ||
    message.includes('invalid typed array length')
  )
}

function createTissuePositionsDecodeError(
  cause: unknown,
  columns: readonly string[],
  url: string | undefined,
): Error {
  const location =
    url === undefined
      ? 'the provided tissue_positions.parquet file'
      : `tissue_positions.parquet at ${url}`
  return new VisiumHdTissuePositionsDecodeError(
    `Unable to decode tissue_positions.parquet while reading columns (${columns.join(', ')}). The file was reachable, but the browser Parquet reader failed on ${location}: ${readUnknownErrorMessage(cause)}.`,
  )
}

function readUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return String(error)
}
