import { describe, expect, it } from 'vitest'
import { sampleDecodedTile, type TileSampling } from './tileSamples'

// The rule sampleDecodedTile implements, one pixel at a time.
function referenceSamples(
  pixels: ArrayLike<number>,
  decodedWidth: number,
  decodedHeight: number,
  sampling: TileSampling,
): { readonly samples: number[]; readonly pixelCount: number } {
  const width = Math.min(sampling.width, decodedWidth)
  const height = Math.min(sampling.height, decodedHeight)
  const samples: number[] = []
  let pixelIndex = sampling.startIndex

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixelIndex % sampling.stride === 0) {
        samples.push(pixels[y * decodedWidth + x] ?? 0)
      }

      pixelIndex += 1
    }
  }

  return { samples, pixelCount: width * height }
}

describe('sampleDecodedTile', () => {
  it('continues the stride from earlier tiles and crops padded edges', () => {
    // A 3 x 2 visible area in a 4 x 3 decoded tile; padding is 900.
    const pixels = Uint16Array.from([1, 2, 3, 900, 4, 5, 6, 900, 900, 900, 900, 900])
    const tile = sampleDecodedTile(pixels, 4, 3, {
      startIndex: 5,
      stride: 3,
      width: 3,
      height: 2,
    })

    // Level pixels 6 and 9 are this tile's pixels 1 and 4.
    expect(Array.from(tile.samples)).toEqual([2, 5])
    expect(tile.pixelCount).toBe(6)
  })

  it('crops the visible area to a smaller decoded tile', () => {
    const tile = sampleDecodedTile(Uint8Array.from([7, 8]), 2, 1, {
      startIndex: 0,
      stride: 1,
      width: 4,
      height: 4,
    })

    expect(Array.from(tile.samples)).toEqual([7, 8])
    expect(tile.pixelCount).toBe(2)
  })

  it('samples nothing from a tile with no pixels', () => {
    const tile = sampleDecodedTile([], 0, 0, {
      startIndex: 3,
      stride: 2,
      width: 4,
      height: 4,
    })

    expect(tile.samples).toHaveLength(0)
    expect(tile.pixelCount).toBe(0)
  })

  it('matches sampling pixel by pixel', () => {
    for (const [decodedWidth, decodedHeight, width, height, startIndex, stride] of [
      [5, 4, 5, 4, 0, 1],
      [5, 4, 3, 2, 7, 4],
      [8, 8, 8, 5, 13, 6],
      [7, 3, 7, 3, 2, 50],
      [16, 16, 9, 11, 1_000_003, 17],
    ] as const) {
      const pixels = Float32Array.from(
        { length: decodedWidth * decodedHeight },
        (_value, index) => index * 1.5,
      )
      const sampling = { startIndex, stride, width, height }
      const tile = sampleDecodedTile(pixels, decodedWidth, decodedHeight, sampling)
      const expected = referenceSamples(pixels, decodedWidth, decodedHeight, sampling)

      expect(Array.from(tile.samples)).toEqual(expected.samples)
      expect(tile.pixelCount).toBe(expected.pixelCount)
    }
  })
})
