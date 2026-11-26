// What an aborted signal stands for. Its reason is the error when it is one
// (the default is a DOMException named AbortError); any other reason becomes
// an Error named AbortError, so callers can tell an abort from a failure by
// name alone.
export function abortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortError(signal)
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

// `fetcher`, sending every request with `signal` too, so cancelling a read
// that makes many requests, such as a dataset's first read, ends them all. A
// request's own signal still applies.
export function fetcherWithSignal(
  fetcher: typeof fetch,
  signal: AbortSignal,
): typeof fetch {
  return (input, init) => {
    const own = init?.signal ?? (input instanceof Request ? input.signal : undefined)

    return fetcher(input, {
      ...init,
      signal: own === undefined || own === null ? signal : AbortSignal.any([own, signal]),
    })
  }
}
