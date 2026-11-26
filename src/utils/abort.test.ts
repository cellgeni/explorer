import { describe, expect, it } from 'vitest'
import { abortError, fetcherWithSignal, isAbortError, throwIfAborted } from './abort'

function aborted(reason?: unknown): AbortSignal {
  const controller = new AbortController()
  controller.abort(reason)
  return controller.signal
}

describe('abortError', () => {
  it('is the signal reason when that is an Error', () => {
    const reason = new Error('Dataset closed.')

    expect(abortError(aborted(reason))).toBe(reason)
  })

  it('is the reason the platform gives a plain abort', () => {
    const signal = aborted()

    expect(abortError(signal)).toBe(signal.reason)
    expect(abortError(signal)).toMatchObject({ name: 'AbortError' })
  })

  it('is an Error named AbortError when the reason is not an Error', () => {
    for (const signal of [aborted('user navigated away'), undefined]) {
      const error = abortError(signal)

      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ name: 'AbortError' })
      expect(isAbortError(error)).toBe(true)
    }
  })
})

describe('throwIfAborted', () => {
  it('does nothing without a signal or while the signal is live', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow()
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow()
  })

  it('throws the abort error once the signal has aborted', () => {
    const reason = new Error('Dataset closed.')

    expect(() => throwIfAborted(aborted(reason))).toThrow(reason)
    expect(() => throwIfAborted(aborted())).toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    )
    expect(() => throwIfAborted(aborted('stop'))).toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    )
  })
})

describe('isAbortError', () => {
  it('is true for an Error named AbortError', () => {
    const error = new Error('stopped')
    error.name = 'AbortError'

    expect(isAbortError(error)).toBe(true)
    expect(isAbortError(aborted().reason)).toBe(true)
  })

  it('is false for anything else', () => {
    expect(isAbortError(new Error('AbortError'))).toBe(false)
    expect(isAbortError({ name: 'AbortError' })).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })
})

describe('fetcherWithSignal', () => {
  it("sends each request with the signal, and the request's own", () => {
    const signals: (AbortSignal | null | undefined)[] = []
    const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal)
      return Promise.resolve(new Response())
    }) as typeof fetch
    const read = new AbortController()
    const own = new AbortController()
    const request = new AbortController()
    const withSignal = fetcherWithSignal(fetcher, read.signal)

    void withSignal('https://example.test/a')
    void withSignal('https://example.test/b', { signal: own.signal })
    void withSignal(new Request('https://example.test/c', { signal: request.signal }))

    expect(signals[0]).toBe(read.signal)
    own.abort()
    request.abort()
    expect(signals.map((signal) => signal?.aborted)).toEqual([false, true, true])
    read.abort()
    expect(signals.map((signal) => signal?.aborted)).toEqual([true, true, true])
  })
})
