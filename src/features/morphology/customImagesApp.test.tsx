import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { imagePixels, micrometers } from '../../data/coords'
import { clearDatasetImages } from '../../data/datasetFiles'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import { parseDatasetManifest } from '../../datasets/datasetManifest'
import { initialViewerState, useViewerStore } from '../../store/viewerStore'
import {
  appTestDependencies,
  createSpatialDatasetLoaderMock,
  openControls,
  type AppTestDependencyProps,
} from '../../test/appTestHarness'
import type {
  CustomMorphologyLayerLoader,
  SpatialDatasetDetector,
} from '../app-shell/appDependencies'

vi.mock('@deck.gl/react', () => ({
  DeckGL: () => <div data-testid="deckgl" />,
}))

const IMAGE_URL = 'https://example.test/run/morphology_focus.ome.tif'
const HE_URL = 'https://example.test/run/post-xenium/he_registered.ome.tif'
const IF_URL = 'https://example.test/run/if.ome.tif'
const OTHER_URL = 'https://example.test/other.ome.tif'

function TestApp(props: AppTestDependencyProps) {
  return <App dependencies={appTestDependencies(props)} />
}

function imageLoader(): ImagePyramidLoader {
  return {
    url: IMAGE_URL,
    imageWidth: imagePixels(160),
    imageHeight: imagePixels(80),
    tileWidth: imagePixels(256),
    tileHeight: imagePixels(256),
    numLevels: 1,
    tilesForLevel: () => [{ col: 0, row: 0 }],
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(0.5),
      origin: 'top-left',
      imageYAxis: 'down',
    },
    channels: [
      {
        id: 'Channel:0',
        index: 0,
        name: 'DAPI',
        color: [88, 144, 255],
        contrast: { min: 0, max: 255 },
      },
    ],
  } as unknown as ImagePyramidLoader
}

function imageDataset() {
  const loader = imageLoader()

  return {
    meta: vi.fn(async () => ({
      platform: 'image' as const,
      units: loader.units,
      extent: {
        minX: micrometers(0),
        maxX: micrometers(80),
        minY: micrometers(0),
        maxY: micrometers(40),
      },
      capabilities: {
        transcripts: false,
        cellBoundaries: false,
        pyramidImage: true,
        multiChannel: true,
      },
      channels: loader.channels,
    })),
    image: vi.fn(async () => ({ kind: 'pyramid' as const, loader })),
  }
}

// The run's focus image, with a registered H&E and an IF panel at 0.6 as
// custom image layers.
const manifest = parseDatasetManifest(
  {
    version: 1,
    platform: 'image',
    files: { image: 'morphology_focus.ome.tif' },
    defaults: {
      customImages: [
        { url: 'post-xenium/he_registered.ome.tif' },
        { url: 'if.ome.tif', opacity: 0.6 },
      ],
    },
  },
  'https://example.test/run/explorer.json',
)

const detectImage: SpatialDatasetDetector = async () => ({
  platform: 'image',
  baseUrl: IMAGE_URL,
  imageUrl: IMAGE_URL,
  imageKind: 'tiff',
  manifest,
  checked: [],
})

function customLayerLoader() {
  return vi.fn<CustomMorphologyLayerLoader>(async (url) => {
    const loader = { ...imageLoader(), url } as ImagePyramidLoader
    const channel = {
      id: 'Channel:0',
      index: 0,
      name: 'Stain',
      color: [255, 255, 255] as const,
      contrast: { min: 0, max: 255 },
    }

    return {
      url,
      loader,
      channels: [channel],
      channelLoaders: [{ info: channel, loader }],
    }
  })
}

function link(): URLSearchParams {
  return new URLSearchParams(window.location.hash.slice(1))
}

// The app writes the link 160 ms after changes settle (useShareableUrlHash).
async function settleLink(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
}

describe('App with custom image layers from a dataset manifest', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    useViewerStore.setState(initialViewerState)
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    clearDatasetImages()
  })

  it('opens the manifest’s layers in order, and the link names them only once they change', async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&dataset=${encodeURIComponent(IMAGE_URL)}`,
    )
    const loadCustomMorphologyLayer = customLayerLoader()

    render(
      <TestApp
        detectSpatialDataset={detectImage}
        getSpatialDataset={createSpatialDatasetLoaderMock(imageDataset())}
        loadCustomMorphologyLayer={loadCustomMorphologyLayer}
      />,
    )
    openControls('image')

    expect(
      await screen.findByRole('checkbox', { name: 'if.ome.tif / Stain' }),
    ).toBeInTheDocument()
    expect(loadCustomMorphologyLayer.mock.calls.map(([url]) => url)).toEqual([
      HE_URL,
      IF_URL,
    ])
    expect(screen.getByRole('slider', { name: 'if.ome.tif opacity' })).toHaveValue('60')
    expect(
      screen.getByRole('slider', { name: 'he_registered.ome.tif opacity' }),
    ).toHaveValue('100')

    // The manifest's layers at its opacities: the link leaves them out.
    await waitFor(() => {
      expect(link().get('channels')).toBe('Channel:0')
    })
    await settleLink()
    expect(link().has('customImageUrl')).toBe(false)
    expect(link().has('customImageOpacity')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Remove he_registered.ome.tif' }))
    await waitFor(() => {
      expect(link().getAll('customImageUrl')).toEqual([IF_URL])
    })
    expect(link().getAll('customImageOpacity')).toEqual(['0.6'])

    // None left: written empty, or the manifest's would open again.
    fireEvent.click(screen.getByRole('button', { name: 'Remove if.ome.tif' }))
    await waitFor(() => {
      expect(link().getAll('customImageUrl')).toEqual([''])
    })
  })

  it('opens a link’s own layers in place of the manifest’s', async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&dataset=${encodeURIComponent(IMAGE_URL)}&customImageUrl=${encodeURIComponent(OTHER_URL)}`,
    )
    const loadCustomMorphologyLayer = customLayerLoader()

    render(
      <TestApp
        detectSpatialDataset={detectImage}
        getSpatialDataset={createSpatialDatasetLoaderMock(imageDataset())}
        loadCustomMorphologyLayer={loadCustomMorphologyLayer}
      />,
    )
    openControls('image')

    expect(
      await screen.findByRole('checkbox', { name: 'other.ome.tif / Stain' }),
    ).toBeInTheDocument()
    await settleLink()
    expect(loadCustomMorphologyLayer.mock.calls.map(([url]) => url)).toEqual([OTHER_URL])
    expect(link().getAll('customImageUrl')).toEqual([OTHER_URL])
  })

  it('opens no layers for a link that removed the manifest’s', async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&dataset=${encodeURIComponent(IMAGE_URL)}&customImageUrl=`,
    )
    const loadCustomMorphologyLayer = customLayerLoader()

    render(
      <TestApp
        detectSpatialDataset={detectImage}
        getSpatialDataset={createSpatialDatasetLoaderMock(imageDataset())}
        loadCustomMorphologyLayer={loadCustomMorphologyLayer}
      />,
    )

    await waitFor(() => {
      expect(link().get('channels')).toBe('Channel:0')
    })
    await settleLink()
    expect(loadCustomMorphologyLayer).not.toHaveBeenCalled()
    expect(link().getAll('customImageUrl')).toEqual([''])
  })
})

describe('App with custom image layers from a collection entry', () => {
  const collectionUrl = 'https://example.test/study/collection.json'
  const run7 = 'https://example.test/study/run-7/explorer.json'
  const collection = parseDatasetCollection(
    {
      version: 1,
      datasets: [
        {
          dataset: 'run-7/explorer.json',
          name: 'Run 7',
          customImages: [{ url: OTHER_URL, opacity: 0.4 }],
        },
        { dataset: 'run-8/explorer.json', name: 'Run 8' },
      ],
    },
    collectionUrl,
  )

  beforeEach(() => {
    window.sessionStorage.clear()
    useViewerStore.setState(initialViewerState)
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    clearDatasetImages()
  })

  it('opens the entry’s layers in place of the manifest’s, and the manifest’s for an entry without', async () => {
    window.history.replaceState(null, '', `/?collection=${collectionUrl}`)
    const loadCustomMorphologyLayer = customLayerLoader()

    render(
      <TestApp
        loadCollection={vi.fn(async () => collection)}
        detectSpatialDataset={async (baseUrl) => ({
          ...(await detectImage(baseUrl)),
          baseUrl,
        })}
        getSpatialDataset={createSpatialDatasetLoaderMock(imageDataset())}
        loadCustomMorphologyLayer={loadCustomMorphologyLayer}
      />,
    )
    openControls('image')

    expect(
      await screen.findByRole('slider', { name: 'other.ome.tif opacity' }),
    ).toHaveValue('40')
    expect(loadCustomMorphologyLayer.mock.calls.map(([url]) => url)).toEqual([OTHER_URL])
    // The entry's layers at its opacities: the link leaves them out.
    await waitFor(() => {
      expect(link().get('dataset')).toBe(run7)
      expect(link().get('channels')).toBe('Channel:0')
    })
    await settleLink()
    expect(link().has('customImageUrl')).toBe(false)
    expect(link().has('customImageOpacity')).toBe(false)

    const bar = screen.getByRole('navigation', { name: 'Collection' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Run 8' }))

    expect(await screen.findByRole('slider', { name: 'if.ome.tif opacity' })).toHaveValue(
      '60',
    )
    expect(loadCustomMorphologyLayer.mock.calls.map(([url]) => url)).toEqual([
      OTHER_URL,
      HE_URL,
      IF_URL,
    ])
    expect(
      screen.queryByRole('slider', { name: 'other.ome.tif opacity' }),
    ).not.toBeInTheDocument()
  })
})
