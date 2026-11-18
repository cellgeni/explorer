import { describe, expect, it, vi } from 'vitest'
import { MorphologyTileStore } from './morphologyTileStore'
import type { MorphologyTileChannelSpec } from './morphologyTileStore'

function spec(key: string, maxTiles = 24): MorphologyTileChannelSpec {
  return {
    key,
    cacheOptions: () => ({ maxTiles, decodeTile: vi.fn() }),
  }
}

describe('morphology tile store (plan 23-D11)', () => {
  it('gives canvases drawing the same channel one cache', () => {
    const store = new MorphologyTileStore()
    const [first] = store.use('a', [spec('dapi')])
    const [second] = store.use('b', [spec('dapi')])

    expect(second?.cache).toBe(first?.cache)
  })

  it('sizes a new channel by the channels it already holds', () => {
    const store = new MorphologyTileStore()
    const held: number[] = []
    const counted = (key: string): MorphologyTileChannelSpec => ({
      key,
      cacheOptions: (heldChannels) => {
        held.push(heldChannels)
        return { maxTiles: 24, decodeTile: vi.fn() }
      },
    })

    store.use('a', [counted('dapi'), counted('cd3')])

    expect(held).toEqual([0, 1])
  })

  it('drops a channel a canvas moves off once no canvas draws it', () => {
    const store = new MorphologyTileStore()
    const [dapi] = store.use('a', [spec('dapi')])
    store.use('b', [spec('dapi')])
    const clear = vi.spyOn(dapi!.cache, 'clear')

    store.use('a', [spec('cd3')])
    expect(clear).not.toHaveBeenCalled()

    store.use('b', [spec('cd3')])
    expect(clear).toHaveBeenCalledOnce()
    expect(store.use('c', [spec('dapi')])[0]?.cache).not.toBe(dapi?.cache)
  })

  it('keeps a channel whose canvases unmount, until another channel set', () => {
    const store = new MorphologyTileStore()
    const [dapi] = store.use('a', [spec('dapi')])
    const clear = vi.spyOn(dapi!.cache, 'clear')

    store.release('a')
    expect(store.use('b', [spec('dapi')])[0]?.cache).toBe(dapi?.cache)

    store.release('b')
    store.use('c', [spec('cd3')])
    expect(clear).toHaveBeenCalledOnce()
  })

  it('clears every channel when disposed', () => {
    const store = new MorphologyTileStore()
    const channels = store.use('a', [spec('dapi'), spec('cd3')])
    const clears = channels.map((channel) => vi.spyOn(channel.cache, 'clear'))

    store.dispose()

    for (const clear of clears) expect(clear).toHaveBeenCalledOnce()
  })

  it('decodes a flat image once for its canvases, and keeps the latest only', () => {
    const store = new MorphologyTileStore()
    const first = store.flatImage('https://example.test/hires.png')

    expect(store.flatImage('https://example.test/hires.png')).toBe(first)

    store.flatImage('https://example.test/other.png')
    expect(store.flatImage('https://example.test/hires.png')).not.toBe(first)
  })
})
