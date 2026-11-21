import { abortError } from '../utils/abort'

// Runs one request in a worker of its own and settles with its answer. The
// worker is terminated once it has answered, failed to run or been aborted.
// The wrappers (`merscopeTableWorker.ts` and the like) say which messages
// mean what, and keep the `new Worker(new URL(...))` call: Vite only bundles
// a worker script named in the file that creates it.

// The part of a Worker a one-shot read uses, so tests can stand in for it.
export interface OneShotWorker<Request, Response> {
  onmessage: ((event: MessageEvent<Response>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: Request, transfer?: Transferable[]): void
  terminate(): void
}

// How a message ends the read: with a value, or with the error the worker
// reports (the same shape as the error responses the workers send).
export type WorkerOutcome<Result> =
  | { readonly value: Result }
  | { readonly error: string; readonly errorName?: string }

export interface RunWorkerOnceOptions<Request, Response, Result> {
  readonly signal?: AbortSignal | undefined
  // Reads each message and returns undefined while the read goes on (progress,
  // a request for more bytes). `send` posts to the worker until the read ends.
  readonly onMessage: (
    response: Response,
    send: (message: Request, transfer?: Transferable[]) => void,
  ) => WorkerOutcome<Result> | undefined
  // The name of a reported error that has none.
  readonly errorName: string
  // Reads on this thread when the worker did not load or crashed. Without it
  // that failure rejects, with `failureMessage` if the event has no message.
  readonly fallback?: () => Promise<Result>
  readonly failureMessage?: string
}

export function runWorkerOnce<Request, Response, Result>(
  worker: OneShotWorker<Request, Response>,
  request: Request,
  options: RunWorkerOnceOptions<Request, Response, Result>,
): Promise<Result> {
  const { signal } = options

  if (signal?.aborted === true) {
    worker.terminate()
    return Promise.reject(abortError(signal))
  }

  return new Promise<Result>((resolve, reject) => {
    let finished = false
    const finish = () => {
      finished = true
      signal?.removeEventListener('abort', handleAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    const handleAbort = () => {
      finish()
      reject(abortError(signal))
    }
    const send = (message: Request, transfer?: Transferable[]) => {
      if (finished) {
        return
      }

      if (transfer === undefined) {
        worker.postMessage(message)
      } else {
        worker.postMessage(message, transfer)
      }
    }

    worker.onmessage = (event) => {
      const outcome = options.onMessage(event.data, send)

      if (outcome === undefined) {
        return
      }

      finish()

      if ('error' in outcome) {
        const error = new Error(outcome.error)
        error.name = outcome.errorName ?? options.errorName
        reject(error)
        return
      }

      resolve(outcome.value)
    }
    worker.onerror = (event) => {
      finish()

      if (options.fallback === undefined) {
        reject(new Error(event.message || options.failureMessage || 'The worker failed.'))
        return
      }

      event.preventDefault()
      resolve(options.fallback())
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    try {
      worker.postMessage(request)
    } catch (cause) {
      finish()
      reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })
}
