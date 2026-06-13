import { describe, expect, it } from 'vitest'
import { imagePixels, micrometers } from '../data/coords'
import {
  byteRangeCacheRecordId,
  TIFF_TILE_CACHE_NAMESPACE,
} from '../data/persistentByteRangeCache'
import {
  parsePhysicalSizeMicrometersPerPixel,
  readNumberArrayTag,
  readOptionalNumberTag,
  readOptionalStringTag,
  readRequiredNumberTag,
  tiffImageSelectionUrl,
  TiffPyramidLoader,
} from './loader'
import type { TiffChunk, TiffLevelMeta } from './loader'
import type { UnitsDescriptor } from '../data/coords'
import type {
  ByteRangeCacheKey,
  PersistentByteRangeCache,
} from '../data/persistentByteRangeCache'

const units: UnitsDescriptor = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(1),
  origin: 'top-left',
  imageYAxis: 'down',
}

describe('TIFF metadata parsing', () => {
  it('parses OME PhysicalSizeX with the Xenium fallback', () => {
    expect(parsePhysicalSizeMicrometersPerPixel('PhysicalSizeX="0.2125"')).toBe(0.2125)
    expect(parsePhysicalSizeMicrometersPerPixel(undefined)).toBe(0.2125)
    expect(parsePhysicalSizeMicrometersPerPixel('PhysicalSizeX="-1"')).toBe(0.2125)
  })

  it('loads deferred directory scalar and array tags', async () => {
    const directory = {
      async loadValue(tagIdentifier: string | number): Promise<unknown> {
        const values: Readonly<Record<string, unknown>> = {
          Compression: 5,
          ImageDescription: 'PhysicalSizeX="0.2125"',
          ImageWidth: 51294,
          TileOffsets: new BigUint64Array([128n, 256n]),
        }

        return values[String(tagIdentifier)]
      },
    }

    await expect(readOptionalStringTag(directory, 'ImageDescription')).resolves.toBe(
      'PhysicalSizeX="0.2125"',
    )
    await expect(readRequiredNumberTag(directory, 'ImageWidth')).resolves.toBe(51294)
    await expect(readOptionalNumberTag(directory, 'Compression')).resolves.toBe(5)
    await expect(readNumberArrayTag(directory, 'TileOffsets')).resolves.toEqual([
      128, 256,
    ])
  })
})

describe('TiffPyramidLoader', () => {
  it('computes tiles and fetches raw tile bytes with HTTP Range', async () => {
    const chunks = new Map<string, TiffChunk>([['0/1/2', { offset: 10, length: 4 }]])
    const levels = new Map<number, TiffLevelMeta>([
      [0, { width: imagePixels(300), height: imagePixels(200), nCols: 3, nRows: 2 }],
    ])
    const requests: readonly RequestInit[] = []
    const mutableRequests: RequestInit[] = []
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/image.ome.tif',
      chunkIndex: chunks,
      levelMeta: levels,
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 1,
      imageWidth: imagePixels(300),
      imageHeight: imagePixels(200),
      fetcher: async (_input, init) => {
        mutableRequests.push(init ?? {})
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206 })
      },
    })

    expect(
      loader.tilesForBbox(0, {
        minX: micrometers(190),
        maxX: micrometers(250),
        minY: micrometers(100),
        maxY: micrometers(150),
      }),
    ).toEqual([
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ])
    expect(loader.tileBounds(0, 2, 1)).toEqual({
      minX: micrometers(200),
      maxX: micrometers(300),
      minY: micrometers(100),
      maxY: micrometers(200),
    })
    expect(loader.tileSourceSize(0, 2, 1)).toEqual({
      width: imagePixels(100),
      height: imagePixels(100),
    })
    await expect(loader.fetchTileBytes(0, 2, 1)).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )

    expect(requests).toHaveLength(0)
    expect(mutableRequests[0]?.headers).toEqual({ Range: 'bytes=10-13' })
  })

  it('uses the source TIFF URL for range fetches from selected IFD loaders', async () => {
    const chunks = new Map<string, TiffChunk>([['0/0/0', { offset: 20, length: 3 }]])
    const levels = new Map<number, TiffLevelMeta>([
      [0, { width: imagePixels(100), height: imagePixels(100), nCols: 1, nRows: 1 }],
    ])
    const requestedUrls: string[] = []
    const loader = new TiffPyramidLoader({
      url: tiffImageSelectionUrl('https://example.test/image.ome.tif', 2),
      sourceUrl: 'https://example.test/image.ome.tif',
      chunkIndex: chunks,
      levelMeta: levels,
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 1,
      imageWidth: imagePixels(100),
      imageHeight: imagePixels(100),
      byteRangeCache: null,
      fetcher: async (input) => {
        requestedUrls.push(String(input))
        return new Response(new Uint8Array([1, 2, 3]), { status: 206 })
      },
    })

    expect(loader.url).toBe('https://example.test/image.ome.tif#ifd=2')
    await expect(loader.fetchTileBytes(0, 0, 0)).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    )
    expect(requestedUrls).toEqual(['https://example.test/image.ome.tif'])
  })

  it('reports cropped source dimensions for edge tiles', () => {
    const chunks = new Map<string, TiffChunk>([['0/1/2', { offset: 10, length: 4 }]])
    const levels = new Map<number, TiffLevelMeta>([
      [0, { width: imagePixels(260), height: imagePixels(180), nCols: 3, nRows: 2 }],
    ])
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/image.ome.tif',
      chunkIndex: chunks,
      levelMeta: levels,
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 1,
      imageWidth: imagePixels(260),
      imageHeight: imagePixels(180),
    })

    expect(loader.tileSourceSize(0, 2, 1)).toEqual({
      width: imagePixels(60),
      height: imagePixels(80),
    })
  })

  it('exposes TIFF tile decode metadata for workers', () => {
    const levels = new Map<number, TiffLevelMeta>([
      [0, { width: imagePixels(300), height: imagePixels(200), nCols: 3, nRows: 2 }],
    ])
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/image.ome.tif',
      bitsPerSample: [8],
      chunkIndex: new Map<string, TiffChunk>(),
      compression: 5,
      imageHeight: imagePixels(200),
      imageWidth: imagePixels(300),
      levelMeta: levels,
      littleEndian: true,
      numLevels: 1,
      planarConfiguration: 1,
      predictor: 1,
      samplesPerPixel: 1,
      tileHeight: imagePixels(100),
      tileWidth: imagePixels(100),
      units,
    })

    expect(loader.tileDecodeOptions()).toEqual({
      bitsPerSample: [8],
      compression: 5,
      littleEndian: true,
      planarConfiguration: 1,
      predictor: 1,
      samplesPerPixel: 1,
      tileHeight: imagePixels(100),
      tileWidth: imagePixels(100),
    })
  })

  it('enumerates all tiles for a pyramid level, including partial edges', () => {
    const levels = new Map<number, TiffLevelMeta>([
      [0, { width: imagePixels(260), height: imagePixels(180), nCols: 3, nRows: 2 }],
    ])
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/image.ome.tif',
      chunkIndex: new Map<string, TiffChunk>(),
      levelMeta: levels,
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 1,
      imageWidth: imagePixels(260),
      imageHeight: imagePixels(180),
    })

    expect(loader.tilesForLevel(0)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ])
  })

  it('reuses persistent cached tile byte ranges', async () => {
    const chunks = new Map<string, TiffChunk>([['0/1/2', { offset: 10, length: 4 }]])
    const levels = new Map<number, TiffLevelMeta>([
      [0, { width: imagePixels(300), height: imagePixels(200), nCols: 3, nRows: 2 }],
    ])
    const byteRangeCache = new MemoryByteRangeCache()
    const fetches: RequestInit[] = []
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/image.ome.tif',
      chunkIndex: chunks,
      levelMeta: levels,
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 1,
      imageWidth: imagePixels(300),
      imageHeight: imagePixels(200),
      byteRangeCache,
      fetcher: async (_input, init) => {
        fetches.push(init ?? {})
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206 })
      },
    })

    await expect(loader.fetchTileBytes(0, 2, 1)).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )
    await expect(loader.fetchTileBytes(0, 2, 1)).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )

    expect(fetches).toHaveLength(1)
    expect(byteRangeCache.keys()).toEqual([
      byteRangeCacheRecordId({
        namespace: TIFF_TILE_CACHE_NAMESPACE,
        url: 'https://example.test/image.ome.tif',
        start: 10,
        end: 14,
      }),
    ])
  })

  it('selects intermediate pyramid levels by source pixel screen size', () => {
    const levels = new Map<number, TiffLevelMeta>([
      [0, { width: imagePixels(800), height: imagePixels(800), nCols: 8, nRows: 8 }],
      [1, { width: imagePixels(400), height: imagePixels(400), nCols: 4, nRows: 4 }],
      [2, { width: imagePixels(200), height: imagePixels(200), nCols: 2, nRows: 2 }],
      [3, { width: imagePixels(100), height: imagePixels(100), nCols: 1, nRows: 1 }],
    ])
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/image.ome.tif',
      chunkIndex: new Map<string, TiffChunk>(),
      levelMeta: levels,
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 4,
      imageWidth: imagePixels(800),
      imageHeight: imagePixels(800),
    })

    expect(loader.bestLevel(0.1)).toBe(3)
    expect(loader.bestLevel(0.2)).toBe(2)
    expect(loader.bestLevel(0.4)).toBe(1)
    expect(loader.bestLevel(0.8)).toBe(0)
    expect(loader.bestLevel(2)).toBe(0)
  })
})

class MemoryByteRangeCache implements PersistentByteRangeCache {
  private readonly cache = new Map<string, ArrayBuffer>()

  async read(key: ByteRangeCacheKey): Promise<ArrayBuffer | null> {
    return this.cache.get(byteRangeCacheRecordId(key)) ?? null
  }

  async write(key: ByteRangeCacheKey, bytes: Uint8Array | ArrayBuffer): Promise<void> {
    this.cache.set(byteRangeCacheRecordId(key), copyToArrayBuffer(bytes))
  }

  keys(): readonly string[] {
    return [...this.cache.keys()]
  }
}

function copyToArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  const source =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes, 0, bytes.byteLength)
  const copy = new Uint8Array(source.byteLength)

  copy.set(source)
  return copy.buffer
}
