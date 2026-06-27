import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { micrometers } from '../data/coords'
import type {
  AppDependencies,
  AppDependencyOverrides,
  AppDependencySlotOverrides,
  SpatialDatasetDetector,
  SpatialDatasetLoader,
} from '../features/app-shell/appDependencies'
import type {
  SpatialDatasetDetection,
  DatasetProbeResult,
} from '../datasets/datasetFactory'
import type {
  DatasetMeta,
  ImageSource,
  SegmentationInfo,
} from '../datasets/spatialDataset'
import type {
  VisiumHdBinDescriptor,
  VisiumHdBinnedOverview,
} from '../datasets/visiumHdDataset'
import type { VisiumHdSegmentedOutputPaths } from '../datasets/visiumHdSegmentations'

type VisiumHdDetection = Extract<
  SpatialDatasetDetection,
  { readonly platform: 'visium-hd' }
>

type AppViewportFixture = {
  readonly rect: DOMRect
  readonly restore: () => void
}

type MutableDependencyGroup<TGroup> = {
  -readonly [Key in keyof TGroup]?: TGroup[Key]
}

type MutableDependencyOverrides = {
  -readonly [Group in keyof AppDependencyOverrides]?: AppDependencyOverrides[Group]
}

interface CreateVisiumHdDetectionOptions {
  readonly baseUrl?: string
  readonly bins?: readonly VisiumHdBinDescriptor[]
  readonly checked?: readonly DatasetProbeResult[]
  readonly segmentedScalefactorsPath?: string
  readonly segmentedOutputs?: VisiumHdSegmentedOutputPaths
}

interface CreateVisiumHdMetaOptions {
  readonly platform?: DatasetMeta['platform']
  readonly capabilities?: Partial<DatasetMeta['capabilities']>
  readonly segmentations?: readonly SegmentationInfo[]
}

interface CreateVisiumHdDatasetMockOptions<
  TOverrides extends Record<string, unknown> = Record<string, never>,
> {
  readonly overview?: VisiumHdBinnedOverview
  readonly meta?: DatasetMeta
  readonly image?: ImageSource | null
  readonly overrides?: TOverrides
}

export const VISIUM_HD_TEST_URL = 'https://example.test/visium-hd'

export type AppTestDependencyProps = AppDependencySlotOverrides

export function appTestDependencies({
  computeAutoChannelContrast,
  detectSpatialDataset,
  getSpatialDataset,
  loadAnalysisEmbeddings,
  loadAnnotationGroups,
  loadAnnotations,
  loadBoundaryElements,
  loadCellTranscriptDistribution,
  loadCustomMorphologyLayer,
  loadDatasetOverview,
  loadGeneExpression,
  loadGenePanel,
  loadMorphologyImage,
  loadRoiCells,
  loadRoiGeneStats,
  loadRoiTranscripts,
  loadTranscriptAggregates,
  loadTranscriptCapabilities,
  loadTranscriptViewport,
  runDatasetDiagnostics,
  warmDatasetForRoi,
}: AppTestDependencyProps = {}): AppDependencyOverrides {
  const dataset: MutableDependencyGroup<AppDependencies['dataset']> = {}
  const morphology: MutableDependencyGroup<AppDependencies['morphology']> = {}
  const spatialElements: MutableDependencyGroup<AppDependencies['spatialElements']> = {}
  const annotations: MutableDependencyGroup<AppDependencies['annotations']> = {}
  const analysis: MutableDependencyGroup<AppDependencies['analysis']> = {}
  const roi: MutableDependencyGroup<AppDependencies['roi']> = {}
  const transcripts: MutableDependencyGroup<AppDependencies['transcripts']> = {}
  const genes: MutableDependencyGroup<AppDependencies['genes']> = {}
  const diagnostics: MutableDependencyGroup<AppDependencies['diagnostics']> = {}
  const dependencies: MutableDependencyOverrides = {}

  if (loadDatasetOverview !== undefined) dataset.loadDatasetOverview = loadDatasetOverview
  if (loadGenePanel !== undefined) dataset.loadGenePanel = loadGenePanel
  if (detectSpatialDataset !== undefined) dataset.detectSpatialDataset = detectSpatialDataset
  if (getSpatialDataset !== undefined) dataset.getSpatialDataset = getSpatialDataset
  if (warmDatasetForRoi !== undefined) dataset.warmDatasetForRoi = warmDatasetForRoi

  if (loadMorphologyImage !== undefined) morphology.loadMorphologyImage = loadMorphologyImage
  if (loadCustomMorphologyLayer !== undefined) {
    morphology.loadCustomMorphologyLayer = loadCustomMorphologyLayer
  }
  if (computeAutoChannelContrast !== undefined) {
    morphology.computeAutoChannelContrast = computeAutoChannelContrast
  }

  if (loadBoundaryElements !== undefined) {
    spatialElements.loadBoundaryElements = loadBoundaryElements
  }

  if (loadAnnotations !== undefined) annotations.loadAnnotations = loadAnnotations
  if (loadAnnotationGroups !== undefined) {
    annotations.loadAnnotationGroups = loadAnnotationGroups
  }

  if (loadAnalysisEmbeddings !== undefined) {
    analysis.loadAnalysisEmbeddings = loadAnalysisEmbeddings
  }

  if (loadRoiCells !== undefined) roi.loadRoiCells = loadRoiCells
  if (loadRoiGeneStats !== undefined) roi.loadRoiGeneStats = loadRoiGeneStats
  if (loadRoiTranscripts !== undefined) roi.loadRoiTranscripts = loadRoiTranscripts

  if (loadCellTranscriptDistribution !== undefined) {
    transcripts.loadCellTranscriptDistribution = loadCellTranscriptDistribution
  }
  if (loadTranscriptCapabilities !== undefined) {
    transcripts.loadTranscriptCapabilities = loadTranscriptCapabilities
  }
  if (loadTranscriptAggregates !== undefined) {
    transcripts.loadTranscriptAggregates = loadTranscriptAggregates
  }
  if (loadTranscriptViewport !== undefined) {
    transcripts.loadTranscriptViewport = loadTranscriptViewport
  }

  if (loadGeneExpression !== undefined) genes.loadGeneExpression = loadGeneExpression
  if (runDatasetDiagnostics !== undefined) {
    diagnostics.runDatasetDiagnostics = runDatasetDiagnostics
  }

  if (Object.keys(dataset).length > 0) dependencies.dataset = dataset
  if (Object.keys(morphology).length > 0) dependencies.morphology = morphology
  if (Object.keys(spatialElements).length > 0) {
    dependencies.spatialElements = spatialElements
  }
  if (Object.keys(annotations).length > 0) dependencies.annotations = annotations
  if (Object.keys(analysis).length > 0) dependencies.analysis = analysis
  if (Object.keys(roi).length > 0) dependencies.roi = roi
  if (Object.keys(transcripts).length > 0) dependencies.transcripts = transcripts
  if (Object.keys(genes).length > 0) dependencies.genes = genes
  if (Object.keys(diagnostics).length > 0) dependencies.diagnostics = diagnostics

  return dependencies
}

export function openHudTab(name: string): void {
  fireEvent.click(screen.getByRole('tab', { name }))
}

export function pendingPromise<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

export function deferredPromise<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

export function appViewportRectFixture(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 320,
    height: 190,
    top: 0,
    right: 320,
    bottom: 190,
    left: 0,
    toJSON: () => ({}),
    ...overrides,
  } as DOMRect
}

export function installAppViewportFixture(
  rect = appViewportRectFixture(),
): AppViewportFixture {
  const rectSpy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(rect)
  const contextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(null)

  return {
    rect,
    restore: () => {
      rectSpy.mockRestore()
      contextSpy.mockRestore()
    },
  }
}

export function visiumHdBinFixture(
  overrides: Partial<VisiumHdBinDescriptor> = {},
): VisiumHdBinDescriptor {
  return {
    binSizeMicrometers: 16,
    outputPath: 'binned_outputs/square_016um',
    tissuePositionsPath: 'binned_outputs/square_016um/spatial/tissue_positions.parquet',
    scalefactorsPath: 'binned_outputs/square_016um/spatial/scalefactors_json.json',
    filteredMatrixH5Path: 'binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
    ...overrides,
  }
}

export function visiumHdDetectionFixture({
  baseUrl = VISIUM_HD_TEST_URL,
  bins = [visiumHdBinFixture()],
  checked = [],
  segmentedScalefactorsPath,
  segmentedOutputs,
}: CreateVisiumHdDetectionOptions = {}): VisiumHdDetection {
  return {
    platform: 'visium-hd',
    baseUrl,
    bins,
    checked,
    ...(segmentedScalefactorsPath === undefined ? {} : { segmentedScalefactorsPath }),
    ...(segmentedOutputs === undefined ? {} : { segmentedOutputs }),
  }
}

export function visiumOverviewFixture(): VisiumHdBinnedOverview {
  const grid = {
    id: 'grid-16um',
    binSizeMicrometers: micrometers(16),
    basis: {
      origin: { x: micrometers(10), y: micrometers(5) },
      rowStep: { x: micrometers(0), y: micrometers(10) },
      colStep: { x: micrometers(10), y: micrometers(0) },
    },
  }

  return {
    binSizeMicrometers: 16,
    scalefactors: {
      micronsPerPixel: 1,
      tissueHiresScale: 1,
      tissueLowresScale: 0.1,
      binSizeMicrometers: 16,
      spotDiameterFullres: 16,
    },
    grid,
    gridCells: {
      kind: 'grid-cells',
      gridId: grid.id,
      ids: ['BC-1', 'BC-2'],
      rows: new Int32Array([0, 0]),
      cols: new Int32Array([0, 1]),
    },
    fullresRows: new Float64Array([5, 5]),
    fullresCols: new Float64Array([10, 20]),
    inTissue: new Uint8Array([1, 1]),
    sourcePaths: {
      tissuePositions: 'binned_outputs/square_016um/spatial/tissue_positions.parquet',
      scalefactors: 'binned_outputs/square_016um/spatial/scalefactors_json.json',
      tissueHiresImage: 'binned_outputs/square_016um/spatial/tissue_hires_image.png',
      tissueLowresImage: 'binned_outputs/square_016um/spatial/tissue_lowres_image.png',
      filteredMatrixH5: 'binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
    },
  }
}

export function visiumHdMetaFixture(
  overview = visiumOverviewFixture(),
  {
    platform = 'visium-hd',
    capabilities = {},
    segmentations,
  }: CreateVisiumHdMetaOptions = {},
): DatasetMeta {
  return {
    platform,
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(1),
      origin: 'top-left',
      imageYAxis: 'down',
    },
    extent: {
      minX: micrometers(0),
      maxX: micrometers(40),
      minY: micrometers(0),
      maxY: micrometers(20),
    },
    capabilities: {
      transcripts: false,
      cellBoundaries: false,
      pyramidImage: false,
      multiChannel: false,
      ...capabilities,
    },
    grids: [overview.grid],
    ...(segmentations === undefined ? {} : { segmentations }),
  }
}

export function createVisiumHdDatasetMock<
  TOverrides extends Record<string, unknown> = Record<string, never>,
>(options: CreateVisiumHdDatasetMockOptions<TOverrides> = {}) {
  const overview = options.overview ?? visiumOverviewFixture()
  const meta = options.meta ?? visiumHdMetaFixture(overview)
  const image = options.image ?? null
  const overrides = options.overrides ?? ({} as TOverrides)

  return {
    readBinnedOverview: vi.fn(async () => overview),
    meta: vi.fn(async () => meta),
    image: vi.fn(async () => image),
    ...overrides,
  }
}

export function createVisiumHdDetectorMock(
  detection = visiumHdDetectionFixture(),
): ReturnType<typeof vi.fn<SpatialDatasetDetector>> {
  return vi.fn(async () => detection)
}

export function createSpatialDatasetLoaderMock(
  dataset: unknown,
): ReturnType<typeof vi.fn<SpatialDatasetLoader>> {
  return vi.fn(
    async () => dataset as Awaited<ReturnType<SpatialDatasetLoader>>,
  )
}
