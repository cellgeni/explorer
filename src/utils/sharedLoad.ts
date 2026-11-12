import { abortable } from './abortable'

export interface SharedLoad<T> {
  readonly promise: Promise<T>
  // True once every caller stopped waiting and the load was cancelled. A
  // cache then starts a new load for the next caller.
  readonly aborted: boolean
  wait(signal: AbortSignal | undefined): Promise<T>
}

// A load that several callers share. It runs under its own signal, which
// aborts only once every caller waiting on it has aborted, so one caller's
// cancel no longer rejects the others with its AbortError (15.5-E). A caller
// without a signal keeps the load running.
export function sharedLoad<T>(load: (signal: AbortSignal) => Promise<T>): SharedLoad<T> {
  const controller = new AbortController()
  const promise = load(controller.signal)
  let waiting = 0
  let settled = false

  promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )

  return {
    promise,
    get aborted() {
      return controller.signal.aborted
    },
    wait(signal) {
      waiting += 1
      let released = false
      const release = () => {
        if (released) {
          return
        }

        released = true
        waiting -= 1

        if (waiting === 0 && !settled) {
          controller.abort()
        }
      }
      const result = abortable(promise, signal)

      result.then(release, release)
      return result
    },
  }
}

// Waits on the cached load for `key`, starting one when there is none or the
// last one was cancelled. A failed load leaves the cache, so the next caller
// tries again.
export function waitForSharedLoad<Key, T>(
  cache: Map<Key, SharedLoad<T>>,
  key: Key,
  load: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  let entry = cache.get(key)

  if (entry === undefined || entry.aborted) {
    const next = sharedLoad(load)

    next.promise.catch(() => {
      if (cache.get(key) === next) {
        cache.delete(key)
      }
    })
    cache.set(key, next)
    entry = next
  }

  return entry.wait(signal)
}
