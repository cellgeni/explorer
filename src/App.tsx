import type { FormEvent } from 'react'
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { ViewerCore } from './components/ViewerCore'
import { scaffoldDeckLayerCount } from './components/viewerCoreModel'
import { loadDatasetBoundaryElements as defaultLoadBoundaryElements } from './data/datasetBoundaries'
import {
  DEFAULT_OVERVIEW_CELL_LIMIT,
  loadDatasetOverview as defaultLoadDatasetOverview,
} from './data/datasetOverview'
import { loadMorphologyImage as defaultLoadMorphologyImage } from './data/morphologyImage'
import {
  BOUNDARY_VIEWPORT_CELL_LIMIT,
  boundaryViewportKey,
  normalizeBoundaryCellLimit,
  shouldLoadBoundaryPolygons,
} from './rendering/boundaryViewport'
import { boundaryElementsToLayerData } from './rendering/deckLayers'
import { overviewCellsToLayerData } from './rendering/deckLayers'
import { bundledDeckVersion } from './rendering/deckLayers'
import { useViewerStore } from './store/viewerStore'
import type { BBox } from './data/coords'
import type { CellOverviewPoint } from './data/hyparquetCells'
import type { MorphologyImage } from './data/morphologyImage'
import type { ElementBatch, SpatialElement } from './datasets/spatialDataset'
import type { OverviewCellDatum } from './rendering/deckLayers'
import type { ViewerViewportDetail } from './components/ViewerCore'

const scaffoldLayers = ['cells', 'boundaries', 'image'] as const

export type DatasetOverviewLoader = (
  baseUrl: string,
  options?: { readonly limit?: number | null },
) => Promise<readonly CellOverviewPoint[]>

export type MorphologyImageLoader = (baseUrl: string) => Promise<MorphologyImage>
export type BoundaryElementsLoader = (
  baseUrl: string,
  bbox: BBox,
) => Promise<ElementBatch>

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

export interface AppProps {
  readonly loadDatasetOverview?: DatasetOverviewLoader
  readonly loadMorphologyImage?: MorphologyImageLoader
  readonly loadBoundaryElements?: BoundaryElementsLoader
}

export function App({
  loadDatasetOverview = defaultLoadDatasetOverview,
  loadMorphologyImage = defaultLoadMorphologyImage,
  loadBoundaryElements = defaultLoadBoundaryElements,
}: AppProps) {
  const datasetInputId = useId()
  const allCellsInputId = useId()
  const morphologyInputId = useId()
  const boundaryLimitInputId = useId()
  const datasetUrl = useViewerStore((state) => state.datasetUrl)
  const setDatasetUrl = useViewerStore((state) => state.setDatasetUrl)
  const [loadState, setLoadState] = useState<DatasetLoadState>({ status: 'idle' })
  const [morphologyState, setMorphologyState] = useState<MorphologyLoadState>({
    status: 'idle',
  })
  const [boundaryState, setBoundaryState] = useState<BoundaryLoadState>({
    status: 'idle',
  })
  const [overviewCells, setOverviewCells] = useState<readonly OverviewCellDatum[]>([])
  const [morphologyImage, setMorphologyImage] = useState<MorphologyImage | null>(null)
  const [boundaryElements, setBoundaryElements] = useState<readonly SpatialElement[]>([])
  const [shouldLoadAllCells, setShouldLoadAllCells] = useState(false)
  const [shouldLoadMorphology, setShouldLoadMorphology] = useState(false)
  const [boundaryCellLimit, setBoundaryCellLimit] = useState(BOUNDARY_VIEWPORT_CELL_LIMIT)
  const loadRequestId = useRef(0)
  const boundaryRequestId = useRef(0)
  const boundaryViewportKeyRef = useRef<string | null>(null)
  const isLoading = loadState.status === 'loading'
  const statusCopy = datasetStatusCopy(loadState, datasetUrl)
  const boundaryLayerData = useMemo(
    () => boundaryElementsToLayerData(boundaryElements),
    [boundaryElements],
  )
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

      if (!shouldLoadBoundaryPolygons(detail, { cellLimit: boundaryCellLimit })) {
        boundaryRequestId.current += 1
        boundaryViewportKeyRef.current = null
        setBoundaryElements((current) => (current.length === 0 ? current : []))
        setBoundaryState((current) =>
          current.status === 'idle' ? current : { status: 'idle' },
        )
        return
      }

      const requestKey = boundaryViewportKey(loadState.url, detail.bbox)

      if (requestKey === boundaryViewportKeyRef.current) {
        return
      }

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
    },
    [boundaryCellLimit, loadBoundaryElements, loadState],
  )

  async function handleDatasetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const datasetUrl = formData.get('datasetUrl')
    const loadAllCells = formData.get('loadAllCells') === 'on'
    const loadImage = formData.get('loadMorphologyImage') === 'on'

    if (typeof datasetUrl === 'string' && datasetUrl.trim().length > 0) {
      const requestedUrl = datasetUrl.trim()
      const requestId = loadRequestId.current + 1
      loadRequestId.current = requestId

      setDatasetUrl(requestedUrl)
      setOverviewCells([])
      setMorphologyImage(null)
      setBoundaryElements([])
      setLoadState({ status: 'loading', url: requestedUrl })
      setMorphologyState(
        loadImage ? { status: 'loading', url: requestedUrl } : { status: 'idle' },
      )
      setBoundaryState({ status: 'idle' })
      boundaryRequestId.current += 1
      boundaryViewportKeyRef.current = null

      try {
        const cells = await loadDatasetOverview(requestedUrl, {
          limit: loadAllCells ? null : DEFAULT_OVERVIEW_CELL_LIMIT,
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
      }
    }
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
          <label className="dataset-toggle" htmlFor={allCellsInputId}>
            <input
              id={allCellsInputId}
              name="loadAllCells"
              type="checkbox"
              checked={shouldLoadAllCells}
              onChange={(event) => {
                setShouldLoadAllCells(event.currentTarget.checked)
              }}
            />
            <span>All cells</span>
          </label>
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
          cells={overviewCells}
          boundaries={boundaryLayerData}
          imageLoader={morphologyImage?.loader ?? null}
          status={loadState.status}
          imageStatus={morphologyState.status}
          boundaryStatus={boundaryState.status}
          onImageTileError={handleImageTileError}
          onViewportChange={handleViewportChange}
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

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return 'Unknown dataset error'
}
