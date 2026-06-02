import type { FormEvent } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ViewerCore } from './components/ViewerCore'
import { scaffoldDeckLayerCount } from './components/viewerCoreModel'
import { loadDatasetBoundaryElements as defaultLoadBoundaryElements } from './data/datasetBoundaries'
import { loadDatasetGeneExpression as defaultLoadDatasetGeneExpression } from './data/geneExpression'
import { loadDatasetOverview as defaultLoadDatasetOverview } from './data/datasetOverview'
import { loadGenePanel as defaultLoadGenePanel } from './data/genePanel'
import { loadMorphologyImage as defaultLoadMorphologyImage } from './data/morphologyImage'
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
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
  overviewCellsToLayerData,
  styleGeneExpressionCellsByScale,
  bundledDeckVersion,
} from './rendering/deckLayers'
import { styleOverviewCellsByObservation } from './rendering/cellStyling'
import { hexBoundaryCellLimit } from './rendering/hexCellBoundaries'
import { opacityToPercent, percentToOpacity } from './rendering/layerOpacity'
import { useViewerStore } from './store/viewerStore'
import type { BBox } from './data/coords'
import type { ChannelAutoContrast, ChannelHistogram } from './data/morphologyContrast'
import type { GeneExpressionBatch } from './datasets/xeniumDataset'
import type { CellOverviewPoint } from './data/hyparquetCells'
import type { MorphologyImage, MorphologyImageChannel } from './data/morphologyImage'
import type { MorphologyCanvasChannel } from './components/MorphologyCanvas'
import type { ObservationColorMode } from './rendering/cellStyling'
import type { ElementBatch, SpatialElement } from './datasets/spatialDataset'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
} from './rendering/deckLayers'
import type { OverviewCellDatum } from './rendering/deckLayers'
import type { ViewerViewportDetail } from './components/ViewerCore'

const scaffoldLayers = ['cells', 'boundaries', 'image'] as const
const GENE_EXPRESSION_VIEWPORT_CELL_LIMIT = 5_000
const EMPTY_HISTOGRAM_BINS = Array.from({ length: 32 }, () => 0)
const GENE_SET_SYMBOL_SPLIT_PATTERN = /[\s,;]+/

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
export type GeneExpressionLoader = (
  baseUrl: string,
  bbox: BBox,
  genes: readonly string[],
  options?: { readonly signal?: AbortSignal },
) => Promise<GeneExpressionBatch>
export type AutoChannelContrastLoader = (
  channel: MorphologyImageChannel,
  options?: { readonly signal?: AbortSignal },
) => Promise<ChannelAutoContrast>

type DatasetLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly cellCount: number }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

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

type GeneExpressionState =
  | { readonly status: 'idle' }
  | { readonly status: 'waiting'; readonly message: string }
  | {
      readonly status: 'loading'
      readonly url: string
      readonly genes: readonly string[]
    }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly genes: readonly string[]
      readonly cellCount: number
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

type LoadErrorCode =
  | 'network'
  | 'http'
  | 'range-not-supported'
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
  | 'Gene expression'

interface StructuredLoadError {
  readonly source: LoadErrorSource
  readonly code: LoadErrorCode
  readonly title: string
  readonly message: string
  readonly action: string
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

export interface AppProps {
  readonly loadDatasetOverview?: DatasetOverviewLoader
  readonly loadMorphologyImage?: MorphologyImageLoader
  readonly loadBoundaryElements?: BoundaryElementsLoader
  readonly loadGenePanel?: GenePanelLoader
  readonly loadGeneExpression?: GeneExpressionLoader
  readonly computeAutoChannelContrast?: AutoChannelContrastLoader
}

export function App({
  loadDatasetOverview = defaultLoadDatasetOverview,
  loadMorphologyImage = defaultLoadMorphologyImage,
  loadBoundaryElements = defaultLoadBoundaryElements,
  loadGenePanel = defaultLoadGenePanel,
  loadGeneExpression = defaultLoadDatasetGeneExpression,
  computeAutoChannelContrast = defaultComputeAutoChannelContrast,
}: AppProps) {
  const datasetInputId = useId()
  const morphologyInputId = useId()
  const boundaryLimitInputId = useId()
  const imageOpacityInputId = useId()
  const geneOpacityInputId = useId()
  const geneSearchInputId = useId()
  const geneSetSymbolsInputId = useId()
  const geneSetNameInputId = useId()
  const geneSetScoreInputId = useId()
  const geneScaleInputId = useId()
  const observationModeInputId = useId()
  const datasetUrl = useViewerStore((state) => state.datasetUrl)
  const setDatasetUrl = useViewerStore((state) => state.setDatasetUrl)
  const [loadState, setLoadState] = useState<DatasetLoadState>({ status: 'idle' })
  const [morphologyState, setMorphologyState] = useState<MorphologyLoadState>({
    status: 'idle',
  })
  const [boundaryState, setBoundaryState] = useState<BoundaryLoadState>({
    status: 'idle',
  })
  const [genePanelState, setGenePanelState] = useState<GenePanelState>({
    status: 'idle',
  })
  const [geneExpressionState, setGeneExpressionState] = useState<GeneExpressionState>({
    status: 'idle',
  })
  const [overviewCells, setOverviewCells] = useState<readonly OverviewCellDatum[]>([])
  const [geneExpressionBatch, setGeneExpressionBatch] =
    useState<GeneExpressionBatch | null>(null)
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
  const [geneSearch, setGeneSearch] = useState('')
  const [geneSetSymbols, setGeneSetSymbols] = useState('')
  const [geneSetName, setGeneSetName] = useState('')
  const [geneExpressionColorScale, setGeneExpressionColorScale] =
    useState<GeneExpressionColorScale>(DEFAULT_GENE_EXPRESSION_COLOR_SCALE)
  const [geneExpressionScoreMode, setGeneExpressionScoreMode] =
    useState<GeneExpressionScoreMode>(DEFAULT_GENE_EXPRESSION_SCORE_MODE)
  const [savedGeneSets, setSavedGeneSets] = useState<readonly SavedGeneSet[]>([])
  const [selectedGenes, setSelectedGenes] = useState<readonly string[]>([])
  const [observationColorMode, setObservationColorMode] =
    useState<ObservationColorMode>('transcript-count')
  const [selectedCell, setSelectedCell] = useState<OverviewCellDatum | null>(null)
  const loadRequestId = useRef(0)
  const boundaryRequestId = useRef(0)
  const geneExpressionRequestId = useRef(0)
  const datasetAbortRef = useRef<AbortController | null>(null)
  const boundaryAbortRef = useRef<AbortController | null>(null)
  const geneExpressionAbortRef = useRef<AbortController | null>(null)
  const geneSetIdRef = useRef(0)
  const boundaryViewportKeyRef = useRef<string | null>(null)
  const geneExpressionViewportKeyRef = useRef<string | null>(null)
  const lastViewportDetailRef = useRef<ViewerViewportDetail | null>(null)
  const isLoading = loadState.status === 'loading'
  const statusCopy = datasetStatusCopy(loadState, datasetUrl)
  const styledOverviewCells = useMemo(
    () => styleOverviewCellsByObservation(overviewCells, observationColorMode),
    [observationColorMode, overviewCells],
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
          ),
    [geneExpressionBatch, geneExpressionColorScale, geneExpressionScoreMode],
  )
  const styledGeneExpressionCells = useMemo(
    () => styleGeneExpressionCellsByScale(geneExpressionCells, geneExpressionColorScale),
    [geneExpressionCells, geneExpressionColorScale],
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
  const boundaryLayerData = useMemo(
    () => boundaryElementsToLayerData(boundaryElements),
    [boundaryElements],
  )
  const hexBoundaryMaxVisibleCells = useMemo(
    () => hexBoundaryCellLimit(boundaryCellLimit),
    [boundaryCellLimit],
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
  const geneExpressionCopy = geneExpressionStatusCopy(geneExpressionState)
  const activeErrors = useMemo(
    () =>
      [
        loadState.status === 'error' ? loadState.error : null,
        morphologyState.status === 'error' ? morphologyState.error : null,
        boundaryState.status === 'error' ? boundaryState.error : null,
        genePanelState.status === 'error' ? genePanelState.error : null,
        geneExpressionState.status === 'error' ? geneExpressionState.error : null,
      ].filter(isStructuredLoadError),
    [boundaryState, geneExpressionState, genePanelState, loadState, morphologyState],
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

      if (detail.visibleCellCount > GENE_EXPRESSION_VIEWPORT_CELL_LIMIT) {
        abortActiveRequest(geneExpressionAbortRef)
        geneExpressionRequestId.current += 1
        geneExpressionViewportKeyRef.current = null
        setGeneExpressionBatch(null)
        setGeneExpressionState({
          status: 'waiting',
          message: `Zoom in for expression: ${detail.visibleCellCount.toLocaleString()} visible cells exceeds ${GENE_EXPRESSION_VIEWPORT_CELL_LIMIT.toLocaleString()}.`,
        })
        return
      }

      const expressionKey = `${boundaryViewportKey(loadState.url, detail.bbox)}:${selectedGenes.join('|')}`

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
      })

      void loadGeneExpression(loadState.url, detail.bbox, selectedGenes, {
        signal: expressionAbortController.signal,
      })
        .then((batch) => {
          if (geneExpressionRequestId.current !== expressionRequestId) {
            return
          }

          setGeneExpressionBatch(batch)
          setGeneExpressionState({
            status: 'ready',
            url: loadState.url,
            genes: batch.genes,
            cellCount: batch.cells.length,
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
      loadBoundaryElements,
      loadGeneExpression,
      loadState,
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
      abortActiveRequest(boundaryAbortRef)
      abortActiveRequest(geneExpressionAbortRef)
    }
  }, [])

  async function handleDatasetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const datasetUrl = formData.get('datasetUrl')
    const loadImage = formData.get('loadMorphologyImage') === 'on'

    if (typeof datasetUrl === 'string' && datasetUrl.trim().length > 0) {
      const requestedUrl = datasetUrl.trim()
      const requestId = loadRequestId.current + 1
      abortActiveRequest(datasetAbortRef)
      abortActiveRequest(boundaryAbortRef)
      abortActiveRequest(geneExpressionAbortRef)
      const abortController = new AbortController()
      loadRequestId.current = requestId
      datasetAbortRef.current = abortController

      setDatasetUrl(requestedUrl)
      setOverviewCells([])
      setGeneExpressionBatch(null)
      setMorphologyImage(null)
      setMorphologyChannelSettings([])
      setAutoContrastChannelIds([])
      setBoundaryElements([])
      setGeneSearch('')
      setGeneSetSymbols('')
      setGeneSetName('')
      setSavedGeneSets([])
      setGeneExpressionScoreMode(DEFAULT_GENE_EXPRESSION_SCORE_MODE)
      setSelectedGenes([])
      setSelectedCell(null)
      setLoadState({ status: 'loading', url: requestedUrl })
      setMorphologyState(
        loadImage ? { status: 'loading', url: requestedUrl } : { status: 'idle' },
      )
      setBoundaryState({ status: 'idle' })
      setGenePanelState({ status: 'loading', url: requestedUrl })
      setGeneExpressionState({ status: 'idle' })
      boundaryRequestId.current += 1
      geneExpressionRequestId.current += 1
      boundaryViewportKeyRef.current = null
      geneExpressionViewportKeyRef.current = null
      lastViewportDetailRef.current = null

      void loadGenePanel(requestedUrl, { signal: abortController.signal })
        .then((genes) => {
          if (loadRequestId.current !== requestId) {
            return
          }

          setGenePanelState({ status: 'ready', url: requestedUrl, genes })
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
        })

      try {
        const cells = await loadDatasetOverview(requestedUrl, {
          includeCellIds: false,
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
        setMorphologyState({ status: 'idle' })
        setGenePanelState({ status: 'idle' })
      }
    }
  }

  function toggleGene(gene: string) {
    setSelectedGenes((current) =>
      current.includes(gene)
        ? current.filter((selectedGene) => selectedGene !== gene)
        : [...current, gene].sort((a, b) => a.localeCompare(b)),
    )
  }

  function applyGeneSetSymbols() {
    const genes = parseGeneSetSymbols(geneSetSymbols, geneOptions)

    if (genes.length === 0) {
      return
    }

    setSelectedGenes(genes)
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
    setSavedGeneSets((current) => [
      savedSet,
      ...current.filter((geneSet) => geneSet.name.toLowerCase() !== normalizedName),
    ])
    setGeneSetName('')
  }

  function applySavedGeneSet(geneSet: SavedGeneSet) {
    setSelectedGenes(geneSet.genes)
    setGeneExpressionScoreMode(geneSet.scoreMode)
    setGeneSearch('')
  }

  function updateMorphologyChannel(
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) {
    setMorphologyChannelSettings((current) =>
      current.map((setting) => (setting.id === id ? { ...setting, ...patch } : setting)),
    )
  }

  function handleAutoContrast(channel: MorphologyImageChannel) {
    const channelId = channel.info.id

    if (autoContrastChannelIds.includes(channelId)) {
      return
    }

    const requestId = loadRequestId.current
    const signal = datasetAbortRef.current?.signal
    setAutoContrastChannelIds((current) =>
      current.includes(channelId) ? current : [...current, channelId],
    )

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

        setAutoContrastChannelIds((current) => current.filter((id) => id !== channelId))
      })
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#viewer-heading">
        Skip To Spatial View
      </a>
      <aside className="control-rail" aria-label="Dataset controls">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">CellGeni</p>
            <h1>Xenium Explorer</h1>
          </div>
        </div>

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
                setShouldLoadMorphology(event.currentTarget.checked)
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
              setBoundaryCellLimit(
                normalizeBoundaryCellLimit(event.currentTarget.valueAsNumber),
              )
            }}
          />
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Loading…' : 'Load Dataset'}
          </button>
        </form>

        <ErrorSummary errors={activeErrors} />

        <section className="layer-section" aria-labelledby="layer-heading">
          <h2 id="layer-heading">Layer Stack</h2>
          <p>
            {scaffoldDeckLayerCount} Deck Layer - deck.gl {bundledDeckVersion}
          </p>
          <ul>
            {scaffoldLayers.map((layerName) => (
              <li key={layerName}>
                <span className={`layer-dot layer-dot-${layerName}`} aria-hidden="true" />
                <span>{layerName}</span>
              </li>
            ))}
          </ul>
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
                  setImageLayerOpacity(
                    percentToOpacity(event.currentTarget.valueAsNumber),
                  )
                }}
              />
            </div>
            <div className="layer-opacity-control">
              <div className="layer-opacity-header">
                <label htmlFor={geneOpacityInputId}>Gene opacity</label>
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
                  setGeneLayerOpacity(percentToOpacity(event.currentTarget.valueAsNumber))
                }}
              />
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

        <section className="analysis-section" aria-labelledby="analysis-heading">
          <div className="section-heading-row">
            <h2 id="analysis-heading">Analysis</h2>
            <span>{genePanelCopy}</span>
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
              disabled={genePanelState.status !== 'ready' || geneSetSymbols.trim() === ''}
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
                setGeneExpressionScoreMode(nextScoreMode)
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
                <button
                  key={geneSet.id}
                  type="button"
                  onClick={() => {
                    applySavedGeneSet(geneSet)
                  }}
                >
                  <span>{geneSet.name}</span>
                  <small>{geneSet.scoreMode}</small>
                </button>
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
          </div>

          <label htmlFor={observationModeInputId}>Cell color</label>
          <select
            id={observationModeInputId}
            value={observationColorMode}
            onChange={(event) => {
              setObservationColorMode(event.currentTarget.value as ObservationColorMode)
            }}
          >
            <option value="transcript-count">Transcript count</option>
            <option value="cell-area">Cell area</option>
          </select>

          <p className="analysis-status" aria-live="polite">
            {geneExpressionCopy}
          </p>
        </section>

        <section className="analysis-section" aria-labelledby="cell-info-heading">
          <h2 id="cell-info-heading">Cell Info</h2>
          <CellInfoPanel cell={selectedCell} />
        </section>
      </aside>

      <section className="viewer-region" aria-labelledby="viewer-heading">
        <header className="viewer-toolbar">
          <div>
            <p className="eyebrow">Phase 1</p>
            <h2 id="viewer-heading">Spatial View</h2>
          </div>
          <p className="dataset-status" aria-live="polite">
            {statusCopy.label}: <span translate="no">{statusCopy.url}</span>
          </p>
        </header>

        <ViewerCore
          cells={styledOverviewCells}
          expressionCells={styledGeneExpressionCells}
          boundaries={boundaryLayerData}
          imageLoader={morphologyImage?.loader ?? null}
          imageChannels={morphologyCanvasChannels}
          imageOpacity={imageLayerOpacity}
          geneExpressionOpacity={geneLayerOpacity}
          status={loadState.status}
          imageStatus={morphologyState.status}
          boundaryStatus={boundaryState.status}
          hexBoundaryMaxVisibleCells={hexBoundaryMaxVisibleCells}
          onImageTileError={handleImageTileError}
          onViewportChange={handleViewportChange}
          onCellClick={(cell) => {
            setSelectedCell(cell)
          }}
          {...(loadState.status === 'error'
            ? { errorMessage: formatStructuredError(loadState.error) }
            : {})}
          {...(morphologyState.status === 'error'
            ? { imageErrorMessage: formatStructuredError(morphologyState.error) }
            : {})}
          {...(boundaryState.status === 'error'
            ? { boundaryErrorMessage: formatStructuredError(boundaryState.error) }
            : {})}
        />
      </section>
    </main>
  )
}

function datasetStatusCopy(
  loadState: DatasetLoadState,
  queuedUrl: string,
): { readonly label: string; readonly url: string } {
  if (loadState.status === 'loading') {
    return { label: 'Loading overview', url: loadState.url }
  }

  if (loadState.status === 'ready') {
    const noun = loadState.cellCount === 1 ? 'cell' : 'cells'
    return {
      label: `Loaded ${loadState.cellCount.toLocaleString()} overview ${noun}`,
      url: loadState.url,
    }
  }

  if (loadState.status === 'error') {
    return { label: `Load failed - ${loadState.error.title}`, url: loadState.url }
  }

  return { label: 'Queued dataset', url: queuedUrl }
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

function geneExpressionStatusCopy(geneExpressionState: GeneExpressionState): string {
  if (geneExpressionState.status === 'loading') {
    return `Expression: ${geneExpressionState.genes.join(', ')}`
  }

  if (geneExpressionState.status === 'ready') {
    const noun = geneExpressionState.cellCount === 1 ? 'cell' : 'cells'
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

function defaultGeneSetName(genes: readonly string[]): string {
  if (genes.length === 0) {
    return 'Selected genes'
  }

  if (genes.length <= 3) {
    return genes.join(', ')
  }

  return `${genes.slice(0, 3).join(', ')} +${genes.length - 3}`
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

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? 'None' : formatNumber(value)
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? '0'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
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
