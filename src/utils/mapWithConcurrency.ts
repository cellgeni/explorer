// Runs `task` over `items` with at most `concurrency` tasks in flight and
// returns the results in item order. Once a task fails no other starts, so
// nothing is still being read after the caller sees the failure but the
// tasks already in flight; it rejects with the first error.
export async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  task: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length)
  let next = 0
  let failed = false

  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next
      next += 1

      try {
        results[index] = await task(items[index] as Item)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () =>
      worker(),
    ),
  )
  return results
}
