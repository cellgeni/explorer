import { describe, expect, it, vi } from 'vitest'
import { imagePixels } from './coords'
import { computeChannelAutoContrast } from './morphologyContrast'
import type { DecodedJpeg2000 } from '../codecs/jpeg2000'
import type { AutoContrastTileLoader } from './morphologyContrast'

describe('computeChannelAutoContrast', () => {
  it('computes robust contrast from the smallest pyramid level', async () => {
    const loader = fakeLoader({
      numLevels: 3,
      tiles: [{ col: 0, row: 0 }],
      sourceWidth: 6,
      sourceHeight: 1,
    })
    const decodeTile = vi.fn(async (): Promise<DecodedJpeg2000> => {
      return {
        width: 6,
        height: 1,
        pixels: new Uint16Array([0, 10, 20, 30, 40, 1000]),
      }
    })

    await expect(
      computeChannelAutoContrast(loader, {
        decodeTile,
        lowPercentile: 20,
        highPercentile: 80,
      }),
    ).resolves.toMatchObject({
      min: 10,
      max: 40,
      histogram: {
        min: 10,
        max: 40,
        sampleCount: 6,
      },
    })

    expect(loader.requestedTiles).toEqual([{ level: 2, col: 0, row: 0 }])
  })

  it('crops padded edge-tile pixels before estimating contrast', async () => {
    const loader = fakeLoader({
      numLevels: 1,
      tiles: [{ col: 0, row: 0 }],
      sourceWidth: 2,
      sourceHeight: 2,
    })

    await expect(
      computeChannelAutoContrast(loader, {
        decodeTile: async () => ({
          width: 4,
          height: 4,
          pixels: new Uint16Array([
            1, 2, 900, 900, 3, 4, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900,
          ]),
        }),
        lowPercentile: 0,
        highPercentile: 100,
      }),
    ).resolves.toMatchObject({
      min: 1,
      max: 4,
      histogram: {
        min: 1,
        max: 4,
        sampleCount: 4,
      },
    })
  })
})

function fakeLoader(options: {
  readonly numLevels: number
  readonly sourceHeight: number
  readonly sourceWidth: number
  readonly tiles: readonly { readonly col: number; readonly row: number }[]
}): AutoContrastTileLoader & {
  readonly requestedTiles: {
    readonly level: number
    readonly col: number
    readonly row: number
  }[]
} {
  const requestedTiles: {
    readonly level: number
    readonly col: number
    readonly row: number
  }[] = []

  return {
    numLevels: options.numLevels,
    requestedTiles,
    tilesForLevel: () => options.tiles,
    tileSourceSize: () => ({
      width: imagePixels(options.sourceWidth),
      height: imagePixels(options.sourceHeight),
    }),
    async fetchTileBytes(level, col, row) {
      requestedTiles.push({ level, col, row })
      return new Uint8Array([1, 2, 3])
    },
  }
}
