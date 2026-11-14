import { deflateSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeTiffTilePixels } from '../codecs/tiffTile'
import { buildTiff, stubRangeFetch, u16 } from '../test/tiffFixtures'
import { clearOpenTiffFiles, openTiff } from './loader'
import {
  StripBandCache,
  stripBandRead,
  stripBandsForRows,
  stripPieceBytes,
  stripTileBytes,
  tiffStripLevel,
  uncompressedStripBand,
} from './strips'
import type { TiffStripLevel, TiffStripTags } from './strips'
import type { TestTiffImage } from '../test/tiffFixtures'

afterEach(() => {
  clearOpenTiffFiles()
  vi.unstubAllGlobals()
})

function contiguousStrips(count: number, bytesPerStrip: number): TiffStripTags {
  return {
    offsets: Array.from(
      { length: count },
      (_unused, index) => 1000 + index * bytesPerStrip,
    ),
    byteCounts: Array.from({ length: count }, () => bytesPerStrip),
  }
}

function stripLevel(
  options: Partial<Parameters<typeof tiffStripLevel>[0]> & {
    readonly width: number
    readonly height: number
    readonly tags: TiffStripTags
  },
): TiffStripLevel {
  return tiffStripLevel({
    level: 0,
    decodeMetadata: { compression: 1, bitsPerSample: [8], samplesPerPixel: 1 },
    tileHeight: 256,
    ...options,
  })
}

describe('tiffStripLevel', () => {
  it('reads uncompressed strips in bands of whole tile rows', () => {
    const level = stripLevel({
      width: 600,
      height: 300,
      tags: { ...contiguousStrips(43, 4200), rowsPerStrip: 7 },
    })

    expect(level).toMatchObject({
      rowsPerStrip: 7,
      stripsPerPlane: 43,
      planes: 1,
      pixelBytes: 1,
      rowBytes: 600,
      bandRows: 1024,
      compressed: false,
      tileDecode: { compression: 1, bitsPerSample: [8], planarConfiguration: 1 },
    })
  })

  it('splits a tile row into smaller bands for very wide images', () => {
    const level = stripLevel({
      width: 40_000,
      height: 1000,
      decodeMetadata: { compression: 1, bitsPerSample: [16], samplesPerPixel: 1 },
      tags: contiguousStrips(1, 80_000_000),
    })

    // 8 MB holds 104 rows of 80 kB.
    expect(level.bandRows).toBe(64)
    expect(level.rowsPerStrip).toBe(1000)
  })

  it('keeps compressed strips whole in each band', () => {
    const level = stripLevel({
      width: 600,
      height: 300,
      decodeMetadata: { compression: 8, bitsPerSample: [8], predictor: 2 },
      tags: { ...contiguousStrips(100, 50), rowsPerStrip: 3 },
    })

    expect(level.bandRows).toBe(1023)
    expect(level.compressed).toBe(true)
    expect(level.stripDecode).toMatchObject({ compression: 8, predictor: 2 })
    expect(level.tileDecode).toMatchObject({ compression: 1 })
    expect(level.tileDecode.predictor).toBeUndefined()
  })

  it('refuses compressed strips too large to decode in parts', () => {
    expect(() =>
      stripLevel({
        width: 20_000,
        height: 20_000,
        decodeMetadata: { compression: 5, bitsPerSample: [8] },
        tags: contiguousStrips(1, 1000),
      }),
    ).toThrow(/compressed strips of 20000 rows \(382 MB each once decoded\)/)
  })

  it('decodes separated sample planes one sample at a time', () => {
    const level = stripLevel({
      width: 10,
      height: 6,
      decodeMetadata: {
        compression: 8,
        bitsPerSample: [8, 8, 8],
        samplesPerPixel: 3,
        planarConfiguration: 2,
        photometric: 2,
      },
      tags: { ...contiguousStrips(6, 40), rowsPerStrip: 4 },
    })

    expect(level).toMatchObject({
      planes: 3,
      pixelBytes: 1,
      rowBytes: 10,
      stripsPerPlane: 2,
    })
    expect(level.stripDecode).toMatchObject({
      bitsPerSample: [8],
      samplesPerPixel: 1,
      planarConfiguration: 1,
    })
    expect(level.tileDecode).toMatchObject({
      bitsPerSample: [8, 8, 8],
      samplesPerPixel: 3,
      planarConfiguration: 2,
    })
  })

  it('rejects sample sizes other than 8 and 16 bits and missing strips', () => {
    const tags = contiguousStrips(1, 100)

    expect(() =>
      stripLevel({
        width: 10,
        height: 10,
        decodeMetadata: { bitsPerSample: [32] },
        tags,
      }),
    ).toThrow(/32-bit samples/)
    expect(() =>
      stripLevel({ width: 10, height: 10, tags: { ...tags, rowsPerStrip: 5 } }),
    ).toThrow(/has 1 strips, expected 2/)
  })
})

describe('stripBandRead', () => {
  it('reads only the rows of each uncompressed strip the band covers', () => {
    // 64-row bands over 100-row strips stored back to back.
    const level = stripLevel({
      width: 40_000,
      height: 300,
      decodeMetadata: { compression: 1, bitsPerSample: [16] },
      tags: { ...contiguousStrips(3, 8_000_000), rowsPerStrip: 100 },
    })

    expect(stripBandsForRows(level, 0, 256)).toEqual([0, 1, 2, 3])
    expect(stripBandRead(level, 1)).toEqual({
      runs: [{ start: 1000 + 64 * 80_000, end: 1000 + 8_000_000 + 28 * 80_000 }],
      pieces: [
        { offset: 1000 + 64 * 80_000, length: 36 * 80_000, rows: 36, run: 0 },
        { offset: 1000 + 8_000_000, length: 28 * 80_000, rows: 28, run: 0 },
      ],
    })
  })

  it('reads whole compressed strips, splitting runs at gaps', () => {
    const level = stripLevel({
      width: 100,
      height: 9,
      decodeMetadata: { compression: 8, bitsPerSample: [8] },
      tags: { offsets: [0, 30, 10_000], byteCounts: [30, 20, 25], rowsPerStrip: 4 },
    })
    const read = stripBandRead(level, 0)

    expect(read.runs).toEqual([
      { start: 0, end: 50 },
      { start: 10_000, end: 10_025 },
    ])
    expect(read.pieces.map((piece) => piece.rows)).toEqual([4, 4, 1])
  })

  it('lists separated planes in turn and leaves short strips zero', () => {
    const level = stripLevel({
      width: 2,
      height: 2,
      decodeMetadata: {
        compression: 1,
        bitsPerSample: [8, 8, 8],
        samplesPerPixel: 3,
        planarConfiguration: 2,
      },
      // The blue plane's strip is cut short.
      tags: { offsets: [0, 4, 8], byteCounts: [4, 4, 1] },
    })
    const read = stripBandRead(level, 0)
    const pieces = stripPieceBytes(read, [Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])])

    expect(read.runs).toEqual([{ start: 0, end: 9 }])
    expect(uncompressedStripBand(level, read, pieces)).toEqual(
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0]),
    )
  })
})

describe('stripTileBytes', () => {
  // A 5x5 image of 8-bit samples numbered row by row, in 2-row bands.
  const level: TiffStripLevel = {
    ...stripLevel({ width: 5, height: 5, tags: contiguousStrips(1, 25) }),
    bandRows: 2,
  }
  const pixels = Uint8Array.from({ length: 25 }, (_unused, index) => index + 1)
  const band = (index: number) => ({
    index,
    bytes: pixels.subarray(index * 10, Math.min(25, index * 10 + 10)),
  })

  it('cuts a tile across bands and pads it outside the image', () => {
    const tile = stripTileBytes(
      level,
      [band(0), band(1), band(2)],
      { left: 3, top: 1, width: 2, height: 4 },
      3,
      4,
    )

    expect(Array.from(tile)).toEqual([9, 10, 0, 14, 15, 0, 19, 20, 0, 24, 25, 0])
  })

  it('cuts each separated plane into its own block', () => {
    const planar: TiffStripLevel = { ...level, planes: 2, bandRows: 5 }
    const bytes = Uint8Array.from([...pixels, ...pixels.map((value) => value + 100)])
    const tile = stripTileBytes(
      planar,
      [{ index: 0, bytes }],
      { left: 0, top: 4, width: 2, height: 1 },
      2,
      2,
    )

    expect(Array.from(tile)).toEqual([21, 22, 0, 0, 121, 122, 0, 0])
  })
})

describe('StripBandCache', () => {
  it('shares one read among waiters and keeps it until every waiter stops', async () => {
    const cache = new StripBandCache()
    let loadSignal: AbortSignal | undefined
    let resolve: (bytes: Uint8Array) => void = () => {}
    const load = vi.fn(
      (signal: AbortSignal) =>
        new Promise<Uint8Array>((settle) => {
          loadSignal = signal
          resolve = settle
        }),
    )
    const first = new AbortController()
    const second = new AbortController()
    const firstWait = cache.get('0:0', load, first.signal)
    const secondWait = cache.get('0:0', load, second.signal)

    first.abort()
    await expect(firstWait).rejects.toThrow()
    expect(loadSignal?.aborted).toBe(false)

    resolve(Uint8Array.from([1]))
    await expect(secondWait).resolves.toEqual(Uint8Array.from([1]))
    await expect(cache.get('0:0', load, undefined)).resolves.toEqual(Uint8Array.from([1]))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('cancels a read every waiter left and starts again for the next', async () => {
    const cache = new StripBandCache()
    const signals: AbortSignal[] = []
    const load = vi.fn(
      (signal: AbortSignal) =>
        new Promise<Uint8Array>((resolve, reject) => {
          signals.push(signal)
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
          setTimeout(() => {
            resolve(Uint8Array.from([2]))
          }, 0)
        }),
    )
    const controller = new AbortController()
    const wait = cache.get('0:1', load, controller.signal)

    controller.abort()
    await expect(wait).rejects.toThrow()
    expect(signals[0]?.aborted).toBe(true)
    await expect(cache.get('0:1', load, undefined)).resolves.toEqual(Uint8Array.from([2]))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('drops the least recently used bands over its byte limit, and failed reads', async () => {
    const cache = new StripBandCache(12)
    const load = vi.fn(async () => new Uint8Array(6))
    const failing = vi.fn(async () => {
      throw new Error('offline')
    })

    await cache.get('a', load, undefined)
    await cache.get('b', load, undefined)
    await cache.get('a', load, undefined)
    expect(load).toHaveBeenCalledTimes(2)

    // 'b' is now the least recently used.
    await cache.get('c', load, undefined)
    await cache.get('a', load, undefined)
    expect(load).toHaveBeenCalledTimes(3)
    await cache.get('b', load, undefined)
    expect(load).toHaveBeenCalledTimes(4)

    await expect(cache.get('d', failing, undefined)).rejects.toThrow('offline')
    await expect(cache.get('d', failing, undefined)).rejects.toThrow('offline')
    expect(failing).toHaveBeenCalledTimes(2)
  })
})

describe('openTiff with a stripped image', () => {
  // 8-bit samples (x + 3y) mod 256, in 7-row strips stored back to back.
  const width = 600
  const height = 300
  const sample = (x: number, y: number) => (x + 3 * y) % 256
  const grayStrips: TestTiffImage = {
    width,
    height,
    rowsPerStrip: 7,
    bitsPerSample: 8,
    subfileType: 0,
    description: 'stripped',
    value: () => 0,
    tileBytes: (strip) => rowsOf(strip, 7, width, height, (x, y) => [sample(x, y)]),
  }

  it('cuts square tiles from bands of rows, reading each band once', async () => {
    const url = 'https://example.test/stripped-gray.tif'
    const fetcher = stubRangeFetch(url, buildTiff([grayStrips]))
    const loader = await openTiff(url)

    expect(loader.tileWidth).toBe(256)
    expect(loader.tileHeight).toBe(256)
    expect(loader.numLevels).toBe(1)
    expect(loader.tilesForLevel(0)).toHaveLength(6)

    const readsBefore = fetcher.mock.calls.length
    const [corner] = await Promise.all([
      loader.fetchTileBytes(0, 2, 1),
      loader.fetchTileBytes(0, 1, 1),
      loader.fetchTileBytes(0, 0, 0),
    ])
    const decodeOptions = loader.tileDecodeOptions(0, 2, 1)

    // The whole image is one band, read in one request.
    expect(fetcher.mock.calls.length - readsBefore).toBe(1)
    expect(decodeOptions).toMatchObject({
      compression: 1,
      bitsPerSample: [8],
      tileWidth: 256,
      tileHeight: 256,
    })
    expect(loader.tileSourceSize(0, 2, 1)).toEqual({ width: 88, height: 44 })

    const decoded = await decodeTiffTilePixels(corner, decodeOptions)

    expect(decoded.pixels[0]).toBe(sample(512, 256))
    expect(decoded.pixels[43 * 256 + 87]).toBe(sample(599, 299))
    expect(decoded.pixels[43 * 256 + 88]).toBe(0)
    expect(decoded.pixels[44 * 256]).toBe(0)
  })

  it('reads part of a single uncompressed strip', async () => {
    const url = 'https://example.test/one-strip.tif'
    const wide = 4096
    const fetcher = stubRangeFetch(
      url,
      buildTiff([
        {
          width: wide,
          height: 1100,
          bitsPerSample: 8,
          subfileType: 0,
          description: 'one strip',
          value: () => 0,
          tileBytes: () => rowsOf(0, 1100, wide, 1100, (_x, y) => [y % 256]),
        },
      ]),
    )
    const loader = await openTiff(url)
    const tile = await loader.fetchTileBytes(0, 3, 4)
    const range = new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get('Range')
    const [start, end] = (range?.match(/\d+/g) ?? []).map(Number)

    // 1024-row bands: rows 1024-1099 are the second.
    expect((end ?? 0) - (start ?? 0) + 1).toBe(76 * wide)
    expect(tile[0]).toBe(1024 % 256)
    expect(tile[75 * 256]).toBe(1099 % 256)
  })

  it('decodes compressed strips with a predictor', async () => {
    const url = 'https://example.test/stripped-deflate.tif'
    const narrow = 300
    const tall = 40
    const value = (x: number, y: number) => x * 100 + y
    stubRangeFetch(
      url,
      buildTiff([
        {
          width: narrow,
          height: tall,
          rowsPerStrip: 5,
          compression: 8,
          predictor: 2,
          subfileType: 0,
          description: 'deflate',
          value: () => 0,
          tileBytes: (strip) => [
            ...deflateSync(
              Uint8Array.from(
                rowsOf(strip, 5, narrow, tall, (x, y) =>
                  u16(x === 0 ? value(x, y) : value(x, y) - value(x - 1, y)),
                ),
              ),
            ),
          ],
        },
      ]),
    )
    const loader = await openTiff(url)
    const bytes = await loader.fetchTileBytes(0, 1, 0)
    const decoded = await decodeTiffTilePixels(bytes, loader.tileDecodeOptions(0, 1, 0))

    expect(decoded.pixels[0]).toBe(value(256, 0))
    expect(decoded.pixels[39 * 256 + 43]).toBe(value(299, 39))
  })

  it('reads separated sample planes into planar tiles', async () => {
    const url = 'https://example.test/stripped-planar.tif'
    const rgb = (x: number, y: number) => [x, y, 200]
    stubRangeFetch(
      url,
      buildTiff([
        {
          width: 10,
          height: 6,
          rowsPerStrip: 4,
          samplesPerPixel: 3,
          planarConfiguration: 2,
          bitsPerSample: 8,
          subfileType: 0,
          description: 'planar',
          value: () => 0,
          tileBytes: (strip) =>
            rowsOf(strip % 2, 4, 10, 6, (x, y) => [
              rgb(x, y)[Math.floor(strip / 2)] ?? 0,
            ]),
        },
      ]),
    )
    const loader = await openTiff(url)
    const bytes = await loader.fetchTileBytes(0, 0, 0)
    const decoded = await decodeTiffTilePixels(bytes, loader.tileDecodeOptions(0, 0, 0))
    const pixel = (x: number, y: number) =>
      Array.from(decoded.pixels.subarray((y * 256 + x) * 3, (y * 256 + x) * 3 + 3))

    expect(pixel(9, 5)).toEqual([9, 5, 200])
    expect(pixel(3, 2)).toEqual([3, 2, 200])
  })
})

// The bytes of strip `strip`: its rows of `width` pixels, each pixel's
// sample bytes from `pixel`.
function rowsOf(
  strip: number,
  rowsPerStrip: number,
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly number[],
): number[] {
  const bytes: number[] = []
  const top = strip * rowsPerStrip

  for (let y = top; y < Math.min(height, top + rowsPerStrip); y += 1) {
    for (let x = 0; x < width; x += 1) {
      bytes.push(...pixel(x, y))
    }
  }

  return bytes
}
