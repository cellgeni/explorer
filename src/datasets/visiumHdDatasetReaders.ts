import { datasetFileUrl } from '../data/datasetFiles'
import { notifyFallback } from '../data/fallbackNotice'
import { isListedAsMissing } from '../data/folderListing'
import { fetchHead, noteReadableResponse } from '../data/hostResponses'
import type { CellFeatureMatrixReadOptions, GexCell, GexResult } from '../data/gex'
import type {
  VisiumFeatureSliceMetadata,
  VisiumFeatureSliceReadOptions,
  VisiumFeatureSliceTarget,
} from '../data/visiumFeatureSlice'
import {
  filterVisiumHdSegmentationElementsByBbox,
  visiumHdSegmentationInfos,
  type VisiumHdSegmentedOutputPaths,
  type VisiumHdSegmentationKind,
} from './visiumHdSegmentationModel'
import type { ReadVisiumHdSegmentationElementsOptions } from './visiumHdSegmentations'
import {
  selectVisiumHdSegmentationIndexElements,
  type VisiumHdSegmentationIndex,
} from './visiumHdSegmentationIndex'
import type {
  ReadVisiumHdSegmentationIndexOptions,
  VisiumHdSegmentationIndexReader,
} from './visiumHdSegmentationIndexWorker'
import type {
  ReadVisiumHdBarcodeMappingsOptions,
  VisiumHdBarcodeMapping,
  VisiumHdBarcodeMappingCellAssignment,
  VisiumHdBarcodeMappingsSourceCache,
} from './visiumHdBarcodeMappings'
import type {
  ReadVisiumHdFilteredMatrixBarcodesOptions,
  VisiumHdSquareBarcodeColumns,
} from './visiumHdBarcodes'
import {
  VisiumHdTwoMicrometerOverviewDisabledError,
  normalizeVisiumHdBarcodeMappingRowBudget,
  normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget,
} from './visiumHdStrategy'
import {
  micrometers,
  type BBox,
  type DataPoint,
  type UnitsDescriptor,
} from '../data/coords'
import {
  deriveNestedGridBasis,
  deriveSubdividedGridBasis,
  gridCellCenter,
  gridCellIntersectsBbox,
} from './spatialGrid'
import type { Compressors } from 'hyparquet'
import type { PersistentByteRangeCache } from '../data/persistentByteRangeCache'
import type {
  DatasetMeta,
  ElementBatch,
  GeneExpressionBatch,
  GeneExpressionGeneCount,
  GridCellBatch,
  ImageSource,
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
  VisiumHdAnnotationQueryOptions,
  VisiumHdBarcodeMappingCellQueryOptions,
  VisiumHdBarcodeMappingQueryOptions,
  VisiumHdBarcodeMappingsForCellReader,
  VisiumHdBinDescriptor,
  VisiumHdBinSizeMicrometers,
  VisiumHdGeneExpressionQueryOptions,
  VisiumHdImageOptions,
} from './visiumHdDataset'
import { visiumHdTablesInWorker } from './visiumHdTablesWorker'
import { normalizeGeneList } from './xeniumDatasetRows'
import { waitForSharedLoad, type SharedLoad } from '../utils/sharedLoad'
import { throwIfAborted } from '../utils/abort'
import type { Annotation, AnnotationGroupOption } from '../data/annotation'

export type VisiumHdTissuePositionsReader = (
  options: ReadVisiumHdTissuePositionsOptions,
) => Promise<VisiumHdTissuePositions>

export type VisiumHdScalefactorsReader = (
  url: string,
  options: ReadVisiumHdScalefactorsOptions,
) => Promise<VisiumHdScalefactors>

export type VisiumHdFeatureGenePanelReader = (
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  options: ReadVisiumHdFeatureGenePanelOptions,
) => Promise<readonly string[]>

export type VisiumHdFilteredMatrixBarcodeReader = (
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  options: ReadVisiumHdFilteredMatrixBarcodesOptions,
) => Promise<VisiumHdSquareBarcodeColumns>

export type VisiumHdBarcodeMappingsReader = (
  baseUrl: string,
  options: ReadVisiumHdBarcodeMappingsOptions,
) => Promise<readonly VisiumHdBarcodeMapping[]>

export type VisiumHdSegmentationReader = (
  baseUrl: string,
  options: ReadVisiumHdSegmentationElementsOptions,
) => Promise<readonly SpatialElement[]>

export type VisiumHdFeatureMatrixReader = (
  url: string,
  ids: readonly SpatialElementId[],
  options?: CellFeatureMatrixReadOptions,
) => Promise<GexResult<SpatialElementId>>

export type VisiumHdFeatureSliceMetadataReader = (
  url: string,
  options: { readonly signal?: AbortSignal },
) => Promise<VisiumFeatureSliceMetadata>

export type VisiumHdFeatureSliceReader = (
  url: string,
  targets: readonly VisiumFeatureSliceTarget<SpatialElementId>[],
  genes: readonly string[],
  options: VisiumFeatureSliceReadOptions,
) => Promise<GexResult<SpatialElementId>>

export interface VisiumHdDatasetReaderControllerOptions {
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
  readonly segmentationIndexReader?: VisiumHdSegmentationIndexReader
  readonly featureMatrixReader?: VisiumHdFeatureMatrixReader
  readonly featureSliceH5Path?: string
  readonly featureSliceReader?: VisiumHdFeatureSliceReader
  readonly featureSliceMetadataReader?: VisiumHdFeatureSliceMetadataReader
  readonly maxTwoMicrometerFilteredBarcodes?: number
  readonly maxInteractiveSegmentationGeojsonBytes?: number
  readonly readObjects?: VisiumHdParquetObjectReader
  readonly loadCompressors?: () => Promise<Compressors>
  readonly byteRangeCache?: PersistentByteRangeCache | null
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

const readVisiumHdSegmentationIndexLazy = async (
  baseUrl: string,
  options: ReadVisiumHdSegmentationIndexOptions,
): Promise<VisiumHdSegmentationIndex> => {
  const { readVisiumHdSegmentationIndexInWorker } =
    await import('./visiumHdSegmentationIndexWorker')
  return readVisiumHdSegmentationIndexInWorker(baseUrl, options)
}

const gexFromFeatureBarcodeMatrixH5Lazy = async (
  url: string,
  ids: readonly SpatialElementId[],
  options?: CellFeatureMatrixReadOptions,
): Promise<GexResult<SpatialElementId>> => {
  const { gexFromFeatureBarcodeMatrixH5 } = await import('../data/gex')
  return gexFromFeatureBarcodeMatrixH5(url, ids, options)
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

const readVisiumFeatureSliceH5MetadataLazy: VisiumHdFeatureSliceMetadataReader = async (
  url,
  options,
) => {
  const { readVisiumFeatureSliceH5Metadata } = await import('../data/visiumFeatureSlice')
  return readVisiumFeatureSliceH5Metadata(url, options)
}

export class VisiumHdDatasetReaderController {
  readonly baseUrl: string
  readonly bins: readonly VisiumHdBinDescriptor[]
  readonly maxTwoMicrometerFilteredBarcodes: number | undefined
  private readonly defaultBinSizeMicrometers: VisiumHdBinSizeMicrometers
  private readonly fetcher: typeof fetch
  // The fetcher the caller gave. Without one, the tables are read in a
  // worker, which fetches with its own fetch (visiumHdTablesWorker.ts).
  private readonly callerFetcher: typeof fetch | undefined
  private readonly tissuePositionsReader: VisiumHdTissuePositionsReader
  private readonly scalefactorsReader: VisiumHdScalefactorsReader
  private readonly featureGenePanelReader: VisiumHdFeatureGenePanelReader
  private readonly filteredMatrixBarcodeReader: VisiumHdFilteredMatrixBarcodeReader
  private readonly barcodeMappingsReader: VisiumHdBarcodeMappingsReader
  private readonly barcodeMappingsForCellReader: VisiumHdBarcodeMappingsForCellReader
  private readonly segmentedOutputs: VisiumHdSegmentedOutputPaths | undefined
  private readonly segmentationReader: VisiumHdSegmentationReader
  private readonly segmentationIndexReader: VisiumHdSegmentationIndexReader
  private readonly featureMatrixReader: VisiumHdFeatureMatrixReader
  private readonly featureSliceH5Path: string
  private readonly featureSliceReader: VisiumHdFeatureSliceReader
  private readonly featureSliceMetadataReader: VisiumHdFeatureSliceMetadataReader
  private readonly maxInteractiveSegmentationGeojsonBytes: number | undefined
  private readonly readObjects: VisiumHdParquetObjectReader | undefined
  private readonly loadCompressors: (() => Promise<Compressors>) | undefined
  private readonly byteRangeCache: PersistentByteRangeCache | null | undefined
  // Shared by every caller, and cancelled only once they all have, such as
  // when the load that opened the dataset is.
  private readonly overviewLoads = new Map<
    VisiumHdBinSizeMicrometers,
    SharedLoad<VisiumHdBinnedOverview>
  >()
  // Expression bins for sizes with no tier, made from a finer one.
  private readonly coarsenedOverviewPromises = new Map<
    VisiumHdBinSizeMicrometers,
    Promise<VisiumHdBinnedOverview>
  >()
  private readonly annotationGroupLoads = new Map<
    VisiumHdBinSizeMicrometers,
    SharedLoad<readonly AnnotationGroupOption[]>
  >()
  private readonly genePanelPromises = new Map<
    VisiumHdBinSizeMicrometers,
    Promise<readonly string[]>
  >()
  private readonly filteredMatrixBarcodePromises = new Map<
    VisiumHdBinSizeMicrometers,
    Promise<VisiumHdSquareBarcodeColumns>
  >()
  private readonly barcodeMappingCellLoads = new Map<
    SpatialElementId,
    SharedLoad<readonly VisiumHdBarcodeMapping[]>
  >()
  // barcode_mappings.parquet's size and footer, read once for all bin reads.
  private readonly barcodeMappingSources: VisiumHdBarcodeMappingsSourceCache = new Map()
  // Segmentation GeoJSON is read once per file into an index that every
  // viewport selects from. The read is not tied to a request's signal, so
  // panning while it runs does not start it again.
  private readonly segmentationIndexPromises = new Map<
    string,
    Promise<VisiumHdSegmentationIndex>
  >()
  // The last viewport's elements per index, reused by the next request so
  // polygons still in view keep the same objects.
  private readonly segmentationSelections = new Map<
    string,
    {
      readonly index: VisiumHdSegmentationIndex
      readonly elements: ReadonlyMap<number, SpatialElement>
    }
  >()

  constructor(options: VisiumHdDatasetReaderControllerOptions) {
    this.baseUrl = normalizeVisiumHdBaseUrl(options.baseUrl)
    this.bins = options.bins
    this.defaultBinSizeMicrometers =
      options.defaultBinSizeMicrometers ?? preferredDefaultBinSize(options.bins)
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.callerFetcher = options.fetcher
    this.tissuePositionsReader =
      options.tissuePositionsReader ?? visiumHdTablesInWorker.tissuePositions
    this.scalefactorsReader = options.scalefactorsReader ?? readVisiumHdScalefactorsLazy
    this.featureGenePanelReader =
      options.featureGenePanelReader ?? readVisiumHdFeatureGenePanelLazy
    this.filteredMatrixBarcodeReader =
      options.filteredMatrixBarcodeReader ?? visiumHdTablesInWorker.filteredMatrixBarcodes
    this.barcodeMappingsReader =
      options.barcodeMappingsReader ?? readVisiumHdBarcodeMappingsLazy
    this.barcodeMappingsForCellReader =
      options.barcodeMappingsForCellReader ?? readVisiumHdBarcodeMappingsForCellWithDuckDb
    this.segmentedOutputs = options.segmentedOutputs
    this.segmentationReader =
      options.segmentationReader ?? readVisiumHdSegmentationElementsLazy
    this.segmentationIndexReader =
      options.segmentationIndexReader ?? readVisiumHdSegmentationIndexLazy
    this.featureMatrixReader =
      options.featureMatrixReader ?? gexFromFeatureBarcodeMatrixH5Lazy
    this.featureSliceH5Path = options.featureSliceH5Path ?? 'feature_slice.h5'
    this.featureSliceReader =
      options.featureSliceReader ?? gexFromVisiumFeatureSliceH5Lazy
    this.featureSliceMetadataReader =
      options.featureSliceMetadataReader ?? readVisiumFeatureSliceH5MetadataLazy
    this.maxTwoMicrometerFilteredBarcodes =
      normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget(
        options.maxTwoMicrometerFilteredBarcodes,
      )
    this.maxInteractiveSegmentationGeojsonBytes =
      options.maxInteractiveSegmentationGeojsonBytes
    this.readObjects = options.readObjects
    this.loadCompressors = options.loadCompressors
    this.byteRangeCache = options.byteRangeCache
  }

  // Forgets every read kept, so the next read starts afresh.
  dispose(): void {
    this.overviewLoads.clear()
    this.coarsenedOverviewPromises.clear()
    this.annotationGroupLoads.clear()
    this.genePanelPromises.clear()
    this.filteredMatrixBarcodePromises.clear()
    this.barcodeMappingCellLoads.clear()
    this.barcodeMappingSources.clear()
    this.segmentationIndexPromises.clear()
    this.segmentationSelections.clear()
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

  // The tier's Space Ranger clusterings, read once per tier. A tier without
  // an analysis folder, such as 2 µm, has none.
  annotationGroups(
    binSizeMicrometers = this.defaultBinSizeMicrometers,
    options: VisiumHdAnnotationQueryOptions = {},
  ): Promise<readonly AnnotationGroupOption[]> {
    const bin = this.bins.find(
      (candidate) => candidate.binSizeMicrometers === binSizeMicrometers,
    )

    if (bin === undefined) {
      return Promise.resolve([])
    }

    return waitForSharedLoad(
      this.annotationGroupLoads,
      binSizeMicrometers,
      async (signal) => {
        const { readVisiumHdClusteringGroups } = await import('./visiumHdClusters')
        return readVisiumHdClusteringGroups(this.baseUrl, bin, {
          fetcher: this.fetcher,
          signal,
        })
      },
      options.signal,
    )
  }

  // One clustering's clusters, named by its set id, which carries its tier;
  // without one, every clustering of the tier.
  async annotations(
    options: VisiumHdAnnotationQueryOptions = {},
  ): Promise<readonly Annotation<SpatialElementId>[]> {
    const group =
      options.groupId === undefined
        ? null
        : (await import('./visiumHdClusters')).parseVisiumHdClusteringGroupId(
            options.groupId,
          )

    if (options.groupId !== undefined && group === null) {
      throw new Error(`Visium HD has no annotation set ${options.groupId}.`)
    }

    const binSizeMicrometers =
      group?.binSizeMicrometers ??
      options.binSizeMicrometers ??
      this.defaultBinSizeMicrometers
    const bin = findBin(this.bins, binSizeMicrometers)
    const clusterings =
      group === null
        ? (await this.annotationGroups(binSizeMicrometers, options)).map(
            (option) => option.groupingName,
          )
        : [group.clustering]
    const { readVisiumHdClusterAnnotations } = await import('./visiumHdClusters')
    const sets = await Promise.all(
      clusterings.map((clustering) =>
        readVisiumHdClusterAnnotations(this.baseUrl, bin, clustering, {
          fetcher: this.fetcher,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      ),
    )

    return sets.flat()
  }

  filteredMatrixBarcodes(
    binSizeMicrometers = this.defaultBinSizeMicrometers,
    options: ReadVisiumHdFilteredMatrixBarcodesOptions = {},
  ): Promise<VisiumHdSquareBarcodeColumns> {
    const existing = this.filteredMatrixBarcodePromises.get(binSizeMicrometers)

    if (existing !== undefined && options.signal === undefined) {
      return existing
    }

    const bin = findBin(this.bins, binSizeMicrometers)
    const promise = this.filteredMatrixBarcodeReader(this.baseUrl, bin, {
      ...this.callerFetcherOption(),
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

  barcodeMappingsForCell(
    cellId: SpatialElementId,
    options: VisiumHdBarcodeMappingCellQueryOptions = {},
  ): Promise<readonly VisiumHdBarcodeMapping[]> {
    return waitForSharedLoad(
      this.barcodeMappingCellLoads,
      cellId,
      (signal) => this.barcodeMappingsForCellReader(this.baseUrl, cellId, { signal }),
      options.signal,
    )
  }

  // Reads only the row groups that may hold `binIds`: for one bin, a few
  // row groups in one range request, after the footer on the first read.
  async barcodeMappingAssignments(
    binSizeMicrometers: VisiumHdBinSizeMicrometers,
    binIds: readonly SpatialElementId[],
    options: VisiumHdBarcodeMappingQueryOptions,
  ): Promise<readonly VisiumHdBarcodeMappingCellAssignment[]> {
    if (binIds.length === 0) {
      return []
    }

    const maxRows =
      options.maxRows === undefined
        ? undefined
        : normalizeVisiumHdBarcodeMappingRowBudget(options.maxRows)
    const [mappings, barcodeMappingsModule] = await Promise.all([
      this.barcodeMappingsReader(this.baseUrl, {
        ...(maxRows === undefined ? {} : { maxRows }),
        bins: { binSizeMicrometers, binIds },
        sourceCache: this.barcodeMappingSources,
        ...this.barcodeMappingReadOptions(),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
      import('./visiumHdBarcodeMappings'),
    ])

    return barcodeMappingsModule.selectVisiumHdBarcodeMappingAssignments(
      mappings,
      binSizeMicrometers,
      binIds,
    )
  }

  private barcodeMappingReadOptions(): Omit<ReadVisiumHdBarcodeMappingsOptions, 'bins'> {
    return {
      ...this.callerFetcherOption(),
      readRangesInWorker: visiumHdTablesInWorker.barcodeMappingRanges,
      ...(this.readObjects === undefined ? {} : { readObjects: this.readObjects }),
      ...(this.loadCompressors === undefined
        ? {}
        : { loadCompressors: this.loadCompressors }),
      ...(this.byteRangeCache === undefined
        ? {}
        : { byteRangeCache: this.byteRangeCache }),
    }
  }

  private callerFetcherOption(): { readonly fetcher?: typeof fetch } {
    return this.callerFetcher === undefined ? {} : { fetcher: this.callerFetcher }
  }

  async segmentationElements(
    kind: VisiumHdSegmentationKind,
    bbox: BBox,
    binSizeMicrometers = this.defaultBinSizeMicrometers,
  ): Promise<readonly SpatialElement[]> {
    const overview = await this.readBinnedOverview(binSizeMicrometers)
    return this.segmentationElementsWithScalefactors(kind, bbox, overview.scalefactors)
  }

  // The high-res tissue PNG, else the low-res one with its own scale factor
  // and size, as for standard Visium. When neither can be read, the high-res
  // image is returned and fails to load as before.
  async image(
    binSizeMicrometers = this.defaultBinSizeMicrometers,
    options: VisiumHdImageOptions = {},
  ): Promise<ImageSource | null> {
    const overview = await this.readBinnedOverview(binSizeMicrometers)
    const { scalefactors, sourcePaths } = overview
    const hires = await probeTissueImage(
      datasetFileUrl(this.baseUrl, sourcePaths.tissueHiresImage),
      this.fetcher,
    )
    const lowres =
      hires === null
        ? undefined
        : await probeTissueImage(
            datasetFileUrl(this.baseUrl, sourcePaths.tissueLowresImage),
            this.fetcher,
          )

    if (hires !== null && lowres === null) {
      notifyFallback(options.onFallback, {
        source: 'Morphology image',
        message: `${sourcePaths.tissueHiresImage} ${hires}, so the app shows ${sourcePaths.tissueLowresImage}, the low-res tissue image, instead.`,
        action:
          'Add the high-res tissue image to the dataset folder to show the tissue in more detail.',
        coalesceKey: `visium-hd-tissue-image:${this.baseUrl}`,
      })

      return flatImageSource(
        datasetFileUrl(this.baseUrl, sourcePaths.tissueLowresImage),
        scalefactors.tissueLowresScale,
        scalefactors.tissueLowresImageWidth,
        scalefactors.tissueLowresImageHeight,
      )
    }

    return flatImageSource(
      datasetFileUrl(this.baseUrl, sourcePaths.tissueHiresImage),
      scalefactors.tissueHiresScale,
      scalefactors.tissueHiresImageWidth,
      scalefactors.tissueHiresImageHeight,
    )
  }

  async geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: VisiumHdGeneExpressionQueryOptions = {},
  ): Promise<GeneExpressionBatch> {
    return readVisiumHdGeneExpression({
      baseUrl: this.baseUrl,
      bbox,
      featureSliceH5Path: this.featureSliceH5Path,
      featureSliceReader: this.featureSliceReader,
      fetcher: this.fetcher,
      genes,
      readBinnedOverview: (binSizeMicrometers) =>
        this.expressionOverview(binSizeMicrometers),
      queryOptions: options,
    })
  }

  // The bins expression is read for. A size with no tier of its own, such as
  // the 16 µm stand-in for zoomed-out 2 µm bins in a dataset with only a 2 µm
  // tier, is made from the finest tier that nests in it.
  private expressionOverview(
    binSizeMicrometers = this.defaultBinSizeMicrometers,
  ): Promise<VisiumHdBinnedOverview> {
    const sourceBinSize = coarsenedOverviewSourceBinSize(
      this.bins,
      binSizeMicrometers,
      (size) => this.overviewLoads.get(size)?.aborted === false,
    )

    if (sourceBinSize === undefined) {
      return this.readBinnedOverview(binSizeMicrometers)
    }

    const existing = this.coarsenedOverviewPromises.get(binSizeMicrometers)

    if (existing !== undefined) {
      return existing
    }

    const promise = Promise.all([
      this.readBinnedOverview(sourceBinSize),
      import('./visiumHdOverview'),
    ])
      .then(([source, overviewModule]) =>
        overviewModule.coarsenVisiumHdBinnedOverview(source, binSizeMicrometers),
      )
      .catch((error: unknown) => {
        if (this.coarsenedOverviewPromises.get(binSizeMicrometers) === promise) {
          this.coarsenedOverviewPromises.delete(binSizeMicrometers)
        }

        throw error
      })

    this.coarsenedOverviewPromises.set(binSizeMicrometers, promise)
    return promise
  }

  readBinnedOverview(
    binSizeMicrometers = this.defaultBinSizeMicrometers,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<VisiumHdBinnedOverview> {
    return waitForSharedLoad(
      this.overviewLoads,
      binSizeMicrometers,
      (signal) =>
        binSizeMicrometers === 2
          ? this.readTwoMicrometerOverviewFromFilteredBarcodes(signal)
          : this.readTierOverview(binSizeMicrometers, signal),
      options.signal,
    )
  }

  private readTierOverview(
    binSizeMicrometers: VisiumHdBinSizeMicrometers,
    signal: AbortSignal,
  ): Promise<VisiumHdBinnedOverview> {
    const bin = findBin(this.bins, binSizeMicrometers)
    const basisSourceBinSize = nestedBasisSourceBinSize(this.bins, binSizeMicrometers)
    const basis =
      basisSourceBinSize === undefined
        ? undefined
        : this.readBinnedOverview(basisSourceBinSize, { signal }).then((sourceOverview) =>
            deriveNestedGridBasis(
              sourceOverview.grid.basis,
              binSizeMicrometers / basisSourceBinSize,
            ),
          )

    return readVisiumHdBinnedOverviewLazy({
      baseUrl: this.baseUrl,
      bin,
      ...(basis === undefined ? {} : { basis }),
      ...this.callerFetcherOption(),
      tissuePositionsReader: this.tissuePositionsReader,
      scalefactorsReader: this.scalefactorsReader,
      ...(this.readObjects === undefined ? {} : { readObjects: this.readObjects }),
      ...(this.loadCompressors === undefined
        ? {}
        : { loadCompressors: this.loadCompressors }),
      ...(this.byteRangeCache === undefined
        ? {}
        : { byteRangeCache: this.byteRangeCache }),
      signal,
    })
  }

  private async readTwoMicrometerOverviewFromFilteredBarcodes(
    signal: AbortSignal,
  ): Promise<VisiumHdBinnedOverview> {
    const bin = findBin(this.bins, 2)
    const sourceBinSize = preferredTwoMicrometerBasisSourceBinSize(this.bins)
    const [basisSource, scalefactors, barcodes, overviewModule] = await Promise.all([
      sourceBinSize === undefined
        ? this.featureSliceMetadataForBasis()
        : this.readBinnedOverview(sourceBinSize, { signal }),
      this.scalefactorsReader(datasetFileUrl(this.baseUrl, bin.scalefactorsPath), {
        fetcher: this.fetcher,
        signal,
      }),
      this.filteredMatrixBarcodeReader(this.baseUrl, bin, {
        ...this.callerFetcherOption(),
        ...(this.maxTwoMicrometerFilteredBarcodes === undefined
          ? {}
          : { maxBarcodeCount: this.maxTwoMicrometerFilteredBarcodes }),
        signal,
      }),
      import('./visiumHdOverview'),
    ])
    // A coarser tier's fitted basis, halved down to 2 µm; else the
    // Feature Slice spot transform.
    const basis =
      'grid' in basisSource
        ? deriveSubdividedGridBasis(
            basisSource.grid.basis,
            basisSource.binSizeMicrometers / 2,
          )
        : overviewModule.visiumHdGridBasisFromFeatureSlice(basisSource, scalefactors, 2)

    if (basis === null) {
      throw new VisiumHdTwoMicrometerOverviewDisabledError(
        `${this.featureSliceH5Path} has no spot transform (transform_matrices.spot_colrow_to_microscope_colrow), and there is no 8 µm or 16 µm tier to place the 2 µm bins from.`,
      )
    }

    return overviewModule.createVisiumHdBinnedOverviewFromSquareBarcodes(
      bin,
      barcodes,
      scalefactors,
      basis,
    )
  }

  // feature_slice.h5's metadata, for a dataset with only a 2 µm tier. Its
  // spot transform places the bins.
  private async featureSliceMetadataForBasis(): Promise<VisiumFeatureSliceMetadata> {
    try {
      return await this.featureSliceMetadataReader(
        datasetFileUrl(this.baseUrl, this.featureSliceH5Path),
        {},
      )
    } catch (error) {
      throw new VisiumHdTwoMicrometerOverviewDisabledError(
        `With no 8 µm or 16 µm tier, the 2 µm bins are placed by ${this.featureSliceH5Path}, which could not be read: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
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

    const key = segmentationIndexKey(source.path, kind, scalefactors)
    const index = await this.segmentationIndex(key, source.path, kind, scalefactors)
    const previous = this.segmentationSelections.get(key)
    const elements = selectVisiumHdSegmentationIndexElements(
      index,
      bbox,
      previous?.index === index ? previous.elements : undefined,
    )

    this.segmentationSelections.set(key, { index, elements })
    return Array.from(elements.values())
  }

  private segmentationIndex(
    key: string,
    path: string,
    kind: VisiumHdSegmentationKind,
    scalefactors: VisiumHdScalefactors,
  ): Promise<VisiumHdSegmentationIndex> {
    const existing = this.segmentationIndexPromises.get(key)

    if (existing !== undefined) {
      return existing
    }

    const promise = this.segmentationIndexReader(this.baseUrl, {
      path,
      scalefactors,
      kind,
      fetcher: this.fetcher,
      ...(this.maxInteractiveSegmentationGeojsonBytes === undefined
        ? {}
        : { maxFullFileBytes: this.maxInteractiveSegmentationGeojsonBytes }),
    }).catch((error: unknown) => {
      if (this.segmentationIndexPromises.get(key) === promise) {
        this.segmentationIndexPromises.delete(key)
      }

      throw error
    })

    this.segmentationIndexPromises.set(key, promise)
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

export function normalizeVisiumHdBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export function preferredDefaultBinSize(
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

export function findBin(
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

// The size comes from the scalefactors when they record it; otherwise the
// browser measures the loaded image.
function flatImageSource(
  url: string,
  scaleFactor: number,
  width: number | undefined,
  height: number | undefined,
): ImageSource {
  return {
    kind: 'flat',
    url,
    scaleFactor,
    ...(width === undefined || height === undefined ? {} : { size: [width, height] }),
  }
}

// Null when the tissue image can be fetched, else why not. A file the dataset
// folder's listing leaves out is not requested; otherwise a HEAD request
// checks it, as detection does.
async function probeTissueImage(
  url: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  if (isListedAsMissing(url)) {
    return 'is not in the dataset folder listing'
  }

  try {
    const response = await fetchHead(fetcher, url)
    noteReadableResponse(url, response.status)
    return response.ok ? null : `could not be read (HTTP ${response.status})`
  } catch (error) {
    return `could not be read (${error instanceof Error ? error.message : String(error)})`
  }
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

// A finer tier that nests in `binSizeMicrometers` bins, when the dataset has
// no tier of that size; else undefined. One already read is preferred, else
// the coarsest, which has the fewest bins to read.
function coarsenedOverviewSourceBinSize(
  bins: readonly VisiumHdBinDescriptor[],
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
  isRead: (binSizeMicrometers: VisiumHdBinSizeMicrometers) => boolean,
): VisiumHdBinSizeMicrometers | undefined {
  if (bins.some((bin) => bin.binSizeMicrometers === binSizeMicrometers)) {
    return undefined
  }

  const candidates = bins
    .map((bin) => bin.binSizeMicrometers)
    .filter((size) => size < binSizeMicrometers && binSizeMicrometers % size === 0)
    .sort((left, right) => right - left)

  return candidates.find(isRead) ?? candidates[0]
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

function segmentationIndexKey(
  path: string,
  kind: VisiumHdSegmentationKind,
  scalefactors: VisiumHdScalefactors,
): string {
  return `${path}\n${kind}\n${scalefactors.micronsPerPixel}`
}

function selectGridCellsInBbox(
  overview: VisiumHdBinnedOverview,
  bbox: BBox,
): GridCellBatch<SpatialElementId> {
  let count = 0

  for (let index = 0; index < overview.gridCells.rows.length; index += 1) {
    const row = overview.gridCells.rows[index] ?? 0
    const col = overview.gridCells.cols[index] ?? 0

    if (gridCellIntersectsBbox(overview.grid, row, col, bbox)) {
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

    if (!gridCellIntersectsBbox(overview.grid, row, col, bbox)) {
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

async function readVisiumHdGeneExpression(options: {
  readonly baseUrl: string
  readonly bbox: BBox
  readonly featureSliceH5Path: string
  readonly featureSliceReader: VisiumHdFeatureSliceReader
  readonly fetcher: typeof fetch
  readonly genes: readonly string[]
  readonly readBinnedOverview: (
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
  ) => Promise<VisiumHdBinnedOverview>
  readonly queryOptions?: VisiumHdGeneExpressionQueryOptions
}): Promise<GeneExpressionBatch> {
  const queryOptions = options.queryOptions ?? {}
  const totalStartedAt = Date.now()
  const selectedGenes = normalizeGeneList(options.genes)

  if (selectedGenes.length === 0) {
    return {
      elements: [],
      genes: [],
      population: 'all',
      maxCount: 0,
    }
  }

  // Only bins with expression are listed, so `sampleStride` has nothing to
  // thin: every bin in the box is read, so that no expressing bin is lost. A
  // feature slice is read a gene at a time, so more bins cost no more reads.
  // Without a limit, that is every bin in the box.
  const limit = queryOptions.limit ?? null
  throwIfAborted(queryOptions.signal)
  const viewportBinsStartedAt = Date.now()
  const overview = await options.readBinnedOverview(queryOptions.binSizeMicrometers)
  const viewportBins = selectExpressionBinsInBbox(overview, options.bbox, limit)
  const viewportCellsMs = elapsedMs(viewportBinsStartedAt)
  queryOptions.onStageTiming?.({
    stage: 'viewport-cells',
    label: 'Viewport bin query',
    durationMs: viewportCellsMs,
    detail: `${viewportBins.length.toLocaleString()} bins, ${limit === null ? 'no limit' : `limit ${limit.toLocaleString()}`}`,
  })
  throwIfAborted(queryOptions.signal)

  if (viewportBins.length === 0) {
    return {
      elements: [],
      genes: selectedGenes,
      population: 'all',
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
  const matrix = await options.featureSliceReader(
    datasetFileUrl(options.baseUrl, options.featureSliceH5Path),
    viewportBins,
    selectedGenes,
    {
      binSizeMicrometers: overview.binSizeMicrometers,
      ...(queryOptions.signal === undefined ? {} : { signal: queryOptions.signal }),
      ...(queryOptions.onStageTiming === undefined
        ? {}
        : { onStageTiming: queryOptions.onStageTiming }),
    },
  )
  const matrixReadMs = elapsedMs(matrixReadStartedAt)
  queryOptions.onStageTiming?.({
    stage: 'matrix-read',
    label: 'Expression matrix read',
    durationMs: matrixReadMs,
    detail: `${selectedGenes.length.toLocaleString()} genes, ${viewportBins.length.toLocaleString()} bins`,
  })
  throwIfAborted(queryOptions.signal)
  const scoreCellsStartedAt = Date.now()
  const selectedGeneSet = new Set(selectedGenes)
  const geneCounts = selectedGeneCounts(matrix, selectedGenes)
  const elements: GeneExpressionBatch['elements'][number][] = []
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

    elements.push({
      id: bin.id,
      position: bin.position,
      count,
      cellArea: overview.binSizeMicrometers * overview.binSizeMicrometers,
      binSizeMicrometers: overview.binSizeMicrometers,
    })
    maxCount = Math.max(maxCount, count)
  }
  const scoreCellsMs = elapsedMs(scoreCellsStartedAt)
  queryOptions.onStageTiming?.({
    stage: 'score-cells',
    label: 'Expression scoring',
    durationMs: scoreCellsMs,
    detail: `${elements.length.toLocaleString()} positive bins`,
  })

  // Every bin in the box is what a z-score compares with; only those with
  // expression are listed.
  return {
    elements,
    genes: selectedGenes,
    population: 'expressing',
    cellCount: viewportBins.length,
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

function selectExpressionBinsInBbox(
  overview: VisiumHdBinnedOverview,
  bbox: BBox,
  maxBins: number | null,
): readonly VisiumHdExpressionBin[] {
  const limit = maxBins === null ? Number.POSITIVE_INFINITY : normalizeLimit(maxBins)

  if (limit === 0) {
    return []
  }

  const bins: VisiumHdExpressionBin[] = []

  for (let index = 0; index < overview.gridCells.rows.length; index += 1) {
    const row = overview.gridCells.rows[index] ?? 0
    const col = overview.gridCells.cols[index] ?? 0

    if (!gridCellIntersectsBbox(overview.grid, row, col, bbox)) {
      continue
    }

    bins.push({
      id: overview.gridCells.ids[index] ?? '',
      row,
      col,
      position: gridCellCenter(overview.grid, row, col),
    })

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

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 5_000
  }

  return Math.max(0, Math.floor(limit))
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt
}
