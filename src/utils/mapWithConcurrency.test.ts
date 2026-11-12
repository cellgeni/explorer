import { describe, expect, it, vi } from 'vitest'
import { mapWithConcurrency } from './mapWithConcurrency'

function deferred<T>() {
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

describe('mapWithConcurrency', () => {
  it('keeps at most `concurrency` tasks in flight and starts them in item order', async () => {
    const items = [0, 1, 2, 3, 4, 5, 6]
    const gates = items.map(() => deferred<void>())
    const started: number[] = []
    let inFlight = 0
    let peak = 0
    const result = mapWithConcurrency(items, 3, async (item) => {
      started.push(item)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await gates[item]!.promise
      inFlight -= 1
      return item * 10
    })

    await settle()
    expect(started).toEqual([0, 1, 2])

    // Finishing one task frees exactly one slot, for the next item.
    gates[1]!.resolve()
    await settle()
    expect(started).toEqual([0, 1, 2, 3])

    for (const gate of gates) {
      gate.resolve()
    }

    await expect(result).resolves.toEqual([0, 10, 20, 30, 40, 50, 60])
    expect(started).toEqual(items)
    expect(peak).toBe(3)
  })

  it('returns results in item order when tasks finish out of order', async () => {
    const gates = ['a', 'b', 'c', 'd'].map(() => deferred<string>())
    const result = mapWithConcurrency([0, 1, 2, 3], 4, (index) => gates[index]!.promise)

    for (const [index, gate] of [...gates.entries()].reverse()) {
      gate.resolve(`item-${index}`)
      await settle()
    }

    await expect(result).resolves.toEqual(['item-0', 'item-1', 'item-2', 'item-3'])
  })

  it('runs each item once even when concurrency exceeds the item count', async () => {
    const task = vi.fn(async (item: string) => item.length)

    await expect(mapWithConcurrency(['ab', 'c'], 16, task)).resolves.toEqual([2, 1])
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('runs one at a time when concurrency is below one', async () => {
    let inFlight = 0
    let peak = 0
    const result = await mapWithConcurrency([1, 2, 3], 0, async (item) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await settle()
      inFlight -= 1
      return item
    })

    expect(result).toEqual([1, 2, 3])
    expect(peak).toBe(1)
  })

  it('resolves an empty list without calling the task', async () => {
    const task = vi.fn(async () => 1)

    await expect(mapWithConcurrency([], 4, task)).resolves.toEqual([])
    expect(task).not.toHaveBeenCalled()
  })

  it('rejects with the first task error', async () => {
    const failure = new Error('chunk 2 failed')
    const result = mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) {
        throw failure
      }

      return item
    })

    await expect(result).rejects.toBe(failure)
  })
})
