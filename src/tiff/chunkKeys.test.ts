import { describe, expect, it } from 'vitest'
import { tiffChunkKey } from './chunkKeys'

describe('tiffChunkKey', () => {
  it('writes level, row and column separated by slashes', () => {
    expect(tiffChunkKey(0, 0, 0)).toBe('0/0/0')
    expect(tiffChunkKey(3, 12, 7)).toBe('3/12/7')
  })

  it('keeps row and column apart', () => {
    expect(tiffChunkKey(1, 2, 3)).not.toBe(tiffChunkKey(1, 3, 2))
  })

  it('gives every tile of a pyramid its own key', () => {
    const keys = new Set<string>()
    let tiles = 0

    // Digits that run together without a separator, such as level 1 row 12
    // and level 11 row 2, must still give different keys.
    for (let level = 0; level < 12; level += 1) {
      for (let row = 0; row < 13; row += 1) {
        for (let col = 0; col < 13; col += 1) {
          keys.add(tiffChunkKey(level, row, col))
          tiles += 1
        }
      }
    }

    expect(keys.size).toBe(tiles)
  })
})
