import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  datasetFacts,
  useDatasetInfoModel,
  type DatasetFactsInput,
  type DatasetInfoModelInput,
} from './datasetInfoModel'

function input(overrides: Partial<DatasetInfoModelInput> = {}): DatasetInfoModelInput {
  return {
    activeErrors: [],
    appendDebugEvent: vi.fn(),
    boundaryCellLimit: 50_000,
    cellFeatureMatrixCapabilityState: { status: 'idle' },
    datasetAbout: null,
    datasetFactsInput: null,
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

describe('datasetFacts', () => {
  const xenium: DatasetFactsInput = {
    platform: 'xenium',
    url: 'https://example.test/output',
    elementNoun: 'cells',
    elementCount: 1_414_155,
    geneCount: 5001,
    channelCount: 4,
    zPlaneCount: 1,
    hasFlatImage: false,
    micrometersPerPixel: 0.2125,
  }

  it('lists the platform, exact counts, image, pixel size and address', () => {
    expect(datasetFacts(xenium)).toEqual([
      { label: 'Platform', value: 'Xenium' },
      { label: 'Cells', value: '1,414,155' },
      { label: 'Genes', value: '5,001' },
      { label: 'Image', value: '4 channels' },
      { label: 'Pixel size', value: '0.2125 µm/px' },
      { label: 'Address', value: 'https://example.test/output' },
    ])
  })

  it('describes spots with a tissue image, and images by their planes', () => {
    expect(
      datasetFacts({
        ...xenium,
        platform: 'visium',
        elementNoun: 'spots',
        elementCount: 370,
        channelCount: 0,
        hasFlatImage: true,
        micrometersPerPixel: undefined,
      }).map((fact) => fact.value),
    ).toEqual(['Visium', '370', '5,001', 'Tissue image', 'https://example.test/output'])
    expect(
      datasetFacts({
        ...xenium,
        platform: 'image',
        geneCount: null,
        channelCount: 1,
        zPlaneCount: 15,
      }).map((fact) => fact.label),
    ).toEqual(['Platform', 'Image', 'Pixel size', 'Address'])
    expect(datasetFacts({ ...xenium, channelCount: 1, zPlaneCount: 15 })[3]?.value).toBe(
      '1 channel · 15 z planes',
    )
  })

  it('is empty in the model until a dataset is ready', () => {
    const empty = renderHook(() => useDatasetInfoModel(input()))
    const ready = renderHook(() =>
      useDatasetInfoModel(input({ datasetFactsInput: xenium })),
    )

    expect(empty.result.current.facts).toEqual([])
    expect(ready.result.current.facts[0]).toEqual({ label: 'Platform', value: 'Xenium' })
  })
})
