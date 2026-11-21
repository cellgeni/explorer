import { describe, expect, it, vi } from 'vitest'
import {
  runWorkerOnce,
  type OneShotWorker,
  type RunWorkerOnceOptions,
} from './runWorkerOnce'

type Request = { readonly type: 'read' } | { readonly type: 'slice'; bytes: ArrayBuffer }
type Response =
  | { readonly type: 'progress'; readonly percent: number }
  | { readonly type: 'more' }
  | { readonly type: 'done'; readonly value: number }
  | { readonly type: 'error'; readonly error: string; readonly errorName?: string }

const READ: Request = { type: 'read' }

// Stands in for a Worker: `reply` and `crash` play what the real one would do.
class FakeWorker implements OneShotWorker<Request, Response> {
  onmessage: ((event: MessageEvent<Response>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly posted: { message: Request; transfer: Transferable[] | undefined }[] = []
  terminations = 0

  constructor(private readonly postError?: unknown) {}

  postMessage(message: Request, ...rest: [Transferable[]?]): void {
    this.posted.push({ message, transfer: rest[0] })

    if (this.postError !== undefined) {
      throw this.postError
    }
  }

  terminate(): void {
    this.terminations += 1
  }

  reply(response: Response): void {
    this.onmessage?.({ data: response } as MessageEvent<Response>)
  }

  crash(message = ''): ErrorEvent {
    const event = { message, preventDefault: vi.fn() } as unknown as ErrorEvent
    this.onerror?.(event)
    return event
  }
}

// Reads `done` as the value, and every other answer except `error` as one
// that does not end the read.
function options(
  extra: Partial<RunWorkerOnceOptions<Request, Response, number>> = {},
): RunWorkerOnceOptions<Request, Response, number> {
  return {
    errorName: 'TestWorkerError',
    onMessage: (response) => {
      if (response.type === 'done') return { value: response.value }
      return response.type === 'error' ? response : undefined
    },
    ...extra,
  }
}

describe('runWorkerOnce', () => {
  it('posts the request, resolves with the value and terminates the worker', async () => {
    const worker = new FakeWorker()
    const read = runWorkerOnce(worker, READ, options())

    expect(worker.posted).toEqual([{ message: READ, transfer: undefined }])
    expect(worker.terminations).toBe(0)

    worker.reply({ type: 'done', value: 42 })

    await expect(read).resolves.toBe(42)
    expect(worker.terminations).toBe(1)
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
  })

  it('keeps the worker running through messages that do not end the read', async () => {
    const worker = new FakeWorker()
    const seen: string[] = []
    const read = runWorkerOnce(
      worker,
      READ,
      options({
        onMessage: (response) => {
          seen.push(response.type)
          return response.type === 'done' ? { value: response.value } : undefined
        },
      }),
    )

    worker.reply({ type: 'progress', percent: 50 })
    worker.reply({ type: 'more' })

    expect(worker.terminations).toBe(0)
    expect(worker.onmessage).not.toBeNull()

    worker.reply({ type: 'done', value: 7 })

    await expect(read).resolves.toBe(7)
    expect(seen).toEqual(['progress', 'more', 'done'])
  })

  it('rejects with the error the worker reports, under its name', async () => {
    const reported = new FakeWorker()
    const named = new FakeWorker()
    const unnamedRead = runWorkerOnce(reported, READ, options())
    const namedRead = runWorkerOnce(named, READ, options())

    reported.reply({ type: 'error', error: 'HTTP 404.' })
    named.reply({ type: 'error', error: 'Stopped.', errorName: 'AbortError' })

    await expect(unnamedRead).rejects.toMatchObject({
      message: 'HTTP 404.',
      name: 'TestWorkerError',
    })
    await expect(namedRead).rejects.toMatchObject({
      message: 'Stopped.',
      name: 'AbortError',
    })
    expect(reported.terminations).toBe(1)
    expect(named.terminations).toBe(1)
  })

  it('rejects at once, without posting, when the signal is already aborted', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const reason = new Error('Dataset closed.')
    controller.abort(reason)

    await expect(
      runWorkerOnce(worker, READ, options({ signal: controller.signal })),
    ).rejects.toBe(reason)
    expect(worker.posted).toEqual([])
    expect(worker.terminations).toBe(1)
  })

  it('terminates the worker and rejects when the signal aborts mid-run', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const onMessage = vi.fn()
    const read = runWorkerOnce(
      worker,
      READ,
      options({ signal: controller.signal, onMessage }),
    )

    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminations).toBe(1)
    expect(worker.onmessage).toBeNull()
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('stops listening for the abort once the read is over', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const read = runWorkerOnce(worker, READ, options({ signal: controller.signal }))

    worker.reply({ type: 'done', value: 1 })
    await expect(read).resolves.toBe(1)
    controller.abort()

    expect(worker.terminations).toBe(1)
  })

  it('reads on this thread when the worker fails to run', async () => {
    const worker = new FakeWorker()
    const fallback = vi.fn(async () => 99)
    const read = runWorkerOnce(worker, READ, options({ fallback }))

    const event = worker.crash('Script error.')

    await expect(read).resolves.toBe(99)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(worker.terminations).toBe(1)
  })

  it('rejects with the failure when there is no fallback', async () => {
    const reported = new FakeWorker()
    const silent = new FakeWorker()
    const bare = new FakeWorker()
    const reportedRead = runWorkerOnce(reported, READ, options())
    const silentRead = runWorkerOnce(
      silent,
      READ,
      options({ failureMessage: 'The test worker failed.' }),
    )
    const bareRead = runWorkerOnce(bare, READ, options())

    const event = reported.crash('Script error.')
    silent.crash()
    bare.crash()

    await expect(reportedRead).rejects.toMatchObject({
      name: 'Error',
      message: 'Script error.',
    })
    // A worker that reports nothing did not start, and says so by name.
    await expect(silentRead).rejects.toMatchObject({
      name: 'WorkerStartError',
      message: expect.stringMatching(
        /^The test worker failed\. It did not start/,
      ) as unknown,
    })
    await expect(bareRead).rejects.toMatchObject({
      name: 'WorkerStartError',
      message: expect.stringMatching(/^The worker failed\. It did not start/) as unknown,
    })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(reported.terminations).toBe(1)
  })

  it('rejects when the request cannot be posted', async () => {
    const failure = new Error('DataCloneError')
    const worker = new FakeWorker(failure)
    const odd = new FakeWorker('not an Error')

    await expect(runWorkerOnce(worker, READ, options())).rejects.toBe(failure)
    await expect(runWorkerOnce(odd, READ, options())).rejects.toThrow('not an Error')
    expect(worker.terminations).toBe(1)
    expect(odd.terminations).toBe(1)
  })

  it('lets a message handler post to the worker until the read ends', async () => {
    const worker = new FakeWorker()
    const bytes = new ArrayBuffer(4)
    let post: ((message: Request, transfer?: Transferable[]) => void) | undefined
    const read = runWorkerOnce(
      worker,
      READ,
      options({
        onMessage: (response, send) => {
          post = send

          if (response.type === 'more') {
            send({ type: 'slice', bytes }, [bytes])
          }

          return response.type === 'done' ? { value: response.value } : undefined
        },
      }),
    )

    worker.reply({ type: 'more' })
    worker.reply({ type: 'done', value: 3 })
    await expect(read).resolves.toBe(3)
    post?.({ type: 'slice', bytes: new ArrayBuffer(1) })

    expect(worker.posted).toEqual([
      { message: READ, transfer: undefined },
      { message: { type: 'slice', bytes }, transfer: [bytes] },
    ])
  })
})
