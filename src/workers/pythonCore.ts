import type { PyodideAPI } from 'pyodide'
import type { PyProxy } from 'pyodide/ffi'
import type {
  PythonDataReply,
  PythonRunStatus,
  PythonWorkerRequest,
  PythonWorkerResponse,
} from './pythonMessages'

// The Python console's worker (plan 29-D): starts Pyodide and NumPy, writes
// the `explorer` package and the runner into Python's file system, and runs
// inputs one at a time. Python asks the main thread for data through
// `request`, which `run_sync` waits on (29-D5); replies are handled at once,
// even while an input runs. Everything else waits its turn.

export interface PythonCoreOptions {
  readonly post: (message: PythonWorkerResponse, transfer?: Transferable[]) => void
  readonly loadPyodide: (options: {
    readonly indexURL: string
    readonly stdout: (text: string) => void
    readonly stderr: (text: string) => void
  }) => Promise<PyodideAPI>
  // Python sources by path under /home/pyodide, such as
  // "explorer/__init__.py" and "explorer_runtime.py".
  readonly sources: Readonly<Record<string, string>>
}

export interface PythonCore {
  readonly handle: (message: PythonWorkerRequest) => void
}

const HOME = '/home/pyodide'

export function createPythonCore({
  post,
  loadPyodide,
  sources,
}: PythonCoreOptions): PythonCore {
  let nextRequestId = 1
  const pending = new Map<
    number,
    {
      readonly resolve: (value: unknown) => void
      readonly reject: (error: Error) => void
    }
  >()
  let runtime: PyProxy | null = null
  let queue: Promise<void> = Promise.resolve()

  // What Python calls. A typed array out of the heap is copied, so the reply
  // can be transferred and the heap may grow meanwhile.
  const request = (message: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextRequestId
      nextRequestId += 1
      pending.set(id, { resolve, reject })
      const copied = copyArrays(message)
      post({ type: 'request', id, request: copied.value }, copied.transfer)
    })

  const reply = (message: PythonDataReply) => {
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.ok) {
      entry.resolve(message.value)
    } else {
      const error = new Error(message.error.message)
      error.name = message.error.name
      Object.assign(error, { bytes: message.error.bytes ?? 0 })
      entry.reject(error)
    }
  }

  const start = async (indexUrl: string, interruptBuffer: Uint8Array | null) => {
    post({ type: 'progress', message: 'Starting Python' })
    const pyodide = await loadPyodide({
      indexURL: indexUrl,
      stdout: (text) => {
        post({ type: 'output', stream: 'stdout', text })
      },
      stderr: (text) => {
        post({ type: 'output', stream: 'stderr', text })
      },
    })
    if (interruptBuffer !== null) pyodide.setInterruptBuffer(interruptBuffer)
    post({ type: 'progress', message: 'Loading NumPy' })
    await pyodide.loadPackage('numpy', { messageCallback: () => undefined })
    post({ type: 'progress', message: 'Importing NumPy' })
    for (const [file, source] of Object.entries(sources)) {
      const target = `${HOME}/${file}`
      pyodide.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')))
      pyodide.FS.writeFile(target, source)
    }
    await pyodide.runPythonAsync(
      `import sys\nif ${JSON.stringify(HOME)} not in sys.path: sys.path.insert(0, ${JSON.stringify(HOME)})`,
    )
    const module = pyodide.pyimport('explorer_runtime') as PyProxy & {
      setup: (request: (message: unknown) => Promise<unknown>) => void
    }
    module.setup(request)
    runtime = module
    const version = pyodide.runPython('import sys; sys.version.split()[0]') as string
    post({ type: 'ready', pythonVersion: version })
    return pyodide
  }

  let pyodide: Promise<PyodideAPI> | null = null

  const call = async <T>(name: string, ...args: unknown[]): Promise<T> => {
    const api = await pyodide
    if (api === undefined || api === null || runtime === null) {
      throw new Error('Python has not started.')
    }
    const globals = api.toPy({ runtime, args }) as PyProxy
    try {
      const result = (await api.runPythonAsync(`await runtime.${name}(*args)`, {
        globals,
      } as Parameters<PyodideAPI['runPythonAsync']>[1])) as PyProxy | T
      return isPyProxy(result)
        ? (result.toJs({ dict_converter: Object.fromEntries }) as T)
        : result
    } finally {
      globals.destroy()
    }
  }

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work, work)
  }

  return {
    handle(message) {
      switch (message.type) {
        case 'reply':
          reply(message)
          return
        case 'start':
          pyodide = start(message.indexUrl, message.interruptBuffer)
          pyodide.catch((error: unknown) => {
            post({ type: 'failed', message: errorMessage(error) })
          })
          return
        case 'run':
          enqueue(async () => {
            try {
              const complete = await call<boolean>('is_complete', message.code)
              if (!complete) {
                post({
                  type: 'done',
                  id: message.id,
                  status: 'incomplete',
                  display: null,
                  error: null,
                })
                return
              }
              post({ type: 'started', id: message.id })
              const result = await call<{
                status: PythonRunStatus
                display: string | null
                error: string | null
              }>('run', message.code)
              // Python's None arrives as undefined.
              post({
                type: 'done',
                id: message.id,
                status: result.status,
                display: result.display ?? null,
                error: result.error ?? null,
              })
            } catch (error) {
              post({
                type: 'done',
                id: message.id,
                status: 'error',
                display: null,
                error: errorMessage(error),
              })
            }
          })
          return
        case 'complete':
          enqueue(async () => {
            const { start, items } = await call<{ start: number; items: string[] }>(
              'complete',
              message.code,
              message.cursor,
            ).catch(() => ({ start: message.cursor, items: [] }))
            post({ type: 'completions', id: message.id, start, items })
          })
          return
        case 'dataset':
          enqueue(async () => {
            if (runtime === null) return
            await call('invalidate')
          })
          return
      }
    },
  }
}

function isPyProxy(value: unknown): value is PyProxy {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toJs?: unknown }).toJs === 'function' &&
    typeof (value as { destroy?: unknown }).destroy === 'function'
  )
}

// A request with every typed array copied out of the wasm heap, and those
// copies' buffers to transfer.
function copyArrays(value: unknown): { value: unknown; transfer: Transferable[] } {
  const transfer: Transferable[] = []
  const copy = (item: unknown): unknown => {
    if (ArrayBuffer.isView(item) && !(item instanceof DataView)) {
      const copied = (item as Uint8Array).slice()
      transfer.push(copied.buffer)
      return copied
    }
    if (Array.isArray(item)) return item.map(copy)
    if (typeof item === 'object' && item !== null) {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([key, entry]) => [
          key,
          copy(entry),
        ]),
      )
    }
    return item
  }
  return { value: copy(value), transfer }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
