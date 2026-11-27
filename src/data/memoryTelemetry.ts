// What each cache and worker pool holds, for Data access notes (O20). Each
// registers a reporter here, by a name the table shows. Counts are read on
// the main thread at once; a worker answers for its own memory, so its bytes
// may come later, or not at all while it is busy with a long read.

export interface MemoryReading {
  // Items held, such as tiles, chunks or open files.
  readonly entries: number
  readonly workers: number
  // Bytes held; a promise when workers report them, and null when they are
  // not measured (a pool of decode workers, the dataset objects).
  readonly bytes: number | null | Promise<number | null>
}

export interface MemoryReport {
  readonly name: string
  readonly entries: number
  readonly workers: number
  // Null when not measured, or not reported in time.
  readonly bytes: number | null
}

export interface MemoryTotals {
  readonly entries: number
  readonly workers: number
  // The bytes reported; caches that report none are left out.
  readonly bytes: number
}

const reporters = new Map<string, () => MemoryReading>()

// A worker busy with a long read answers after it; its bytes are left out
// rather than holding up the table.
const DEFAULT_REPORT_TIMEOUT_MS = 2_000

// Registers `read` under `name`, replacing one of the same name. Returns what
// removes it.
export function registerMemoryReporter(
  name: string,
  read: () => MemoryReading,
): () => void {
  reporters.set(name, read)
  return () => {
    if (reporters.get(name) === read) {
      reporters.delete(name)
    }
  }
}

// Every reporter's reading, in the order they registered. A reporter that
// throws, or whose bytes do not come within `timeoutMs`, reports what it can.
export async function readMemoryReports(
  options: { readonly timeoutMs?: number } = {},
): Promise<readonly MemoryReport[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS
  const readings = [...reporters].map(([name, read]) => {
    try {
      return { name, reading: read() }
    } catch {
      return { name, reading: { entries: 0, workers: 0, bytes: null } }
    }
  })

  return Promise.all(
    readings.map(async ({ name, reading }) => ({
      name,
      entries: reading.entries,
      workers: reading.workers,
      bytes: await withinTimeout(reading.bytes, timeoutMs),
    })),
  )
}

export function memoryTotals(reports: readonly MemoryReport[]): MemoryTotals {
  let entries = 0
  let workers = 0
  let bytes = 0

  for (const report of reports) {
    entries += report.entries
    workers += report.workers
    bytes += report.bytes ?? 0
  }

  return { entries, workers, bytes }
}

// Bytes summed over values a worker reports one by one: null when none of
// them answered, else what those that did held.
export async function sumReportedBytes(
  values: readonly Promise<number | null>[],
): Promise<number | null> {
  const settled = await Promise.allSettled(values)
  let total: number | null = null

  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value !== null) {
      total = (total ?? 0) + result.value
    }
  }

  return total
}

// Instances counted while they live: held weakly, so one dropped without a
// close step is left out once it is collected.
export class LiveInstances<T extends object> {
  private readonly refs = new Set<WeakRef<T>>()
  private readonly byInstance = new WeakMap<T, WeakRef<T>>()

  add(instance: T): void {
    if (this.byInstance.has(instance)) return

    const ref = new WeakRef(instance)
    this.byInstance.set(instance, ref)
    this.refs.add(ref)
  }

  delete(instance: T): void {
    const ref = this.byInstance.get(instance)

    if (ref === undefined) return

    this.byInstance.delete(instance)
    this.refs.delete(ref)
  }

  *[Symbol.iterator](): IterableIterator<T> {
    for (const ref of this.refs) {
      const instance = ref.deref()

      if (instance === undefined) {
        this.refs.delete(ref)
      } else {
        yield instance
      }
    }
  }
}

// Workers counted under `name`, with no bytes measured: add each when it
// starts, and delete it when it is terminated.
export function workerTally(name: string): LiveInstances<object> {
  const workers = new LiveInstances<object>()

  registerMemoryReporter(name, () => ({
    entries: 0,
    workers: [...workers].length,
    bytes: null,
  }))
  return workers
}

async function withinTimeout(
  bytes: MemoryReading['bytes'],
  timeoutMs: number,
): Promise<number | null> {
  if (!(bytes instanceof Promise)) return bytes

  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      bytes.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
