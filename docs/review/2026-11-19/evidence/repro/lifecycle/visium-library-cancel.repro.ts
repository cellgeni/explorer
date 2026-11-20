// LIF review repro: cancelling a Visium library switch.
//
// Expected (plan 15.1-F; cancelDatasetLoad): the dataset on screen stays, so
// its controls should be usable again and show what is on screen, and the
// dataset instance it reads from should still be set to the library shown.
//
// Production App + lifecycle; only dataset I/O is faked. The fake keeps the
// production contract of AnnDataH5adDataset.setVisiumView (h5adDataset.ts):
// it switches the shared instance in place and returns it.
import { createElement } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../../../../../src/App'
import { micrometers } from '../../../../../../src/data/coords'
import {
  appTestDependencies,
  offlineFetch,
  openControls,
  pendingPromise,
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
            readonly props?: { readonly id?: string; readonly cells?: readonly unknown[] }
          }
          const id = candidate.id ?? candidate.props?.id ?? 'unknown-layer'
          const data = candidate.props?.cells ?? []
          return h('div', {
            key: id,
            'data-testid': `deck-layer-${id}`,
            'data-count': String(data.length),
          })
        }),
      ),
  }
})

const H5AD_URL = 'https://example.test/two-libraries.h5ad'

function fakeVisiumH5ad(options: { readonly hangLibraryB: boolean }) {
  const spots = (library: string) =>
    Array.from({ length: library === 'lib-A' ? 3 : 5 }, (_value, index) => ({
      cellId: `${library}-spot-${index.toString()}`,
      position: { x: micrometers(index * 100), y: micrometers(0) },
      transcriptCount: 0,
    }))
  const dataset = {
    view: {} as { libraryId?: string },
    setVisiumView: vi.fn((view: { libraryId?: string }) => {
      dataset.view = view
      return dataset
    }),
    library(): string {
      return dataset.view.libraryId ?? 'lib-A'
    },
    visiumSummary: vi.fn(async () => {
      const library = dataset.library()
      return {
        libraryId: library,
        libraryIds: ['lib-A', 'lib-B'],
        spotCount: spots(library).length,
        offTissueSpotCount: 0,
        showOffTissue: false,
        spotDiameterMicrometers: 55,
        units: { micrometersPerPixel: 1, source: 'spot-grid', detail: 'test' },
        scalefactors: {},
        images: [],
      }
    }),
    overview: vi.fn(async () => {
      const library = dataset.library()
      if (library === 'lib-B' && options.hangLibraryB) {
        return pendingPromise<ReturnType<typeof spots>>()
      }
      return spots(library)
    }),
    genePanel: vi.fn(async () => ['Gad1']),
    annotationGroups: vi.fn(async () => []),
    embeddingOptions: vi.fn(async () => []),
    metadataTracks: vi.fn(async () => []),
    tissueImage: vi.fn(async () => null),
    meta: vi.fn(async () => ({
      platform: 'visium',
      units: {
        dataUnit: 'micrometer',
        imageUnit: 'pixel',
        micrometersPerPixel: micrometers(1),
        origin: 'top-left',
        imageYAxis: 'down',
      },
      extent: {
        minX: micrometers(0),
        maxX: micrometers(400),
        minY: micrometers(0),
        maxY: micrometers(10),
      },
      capabilities: {
        transcripts: false,
        cellBoundaries: false,
        pyramidImage: false,
        multiChannel: false,
      },
    })),
  }
  return dataset
}

function renderApp(options: {
  readonly hangSecondDetection: boolean
  readonly hangLibraryB: boolean
}) {
  const dataset = fakeVisiumH5ad({ hangLibraryB: options.hangLibraryB })
  let detections = 0
  const detectSpatialDataset = vi.fn(async (baseUrl: string) => {
    detections += 1
    if (detections > 1 && options.hangSecondDetection) return pendingPromise<never>()
    return { platform: 'h5ad' as const, baseUrl, h5adUrl: baseUrl, checked: [] }
  })
  const getSpatialDataset = vi.fn(async () => dataset as never)
  render(
    createElement(App, {
      dependencies: appTestDependencies({ detectSpatialDataset, getSpatialDataset }),
    }),
  )
  return dataset
}

async function openAndSwitchToLibraryB() {
  openControls('open-dataset')
  fireEvent.change(screen.getByLabelText('Dataset or image URL'), {
    target: { value: H5AD_URL },
  })
  openControls('open-dataset')
  fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))
  openControls('diagnostics')
  await screen.findByText(/Visium ready: 3 spots/)
  openControls('view-options')
  fireEvent.change(screen.getByTitle('Visium library to show'), {
    target: { value: 'lib-B' },
  })
  const list = await screen.findByRole('status', { name: 'Active loading tasks' })
  await waitFor(() => {
    expect(within(list).getByRole('button', { name: 'Cancel loading dataset' }))
  })
  fireEvent.click(within(list).getByRole('button', { name: 'Cancel loading dataset' }))
}

describe('LIF: Visium library switch that is cancelled', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    window.sessionStorage.clear()
    useViewerStore.setState(initialViewerState)
    vi.stubGlobal('fetch', offlineFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', offlineFetch)
  })

  it('cancel during detection: control stays disabled on the library not shown', async () => {
    renderApp({ hangSecondDetection: true, hangLibraryB: false })
    await openAndSwitchToLibraryB()

    openControls('view-options')
    const select = screen.getByTitle('Visium library to show') as HTMLSelectElement
    const observed = {
      spotsOnScreen: screen
        .getByTestId('deck-layer-cells-overview-scatter')
        .getAttribute('data-count'),
      selectValue: select.value,
      selectDisabled: select.disabled,
    }
    console.info('LIF-VISIUM-CANCEL-DETECT observed', JSON.stringify(observed))
    expect(observed).toEqual({
      spotsOnScreen: '3',
      selectValue: 'lib-A',
      selectDisabled: false,
    })
  })

  it('cancel after setVisiumView: the shared instance stays on the other library', async () => {
    const dataset = renderApp({ hangSecondDetection: false, hangLibraryB: true })
    await openAndSwitchToLibraryB()

    // What a later read for the dataset on screen (gene expression, ROI,
    // annotations, Plots; all via getSpatialDataset) would be answered from.
    const libraryReadsUse = dataset.library()
    const observed = {
      spotsOnScreen: screen
        .getByTestId('deck-layer-cells-overview-scatter')
        .getAttribute('data-count'),
      setVisiumViewCalls: dataset.setVisiumView.mock.calls.map((call) => call[0]),
      libraryReadsUse,
    }
    console.info('LIF-VISIUM-CANCEL-MUTATED observed', JSON.stringify(observed))
    expect(observed.spotsOnScreen).toBe('3')
    expect(libraryReadsUse).toBe('lib-A')
  })
})
