export type RangeSupportFetcher = typeof fetch

export interface AssertHttpRangeSupportOptions {
  readonly fetcher?: RangeSupportFetcher
  readonly label?: string
  readonly signal?: AbortSignal
}

const RANGE_PROBE_HEADER = 'bytes=0-0'
const rangeSupportCache = new Map<string, Promise<void>>()

export async function assertHttpRangeSupport(
  url: string,
  options: AssertHttpRangeSupportOptions = {},
): Promise<void> {
  throwIfAborted(options.signal)

  if (options.fetcher !== undefined) {
    await assertHttpRangeSupportUncached(url, options)
    return
  }

  const cacheKey = rangeSupportCacheKey(url, options.label)
  const cached = rangeSupportCache.get(cacheKey)

  if (cached !== undefined) {
    await cached
    throwIfAborted(options.signal)
    return
  }

  const promise = assertHttpRangeSupportUncached(url, options).catch((error: unknown) => {
    if (rangeSupportCache.get(cacheKey) === promise) {
      rangeSupportCache.delete(cacheKey)
    }

    throw error
  })

  rangeSupportCache.set(cacheKey, promise)
  await promise
  throwIfAborted(options.signal)
}

async function assertHttpRangeSupportUncached(
  url: string,
  options: AssertHttpRangeSupportOptions,
): Promise<void> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  let response: Response

  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: {
        Range: RANGE_PROBE_HEADER,
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause
    }

    throw new Error(
      `${readTargetLabel(options.label)} cannot be range-read. The Range probe failed before an HTTP response was available. Confirm CORS allows GET and the Range request header for ${url}.`,
      { cause },
    )
  }

  const contentRange = response.headers.get('Content-Range')

  if (response.status !== 206) {
    throw new Error(
      `${readTargetLabel(options.label)} cannot be range-read. Expected HTTP 206 for Range: ${RANGE_PROBE_HEADER}, received HTTP ${response.status}. Configure the host to honor byte-range GET requests for ${url}.`,
    )
  }

  if (contentRange === null || contentRange.trim().length === 0) {
    throw new Error(
      `${readTargetLabel(options.label)} cannot be range-read. The Range probe returned HTTP 206 but Content-Range was not exposed to the browser. Add Content-Range to Access-Control-Expose-Headers for ${url}.`,
    )
  }
}

function rangeSupportCacheKey(url: string, label: string | undefined): string {
  return `${url}\n${label ?? ''}`
}

function readTargetLabel(label: string | undefined): string {
  return label ?? 'Dataset file'
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('HTTP Range support probe aborted.')
  error.name = 'AbortError'
  return error
}
