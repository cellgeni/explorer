import { describe, expect, it, vi } from 'vitest'
import {
  abortActiveRequest,
  appendDebugLogEntry,
  clearTimeoutRef,
  createDebugLogEntry,
  createLoadingTasks,
  downloadTextFile,
  formatElapsed,
  isAbortError,
  shortDatasetLabel,
  shortIdentifier,
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
        cellDetailState: { status: 'loading', cellId: 'abcdefghijklmnop' },
        roiGeneStatsState: { status: 'loading', cellCount: 1234 },
        isRoiGeneViewportWarmupLoading: true,
        autoContrastChannelCount: 2,
      }),
    )

    expect(tasks.map((task) => task.id)).toEqual([
      'dataset',
      'gene-expression',
      'cell-details',
      'roi-gene-warmup',
      'roi-genes',
      'auto-contrast',
    ])
    expect(tasks[0]).toMatchObject({ detail: 'output' })
    expect(tasks[1]).toMatchObject({ detail: 'Actb, Gad1' })
    expect(tasks[4]).toMatchObject({ detail: '1,234 cells' })
    expect(tasks[5]).toMatchObject({ detail: '2 channels' })
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
