// Runs `task` over `items` with at most `concurrency` tasks in flight and
// returns the results in item order.
export async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  task: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length)
  let next = 0

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index] as Item)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () =>
      worker(),
    ),
  )
  return results
}
