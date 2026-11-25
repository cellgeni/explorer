// A lookup by ID that builds its Map on first use. On a slide of 1.4 million
// cells each Map of every cell took 0.1-0.4 s of the load's longest
// main-thread stretch, and the load reads none of them: lookups come with a
// hover, a click, outlines, an annotation import or Cell Query
// (optimization pass, O5).

export interface IdLookup<Value> {
  get(id: string): Value | undefined
  has(id: string): boolean
  // The number of distinct IDs, as a Map's size.
  readonly size: number
}

// As `new Map(items.map((item, index) => [idOf(item), valueOf(item, index)]))`:
// a repeated ID keeps its last value.
export function lazyIdLookup<Item, Value>(
  items: readonly Item[],
  idOf: (item: Item) => string,
  valueOf: (item: Item, index: number) => Value,
): IdLookup<Value> {
  let byId: Map<string, Value> | null = null
  const built = (): Map<string, Value> => {
    if (byId === null) {
      byId = new Map()

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index] as Item
        byId.set(idOf(item), valueOf(item, index))
      }
    }

    return byId
  }

  return {
    get: (id) => built().get(id),
    has: (id) => built().has(id),
    get size() {
      return built().size
    },
  }
}
