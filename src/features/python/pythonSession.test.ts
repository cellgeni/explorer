import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PythonDataRequest,
  PythonWorkerRequest,
  PythonWorkerResponse,
} from '../../workers/pythonMessages'
import {
  PYTHON_RESTARTED_MESSAGE,
  PYTHON_UNSUPPORTED_MESSAGE,
  pythonDataError,
  PythonSession,
  type PythonDataProvider,
  type PythonWorkerLike,
} from './pythonSession'

class FakeWorker implements PythonWorkerLike {
  onmessage: ((event: MessageEvent<PythonWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly sent: { message: PythonWorkerRequest; transfer: Transferable[] }[] = []
  terminated = false

  postMessage(message: PythonWorkerRequest, transfer: Transferable[] = []): void {
    this.sent.push({ message, transfer })
  }

  terminate(): void {
    this.terminated = true
  }

  emit(message: PythonWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<PythonWorkerResponse>)
  }

  last<T extends PythonWorkerRequest['type']>(type: T) {
    return this.sent.findLast((entry) => entry.message.type === type)?.message as
      Extract<PythonWorkerRequest, { type: T }> | undefined
  }
}

function setup(
  data: PythonDataProvider = { answer: async () => ({ value: null }) },
  options: {
    supported?: boolean
    crossOriginIsolated?: boolean
    onRunEnd?: () => void
  } = {},
) {
  const workers: FakeWorker[] = []
  const session = new PythonSession({
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    indexUrl: '/pyodide/',
    data,
    interruptGraceMs: 50,
    ...options,
  })
  return { session, workers }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('PythonSession', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('says the browser cannot run Python without JSPI, and starts nothing', () => {
    const { session, workers } = setup(undefined, { supported: false })
    session.start()
    expect(workers).toHaveLength(0)
    expect(session.getSnapshot()).toMatchObject({
      status: 'unsupported',
      message: PYTHON_UNSUPPORTED_MESSAGE,
    })
  })

  it('starts once, shows progress, and runs inputs after start-up', async () => {
    const { session, workers } = setup()
    session.start()
    session.start()
    expect(workers).toHaveLength(1)
    const worker = workers[0]!
    expect(worker.last('start')).toEqual({
      type: 'start',
      indexUrl: '/pyodide/',
      interruptBuffer: null,
    })
    worker.emit({ type: 'progress', message: 'Loading NumPy' })
    expect(session.getSnapshot()).toMatchObject({
      status: 'loading',
      progress: 'Loading NumPy',
    })

    const outcome = session.run('len(cells)')
    await flush()
    expect(worker.last('run')).toBeUndefined()

    worker.emit({ type: 'ready', pythonVersion: '3.14.2' })
    await flush()
    const run = worker.last('run')!
    expect(run.code).toBe('len(cells)')
    expect(session.getSnapshot().status).toBe('running')

    worker.emit({ type: 'started', id: run.id })
    worker.emit({ type: 'output', stream: 'stdout', text: 'hello' })
    worker.emit({
      type: 'done',
      id: run.id,
      status: 'ok',
      display: '1414155',
      error: null,
    })
    await expect(outcome).resolves.toBe('ok')
    await flush()
    expect(session.getSnapshot().status).toBe('ready')
    expect(session.getSnapshot().log.map(({ kind, text }) => [kind, text])).toEqual([
      ['input', 'len(cells)'],
      ['stdout', 'hello'],
      ['result', '1414155'],
    ])
  })

  it('answers data requests through the provider, and refuses unknown ones', async () => {
    const values = new Float64Array([1, 2, 3])
    const answer = vi.fn<PythonDataProvider['answer']>(async () => ({
      value: values,
      transfer: [values.buffer],
    }))
    const { session, workers } = setup({ answer })
    session.start()
    const worker = workers[0]!

    worker.emit({
      type: 'request',
      id: 7,
      request: { kind: 'number-column', columnId: 'cell:area' },
    })
    worker.emit({ type: 'request', id: 8, request: { kind: 'eval', code: 'alert(1)' } })
    await flush()

    expect(answer).toHaveBeenCalledWith({
      kind: 'number-column',
      columnId: 'cell:area',
    } satisfies PythonDataRequest)
    const replies = worker.sent.filter((entry) => entry.message.type === 'reply')
    expect(replies.map((entry) => entry.message)).toEqual([
      {
        type: 'reply',
        id: 8,
        ok: false,
        error: { name: 'DataError', message: 'The app does not answer this request.' },
      },
      { type: 'reply', id: 7, ok: true, value: values },
    ])
    expect(replies[1]?.transfer).toEqual([values.buffer])
  })

  it('passes a read over the budget to Python as ReadTooLarge', async () => {
    const tooLarge = Object.assign(new Error('Reading CD3E would read about 120 MiB.'), {
      name: 'GeneReadTooLarge',
      bytes: 120 * 1024 * 1024,
    })
    const { session, workers } = setup({
      answer: async () => {
        throw tooLarge
      },
    })
    session.start()
    workers[0]!.emit({
      type: 'request',
      id: 1,
      request: { kind: 'gene', name: 'CD3E', layer: null, allowLarge: false },
    })
    await flush()
    expect(workers[0]!.last('reply')).toEqual({
      type: 'reply',
      id: 1,
      ok: false,
      error: {
        name: 'ReadTooLarge',
        message: 'Reading CD3E would read about 120 MiB.',
        bytes: 120 * 1024 * 1024,
      },
    })
    expect(pythonDataError(new Error('No such column'))).toEqual({
      name: 'DataError',
      message: 'No such column',
    })
  })

  it('restarts Python on Stop without isolation, and says the variables went', async () => {
    const { session, workers } = setup()
    session.start()
    workers[0]!.emit({ type: 'ready', pythonVersion: '3.14.2' })
    const outcome = session.run('while True: pass')
    await flush()

    session.stop()
    await expect(outcome).resolves.toBe('stopped')
    expect(workers[0]!.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(session.getSnapshot().status).toBe('loading')
    await flush()
    expect(session.getSnapshot().log.at(-1)).toMatchObject({
      kind: 'info',
      text: PYTHON_RESTARTED_MESSAGE,
    })
    // The old worker's late messages are ignored.
    workers[0]!.emit({ type: 'ready', pythonVersion: 'old' })
    expect(session.getSnapshot().status).toBe('loading')
  })

  it('says when each input ends, finished or stopped, for the canvas to draw', async () => {
    const onRunEnd = vi.fn()
    const { session, workers } = setup(undefined, { onRunEnd })
    session.start()
    const worker = workers[0]!
    worker.emit({ type: 'ready', pythonVersion: '3.14.2' })

    const first = session.run('color(cells.x > 0, "green")')
    await flush()
    expect(onRunEnd).not.toHaveBeenCalled()
    worker.emit({
      type: 'done',
      id: worker.last('run')!.id,
      status: 'ok',
      display: null,
      error: null,
    })
    await first
    expect(onRunEnd).toHaveBeenCalledTimes(1)

    const second = session.run('while True: pass')
    await flush()
    session.stop()
    await second
    expect(onRunEnd).toHaveBeenCalledTimes(2)

    // A restart with no input running ends none.
    session.restart()
    expect(onRunEnd).toHaveBeenCalledTimes(2)
  })

  it('interrupts where the page is isolated, and restarts if Python does not stop', async () => {
    const { session, workers } = setup(undefined, { crossOriginIsolated: true })
    session.start()
    const buffer = workers[0]!.last('start')!.interruptBuffer
    expect(buffer).toBeInstanceOf(Uint8Array)
    workers[0]!.emit({ type: 'ready', pythonVersion: '3.14.2' })

    const first = session.run('while True: pass')
    await flush()
    session.stop()
    expect(buffer?.[0]).toBe(2)
    const run = workers[0]!.last('run')!
    workers[0]!.emit({
      type: 'done',
      id: run.id,
      status: 'error',
      display: null,
      error: 'KeyboardInterrupt',
    })
    await expect(first).resolves.toBe('error')
    expect(buffer?.[0]).toBe(0)
    expect(workers).toHaveLength(1)

    const second = session.run('while True: pass')
    await flush()
    session.stop()
    await expect(second).resolves.toBe('stopped')
    expect(workers).toHaveLength(2)
  })

  it('fails when the worker cannot start, and starts again after', () => {
    const { session, workers } = setup()
    session.start()
    workers[0]!.emit({ type: 'failed', message: 'HTTP 404' })
    expect(session.getSnapshot()).toMatchObject({
      status: 'failed',
      message: 'Python could not start: HTTP 404',
    })
    session.start()
    expect(workers).toHaveLength(2)
  })

  it('tells the worker when the dataset changes, and keeps the log to its limit', async () => {
    const workers: FakeWorker[] = []
    const session = new PythonSession({
      createWorker: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
      indexUrl: '/pyodide/',
      data: { answer: async () => ({ value: null }) },
      maxLogEntries: 3,
    })
    session.start()
    session.datasetChanged()
    expect(workers[0]!.last('dataset')).toEqual({ type: 'dataset' })
    for (const text of ['a', 'b', 'c', 'd']) {
      workers[0]!.emit({ type: 'output', stream: 'stdout', text })
    }
    await flush()
    expect(session.getSnapshot().log.map((entry) => entry.text)).toEqual(['b', 'c', 'd'])
    session.clearLog()
    expect(session.getSnapshot().log).toEqual([])
  })
})
