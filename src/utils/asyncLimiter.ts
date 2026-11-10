// Runs at most `maxConcurrent` tasks at once; the rest wait in call order.
export function createAsyncLimiter(
  maxConcurrent: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  const queue: Array<() => void> = []
  let active = 0

  return async function runLimited<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        queue.push(resolve)
      })
    }

    active += 1

    try {
      return await task()
    } finally {
      active -= 1
      queue.shift()?.()
    }
  }
}
