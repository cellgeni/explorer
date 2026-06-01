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
import { boundaryElementsToLayerData } from './rendering/deckLayers'
import { geneExpressionCellsToLayerData } from './rendering/deckLayers'
import { overviewCellsToLayerData } from './rendering/deckLayers'
import { bundledDeckVersion } from './rendering/deckLayers'
import { styleOverviewCellsByObservation } from './rendering/cellStyling'
import { hexBoundaryCellLimit } from './rendering/hexCellBoundaries'
import { useViewerStore } from './store/viewerStore'
import type { BBox } from './data/coords'
import type { GeneExpressionBatch } from './datasets/xeniumDataset'
import type { CellOverviewPoint } from './data/hyparquetCells'
import type { MorphologyImage } from './data/morphologyImage'
import type { ObservationColorMode } from './rendering/cellStyling'
import type { ElementBatch, SpatialElement } from './datasets/spatialDataset'
import type { OverviewCellDatum } from './rendering/deckLayers'
import type { ViewerViewportDetail } from './components/ViewerCore'

const scaffoldLayers = ['cells', 'boundaries', 'image'] as const
const GENE_EXPRESSION_VIEWPORT_CELL_LIMIT = 5_000

export type DatasetOverviewLoader = (
  baseUrl: string,
  options?: { readonly limit?: number | null; readonly includeCellIds?: boolean },
) => Promise<readonly CellOverviewPoint[]>

export type MorphologyImageLoader = (baseUrl: string) => Promise<MorphologyImage>
export type BoundaryElementsLoader = (
  baseUrl: string,
  bbox: BBox,
) => Promise<ElementBatch>
export type GenePanelLoader = (baseUrl: string) => Promise<readonly string[]>
export type GeneExpressionLoader = (
  baseUrl: string,
  bbox: BBox,
  genes: readonly string[],
) => Promise<GeneExpressionBatch>

type DatasetLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly cellCount: number }
  | { readonly status: 'error'; readonly url: string; readonly message: string }

type MorphologyLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string }
  | { readonly status: 'error'; readonly url: string; readonly message: string }

type BoundaryLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly cellCount: number }
  | { readonly status: 'error'; readonly url: string; readonly message: string }

type GenePanelState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly genes: readonly string[] }
  | { readonly status: 'error'; readonly url: string; readonly message: string }

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
  | { readonly status: 'error'; readonly url: string; readonly message: string }

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
  const geneSearchInputId = useId()
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
  const [boundaryElements, setBoundaryElements] = useState<readonly SpatialElement[]>([])
  const [shouldLoadMorphology, setShouldLoadMorphology] = useState(false)
  const [boundaryCellLimit, setBoundaryCellLimit] = useState(BOUNDARY_VIEWPORT_CELL_LIMIT)
  const [geneSearch, setGeneSearch] = useState('')
  const [selectedGenes, setSelectedGenes] = useState<readonly string[]>([])
  const [observationColorMode, setObservationColorMode] =
    useState<ObservationColorMode>('transcript-count')
  const [selectedCell, setSelectedCell] = useState<OverviewCellDatum | null>(null)
  const loadRequestId = useRef(0)
  const boundaryRequestId = useRef(0)
  const geneExpressionRequestId = useRef(0)
  const boundaryViewportKeyRef = useRef<string | null>(null)
  const geneExpressionViewportKeyRef = useRef<string | null>(null)
  const lastViewportDetailRef = useRef<ViewerViewportDetail | null>(null)
  const isLoading = loadState.status === 'loading'
  const statusCopy = datasetStatusCopy(loadState, datasetUrl)
  const styledOverviewCells = useMemo(
    () => styleOverviewCellsByObservation(overviewCells, observationColorMode),
    [observationColorMode, overviewCells],
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
  const handleImageTileError = useCallback((error: Error) => {
    setMorphologyState((current) => {
      if (current.status !== 'ready') {
        return current
      }

      return {
        status: 'error',
        url: current.url,
        message: readErrorMessage(error),
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
        boundaryRequestId.current += 1
        boundaryViewportKeyRef.current = null
        setBoundaryElements((current) => (current.length === 0 ? current : []))
        setBoundaryState((current) =>
          current.status === 'idle' ? current : { status: 'idle' },
        )
      } else {
        const requestKey = boundaryViewportKey(loadState.url, detail.bbox)

        if (requestKey !== boundaryViewportKeyRef.current) {
          const requestId = boundaryRequestId.current + 1
          boundaryRequestId.current = requestId
          boundaryViewportKeyRef.current = requestKey
          setBoundaryState({ status: 'loading', url: loadState.url })

          void loadBoundaryElements(loadState.url, detail.bbox)
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
              if (boundaryRequestId.current !== requestId) {
                return
              }

              setBoundaryElements([])
              setBoundaryState({
                status: 'error',
                url: loadState.url,
                message: readErrorMessage(error),
              })
            })
        }
      }

      if (selectedGenes.length === 0) {
        geneExpressionRequestId.current += 1
        geneExpressionViewportKeyRef.current = null
        setGeneExpressionCells((current) => (current.length === 0 ? current : []))
        setGeneExpressionState((current) =>
          current.status === 'idle' ? current : { status: 'idle' },
        )
        return
      }

      if (detail.visibleCellCount > GENE_EXPRESSION_VIEWPORT_CELL_LIMIT) {
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
      geneExpressionRequestId.current = expressionRequestId
      geneExpressionViewportKeyRef.current = expressionKey
      setGeneExpressionState({
        status: 'loading',
        url: loadState.url,
        genes: selectedGenes,
      })

      void loadGeneExpression(loadState.url, detail.bbox, selectedGenes)
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
          if (geneExpressionRequestId.current !== expressionRequestId) {
            return
          }

          setGeneExpressionCells([])
          setGeneExpressionState({
            status: 'error',
            url: loadState.url,
            message: readErrorMessage(error),
          })
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

  async function handleDatasetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const datasetUrl = formData.get('datasetUrl')
    const loadImage = formData.get('loadMorphologyImage') === 'on'

    if (typeof datasetUrl === 'string' && datasetUrl.trim().length > 0) {
      const requestedUrl = datasetUrl.trim()
      const requestId = loadRequestId.current + 1
      loadRequestId.current = requestId

      setDatasetUrl(requestedUrl)
      setOverviewCells([])
      setGeneExpressionCells([])
      setMorphologyImage(null)
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

      void loadGenePanel(requestedUrl)
        .then((genes) => {
          if (loadRequestId.current !== requestId) {
            return
          }

          setGenePanelState({ status: 'ready', url: requestedUrl, genes })
        })
        .catch((error) => {
          if (loadRequestId.current !== requestId) {
            return
          }

          setGenePanelState({
            status: 'error',
            url: requestedUrl,
            message: readErrorMessage(error),
          })
        })

      try {
        const cells = await loadDatasetOverview(requestedUrl, {
          includeCellIds: false,
          limit: null,
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

        void loadMorphologyImage(requestedUrl)
          .then((image) => {
            if (loadRequestId.current !== requestId) {
              return
            }

            setMorphologyImage(image)
            setMorphologyState({
              status: 'ready',
              url: image.url,
            })
          })
          .catch((error) => {
            if (loadRequestId.current !== requestId) {
              return
            }

            setMorphologyState({
              status: 'error',
              url: requestedUrl,
              message: readErrorMessage(error),
            })
          })
      } catch (error) {
        if (loadRequestId.current !== requestId) {
          return
        }

        setLoadState({
          status: 'error',
          url: requestedUrl,
          message: readErrorMessage(error),
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
          expressionCells={geneExpressionCells}
          boundaries={boundaryLayerData}
          imageLoader={morphologyImage?.loader ?? null}
          status={loadState.status}
          imageStatus={morphologyState.status}
          boundaryStatus={boundaryState.status}
          hexBoundaryMaxVisibleCells={hexBoundaryMaxVisibleCells}
          onImageTileError={handleImageTileError}
          onViewportChange={handleViewportChange}
          onCellClick={(cell) => {
            setSelectedCell(cell)
          }}
          {...(loadState.status === 'error' ? { errorMessage: loadState.message } : {})}
          {...(morphologyState.status === 'error'
            ? { imageErrorMessage: morphologyState.message }
            : {})}
          {...(boundaryState.status === 'error'
            ? { boundaryErrorMessage: boundaryState.message }
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
    return { label: `Load failed - ${loadState.message}`, url: loadState.url }
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
    return `Expression failed - ${geneExpressionState.message}`
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

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? 'None' : formatNumber(value)
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? '0'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return 'Unknown dataset error'
}
