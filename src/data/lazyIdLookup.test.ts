import { lazyIdLookup } from './lazyIdLookup'

describe('lazyIdLookup', () => {
  const items = [
    { id: 'a', value: 1 },
    { id: 'b', value: 2 },
    { id: 'a', value: 3 },
  ]

  it('reads no item until it is first asked', () => {
    const idOf = vi.fn((item: (typeof items)[number]) => item.id)
    const lookup = lazyIdLookup(items, idOf, (item) => item.value)

    expect(idOf).not.toHaveBeenCalled()
    expect(lookup.get('b')).toBe(2)
    expect(lookup.has('c')).toBe(false)
    expect(idOf).toHaveBeenCalledTimes(items.length)
  })

  it('answers as a Map of the items would, the last of a repeated ID winning', () => {
    const lookup = lazyIdLookup(
      items,
      (item) => item.id,
      (_, index) => index,
    )
    const map = new Map(items.map((item, index) => [item.id, index]))

    expect(lookup.size).toBe(map.size)
    expect(lookup.get('a')).toBe(map.get('a'))
    expect(lookup.has('b')).toBe(true)
    expect(lazyIdLookup([], String, () => 0).size).toBe(0)
  })
})
