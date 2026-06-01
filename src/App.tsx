import type { FormEvent } from 'react'
import { useCallback, useId, useRef, useState } from 'react'
import { ViewerCore } from './components/ViewerCore'
import { scaffoldDeckLayerCount } from './components/viewerCoreModel'
import { loadDatasetOverview as defaultLoadDatasetOverview } from './data/datasetOverview'
import { loadMorphologyImage as defaultLoadMorphologyImage } from './data/morphologyImage'
import { overviewCellsToLayerData } from './rendering/deckLayers'
import { bundledDeckVersion } from './rendering/deckLayers'
import { useViewerStore } from './store/viewerStore'
import type { CellOverviewPoint } from './data/hyparquetCells'
import type { MorphologyImage } from './data/morphologyImage'
import type { OverviewCellDatum } from './rendering/deckLayers'

const scaffoldLayers = ['cells', 'boundaries', 'image'] as const

export type DatasetOverviewLoader = (
  baseUrl: string,
) => Promise<readonly CellOverviewPoint[]>

export type MorphologyImageLoader = (baseUrl: string) => Promise<MorphologyImage>

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

export interface AppProps {
  readonly loadDatasetOverview?: DatasetOverviewLoader
  readonly loadMorphologyImage?: MorphologyImageLoader
}

export function App({
  loadDatasetOverview = defaultLoadDatasetOverview,
  loadMorphologyImage = defaultLoadMorphologyImage,
}: AppProps) {
  const datasetInputId = useId()
  const datasetUrl = useViewerStore((state) => state.datasetUrl)
  const setDatasetUrl = useViewerStore((state) => state.setDatasetUrl)
  const [loadState, setLoadState] = useState<DatasetLoadState>({ status: 'idle' })
  const [morphologyState, setMorphologyState] = useState<MorphologyLoadState>({
    status: 'idle',
  })
  const [overviewCells, setOverviewCells] = useState<readonly OverviewCellDatum[]>([])
  const [morphologyImage, setMorphologyImage] = useState<MorphologyImage | null>(null)
  const loadRequestId = useRef(0)
  const isLoading = loadState.status === 'loading'
  const statusCopy = datasetStatusCopy(loadState, datasetUrl)
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

  async function handleDatasetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const datasetUrl = formData.get('datasetUrl')

    if (typeof datasetUrl === 'string' && datasetUrl.trim().length > 0) {
      const requestedUrl = datasetUrl.trim()
      const requestId = loadRequestId.current + 1
      loadRequestId.current = requestId

      setDatasetUrl(requestedUrl)
      setOverviewCells([])
      setMorphologyImage(null)
      setLoadState({ status: 'loading', url: requestedUrl })
      setMorphologyState({ status: 'loading', url: requestedUrl })

      try {
        const cells = await loadDatasetOverview(requestedUrl)

        if (loadRequestId.current !== requestId) {
          return
        }

        setOverviewCells(overviewCellsToLayerData(cells))
        setLoadState({
          status: 'ready',
          url: requestedUrl,
          cellCount: cells.length,
        })
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
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Load Dataset'}
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
          imageLoader={morphologyImage?.loader ?? null}
          status={loadState.status}
          imageStatus={morphologyState.status}
          onImageTileError={handleImageTileError}
          {...(loadState.status === 'error' ? { errorMessage: loadState.message } : {})}
          {...(morphologyState.status === 'error'
            ? { imageErrorMessage: morphologyState.message }
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
