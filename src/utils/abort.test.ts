import { describe, expect, it } from 'vitest'
import { abortError, isAbortError, throwIfAborted } from './abort'

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
