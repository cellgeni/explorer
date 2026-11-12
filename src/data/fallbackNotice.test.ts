import { describe, expect, it, vi } from 'vitest'
import { notifyFallback, type FallbackNotice } from './fallbackNotice'

describe('notifyFallback', () => {
  it('passes the notice to the notifier unchanged', () => {
    const onFallback = vi.fn()
    const notice: FallbackNotice = {
      source: 'cells.parquet',
      message: 'Range requests are not supported; reading the whole file.',
      action: 'Enable range requests on the host.',
      detail: 'HTTP 200 for a ranged GET',
      coalesceKey: 'range:cells.parquet',
    }

    notifyFallback(onFallback, notice)

    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onFallback.mock.calls[0]?.[0]).toBe(notice)
  })

  it('sends each notice once, in call order', () => {
    const received: string[] = []
    const onFallback = (notice: FallbackNotice) => {
      received.push(notice.source)
    }

    notifyFallback(onFallback, { source: 'transcripts', message: 'first' })
    notifyFallback(onFallback, { source: 'boundaries', message: 'second' })

    expect(received).toEqual(['transcripts', 'boundaries'])
  })

  it('does nothing when no notifier is set', () => {
    expect(() => {
      notifyFallback(undefined, { source: 'image', message: 'Using a lower level.' })
    }).not.toThrow()
  })
})
