// LIF review repro: cancelling (or failing) a SpatialData view change leaves
// the app on the old view but with the new selection registered.
//
// Expected (plan 15.1-F, useDatasetLifecycle.ts cancelDatasetLoad comment):
// "A load that would replace the dataset on screen is dropped and that
// dataset stays". So after Cancel, reads for the dataset on screen should go
// to the instance that drew it, the view controls should be usable again,
// and the link should describe what is on screen.
//
// Only dataset I/O is faked. The selection registry and App/lifecycle code are
// the production ones: getSpatialDataset below keys its instances by
// spatialDataSelectionFor(url), as cachedSpatialDataset does
// (datasetFactory.ts spatialDatasetCacheKey).
import { createElement } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../../../../../src/App'
import {
  setSpatialDataSelection,
  spatialDataSelectionFor,
} from '../../../../../../src/datasets/datasetFactory'
import { micrometers } from '../../../../../../src/data/coords'
import {
  appTestDependencies,
  offlineFetch,
  openControls,
  pendingPromise,
  type AppTestDependencyProps,
} from '../../../../../../src/test/appTestHarness'
import {
  initialViewerState,
  useViewerStore,
} from '../../../../../../src/store/viewerStore'

vi.mock('@deck.gl/react', async () => {
  const { createElement: h } = await import('react')
  return {
    DeckGL: ({ layers = [] }: { readonly layers?: readonly unknown[] }) =>
      h(
        'div',
        { 'data-testid': 'deckgl' },
        layers.map((layer) => {
          const candidate = layer as {
            readonly id?: string
            readonly props?: {
              readonly id?: string
              readonly cells?: readonly unknown[]
              readonly data?: readonly unknown[]
            }
          }
          const id = candidate.id ?? candidate.props?.id ?? 'unknown-layer'
          const data = candidate.props?.cells ?? candidate.props?.data ?? []
          return h('div', {
            key: id,
            'data-testid': `deck-layer-${id}`,
            'data-count': String(Array.isArray(data) ? data.length : 0),
          })
        }),
      ),
  }
})

const STORE_URL = 'https://example.test/sample.zarr'

type Mode = 'hang' | 'fail'

function fakeSpatialData(coordinateSystem: string, mode: Mode) {
  const isTarget = coordinateSystem === 'pixels'
  const cells = Array.from({ length: 4 }, (_value, index) => ({
    cellId: `${coordinateSystem}-cell-${index.toString()}`,
    position: { x: micrometers(index * 10), y: micrometers(index * 10) },
    transcriptCount: 0,
  }))
  return {
    coordinateSystem,
    summary: vi.fn(async () => ({
      coordinateSystem,
      coordinateSystems: ['global', 'pixels'],
      images: [],
      table: 'table',
      tables: ['table'],
      regions: ['cells'],
      skippedElements: [],
      units: { micrometersPerUnit: 1, source: 'declared' as const, detail: 'test' },
    })),
    image: vi.fn(async () => null),
    meta: vi.fn(async () => ({
      platform: 'spatialdata' as const,
      units: {
        dataUnit: 'micrometer',
        imageUnit: 'pixel',
        micrometersPerPixel: micrometers(1),
        origin: 'top-left',
        imageYAxis: 'down',
      },
      extent: {
        minX: micrometers(0),
        maxX: micrometers(30),
        minY: micrometers(0),
        maxY: micrometers(30),
      },
      capabilities: {
        transcripts: false,
        cellBoundaries: false,
        pyramidImage: false,
        multiChannel: false,
      },
    })),
    overview: vi.fn(async () => {
      if (isTarget && mode === 'hang') return pendingPromise<typeof cells>()
      if (isTarget && mode === 'fail') throw new Error('table chunk 0 returned HTTP 503')
      return cells
    }),
    genePanel: vi.fn(async () => ['Gad1']),
    annotationGroups: vi.fn(async () => [
      { id: 'analysis:type', label: 'type', groupingName: 'type', groupCount: 1 },
    ]),
    annotations: vi.fn(async () => [
      {
        id: 'analysis:type:a',
        label: 'type: a',
        cellIds: cells.map((cell) => cell.cellId),
      },
    ]),
    embeddingOptions: vi.fn(async () => []),
    metadataTracks: vi.fn(async () => []),
  }
}

function setup(mode: Mode) {
  const instances = new Map<string, ReturnType<typeof fakeSpatialData>>()
  const getSpatialDataset = vi.fn(async (url: string) => {
    // As cachedSpatialDataset: one instance per URL and registered selection.
    const coordinateSystem = spatialDataSelectionFor(url).coordinateSystem ?? 'global'
    let instance = instances.get(coordinateSystem)
    if (instance === undefined) {
      instance = fakeSpatialData(coordinateSystem, mode)
      instances.set(coordinateSystem, instance)
    }
    return instance as never
  })
  const detectSpatialDataset = vi.fn(async (baseUrl: string) => ({
    platform: 'spatialdata' as const,
    baseUrl,
    spatialDataUrl: baseUrl,
    checked: [],
  }))
  const props: AppTestDependencyProps = { detectSpatialDataset, getSpatialDataset }
  render(createElement(App, { dependencies: appTestDependencies(props) }))
  return { instances, getSpatialDataset }
}

async function openStoreAndSwitchToPixels() {
  openControls('open-dataset')
  fireEvent.change(screen.getByLabelText('Dataset or image URL'), {
    target: { value: STORE_URL },
  })
  openControls('open-dataset')
  fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))
  openControls('diagnostics')
  await screen.findByText(/SpatialData ready: 4 cells/)

  openControls('view-options')
  const coordinateSystem = screen.getByTitle('SpatialData coordinate system to show')
  fireEvent.change(coordinateSystem, { target: { value: 'pixels' } })
}

async function loadAnnotationSet() {
  openControls('clusters')
  const annotationSet = screen.getByRole('combobox', { name: 'Annotation set' })
  fireEvent.change(annotationSet, { target: { value: 'analysis:type' } })
  const load = screen.getByRole('button', { name: 'Load Annotations' })
  await waitFor(() => {
    expect(load).toBeEnabled()
  })
  fireEvent.click(load)
}

describe('LIF: SpatialData view change that does not commit', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    window.sessionStorage.clear()
    useViewerStore.setState(initialViewerState)
    setSpatialDataSelection(STORE_URL, undefined)
    vi.stubGlobal('fetch', offlineFetch)
  })

  afterEach(() => {
    setSpatialDataSelection(STORE_URL, undefined)
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', offlineFetch)
  })

  it('Cancel: reads, controls and link no longer match the view on screen', async () => {
    const { instances } = setup('hang')
    await openStoreAndSwitchToPixels()

    const list = await screen.findByRole('status', { name: 'Active loading tasks' })
    await waitFor(() => {
      expect(within(list).getByRole('button', { name: 'Cancel loading dataset' }))
    })
    fireEvent.click(within(list).getByRole('button', { name: 'Cancel loading dataset' }))

    // The global view's 4 cells are still drawn.
    expect(screen.getByTestId('deck-layer-cells-overview-scatter')).toHaveAttribute(
      'data-count',
      '4',
    )

    // 1. The registry keeps the abandoned selection.
    const registered = spatialDataSelectionFor(STORE_URL)

    // 2. The view controls stay disabled (status stays 'loading').
    openControls('view-options')
    const coordinateSystem = screen.getByTitle('SpatialData coordinate system to show')

    // 3. The link written 160 ms later names the abandoned coordinate system.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    const hash = window.location.hash

    // 4. A read for the dataset on screen goes to the other instance.
    await loadAnnotationSet()
    await waitFor(() => {
      const called = [...instances.values()].filter(
        (instance) => instance.annotations.mock.calls.length > 0,
      )
      expect(called.length).toBeGreaterThan(0)
    })
    const annotationReader = [...instances.values()].find(
      (instance) => instance.annotations.mock.calls.length > 0,
    )

    const observed = {
      registeredCoordinateSystem: registered.coordinateSystem ?? 'global',
      coordinateSystemSelectDisabled: (coordinateSystem as HTMLSelectElement).disabled,
      hashHasSdCsPixels: hash.includes('sdCs=pixels'),
      annotationsReadFrom: annotationReader?.coordinateSystem,
    }
    // Recorded for the notes; the assertions below state the expected
    // behaviour, so this test FAILS while the defect is present.
    console.info('LIF-SD-CANCEL observed', JSON.stringify(observed))

    expect(observed).toEqual({
      registeredCoordinateSystem: 'global',
      coordinateSystemSelectDisabled: false,
      hashHasSdCsPixels: false,
      annotationsReadFrom: 'global',
    })
  })

  it('Failure: same state after the new view fails to load', async () => {
    const { instances } = setup('fail')
    await openStoreAndSwitchToPixels()
    await screen.findAllByText(/could not be opened|Dataset load failed/)

    openControls('view-options')
    const coordinateSystem = screen.getByTitle('SpatialData coordinate system to show')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    const hash = window.location.hash
    await loadAnnotationSet()
    await waitFor(() => {
      expect(
        [...instances.values()].some(
          (instance) => instance.annotations.mock.calls.length > 0,
        ),
      ).toBe(true)
    })
    const annotationReader = [...instances.values()].find(
      (instance) => instance.annotations.mock.calls.length > 0,
    )
    const observed = {
      cellsOnScreen: screen
        .getByTestId('deck-layer-cells-overview-scatter')
        .getAttribute('data-count'),
      registeredCoordinateSystem:
        spatialDataSelectionFor(STORE_URL).coordinateSystem ?? 'global',
      coordinateSystemSelectDisabled: (coordinateSystem as HTMLSelectElement).disabled,
      hashHasSdCsPixels: hash.includes('sdCs=pixels'),
      annotationsReadFrom: annotationReader?.coordinateSystem,
    }
    console.info('LIF-SD-FAIL observed', JSON.stringify(observed))

    expect(observed).toEqual({
      cellsOnScreen: '4',
      registeredCoordinateSystem: 'global',
      coordinateSystemSelectDisabled: false,
      hashHasSdCsPixels: false,
      annotationsReadFrom: 'global',
    })
  })
})
