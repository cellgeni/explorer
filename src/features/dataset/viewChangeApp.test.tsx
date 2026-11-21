import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { micrometers } from '../../data/coords'
import {
  setSpatialDataSelection,
  setVisiumView,
  spatialDataSelectionFor,
  visiumViewFor,
  type CachedSpatialDatasetOptions,
} from '../../datasets/datasetFactory'
import { initialViewerState, useViewerStore } from '../../store/viewerStore'
import {
  appTestDependencies,
  offlineFetch,
  openControls,
  pendingPromise,
  type AppTestDependencyProps,
} from '../../test/appTestHarness'

// A view change of the dataset on screen (a Visium library, a SpatialData
// coordinate system) reloads its URL. When that reload is cancelled or fails
// before it replaces the view, the view on screen stays (15.1-F): its control
// is usable and shows it, the link names it, and reads go to it.

vi.mock('@deck.gl/react', () => ({
  DeckGL: ({ layers = [] }: { readonly layers?: readonly unknown[] }) => (
    <div data-testid="deckgl">
      {layers.map((layer) => {
        const { id, props } = layer as {
          readonly id: string
          readonly props?: { readonly cells?: readonly unknown[] }
        }
        return (
          <div
            key={id}
            data-testid={`deck-layer-${id}`}
            data-count={props?.cells?.length ?? 0}
          />
        )
      })}
    </div>
  ),
}))

const cellsOnScreen = () =>
  screen.getByTestId('deck-layer-cells-overview-scatter').getAttribute('data-count')

// The link is written 160 ms after a change.
async function settledHash(): Promise<string> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300))
  })
  return window.location.hash
}

async function cancelLoad() {
  const list = await screen.findByRole('status', { name: 'Active loading tasks' })
  const cancel = await within(list).findByRole('button', {
    name: 'Cancel loading dataset',
  })
  fireEvent.click(cancel)
}

async function openDataset(url: string, ready: RegExp) {
  openControls('open-dataset')
  fireEvent.change(screen.getByLabelText('Dataset or image URL'), {
    target: { value: url },
  })
  openControls('open-dataset')
  fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))
  openControls('diagnostics')
  await screen.findByText(ready)
}

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

describe('a cancelled or failed Visium library switch', () => {
  const URL = 'https://example.test/two-libraries.h5ad'
  type Mode = 'hang-detection' | 'hang-overview' | 'fail-overview'

  // One instance per library, as cachedSpatialDataset gives each view of
  // the file (AnnDataH5adDataset.visiumViewDataset); lib-A has 3 spots,
  // lib-B 5.
  function visiumH5ad(mode: Mode) {
    const spots = (library: string) =>
      Array.from({ length: library === 'lib-A' ? 3 : 5 }, (_value, index) => ({
        cellId: `${library}-spot-${index.toString()}`,
        position: { x: micrometers(index * 100), y: micrometers(0) },
        transcriptCount: 0,
      }))
    const instances = new Map<string, ReturnType<typeof instance>>()
    const instance = (library: string) => ({
      overview: vi.fn(async () => {
        if (library === 'lib-B' && mode === 'hang-overview') {
          return pendingPromise<ReturnType<typeof spots>>()
        }
        if (library === 'lib-B' && mode === 'fail-overview') {
          throw new Error('obsm chunk 0 returned HTTP 503')
        }
        return spots(library)
      }),
      visiumSummary: async () => ({
        libraryId: library,
        libraryIds: ['lib-A', 'lib-B'],
        spotCount: spots(library).length,
        offTissueSpotCount: 0,
        showOffTissue: false,
        spotDiameterMicrometers: 55,
        units: { micrometersPerPixel: 1, source: 'spot-grid', detail: 'test' },
        scalefactors: {},
        images: [],
      }),
      genePanel: async () => ['Gad1'],
      annotationGroups: async () => [],
      embeddingOptions: async () => [],
      metadataTracks: async () => [],
      tissueImage: async () => null,
      meta: async () => ({
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
      }),
    })
    let detections = 0
    const props: AppTestDependencyProps = {
      detectSpatialDataset: vi.fn(async (baseUrl: string) => {
        detections += 1
        if (detections > 1 && mode === 'hang-detection') return pendingPromise<never>()
        return { platform: 'h5ad' as const, baseUrl, h5adUrl: baseUrl, checked: [] }
      }),
      getSpatialDataset: vi.fn(
        async (url: string, options?: CachedSpatialDatasetOptions) => {
          const library = (options?.visiumView ?? visiumViewFor(url)).libraryId ?? 'lib-A'
          const known = instances.get(library) ?? instance(library)
          instances.set(library, known)
          return known as never
        },
      ),
    }
    render(<App dependencies={appTestDependencies(props)} />)
    return instances
  }

  async function switchToLibraryB() {
    await openDataset(URL, /Visium ready: 3 spots/)
    const hash = await settledHash()
    openControls('view-options')
    fireEvent.change(screen.getByTitle('Visium library to show'), {
      target: { value: 'lib-B' },
    })
    return hash
  }

  async function expectLibraryAShown(hash: string) {
    expect(cellsOnScreen()).toBe('3')
    openControls('view-options')
    const library = screen.getByTitle<HTMLSelectElement>('Visium library to show')
    expect(library.value).toBe('lib-A')
    expect(library).toBeEnabled()
    expect(await settledHash()).toBe(hash)
    // Gene, ROI, annotation and Plots reads by URL go to library A.
    expect(visiumViewFor(URL).libraryId ?? 'lib-A').toBe('lib-A')
  }

  beforeEach(() => {
    setVisiumView(URL, undefined)
  })

  afterEach(() => {
    setVisiumView(URL, undefined)
  })

  it('cancelled while the dataset is detected again', async () => {
    visiumH5ad('hang-detection')
    const hash = await switchToLibraryB()
    await cancelLoad()

    await expectLibraryAShown(hash)
  })

  it('cancelled while library B is read', async () => {
    const instances = visiumH5ad('hang-overview')
    const hash = await switchToLibraryB()
    await waitFor(() => {
      expect(instances.get('lib-B')?.overview).toHaveBeenCalled()
    })
    // Until the reload replaces it, reads by URL go to library A.
    expect(visiumViewFor(URL).libraryId ?? 'lib-A').toBe('lib-A')
    await cancelLoad()

    await expectLibraryAShown(hash)
  })

  it('failed', async () => {
    visiumH5ad('fail-overview')
    const hash = await switchToLibraryB()
    await screen.findAllByText(/could not be opened|Dataset load failed/)

    await expectLibraryAShown(hash)
  })
})

describe('a cancelled or failed SpatialData coordinate system change', () => {
  const URL = 'https://example.test/sample.zarr'

  // One instance per selection, as cachedSpatialDataset keys them; the
  // pixels view's cells hang or fail.
  function spatialData(mode: 'hang' | 'fail') {
    const instances = new Map<string, ReturnType<typeof instance>>()
    const instance = (coordinateSystem: string) => {
      const cells = Array.from({ length: 4 }, (_value, index) => ({
        cellId: `${coordinateSystem}-cell-${index.toString()}`,
        position: { x: micrometers(index * 10), y: micrometers(index * 10) },
        transcriptCount: 0,
      }))
      return {
        coordinateSystem,
        summary: async () => ({
          coordinateSystem,
          coordinateSystems: ['global', 'pixels'],
          images: [],
          table: 'table',
          tables: ['table'],
          regions: ['cells'],
          skippedElements: [],
          units: { micrometersPerUnit: 1, source: 'declared' as const, detail: 'test' },
        }),
        image: async () => null,
        meta: async () => ({
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
        }),
        overview: async () => {
          if (coordinateSystem === 'pixels' && mode === 'hang') {
            return pendingPromise<typeof cells>()
          }
          if (coordinateSystem === 'pixels' && mode === 'fail') {
            throw new Error('table chunk 0 returned HTTP 503')
          }
          return cells
        },
        genePanel: async () => ['Gad1'],
        annotationGroups: async () => [
          { id: 'analysis:type', label: 'type', groupingName: 'type', groupCount: 1 },
        ],
        annotations: vi.fn(async () => [
          {
            id: 'analysis:type:a',
            label: 'type: a',
            cellIds: cells.map((c) => c.cellId),
          },
        ]),
        embeddingOptions: async () => [],
        metadataTracks: async () => [],
      }
    }
    const props: AppTestDependencyProps = {
      detectSpatialDataset: vi.fn(async (baseUrl: string) => ({
        platform: 'spatialdata' as const,
        baseUrl,
        spatialDataUrl: baseUrl,
        checked: [],
      })),
      getSpatialDataset: vi.fn(
        async (url: string, options?: CachedSpatialDatasetOptions) => {
          const coordinateSystem =
            spatialDataSelectionFor(url, options?.spatialDataSelection)
              .coordinateSystem ?? 'global'
          const known = instances.get(coordinateSystem) ?? instance(coordinateSystem)
          instances.set(coordinateSystem, known)
          return known as never
        },
      ),
    }
    render(<App dependencies={appTestDependencies(props)} />)
    return instances
  }

  async function switchToPixels() {
    await openDataset(URL, /SpatialData ready: 4 cells/)
    const hash = await settledHash()
    openControls('view-options')
    fireEvent.change(screen.getByTitle('SpatialData coordinate system to show'), {
      target: { value: 'pixels' },
    })
    return hash
  }

  async function expectGlobalShown(
    instances: ReturnType<typeof spatialData>,
    hash: string,
  ) {
    expect(cellsOnScreen()).toBe('4')
    expect(spatialDataSelectionFor(URL).coordinateSystem ?? 'global').toBe('global')
    openControls('view-options')
    const coordinateSystem = screen.getByTitle<HTMLSelectElement>(
      'SpatialData coordinate system to show',
    )
    expect(coordinateSystem.value).toBe('global')
    expect(coordinateSystem).toBeEnabled()
    expect(await settledHash()).toBe(hash)

    openControls('clusters')
    fireEvent.change(screen.getByRole('combobox', { name: 'Annotation set' }), {
      target: { value: 'analysis:type' },
    })
    const load = screen.getByRole('button', { name: 'Load Annotations' })
    await waitFor(() => {
      expect(load).toBeEnabled()
    })
    fireEvent.click(load)
    await waitFor(() => {
      expect(instances.get('global')?.annotations).toHaveBeenCalled()
    })
    expect(instances.get('pixels')?.annotations).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    setSpatialDataSelection(URL, undefined)
  })

  afterEach(() => {
    setSpatialDataSelection(URL, undefined)
  })

  it('cancelled', async () => {
    const instances = spatialData('hang')
    const hash = await switchToPixels()
    await cancelLoad()

    await expectGlobalShown(instances, hash)
  })

  it('failed', async () => {
    const instances = spatialData('fail')
    const hash = await switchToPixels()
    await screen.findAllByText(/could not be opened|Dataset load failed/)

    await expectGlobalShown(instances, hash)
  })
})
