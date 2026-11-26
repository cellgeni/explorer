import { abortError } from '../utils/abort'
import { hidesErrorResponses, noteReadableResponse } from './hostResponses'

// One fetch for the app's reads of remote files (optimization pass, O7).
//
// - An attempt ends when it has waited 30 s for bytes, before the headers or
//   while a read of the body waits, and its host has sent no bytes to any
//   request in that time. Chromium sends at most six HTTP/1.1 requests to a
//   host at once and queues the rest, and a queued request gets no bytes
//   however well the host answers. A slow reader does not count either, since
//   the wait runs only while a read waits on the network.
// - An attempt that times out, fails on the network, or is answered 408, 429
//   or 5xx is tried again after a back-off, three attempts in all. The last
//   answer or error goes to the caller, as a plain fetch's would.
// - A body that stops part way resumes after the bytes already read: the rest
//   of the range for a range read, otherwise the same request with the bytes
//   read skipped.
// - A 4xx, the caller's abort, and requests other than GET and HEAD are not
//   tried again. Nor is a failed fetch on a host that hides its error
//   responses from the page (`hidesErrorResponses`): there it most likely
//   stands for a 404, as for the optional files zarrita looks for.
//
// It takes and returns what fetch does, so it can be given to the libraries
// that fetch for themselves.

export const FETCH_IDLE_TIMEOUT_MS = 30_000
export const FETCH_ATTEMPTS = 3

type Fetch = typeof fetch

export interface FetchRetryOptions {
  // The fetch to call; tests pass a fake.
  readonly fetcher?: Fetch
  // How long an attempt may wait for bytes.
  readonly idleTimeoutMs?: number
  // Attempts in all, the first included.
  readonly attempts?: number
  // How long to wait before attempt `attempt` (2 for the first retry).
  readonly retryDelayMs?: (attempt: number) => number
}

export interface FetchRetry {
  readonly url: string
  // The attempt about to start, and how many there are in all.
  readonly attempt: number
  readonly attempts: number
  // What ended the last attempt.
  readonly reason: string
  readonly delayMs: number
}

export class FetchTimeoutError extends Error {
  constructor(url: string, idleTimeoutMs: number, options?: ErrorOptions) {
    super(
      `Request timed out after ${idleTimeoutMs.toLocaleString()} ms with no data from ${url}.`,
      options,
    )
    this.name = 'TimeoutError'
  }
}

interface FetchRetryDefaults {
  idleTimeoutMs: number
  attempts: number
  retryDelayMs: (attempt: number) => number
  // Whether this realm tells the page's other realms when a host sends bytes,
  // and hears from them. Tests turn it off: test files in other threads
  // would hear each other.
  shareActivity: boolean
}

const defaults: FetchRetryDefaults = {
  idleTimeoutMs: FETCH_IDLE_TIMEOUT_MS,
  attempts: FETCH_ATTEMPTS,
  retryDelayMs: backOffMs,
  shareActivity: true,
}
const retryListeners = new Set<(retry: FetchRetry) => void>()

// When each origin last sent bytes to a request: in this realm, or in another
// of the page's realms (the page and its workers), which say so at most once
// a second per origin. Requests in workers share the host's six connections
// with the page's. The app's other tabs hear it too, which can only make a
// wait longer.
const originBytesAt = new Map<string, number>()
const sharedBytesAt = new Map<string, number>()
const ACTIVITY_CHANNEL = 'cellgeni-fetch-activity'
const ACTIVITY_SHARE_MS = 1_000
let activityChannel: BroadcastChannel | null | undefined

// Notes bytes from `url`'s origin read another way: the H5 worker's
// synchronous requests.
export function noteFetchActivity(url: string): void {
  noteOriginBytes(originOf(url))
}

// Forgets every origin's activity, for tests.
export function clearFetchActivity(): void {
  originBytesAt.clear()
  sharedBytesAt.clear()
}

function noteOriginBytes(origin: string | undefined): void {
  if (origin === undefined) {
    return
  }

  const now = Date.now()

  originBytesAt.set(origin, now)
  if (now - (sharedBytesAt.get(origin) ?? 0) >= ACTIVITY_SHARE_MS) {
    sharedBytesAt.set(origin, now)
    openActivityChannel()?.postMessage({ origin, at: now })
  }
}

function openActivityChannel(): BroadcastChannel | null {
  if (activityChannel === undefined) {
    activityChannel =
      defaults.shareActivity && typeof BroadcastChannel === 'function'
        ? new BroadcastChannel(ACTIVITY_CHANNEL)
        : null
    activityChannel?.addEventListener('message', (event: MessageEvent<unknown>) => {
      const { origin, at } = (event.data ?? {}) as { origin?: unknown; at?: unknown }

      if (typeof origin === 'string' && typeof at === 'number') {
        originBytesAt.set(origin, Math.max(originBytesAt.get(origin) ?? at, at))
      }
    })
    // Node's channel would otherwise keep a test run alive.
    ;(activityChannel as { unref?: () => void } | null)?.unref?.()
  }

  return activityChannel
}

// Changes the defaults for every later request; returns a function that puts
// them back. Tests set the back-off to 0.
export function configureFetchRetry(changes: Partial<FetchRetryDefaults>): () => void {
  const previous = { ...defaults }
  const apply = (next: Partial<FetchRetryDefaults>) => {
    Object.assign(defaults, next)
    // Opened again, or not, as the setting now says.
    activityChannel?.close()
    activityChannel = undefined
  }

  apply(changes)
  return () => {
    apply(previous)
  }
}

// Called before each retry in this realm (the page or one worker), for the
// activity log.
export function addFetchRetryListener(listener: (retry: FetchRetry) => void): () => void {
  retryListeners.add(listener)
  return () => {
    retryListeners.delete(listener)
  }
}

// The activity log's line for a retry.
export function describeFetchRetry(retry: FetchRetry): string {
  return `Trying ${retry.url} again (attempt ${retry.attempt} of ${retry.attempts}): ${retry.reason}.`
}

// A fetch with these options, for libraries that take one.
export function retryingFetch(options: FetchRetryOptions = {}): Fetch {
  return (input, init) => fetchWithRetry(input, init, options)
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchRetryOptions = {},
): Promise<Response> {
  const request = new RetryingRequest(input, init, options)

  return request.send()
}

interface Answer {
  readonly response: Response
  readonly controller: AbortController
  readonly release: () => void
}

class RetryingRequest {
  readonly #url: string
  readonly #origin: string | undefined
  // A Request is sent as one, so that fakes see what the caller sent.
  readonly #request: Request | undefined
  readonly #init: RequestInit
  readonly #signal: AbortSignal | undefined
  readonly #fetcher: Fetch
  readonly #idleTimeoutMs: number
  readonly #attempts: number
  readonly #retryDelayMs: (attempt: number) => number
  #attempt = 0

  constructor(input: RequestInfo | URL, init: RequestInit, options: FetchRetryOptions) {
    const request = input instanceof Request ? input : undefined
    const { signal, ...rest } = init
    const method = (rest.method ?? request?.method ?? 'GET').toUpperCase()

    this.#url = request?.url ?? String(input)
    this.#origin = originOf(this.#url)
    this.#request = request
    this.#init = rest
    this.#signal = signal ?? request?.signal ?? undefined
    this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.#idleTimeoutMs = options.idleTimeoutMs ?? defaults.idleTimeoutMs
    this.#attempts =
      method === 'GET' || method === 'HEAD'
        ? Math.max(1, options.attempts ?? defaults.attempts)
        : 1
    this.#retryDelayMs = options.retryDelayMs ?? defaults.retryDelayMs
  }

  async send(): Promise<Response> {
    const answer = await this.#answer(this.#init)
    const { response } = answer

    // Nothing to watch, or a response that cannot be rebuilt (opaque, or a
    // status that has no body).
    if (
      response.body === null ||
      response.status < 200 ||
      NULL_BODY_STATUSES.has(response.status)
    ) {
      answer.release()
      return response
    }

    return this.#watched(answer, response.body)
  }

  // Sends `init` until an answer is not worth trying again, or the attempts
  // run out.
  async #answer(init: RequestInit): Promise<Answer> {
    for (;;) {
      this.#attempt += 1

      const controller = new AbortController()
      const release = linkAbort(this.#signal, controller)
      const timer = new IdleTimer(this.#idleTimeoutMs, this.#origin, () => {
        controller.abort(new FetchTimeoutError(this.#url, this.#idleTimeoutMs))
      })
      let response: Response

      timer.start()
      try {
        response = await (this.#request === undefined
          ? this.#fetcher(this.#url, { ...init, signal: controller.signal })
          : this.#fetcher(
              new Request(this.#request, { ...init, signal: controller.signal }),
            ))
      } catch (error) {
        release()
        await this.#retryAfterFailure(timer.stop(), error, false)
        continue
      }

      timer.stop()
      noteOriginBytes(this.#origin)
      noteReadableResponse(this.#url, response.status)
      if (!isRetriedStatus(response.status) || this.#attempt >= this.#attempts) {
        return { response, controller, release }
      }

      response.body?.cancel().catch(() => undefined)
      release()
      await this.#retry(`HTTP ${response.status}`, retryAfterMs(response))
    }
  }

  // Throws `error` unless it is worth another attempt, then waits for it. A
  // failure within a body cannot be a hidden error response.
  async #retryAfterFailure(
    timedOut: boolean,
    error: unknown,
    inBody: boolean,
  ): Promise<void> {
    this.#throwIfAborted(error)

    const failure = timedOut
      ? new FetchTimeoutError(this.#url, this.#idleTimeoutMs)
      : error

    if (
      !(
        timedOut ||
        (isNetworkFailure(error) && (inBody || !hidesErrorResponses(this.#url)))
      ) ||
      this.#attempt >= this.#attempts
    ) {
      throw failure
    }

    await this.#retry(
      timedOut ? `no data for ${formatSeconds(this.#idleTimeoutMs)}` : errorText(error),
      0,
    )
  }

  async #retry(reason: string, atLeastMs: number): Promise<void> {
    const delayMs = Math.max(atLeastMs, this.#retryDelayMs(this.#attempt + 1))

    for (const listener of retryListeners) {
      listener({
        url: this.#url,
        attempt: this.#attempt + 1,
        attempts: this.#attempts,
        reason,
        delayMs,
      })
    }

    await wait(delayMs, this.#signal)
  }

  // The caller's abort, as the fetch reported it when it did.
  #throwIfAborted(error: unknown): void {
    if (this.#signal?.aborted === true) {
      throw hasAbortName(error) ? error : abortError(this.#signal)
    }
  }

  // The response, with a body that times out while it waits for bytes and
  // resumes after a failure.
  #watched(first: Answer, firstBody: ReadableStream<Uint8Array<ArrayBuffer>>): Response {
    const headers = this.#init.headers ?? this.#request?.headers
    const range = first.response.status === 206 ? byteRange(headers) : undefined
    const validators = validatorsOf(first.response)
    let answer = first
    let reader = firstBody.getReader()
    let received = 0
    let skip = 0
    let failure: unknown
    const timer = new IdleTimer(this.#idleTimeoutMs, this.#origin, () => {
      answer.controller.abort(new FetchTimeoutError(this.#url, this.#idleTimeoutMs))
    })
    const finish = () => {
      timer.stop()
      answer.release()
    }
    const resume = async (error: unknown, timedOut: boolean) => {
      reader.cancel().catch(() => undefined)
      answer.release()
      await this.#retryAfterFailure(timedOut, error, true)

      const next = await this.#answer(
        range === undefined
          ? this.#init
          : {
              ...this.#init,
              headers: withRange(headers, range.start + received, range.end),
            },
      )
      const { response } = next

      answer = next
      if (
        response.status !== first.response.status ||
        response.body === null ||
        !sameValidators(validators, validatorsOf(response)) ||
        (range !== undefined &&
          !answersRange(response, range.start + received, range.end))
      ) {
        response.body?.cancel().catch(() => undefined)
        throw timedOut ? new FetchTimeoutError(this.#url, this.#idleTimeoutMs) : error
      }

      reader = response.body.getReader()
      skip = range === undefined ? received : 0
    }

    const body = new ReadableStream<Uint8Array<ArrayBuffer>>(
      {
        pull: async (stream) => {
          try {
            for (;;) {
              let result: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>

              timer.start()
              try {
                result = await reader.read()
              } catch (error) {
                const timedOut = timer.stop()

                await resume(error, timedOut)
                continue
              }

              timer.stop()
              if (result.done) {
                finish()
                stream.close()
                return
              }

              let chunk = result.value

              noteOriginBytes(this.#origin)

              if (skip > 0) {
                const skipped = Math.min(skip, chunk.byteLength)

                skip -= skipped
                chunk = chunk.subarray(skipped)
              }

              if (chunk.byteLength > 0) {
                received += chunk.byteLength
                stream.enqueue(chunk)
                return
              }
            }
          } catch (error) {
            finish()
            failure =
              this.#signal?.aborted === true && !hasAbortName(error)
                ? abortError(this.#signal)
                : error
            throw failure
          }
        },
        cancel: (reason) => {
          finish()
          answer.controller.abort(reason)
          return reader.cancel(reason).catch(() => undefined)
        },
      },
      // Nothing is read before the caller asks, so a caller that refuses a
      // response by its headers reads none of it.
      { highWaterMark: 0 },
    )

    return new RetryingResponse(body, first.response, () => failure)
  }
}

// A response with the watched body. Chromium rejects `arrayBuffer()` and the
// like on a response built from a stream with "Failed to fetch" whatever the
// stream's error, so they rethrow the error the body ended with: a timeout,
// the last network error, or the caller's abort.
class RetryingResponse extends Response {
  readonly #failure: () => unknown

  constructor(
    body: ReadableStream<Uint8Array<ArrayBuffer>>,
    source: Response,
    failure: () => unknown,
  ) {
    super(body, {
      status: source.status,
      statusText: source.statusText,
      headers: source.headers,
    })
    this.#failure = failure
    Object.defineProperties(this, {
      url: { value: source.url },
      redirected: { value: source.redirected },
    })
  }

  override arrayBuffer(): Promise<ArrayBuffer> {
    return this.#read(super.arrayBuffer())
  }

  override blob(): Promise<Blob> {
    return this.#read(super.blob())
  }

  override bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return this.#read(super.bytes())
  }

  override json(): Promise<unknown> {
    return this.#read(super.json())
  }

  override text(): Promise<string> {
    return this.#read(super.text())
  }

  async #read<T>(read: Promise<T>): Promise<T> {
    try {
      return await read
    } catch (error) {
      throw this.#failure() ?? error
    }
  }
}

// Times one wait for bytes. It runs out once the wait, and the origin's
// silence, have both lasted `ms`; `stop` says whether it did.
class IdleTimer {
  readonly #ms: number
  readonly #origin: string | undefined
  readonly #onIdle: () => void
  #timer: ReturnType<typeof setTimeout> | undefined
  #waitStart = 0
  #fired = false

  constructor(ms: number, origin: string | undefined, onIdle: () => void) {
    this.#ms = ms
    this.#origin = origin
    this.#onIdle = onIdle
  }

  start(): void {
    clearTimeout(this.#timer)
    openActivityChannel()
    this.#fired = false
    this.#waitStart = Date.now()
    this.#check()
  }

  // Timers can fire a little before Date.now() reaches their time, so an
  // early one waits again.
  readonly #check = (): void => {
    const quietSince = Math.max(
      this.#waitStart,
      this.#origin === undefined ? 0 : (originBytesAt.get(this.#origin) ?? 0),
    )
    const due = quietSince + this.#ms
    const now = Date.now()

    if (now >= due) {
      this.#timer = undefined
      this.#fired = true
      this.#onIdle()
      return
    }

    this.#timer = setTimeout(this.#check, due - now)
  }

  stop(): boolean {
    clearTimeout(this.#timer)
    this.#timer = undefined
    return this.#fired
  }
}

const NULL_BODY_STATUSES = new Set([204, 205, 304])

// The answers worth another attempt; the H5 worker's reads use it too.
export function isRetriedStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

// A failed fetch without a response: "Failed to fetch" in Chromium, "fetch
// failed" in Node. A CORS refusal looks the same, so it is tried again too.
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError
}

// 1 s before the second attempt, 2 s before the third, each up to a quarter
// longer so that many reads that failed together do not retry together.
function backOffMs(attempt: number): number {
  return 1_000 * 2 ** (attempt - 2) * (1 + Math.random() / 4)
}

// The wait a 429 or 503 asks for, when the host lets the page read it, up to
// the idle timeout.
function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('Retry-After'))

  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1_000, FETCH_IDLE_TIMEOUT_MS)
    : 0
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError(signal))
      return
    }

    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// Aborts `controller` when `signal` does; returns a function that stops
// listening.
function linkAbort(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (signal === undefined) {
    return () => undefined
  }

  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => undefined
  }

  const onAbort = () => {
    controller.abort(signal.reason)
  }

  signal.addEventListener('abort', onAbort, { once: true })
  return () => {
    signal.removeEventListener('abort', onAbort)
  }
}

interface ByteRange {
  readonly start: number
  // Inclusive; undefined for a range to the end of the file.
  readonly end: number | undefined
}

// The request's `Range: bytes=a-b` or `bytes=a-`; suffix and multiple ranges
// are resumed by skipping instead.
function byteRange(headers: HeadersInit | undefined): ByteRange | undefined {
  const value = headerValue(headers, 'range')
  const match = value === undefined ? null : /^bytes=(\d+)-(\d*)$/.exec(value.trim())

  if (match === null) {
    return undefined
  }

  return {
    start: Number(match[1]),
    end: match[2] === '' ? undefined : Number(match[2]),
  }
}

function headerValue(headers: HeadersInit | undefined, name: string): string | undefined {
  if (headers === undefined) {
    return undefined
  }

  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined
  }

  const entries = Array.isArray(headers) ? headers : Object.entries(headers)

  return entries.find(([key]) => key.toLowerCase() === name)?.[1]
}

// `headers` with its Range set to `start`..`end`, in the same form, since
// callers' fakes read them as they passed them.
function withRange(
  headers: HeadersInit | undefined,
  start: number,
  end: number | undefined,
): HeadersInit {
  const range = `bytes=${start}-${end ?? ''}`

  if (headers instanceof Headers) {
    const next = new Headers(headers)

    next.set('Range', range)
    return next
  }

  const entries = (
    Array.isArray(headers) ? headers : Object.entries(headers ?? {})
  ).filter(([key]) => key.toLowerCase() !== 'range')

  return Array.isArray(headers)
    ? [...entries, ['Range', range]]
    : { ...Object.fromEntries(entries), Range: range }
}

// Whether a resumed range read was answered with the bytes asked for, as far
// as the host lets the page see its Content-Range and Content-Length.
function answersRange(
  response: Response,
  start: number,
  end: number | undefined,
): boolean {
  const contentRange = /^bytes (\d+)-(\d+)\//i.exec(
    response.headers.get('Content-Range')?.trim() ?? '',
  )
  const contentLength = response.headers.get('Content-Length')

  return (
    (contentRange === null ||
      (Number(contentRange[1]) === start &&
        (end === undefined || Number(contentRange[2]) === end))) &&
    (contentLength === null ||
      end === undefined ||
      Number(contentLength) === end - start + 1)
  )
}

interface Validators {
  readonly etag: string | null
  readonly lastModified: string | null
}

function validatorsOf(response: Response): Validators {
  return {
    etag: response.headers.get('ETag'),
    lastModified: response.headers.get('Last-Modified'),
  }
}

// A resumed body is joined to the first only if the file has not changed in
// between, as far as the host lets the page see.
function sameValidators(left: Validators, right: Validators): boolean {
  return (
    (left.etag === null || right.etag === null || left.etag === right.etag) &&
    (left.lastModified === null ||
      right.lastModified === null ||
      left.lastModified === right.lastModified)
  )
}

// By name alone: a DOMException from another realm (jsdom's, in tests) is not
// an Error of this one.
function hasAbortName(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly name?: unknown }).name === 'AbortError'
  )
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatSeconds(ms: number): string {
  return ms % 1_000 === 0
    ? `${(ms / 1_000).toLocaleString()} s`
    : `${ms.toLocaleString()} ms`
}
