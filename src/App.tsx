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
  GENE_EXPRESSION_COLOR_SCALE_OPTIONS,
  geneExpressionCellsToLayerData,
  isGeneExpressionColorScale,
  overviewCellsToLayerData,
  styleGeneExpressionCellsByScale,
  bundledDeckVersion,
} from './rendering/deckLayers'
import { styleOverviewCellsByObservation } from './rendering/cellStyling'
import { hexBoundaryCellLimit } from './rendering/hexCellBoundaries'
import { opacityToPercent, percentToOpacity } from './rendering/layerOpacity'
import { useViewerStore } from './store/viewerStore'
import type { BBox } from './data/coords'
import type { GeneExpressionBatch } from './datasets/xeniumDataset'
import type { CellOverviewPoint } from './data/hyparquetCells'
import type { MorphologyImage, MorphologyImageChannel } from './data/morphologyImage'
import type { MorphologyCanvasChannel } from './components/MorphologyCanvas'
import type { ObservationColorMode } from './rendering/cellStyling'
import type { ElementBatch, SpatialElement } from './datasets/spatialDataset'
import type { GeneExpressionColorScale } from './rendering/deckLayers'
import type { OverviewCellDatum } from './rendering/deckLayers'
import type { ViewerViewportDetail } from './components/ViewerCore'

const scaffoldLayers = ['cells', 'boundaries', 'image'] as const
const GENE_EXPRESSION_VIEWPORT_CELL_LIMIT = 5_000

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
}

export interface AppProps {
  readonly loadDatasetOverview?: DatasetOverviewLoader
  readonly loadMorphologyImage?: MorphologyImageLoader
  readonly loadBoundaryElements?: BoundaryElementsLoader
  readonly loadGenePanel?: GenePanelLoader
  readonly loadGeneExpression?: GeneExpressionLoader
}

export function App({
  loadDatasetOverview = defaultLoadDatasetOverview,
  loadMorphologyImage = defaultLoadMorphologyImage,
  loadBoundaryElements = defaultLoadBoundaryElements,
  loadGenePanel = defaultLoadGenePanel,
  loadGeneExpression = defaultLoadDatasetGeneExpression,
}: AppProps) {
  const datasetInputId = useId()
  const morphologyInputId = useId()
  const boundaryLimitInputId = useId()
  const imageOpacityInputId = useId()
  const geneOpacityInputId = useId()
  const geneSearchInputId = useId()
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
  const [geneExpressionCells, setGeneExpressionCells] = useState<
    readonly OverviewCellDatum[]
  >([])
  const [morphologyImage, setMorphologyImage] = useState<MorphologyImage | null>(null)
  const [morphologyChannelSettings, setMorphologyChannelSettings] = useState<
    readonly MorphologyChannelSetting[]
  >([])
  const [boundaryElements, setBoundaryElements] = useState<readonly SpatialElement[]>([])
  const [shouldLoadMorphology, setShouldLoadMorphology] = useState(false)
  const [boundaryCellLimit, setBoundaryCellLimit] = useState(BOUNDARY_VIEWPORT_CELL_LIMIT)
  const [imageLayerOpacity, setImageLayerOpacity] = useState(1)
  const [geneLayerOpacity, setGeneLayerOpacity] = useState(1)
  const [geneSearch, setGeneSearch] = useState('')
  const [geneExpressionColorScale, setGeneExpressionColorScale] =
    useState<GeneExpressionColorScale>(DEFAULT_GENE_EXPRESSION_COLOR_SCALE)
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
  const boundaryViewportKeyRef = useRef<string | null>(null)
  const geneExpressionViewportKeyRef = useRef<string | null>(null)
  const lastViewportDetailRef = useRef<ViewerViewportDetail | null>(null)
  const isLoading = loadState.status === 'loading'
  const statusCopy = datasetStatusCopy(loadState, datasetUrl)
  const styledOverviewCells = useMemo(
    () => styleOverviewCellsByObservation(overviewCells, observationColorMode),
    [observationColorMode, overviewCells],
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
        setGeneExpressionCells((current) => (current.length === 0 ? current : []))
        setGeneExpressionState((current) =>
          current.status === 'idle' ? current : { status: 'idle' },
        )
        return
      }

      if (detail.visibleCellCount > GENE_EXPRESSION_VIEWPORT_CELL_LIMIT) {
        abortActiveRequest(geneExpressionAbortRef)
        geneExpressionRequestId.current += 1
        geneExpressionViewportKeyRef.current = null
        setGeneExpressionCells((current) => (current.length === 0 ? current : []))
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

          setGeneExpressionCells(geneExpressionCellsToLayerData(batch.cells, batch.genes))
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

          setGeneExpressionCells([])
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
      setGeneExpressionCells([])
      setMorphologyImage(null)
      setMorphologyChannelSettings([])
      setBoundaryElements([])
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

  function updateMorphologyChannel(
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) {
    setMorphologyChannelSettings((current) =>
      current.map((setting) => (setting.id === id ? { ...setting, ...patch } : setting)),
    )
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
  channels,
  settings,
  onUpdate,
}: {
  readonly channels: readonly MorphologyImageChannel[]
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
          </div>
        )
      })}
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
