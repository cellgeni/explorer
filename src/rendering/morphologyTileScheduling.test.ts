import { describe, expect, it } from 'vitest'
import { TIFF_COMPRESSION_LZW } from '../codecs/tiffTile'
import { tileSchedulingForLoader } from './morphologyTileScheduling'
import type { TiffPyramidLoader } from '../tiff/loader'

describe('tileSchedulingForLoader', () => {
  it('keeps the standard tile budget for JPEG-2000 tiles', () => {
    expect(
      tileSchedulingForLoader(fakeLoader({ compression: 34712 }), {
        baseMaxCacheTiles: 120,
        baseMaxConcurrentRequests: 4,
      }),
    ).toEqual({
      maxCacheTiles: 120,
      maxConcurrentRequests: 4,
      maxInitialTileRequests: 96,
      prefetchScreenMarginPixels: 256,
    })
  })

  it('uses a low-memory budget for large LZW tiles', () => {
    expect(
      tileSchedulingForLoader(fakeLoader({ compression: TIFF_COMPRESSION_LZW }), {
        baseMaxCacheTiles: 120,
        baseMaxConcurrentRequests: 4,
      }),
    ).toEqual({
      maxCacheTiles: 18,
      maxConcurrentRequests: 1,
      maxInitialTileRequests: 18,
      prefetchScreenMarginPixels: 0,
    })
  })

  it('does not throttle small LZW tiles', () => {
    expect(
      tileSchedulingForLoader(
        fakeLoader({
          compression: TIFF_COMPRESSION_LZW,
          tileHeight: 128,
          tileWidth: 128,
        }),
        {
          baseMaxCacheTiles: 120,
          baseMaxConcurrentRequests: 4,
        },
      ),
    ).toMatchObject({
      maxInitialTileRequests: 384,
      prefetchScreenMarginPixels: 256,
    })
  })

  it('gives small tiles the budget of 512-pixel tiles in pixels, up to four times the tiles', () => {
    const schedule = (tileSize: number) =>
      tileSchedulingForLoader(
        fakeLoader({ compression: 7, tileHeight: tileSize, tileWidth: tileSize }),
        { baseMaxCacheTiles: 120, baseMaxConcurrentRequests: 4 },
      )

    expect(schedule(512)).toMatchObject({
      maxCacheTiles: 120,
      maxConcurrentRequests: 4,
      maxInitialTileRequests: 96,
    })
    expect(schedule(362)).toMatchObject({
      maxCacheTiles: 240,
      maxConcurrentRequests: 8,
      maxInitialTileRequests: 192,
    })
    expect(schedule(240)).toMatchObject({
      maxCacheTiles: 480,
      maxConcurrentRequests: 16,
      maxInitialTileRequests: 384,
    })
  })
})

function fakeLoader(options: {
  readonly compression?: number
  readonly tileHeight?: number
  readonly tileWidth?: number
}): Pick<TiffPyramidLoader, 'tileDecodeOptions'> {
  return {
    tileDecodeOptions: () => ({
      ...(options.compression === undefined ? {} : { compression: options.compression }),
      tileHeight: options.tileHeight ?? 1024,
      tileWidth: options.tileWidth ?? 1024,
    }),
  }
}
