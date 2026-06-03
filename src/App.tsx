import type { CSSProperties, FormEvent, PointerEvent } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ViewerCore, type ViewerCoordinateUnit } from './components/ViewerCore'
import { scaffoldDeckLayerCount } from './components/viewerCoreModel'
import {
  ALL_ANNOTATION_GROUP_ID,
  loadDatasetAnnotationGroups as defaultLoadDatasetAnnotationGroups,
  loadDatasetAnnotations as defaultLoadDatasetAnnotations,
} from './data/datasetAnnotations'
import { loadDatasetBoundaryElements as defaultLoadBoundaryElements } from './data/datasetBoundaries'
import { loadDatasetAnalysisEmbeddings as defaultLoadAnalysisEmbeddings } from './data/analysisEmbeddings'
import { loadDatasetGeneExpression as defaultLoadDatasetGeneExpression } from './data/geneExpression'
import { loadDatasetOverview as defaultLoadDatasetOverview } from './data/datasetOverview'
import { warmDatasetForRoi as defaultWarmDatasetForRoi } from './data/datasetWarmup'
import { loadGenePanel as defaultLoadGenePanel } from './data/genePanel'
import {
  geneExpressionRequestKey,
  geneExpressionWaitingKey,
  planGeneExpressionLod,
} from './data/geneExpressionLod'
import { loadMorphologyImage as defaultLoadMorphologyImage } from './data/morphologyImage'
import {
  ROI_CELL_EXPORT_LIMIT,
  loadDatasetRoiCells as defaultLoadDatasetRoiCells,
} from './data/roiCells'
import { loadDatasetRoiGeneStats as defaultLoadDatasetRoiGeneStats } from './data/roiGeneStats'
import { loadDatasetRoiTranscripts as defaultLoadDatasetRoiTranscripts } from './data/roiTranscripts'
import { micrometers } from './data/coords'
import { parseCustomAnnotations } from './data/customAnnotations'
import {
  BOUNDARY_VIEWPORT_CELL_LIMIT,
  boundaryViewportKey,
  normalizeBoundaryCellLimit,
  shouldLoadBoundaryPolygons,
} from './rendering/boundaryViewport'
import {
  boundaryElementsToLayerData,
  DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  GENE_EXPRESSION_COLOR_SCALE_OPTIONS,
  GENE_EXPRESSION_SCORE_MODE_OPTIONS,
  geneExpressionCellsToLayerData,
  geneExpressionScoreDomainMax,
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
  overviewCellsToLayerData,
  styleGeneExpressionCellsByScale,
  bundledDeckVersion,
} from './rendering/deckLayers'
import { styleOverviewCellsByObservation } from './rendering/cellStyling'
import {
  annotationPaletteColor,
  normalizeAnnotationColor,
} from './rendering/annotationPalette'
import { opacityToPercent, percentToOpacity } from './rendering/layerOpacity'
import { useViewerStore } from './store/viewerStore'
import type { BBox } from './data/coords'
import type { ChannelAutoContrast, ChannelHistogram } from './data/morphologyContrast'
import type {
  DatasetCell,
  DatasetTranscript,
  GeneExpressionBatch,
} from './datasets/xeniumDataset'
import type { CellOverviewPoint } from './data/hyparquetCells'
import type { MorphologyImage, MorphologyImageChannel } from './data/morphologyImage'
import type { MorphologyCanvasChannel } from './components/MorphologyCanvas'
import type { AnnotationColorStyle, ObservationColorMode } from './rendering/cellStyling'
import type {
  AnalysisEmbedding,
  AnalysisEmbeddingKind,
  AnalysisEmbeddingPoint,
} from './data/analysisEmbeddings'
import type {
  AnnotationGroupOption,
  LoadDatasetAnnotationsOptions,
} from './data/datasetAnnotations'
import type { Annotation, ElementBatch, SpatialElement } from './datasets/spatialDataset'
import type {
  GeneExpressionDetailMode,
  GeneExpressionLoadMode,
} from './data/geneExpressionLod'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
} from './rendering/deckLayers'
import type { RoiGeneStats } from './data/roiGeneStats'
import type { OverviewCellDatum } from './rendering/deckLayers'
import type { RoiDrawMode, ViewerViewportDetail } from './components/ViewerCore'

const EMPTY_HISTOGRAM_BINS = Array.from({ length: 32 }, () => 0)
const EMPTY_ANNOTATION_STYLE_COLORS: readonly AnnotationColorStyle[] = []
const GENE_SET_SYMBOL_SPLIT_PATTERN = /[\s,;]+/
const DEBUG_LOG_LIMIT = 12
const CONTROL_HUD_TABS = [
  { id: 'dataset', label: 'Dataset' },
  { id: 'layers', label: 'Layers' },
  { id: 'genes', label: 'Genes' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'roi', label: 'ROI' },
  { id: 'cell', label: 'Cell' },
] as const

type ControlHudTab = (typeof CONTROL_HUD_TABS)[number]['id']

export type DatasetOverviewLoader = (
  baseUrl: string,
  options?: {
    readonly limit?: number | null
    readonly includeCellIds?: boolean
    readonly signal?: AbortSignal
  },
) => Promise<readonly CellOverviewPoint[]>

export type MorphologyImageLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<MorphologyImage>
export type BoundaryElementsLoader = (
  baseUrl: string,
  bbox: BBox,
  options?: { readonly signal?: AbortSignal },
) => Promise<ElementBatch>
export type GenePanelLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly string[]>
export type AnnotationLoader = (
  baseUrl: string,
  options?: LoadDatasetAnnotationsOptions,
) => Promise<readonly Annotation[]>
export type AnnotationGroupLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly AnnotationGroupOption[]>
export type AnalysisEmbeddingsLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly AnalysisEmbedding[]>
export type RoiCellsLoader = (
  baseUrl: string,
  bbox: BBox,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly DatasetCell[]>
export type RoiGeneStatsLoader = (
  baseUrl: string,
  cells: readonly DatasetCell[],
  options?: { readonly signal?: AbortSignal },
) => Promise<RoiGeneStats>
export type RoiTranscriptsLoader = (
  baseUrl: string,
  bbox: BBox,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly DatasetTranscript[]>
export type GeneExpressionLoader = (
  baseUrl: string,
  bbox: BBox,
  genes: readonly string[],
  options?: {
    readonly limit?: number
    readonly sampleStride?: number
    readonly signal?: AbortSignal
  },
) => Promise<GeneExpressionBatch>
export type AutoChannelContrastLoader = (
  channel: MorphologyImageChannel,
  options?: { readonly signal?: AbortSignal },
) => Promise<ChannelAutoContrast>
export type DatasetWarmupLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<void>

type DatasetLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly cellCount: number }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type DatasetWarmupState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string }
  | { readonly status: 'error'; readonly url: string }

type MorphologyLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type BoundaryLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly cellCount: number }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type GenePanelState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly genes: readonly string[] }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type AnnotationState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly annotations: readonly Annotation[]
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type AnnotationGroupState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly groups: readonly AnnotationGroupOption[]
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type AnalysisEmbeddingState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly embeddings: readonly AnalysisEmbedding[]
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type GeneExpressionState =
  | { readonly status: 'idle' }
  | { readonly status: 'waiting'; readonly message: string }
  | {
      readonly status: 'loading'
      readonly url: string
      readonly genes: readonly string[]
      readonly mode: GeneExpressionLoadMode
      readonly visibleCellCount: number
    }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly genes: readonly string[]
      readonly cellCount: number
      readonly mode: GeneExpressionLoadMode
      readonly visibleCellCount: number
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type RoiState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly bbox: BBox }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly bbox: BBox
      readonly cells: readonly DatasetCell[]
      readonly hitCellLimit: boolean
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly bbox: BBox
      readonly error: StructuredLoadError
    }

type RoiGeneStatsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly cellCount: number }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly stats: RoiGeneStats
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type RoiTranscriptExportState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type LoadErrorCode =
  | 'network'
  | 'http'
  | 'range-not-supported'
  | 'unsupported'
  | 'parquet-decode'
  | 'manifest'
  | 'decode'
  | 'unknown'

type LoadErrorSource =
  | 'Dataset overview'
  | 'Morphology image'
  | 'Image tiles'
  | 'Cell boundaries'
  | 'Gene panel'
  | 'Annotations'
  | 'Embeddings'
  | 'ROI cells'
  | 'ROI genes'
  | 'ROI transcripts'
  | 'Gene expression'

interface StructuredLoadError {
  readonly source: LoadErrorSource
  readonly code: LoadErrorCode
  readonly title: string
  readonly message: string
  readonly action: string
  readonly detail?: string
}

interface DebugLogEntry {
  readonly id: number
  readonly timestamp: number
  readonly message: string
  readonly coalesceKey?: string
}

interface LoadingTask {
  readonly id: string
  readonly tabId: ControlHudTab
  readonly label: string
  readonly detail?: string
}

interface MorphologyChannelSetting {
  readonly id: string
  readonly enabled: boolean
  readonly color: readonly [number, number, number]
  readonly contrastMin: number
  readonly contrastMax: number
  readonly histogram?: ChannelHistogram
}

interface SavedGeneSet {
  readonly id: string
  readonly name: string
  readonly genes: readonly string[]
  readonly scoreMode: GeneExpressionScoreMode
}

interface GeneExpressionScaleDomain {
  readonly key: string
  readonly max: number
}

interface RoiSummary {
  readonly cellCount: number
  readonly meanTranscriptCount: number
  readonly meanCellArea: number | undefined
}

export interface AppProps {
  readonly loadDatasetOverview?: DatasetOverviewLoader
  readonly loadMorphologyImage?: MorphologyImageLoader
  readonly loadBoundaryElements?: BoundaryElementsLoader
  readonly loadGenePanel?: GenePanelLoader
  readonly loadAnnotations?: AnnotationLoader
  readonly loadAnnotationGroups?: AnnotationGroupLoader
  readonly loadAnalysisEmbeddings?: AnalysisEmbeddingsLoader
  readonly loadRoiCells?: RoiCellsLoader
  readonly loadRoiGeneStats?: RoiGeneStatsLoader
  readonly loadRoiTranscripts?: RoiTranscriptsLoader
  readonly loadGeneExpression?: GeneExpressionLoader
  readonly warmDatasetForRoi?: DatasetWarmupLoader
  readonly computeAutoChannelContrast?: AutoChannelContrastLoader
}

export function App({
  loadDatasetOverview = defaultLoadDatasetOverview,
  loadMorphologyImage = defaultLoadMorphologyImage,
  loadBoundaryElements = defaultLoadBoundaryElements,
  loadGenePanel = defaultLoadGenePanel,
  loadAnnotations = defaultLoadDatasetAnnotations,
  loadAnnotationGroups = defaultLoadDatasetAnnotationGroups,
  loadAnalysisEmbeddings = defaultLoadAnalysisEmbeddings,
  loadRoiCells = defaultLoadDatasetRoiCells,
  loadRoiGeneStats = defaultLoadDatasetRoiGeneStats,
  loadRoiTranscripts = defaultLoadDatasetRoiTranscripts,
  loadGeneExpression = defaultLoadDatasetGeneExpression,
  warmDatasetForRoi = defaultWarmDatasetForRoi,
  computeAutoChannelContrast = defaultComputeAutoChannelContrast,
}: AppProps) {
  const datasetInputId = useId()
  const morphologyInputId = useId()
  const boundaryLimitInputId = useId()
  const imageOpacityInputId = useId()
  const geneOpacityInputId = useId()
  const coordinateUnitInputId = useId()
  const geneSearchInputId = useId()
  const geneSetSymbolsInputId = useId()
  const geneSetNameInputId = useId()
  const geneSetScoreInputId = useId()
  const geneScaleInputId = useId()
  const geneExpressionDetailInputId = useId()
  const annotationImportInputId = useId()
  const annotationGroupInputId = useId()
  const embeddingViewInputId = useId()
  const roiNameInputId = useId()
  const observationModeInputId = useId()
  const datasetUrl = useViewerStore((state) => state.datasetUrl)
  const setDatasetUrl = useViewerStore((state) => state.setDatasetUrl)
  const [loadState, setLoadState] = useState<DatasetLoadState>({ status: 'idle' })
  const [datasetWarmupState, setDatasetWarmupState] = useState<DatasetWarmupState>({
    status: 'idle',
  })
  const [morphologyState, setMorphologyState] = useState<MorphologyLoadState>({
    status: 'idle',
  })
  const [boundaryState, setBoundaryState] = useState<BoundaryLoadState>({
    status: 'idle',
  })
  const [genePanelState, setGenePanelState] = useState<GenePanelState>({
    status: 'idle',
  })
  const [annotationState, setAnnotationState] = useState<AnnotationState>({
    status: 'idle',
  })
  const [annotationGroupState, setAnnotationGroupState] = useState<AnnotationGroupState>({
    status: 'idle',
  })
  const [analysisEmbeddingState, setAnalysisEmbeddingState] =
    useState<AnalysisEmbeddingState>({
      status: 'idle',
    })
  const [annotationColors, setAnnotationColors] = useState<
    Readonly<Record<string, string>>
  >({})
  const [selectedAnnotationGroupId, setSelectedAnnotationGroupId] = useState(
    ALL_ANNOTATION_GROUP_ID,
  )
  const [selectedEmbeddingKind, setSelectedEmbeddingKind] =
    useState<AnalysisEmbeddingKind>('umap')
  const [roiState, setRoiState] = useState<RoiState>({ status: 'idle' })
  const [roiGeneStatsState, setRoiGeneStatsState] = useState<RoiGeneStatsState>({
    status: 'idle',
  })
  const [roiTranscriptExportState, setRoiTranscriptExportState] =
    useState<RoiTranscriptExportState>({ status: 'idle' })
  const [debugLog, setDebugLog] = useState<readonly DebugLogEntry[]>([])
  const [isControlHudCollapsed, setIsControlHudCollapsed] = useState(false)
  const [activeControlHudTab, setActiveControlHudTab] = useState<ControlHudTab>('dataset')
  const [geneExpressionState, setGeneExpressionState] = useState<GeneExpressionState>({
    status: 'idle',
  })
  const [overviewCells, setOverviewCells] = useState<readonly OverviewCellDatum[]>([])
  const [geneExpressionBatch, setGeneExpressionBatch] =
    useState<GeneExpressionBatch | null>(null)
  const [geneExpressionScaleDomain, setGeneExpressionScaleDomain] =
    useState<GeneExpressionScaleDomain>({ key: '', max: 0 })
  const [morphologyImage, setMorphologyImage] = useState<MorphologyImage | null>(null)
  const [morphologyChannelSettings, setMorphologyChannelSettings] = useState<
    readonly MorphologyChannelSetting[]
  >([])
  const [autoContrastChannelIds, setAutoContrastChannelIds] = useState<readonly string[]>(
    [],
  )
  const [boundaryElements, setBoundaryElements] = useState<readonly SpatialElement[]>([])
  const [shouldLoadMorphology, setShouldLoadMorphology] = useState(false)
  const [boundaryCellLimit, setBoundaryCellLimit] = useState(BOUNDARY_VIEWPORT_CELL_LIMIT)
  const [imageLayerOpacity, setImageLayerOpacity] = useState(1)
  const [geneLayerOpacity, setGeneLayerOpacity] = useState(1)
  const [coordinateUnit, setCoordinateUnit] = useState<ViewerCoordinateUnit>('um')
  const [geneSearch, setGeneSearch] = useState('')
  const [geneSetSymbols, setGeneSetSymbols] = useState('')
  const [geneSetName, setGeneSetName] = useState('')
  const [geneExpressionColorScale, setGeneExpressionColorScale] =
    useState<GeneExpressionColorScale>(DEFAULT_GENE_EXPRESSION_COLOR_SCALE)
  const [geneExpressionScoreMode, setGeneExpressionScoreMode] =
    useState<GeneExpressionScoreMode>(DEFAULT_GENE_EXPRESSION_SCORE_MODE)
  const [geneExpressionDetailMode, setGeneExpressionDetailMode] =
    useState<GeneExpressionDetailMode>('auto')
  const [savedGeneSets, setSavedGeneSets] = useState<readonly SavedGeneSet[]>([])
  const [selectedGenes, setSelectedGenes] = useState<readonly string[]>([])
  const [roiMode, setRoiMode] = useState<RoiDrawMode>('idle')
  const [roiName, setRoiName] = useState('ROI 1')
  const [observationColorMode, setObservationColorMode] =
    useState<ObservationColorMode>('transcript-count')
  const [selectedCell, setSelectedCell] = useState<OverviewCellDatum | null>(null)
  const [, setViewportCellCount] = useState<number | null>(null)
  const loadRequestId = useRef(0)
  const analysisEmbeddingRequestId = useRef(0)
  const boundaryRequestId = useRef(0)
  const geneExpressionRequestId = useRef(0)
  const roiRequestId = useRef(0)
  const roiTranscriptExportRequestId = useRef(0)
  const debugLogIdRef = useRef(0)
  const datasetAbortRef = useRef<AbortController | null>(null)
  const datasetWarmupAbortRef = useRef<AbortController | null>(null)
  const analysisEmbeddingAbortRef = useRef<AbortController | null>(null)
  const boundaryAbortRef = useRef<AbortController | null>(null)
  const geneExpressionAbortRef = useRef<AbortController | null>(null)
  const roiAbortRef = useRef<AbortController | null>(null)
  const roiTranscriptExportAbortRef = useRef<AbortController | null>(null)
  const autoContrastChannelIdsRef = useRef<Set<string>>(new Set())
  const geneSetIdRef = useRef(0)
  const roiIdRef = useRef(0)
  const boundaryViewportKeyRef = useRef<string | null>(null)
  const geneExpressionViewportKeyRef = useRef<string | null>(null)
  const lastViewportDetailRef = useRef<ViewerViewportDetail | null>(null)
  const isLoading = loadState.status === 'loading'
  const annotationStyleColors = useMemo(
    () =>
      annotationState.status === 'ready'
        ? annotationState.annotations.map((annotation, annotationIndex) => ({
            id: annotation.id,
            cellIds: annotation.cellIds,
            color:
              annotationColors[annotation.id] ?? annotationPaletteColor(annotationIndex),
          }))
        : [],
    [annotationColors, annotationState],
  )
  const activeAnnotationStyleColors =
    observationColorMode === 'annotations'
      ? annotationStyleColors
      : EMPTY_ANNOTATION_STYLE_COLORS
  const viewerObservationColorMode: ObservationColorMode =
    observationColorMode === 'annotations' ? 'annotations' : 'transcript-count'
  const styledOverviewCells = useMemo(() => {
    if (observationColorMode !== 'cell-area') {
      return overviewCells
    }

    return styleOverviewCellsByObservation(overviewCells, 'cell-area')
  }, [observationColorMode, overviewCells])
  const overviewExtent = useMemo(
    () => overviewCellsToBbox(overviewCells),
    [overviewCells],
  )
  const geneExpressionScaleDatasetUrl =
    loadState.status === 'ready' ? loadState.url : datasetUrl
  const geneExpressionScaleKey = useMemo(
    () =>
      geneExpressionScaleKeyFor(
        geneExpressionScaleDatasetUrl,
        geneExpressionScoreMode,
        selectedGenes,
      ),
    [geneExpressionScaleDatasetUrl, geneExpressionScoreMode, selectedGenes],
  )
  const currentGeneExpressionScaleMax = useMemo(
    () =>
      geneExpressionBatch === null
        ? 0
        : geneExpressionScoreDomainMax(
            geneExpressionBatch.cells,
            geneExpressionBatch.genes,
            geneExpressionScoreMode,
          ),
    [geneExpressionBatch, geneExpressionScoreMode],
  )
  const storedGeneExpressionScaleMax =
    geneExpressionScaleDomain.key === geneExpressionScaleKey
      ? geneExpressionScaleDomain.max
      : 0
  const geneExpressionScaleMax = Math.max(
    storedGeneExpressionScaleMax,
    currentGeneExpressionScaleMax,
  )
  const geneExpressionCells = useMemo(
    () =>
      geneExpressionBatch === null
        ? []
        : geneExpressionCellsToLayerData(
            geneExpressionBatch.cells,
            geneExpressionBatch.genes,
            geneExpressionColorScale,
            geneExpressionScoreMode,
            { scaleMax: geneExpressionScaleMax },
          ),
    [
      geneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionScaleMax,
      geneExpressionScoreMode,
    ],
  )
  const styledGeneExpressionCells = useMemo(
    () =>
      styleGeneExpressionCellsByScale(geneExpressionCells, geneExpressionColorScale, {
        scaleMax: geneExpressionScaleMax,
      }),
    [geneExpressionCells, geneExpressionColorScale, geneExpressionScaleMax],
  )
  const morphologyCanvasChannels = useMemo<readonly MorphologyCanvasChannel[]>(
    () =>
      morphologyImage === null
        ? []
        : morphologyImage.channelLoaders.map((channel) => {
            const setting = morphologyChannelSettings.find(
              (candidate) => candidate.id === channel.info.id,
            )
            const contrast = normalizeChannelContrast({
              min: setting?.contrastMin ?? channel.info.contrast.min,
              max: setting?.contrastMax ?? channel.info.contrast.max,
            })

            return {
              id: channel.info.id,
              loader: channel.loader,
              enabled: setting?.enabled ?? false,
              color: setting?.color ?? channel.info.color,
              contrast,
            }
          }),
    [morphologyChannelSettings, morphologyImage],
  )
  const morphologyMicrometersPerPixel = morphologyImage?.loader.units?.micrometersPerPixel
  const boundaryLayerData = useMemo(
    () => boundaryElementsToLayerData(boundaryElements),
    [boundaryElements],
  )
  const geneOptions = useMemo(
    () => (genePanelState.status === 'ready' ? genePanelState.genes : []),
    [genePanelState],
  )
  const filteredGenes = useMemo(
    () => filterGeneOptions(geneOptions, geneSearch, selectedGenes),
    [geneOptions, geneSearch, selectedGenes],
  )
  const genePanelCopy = genePanelStatusCopy(genePanelState)
  const annotationCopy = annotationStatusCopy(annotationState)
  const annotationGroupOptions =
    annotationGroupState.status === 'ready' ? annotationGroupState.groups : []
  const overviewCellById = useMemo(() => {
    const cellById = new Map<string, OverviewCellDatum>()

    for (const cell of overviewCells) {
      cellById.set(cell.id, cell)
    }

    return cellById
  }, [overviewCells])
  const activeEmbedding = useMemo(
    () =>
      analysisEmbeddingState.status === 'ready'
        ? (analysisEmbeddingState.embeddings.find(
            (embedding) => embedding.kind === selectedEmbeddingKind,
          ) ??
          analysisEmbeddingState.embeddings[0] ??
          null)
        : null,
    [analysisEmbeddingState, selectedEmbeddingKind],
  )
  const roiCellIds = useMemo(
    () => (roiState.status === 'ready' ? roiState.cells.map((cell) => cell.id) : []),
    [roiState],
  )
  const embeddingCopy = analysisEmbeddingStatusCopy(
    analysisEmbeddingState,
    activeEmbedding,
    roiCellIds,
    selectedCell,
  )
  const geneExpressionCopy = geneExpressionStatusCopy(geneExpressionState)
  const roiCopy = roiStatusCopy(roiState, roiMode)
  const roiGeneStatsCopy = roiGeneStatsStatusCopy(roiGeneStatsState)
  const analysisHeaderCopy =
    geneExpressionState.status === 'loading'
      ? geneExpressionModeLabel(geneExpressionState.mode)
      : genePanelCopy
  const annotationHeaderCopy =
    annotationGroupState.status === 'loading' ? 'Loading sets' : annotationCopy
  const roiHeaderCopy =
    roiGeneStatsState.status === 'loading'
      ? 'Querying genes'
      : roiTranscriptExportState.status === 'loading'
        ? 'Exporting'
        : roiCopy
  const roiSummary = useMemo(
    () => (roiState.status === 'ready' ? summarizeRoiCells(roiState.cells) : null),
    [roiState],
  )
  const loadingTasks = useMemo<readonly LoadingTask[]>(() => {
    const tasks: LoadingTask[] = []

    if (loadState.status === 'loading') {
      tasks.push({
        id: 'dataset',
        tabId: 'dataset',
        label: 'Loading dataset',
        detail: shortDatasetLabel(loadState.url),
      })
    }

    if (datasetWarmupState.status === 'loading') {
      tasks.push({
        id: 'dataset-warmup',
        tabId: 'dataset',
        label: 'Preparing dataset',
        detail: shortDatasetLabel(datasetWarmupState.url),
      })
    }

    if (genePanelState.status === 'loading') {
      tasks.push({ id: 'gene-panel', tabId: 'genes', label: 'Loading gene panel' })
    }

    if (morphologyState.status === 'loading') {
      tasks.push({ id: 'morphology', tabId: 'layers', label: 'Loading image' })
    }

    if (annotationGroupState.status === 'loading') {
      tasks.push({
        id: 'annotation-sets',
        tabId: 'annotations',
        label: 'Loading annotation sets',
      })
    }

    if (boundaryState.status === 'loading') {
      tasks.push({ id: 'boundaries', tabId: 'layers', label: 'Loading boundaries' })
    }

    if (geneExpressionState.status === 'loading') {
      tasks.push({
        id: 'gene-expression',
        tabId: 'genes',
        label: geneExpressionModeLabel(geneExpressionState.mode),
        detail: geneExpressionState.genes.join(', '),
      })
    }

    if (annotationState.status === 'loading') {
      tasks.push({
        id: 'annotations',
        tabId: 'annotations',
        label: 'Loading annotations',
      })
    }

    if (analysisEmbeddingState.status === 'loading') {
      tasks.push({ id: 'embeddings', tabId: 'cell', label: 'Loading embeddings' })
    }

    if (roiState.status === 'loading') {
      tasks.push({ id: 'roi-cells', tabId: 'roi', label: 'Querying ROI cells' })
    }

    if (roiGeneStatsState.status === 'loading') {
      tasks.push({
        id: 'roi-genes',
        tabId: 'roi',
        label: 'Querying ROI genes',
        detail: `${roiGeneStatsState.cellCount.toLocaleString()} cells`,
      })
    }

    if (roiTranscriptExportState.status === 'loading') {
      tasks.push({
        id: 'roi-transcripts',
        tabId: 'roi',
        label: 'Exporting ROI transcripts',
      })
    }

    if (autoContrastChannelIds.length > 0) {
      const channelNoun = autoContrastChannelIds.length === 1 ? 'channel' : 'channels'
      tasks.push({
        id: 'auto-contrast',
        tabId: 'layers',
        label: 'Auto contrast',
        detail: `${autoContrastChannelIds.length.toLocaleString()} ${channelNoun}`,
      })
    }

    return tasks
  }, [
    analysisEmbeddingState,
    annotationGroupState,
    annotationState,
    autoContrastChannelIds,
    boundaryState,
    datasetWarmupState,
    geneExpressionState,
    genePanelState,
    loadState,
    morphologyState,
    roiGeneStatsState,
    roiState,
    roiTranscriptExportState,
  ])
  const loadingTabIds = useMemo(
    () => new Set(loadingTasks.map((task) => task.tabId)),
    [loadingTasks],
  )
  const activeRoiBbox = roiState.status === 'idle' ? null : roiState.bbox
  const appendDebugEvent = useCallback(
    (message: string, options: { readonly coalesceKey?: string } = {}) => {
      debugLogIdRef.current += 1
      const entry: DebugLogEntry = {
        id: debugLogIdRef.current,
        timestamp: Date.now(),
        message,
        ...(options.coalesceKey === undefined
          ? {}
          : { coalesceKey: options.coalesceKey }),
      }

      setDebugLog((current) => {
        const first = current[0]

        if (
          first !== undefined &&
          entry.coalesceKey !== undefined &&
          first.coalesceKey === entry.coalesceKey
        ) {
          return [entry, ...current.slice(1)]
        }

        return [entry, ...current].slice(0, DEBUG_LOG_LIMIT)
      })
    },
    [],
  )
  const activeErrors = useMemo(
    () =>
      [
        loadState.status === 'error' ? loadState.error : null,
        morphologyState.status === 'error' ? morphologyState.error : null,
        boundaryState.status === 'error' ? boundaryState.error : null,
        genePanelState.status === 'error' ? genePanelState.error : null,
        annotationState.status === 'error' ? annotationState.error : null,
        annotationGroupState.status === 'error' ? annotationGroupState.error : null,
        analysisEmbeddingState.status === 'error' ? analysisEmbeddingState.error : null,
        roiState.status === 'error' ? roiState.error : null,
        roiGeneStatsState.status === 'error' ? roiGeneStatsState.error : null,
        roiTranscriptExportState.status === 'error'
          ? roiTranscriptExportState.error
          : null,
        geneExpressionState.status === 'error' ? geneExpressionState.error : null,
      ].filter(isStructuredLoadError),
    [
      annotationState,
      annotationGroupState,
      analysisEmbeddingState,
      boundaryState,
      geneExpressionState,
      genePanelState,
      loadState,
      morphologyState,
      roiState,
      roiGeneStatsState,
      roiTranscriptExportState,
    ],
  )
  const handleImageTileError = useCallback((error: Error) => {
    setMorphologyState((current) => {
      if (current.status !== 'ready') {
        return current
      }

      return {
        status: 'error',
        url: current.url,
        error: createStructuredLoadError('Image tiles', error),
      }
    })
  }, [])
  const rememberGeneExpressionScaleMax = useCallback(
    (key: string, batch: GeneExpressionBatch, scoreMode: GeneExpressionScoreMode) => {
      const max = geneExpressionScoreDomainMax(batch.cells, batch.genes, scoreMode)

      if (max <= 0) {
        return
      }

      setGeneExpressionScaleDomain((current) => {
        const currentMax = current.key === key ? current.max : 0

        if (currentMax >= max) {
          return current
        }

        return { key, max }
      })
    },
    [],
  )
  const handleViewportChange = useCallback(
    (detail: ViewerViewportDetail) => {
      if (loadState.status !== 'ready') {
        return
      }

      lastViewportDetailRef.current = detail

      if (!shouldLoadBoundaryPolygons(detail, { cellLimit: boundaryCellLimit })) {
        abortActiveRequest(boundaryAbortRef)
        boundaryRequestId.current += 1
        boundaryViewportKeyRef.current = null
        setBoundaryElements((current) => (current.length === 0 ? current : []))
        setBoundaryState((current) =>
          current.status === 'idle' ? current : { status: 'idle' },
        )
      } else {
        const requestKey = boundaryViewportKey(loadState.url, detail.bbox)

        if (requestKey !== boundaryViewportKeyRef.current) {
          abortActiveRequest(boundaryAbortRef)
          const requestId = boundaryRequestId.current + 1
          const abortController = new AbortController()
          boundaryRequestId.current = requestId
          boundaryAbortRef.current = abortController
          boundaryViewportKeyRef.current = requestKey
          setBoundaryState({ status: 'loading', url: loadState.url })

          void loadBoundaryElements(loadState.url, detail.bbox, {
            signal: abortController.signal,
          })
            .then((batch) => {
              if (boundaryRequestId.current !== requestId) {
                return
              }

              setBoundaryElements(batch.elements)
              setBoundaryState({
                status: 'ready',
                url: loadState.url,
                cellCount: batch.elements.length,
              })
            })
            .catch((error) => {
              if (isAbortError(error)) {
                return
              }

              if (boundaryRequestId.current !== requestId) {
                return
              }

              setBoundaryElements([])
              setBoundaryState({
                status: 'error',
                url: loadState.url,
                error: createStructuredLoadError('Cell boundaries', error),
              })
            })
            .finally(() => {
              if (boundaryAbortRef.current === abortController) {
                boundaryAbortRef.current = null
              }
            })
        }
      }

      if (selectedGenes.length === 0) {
        abortActiveRequest(geneExpressionAbortRef)
        geneExpressionRequestId.current += 1
        geneExpressionViewportKeyRef.current = null
        setGeneExpressionBatch(null)
        setGeneExpressionState((current) =>
          current.status === 'idle' ? current : { status: 'idle' },
        )
        return
      }

      const expressionPlan = planGeneExpressionLod(detail, {
        detailMode: geneExpressionDetailMode,
        slideBbox: overviewExtent,
        totalCellCount: loadState.cellCount,
      })

      if (expressionPlan.kind === 'waiting') {
        const waitingKey = geneExpressionWaitingKey(
          loadState.url,
          detail,
          selectedGenes,
          geneExpressionDetailMode,
        )

        if (waitingKey === geneExpressionViewportKeyRef.current) {
          return
        }

        abortActiveRequest(geneExpressionAbortRef)
        geneExpressionRequestId.current += 1
        geneExpressionViewportKeyRef.current = waitingKey
        setGeneExpressionBatch(null)
        setGeneExpressionState({ status: 'waiting', message: expressionPlan.message })
        return
      }

      const expressionKey = geneExpressionRequestKey(
        loadState.url,
        detail,
        expressionPlan,
        selectedGenes,
      )

      if (expressionKey === geneExpressionViewportKeyRef.current) {
        return
      }

      const expressionRequestId = geneExpressionRequestId.current + 1
      abortActiveRequest(geneExpressionAbortRef)
      const expressionAbortController = new AbortController()
      geneExpressionRequestId.current = expressionRequestId
      geneExpressionAbortRef.current = expressionAbortController
      geneExpressionViewportKeyRef.current = expressionKey
      setGeneExpressionState({
        status: 'loading',
        url: loadState.url,
        genes: selectedGenes,
        mode: expressionPlan.mode,
        visibleCellCount: expressionPlan.sourceCellCount,
      })

      void loadGeneExpression(loadState.url, expressionPlan.bbox, selectedGenes, {
        signal: expressionAbortController.signal,
        limit: expressionPlan.cellLimit,
        sampleStride: expressionPlan.sampleStride,
      })
        .then((batch) => {
          if (geneExpressionRequestId.current !== expressionRequestId) {
            return
          }

          rememberGeneExpressionScaleMax(
            geneExpressionScaleKey,
            batch,
            geneExpressionScoreMode,
          )
          setGeneExpressionBatch(batch)
          setGeneExpressionState({
            status: 'ready',
            url: loadState.url,
            genes: batch.genes,
            cellCount: batch.cells.length,
            mode: expressionPlan.mode,
            visibleCellCount: expressionPlan.sourceCellCount,
          })
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return
          }

          if (geneExpressionRequestId.current !== expressionRequestId) {
            return
          }

          setGeneExpressionBatch(null)
          setGeneExpressionState({
            status: 'error',
            url: loadState.url,
            error: createStructuredLoadError('Gene expression', error),
          })
        })
        .finally(() => {
          if (geneExpressionAbortRef.current === expressionAbortController) {
            geneExpressionAbortRef.current = null
          }
        })
    },
    [
      boundaryCellLimit,
      geneExpressionScaleKey,
      geneExpressionScoreMode,
      loadBoundaryElements,
      loadGeneExpression,
      loadState,
      geneExpressionDetailMode,
      overviewExtent,
      rememberGeneExpressionScaleMax,
      selectedGenes,
    ],
  )

  useEffect(() => {
    const detail = lastViewportDetailRef.current

    if (detail !== null) {
      handleViewportChange(detail)
    }
  }, [handleViewportChange])

  useEffect(() => {
    return () => {
      abortActiveRequest(datasetAbortRef)
      abortActiveRequest(datasetWarmupAbortRef)
      abortActiveRequest(analysisEmbeddingAbortRef)
      abortActiveRequest(boundaryAbortRef)
      abortActiveRequest(geneExpressionAbortRef)
      abortActiveRequest(roiAbortRef)
      abortActiveRequest(roiTranscriptExportAbortRef)
    }
  }, [])

  function startDatasetWarmup(requestedUrl: string, requestId: number) {
    abortActiveRequest(datasetWarmupAbortRef)
    const abortController = new AbortController()
    datasetWarmupAbortRef.current = abortController
    setDatasetWarmupState({ status: 'loading', url: requestedUrl })
    appendDebugEvent('Preparing dataset')

    void warmDatasetForRoi(requestedUrl, { signal: abortController.signal })
      .then(() => {
        if (loadRequestId.current !== requestId) {
          return
        }

        setDatasetWarmupState({ status: 'ready', url: requestedUrl })
        appendDebugEvent('Dataset prepared')
      })
      .catch((error) => {
        if (isAbortError(error) || loadRequestId.current !== requestId) {
          return
        }

        setDatasetWarmupState({ status: 'error', url: requestedUrl })
        appendDebugEvent('Dataset preparation incomplete')
      })
      .finally(() => {
        if (datasetWarmupAbortRef.current === abortController) {
          datasetWarmupAbortRef.current = null
        }
      })
  }

  async function handleDatasetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const datasetUrl = formData.get('datasetUrl')
    const loadImage = formData.get('loadMorphologyImage') === 'on'

    if (typeof datasetUrl === 'string' && datasetUrl.trim().length > 0) {
      const requestedUrl = datasetUrl.trim()
      const requestId = loadRequestId.current + 1
      appendDebugEvent(`Loading dataset ${shortDatasetLabel(requestedUrl)}`)
      abortActiveRequest(datasetAbortRef)
      abortActiveRequest(datasetWarmupAbortRef)
      abortActiveRequest(analysisEmbeddingAbortRef)
      abortActiveRequest(boundaryAbortRef)
      abortActiveRequest(geneExpressionAbortRef)
      abortActiveRequest(roiAbortRef)
      abortActiveRequest(roiTranscriptExportAbortRef)
      const abortController = new AbortController()
      loadRequestId.current = requestId
      datasetAbortRef.current = abortController

      setDatasetUrl(requestedUrl)
      setDatasetWarmupState({ status: 'idle' })
      setOverviewCells([])
      setGeneExpressionBatch(null)
      setGeneExpressionScaleDomain({ key: '', max: 0 })
      setMorphologyImage(null)
      setMorphologyChannelSettings([])
      autoContrastChannelIdsRef.current.clear()
      setAutoContrastChannelIds([])
      setBoundaryElements([])
      setGeneSearch('')
      setGeneSetSymbols('')
      setGeneSetName('')
      setSavedGeneSets([])
      setAnnotationColors({})
      setAnnotationGroupState({ status: 'loading', url: requestedUrl })
      setSelectedAnnotationGroupId(ALL_ANNOTATION_GROUP_ID)
      setAnalysisEmbeddingState({ status: 'idle' })
      setSelectedEmbeddingKind('umap')
      setObservationColorMode('transcript-count')
      setGeneExpressionScoreMode(DEFAULT_GENE_EXPRESSION_SCORE_MODE)
      setGeneExpressionDetailMode('auto')
      setSelectedGenes([])
      setRoiMode('idle')
      setRoiName('ROI 1')
      setRoiState({ status: 'idle' })
      setRoiGeneStatsState({ status: 'idle' })
      setRoiTranscriptExportState({ status: 'idle' })
      setSelectedCell(null)
      setViewportCellCount(null)
      setLoadState({ status: 'loading', url: requestedUrl })
      setMorphologyState(
        loadImage ? { status: 'loading', url: requestedUrl } : { status: 'idle' },
      )
      setBoundaryState({ status: 'idle' })
      setGenePanelState({ status: 'loading', url: requestedUrl })
      setAnnotationState({ status: 'idle' })
      setGeneExpressionState({ status: 'idle' })
      boundaryRequestId.current += 1
      analysisEmbeddingRequestId.current += 1
      geneExpressionRequestId.current += 1
      roiRequestId.current += 1
      roiTranscriptExportRequestId.current += 1
      boundaryViewportKeyRef.current = null
      geneExpressionViewportKeyRef.current = null
      lastViewportDetailRef.current = null
      startDatasetWarmup(requestedUrl, requestId)

      void loadGenePanel(requestedUrl, { signal: abortController.signal })
        .then((genes) => {
          if (loadRequestId.current !== requestId) {
            return
          }

          setGenePanelState({ status: 'ready', url: requestedUrl, genes })
          appendDebugEvent(`Gene panel ready: ${genes.length.toLocaleString()} genes`)
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return
          }

          if (loadRequestId.current !== requestId) {
            return
          }

          setGenePanelState({
            status: 'error',
            url: requestedUrl,
            error: createStructuredLoadError('Gene panel', error),
          })
          appendDebugEvent('Gene panel failed')
        })

      void loadAnnotationGroups(requestedUrl, { signal: abortController.signal })
        .then((groups) => {
          if (loadRequestId.current !== requestId) {
            return
          }

          setAnnotationGroupState({
            status: 'ready',
            url: requestedUrl,
            groups,
          })
          appendDebugEvent(
            `Annotation sets ready: ${groups.length.toLocaleString()} groups`,
          )
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return
          }

          if (loadRequestId.current !== requestId) {
            return
          }

          setAnnotationGroupState({
            status: 'error',
            url: requestedUrl,
            error: createStructuredLoadError('Annotations', error),
          })
          appendDebugEvent('Annotation sets failed')
        })

      try {
        const cells = await loadDatasetOverview(requestedUrl, {
          includeCellIds: true,
          limit: null,
          signal: abortController.signal,
        })

        if (loadRequestId.current !== requestId) {
          return
        }

        setOverviewCells(overviewCellsToLayerData(cells))
        setLoadState({
          status: 'ready',
          url: requestedUrl,
          cellCount: cells.length,
        })
        appendDebugEvent(`Dataset ready: ${cells.length.toLocaleString()} cells`)

        if (!loadImage) {
          return
        }

        void loadMorphologyImage(requestedUrl, { signal: abortController.signal })
          .then((image) => {
            if (loadRequestId.current !== requestId) {
              return
            }

            setMorphologyImage(image)
            setMorphologyChannelSettings(createMorphologyChannelSettings(image))
            setMorphologyState({
              status: 'ready',
              url: image.url,
            })
            appendDebugEvent('Morphology image ready')
            queueAutoContrast(image.channelLoaders, {
              requestId,
              signal: abortController.signal,
            })
          })
          .catch((error) => {
            if (isAbortError(error)) {
              return
            }

            if (loadRequestId.current !== requestId) {
              return
            }

            setMorphologyState({
              status: 'error',
              url: requestedUrl,
              error: createStructuredLoadError('Morphology image', error),
            })
            appendDebugEvent('Morphology image failed')
          })
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        if (loadRequestId.current !== requestId) {
          return
        }

        setLoadState({
          status: 'error',
          url: requestedUrl,
          error: createStructuredLoadError('Dataset overview', error),
        })
        appendDebugEvent('Dataset load failed')
        abortActiveRequest(datasetWarmupAbortRef)
        setDatasetWarmupState({ status: 'idle' })
        setMorphologyState({ status: 'idle' })
        setGenePanelState({ status: 'idle' })
        setAnnotationGroupState({ status: 'idle' })
      }
    }
  }

  function toggleGene(gene: string) {
    const isSelected = selectedGenes.includes(gene)
    appendDebugEvent(isSelected ? `Cleared gene ${gene}` : `Highlight gene ${gene}`)
    resetGeneExpressionSelectionState()
    setSelectedGenes((current) =>
      isSelected
        ? current.filter((selectedGene) => selectedGene !== gene)
        : [...current, gene].sort((a, b) => a.localeCompare(b)),
    )
  }

  function applyGeneSetSymbols() {
    const genes = parseGeneSetSymbols(geneSetSymbols, geneOptions)

    if (genes.length === 0) {
      return
    }

    appendDebugEvent(`Applied symbols: ${genes.length.toLocaleString()} genes`)
    setSelectedGenes(genes)
    resetGeneExpressionSelectionState()
    setGeneSearch('')
  }

  function saveSelectedGeneSet() {
    if (selectedGenes.length === 0) {
      return
    }

    const name = geneSetName.trim() || defaultGeneSetName(selectedGenes)
    const normalizedName = name.toLowerCase()
    const savedSet: SavedGeneSet = {
      id: `gene-set-${geneSetIdRef.current + 1}`,
      name,
      genes: selectedGenes,
      scoreMode: geneExpressionScoreMode,
    }

    geneSetIdRef.current += 1
    appendDebugEvent(`Saved gene set ${name}`)
    setSavedGeneSets((current) => [
      savedSet,
      ...current.filter((geneSet) => geneSet.name.toLowerCase() !== normalizedName),
    ])
    setGeneSetName('')
  }

  function applySavedGeneSet(geneSet: SavedGeneSet) {
    appendDebugEvent(`Applied gene set ${geneSet.name}`)
    resetGeneExpressionSelectionState()
    setSelectedGenes(geneSet.genes)
    setGeneExpressionScoreMode(geneSet.scoreMode)
    setGeneSearch('')
  }

  function handleGeneExpressionScoreModeChange(nextScoreMode: GeneExpressionScoreMode) {
    appendDebugEvent(`Signature score: ${nextScoreMode}`)
    setGeneExpressionScoreMode(nextScoreMode)

    if (geneExpressionBatch === null) {
      setGeneExpressionScaleDomain({ key: '', max: 0 })
      return
    }

    rememberGeneExpressionScaleMax(
      geneExpressionScaleKeyFor(
        geneExpressionScaleDatasetUrl,
        nextScoreMode,
        selectedGenes,
      ),
      geneExpressionBatch,
      nextScoreMode,
    )
  }

  function resetGeneExpressionSelectionState() {
    abortActiveRequest(geneExpressionAbortRef)
    geneExpressionRequestId.current += 1
    geneExpressionViewportKeyRef.current = null
    setGeneExpressionBatch(null)
    setGeneExpressionScaleDomain({ key: '', max: 0 })
    setGeneExpressionState({ status: 'idle' })
  }

  function removeSavedGeneSet(id: string) {
    const removedSet = savedGeneSets.find((geneSet) => geneSet.id === id)

    if (removedSet !== undefined) {
      appendDebugEvent(`Removed gene set ${removedSet.name}`)
    }

    setSavedGeneSets((current) => current.filter((geneSet) => geneSet.id !== id))
  }

  function handleLoadAnnotations() {
    if (loadState.status !== 'ready' || annotationState.status === 'loading') {
      return
    }

    const requestId = loadRequestId.current
    const signal = datasetAbortRef.current?.signal
    const groupId =
      selectedAnnotationGroupId === ALL_ANNOTATION_GROUP_ID
        ? undefined
        : selectedAnnotationGroupId
    appendDebugEvent(
      groupId === undefined ? 'Loading annotations' : `Loading annotations ${groupId}`,
    )
    setAnnotationState({ status: 'loading', url: loadState.url })

    void loadAnnotations(loadState.url, {
      ...(signal === undefined ? {} : { signal }),
      ...(groupId === undefined ? {} : { groupId }),
    })
      .then((annotations) => {
        if (loadRequestId.current !== requestId) {
          return
        }

        setAnnotationState({
          status: 'ready',
          url: loadState.url,
          annotations,
        })
        setAnnotationColors((current) => colorsForAnnotations(annotations, current))
        if (annotations.length > 0) {
          setObservationColorMode('annotations')
        }
        appendDebugEvent(
          `Annotations loaded: ${annotations.length.toLocaleString()} labels`,
        )
      })
      .catch((error) => {
        if (isAbortError(error) || loadRequestId.current !== requestId) {
          return
        }

        setAnnotationState({
          status: 'error',
          url: loadState.url,
          error: createStructuredLoadError('Annotations', error),
        })
        appendDebugEvent('Annotations failed')
      })
  }

  function handleLoadAnalysisEmbeddings() {
    if (loadState.status !== 'ready' || analysisEmbeddingState.status === 'loading') {
      return
    }

    const requestId = analysisEmbeddingRequestId.current + 1
    abortActiveRequest(analysisEmbeddingAbortRef)
    const abortController = new AbortController()
    analysisEmbeddingRequestId.current = requestId
    analysisEmbeddingAbortRef.current = abortController
    setAnalysisEmbeddingState({ status: 'loading', url: loadState.url })
    appendDebugEvent('Loading embeddings')

    void loadAnalysisEmbeddings(loadState.url, { signal: abortController.signal })
      .then((embeddings) => {
        if (analysisEmbeddingRequestId.current !== requestId) {
          return
        }

        setAnalysisEmbeddingState({
          status: 'ready',
          url: loadState.url,
          embeddings,
        })

        if (
          embeddings.length > 0 &&
          !embeddings.some((embedding) => embedding.kind === selectedEmbeddingKind)
        ) {
          setSelectedEmbeddingKind(embeddings[0]?.kind ?? 'umap')
        }
        appendDebugEvent(`Embeddings loaded: ${embeddings.length.toLocaleString()} views`)
      })
      .catch((error) => {
        if (isAbortError(error) || analysisEmbeddingRequestId.current !== requestId) {
          return
        }

        setAnalysisEmbeddingState({
          status: 'error',
          url: loadState.url,
          error: createStructuredLoadError('Embeddings', error),
        })
        appendDebugEvent('Embeddings failed')
      })
      .finally(() => {
        if (analysisEmbeddingAbortRef.current === abortController) {
          analysisEmbeddingAbortRef.current = null
        }
      })
  }

  function handleEmbeddingCellSelect(cellId: string) {
    const cell = overviewCellById.get(cellId)

    if (cell !== undefined) {
      setSelectedCell(cell)
    }
  }

  async function handleImportAnnotations(file: File | null) {
    if (file === null) {
      return
    }

    try {
      const importedAnnotations = parseCustomAnnotations(await file.text(), file.name)
      const importedPrefix = customAnnotationFilePrefix(file.name)

      setAnnotationState((current) => ({
        status: 'ready',
        url: loadState.status === 'ready' ? loadState.url : datasetUrl,
        annotations: mergeImportedAnnotations(
          current.status === 'ready' ? current.annotations : [],
          importedAnnotations,
          importedPrefix,
        ),
      }))
      setAnnotationColors((current) =>
        colorsForAnnotations(
          importedAnnotations,
          removeAnnotationColorsByPrefix(current, importedPrefix),
        ),
      )
      if (importedAnnotations.length > 0) {
        setObservationColorMode('annotations')
      }
      appendDebugEvent(
        `Imported annotations: ${importedAnnotations.length.toLocaleString()} labels`,
      )
    } catch (error) {
      setAnnotationState({
        status: 'error',
        url: loadState.status === 'ready' ? loadState.url : datasetUrl,
        error: createStructuredLoadError('Annotations', error),
      })
      appendDebugEvent('Annotation import failed')
    }
  }

  function handleAnnotationColorChange(annotationId: string, color: string) {
    const normalizedColor = normalizeAnnotationColor(color)

    if (normalizedColor === null) {
      return
    }

    setAnnotationColors((current) => ({ ...current, [annotationId]: normalizedColor }))
    appendDebugEvent(`Annotation color ${shortIdentifier(annotationId)}`, {
      coalesceKey: `annotation-color:${annotationId}`,
    })
  }

  function handleRemoveAnnotation(annotationId: string) {
    const removedAnnotation =
      annotationState.status === 'ready'
        ? annotationState.annotations.find((annotation) => annotation.id === annotationId)
        : undefined

    setAnnotationState((current) => {
      if (current.status !== 'ready') {
        return current
      }

      const annotations = current.annotations.filter(
        (annotation) => annotation.id !== annotationId,
      )

      return annotations.length === 0 ? { status: 'idle' } : { ...current, annotations }
    })
    setAnnotationColors((current) => removeAnnotationColor(current, annotationId))
    setObservationColorMode((current) =>
      hasReadyAnnotationsAfterRemove(annotationState, annotationId)
        ? current
        : 'transcript-count',
    )

    appendDebugEvent(
      `Removed annotation ${removedAnnotation?.label ?? shortIdentifier(annotationId)}`,
    )
  }

  function handleClearAnnotations() {
    setAnnotationState({ status: 'idle' })
    setAnnotationColors({})
    setObservationColorMode('transcript-count')
    appendDebugEvent('Cleared annotations')
  }

  function handleRoiComplete(bbox: BBox) {
    if (loadState.status !== 'ready') {
      return
    }

    const requestId = roiRequestId.current + 1
    abortActiveRequest(roiAbortRef)
    const abortController = new AbortController()
    roiRequestId.current = requestId
    roiAbortRef.current = abortController
    setRoiMode('idle')
    setRoiName((current) => current.trim() || defaultRoiName(roiIdRef.current + 1))
    setRoiState({ status: 'loading', url: loadState.url, bbox })
    setRoiGeneStatsState({ status: 'idle' })
    setRoiTranscriptExportState({ status: 'idle' })
    appendDebugEvent('ROI drawn: loading cells')

    void loadRoiCells(loadState.url, bbox, { signal: abortController.signal })
      .then((cells) => {
        if (roiRequestId.current !== requestId) {
          return
        }

        setRoiState({
          status: 'ready',
          url: loadState.url,
          bbox,
          cells,
          hitCellLimit: cells.length >= ROI_CELL_EXPORT_LIMIT,
        })
        appendDebugEvent(
          `ROI cells ready: ${cells.length.toLocaleString()}${
            cells.length >= ROI_CELL_EXPORT_LIMIT ? '+' : ''
          }`,
        )

        if (cells.length === 0) {
          setRoiGeneStatsState({
            status: 'ready',
            url: loadState.url,
            stats: emptyRoiGeneStats(),
          })
          return undefined
        }

        setRoiGeneStatsState({
          status: 'loading',
          url: loadState.url,
          cellCount: cells.length,
        })

        return loadRoiGeneStats(loadState.url, cells, {
          signal: abortController.signal,
        })
          .then((stats) => {
            if (roiRequestId.current !== requestId) {
              return
            }

            setRoiGeneStatsState({
              status: 'ready',
              url: loadState.url,
              stats,
            })
            appendDebugEvent(
              `ROI genes ready: ${stats.genes.length.toLocaleString()} genes`,
            )
          })
          .catch((error) => {
            if (isAbortError(error) || roiRequestId.current !== requestId) {
              return
            }

            setRoiGeneStatsState({
              status: 'error',
              url: loadState.url,
              error: createStructuredLoadError('ROI genes', error),
            })
            appendDebugEvent('ROI genes unsupported')
          })
      })
      .catch((error) => {
        if (isAbortError(error) || roiRequestId.current !== requestId) {
          return
        }

        setRoiState({
          status: 'error',
          url: loadState.url,
          bbox,
          error: createStructuredLoadError('ROI cells', error),
        })
        setRoiGeneStatsState({ status: 'idle' })
        appendDebugEvent('ROI cells failed')
      })
      .finally(() => {
        if (roiAbortRef.current === abortController) {
          roiAbortRef.current = null
        }
      })
  }

  function handleClearRoi() {
    abortActiveRequest(roiAbortRef)
    abortActiveRequest(roiTranscriptExportAbortRef)
    roiRequestId.current += 1
    roiTranscriptExportRequestId.current += 1
    setRoiMode('idle')
    setRoiState({ status: 'idle' })
    setRoiGeneStatsState({ status: 'idle' })
    setRoiTranscriptExportState({ status: 'idle' })
    appendDebugEvent('Cleared ROI')
  }

  function handleSaveRoiAnnotation() {
    if (loadState.status !== 'ready' || roiState.status !== 'ready') {
      return
    }

    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)
    const annotation: Annotation = {
      id: `roi:${roiIdRef.current + 1}:${slug(name)}`,
      label: name,
      cellIds: roiState.cells.map((cell) => cell.id),
    }

    roiIdRef.current += 1
    appendDebugEvent(`Saved ROI annotation ${name}`)
    setAnnotationState((current) => ({
      status: 'ready',
      url: loadState.url,
      annotations: [
        annotation,
        ...(current.status === 'ready' ? current.annotations : []),
      ],
    }))
    setAnnotationColors((current) => ({
      ...current,
      [annotation.id]: annotationPaletteColor(Object.keys(current).length),
    }))
    setObservationColorMode('annotations')
    setRoiName(defaultRoiName(roiIdRef.current + 1))
  }

  function handleExportRoiCells() {
    if (roiState.status !== 'ready') {
      return
    }

    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)
    downloadTextFile(`${slug(name)}-cells.csv`, roiCellsToCsv(roiState.cells))
    appendDebugEvent(`Exported ROI cells ${name}`)
  }

  function handleExportRoiTranscripts() {
    if (roiState.status !== 'ready') {
      return
    }

    const requestId = roiTranscriptExportRequestId.current + 1
    abortActiveRequest(roiTranscriptExportAbortRef)
    const abortController = new AbortController()
    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)
    roiTranscriptExportRequestId.current = requestId
    roiTranscriptExportAbortRef.current = abortController
    setRoiTranscriptExportState({ status: 'loading', url: roiState.url })
    appendDebugEvent(`Exporting ROI transcripts ${name}`)

    void loadRoiTranscripts(roiState.url, roiState.bbox, {
      signal: abortController.signal,
    })
      .then((transcripts) => {
        if (roiTranscriptExportRequestId.current !== requestId) {
          return
        }

        downloadTextFile(
          `${slug(name)}-transcripts.csv`,
          roiTranscriptsToCsv(transcripts),
        )
        setRoiTranscriptExportState({ status: 'idle' })
        appendDebugEvent(
          `Exported ROI transcripts: ${transcripts.length.toLocaleString()} rows`,
        )
      })
      .catch((error) => {
        if (isAbortError(error) || roiTranscriptExportRequestId.current !== requestId) {
          return
        }

        setRoiTranscriptExportState({
          status: 'error',
          url: roiState.url,
          error: createStructuredLoadError('ROI transcripts', error),
        })
        appendDebugEvent('ROI transcript export failed')
      })
      .finally(() => {
        if (roiTranscriptExportAbortRef.current === abortController) {
          roiTranscriptExportAbortRef.current = null
        }
      })
  }

  function updateMorphologyChannel(
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) {
    setMorphologyChannelSettings((current) =>
      current.map((setting) => (setting.id === id ? { ...setting, ...patch } : setting)),
    )
    appendDebugEvent(`${morphologyPatchLabel(patch)} ${shortIdentifier(id)}`, {
      coalesceKey: `morphology-channel:${id}`,
    })
  }

  function handleAutoContrast(channel: MorphologyImageChannel) {
    appendDebugEvent(`Auto contrast ${shortIdentifier(channel.info.id)}`)
    queueAutoContrast([channel])
  }

  function queueAutoContrast(
    channels: readonly MorphologyImageChannel[],
    options: {
      readonly requestId?: number
      readonly signal?: AbortSignal
    } = {},
  ) {
    const requestId = options.requestId ?? loadRequestId.current
    const signal = options.signal ?? datasetAbortRef.current?.signal
    const channelsToLoad: MorphologyImageChannel[] = []

    for (const channel of channels) {
      const channelId = channel.info.id

      if (autoContrastChannelIdsRef.current.has(channelId)) {
        continue
      }

      autoContrastChannelIdsRef.current.add(channelId)
      channelsToLoad.push(channel)
    }

    if (channelsToLoad.length === 0) {
      return
    }

    setAutoContrastChannelIds([...autoContrastChannelIdsRef.current])

    for (const channel of channelsToLoad) {
      startAutoContrast(channel, requestId, signal)
    }
  }

  function startAutoContrast(
    channel: MorphologyImageChannel,
    requestId: number,
    signal: AbortSignal | undefined,
  ) {
    const channelId = channel.info.id
    void computeAutoChannelContrast(channel, signal === undefined ? {} : { signal })
      .then((contrast) => {
        if (loadRequestId.current !== requestId) {
          return
        }

        updateMorphologyChannel(channelId, {
          contrastMin: contrast.min,
          contrastMax: contrast.max,
          histogram: contrast.histogram,
        })
      })
      .catch((error) => {
        if (isAbortError(error) || loadRequestId.current !== requestId) {
          return
        }

        setMorphologyState({
          status: 'error',
          url: channel.loader.url,
          error: createStructuredLoadError('Image tiles', error),
        })
      })
      .finally(() => {
        if (loadRequestId.current !== requestId) {
          return
        }

        autoContrastChannelIdsRef.current.delete(channelId)
        setAutoContrastChannelIds([...autoContrastChannelIdsRef.current])
      })
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#viewer-heading">
        Skip To Spatial View
      </a>
      <aside
        className={`control-hud${isControlHudCollapsed ? ' is-collapsed' : ''}`}
        aria-label="Dataset controls"
      >
        <div className="hud-top-bar">
          <LoadingIndicator tasks={loadingTasks} />
          <button
            type="button"
            className="hud-toggle"
            aria-controls="control-hud-content"
            aria-expanded={!isControlHudCollapsed}
            onClick={() => {
              const nextCollapsed = !isControlHudCollapsed
              setIsControlHudCollapsed(nextCollapsed)
              appendDebugEvent(nextCollapsed ? 'HUD collapsed' : 'HUD expanded')
            }}
          >
            {isControlHudCollapsed ? 'Show Controls' : 'Hide Controls'}
          </button>
        </div>
        <div
          id="control-hud-content"
          className="control-hud-content"
          hidden={isControlHudCollapsed}
        >
          <div className="hud-tab-list" role="tablist" aria-label="Control categories">
            {CONTROL_HUD_TABS.map((tab) => (
              <button
                key={tab.id}
                id={`hud-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={activeControlHudTab === tab.id}
                aria-controls={`hud-panel-${tab.id}`}
                aria-busy={loadingTabIds.has(tab.id)}
                className={
                  [
                    activeControlHudTab === tab.id ? 'active' : '',
                    loadingTabIds.has(tab.id) ? 'is-loading' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onClick={() => {
                  setActiveControlHudTab(tab.id)
                  appendDebugEvent(`HUD tab: ${tab.label}`, {
                    coalesceKey: 'hud-tab',
                  })
                }}
              >
                <span>{tab.label}</span>
                {loadingTabIds.has(tab.id) ? (
                  <span className="tab-loading-dot" aria-hidden="true" />
                ) : null}
              </button>
            ))}
          </div>

          <div className="hud-tab-panels">
            <div
              id="hud-panel-dataset"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-dataset"
              hidden={activeControlHudTab !== 'dataset'}
            >
              <form className="dataset-form" onSubmit={handleDatasetSubmit}>
                <label htmlFor={datasetInputId}>Dataset URL</label>
                <input
                  id={datasetInputId}
                  name="datasetUrl"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  defaultValue={datasetUrl}
                  placeholder="https://bucket.example/output…"
                />
                <label className="dataset-toggle" htmlFor={morphologyInputId}>
                  <input
                    id={morphologyInputId}
                    name="loadMorphologyImage"
                    type="checkbox"
                    checked={shouldLoadMorphology}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setShouldLoadMorphology(checked)
                      appendDebugEvent(
                        checked
                          ? 'Morphology image enabled'
                          : 'Morphology image disabled',
                      )
                    }}
                  />
                  <span>Morphology image</span>
                </label>
                <label htmlFor={boundaryLimitInputId}>Boundary limit</label>
                <input
                  id={boundaryLimitInputId}
                  name="boundaryCellLimit"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="5000"
                  step="1"
                  autoComplete="off"
                  value={boundaryCellLimit}
                  onChange={(event) => {
                    const nextLimit = normalizeBoundaryCellLimit(
                      event.currentTarget.valueAsNumber,
                    )
                    setBoundaryCellLimit(nextLimit)
                    appendDebugEvent(`Boundary limit: ${nextLimit.toLocaleString()}`, {
                      coalesceKey: 'boundary-limit',
                    })
                  }}
                />
                <button type="submit" disabled={isLoading}>
                  {isLoading ? 'Loading…' : 'Load Dataset'}
                </button>
              </form>

              <ErrorSummary errors={activeErrors} />
              <ActivityLog
                entries={debugLog}
                onClear={() => {
                  setDebugLog([])
                }}
              />
            </div>

            <div
              id="hud-panel-layers"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-layers"
              hidden={activeControlHudTab !== 'layers'}
            >
              <section className="layer-section" aria-labelledby="layer-heading">
                <h2 id="layer-heading">Layer Stack</h2>
                <p>
                  {scaffoldDeckLayerCount} Deck Layer - deck.gl {bundledDeckVersion}
                </p>
                <div className="layer-opacity-controls">
                  <div className="layer-opacity-control">
                    <div className="layer-opacity-header">
                      <label htmlFor={imageOpacityInputId}>Image opacity</label>
                      <span>{opacityToPercent(imageLayerOpacity)}%</span>
                    </div>
                    <input
                      id={imageOpacityInputId}
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={opacityToPercent(imageLayerOpacity)}
                      aria-valuetext={`${opacityToPercent(imageLayerOpacity)}%`}
                      onChange={(event) => {
                        const nextPercent = event.currentTarget.valueAsNumber
                        setImageLayerOpacity(percentToOpacity(nextPercent))
                        appendDebugEvent(`Image opacity: ${nextPercent}%`, {
                          coalesceKey: 'image-opacity',
                        })
                      }}
                    />
                  </div>
                  <div className="layer-opacity-control">
                    <div className="layer-opacity-header">
                      <label htmlFor={geneOpacityInputId}>Cell opacity</label>
                      <span>{opacityToPercent(geneLayerOpacity)}%</span>
                    </div>
                    <input
                      id={geneOpacityInputId}
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={opacityToPercent(geneLayerOpacity)}
                      aria-valuetext={`${opacityToPercent(geneLayerOpacity)}%`}
                      onChange={(event) => {
                        const nextPercent = event.currentTarget.valueAsNumber
                        setGeneLayerOpacity(percentToOpacity(nextPercent))
                        appendDebugEvent(`Cell opacity: ${nextPercent}%`, {
                          coalesceKey: 'gene-opacity',
                        })
                      }}
                    />
                  </div>
                </div>
                <div className="coordinate-unit-control">
                  <span id={coordinateUnitInputId}>Mouse coordinates</span>
                  <div
                    className="coordinate-unit-segmented"
                    role="group"
                    aria-labelledby={coordinateUnitInputId}
                  >
                    <button
                      type="button"
                      aria-pressed={coordinateUnit === 'um'}
                      onClick={() => {
                        if (coordinateUnit === 'um') {
                          return
                        }

                        setCoordinateUnit('um')
                        appendDebugEvent('Mouse coordinates: μm', {
                          coalesceKey: 'coordinate-unit',
                        })
                      }}
                    >
                      μm
                    </button>
                    <button
                      type="button"
                      aria-pressed={coordinateUnit === 'px'}
                      onClick={() => {
                        if (coordinateUnit === 'px') {
                          return
                        }

                        setCoordinateUnit('px')
                        appendDebugEvent('Mouse coordinates: px', {
                          coalesceKey: 'coordinate-unit',
                        })
                      }}
                    >
                      px
                    </button>
                  </div>
                </div>
                <MorphologyChannelControls
                  channels={morphologyImage?.channelLoaders ?? []}
                  settings={morphologyChannelSettings}
                  autoContrastChannelIds={autoContrastChannelIds}
                  onAutoContrast={handleAutoContrast}
                  onUpdate={updateMorphologyChannel}
                />
              </section>
            </div>

            <div
              id="hud-panel-genes"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-genes"
              hidden={activeControlHudTab !== 'genes'}
            >
              <section className="analysis-section" aria-labelledby="analysis-heading">
                <div className="section-heading-row">
                  <h2 id="analysis-heading">Analysis</h2>
                  <span
                    className={
                      genePanelState.status === 'loading' ||
                      geneExpressionState.status === 'loading'
                        ? 'status-chip is-loading'
                        : 'status-chip'
                    }
                    aria-live="polite"
                  >
                    {analysisHeaderCopy}
                  </span>
                </div>

                <label htmlFor={geneSearchInputId}>Gene selection</label>
                <input
                  id={geneSearchInputId}
                  type="search"
                  autoComplete="off"
                  spellCheck={false}
                  value={geneSearch}
                  disabled={genePanelState.status !== 'ready'}
                  placeholder="Search genes"
                  onChange={(event) => {
                    setGeneSearch(event.currentTarget.value)
                  }}
                />

                {selectedGenes.length === 0 ? null : (
                  <div className="gene-chip-row" aria-label="Selected genes">
                    {selectedGenes.map((gene) => (
                      <button
                        key={gene}
                        type="button"
                        className="gene-chip"
                        onClick={() => {
                          toggleGene(gene)
                        }}
                      >
                        {gene}
                      </button>
                    ))}
                  </div>
                )}

                <div className="gene-option-list" aria-label="Gene options">
                  {filteredGenes.map((gene) => (
                    <button
                      key={gene}
                      type="button"
                      className={selectedGenes.includes(gene) ? 'selected' : undefined}
                      onClick={() => {
                        toggleGene(gene)
                      }}
                    >
                      {gene}
                    </button>
                  ))}
                </div>

                <label htmlFor={geneSetSymbolsInputId}>Gene set symbols</label>
                <textarea
                  id={geneSetSymbolsInputId}
                  className="gene-set-symbols"
                  autoComplete="off"
                  spellCheck={false}
                  rows={3}
                  value={geneSetSymbols}
                  disabled={genePanelState.status !== 'ready'}
                  placeholder="Actb, Gad1, Slc17a7"
                  onChange={(event) => {
                    setGeneSetSymbols(event.currentTarget.value)
                  }}
                />
                <div className="gene-set-actions">
                  <button
                    type="button"
                    disabled={
                      genePanelState.status !== 'ready' || geneSetSymbols.trim() === ''
                    }
                    onClick={applyGeneSetSymbols}
                  >
                    Apply Symbols
                  </button>
                  <button
                    type="button"
                    disabled={selectedGenes.length === 0}
                    onClick={saveSelectedGeneSet}
                  >
                    Save Set
                  </button>
                </div>

                <label htmlFor={geneSetNameInputId}>Set name</label>
                <input
                  id={geneSetNameInputId}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={geneSetName}
                  placeholder={defaultGeneSetName(selectedGenes)}
                  onChange={(event) => {
                    setGeneSetName(event.currentTarget.value)
                  }}
                />

                <label htmlFor={geneSetScoreInputId}>Signature score</label>
                <select
                  id={geneSetScoreInputId}
                  value={geneExpressionScoreMode}
                  onChange={(event) => {
                    const nextScoreMode = event.currentTarget.value

                    if (isGeneExpressionScoreMode(nextScoreMode)) {
                      handleGeneExpressionScoreModeChange(nextScoreMode)
                    }
                  }}
                >
                  {GENE_EXPRESSION_SCORE_MODE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>

                {savedGeneSets.length === 0 ? null : (
                  <div className="gene-set-list" aria-label="Saved gene sets">
                    {savedGeneSets.map((geneSet) => (
                      <div key={geneSet.id} className="gene-set-row">
                        <button
                          type="button"
                          className="gene-set-apply"
                          aria-label={`Apply ${geneSet.name}`}
                          onClick={() => {
                            applySavedGeneSet(geneSet)
                          }}
                        >
                          <span>{geneSet.name}</span>
                          <small>{geneSet.scoreMode}</small>
                        </button>
                        <button
                          type="button"
                          className="gene-set-remove"
                          aria-label={`Remove ${geneSet.name}`}
                          onClick={() => {
                            removeSavedGeneSet(geneSet.id)
                          }}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <label htmlFor={geneScaleInputId}>Gene scale</label>
                <div className="gene-scale-control">
                  <select
                    id={geneScaleInputId}
                    value={geneExpressionColorScale}
                    onChange={(event) => {
                      const nextScale = event.currentTarget.value

                      if (isGeneExpressionColorScale(nextScale)) {
                        setGeneExpressionColorScale(nextScale)
                        appendDebugEvent(`Gene scale: ${nextScale}`)
                      }
                    }}
                  >
                    {GENE_EXPRESSION_COLOR_SCALE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`gene-scale-preview gene-scale-preview-${geneExpressionColorScale}`}
                    aria-hidden="true"
                  />
                  <div className="gene-scale-values" aria-label="Gene scale values">
                    <span>0</span>
                    <span>{formatGeneScaleValue(geneExpressionScaleMax / 2)}</span>
                    <span>{formatGeneScaleValue(geneExpressionScaleMax)}</span>
                  </div>
                </div>

                <label htmlFor={geneExpressionDetailInputId}>Expression detail</label>
                <select
                  id={geneExpressionDetailInputId}
                  value={geneExpressionDetailMode}
                  onChange={(event) => {
                    const nextMode = event.currentTarget.value

                    if (isGeneExpressionDetailMode(nextMode)) {
                      setGeneExpressionDetailMode(nextMode)
                      appendDebugEvent(`Expression detail: ${nextMode}`)
                    }
                  }}
                >
                  <option value="auto">Auto LOD</option>
                  <option value="exact-region">Exact region</option>
                </select>

                <label htmlFor={observationModeInputId}>Cell color</label>
                <select
                  id={observationModeInputId}
                  value={observationColorMode}
                  onChange={(event) => {
                    const nextMode = event.currentTarget.value

                    if (isObservationColorMode(nextMode)) {
                      setObservationColorMode(nextMode)
                      appendDebugEvent(`Cell color: ${nextMode}`)
                    }
                  }}
                >
                  <option value="transcript-count">Transcript count</option>
                  <option value="cell-area">Cell area</option>
                  {annotationStyleColors.length === 0 ? null : (
                    <option value="annotations">Annotations</option>
                  )}
                </select>

                <p className="analysis-status" aria-live="polite">
                  {geneExpressionCopy}
                </p>
              </section>
            </div>

            <div
              id="hud-panel-annotations"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-annotations"
              hidden={activeControlHudTab !== 'annotations'}
            >
              <section className="analysis-section" aria-labelledby="annotation-heading">
                <div className="section-heading-row">
                  <h2 id="annotation-heading">Annotations</h2>
                  <span
                    className={
                      annotationState.status === 'loading' ||
                      annotationGroupState.status === 'loading'
                        ? 'status-chip is-loading'
                        : 'status-chip'
                    }
                    aria-live="polite"
                  >
                    {annotationHeaderCopy}
                  </span>
                </div>
                <label htmlFor={annotationGroupInputId}>Annotation set</label>
                <select
                  id={annotationGroupInputId}
                  value={selectedAnnotationGroupId}
                  disabled={loadState.status !== 'ready'}
                  onChange={(event) => {
                    const nextGroupId = event.currentTarget.value
                    setSelectedAnnotationGroupId(nextGroupId)
                    appendDebugEvent(`Annotation set: ${shortIdentifier(nextGroupId)}`)
                  }}
                >
                  <option value={ALL_ANNOTATION_GROUP_ID}>All</option>
                  {annotationGroupOptions.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    loadState.status !== 'ready' || annotationState.status === 'loading'
                  }
                  onClick={handleLoadAnnotations}
                >
                  {annotationState.status === 'loading' ? 'Loading…' : 'Load Annotations'}
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={annotationState.status !== 'ready'}
                  onClick={handleClearAnnotations}
                >
                  Clear Annotations
                </button>
                <label
                  className="secondary-file-action"
                  htmlFor={annotationImportInputId}
                >
                  Import File
                </label>
                <input
                  id={annotationImportInputId}
                  className="visually-hidden-file"
                  type="file"
                  accept=".csv,.json,application/json,text/csv"
                  disabled={loadState.status !== 'ready'}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null
                    void handleImportAnnotations(file)
                    event.currentTarget.value = ''
                  }}
                />
                {annotationState.status === 'ready' &&
                annotationState.annotations.length > 0 ? (
                  <ul className="annotation-list" aria-label="Loaded annotations">
                    {annotationState.annotations.map((annotation, annotationIndex) => {
                      const annotationColor =
                        annotationColors[annotation.id] ??
                        annotationPaletteColor(annotationIndex)

                      return (
                        <li key={annotation.id}>
                          <label
                            className="annotation-color-picker"
                            style={
                              { '--annotation-color': annotationColor } as CSSProperties
                            }
                          >
                            <input
                              className="annotation-color-input"
                              type="color"
                              aria-label={`${annotation.label} color`}
                              value={annotationColor}
                              onChange={(event) => {
                                handleAnnotationColorChange(
                                  annotation.id,
                                  event.currentTarget.value,
                                )
                              }}
                            />
                            <span
                              className="annotation-color-swatch"
                              aria-hidden="true"
                            />
                          </label>
                          <span>{annotation.label}</span>
                          <small>{annotation.cellIds.length.toLocaleString()}</small>
                          <button
                            type="button"
                            className="annotation-remove"
                            aria-label={`Remove ${annotation.label}`}
                            onClick={() => {
                              handleRemoveAnnotation(annotation.id)
                            }}
                          >
                            x
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </section>
            </div>

            <div
              id="hud-panel-cell"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-cell"
              hidden={activeControlHudTab !== 'cell'}
            >
              <section className="analysis-section" aria-labelledby="embedding-heading">
                <div className="section-heading-row">
                  <h2 id="embedding-heading">UMAP/tSNE</h2>
                  <span
                    className={
                      analysisEmbeddingState.status === 'loading'
                        ? 'status-chip is-loading'
                        : 'status-chip'
                    }
                    aria-live="polite"
                  >
                    {embeddingCopy}
                  </span>
                </div>
                <div className="embedding-controls">
                  <label htmlFor={embeddingViewInputId}>Embedding view</label>
                  <select
                    id={embeddingViewInputId}
                    value={activeEmbedding?.kind ?? selectedEmbeddingKind}
                    disabled={
                      analysisEmbeddingState.status !== 'ready' ||
                      analysisEmbeddingState.embeddings.length === 0
                    }
                    onChange={(event) => {
                      const nextEmbeddingKind = event.currentTarget
                        .value as AnalysisEmbeddingKind
                      setSelectedEmbeddingKind(nextEmbeddingKind)
                      appendDebugEvent(`Embedding view: ${nextEmbeddingKind}`)
                    }}
                  >
                    {analysisEmbeddingState.status === 'ready' &&
                    analysisEmbeddingState.embeddings.length > 0 ? (
                      analysisEmbeddingState.embeddings.map((embedding) => (
                        <option key={embedding.kind} value={embedding.kind}>
                          {embedding.label}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="umap">UMAP</option>
                        <option value="tsne">t-SNE</option>
                      </>
                    )}
                  </select>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={
                      loadState.status !== 'ready' ||
                      analysisEmbeddingState.status === 'loading'
                    }
                    onClick={handleLoadAnalysisEmbeddings}
                  >
                    {analysisEmbeddingState.status === 'loading'
                      ? 'Loading...'
                      : 'Load Embeddings'}
                  </button>
                </div>
                <EmbeddingPanel
                  embedding={activeEmbedding}
                  roiCellIds={roiCellIds}
                  selectedCellId={selectedCell?.id ?? null}
                  onSelectCell={handleEmbeddingCellSelect}
                />
              </section>

              <section className="analysis-section" aria-labelledby="cell-info-heading">
                <h2 id="cell-info-heading">Cell Info</h2>
                <CellInfoPanel cell={selectedCell} />
              </section>
            </div>

            <div
              id="hud-panel-roi"
              className="hud-tab-panel"
              role="tabpanel"
              aria-labelledby="hud-tab-roi"
              hidden={activeControlHudTab !== 'roi'}
            >
              <section className="analysis-section" aria-labelledby="roi-heading">
                <div className="section-heading-row">
                  <h2 id="roi-heading">ROI</h2>
                  <span
                    className={
                      roiState.status === 'loading' ||
                      roiGeneStatsState.status === 'loading' ||
                      roiTranscriptExportState.status === 'loading'
                        ? 'status-chip is-loading'
                        : 'status-chip'
                    }
                    aria-live="polite"
                  >
                    {roiHeaderCopy}
                  </span>
                </div>
                <div className="roi-action-row">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={loadState.status !== 'ready'}
                    aria-pressed={roiMode === 'box'}
                    onClick={() => {
                      const nextMode = roiMode === 'box' ? 'idle' : 'box'
                      setRoiMode(nextMode)
                      appendDebugEvent(
                        nextMode === 'box'
                          ? 'ROI draw mode enabled'
                          : 'ROI draw cancelled',
                      )
                    }}
                  >
                    {roiMode === 'box' ? 'Drawing Box' : 'Draw Box'}
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={roiState.status === 'idle'}
                    onClick={handleClearRoi}
                  >
                    Clear
                  </button>
                </div>

                <label htmlFor={roiNameInputId}>ROI name</label>
                <input
                  id={roiNameInputId}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={roiName}
                  disabled={loadState.status !== 'ready'}
                  onChange={(event) => {
                    setRoiName(event.currentTarget.value)
                  }}
                />

                {roiSummary === null ? null : (
                  <dl className="roi-summary-list" aria-label="ROI summary">
                    <div>
                      <dt>Cells</dt>
                      <dd>
                        {roiSummary.cellCount.toLocaleString()}
                        {roiState.status === 'ready' && roiState.hitCellLimit ? '+' : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Mean transcripts</dt>
                      <dd>{formatNumber(roiSummary.meanTranscriptCount)}</dd>
                    </div>
                    <div>
                      <dt>Mean area</dt>
                      <dd>{formatNumber(roiSummary.meanCellArea)}</dd>
                    </div>
                  </dl>
                )}

                <RoiGeneStatsPanel copy={roiGeneStatsCopy} state={roiGeneStatsState} />

                <div className="roi-action-row">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={roiState.status !== 'ready'}
                    onClick={handleSaveRoiAnnotation}
                  >
                    Save ROI
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={roiState.status !== 'ready'}
                    onClick={handleExportRoiCells}
                  >
                    Export Cells
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={
                      roiState.status !== 'ready' ||
                      roiTranscriptExportState.status === 'loading'
                    }
                    onClick={handleExportRoiTranscripts}
                  >
                    {roiTranscriptExportState.status === 'loading'
                      ? 'Exporting...'
                      : 'Export Transcripts'}
                  </button>
                </div>
                {roiTranscriptExportState.status === 'loading' ? (
                  <p className="roi-gene-status" aria-live="polite">
                    Preparing ROI transcript CSV
                  </p>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      </aside>

      <section className="viewer-region" aria-labelledby="viewer-heading">
        <h2 id="viewer-heading" className="visually-hidden">
          Spatial View
        </h2>

        <ViewerCore
          cells={styledOverviewCells}
          expressionCells={styledGeneExpressionCells}
          boundaries={boundaryLayerData}
          imageLoader={morphologyImage?.loader ?? null}
          imageChannels={morphologyCanvasChannels}
          imageOpacity={imageLayerOpacity}
          geneExpressionOpacity={geneLayerOpacity}
          observationColorMode={viewerObservationColorMode}
          annotationStyleColors={activeAnnotationStyleColors}
          coordinateUnit={coordinateUnit}
          status={loadState.status}
          imageStatus={morphologyState.status}
          boundaryStatus={boundaryState.status}
          roiMode={roiMode}
          roiBbox={activeRoiBbox}
          onImageTileError={handleImageTileError}
          onViewportCellCountChange={setViewportCellCount}
          onViewportChange={handleViewportChange}
          onRoiComplete={handleRoiComplete}
          onCellClick={(cell) => {
            setSelectedCell(cell)
          }}
          {...(loadState.status === 'error'
            ? { errorMessage: formatStructuredError(loadState.error) }
            : {})}
          {...(morphologyState.status === 'error'
            ? { imageErrorMessage: formatStructuredError(morphologyState.error) }
            : {})}
          {...(morphologyMicrometersPerPixel === undefined
            ? {}
            : {
                micrometersPerPixel: morphologyMicrometersPerPixel,
              })}
          {...(boundaryState.status === 'error'
            ? { boundaryErrorMessage: formatStructuredError(boundaryState.error) }
            : {})}
        />
      </section>
    </main>
  )
}

async function defaultComputeAutoChannelContrast(
  channel: MorphologyImageChannel,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ChannelAutoContrast> {
  const morphologyContrast = await import('./data/morphologyContrast')
  return morphologyContrast.computeChannelAutoContrast(channel.loader, options)
}

function genePanelStatusCopy(genePanelState: GenePanelState): string {
  if (genePanelState.status === 'loading') {
    return 'Loading'
  }

  if (genePanelState.status === 'ready') {
    return `${genePanelState.genes.length.toLocaleString()} genes`
  }

  if (genePanelState.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

function annotationStatusCopy(annotationState: AnnotationState): string {
  if (annotationState.status === 'loading') {
    return 'Loading'
  }

  if (annotationState.status === 'ready') {
    const noun = annotationState.annotations.length === 1 ? 'label' : 'labels'
    return `${annotationState.annotations.length.toLocaleString()} ${noun}`
  }

  if (annotationState.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

function analysisEmbeddingStatusCopy(
  state: AnalysisEmbeddingState,
  activeEmbedding: AnalysisEmbedding | null,
  roiCellIds: readonly string[],
  selectedCell: OverviewCellDatum | null,
): string {
  if (state.status === 'loading') {
    return 'Loading'
  }

  if (state.status === 'ready') {
    if (activeEmbedding === null) {
      return 'No projection'
    }

    const linkedCount = roiCellIds.length + (selectedCell === null ? 0 : 1)

    return linkedCount === 0
      ? `${activeEmbedding.label}: ${activeEmbedding.points.length.toLocaleString()} cells`
      : `${activeEmbedding.label}: ${linkedCount.toLocaleString()} linked`
  }

  if (state.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

function roiStatusCopy(roiState: RoiState, roiMode: RoiDrawMode): string {
  if (roiMode === 'box') {
    return 'Drawing'
  }

  if (roiState.status === 'loading') {
    return 'Loading'
  }

  if (roiState.status === 'ready') {
    const noun = roiState.cells.length === 1 ? 'cell' : 'cells'
    return `${roiState.cells.length.toLocaleString()}${roiState.hitCellLimit ? '+' : ''} ${noun}`
  }

  if (roiState.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

function roiGeneStatsStatusCopy(roiGeneStatsState: RoiGeneStatsState): string {
  if (roiGeneStatsState.status === 'loading') {
    return `Genes loading for ${roiGeneStatsState.cellCount.toLocaleString()} cells`
  }

  if (roiGeneStatsState.status === 'ready') {
    if (roiGeneStatsState.stats.genes.length === 0) {
      return 'Genes: none'
    }

    return `Genes: top ${roiGeneStatsState.stats.genes.length}`
  }

  if (roiGeneStatsState.status === 'error') {
    return roiGeneStatsState.error.title
  }

  return 'Genes idle'
}

function isObservationColorMode(value: string): value is ObservationColorMode {
  return value === 'transcript-count' || value === 'cell-area' || value === 'annotations'
}

function hasReadyAnnotationsAfterRemove(
  annotationState: AnnotationState,
  annotationId: string,
): boolean {
  return (
    annotationState.status === 'ready' &&
    annotationState.annotations.some((annotation) => annotation.id !== annotationId)
  )
}

function geneExpressionStatusCopy(geneExpressionState: GeneExpressionState): string {
  if (geneExpressionState.status === 'loading') {
    return `${geneExpressionModeLabel(geneExpressionState.mode)}: ${geneExpressionState.genes.join(', ')}`
  }

  if (geneExpressionState.status === 'ready') {
    const noun = geneExpressionState.cellCount === 1 ? 'cell' : 'cells'

    if (geneExpressionState.mode === 'exact-region') {
      return `Expression exact region: ${geneExpressionState.cellCount.toLocaleString()} ${noun}`
    }

    if (geneExpressionState.mode === 'overview-sampled') {
      return `Expression overview: ${geneExpressionState.cellCount.toLocaleString()} positive ${noun} across ${geneExpressionState.visibleCellCount.toLocaleString()} slide cells`
    }

    if (
      geneExpressionState.mode === 'sampled' &&
      geneExpressionState.visibleCellCount > geneExpressionState.cellCount
    ) {
      const visibleNoun = geneExpressionState.visibleCellCount === 1 ? 'cell' : 'cells'

      return `Expression sample: ${geneExpressionState.cellCount.toLocaleString()} of ${geneExpressionState.visibleCellCount.toLocaleString()} visible ${visibleNoun}`
    }

    return `Expression: ${geneExpressionState.cellCount.toLocaleString()} ${noun}`
  }

  if (geneExpressionState.status === 'waiting') {
    return geneExpressionState.message
  }

  if (geneExpressionState.status === 'error') {
    return `Expression failed - ${geneExpressionState.error.title}`
  }

  return 'Expression: none'
}

function geneExpressionModeLabel(mode: GeneExpressionLoadMode): string {
  if (mode === 'overview-sampled') {
    return 'Expression overview'
  }

  if (mode === 'sampled') {
    return 'Expression sample'
  }

  if (mode === 'exact-region') {
    return 'Expression exact region'
  }

  return 'Expression'
}

function isGeneExpressionDetailMode(value: string): value is GeneExpressionDetailMode {
  return value === 'auto' || value === 'exact-region'
}

function geneExpressionScaleKeyFor(
  datasetUrl: string,
  scoreMode: GeneExpressionScoreMode,
  genes: readonly string[],
): string {
  return [datasetUrl, scoreMode, genes.join('|')].join('::')
}

function overviewCellsToBbox(cells: readonly OverviewCellDatum[]): BBox | null {
  if (cells.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const cell of cells) {
    const [x = 0, deckY = 0] = cell.position
    const rawY = -deckY

    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, rawY)
    maxY = Math.max(maxY, rawY)
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

function filterGeneOptions(
  genes: readonly string[],
  search: string,
  selectedGenes: readonly string[],
): readonly string[] {
  const normalizedSearch = search.trim().toLowerCase()
  const selected = new Set(selectedGenes)
  const matches: string[] = []

  for (const gene of genes) {
    if (selected.has(gene)) {
      continue
    }

    if (normalizedSearch.length === 0 || gene.toLowerCase().includes(normalizedSearch)) {
      matches.push(gene)
    }

    if (matches.length >= 24) {
      break
    }
  }

  return matches
}

function parseGeneSetSymbols(
  value: string,
  availableGenes: readonly string[],
): readonly string[] {
  if (value.trim().length === 0 || availableGenes.length === 0) {
    return []
  }

  const availableGenesByNormalizedName = new Map<string, string>()

  for (const gene of availableGenes) {
    availableGenesByNormalizedName.set(gene.toLowerCase(), gene)
  }

  const selectedGenes = new Set<string>()
  const parsedGenes: string[] = []

  for (const symbol of value.split(GENE_SET_SYMBOL_SPLIT_PATTERN)) {
    const normalizedSymbol = symbol.trim().toLowerCase()

    if (normalizedSymbol.length === 0) {
      continue
    }

    const gene = availableGenesByNormalizedName.get(normalizedSymbol)

    if (gene === undefined || selectedGenes.has(gene)) {
      continue
    }

    selectedGenes.add(gene)
    parsedGenes.push(gene)
  }

  return parsedGenes.sort((left, right) => left.localeCompare(right))
}

function mergeImportedAnnotations(
  currentAnnotations: readonly Annotation[],
  importedAnnotations: readonly Annotation[],
  importedPrefix: string,
): readonly Annotation[] {
  return [
    ...currentAnnotations.filter(
      (annotation) => !annotation.id.startsWith(importedPrefix),
    ),
    ...importedAnnotations,
  ]
}

function colorsForAnnotations(
  annotations: readonly Annotation[],
  currentColors: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const nextColors: Record<string, string> = { ...currentColors }
  let colorIndex = Object.keys(nextColors).length

  for (const annotation of annotations) {
    if (nextColors[annotation.id] !== undefined) {
      continue
    }

    nextColors[annotation.id] = annotationPaletteColor(colorIndex)
    colorIndex += 1
  }

  return nextColors
}

function removeAnnotationColor(
  colors: Readonly<Record<string, string>>,
  annotationId: string,
): Readonly<Record<string, string>> {
  const remainingColors: Record<string, string> = {}

  for (const [candidateId, color] of Object.entries(colors)) {
    if (candidateId !== annotationId) {
      remainingColors[candidateId] = color
    }
  }

  return remainingColors
}

function removeAnnotationColorsByPrefix(
  colors: Readonly<Record<string, string>>,
  prefix: string,
): Readonly<Record<string, string>> {
  const remainingColors: Record<string, string> = {}

  for (const [annotationId, color] of Object.entries(colors)) {
    if (!annotationId.startsWith(prefix)) {
      remainingColors[annotationId] = color
    }
  }

  return remainingColors
}

function customAnnotationFilePrefix(fileName: string): string {
  return `custom:${slug(fileName)}:`
}

function slug(value: string): string {
  const slugged = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slugged.length === 0 ? 'annotation' : slugged
}

function defaultGeneSetName(genes: readonly string[]): string {
  if (genes.length === 0) {
    return 'Selected genes'
  }

  if (genes.length <= 3) {
    return genes.join(', ')
  }

  return `${genes.slice(0, 3).join(', ')} +${genes.length - 3}`
}

const EMBEDDING_RENDER_POINT_LIMIT = 120_000
const EMBEDDING_PLOT_FALLBACK_WIDTH = 320
const EMBEDDING_PLOT_FALLBACK_HEIGHT = 190
const EMBEDDING_PLOT_PADDING = 12

interface EmbeddingBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

function EmbeddingPanel({
  embedding,
  roiCellIds,
  selectedCellId,
  onSelectCell,
}: {
  readonly embedding: AnalysisEmbedding | null
  readonly roiCellIds: readonly string[]
  readonly selectedCellId: string | null
  readonly onSelectCell: (cellId: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sampledPoints = useMemo(
    () =>
      embedding === null
        ? []
        : sampleEmbeddingPoints(embedding.points, EMBEDDING_RENDER_POINT_LIMIT),
    [embedding],
  )
  const bounds = useMemo(
    () => (embedding === null ? null : embeddingBounds(embedding.points)),
    [embedding],
  )
  const pointByCellId = useMemo(
    () =>
      embedding === null
        ? new Map<string, AnalysisEmbeddingPoint>()
        : mapEmbeddingPoints(embedding.points),
    [embedding],
  )
  const roiPoints = useMemo(
    () =>
      roiCellIds.flatMap((cellId) => {
        const point = pointByCellId.get(cellId)

        return point === undefined ? [] : [point]
      }),
    [pointByCellId, roiCellIds],
  )
  const selectedPoint =
    selectedCellId === null ? undefined : pointByCellId.get(selectedCellId)

  useEffect(() => {
    if (embedding === null || bounds === null) {
      return
    }

    const canvas = canvasRef.current

    if (canvas === null) {
      return
    }

    const context = canvas.getContext('2d')

    if (context === null) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const width = Math.max(
      1,
      Math.round(rect.width || canvas.clientWidth || EMBEDDING_PLOT_FALLBACK_WIDTH),
    )
    const height = Math.max(
      1,
      Math.round(rect.height || canvas.clientHeight || EMBEDDING_PLOT_FALLBACK_HEIGHT),
    )
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1)

    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    drawEmbeddingPlot(context, width, height, bounds, {
      basePoints: sampledPoints,
      roiPoints,
      selectedPoint,
    })
  }, [bounds, embedding, roiPoints, sampledPoints, selectedPoint])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (embedding === null || bounds === null) {
        return
      }

      const canvas = canvasRef.current

      if (canvas === null) {
        return
      }

      const rect = canvas.getBoundingClientRect()
      const width = rect.width || canvas.clientWidth || EMBEDDING_PLOT_FALLBACK_WIDTH
      const height = rect.height || canvas.clientHeight || EMBEDDING_PLOT_FALLBACK_HEIGHT
      const point = nearestEmbeddingPoint(
        embedding.points,
        bounds,
        event.clientX - rect.left,
        event.clientY - rect.top,
        width,
        height,
      )

      if (point !== null) {
        onSelectCell(point.id)
      }
    },
    [bounds, embedding, onSelectCell],
  )

  if (embedding === null) {
    return <p className="embedding-empty">No embedding loaded</p>
  }

  return (
    <div className="embedding-panel">
      <div className="embedding-plot-shell">
        <canvas
          ref={canvasRef}
          className="embedding-plot"
          role="img"
          aria-label={`${embedding.label} embedding, ${embedding.points.length.toLocaleString()} cells`}
          onPointerDown={handlePointerDown}
        />
      </div>
      <dl className="embedding-summary" aria-label="Embedding link summary">
        <div>
          <dt>Cells</dt>
          <dd>{embedding.points.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Shown</dt>
          <dd>{sampledPoints.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>ROI</dt>
          <dd>{roiPoints.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd>{selectedPoint === undefined ? '0' : '1'}</dd>
        </div>
      </dl>
    </div>
  )
}

function sampleEmbeddingPoints(
  points: readonly AnalysisEmbeddingPoint[],
  limit: number,
): readonly AnalysisEmbeddingPoint[] {
  if (points.length <= limit) {
    return points
  }

  const sampledPoints: AnalysisEmbeddingPoint[] = []
  const step = points.length / limit

  for (let index = 0; index < limit; index += 1) {
    const point = points[Math.floor((index + 0.5) * step)]

    if (point !== undefined) {
      sampledPoints.push(point)
    }
  }

  return sampledPoints
}

function mapEmbeddingPoints(
  points: readonly AnalysisEmbeddingPoint[],
): ReadonlyMap<string, AnalysisEmbeddingPoint> {
  const pointByCellId = new Map<string, AnalysisEmbeddingPoint>()

  for (const point of points) {
    pointByCellId.set(point.id, point)
  }

  return pointByCellId
}

function embeddingBounds(points: readonly AnalysisEmbeddingPoint[]): EmbeddingBounds {
  if (points.length === 0) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  if (minX === maxX) {
    minX -= 0.5
    maxX += 0.5
  }

  if (minY === maxY) {
    minY -= 0.5
    maxY += 0.5
  }

  return { minX, maxX, minY, maxY }
}

function drawEmbeddingPlot(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bounds: EmbeddingBounds,
  layers: {
    readonly basePoints: readonly AnalysisEmbeddingPoint[]
    readonly roiPoints: readonly AnalysisEmbeddingPoint[]
    readonly selectedPoint: AnalysisEmbeddingPoint | undefined
  },
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#171511'
  context.fillRect(0, 0, width, height)

  context.fillStyle = 'rgba(246, 242, 232, 0.28)'
  for (const point of layers.basePoints) {
    const [x, y] = embeddingPointToScreen(point, bounds, width, height)
    context.fillRect(x, y, 1.2, 1.2)
  }

  context.fillStyle = 'rgba(240, 200, 75, 0.92)'
  for (const point of layers.roiPoints) {
    const [x, y] = embeddingPointToScreen(point, bounds, width, height)
    context.beginPath()
    context.arc(x, y, 2.4, 0, Math.PI * 2)
    context.fill()
  }

  if (layers.selectedPoint !== undefined) {
    const [x, y] = embeddingPointToScreen(layers.selectedPoint, bounds, width, height)
    context.beginPath()
    context.arc(x, y, 4.4, 0, Math.PI * 2)
    context.fillStyle = 'rgba(215, 63, 124, 0.98)'
    context.fill()
    context.lineWidth = 1.5
    context.strokeStyle = 'rgba(255, 253, 247, 0.92)'
    context.stroke()
  }
}

function nearestEmbeddingPoint(
  points: readonly AnalysisEmbeddingPoint[],
  bounds: EmbeddingBounds,
  screenX: number,
  screenY: number,
  width: number,
  height: number,
): AnalysisEmbeddingPoint | null {
  let nearestPoint: AnalysisEmbeddingPoint | null = null
  let nearestDistanceSquared = 9 * 9

  for (const point of points) {
    const [x, y] = embeddingPointToScreen(point, bounds, width, height)
    const dx = x - screenX
    const dy = y - screenY
    const distanceSquared = dx * dx + dy * dy

    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared
      nearestPoint = point
    }
  }

  return nearestPoint
}

function embeddingPointToScreen(
  point: AnalysisEmbeddingPoint,
  bounds: EmbeddingBounds,
  width: number,
  height: number,
): readonly [number, number] {
  const plotWidth = Math.max(1, width - EMBEDDING_PLOT_PADDING * 2)
  const plotHeight = Math.max(1, height - EMBEDDING_PLOT_PADDING * 2)
  const xRatio = (point.x - bounds.minX) / Math.max(1e-9, bounds.maxX - bounds.minX)
  const yRatio = (point.y - bounds.minY) / Math.max(1e-9, bounds.maxY - bounds.minY)

  return [
    EMBEDDING_PLOT_PADDING + xRatio * plotWidth,
    EMBEDDING_PLOT_PADDING + (1 - yRatio) * plotHeight,
  ]
}

function CellInfoPanel({ cell }: { readonly cell: OverviewCellDatum | null }) {
  if (cell === null) {
    return <p className="cell-info-empty">No cell selected</p>
  }

  return (
    <dl className="cell-info-list">
      <div>
        <dt>ID</dt>
        <dd>{cell.id}</dd>
      </div>
      <div>
        <dt>Position</dt>
        <dd>
          {formatNumber(cell.position[0])}, {formatNumber(-(cell.position[1] ?? 0))}
        </dd>
      </div>
      <div>
        <dt>Transcripts</dt>
        <dd>{formatOptionalNumber(cell.transcriptCount)}</dd>
      </div>
      <div>
        <dt>Cell Area</dt>
        <dd>{formatOptionalNumber(cell.cellArea)}</dd>
      </div>
      <div>
        <dt>Expression</dt>
        <dd>
          {cell.expressionCount === undefined
            ? 'None'
            : `${cell.expressionCount.toLocaleString()} ${cell.expressionGenes?.join(', ') ?? ''}`}
        </dd>
      </div>
    </dl>
  )
}

function MorphologyChannelControls({
  autoContrastChannelIds,
  channels,
  onAutoContrast,
  settings,
  onUpdate,
}: {
  readonly autoContrastChannelIds: readonly string[]
  readonly channels: readonly MorphologyImageChannel[]
  readonly onAutoContrast: (channel: MorphologyImageChannel) => void
  readonly settings: readonly MorphologyChannelSetting[]
  readonly onUpdate: (
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) => void
}) {
  if (channels.length === 0) {
    return null
  }

  return (
    <div className="channel-controls" aria-label="Image channels">
      {channels.map((channel) => {
        const setting = settings.find((candidate) => candidate.id === channel.info.id)
        const color = setting?.color ?? channel.info.color
        const contrastMin = setting?.contrastMin ?? channel.info.contrast.min
        const contrastMax = setting?.contrastMax ?? channel.info.contrast.max
        const isAutoContrastLoading = autoContrastChannelIds.includes(channel.info.id)
        const histogram = setting?.histogram

        return (
          <div className="channel-control" key={channel.info.id}>
            <label className="channel-toggle">
              <input
                type="checkbox"
                checked={setting?.enabled ?? false}
                onChange={(event) => {
                  onUpdate(channel.info.id, { enabled: event.currentTarget.checked })
                }}
              />
              <span>{channel.info.name}</span>
            </label>
            <input
              className="channel-color"
              type="color"
              aria-label={`${channel.info.name} color`}
              value={rgbToHex(color)}
              onChange={(event) => {
                onUpdate(channel.info.id, { color: hexToRgb(event.currentTarget.value) })
              }}
            />
            <button
              className="channel-auto-button"
              type="button"
              aria-label={`${channel.info.name} auto contrast`}
              disabled={isAutoContrastLoading}
              onClick={() => {
                onAutoContrast(channel)
              }}
            >
              {isAutoContrastLoading ? '...' : 'Auto'}
            </button>
            <div className="channel-contrast">
              <input
                type="number"
                inputMode="numeric"
                aria-label={`${channel.info.name} minimum`}
                value={contrastMin}
                onChange={(event) => {
                  onUpdate(channel.info.id, {
                    contrastMin: event.currentTarget.valueAsNumber,
                  })
                }}
              />
              <input
                type="number"
                inputMode="numeric"
                aria-label={`${channel.info.name} maximum`}
                value={contrastMax}
                onChange={(event) => {
                  onUpdate(channel.info.id, {
                    contrastMax: event.currentTarget.valueAsNumber,
                  })
                }}
              />
            </div>
            <ChannelHistogramView histogram={histogram} label={channel.info.name} />
          </div>
        )
      })}
    </div>
  )
}

function ChannelHistogramView({
  histogram,
  label,
}: {
  readonly histogram: ChannelHistogram | undefined
  readonly label: string
}) {
  const bins = histogram?.bins ?? EMPTY_HISTOGRAM_BINS
  const maxCount = histogram?.maxCount ?? 1

  return (
    <div
      className="channel-histogram"
      aria-label={`${label} histogram`}
      title={
        histogram === undefined
          ? `${label} histogram`
          : `${label} histogram, ${histogram.sampleCount.toLocaleString()} samples`
      }
    >
      {bins.map((count, index) => (
        <span
          className="channel-histogram-bar"
          key={index}
          style={{ transform: `scaleY(${Math.max(0.04, count / maxCount)})` }}
        />
      ))}
    </div>
  )
}

function ErrorSummary({ errors }: { readonly errors: readonly StructuredLoadError[] }) {
  if (errors.length === 0) {
    return null
  }

  return (
    <section className="error-summary" role="alert" aria-label="Load issues">
      <h2>Issues</h2>
      <ul>
        {errors.map((error) => (
          <li key={`${error.source}:${error.code}:${error.message}`}>
            <div className="error-summary-heading">
              <strong>{error.source}</strong>
              <span>{error.title}</span>
            </div>
            <p>{error.message}</p>
            <p>{error.action}</p>
            {error.detail === undefined ? null : <p>{error.detail}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function LoadingIndicator({ tasks }: { readonly tasks: readonly LoadingTask[] }) {
  if (tasks.length === 0) {
    return null
  }

  const primaryTask = tasks[0]
  const secondaryTasks = tasks.slice(1)

  if (primaryTask === undefined) {
    return null
  }

  const visibleSecondaryTasks = secondaryTasks.slice(0, 3)
  const hiddenTaskCount = secondaryTasks.length - visibleSecondaryTasks.length

  return (
    <section
      className="loading-indicator"
      role="status"
      aria-label="Active loading tasks"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="loading-indicator-primary">
        <span className="loading-spinner" aria-hidden="true" />
        <span>{primaryTask.label}</span>
        {primaryTask.detail === undefined ? null : <small>{primaryTask.detail}</small>}
      </div>
      {visibleSecondaryTasks.length === 0 ? null : (
        <ol aria-label="Additional loading tasks">
          {visibleSecondaryTasks.map((task) => (
            <li key={task.id}>
              <span>{task.label}</span>
              {task.detail === undefined ? null : <small>{task.detail}</small>}
            </li>
          ))}
          {hiddenTaskCount > 0 ? <li>+{hiddenTaskCount} more</li> : null}
        </ol>
      )}
    </section>
  )
}

function ActivityLog({
  entries,
  onClear,
}: {
  readonly entries: readonly DebugLogEntry[]
  readonly onClear: () => void
}) {
  return (
    <section className="activity-log" aria-label="Activity log">
      <div className="activity-log-heading">
        <h2>Log</h2>
        <button type="button" disabled={entries.length === 0} onClick={onClear}>
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <p>Idle</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <time dateTime={new Date(entry.timestamp).toISOString()}>
                {formatDebugTimestamp(entry.timestamp)}
              </time>
              <span title={entry.message}>{entry.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function summarizeRoiCells(cells: readonly DatasetCell[]): RoiSummary {
  if (cells.length === 0) {
    return {
      cellCount: 0,
      meanTranscriptCount: 0,
      meanCellArea: undefined,
    }
  }

  let transcriptTotal = 0
  let cellAreaTotal = 0
  let cellAreaCount = 0

  for (const cell of cells) {
    transcriptTotal += cell.transcriptCount ?? 0

    if (cell.cellArea !== undefined) {
      cellAreaTotal += cell.cellArea
      cellAreaCount += 1
    }
  }

  return {
    cellCount: cells.length,
    meanTranscriptCount: transcriptTotal / cells.length,
    meanCellArea: cellAreaCount === 0 ? undefined : cellAreaTotal / cellAreaCount,
  }
}

function RoiGeneStatsPanel({
  copy,
  state,
}: {
  readonly copy: string
  readonly state: RoiGeneStatsState
}) {
  if (state.status === 'idle') {
    return null
  }

  if (state.status === 'loading') {
    return (
      <p className="roi-gene-status" aria-live="polite">
        {copy}
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <p className="roi-gene-status" aria-live="polite">
        {copy}
      </p>
    )
  }

  if (state.stats.genes.length === 0) {
    return (
      <p className="roi-gene-status" aria-live="polite">
        No detected ROI gene expression
      </p>
    )
  }

  const maxCount = Math.max(...state.stats.genes.map((gene) => gene.count), 1)

  return (
    <section className="roi-gene-panel" aria-label="ROI gene distribution">
      <div className="roi-gene-heading">
        <span>Top ROI genes</span>
        <small>
          {state.stats.hitCellLimit
            ? `${state.stats.sampledCellCount.toLocaleString()} sampled`
            : `${state.stats.sampledCellCount.toLocaleString()} cells`}
        </small>
      </div>
      <ol className="roi-gene-list">
        {state.stats.genes.map((gene) => (
          <li
            key={gene.gene}
            style={
              {
                '--roi-gene-width': `${Math.max(4, (gene.count / maxCount) * 100)}%`,
              } as CSSProperties
            }
          >
            <div className="roi-gene-row">
              <span>{gene.gene}</span>
              <strong>{gene.count.toLocaleString()}</strong>
            </div>
            <div className="roi-gene-bar" aria-hidden="true" />
            <small>
              {formatPercent(gene.percentTotal)} total ·{' '}
              {formatPercent(gene.percentCells)} cells · {formatNumber(gene.meanPerCell)}
              /cell
            </small>
          </li>
        ))}
      </ol>
    </section>
  )
}

function emptyRoiGeneStats(): RoiGeneStats {
  return {
    genes: [],
    cellCount: 0,
    sampledCellCount: 0,
    totalCount: 0,
    hitCellLimit: false,
  }
}

function roiCellsToCsv(cells: readonly DatasetCell[]): string {
  const rows = [
    ['cell_id', 'x_centroid', 'y_centroid', 'transcript_counts', 'cell_area'],
    ...cells.map((cell) => [
      cell.id,
      String(cell.position.x),
      String(cell.position.y),
      String(cell.transcriptCount ?? ''),
      String(cell.cellArea ?? ''),
    ]),
  ]

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

function roiTranscriptsToCsv(transcripts: readonly DatasetTranscript[]): string {
  const rows = [
    [
      'cell_id',
      'feature_name',
      'x_location',
      'y_location',
      'z_location',
      'qv',
      'overlaps_nucleus',
      'is_gene',
    ],
    ...transcripts.map((transcript) => [
      transcript.cellId ?? '',
      transcript.featureName,
      String(transcript.position.x),
      String(transcript.position.y),
      transcript.zLocation === undefined ? '' : String(transcript.zLocation),
      String(transcript.qv),
      transcript.overlapsNucleus === undefined ? '' : String(transcript.overlapsNucleus),
      transcript.isGene === undefined ? '' : String(transcript.isGene),
    ]),
  ]

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function downloadTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function defaultRoiName(index: number): string {
  return `ROI ${index}`
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? 'None' : formatNumber(value)
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? '0'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function formatPercent(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function formatGeneScaleValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0'
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: value < 10 ? 2 : 1,
  })
}

function formatDebugTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function shortDatasetLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const lastPathSegment = parsed.pathname.split('/').filter(Boolean).at(-1)
    return shortIdentifier(lastPathSegment ?? parsed.host)
  } catch {
    return shortIdentifier(url)
  }
}

function shortIdentifier(value: string): string {
  const normalized = value.trim()

  if (normalized.length <= 24) {
    return normalized
  }

  return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`
}

function morphologyPatchLabel(
  patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
): string {
  if ('enabled' in patch) {
    return patch.enabled ? 'Channel enabled' : 'Channel disabled'
  }

  if ('color' in patch) {
    return 'Channel color'
  }

  if ('contrastMin' in patch || 'contrastMax' in patch) {
    return 'Channel contrast'
  }

  return 'Channel updated'
}

function abortActiveRequest(ref: { current: AbortController | null }): void {
  ref.current?.abort()
  ref.current = null
}

function createMorphologyChannelSettings(
  image: MorphologyImage,
): readonly MorphologyChannelSetting[] {
  return image.channelLoaders.map((channel, index) => ({
    id: channel.info.id,
    enabled: index === 0,
    color: channel.info.color,
    contrastMin: channel.info.contrast.min,
    contrastMax: channel.info.contrast.max,
  }))
}

function normalizeChannelContrast(options: {
  readonly min: number
  readonly max: number
}): { readonly lo: number; readonly hi: number } {
  const lo = Number.isFinite(options.min) ? options.min : 0
  const hi = Number.isFinite(options.max) ? options.max : lo + 1

  return hi > lo ? { lo, hi } : { lo, hi: lo + 1 }
}

function rgbToHex(color: readonly [number, number, number]): string {
  return `#${color.map((channel) => clampColorChannel(channel).toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(value: string): readonly [number, number, number] {
  const normalized = value.trim().replace(/^#/, '')

  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return [255, 255, 255]
  }

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}

function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isStructuredLoadError(
  error: StructuredLoadError | null,
): error is StructuredLoadError {
  return error !== null
}

function formatStructuredError(error: StructuredLoadError): string {
  return `${error.title}: ${error.message}`
}

function createStructuredLoadError(
  source: LoadErrorSource,
  error: unknown,
): StructuredLoadError {
  const message = readErrorMessage(error)
  const normalizedMessage = message.toLowerCase()
  const detail = readErrorDetail(error)

  if (
    normalizedMessage.includes('cannot be range-read') ||
    normalizedMessage.includes('expected http 206')
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'range-not-supported',
        title: 'Byte-range requests blocked',
        message,
        action: 'Configure the host to return HTTP 206 for Range requests.',
      },
      detail,
    )
  }

  const httpStatus = /\bhttp\s+(\d{3})\b/i.exec(message)?.[1]

  if (httpStatus !== undefined) {
    return withOptionalDetail(
      {
        source,
        code: 'http',
        title: `HTTP ${httpStatus} response`,
        message,
        action: 'Check the dataset URL and object permissions.',
      },
      detail,
    )
  }

  if (
    error instanceof TypeError ||
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('networkerror')
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'network',
        title: 'Network request failed',
        message,
        action: 'Check dataset URL, CORS, and network access.',
      },
      detail,
    )
  }

  if (isCellsParquetDecodeError(source, normalizedMessage)) {
    return withOptionalDetail(
      {
        source,
        code: 'parquet-decode',
        title: 'cells.parquet decode failed',
        message: normalizedMessage.includes('unable to decode cells.parquet')
          ? message
          : `The overview cells.parquet file was reachable, but the browser Parquet reader could not decode it: ${message}.`,
        action:
          'Rewrite cells.parquet with a browser-compatible Parquet encoding or use an alternate overview reader for this dataset.',
      },
      detail,
    )
  }

  if (
    source === 'ROI genes' &&
    normalizedMessage.includes('cell-major cell_feature_matrix')
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'unsupported',
        title: 'ROI gene matrix unsupported',
        message,
        action:
          'Use a cell-major cell_feature_matrix reader for ROI gene stats; keep transcripts.parquet for raw transcript export.',
      },
      detail,
    )
  }

  if (
    normalizedMessage.includes('experiment.xenium') ||
    normalizedMessage.includes('no supported xenium ome-tiff')
  ) {
    return withOptionalDetail(
      {
        source,
        code: 'manifest',
        title: 'Dataset manifest is incomplete',
        message,
        action: 'Verify experiment.xenium lists the files needed by this layer.',
      },
      detail,
    )
  }

  if (normalizedMessage.includes('decode') || normalizedMessage.includes('tile')) {
    return withOptionalDetail(
      {
        source,
        code: 'decode',
        title: 'Image tile decode failed',
        message,
        action: 'Retry at this zoom level or disable the morphology image layer.',
      },
      detail,
    )
  }

  return withOptionalDetail(
    {
      source,
      code: 'unknown',
      title: 'Unexpected load error',
      message,
      action: 'Retry the request after checking the dataset URL.',
    },
    detail,
  )
}

function isCellsParquetDecodeError(
  source: LoadErrorSource,
  normalizedMessage: string,
): boolean {
  if (source !== 'Dataset overview') {
    return false
  }

  return (
    normalizedMessage.includes('unable to decode cells.parquet') ||
    normalizedMessage.includes('offset is outside the bounds of the dataview') ||
    normalizedMessage.includes('invalid typed array length')
  )
}

function withOptionalDetail(
  error: Omit<StructuredLoadError, 'detail'>,
  detail: string | undefined,
): StructuredLoadError {
  return detail === undefined ? error : { ...error, detail }
}

function readErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name === 'Error') {
    return undefined
  }

  return error.name
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return 'Unknown dataset error'
}
