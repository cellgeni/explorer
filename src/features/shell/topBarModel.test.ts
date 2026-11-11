import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  datasetSummaryText,
  formatCompactCount,
  toolOptions,
  useTopBarModel,
  type TopBarModelInput,
} from './topBarModel'

function input(overrides: Partial<TopBarModelInput> = {}): TopBarModelInput {
  return {
    activeTool: 'pan',
    appendDebugEvent: vi.fn(),
    canDrawRoi: true,
    channelCount: 4,
    datasetName: 'Sob23 brain',
    debugMode: false,
    elementCount: 1_414_155,
    elementNoun: 'cells',
    geneCount: 5001,
    loadingDatasetName: null,
    magicLensAvailable: true,
    magicLensEnabled: true,
    magicLensReason: undefined,
    magicLensScope: 'cursor',
    onMagicLensCursorActiveChange: vi.fn(),
    onMagicLensScopeChange: vi.fn(),
    onMeasureEnabledChange: vi.fn(),
    onReturnToPan: vi.fn(),
    onRoiModeChange: vi.fn(),
    platform: 'xenium',
    setDebugMode: vi.fn(),
    ...overrides,
  }
}

describe('formatCompactCount', () => {
  it('shortens millions and keeps smaller counts exact', () => {
    expect(formatCompactCount(1_414_155)).toBe('1.41 M')
    expect(formatCompactCount(12_345_678)).toBe('12.3 M')
    expect(formatCompactCount(231_404)).toBe('231,404')
    expect(formatCompactCount(7)).toBe('7')
  })
})

describe('datasetSummaryText', () => {
  it('names the platform and its counts', () => {
    expect(
      datasetSummaryText({
        platform: 'xenium',
        elementCount: 1_414_155,
        elementNoun: 'cells',
        geneCount: 5001,
        channelCount: 4,
      }),
    ).toBe('Xenium · 1.41 M cells · 5,001 genes')
    expect(
      datasetSummaryText({
        platform: 'visium-hd',
        elementCount: 1,
        elementNoun: 'bins',
        geneCount: null,
        channelCount: 0,
      }),
    ).toBe('Visium HD · 1 bin')
  })

  it('counts channels for an image', () => {
    expect(
      datasetSummaryText({
        platform: 'image',
        elementCount: 0,
        elementNoun: 'cells',
        geneCount: null,
        channelCount: 61,
      }),
    ).toBe('Image · 61 channels')
  })
})

describe('toolOptions', () => {
  it('says why selections and measuring are off before a dataset is ready', () => {
    const options = toolOptions({
      datasetReady: false,
      canDrawRoi: false,
      magicLens: { enabled: false },
    })

    expect(
      options.map((option) => [option.tool, option.disabled, option.reason]),
    ).toEqual([
      ['pan', false, undefined],
      ['box', true, 'Open a dataset'],
      ['lasso', true, 'Open a dataset'],
      ['measure', true, 'Open a dataset'],
      ['magic-lens', true, 'Open a dataset'],
    ])
  })

  it('leaves out the Magic Lens where the platform has none', () => {
    const options = toolOptions({
      datasetReady: true,
      canDrawRoi: false,
      magicLens: null,
    })

    expect(options.map((option) => option.tool)).toEqual([
      'pan',
      'box',
      'lasso',
      'measure',
    ])
    expect(options.find((option) => option.tool === 'box')?.reason).toBe(
      'The dataset is still preparing',
    )
  })
})

describe('useTopBarModel', () => {
  it('summarises the open dataset, or the one being opened', () => {
    const ready = renderHook(() => useTopBarModel(input()))
    const loading = renderHook(() =>
      useTopBarModel(input({ loadingDatasetName: 'next-run' })),
    )
    const empty = renderHook(() => useTopBarModel(input({ datasetName: null })))

    expect(ready.result.current.summary).toEqual({
      status: 'ready',
      text: 'Xenium · 1.41 M cells · 5,001 genes',
    })
    expect(loading.result.current.summary).toEqual({
      status: 'loading',
      name: 'next-run',
    })
    expect(empty.result.current.summary).toEqual({ status: 'empty' })
  })

  it('starts each tool through its workflow', () => {
    const options = input()
    const { result } = renderHook(() => useTopBarModel(options))

    result.current.tools.onSelect('box')
    result.current.tools.onSelect('lasso')
    result.current.tools.onSelect('measure')

    expect(options.onRoiModeChange).toHaveBeenNthCalledWith(1, 'box')
    expect(options.onRoiModeChange).toHaveBeenNthCalledWith(2, 'lasso')
    expect(options.onMeasureEnabledChange).toHaveBeenCalledWith(true)
  })

  it('turns the Magic Lens to the cursor scope first', () => {
    const options = input({ magicLensScope: 'viewport' })
    const { result } = renderHook(() => useTopBarModel(options))

    result.current.tools.onSelect('magic-lens')

    expect(options.onMagicLensScopeChange).toHaveBeenCalledWith('cursor')
    expect(options.onMagicLensCursorActiveChange).toHaveBeenCalledWith(true)
  })

  it('returns to Pan, and ignores the active tool and disabled tools', () => {
    const options = input({ activeTool: 'measure', canDrawRoi: false })
    const { result } = renderHook(() => useTopBarModel(options))

    result.current.tools.onSelect('measure')
    result.current.tools.onSelect('box')
    result.current.tools.onSelect('pan')

    expect(options.onMeasureEnabledChange).not.toHaveBeenCalled()
    expect(options.onRoiModeChange).not.toHaveBeenCalled()
    expect(options.onReturnToPan).toHaveBeenCalledTimes(1)
  })

  it('logs debug info changes', () => {
    const options = input()
    const { result } = renderHook(() => useTopBarModel(options))

    result.current.onDebugModeChange(true)

    expect(options.setDebugMode).toHaveBeenCalledWith(true)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Debug info shown')
  })
})
