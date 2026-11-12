import { describe, expect, it, vi } from 'vitest'
import { abortable } from './abortable'

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

describe('abortable', () => {
  it('returns the promise itself when there is no signal', () => {
    const promise = Promise.resolve('chunk')

    expect(abortable(promise, undefined)).toBe(promise)
  })

  it('settles with the promise while the signal is not aborted', async () => {
    const signal = new AbortController().signal
    const failure = new Error('fetch failed')

    await expect(abortable(Promise.resolve(42), signal)).resolves.toBe(42)
    await expect(abortable(Promise.reject(failure), signal)).rejects.toBe(failure)
  })

  it('rejects at once with an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const work = deferred<string>()

    await expect(abortable(work.promise, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('rejects as soon as the signal aborts and leaves the work running', async () => {
    const controller = new AbortController()
    const work = deferred<string>()
    const wait = abortable(work.promise, controller.signal)

    controller.abort()
    await expect(wait).rejects.toMatchObject({ name: 'AbortError' })

    // Another caller sharing the work still gets its result.
    work.resolve('matrix')
    await expect(work.promise).resolves.toBe('matrix')
  })

  it('rejects with the abort reason when it is an Error', async () => {
    const controller = new AbortController()
    const reason = new Error('Dataset closed.')
    const wait = abortable(deferred<void>().promise, controller.signal)

    controller.abort(reason)
    await expect(wait).rejects.toBe(reason)
  })

  it('uses an AbortError when the abort reason is not an Error', async () => {
    const controller = new AbortController()
    controller.abort('user navigated away')

    const rejection = abortable(Promise.resolve(1), controller.signal)

    await expect(rejection).rejects.toBeInstanceOf(DOMException)
    await expect(rejection).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('removes its abort listener once the promise settles', async () => {
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')

    await expect(abortable(Promise.resolve('done'), controller.signal)).resolves.toBe(
      'done',
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
