import { describe, expect, it, vi } from 'vitest'
import { ScreenshotImageError } from './screenshotImage'
import type { ScreenshotInclude } from './screenshotOverlay'
import type { ScreenshotSnapshot } from './screenshotRun'
import {
  SCREENSHOT_SETTLE_MS,
  ScreenshotRunner,
  screenshotProgressText,
  screenshotStageText,
  type ScreenshotRunState,
} from './screenshotRunner'

const include: ScreenshotInclude = {
  scaleBar: true,
  legend: true,
  axes: false,
  selections: true,
}
const options = { scale: 2 as const, dpi: 300, include, background: 'canvas' as const }
const file = {
  fileName: 'run-screenshot.png',
  software: 'Spatial Omics Explorer',
  source: null,
  zPlane: null,
}

function snapshot(viewChangedAt = -1000): ScreenshotSnapshot {
  return {
    viewState: { target: [0, 0, 0], zoom: 0, minZoom: -10, maxZoom: 10 },
    viewport: { width: 100, height: 100 },
    image: { channels: [], flatImage: null, opacity: 1 },
    layers: null,
    overlays: { scaleBar: null, axes: null, legend: [], selections: [] },
    cells: null,
    unitLabel: 'µm',
    maxConcurrentTileRequests: 4,
    viewChangedAt,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function states(runner: ScreenshotRunner): ScreenshotRunState[] {
  const seen: ScreenshotRunState[] = []
  runner.subscribe(() => {
    seen.push(runner.getState())
  })
  return seen
}

describe('screenshot runner (plan 27, task G)', () => {
  it('draws the connected view and saves the PNG', async () => {
    const blob = new Blob(['png'])
    const draw = vi.fn().mockResolvedValue(blob)
    const save = vi.fn()
    const runner = new ScreenshotRunner({ draw, save, now: () => 0 })
    const view = snapshot()
    runner.connect(() => view)
    const seen = states(runner)

    runner.start(options, file)
    await vi.waitFor(() => {
      expect(runner.getState()).toEqual({
        status: 'saved',
        fileName: 'run-screenshot.png',
      })
    })

    expect(draw).toHaveBeenCalledWith(view, options, file, expect.anything())
    expect(save).toHaveBeenCalledWith('run-screenshot.png', blob)
    expect(seen[0]).toEqual({ status: 'running', progress: null })
  })

  it('takes one at a time (D12)', async () => {
    const drawing = deferred<Blob>()
    const draw = vi.fn().mockReturnValue(drawing.promise)
    const runner = new ScreenshotRunner({ draw, save: vi.fn(), now: () => 0 })
    runner.connect(() => snapshot())

    runner.start(options, file)
    runner.start(options, file)
    await vi.waitFor(() => {
      expect(draw).toHaveBeenCalledOnce()
    })
    drawing.resolve(new Blob())
  })

  it('waits for the view to keep still before taking it', async () => {
    let now = 50
    const sleeps: number[] = []
    const draw = vi.fn().mockResolvedValue(new Blob())
    const runner = new ScreenshotRunner({
      draw,
      save: vi.fn(),
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms)
        now += ms
        return Promise.resolve()
      },
    })
    runner.connect(() => snapshot(0))

    runner.start(options, file)
    await vi.waitFor(() => {
      expect(draw).toHaveBeenCalled()
    })

    expect(sleeps).toEqual([SCREENSHOT_SETTLE_MS - 50])
  })

  it('cancels, and saves nothing', async () => {
    const drawing = deferred<Blob>()
    let signal: AbortSignal | undefined
    const draw = vi.fn((_view, _options, _file, run: { signal: AbortSignal }) => {
      signal = run.signal
      return drawing.promise
    })
    const save = vi.fn()
    const runner = new ScreenshotRunner({ draw, save, now: () => 0 })
    runner.connect(() => snapshot())

    runner.start(options, file)
    await vi.waitFor(() => {
      expect(draw).toHaveBeenCalled()
    })
    runner.cancel()
    drawing.resolve(new Blob())
    await Promise.resolve()

    expect(signal?.aborted).toBe(true)
    expect(runner.getState()).toEqual({ status: 'idle' })
    expect(save).not.toHaveBeenCalled()
  })

  it('offers Retry for a tile it could not read, and runs again', async () => {
    const draw = vi
      .fn()
      .mockRejectedValueOnce(new ScreenshotImageError('DAPI', new Error('503')))
      .mockResolvedValueOnce(new Blob())
    const runner = new ScreenshotRunner({ draw, save: vi.fn(), now: () => 0 })
    runner.connect(() => snapshot())

    runner.start(options, file)
    await vi.waitFor(() => {
      expect(runner.getState()).toEqual({
        status: 'error',
        message: 'A tile of DAPI could not be read: 503',
        retryable: true,
      })
    })

    runner.retry()
    await vi.waitFor(() => {
      expect(runner.getState().status).toBe('saved')
    })
    expect(draw).toHaveBeenCalledTimes(2)
  })

  it('fails without Retry for other errors, and when there is no view', async () => {
    const draw = vi
      .fn()
      .mockRejectedValue(new Error('This browser cannot draw a canvas this large.'))
    const runner = new ScreenshotRunner({ draw, save: vi.fn(), now: () => 0 })

    runner.start(options, file)
    await vi.waitFor(() => {
      expect(runner.getState()).toEqual({
        status: 'error',
        message: 'There is no view to save.',
        retryable: false,
      })
    })

    runner.connect(() => snapshot())
    runner.start(options, file)
    await vi.waitFor(() => {
      expect(runner.getState()).toMatchObject({ status: 'error', retryable: false })
    })
    runner.dismiss()
    expect(runner.getState()).toEqual({ status: 'idle' })
  })

  it('cancels when the viewer disconnects', async () => {
    const drawing = deferred<Blob>()
    const runner = new ScreenshotRunner({
      draw: vi.fn().mockReturnValue(drawing.promise),
      save: vi.fn(),
      now: () => 0,
    })
    const disconnect = runner.connect(() => snapshot())

    runner.start(options, file)
    disconnect()

    expect(runner.connected).toBe(false)
    expect(runner.getState()).toEqual({ status: 'idle' })
  })

  it('says how far it has got', () => {
    expect(screenshotStageText({ stage: 'cells', done: 3, total: 4 })).toBe(
      'Drawing cells',
    )
    expect(screenshotProgressText(null)).toBe('Starting')
    expect(screenshotProgressText({ stage: 'image', done: 30, total: 120 })).toBe(
      'Reading image tiles · 25%',
    )
    expect(screenshotProgressText({ stage: 'writing', done: 119, total: 120 })).toBe(
      'Writing the PNG · 99%',
    )
  })
})
