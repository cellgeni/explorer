import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeTiffChunkSamples } from '../codecs/tiffTile'
import { clearOpenTiffFiles, openTiff } from './loader'
import { ndpiFixtureFile, ndpiFixtureJpeg } from '../test/ndpiFixtures'
import { stubRangeFetch } from '../test/tiffFixtures'

// The fixture's levels are tiny, so the DC level is added for any level
// wider than 16 pixels.
vi.mock('./ndpi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ndpi')>()),
  NDPI_DC_LEVEL_MIN_SIZE: 16,
}))

beforeEach(() => {
  clearOpenTiffFiles()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openTiff with an NDPI whose smallest level is large', () => {
  it('adds a level an eighth its size, decoded from the DC terms', async () => {
    const url = 'https://example.test/slides/dc.ndpi'
    stubRangeFetch(url, ndpiFixtureFile({ withoutLevel2: true }))

    const loader = await openTiff(url)

    // Level 1 is 59 x 22, so its DC level is 8 x 3.
    expect(loader.numLevels).toBe(3)
    expect(loader.tileSourceSize(2, 0, 0)).toEqual({ width: 8, height: 3 })
    expect(loader.tileBounds(2, 0, 0)).toEqual({
      minX: 0,
      maxX: 59,
      minY: 0,
      maxY: 22,
    })
    expect(loader.tilesFromSharedReads).toBe(true)

    const reference = new Uint8Array(
      await decodeTiffChunkSamples(ndpiFixtureJpeg('level1'), {
        compression: 7,
        photometric: 6,
        bitsPerSample: [8, 8, 8],
        samplesPerPixel: 3,
        jpegDcOnly: true,
        tileWidth: 8,
        tileHeight: 3,
      }),
    )
    const tile = await loader.fetchTileBytes(2, 0, 0)

    for (let row = 0; row < 3; row += 1) {
      expect(tile.subarray(row * 512 * 3, row * 512 * 3 + 8 * 3)).toEqual(
        reference.subarray(row * 8 * 3, (row + 1) * 8 * 3),
      )
    }
  })

  it('adds no DC level when the smallest level is read whole', async () => {
    const url = 'https://example.test/slides/no-dc.ndpi'
    stubRangeFetch(url, ndpiFixtureFile())

    expect((await openTiff(url)).numLevels).toBe(3)
  })
})
