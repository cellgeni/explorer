import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDatasetInfoModel, type DatasetInfoModelInput } from './datasetInfoModel'

function input(overrides: Partial<DatasetInfoModelInput> = {}): DatasetInfoModelInput {
  return {
    activeErrors: [],
    appendDebugEvent: vi.fn(),
    boundaryCellLimit: 50_000,
    cellFeatureMatrixCapabilityState: { status: 'idle' },
    datasetAbout: null,
    datasetUrl: 'https://example.test/output',
    debugLog: [],
    debugMode: false,
    diagnosticsState: { status: 'idle' },
    fallbackNotices: [],
    handleDatasetSubmit: vi.fn(),
    handleDownloadDiagnostics: vi.fn(),
    handleRunDatasetDiagnostics: vi.fn(async () => {}),
    handleSpatialDataSelectionChange: vi.fn(),
    handleVisiumHdBinSizeChange: vi.fn(async () => {}),
    handleVisiumImageChange: vi.fn(),
    handleVisiumViewChange: vi.fn(),
    isDatasetLoaded: false,
    isLoading: false,
    isVisiumHdDataset: false,
    performanceBudget: {
      profile: 'balanced',
      overviewRenderCellLimit: 150_000,
      boundaryCellLimit: 50_000,
      maxConcurrentTileRequests: 4,
      tileCacheMaxTiles: 120,
      telemetryEventLimit: 120,
    },
    setBoundaryCellLimit: vi.fn(),
    setDatasetUrl: vi.fn(),
    setDebugLog: vi.fn(),
    setShouldLoadMorphology: vi.fn(),
    shouldLoadMorphology: true,
    spatialDataControlState: { status: 'idle' },
    visiumControlState: { status: 'idle' },
    visiumHdControlState: { status: 'idle' },
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useDatasetInfoModel', () => {
  it('normalizes dataset controls before updating app state', () => {
    const options = input()
    const { result } = renderHook(() => useDatasetInfoModel(options))

    result.current.open.onDatasetUrlChange('https://example.test/next')
    result.current.open.onShouldLoadMorphologyChange(false)
    result.current.open.onBoundaryCellLimitChange(100_001)

    expect(options.setDatasetUrl).toHaveBeenCalledWith('https://example.test/next')
    expect(options.setShouldLoadMorphology).toHaveBeenCalledWith(false)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Morphology image disabled')
    expect(options.setBoundaryCellLimit).toHaveBeenCalledWith(100_000)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Boundary limit: 100,000', {
      coalesceKey: 'boundary-limit',
    })
    expect(result.current.open.morphologyLabel).toBe('Morphology image')
    expect(result.current.open.boundaryLimitDisabled).toBe(false)
  })

  it('names the tissue image and fixes the boundary limit on Visium HD', () => {
    const options = input({ isVisiumHdDataset: true })
    const { result } = renderHook(() => useDatasetInfoModel(options))

    result.current.viewOptions.visiumHd.onBinSizeChange(8)

    expect(result.current.open.morphologyLabel).toBe('Tissue image')
    expect(result.current.open.boundaryLimitDisabled).toBe(true)
    expect(options.handleVisiumHdBinSizeChange).toHaveBeenCalledWith(8)
  })

  it('disables the Visium and SpatialData choices while loading', () => {
    const { result } = renderHook(() => useDatasetInfoModel(input({ isLoading: true })))

    expect(result.current.viewOptions.visium.disabled).toBe(true)
    expect(result.current.viewOptions.spatialData.disabled).toBe(true)
  })

  it('runs diagnostics only with an address and clears the log', () => {
    const options = input({ datasetUrl: '  ' })
    const { result } = renderHook(() => useDatasetInfoModel(options))

    result.current.diagnostics.onRun()
    result.current.diagnostics.onClearLog()

    expect(result.current.diagnostics.canRun).toBe(false)
    expect(options.handleRunDatasetDiagnostics).toHaveBeenCalledTimes(1)
    expect(options.setDebugLog).toHaveBeenCalledWith([])
  })

  it('shows the layer stack only in debug mode', () => {
    const { result, rerender } = renderHook(
      (props: { readonly debugMode: boolean }) =>
        useDatasetInfoModel(input({ debugMode: props.debugMode })),
      { initialProps: { debugMode: false } },
    )

    expect(result.current.diagnostics.layerStack).toBeNull()

    rerender({ debugMode: true })

    expect(result.current.diagnostics.layerStack).toMatchObject({
      performanceBudget: { profile: 'balanced' },
    })
  })

  it('copies the address and says whether the clipboard took it', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const options = input({ isDatasetLoaded: true })
    const { result } = renderHook(() => useDatasetInfoModel(options))

    expect(result.current.share.canCopyLink).toBe(true)
    await expect(result.current.share.onCopyLink()).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Link copied')

    writeText.mockRejectedValueOnce(new Error('denied'))
    await expect(result.current.share.onCopyLink()).resolves.toBe(false)
  })
})
