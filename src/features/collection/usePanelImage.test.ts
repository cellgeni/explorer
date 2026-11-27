import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'
import type { MorphologyChannelSetting } from '../morphology/morphologyChannels'
import type { PanelImage } from './panelImage'
import { startingSettings, usePanelImage, type PanelImageLoaders } from './usePanelImage'

const LOADER = { url: 'https://example.test/image.ome.zarr' } as ImagePyramidLoader

function channel(index: number, name: string): MorphologyImageChannel {
  return {
    info: {
      id: `Channel:${index}`,
      index,
      name,
      color: [255, 255, 255],
      contrast: { min: 0, max: 65_535 },
    },
    loader: LOADER,
  }
}

const CHANNELS = [channel(0, 'DAPI'), channel(1, 'CD45'), channel(2, 'Vimentin')]
const MAIN_SETTING: MorphologyChannelSetting = {
  id: 'main:dapi',
  enabled: false,
  color: [0, 0, 255],
  contrastMin: 10,
  contrastMax: 500,
}
const MAIN = {
  channels: [
    { ...channel(0, 'dapi'), info: { ...channel(0, 'dapi').info, id: 'main:dapi' } },
  ],
  settings: [MAIN_SETTING],
}

function pyramid(enabledChannelIds?: readonly string[]): PanelImage {
  return {
    kind: 'pyramid',
    image: {
      url: LOADER.url,
      loader: LOADER,
      channels: [],
      channelLoaders: CHANNELS,
    } as unknown as MorphologyImage,
    enabledChannelIds,
    autoContrast: true,
  }
}

describe('startingSettings', () => {
  it('takes the main view’s settings for channels of the same name', () => {
    const { settings, matched } = startingSettings(CHANNELS, undefined, null, MAIN)

    expect(settings).toEqual([
      {
        id: 'Channel:0',
        enabled: false,
        color: [0, 0, 255],
        contrastMin: 10,
        contrastMax: 500,
      },
      {
        id: 'Channel:1',
        enabled: false,
        color: [255, 255, 255],
        contrastMin: 0,
        contrastMax: 65_535,
      },
      {
        id: 'Channel:2',
        enabled: false,
        color: [255, 255, 255],
        contrastMin: 0,
        contrastMax: 65_535,
      },
    ])
    expect([...matched]).toEqual(['Channel:0'])
  })

  it('shows the image’s default channels without the main view’s', () => {
    const { settings } = startingSettings(
      CHANNELS,
      ['Channel:1', 'Channel:2'],
      null,
      null,
    )

    expect(settings.map((setting) => setting.enabled)).toEqual([false, true, true])
  })

  it('takes the colours and windows the manifest or collection sets, under the main view’s', () => {
    const { settings } = startingSettings(CHANNELS, undefined, null, MAIN, {
      DAPI: { color: [88, 144, 255], contrast: [0, 828] },
      cd45: { color: [32, 166, 122], contrast: [0, 1_440] },
    })

    expect(settings.slice(0, 2)).toEqual([
      // The main view's DAPI.
      {
        id: 'Channel:0',
        enabled: false,
        color: [0, 0, 255],
        contrastMin: 10,
        contrastMax: 500,
      },
      {
        id: 'Channel:1',
        enabled: false,
        color: [32, 166, 122],
        defaultColor: [32, 166, 122],
        contrastMin: 0,
        contrastMax: 1_440,
        contrastSet: true,
      },
    ])
  })

  it('shows the channels the link names, by ID or name', () => {
    const { settings } = startingSettings(
      CHANNELS,
      undefined,
      ['vimentin', 'Channel:0'],
      MAIN,
    )

    expect(settings.map((setting) => setting.enabled)).toEqual([true, false, true])
    // The window still comes from the main view.
    expect(settings[0]?.contrastMax).toBe(500)
  })
})

describe('usePanelImage', () => {
  function testLoaders(image: PanelImage | null) {
    const release = vi.fn()

    return {
      release,
      loaders: {
        loadPanelImage: vi.fn(async () => image),
        retainDataset: vi.fn(() => release),
        computeAutoChannelContrast: vi.fn<
          PanelImageLoaders['computeAutoChannelContrast']
        >(async () => ({
          min: 5,
          max: 99,
          histogram: { bins: [1], maxCount: 1, min: 0, max: 255, sampleCount: 1 },
        })),
      } satisfies PanelImageLoaders,
    }
  }

  it('reads nothing until the panel asks for its image', () => {
    const { loaders } = testLoaders(pyramid())
    const { result } = renderHook(() =>
      usePanelImage({
        url: 'https://example.test/s2',
        enabled: false,
        loaders,
        channelSelection: null,
        mainChannels: null,
      }),
    )

    expect(result.current.status).toBe('idle')
    expect(loaders.loadPanelImage).not.toHaveBeenCalled()
  })

  it('loads the image, holds its dataset, and auto-contrasts the channels it did not take', async () => {
    const { loaders, release } = testLoaders(pyramid())
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        usePanelImage({
          url: 'https://example.test/s2',
          enabled,
          loaders,
          channelSelection: null,
          mainChannels: MAIN,
        }),
      { initialProps: { enabled: true } },
    )

    await waitFor(() => {
      expect(result.current.autoContrastChannelIds).toEqual([])
      expect(result.current.status).toBe('ready')
    })
    expect(loaders.retainDataset).toHaveBeenCalledWith('https://example.test/s2')
    // DAPI took the main view's window; the others were measured.
    expect(loaders.computeAutoChannelContrast.mock.calls.map(([c]) => c.info.id)).toEqual(
      ['Channel:1', 'Channel:2'],
    )
    expect(result.current.settings.map((s) => [s.contrastMin, s.contrastMax])).toEqual([
      [10, 500],
      [5, 99],
      [5, 99],
    ])

    act(() => {
      result.current.updateChannel('Channel:1', { enabled: true })
    })
    expect(result.current.settings[1]?.enabled).toBe(true)

    rerender({ enabled: false })
    expect(result.current.status).toBe('idle')
    expect(release).toHaveBeenCalledOnce()
  })

  it('says when the dataset has no image, or it cannot be read', async () => {
    const none = testLoaders(null)
    const { result } = renderHook(() =>
      usePanelImage({
        url: 'https://example.test/s2',
        enabled: true,
        loaders: none.loaders,
        channelSelection: null,
        mainChannels: null,
      }),
    )
    await waitFor(() => {
      expect(result.current.status).toBe('none')
    })

    const failing = testLoaders(null)
    failing.loaders.loadPanelImage.mockRejectedValueOnce(new Error('HTTP 403'))
    const { result: failed } = renderHook(() =>
      usePanelImage({
        url: 'https://example.test/s3',
        enabled: true,
        loaders: failing.loaders,
        channelSelection: null,
        mainChannels: null,
      }),
    )
    await waitFor(() => {
      expect(failed.current.status).toBe('error')
    })
    expect(failed.current.error).toBe('HTTP 403')
  })
})
