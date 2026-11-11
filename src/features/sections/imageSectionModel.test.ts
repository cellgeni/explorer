import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useImageSectionModel, type ImageSectionModelInput } from './imageSectionModel'

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
    setCustomLayerOpacity: vi.fn(),
    setImageLayerOpacity: vi.fn(),
    updateMorphologyChannel: vi.fn(),
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
})
