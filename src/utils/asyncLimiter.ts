// Runs at most `maxConcurrent` tasks at once; the rest wait in call order.
export function createAsyncLimiter(
  maxConcurrent: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  const queue: Array<() => void> = []
  let active = 0

  return async function runLimited<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      // A finishing task hands its slot straight to the next waiter, so a
      // task that arrives before the waiter resumes cannot take it.
      await new Promise<void>((resolve) => {
        queue.push(resolve)
      })
    } else {
      active += 1
    }

    try {
      return await task()
    } finally {
      const next = queue.shift()

      if (next === undefined) {
        active -= 1
      } else {
        next()
      }
    }
  }
}
