import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { imagePixels, micrometers } from '../../data/coords'
import { clearDatasetImages } from '../../data/datasetFiles'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import {
  parseDatasetManifest,
  type DatasetManifest,
} from '../../datasets/datasetManifest'
import { initialViewerState, useViewerStore } from '../../store/viewerStore'
import {
  appTestDependencies,
  createSpatialDatasetLoaderMock,
  type AppTestDependencyProps,
} from '../../test/appTestHarness'
import type { SpatialDatasetDetector } from '../app-shell/appDependencies'

vi.mock('@deck.gl/react', () => ({
  DeckGL: () => <div data-testid="deckgl" />,
}))

const IMAGE_URL = 'https://example.test/images/embryo.ome.zarr'

function TestApp(props: AppTestDependencyProps) {
  return <App dependencies={appTestDependencies(props)} />
}

// A one-channel OME-Zarr z-stack whose 3D view reads a 2 × 2 × 2 volume.
function zStackLoader(): ImagePyramidLoader {
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
    volumeLevels: () => [
      { level: 0, width: 2, height: 2, depth: 2, voxelSize: { x: 0.5, y: 0.5 } },
    ],
    loadVolume: vi.fn(async () => ({
      data: new Uint8Array(8),
      width: 2,
      height: 2,
      depth: 2,
    })),
  } as unknown as ImagePyramidLoader
}

function imageDataset() {
  const loader = zStackLoader()

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

function detectImage(manifest?: DatasetManifest): SpatialDatasetDetector {
  return async () => ({
    platform: 'image',
    baseUrl: IMAGE_URL,
    imageUrl: IMAGE_URL,
    imageKind: 'ome-zarr',
    ...(manifest === undefined ? {} : { manifest }),
    checked: [],
  })
}

async function linkAfterWrite(): Promise<URLSearchParams> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200))
  })
  return new URLSearchParams(window.location.hash.slice(1))
}

describe('App with a z-stack image', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    useViewerStore.setState(initialViewerState)
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    clearDatasetImages()
  })

  it('opens the 3D view a link asks for, and leaves it out of the link in 2D', async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&dataset=${encodeURIComponent(IMAGE_URL)}&imageView=3d`,
    )

    render(
      <TestApp
        detectSpatialDataset={detectImage()}
        getSpatialDataset={createSpatialDatasetLoaderMock(imageDataset())}
      />,
    )

    const view = await screen.findByRole('region', { name: '3D view' })
    expect((await linkAfterWrite()).get('imageView')).toBe('3d')

    fireEvent.click(within(view).getByRole('button', { name: '2D View' }))
    expect(screen.queryByRole('region', { name: '3D view' })).not.toBeInTheDocument()
    expect((await linkAfterWrite()).has('imageView')).toBe(false)
  })

  it("opens in 3D for a manifest's default, and writes 2D to undo it", async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&dataset=${encodeURIComponent(IMAGE_URL)}`,
    )
    const manifest = parseDatasetManifest(
      {
        version: 1,
        platform: 'image',
        files: { image: IMAGE_URL },
        defaults: { imageView: '3d' },
      },
      'https://example.test/images/embryo.json',
    )

    render(
      <TestApp
        detectSpatialDataset={detectImage(manifest)}
        getSpatialDataset={createSpatialDatasetLoaderMock(imageDataset())}
      />,
    )

    const view = await screen.findByRole('region', { name: '3D view' })
    // The manifest's view, so the link leaves it out.
    expect((await linkAfterWrite()).has('imageView')).toBe(false)

    fireEvent.click(within(view).getByRole('button', { name: '2D View' }))
    expect((await linkAfterWrite()).get('imageView')).toBe('2d')
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: '3D view' })).not.toBeInTheDocument()
    })
  })
})
