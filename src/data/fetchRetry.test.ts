import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addFetchRetryListener,
  configureFetchRetry,
  fetchWithRetry,
  FetchTimeoutError,
  type FetchRetry,
} from './fetchRetry'
import { clearHostResponses } from './hostResponses'

const IDLE_MS = 40
const URL_A = 'https://example.org/file.bin'

// What one call of the fake fetch does. A body sends its chunks, then ends,
// fails, or waits for the request's abort.
type Step =
  | { readonly kind: 'hang' }
  | { readonly kind: 'fail'; readonly error?: Error }
  | {
      readonly kind: 'answer'
      readonly status?: number
      readonly headers?: Record<string, string>
      readonly chunks?: readonly number[][]
      readonly then?: 'end' | 'hang' | 'fail'
    }

function fakeFetch(steps: readonly Step[]) {
  const queue = [...steps]
  const calls: { readonly url: string; readonly init: RequestInit }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const step = queue.shift()
    const signal = (input instanceof Request ? input.signal : init.signal) ?? undefined

    calls.push({ url: input instanceof Request ? input.url : String(input), init })
    if (step === undefined) {
      throw new Error('No more fake answers.')
    }

    if (step.kind === 'fail') {
      throw step.error ?? new TypeError('Failed to fetch')
    }

    if (step.kind === 'hang') {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => {
          reject(signal.reason)
        })
      })
    }

    const chunks = [...(step.chunks ?? [])]
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        signal?.addEventListener('abort', () => {
          controller.error(signal.reason)
        })
      },
      pull(controller) {
        const chunk = chunks.shift()

        if (chunk !== undefined) {
          controller.enqueue(new Uint8Array(chunk))
          return
        }

        if (step.then === 'fail') {
          controller.error(new TypeError('network error'))
        } else if (step.then !== 'hang') {
          controller.close()
        }

        // A hang leaves the read waiting until the abort.
        return new Promise<void>(() => undefined)
      },
    })

    return new Response(body, { status: step.status ?? 200, headers: step.headers ?? {} })
  })

  return { fetcher: fetcher as unknown as typeof fetch, calls, spy: fetcher }
}

function options(fetcher: typeof fetch) {
  return { fetcher, idleTimeoutMs: IDLE_MS, retryDelayMs: () => 0 }
}

function bytes(buffer: ArrayBuffer): number[] {
  return [...new Uint8Array(buffer)]
}

function rangeOf(init: RequestInit): string | undefined {
  return new Headers(init.headers).get('Range') ?? undefined
}

describe('fetchWithRetry (O7)', () => {
  beforeEach(() => {
    clearHostResponses()
  })

  it('answers as fetch does when nothing fails', async () => {
    const fake = fakeFetch([
      {
        kind: 'answer',
        status: 206,
        headers: { 'Content-Range': 'bytes 0-3/10' },
        chunks: [
          [1, 2],
          [3, 4],
        ],
      },
    ])
    const response = await fetchWithRetry(
      URL_A,
      { headers: { Range: 'bytes=0-3' }, cache: 'no-store' },
      options(fake.fetcher),
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 0-3/10')
    expect(bytes(await response.arrayBuffer())).toEqual([1, 2, 3, 4])
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]?.init).toMatchObject({
      headers: { Range: 'bytes=0-3' },
      cache: 'no-store',
    })
  })

  it('tries a request with no answer again, and times out after three attempts', async () => {
    const fake = fakeFetch([{ kind: 'hang' }, { kind: 'hang' }, { kind: 'hang' }])
    const started = Date.now()
    const failure = await fetchWithRetry(URL_A, {}, options(fake.fetcher)).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(FetchTimeoutError)
    expect((failure as Error).name).toBe('TimeoutError')
    expect((failure as Error).message).toContain(URL_A)
    expect(fake.calls).toHaveLength(3)
    expect(Date.now() - started).toBeGreaterThanOrEqual(3 * IDLE_MS - 5)
  })

  it('tries network failures and 408, 429 and 5xx again, but not other errors or a 4xx', async () => {
    const recovered = fakeFetch([
      { kind: 'fail' },
      { kind: 'answer', status: 503 },
      { kind: 'answer', chunks: [[7]] },
    ])

    expect(
      bytes(
        await (await fetchWithRetry(URL_A, {}, options(recovered.fetcher))).arrayBuffer(),
      ),
    ).toEqual([7])
    expect(recovered.calls).toHaveLength(3)

    for (const status of [408, 429, 500, 504]) {
      const busy = fakeFetch([
        { kind: 'answer', status },
        { kind: 'answer', status },
        { kind: 'answer', status },
      ])

      // The last answer goes to the caller, as fetch's would.
      expect((await fetchWithRetry(URL_A, {}, options(busy.fetcher))).status).toBe(status)
      expect(busy.calls).toHaveLength(3)
    }

    for (const status of [403, 404, 416]) {
      const refused = fakeFetch([{ kind: 'answer', status }])

      expect((await fetchWithRetry(URL_A, {}, options(refused.fetcher))).status).toBe(
        status,
      )
      expect(refused.calls).toHaveLength(1)
    }

    const odd = fakeFetch([{ kind: 'fail', error: new RangeError('bad range') }])

    await expect(fetchWithRetry(URL_A, {}, options(odd.fetcher))).rejects.toThrow(
      'bad range',
    )
    expect(odd.calls).toHaveLength(1)

    const posted = fakeFetch([{ kind: 'fail' }])

    await expect(
      fetchWithRetry(URL_A, { method: 'POST' }, options(posted.fetcher)),
    ).rejects.toThrow('Failed to fetch')
    expect(posted.calls).toHaveLength(1)
  })

  it('sends a Request as a Request, with the rest of a range on a resume', async () => {
    const fake = fakeFetch([
      { kind: 'answer', status: 206, chunks: [[1, 2]], then: 'fail' },
      { kind: 'answer', status: 206, chunks: [[3, 4]] },
    ])
    const caller = new AbortController()
    const response = await fetchWithRetry(
      new Request(URL_A, {
        headers: { Range: 'bytes=8-11' },
        cache: 'no-store',
        signal: caller.signal,
      }),
      undefined,
      options(fake.fetcher),
    )

    expect(bytes(await response.arrayBuffer())).toEqual([1, 2, 3, 4])

    const sent = fake.spy.mock.calls.map(([input]) => input as Request)

    expect(sent.map((request) => request.headers.get('Range'))).toEqual([
      'bytes=8-11',
      'bytes=10-11',
    ])
    expect(sent.every((request) => request.cache === 'no-store')).toBe(true)
  })

  it('takes a failed fetch for a hidden error response on a host that hides them', async () => {
    const hiding = fakeFetch([{ kind: 'answer' }, { kind: 'fail' }])

    await (await fetchWithRetry(URL_A, {}, options(hiding.fetcher))).arrayBuffer()
    // As zarrita's probe of an optional file the host does not have.
    await expect(
      fetchWithRetry(`${URL_A}.zattrs`, {}, options(hiding.fetcher)),
    ).rejects.toThrow('Failed to fetch')
    expect(hiding.calls).toHaveLength(2)

    // Once the host has let the page read an error status, a failed fetch
    // there is a network failure.
    const telling = fakeFetch([
      { kind: 'answer', status: 404 },
      { kind: 'fail' },
      { kind: 'answer' },
    ])

    await fetchWithRetry(`${URL_A}.missing`, {}, options(telling.fetcher))
    expect((await fetchWithRetry(URL_A, {}, options(telling.fetcher))).status).toBe(200)
    expect(telling.calls).toHaveLength(3)
  })

  it('resumes a range read that stops part way, from the next byte', async () => {
    const fake = fakeFetch([
      { kind: 'answer', status: 206, chunks: [[10, 11], [12]], then: 'hang' },
      { kind: 'answer', status: 206, chunks: [[13, 14]], then: 'fail' },
      { kind: 'answer', status: 206, chunks: [[15], [16, 17, 18, 19]] },
    ])
    const response = await fetchWithRetry(
      URL_A,
      { headers: { Range: 'bytes=100-109' } },
      options(fake.fetcher),
    )

    expect(bytes(await response.arrayBuffer())).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ])
    expect(fake.calls.map(({ init }) => rangeOf(init))).toEqual([
      'bytes=100-109',
      'bytes=103-109',
      'bytes=105-109',
    ])
  })

  it('resumes a whole-file read by sending it again and skipping what was read', async () => {
    const fake = fakeFetch([
      { kind: 'answer', chunks: [[1, 2, 3]], then: 'fail' },
      { kind: 'answer', chunks: [[1], [2, 3, 4], [5]] },
    ])
    const response = await fetchWithRetry(URL_A, {}, options(fake.fetcher))

    expect(await response.text()).toBe(String.fromCharCode(1, 2, 3, 4, 5))
    expect(fake.calls).toHaveLength(2)
    expect(rangeOf(fake.calls[1]!.init)).toBeUndefined()
  })

  it('reports the timeout, not "Failed to fetch", when a body runs out of attempts', async () => {
    const fake = fakeFetch([
      { kind: 'answer', status: 206, chunks: [[1]], then: 'hang' },
      { kind: 'answer', status: 206, chunks: [[2]], then: 'hang' },
      { kind: 'answer', status: 206, chunks: [[3]], then: 'hang' },
    ])
    const response = await fetchWithRetry(
      URL_A,
      { headers: { Range: 'bytes=0-9' } },
      options(fake.fetcher),
    )

    await expect(response.arrayBuffer()).rejects.toBeInstanceOf(FetchTimeoutError)
    expect(fake.calls).toHaveLength(3)
  })

  it('does not join a body to bytes other than those asked for', async () => {
    const fake = fakeFetch([
      { kind: 'answer', status: 206, chunks: [[1]], then: 'fail' },
      // The host answered the resume from the start of the range again.
      {
        kind: 'answer',
        status: 206,
        headers: { 'Content-Range': 'bytes 0-1/10' },
        chunks: [[1, 2]],
      },
    ])
    const response = await fetchWithRetry(
      URL_A,
      { headers: { Range: 'bytes=0-1' } },
      options(fake.fetcher),
    )

    await expect(response.arrayBuffer()).rejects.toThrow('network error')
    expect(rangeOf(fake.calls[1]!.init)).toBe('bytes=1-1')
  })

  it('does not join a body to a changed file', async () => {
    const fake = fakeFetch([
      {
        kind: 'answer',
        status: 206,
        headers: { ETag: '"a"' },
        chunks: [[1]],
        then: 'fail',
      },
      { kind: 'answer', status: 206, headers: { ETag: '"b"' }, chunks: [[2]] },
    ])
    const response = await fetchWithRetry(
      URL_A,
      { headers: { Range: 'bytes=0-1' } },
      options(fake.fetcher),
    )

    await expect(response.arrayBuffer()).rejects.toThrow('network error')
  })

  it('waits for a request queued behind another while the host sends that one bytes', async () => {
    let streamed = false
    let sent = 0
    const calls: string[] = []
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push(String(input))
      if (String(input).endsWith('/slow.bin')) {
        // A chunk every 20 ms for 240 ms, each sooner than the 40 ms timeout.
        return new Response(
          new ReadableStream<Uint8Array<ArrayBuffer>>({
            async pull(controller) {
              await new Promise((resolve) => setTimeout(resolve, 20))
              sent += 1
              if (sent > 12) {
                streamed = true
                controller.close()
              } else {
                controller.enqueue(new Uint8Array([sent]))
              }
            },
          }),
        )
      }

      // As Chromium holds a request while the host's connections are busy.
      await vi.waitFor(
        () => {
          if (!streamed) throw new Error('queued')
        },
        { timeout: 2_000, interval: 5 },
      )
      if (init.signal?.aborted === true) throw init.signal.reason
      return new Response(new Uint8Array([9]))
    }) as typeof fetch
    const slow = fetchWithRetry('https://example.org/slow.bin', {}, options(fetcher))
    const queued = fetchWithRetry('https://example.org/queued.bin', {}, options(fetcher))

    await (await slow).arrayBuffer()
    expect(bytes(await (await queued).arrayBuffer())).toEqual([9])
    expect(calls.filter((url) => url.endsWith('/queued.bin'))).toHaveLength(1)
  })

  it("hears of bytes the page's other realms get from a host", async () => {
    const restore = configureFetchRetry({ shareActivity: true })
    const worker = new BroadcastChannel('cellgeni-fetch-activity')
    const fake = fakeFetch([{ kind: 'hang' }, { kind: 'hang' }, { kind: 'hang' }])
    const pings = setInterval(() => {
      worker.postMessage({ origin: 'https://example.org', at: Date.now() })
    }, 10)

    try {
      const pending = fetchWithRetry(URL_A, {}, options(fake.fetcher)).catch(
        (error: unknown) => error,
      )

      // A worker's reads from the host go on for 200 ms; the request waits.
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(fake.calls).toHaveLength(1)
      clearInterval(pings)
      // Then the host is quiet, and the request times out.
      await expect(pending).resolves.toBeInstanceOf(FetchTimeoutError)
    } finally {
      clearInterval(pings)
      worker.close()
      restore()
    }
  })

  it('does not time out while the caller is not reading', async () => {
    const fake = fakeFetch([{ kind: 'answer', chunks: [[1], [2], [3]] }])
    const response = await fetchWithRetry(URL_A, {}, options(fake.fetcher))
    const reader = response.body!.getReader()
    const read: number[] = []

    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 2))

      const { done, value } = await reader.read()

      if (done) {
        break
      }

      read.push(...value)
    }

    expect(read).toEqual([1, 2, 3])
    expect(fake.calls).toHaveLength(1)
  })

  it("stops at the caller's abort, before the headers, between attempts, or in the body", async () => {
    const hanging = fakeFetch([{ kind: 'hang' }])
    const beforeHeaders = new AbortController()
    const pending = fetchWithRetry(
      URL_A,
      { signal: beforeHeaders.signal },
      options(hanging.fetcher),
    )

    beforeHeaders.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    const failing = fakeFetch([{ kind: 'fail' }, { kind: 'answer' }])
    const betweenAttempts = new AbortController()
    const waiting = fetchWithRetry(
      URL_A,
      { signal: betweenAttempts.signal },
      { fetcher: failing.fetcher, idleTimeoutMs: IDLE_MS, retryDelayMs: () => 10_000 },
    )

    await vi.waitFor(() => {
      expect(failing.calls).toHaveLength(1)
    })
    betweenAttempts.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(failing.calls).toHaveLength(1)

    const stalled = fakeFetch([{ kind: 'answer', chunks: [[1]], then: 'hang' }])
    const inBody = new AbortController()
    const response = await fetchWithRetry(
      URL_A,
      { signal: inBody.signal },
      { ...options(stalled.fetcher), idleTimeoutMs: 10_000 },
    )
    const body = response.arrayBuffer()

    inBody.abort()
    await expect(body).rejects.toMatchObject({ name: 'AbortError' })
    expect(stalled.calls).toHaveLength(1)
  })

  it('tells listeners about each retry', async () => {
    const retries: FetchRetry[] = []
    const remove = addFetchRetryListener((retry) => {
      retries.push(retry)
    })
    const fake = fakeFetch([
      { kind: 'hang' },
      { kind: 'answer', status: 502 },
      { kind: 'answer' },
    ])

    try {
      await fetchWithRetry(URL_A, {}, options(fake.fetcher))
    } finally {
      remove()
    }

    expect(retries).toEqual([
      { url: URL_A, attempt: 2, attempts: 3, reason: 'no data for 40 ms', delayMs: 0 },
      { url: URL_A, attempt: 3, attempts: 3, reason: 'HTTP 502', delayMs: 0 },
    ])
  })
})
