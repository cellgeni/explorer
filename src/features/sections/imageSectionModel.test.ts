import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShownMorphologyFrame } from '../morphology/morphologyFrame'
import type { TimePointPlayback } from '../morphology/useTimePointPlayback'
import { useImageSectionModel, type ImageSectionModelInput } from './imageSectionModel'

function testTimePointPlayback(
  overrides: Partial<TimePointPlayback> = {},
): TimePointPlayback {
  return {
    playing: false,
    speed: 5,
    loop: true,
    startTimePoint: null,
    prefetchPlanes: [],
    play: vi.fn(),
    pause: vi.fn(),
    setSpeed: vi.fn(),
    setLoop: vi.fn(),
    ...overrides,
  }
}

function input(overrides: Partial<ImageSectionModelInput> = {}): ImageSectionModelInput {
  return {
    appendDebugEvent: vi.fn(),
    autoContrastChannelIds: [],
    customLayerLoadState: { status: 'idle' },
    customLayerOpacities: {},
    customLayers: [],
    handleAutoContrast: vi.fn(),
    handleLoadCustomLayer: vi.fn(async () => true),
    handleRemoveCustomLayer: vi.fn(),
    imageLayerOpacity: 1,
    loadEnabled: true,
    morphologyChannelSettings: [],
    morphologyChannels: [],
    morphologyZStack: undefined,
    requestedMorphologyZPlane: null,
    selectMorphologyZPlane: vi.fn(),
    morphologyTimeSeries: undefined,
    requestedMorphologyTimePoint: null,
    selectMorphologyTimePoint: vi.fn(),
    morphologyFrame: undefined,
    shownMorphologyFrame: new ShownMorphologyFrame(),
    timePointPlayback: testTimePointPlayback(),
    setCustomLayerOpacity: vi.fn(),
    setImageLayerOpacity: vi.fn(),
    updateMorphologyChannel: vi.fn(),
    volumeViewAvailable: false,
    volumeViewOpen: false,
    setVolumeViewOpen: vi.fn(),
    ...overrides,
  }
}

describe('useImageSectionModel', () => {
  it('turns opacity percents into opacities and logs them', () => {
    const options = input()
    const { result } = renderHook(() => useImageSectionModel(options))

    result.current.onOpacityPercentChange(45)
    result.current.customLayers.onOpacityPercentChange(
      'https://example.test/remote.ome.tif',
      35,
    )

    expect(options.setImageLayerOpacity).toHaveBeenCalledWith(0.45)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Dataset image opacity: 45%', {
      coalesceKey: 'image-opacity',
    })
    expect(options.setCustomLayerOpacity).toHaveBeenCalledWith(
      'https://example.test/remote.ome.tif',
      0.35,
    )
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Custom image opacity: 35%', {
      coalesceKey: 'custom-image-opacity:https://example.test/remote.ome.tif',
    })
  })

  it('passes custom layer and channel actions through', async () => {
    const options = input({ loadEnabled: false })
    const { result } = renderHook(() => useImageSectionModel(options))

    await result.current.customLayers.onLoad('https://example.test/new.ome.tif')
    result.current.customLayers.onRemove('custom-layer:1')
    result.current.onZPlaneChange(3)
    result.current.onUpdateChannel('channel:0', { enabled: false })

    expect(result.current.customLayers.loadEnabled).toBe(false)
    expect(options.handleLoadCustomLayer).toHaveBeenCalledWith(
      'https://example.test/new.ome.tif',
    )
    expect(options.handleRemoveCustomLayer).toHaveBeenCalledWith('custom-layer:1')
    expect(options.selectMorphologyZPlane).toHaveBeenCalledWith(3)
    expect(options.updateMorphologyChannel).toHaveBeenCalledWith('channel:0', {
      enabled: false,
    })
  })

  it('offers the 3D view only for an image that has one', () => {
    expect(
      renderHook(() => useImageSectionModel(input())).result.current.volumeView,
    ).toBe(null)

    const options = input({ volumeViewAvailable: true, volumeViewOpen: true })
    const { result } = renderHook(() => useImageSectionModel(options))

    expect(result.current.volumeView?.open).toBe(true)
    result.current.volumeView?.onOpenChange(false)
    expect(options.setVolumeViewOpen).toHaveBeenCalledWith(false)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Image view: 2D')
  })

  it('stops Play when the slider moves, and offers no Play in 3D (plan 28)', () => {
    const playback = testTimePointPlayback({ playing: true })
    const options = input({ timePointPlayback: playback })
    const { result } = renderHook(() => useImageSectionModel(options))

    expect(result.current.playback?.playing).toBe(true)
    result.current.onTimePointChange(7)
    expect(playback.pause).toHaveBeenCalledOnce()
    expect(options.selectMorphologyTimePoint).toHaveBeenCalledWith(7)

    result.current.playback?.onPlayingChange(false)
    expect(playback.pause).toHaveBeenCalledTimes(2)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Time points: pause')
    result.current.playback?.onSpeedChange(10)
    expect(playback.setSpeed).toHaveBeenCalledWith(10)

    const in3d = input({
      timePointPlayback: playback,
      volumeViewAvailable: true,
      volumeViewOpen: true,
    })
    expect(
      renderHook(() => useImageSectionModel(in3d)).result.current.playback,
    ).toBeNull()
  })
})
