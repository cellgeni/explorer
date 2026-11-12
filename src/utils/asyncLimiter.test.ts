import { describe, expect, it } from 'vitest'
import { createAsyncLimiter } from './asyncLimiter'

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// Records which tasks are running and the most that ran at once.
function tracker() {
  const running = new Set<string>()
  const started: string[] = []
  let peak = 0

  return {
    started,
    running,
    peak: () => peak,
    task<T>(name: string, work: Promise<T>): () => Promise<T> {
      return async () => {
        running.add(name)
        started.push(name)
        peak = Math.max(peak, running.size)

        try {
          return await work
        } finally {
          running.delete(name)
        }
      }
    },
  }
}

describe('createAsyncLimiter', () => {
  it('runs at most maxConcurrent tasks and starts the rest in call order', async () => {
    const limit = createAsyncLimiter(2)
    const track = tracker()
    const work = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, gate: deferred() }))
    const results = work.map(({ name, gate }) =>
      limit(
        track.task(
          name,
          gate.promise.then(() => name.toUpperCase()),
        ),
      ),
    )

    await settle()
    expect(track.started).toEqual(['a', 'b'])

    work[1]!.gate.resolve()
    await settle()
    expect(track.started).toEqual(['a', 'b', 'c'])
    expect([...track.running]).toEqual(['a', 'c'])

    work[0]!.gate.resolve()
    work[2]!.gate.resolve()
    await settle()
    expect(track.started).toEqual(['a', 'b', 'c', 'd', 'e'])

    work[3]!.gate.resolve()
    work[4]!.gate.resolve()
    await expect(Promise.all(results)).resolves.toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(track.peak()).toBe(2)

    // Every slot is free again once the queue drains: two new tasks start at once.
    void limit(track.task('f', new Promise(() => {})))
    void limit(track.task('g', new Promise(() => {})))
    expect(track.started.slice(-2)).toEqual(['f', 'g'])
  })

  it('passes a rejection to its caller and frees the slot', async () => {
    const limit = createAsyncLimiter(1)
    const failure = new Error('range request failed')
    const first = limit(() => Promise.reject(failure))
    const second = limit(async () => 'next')

    await expect(first).rejects.toBe(failure)
    await expect(second).resolves.toBe('next')
  })

  it('frees the slot when a task throws synchronously', async () => {
    const limit = createAsyncLimiter(1)
    const first = limit(() => {
      throw new Error('bad key')
    })

    await expect(first).rejects.toThrow('bad key')
    await expect(limit(async () => 7)).resolves.toBe(7)
  })

  it('keeps the limit when a task arrives as a slot passes to a queued one', async () => {
    const limit = createAsyncLimiter(1)
    const started: string[] = []
    const gates = { first: deferred(), queued: deferred(), late: deferred() }
    const run = (name: keyof typeof gates) =>
      limit(() => {
        started.push(name)
        return gates[name].promise
      })

    void run('first')
    void run('queued')
    await settle()
    expect(started).toEqual(['first'])

    // The first task finishes, and a microtask queued in the same tick asks
    // for a slot before the queued task has resumed.
    gates.first.resolve()
    queueMicrotask(() => {
      void run('late')
    })
    await settle()

    // Neither 'queued' nor 'late' has finished: starting both would run two
    // tasks at once and let 'late' overtake the task that was waiting.
    expect(started).toEqual(['first', 'queued'])

    gates.queued.resolve()
    await settle()
    expect(started).toEqual(['first', 'queued', 'late'])
    gates.late.resolve()
  })
})
