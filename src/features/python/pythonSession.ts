import {
  parsePythonDataRequest,
  type PythonDataError,
  type PythonDataRequest,
  type PythonDataValue,
  type PythonRunStatus,
  type PythonWorkerRequest,
  type PythonWorkerResponse,
} from '../../workers/pythonMessages'

// The Python console's session (plan 29-D): the worker, its start-up, the
// inputs run one at a time, the log, and Stop. Python's requests for data
// are answered by a provider the app gives (29-D4); a request the protocol
// does not have is refused. Without SharedArrayBuffer, Stop ends the worker
// and starts another, and the variables are lost (29-D2).

export type PythonSessionStatus =
  'idle' | 'unsupported' | 'loading' | 'ready' | 'running' | 'failed'

export type PythonLogKind = 'input' | 'stdout' | 'stderr' | 'result' | 'error' | 'info'

export interface PythonLogEntry {
  readonly id: number
  readonly kind: PythonLogKind
  readonly text: string
}

export interface PythonSessionSnapshot {
  readonly status: PythonSessionStatus
  // What start-up is doing, while loading.
  readonly progress: string | null
  // Why the console cannot run, when unsupported or failed.
  readonly message: string | null
  readonly pythonVersion: string | null
  readonly log: readonly PythonLogEntry[]
}

export interface PythonDataAnswer {
  readonly value: PythonDataValue
  readonly transfer?: readonly Transferable[]
}

export interface PythonDataProvider {
  readonly answer: (request: PythonDataRequest) => Promise<PythonDataAnswer>
}

export interface PythonWorkerLike {
  postMessage(message: PythonWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent<PythonWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export interface PythonSessionOptions {
  readonly createWorker: () => PythonWorkerLike
  // Where `pyodide/` is served, ending in "/".
  readonly indexUrl: string
  readonly data: PythonDataProvider
  // WebAssembly JSPI, which blocking reads need (29-D5).
  readonly supported?: boolean
  // Whether Stop can interrupt rather than restart.
  readonly crossOriginIsolated?: boolean
  readonly maxLogEntries?: number
  // How long Stop waits for KeyboardInterrupt before restarting.
  readonly interruptGraceMs?: number
  // After each input ends, finished, failed or stopped: the canvas draws
  // the input's layers once (29-D8).
  readonly onRunEnd?: () => void
}

export type PythonRunOutcome = PythonRunStatus | 'stopped'

export interface PythonCompletions {
  // Where the text they replace starts.
  readonly from: number
  readonly items: readonly string[]
}

export const PYTHON_UNSUPPORTED_MESSAGE =
  'The Python console needs Chrome or Edge: this browser cannot pause Python while it reads data (WebAssembly JSPI).'
export const PYTHON_RESTARTED_MESSAGE =
  'Python was restarted. Its variables and imports were lost.'

const MAX_LOG_ENTRIES = 2_000

export function pythonSupported(): boolean {
  return typeof (WebAssembly as { Suspending?: unknown }).Suspending === 'function'
}

interface PendingRun {
  readonly id: number
  readonly code: string
  readonly resolve: (outcome: PythonRunOutcome) => void
}

export class PythonSession {
  readonly #options: PythonSessionOptions
  readonly #listeners = new Set<() => void>()
  #snapshot: PythonSessionSnapshot = {
    status: 'idle',
    progress: null,
    message: null,
    pythonVersion: null,
    log: [],
  }
  #log: PythonLogEntry[] = []
  #nextLogId = 1
  #nextId = 1
  #worker: PythonWorkerLike | null = null
  #interruptBuffer: Uint8Array | null = null
  #ready: Promise<boolean> | null = null
  #readyResolve: ((ready: boolean) => void) | null = null
  #runs = new Map<number, PendingRun>()
  #completions = new Map<number, (completions: PythonCompletions) => void>()
  #notifyQueued = false
  #interruptTimer: ReturnType<typeof setTimeout> | null = null
  #disposed = false

  constructor(options: PythonSessionOptions) {
    this.#options = options
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): PythonSessionSnapshot => this.#snapshot

  // Starts Python, once; again after a failure.
  start(): void {
    if (this.#disposed) return
    const { status } = this.#snapshot
    if (status === 'loading' || status === 'ready' || status === 'running') return
    if (this.#options.supported === false) {
      this.#set({ status: 'unsupported', message: PYTHON_UNSUPPORTED_MESSAGE })
      return
    }
    this.#startWorker()
  }

  // Runs an input. An incomplete one (an open block, a bracket) is not run
  // or logged, so the prompt adds a line; a complete one is logged as it
  // starts, above its output.
  async run(code: string): Promise<PythonRunOutcome> {
    this.start()
    if (!(await this.#whenReady())) return 'stopped'
    const worker = this.#worker
    if (worker === null) return 'stopped'
    const id = this.#takeId()
    const outcome = new Promise<PythonRunOutcome>((resolve) => {
      this.#runs.set(id, { id, code, resolve })
    })
    this.#set({ status: 'running' })
    worker.postMessage({ type: 'run', id, code })
    return outcome
  }

  // Completions for the token before the cursor; none while Python is not
  // ready.
  async complete(code: string, cursor: number): Promise<PythonCompletions> {
    const worker = this.#worker
    if (worker === null || this.#snapshot.status !== 'ready') {
      return { from: cursor, items: [] }
    }
    const id = this.#takeId()
    return new Promise((resolve) => {
      this.#completions.set(id, resolve)
      worker.postMessage({ type: 'complete', id, code, cursor })
    })
  }

  // Stops the input running: KeyboardInterrupt where the page allows it,
  // otherwise a new Python.
  stop(): void {
    if (this.#snapshot.status !== 'running' && this.#snapshot.status !== 'loading') return
    const buffer = this.#interruptBuffer
    if (buffer !== null && this.#snapshot.status === 'running') {
      buffer[0] = 2
      this.#interruptTimer ??= setTimeout(() => {
        this.#interruptTimer = null
        if (this.#snapshot.status === 'running') this.restart()
      }, this.#options.interruptGraceMs ?? 1_500)
      return
    }
    this.restart()
  }

  // A new Python: variables go, the log stays.
  restart(): void {
    if (this.#disposed) return
    const hadPython = this.#worker !== null
    this.#endWorker('stopped')
    if (hadPython) this.#append('info', PYTHON_RESTARTED_MESSAGE)
    this.#startWorker()
  }

  // Another dataset, or other cells: Python forgets cached columns.
  datasetChanged(): void {
    this.#worker?.postMessage({ type: 'dataset' })
  }

  clearLog(): void {
    this.#log = []
    this.#set({ log: [] })
  }

  dispose(): void {
    this.#disposed = true
    this.#endWorker('stopped')
    this.#listeners.clear()
  }

  #startWorker(): void {
    let worker: PythonWorkerLike
    try {
      worker = this.#options.createWorker()
    } catch (error) {
      this.#set({
        status: 'failed',
        progress: null,
        message: `Python could not start: ${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }
    this.#worker = worker
    this.#interruptBuffer =
      this.#options.crossOriginIsolated === true &&
      typeof SharedArrayBuffer === 'function'
        ? new Uint8Array(new SharedArrayBuffer(1))
        : null
    this.#ready = new Promise((resolve) => {
      this.#readyResolve = resolve
    })
    worker.onmessage = (event) => {
      if (this.#worker === worker) this.#receive(event.data)
    }
    worker.onerror = (event) => {
      if (this.#worker !== worker) return
      event.preventDefault()
      this.#fail(event.message || 'The Python worker stopped.')
    }
    this.#set({ status: 'loading', progress: 'Starting Python', message: null })
    worker.postMessage({
      type: 'start',
      indexUrl: this.#options.indexUrl,
      interruptBuffer: this.#interruptBuffer,
    })
  }

  #endWorker(outcome: PythonRunOutcome): void {
    if (this.#interruptTimer !== null) {
      clearTimeout(this.#interruptTimer)
      this.#interruptTimer = null
    }
    this.#worker?.terminate()
    this.#worker = null
    this.#interruptBuffer = null
    this.#readyResolve?.(false)
    this.#readyResolve = null
    this.#ready = null
    const hadRuns = this.#runs.size > 0
    for (const run of this.#runs.values()) run.resolve(outcome)
    this.#runs.clear()
    if (hadRuns) this.#options.onRunEnd?.()
    for (const resolve of this.#completions.values()) resolve({ from: 0, items: [] })
    this.#completions.clear()
  }

  #fail(message: string): void {
    this.#endWorker('stopped')
    this.#set({ status: 'failed', progress: null, message })
  }

  async #whenReady(): Promise<boolean> {
    if (this.#snapshot.status === 'ready') return true
    return (await this.#ready) ?? false
  }

  #receive(message: PythonWorkerResponse): void {
    switch (message.type) {
      case 'progress':
        this.#set({ progress: message.message })
        return
      case 'ready':
        this.#set({
          status: 'ready',
          progress: null,
          pythonVersion: message.pythonVersion,
        })
        this.#readyResolve?.(true)
        this.#readyResolve = null
        return
      case 'failed':
        this.#fail(`Python could not start: ${message.message}`)
        return
      case 'output':
        this.#append(message.stream, message.text)
        return
      case 'started': {
        const run = this.#runs.get(message.id)
        if (run !== undefined) this.#append('input', run.code)
        return
      }
      case 'done': {
        const run = this.#runs.get(message.id)
        this.#runs.delete(message.id)
        if (this.#interruptBuffer !== null) this.#interruptBuffer[0] = 0
        if (this.#interruptTimer !== null) {
          clearTimeout(this.#interruptTimer)
          this.#interruptTimer = null
        }
        if (message.display !== null) this.#append('result', message.display)
        if (message.error !== null) this.#append('error', message.error)
        if (this.#runs.size === 0) this.#set({ status: 'ready' })
        this.#options.onRunEnd?.()
        run?.resolve(message.status)
        return
      }
      case 'completions': {
        const resolve = this.#completions.get(message.id)
        this.#completions.delete(message.id)
        resolve?.({ from: message.start, items: message.items })
        return
      }
      case 'request':
        this.#answer(message.id, message.request)
        return
    }
  }

  #answer(id: number, raw: unknown): void {
    const worker = this.#worker
    if (worker === null) return
    const request = parsePythonDataRequest(raw)
    if (request === null) {
      worker.postMessage({
        type: 'reply',
        id,
        ok: false,
        error: { name: 'DataError', message: 'The app does not answer this request.' },
      })
      return
    }
    this.#options.data.answer(request).then(
      (answer) => {
        if (this.#worker !== worker) return
        worker.postMessage({ type: 'reply', id, ok: true, value: answer.value }, [
          ...(answer.transfer ?? []),
        ])
      },
      (error: unknown) => {
        if (this.#worker !== worker) return
        worker.postMessage({
          type: 'reply',
          id,
          ok: false,
          error: pythonDataError(error),
        })
      },
    )
  }

  #append(kind: PythonLogKind, text: string): void {
    this.#log.push({ id: this.#nextLogId, kind, text })
    this.#nextLogId += 1
    const max = this.#options.maxLogEntries ?? MAX_LOG_ENTRIES
    if (this.#log.length > max) this.#log.splice(0, this.#log.length - max)
    // Output arrives a line at a time; one snapshot per task.
    if (this.#notifyQueued) return
    this.#notifyQueued = true
    queueMicrotask(() => {
      this.#notifyQueued = false
      this.#set({ log: [...this.#log] })
    })
  }

  #takeId(): number {
    const id = this.#nextId
    this.#nextId += 1
    return id
  }

  #set(change: Partial<PythonSessionSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change }
    for (const listener of this.#listeners) listener()
  }
}

// An error as Python raises it: a read over the budget, or anything else.
export function pythonDataError(error: unknown): PythonDataError {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  const bytes = (error as { bytes?: unknown } | null)?.bytes
  const size = typeof bytes === 'number' ? { bytes } : {}
  if (name === 'ReadTooLarge' || name === 'GeneReadTooLarge') {
    return { name: 'ReadTooLarge', message, ...size }
  }
  if (name === 'ReadRefused' || name === 'GeneReadRefused') {
    return { name: 'ReadRefused', message, ...size }
  }
  return { name: 'DataError', message }
}
