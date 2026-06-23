import { describe, expect, it, vi } from 'vitest'
import {
  abortActiveRequest,
  appendDebugLogEntry,
  appendFallbackNoticeEntry,
  clearTimeoutRef,
  createDebugLogEntry,
  createFallbackNoticeEntry,
  createLoadingTasks,
  downloadTextFile,
  formatElapsed,
  invalidateLatestRequest,
  isAbortError,
  shortDatasetLabel,
  shortIdentifier,
  startLatestRequest,
  throwAbortError,
} from './appRuntimeModel'

type LoadingInputs = Parameters<typeof createLoadingTasks>[0]

function loadingInputs(overrides: Partial<LoadingInputs> = {}): LoadingInputs {
  return {
    loadState: { status: 'idle' },
    datasetWarmupState: { status: 'idle' },
    diagnosticsState: { status: 'idle' },
    genePanelState: { status: 'idle' },
    morphologyState: { status: 'idle' },
    customMorphologyLayerState: { status: 'idle' },
    annotationGroupState: { status: 'idle' },
    boundaryState: { status: 'idle' },
    geneExpressionState: { status: 'idle' },
    transcriptCapabilityState: { status: 'idle' },
    transcriptLayerState: { status: 'idle' },
    magicLensState: { status: 'idle' },
    annotationState: { status: 'idle' },
    analysisEmbeddingState: { status: 'idle' },
    cellDetailState: { status: 'idle' },
    cellTranscriptDistributionState: { status: 'idle' },
    roiState: { status: 'idle' },
    roiGeneStatsState: { status: 'idle' },
    roiTranscriptExportState: { status: 'idle' },
    isRoiGeneViewportWarmupLoading: false,
    autoContrastChannelCount: 0,
    ...overrides,
  }
}

describe('appRuntimeModel', () => {
  it('builds loading tasks from active feature states', () => {
    const tasks = createLoadingTasks(
      loadingInputs({
        loadState: { status: 'loading', url: 'https://example.test/output' },
        geneExpressionState: {
          status: 'loading',
          genes: ['Actb', 'Gad1'],
        },
        visiumHdExpressionProjectionState: { status: 'loading' },
        cellDetailState: { status: 'loading', cellId: 'abcdefghijklmnop' },
        roiGeneStatsState: { status: 'loading', cellCount: 1234 },
        isRoiGeneViewportWarmupLoading: true,
        autoContrastChannelCount: 2,
      }),
    )

    expect(tasks.map((task) => task.id)).toEqual([
      'dataset',
      'gene-expression',
      'visium-hd-expression-projection',
      'cell-details',
      'roi-gene-warmup',
      'roi-genes',
      'auto-contrast',
    ])
    expect(tasks[0]).toMatchObject({ detail: 'output' })
    expect(tasks[1]).toMatchObject({ detail: 'Actb, Gad1' })
    expect(tasks[5]).toMatchObject({ detail: '1,234 cells' })
    expect(tasks[6]).toMatchObject({ detail: '2 channels' })
  })

  it('coalesces debug log entries and enforces the log limit', () => {
    const original = createDebugLogEntry(1, 'Loading', { coalesceKey: 'dataset' })
    const replacement = createDebugLogEntry(2, 'Ready', { coalesceKey: 'dataset' })

    expect(appendDebugLogEntry([original], replacement)).toEqual([replacement])

    const entries = Array.from({ length: 40 }, (_, index) =>
      createDebugLogEntry(index, `Entry ${index}`),
    )

    expect(entries.reduce(appendDebugLogEntry, [])).toHaveLength(32)
  })

  it('coalesces fallback notices and enforces the notice limit', () => {
    const original = createFallbackNoticeEntry(1, {
      source: 'Dataset overview',
      message: 'Loading with fallback A.',
      coalesceKey: 'dataset',
    })
    const replacement = createFallbackNoticeEntry(2, {
      source: 'Dataset overview',
      message: 'Loading with fallback B.',
      coalesceKey: 'dataset',
    })

    expect(appendFallbackNoticeEntry([original], replacement)).toEqual([replacement])

    const entries = Array.from({ length: 20 }, (_, index) =>
      createFallbackNoticeEntry(index, {
        source: 'Source',
        message: `Fallback ${index}`,
      }),
    )

    expect(entries.reduce(appendFallbackNoticeEntry, [])).toHaveLength(16)
  })

  it('formats elapsed time and short labels', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_500)

    expect(formatElapsed(1_000)).toBe('1.5 s')
    expect(shortDatasetLabel('https://example.test/path/to/output-XETG00155')).toBe(
      'output-XETG00155',
    )
    expect(shortIdentifier('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghij...stuvwxyz')
    expect(shortIdentifier('short-id')).toBe('short-id')
  })

  it('aborts and clears browser resources', () => {
    const abortController = new AbortController()
    const timeout = window.setTimeout(() => undefined, 100)
    const abortRef = { current: abortController }
    const timeoutRef = { current: timeout }

    abortActiveRequest(abortRef)
    clearTimeoutRef(timeoutRef)

    expect(abortController.signal.aborted).toBe(true)
    expect(abortRef.current).toBeNull()
    expect(timeoutRef.current).toBeNull()
  })

  it('starts latest requests and clears only the active controller', () => {
    const firstAbortController = new AbortController()
    const abortRef = { current: firstAbortController }
    const requestIdRef = { current: 4 }

    const firstRequest = startLatestRequest({ abortRef, requestIdRef })

    expect(firstAbortController.signal.aborted).toBe(true)
    expect(firstRequest.requestId).toBe(5)
    expect(firstRequest.signal).toBe(firstRequest.abortController.signal)
    expect(firstRequest.isCurrent()).toBe(true)
    expect(abortRef.current).toBe(firstRequest.abortController)

    const secondRequest = startLatestRequest({ abortRef, requestIdRef })

    expect(firstRequest.abortController.signal.aborted).toBe(true)
    expect(firstRequest.isCurrent()).toBe(false)
    expect(secondRequest.requestId).toBe(6)
    expect(secondRequest.isCurrent()).toBe(true)

    firstRequest.complete()
    expect(abortRef.current).toBe(secondRequest.abortController)

    secondRequest.complete()
    expect(abortRef.current).toBeNull()
  })

  it('invalidates latest requests', () => {
    const abortController = new AbortController()
    const abortRef = { current: abortController }
    const requestIdRef = { current: 2 }

    expect(invalidateLatestRequest({ abortRef, requestIdRef })).toBe(3)
    expect(abortController.signal.aborted).toBe(true)
    expect(abortRef.current).toBeNull()
    expect(requestIdRef.current).toBe(3)
  })

  it('downloads text through a transient link', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    downloadTextFile('roi.csv', 'cell_id\n')

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test')
  })

  it('creates and detects abort errors', () => {
    expect(() => throwAbortError('stop')).toThrow('stop')

    try {
      throwAbortError('stop')
    } catch (error) {
      expect(isAbortError(error)).toBe(true)
    }
  })
})
