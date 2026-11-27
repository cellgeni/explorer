import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { deferredPromise } from '../../test/appTestHarness'
import type { CustomImagesToOpen } from './customMorphologyLayers'
import { useCustomImagesToOpen } from './useCustomImagesToOpen'

const DATASET = 'https://example.test/run'
const HE = 'https://example.test/he.ome.tif'
const FLUORESCENCE = 'https://example.test/if.zarr'

function setup(request: CustomImagesToOpen) {
  const pending = new Map([
    [HE, deferredPromise<boolean>()],
    [FLUORESCENCE, deferredPromise<boolean>()],
  ])
  const loadCustomLayer = vi.fn((url: string) => pending.get(url)!.promise)
  const setLayerOpacity = vi.fn()
  const loadRequestIdRef = { current: 1 }
  const hook = renderHook(
    ({ loadedDatasetUrl }: { readonly loadedDatasetUrl: string | null }) =>
      useCustomImagesToOpen({
        request,
        loadedDatasetUrl,
        loadRequestIdRef,
        loadCustomLayer,
        setLayerOpacity,
      }),
    { initialProps: { loadedDatasetUrl: null as string | null } },
  )

  return { hook, pending, loadCustomLayer, setLayerOpacity, loadRequestIdRef }
}

describe('useCustomImagesToOpen', () => {
  it('opens the layers in order once the dataset is ready, listing those still to open', async () => {
    const request = {
      datasetUrl: DATASET,
      images: [{ url: HE }, { url: FLUORESCENCE, opacity: 0.6 }],
    }
    const { hook, pending, loadCustomLayer, setLayerOpacity } = setup(request)

    expect(hook.result.current).toEqual(request.images)
    expect(loadCustomLayer).not.toHaveBeenCalled()

    hook.rerender({ loadedDatasetUrl: DATASET })
    expect(loadCustomLayer.mock.calls.map(([url]) => url)).toEqual([HE])

    await act(async () => {
      pending.get(HE)!.resolve(true)
    })
    expect(hook.result.current).toEqual([{ url: FLUORESCENCE, opacity: 0.6 }])
    expect(loadCustomLayer.mock.calls.map(([url]) => url)).toEqual([HE, FLUORESCENCE])
    expect(setLayerOpacity).not.toHaveBeenCalled()

    await act(async () => {
      pending.get(FLUORESCENCE)!.resolve(true)
    })
    expect(hook.result.current).toEqual([])
    expect(setLayerOpacity).toHaveBeenCalledWith(FLUORESCENCE, 0.6)

    // Re-rendering does not open them again.
    hook.rerender({ loadedDatasetUrl: DATASET })
    expect(loadCustomLayer).toHaveBeenCalledTimes(2)
  })

  it('moves on past a layer that fails, without its opacity', async () => {
    const { hook, pending, loadCustomLayer, setLayerOpacity } = setup({
      datasetUrl: DATASET,
      images: [{ url: HE, opacity: 0.5 }, { url: FLUORESCENCE }],
    })

    hook.rerender({ loadedDatasetUrl: DATASET })
    await act(async () => {
      pending.get(HE)!.resolve(false)
    })

    expect(setLayerOpacity).not.toHaveBeenCalled()
    expect(loadCustomLayer.mock.calls.map(([url]) => url)).toEqual([HE, FLUORESCENCE])
  })

  it('opens no more once another dataset’s load commits', async () => {
    const { hook, pending, loadCustomLayer, loadRequestIdRef } = setup({
      datasetUrl: DATASET,
      images: [{ url: HE }, { url: FLUORESCENCE }],
    })

    hook.rerender({ loadedDatasetUrl: DATASET })
    loadRequestIdRef.current += 1
    await act(async () => {
      pending.get(HE)!.resolve(true)
    })

    expect(loadCustomLayer.mock.calls.map(([url]) => url)).toEqual([HE])
  })
})
