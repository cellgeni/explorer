import { describe, expect, it } from 'vitest'
import { sharedLoad, sharedLoadSlot } from './sharedLoad'

function deferredLoad() {
  let resolve: (value: string) => void = () => {}
  let loadSignal: AbortSignal | undefined
  const load = (signal: AbortSignal) => {
    loadSignal = signal
    return new Promise<string>((resolvePromise, reject) => {
      resolve = resolvePromise
      signal.addEventListener('abort', () => {
        reject(new DOMException('Load aborted.', 'AbortError'))
      })
    })
  }

  return {
    load,
    resolve: (value: string) => {
      resolve(value)
    },
    signal: () => loadSignal,
  }
}

describe('sharedLoad', () => {
  it('keeps loading for the other callers when one cancels (15.5-E)', async () => {
    const deferred = deferredLoad()
    const shared = sharedLoad(deferred.load)
    const first = new AbortController()
    const firstWait = shared.wait(first.signal)
    const secondWait = shared.wait(new AbortController().signal)

    first.abort()

    await expect(firstWait).rejects.toMatchObject({ name: 'AbortError' })
    expect(deferred.signal()?.aborted).toBe(false)
    expect(shared.aborted).toBe(false)
    deferred.resolve('matrix')
    await expect(secondWait).resolves.toBe('matrix')
  })

  it('cancels the load once every caller has cancelled', async () => {
    const deferred = deferredLoad()
    const shared = sharedLoad(deferred.load)
    shared.promise.catch(() => undefined)
    const first = new AbortController()
    const second = new AbortController()
    const waits = [shared.wait(first.signal), shared.wait(second.signal)]

    first.abort()
    await expect(waits[0]).rejects.toMatchObject({ name: 'AbortError' })
    expect(shared.aborted).toBe(false)
    second.abort()
    await expect(waits[1]).rejects.toMatchObject({ name: 'AbortError' })

    expect(shared.aborted).toBe(true)
    expect(deferred.signal()?.aborted).toBe(true)
  })

  it('keeps loading while a caller without a signal waits', async () => {
    const deferred = deferredLoad()
    const shared = sharedLoad(deferred.load)
    const cancelled = new AbortController()
    const cancelledWait = shared.wait(cancelled.signal)
    const unsignalledWait = shared.wait(undefined)

    cancelled.abort()
    await expect(cancelledWait).rejects.toMatchObject({ name: 'AbortError' })
    expect(shared.aborted).toBe(false)
    deferred.resolve('probe')
    await expect(unsignalledWait).resolves.toBe('probe')
  })

  it('does not cancel a load that has already finished', async () => {
    const deferred = deferredLoad()
    const shared = sharedLoad(deferred.load)
    const controller = new AbortController()
    const wait = shared.wait(controller.signal)

    deferred.resolve('done')
    await expect(wait).resolves.toBe('done')
    controller.abort()

    expect(shared.aborted).toBe(false)
  })
})

describe('sharedLoadSlot', () => {
  it('keeps one load for later callers', async () => {
    let loads = 0
    const slot = sharedLoadSlot(() => {
      loads += 1
      return Promise.resolve(`read ${loads}`)
    })

    expect(slot.promise).toBeNull()
    await expect(slot.wait(undefined)).resolves.toBe('read 1')
    await expect(slot.wait(new AbortController().signal)).resolves.toBe('read 1')
    expect(loads).toBe(1)
    slot.clear()
    await expect(slot.wait(undefined)).resolves.toBe('read 2')
  })

  it('starts the load again after every caller cancelled it', async () => {
    const first = deferredLoad()
    let started = 0
    const slot = sharedLoadSlot((signal) => {
      started += 1
      return started === 1 ? first.load(signal) : Promise.resolve('again')
    })
    const controller = new AbortController()
    const wait = slot.wait(controller.signal)

    controller.abort()
    await expect(wait).rejects.toMatchObject({ name: 'AbortError' })
    expect(first.signal()?.aborted).toBe(true)
    await expect(slot.wait(undefined)).resolves.toBe('again')
  })

  it('forgets a load that failed', async () => {
    let loads = 0
    const slot = sharedLoadSlot(() => {
      loads += 1
      return loads === 1 ? Promise.reject(new Error('offline')) : Promise.resolve('read')
    })

    await expect(slot.wait(undefined)).rejects.toThrow('offline')
    expect(slot.promise).toBeNull()
    await expect(slot.wait(undefined)).resolves.toBe('read')
  })
})
