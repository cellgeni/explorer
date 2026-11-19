import { fromCustomClient } from 'geotiff'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers } from '../data/coords'
import {
  byteRangeCacheRecordId,
  TIFF_TILE_CACHE_NAMESPACE,
} from '../data/persistentByteRangeCache'
import {
  clearOpenTiffFiles,
  openTiff,
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

vi.mock('geotiff', () => ({
  fromCustomClient: vi.fn(),
}))

const mockedFromCustomClient = vi.mocked(fromCustomClient)

const units: UnitsDescriptor = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(1),
  origin: 'top-left',
  imageYAxis: 'down',
}

afterEach(() => {
  mockedFromCustomClient.mockReset()
  clearOpenTiffFiles()
  vi.unstubAllGlobals()
})

describe('TIFF metadata parsing', () => {
  it('parses OME PhysicalSizeX with the Xenium fallback', () => {
    expect(parsePhysicalSizeMicrometersPerPixel('PhysicalSizeX="0.2125"')).toBe(0.2125)
    expect(
      parsePhysicalSizeMicrometersPerPixel(
        'PhysicalSizeX="45206" PhysicalSizeXUnit="cm"',
      ),
    ).toBeCloseTo(0.22120957395036056)
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

  it('reads a lazy tile index on the first tile fetch and retries a failed read', async () => {
    const chunks = new Map<string, TiffChunk>([['0/0/0', { offset: 10, length: 2 }]])
    const readChunks = vi
      .fn<() => Promise<ReadonlyMap<string, TiffChunk>>>()
      .mockRejectedValueOnce(new Error('offsets unavailable'))
      .mockResolvedValue(chunks)
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/scan.qptiff',
      chunkIndex: readChunks,
      levelMeta: new Map([
        [0, { width: imagePixels(100), height: imagePixels(100), nCols: 1, nRows: 1 }],
      ]),
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 1,
      imageWidth: imagePixels(100),
      imageHeight: imagePixels(100),
      fetcher: async () => new Response(new Uint8Array([7, 8]), { status: 206 }),
      byteRangeCache: null,
    })

    expect(readChunks).not.toHaveBeenCalled()
    await expect(loader.fetchTileBytes(0, 0, 0)).rejects.toThrow('offsets unavailable')
    await expect(loader.fetchTileBytes(0, 0, 0)).resolves.toEqual(new Uint8Array([7, 8]))
    await expect(loader.fetchTileBytes(0, 0, 0)).resolves.toEqual(new Uint8Array([7, 8]))
    expect(readChunks).toHaveBeenCalledTimes(2)
  })

  it('reads each level of a lazy tile index when that level is first fetched', async () => {
    const readLevel = vi.fn(
      async (level: number): Promise<ReadonlyMap<string, TiffChunk>> =>
        new Map([[`${level}/0/0`, { offset: 10 * (level + 1), length: 2 }]]),
    )
    const ranges: string[] = []
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/slide.svs',
      chunkIndex: readLevel,
      levelMeta: new Map([
        [0, { width: imagePixels(200), height: imagePixels(100), nCols: 2, nRows: 1 }],
        [1, { width: imagePixels(100), height: imagePixels(50), nCols: 1, nRows: 1 }],
      ]),
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 2,
      imageWidth: imagePixels(200),
      imageHeight: imagePixels(100),
      fetcher: async (_input, init) => {
        ranges.push(new Headers(init?.headers).get('Range') ?? '')
        return new Response(new Uint8Array([1, 2]), { status: 206 })
      },
      byteRangeCache: null,
    })

    await loader.fetchTileBytes(1, 0, 0)
    expect(readLevel.mock.calls).toEqual([[1]])

    await Promise.all([loader.fetchTileBytes(0, 0, 0), loader.fetchTileBytes(0, 0, 0)])
    await loader.fetchTileBytes(1, 0, 0)
    expect(readLevel.mock.calls).toEqual([[1], [0]])
    expect(ranges).toEqual(['bytes=20-21', 'bytes=10-11', 'bytes=10-11', 'bytes=20-21'])
  })

  it('reads upcoming tiles stored next to a tile in its request', async () => {
    // A 6 x 2 level written row by row, 10 bytes per tile, plus one tile
    // stored elsewhere in the file.
    const { loader, ranges } = adjacentTilesLoader()
    const firstByte = async (col: number, row: number) =>
      (await loader.fetchTileBytes(0, col, row))[0]
    const onSharedRead = vi.fn()

    // Tile (2, 0) and the upcoming tiles stored next to it: (1, 0) before it,
    // then (3, 0) to (1, 1) after it, up to (2, 1), which is not upcoming.
    await expect(
      loader.fetchTileBytes(0, 2, 0, undefined, {
        upcoming: [
          { col: 1, row: 0 },
          { col: 3, row: 0 },
          { col: 4, row: 0 },
          { col: 5, row: 0 },
          { col: 0, row: 1 },
          { col: 1, row: 1 },
          { col: 3, row: 1 },
          { col: 5, row: 1 },
        ],
      }),
    ).resolves.toEqual(tileBytes(1020))
    expect(ranges).toEqual(['bytes=1010-1079'])

    await expect(
      loader.fetchTileBytes(0, 0, 1, undefined, { onSharedRead }),
    ).resolves.toEqual(tileBytes(1060))
    await expect(firstByte(1, 0)).resolves.toBe(1010 % 256)
    expect(ranges).toHaveLength(1)
    expect(onSharedRead).toHaveBeenCalledOnce()

    // Tiles not upcoming were not read ahead; the one stored elsewhere does
    // not join a run either.
    await expect(firstByte(0, 0)).resolves.toBe(1000 % 256)
    await expect(
      loader.fetchTileBytes(0, 5, 1, undefined, { upcoming: [{ col: 4, row: 1 }] }),
    ).resolves.toHaveLength(10)
    expect(ranges).toEqual(['bytes=1010-1079', 'bytes=1000-1009', 'bytes=50000-50009'])

    // A tile read ahead is used once; fetched again, it is read again.
    await expect(firstByte(3, 0)).resolves.toBe(1030 % 256)
    expect(ranges).toHaveLength(3)
    await expect(firstByte(3, 0)).resolves.toBe(1030 % 256)
    expect(ranges).toHaveLength(4)
  })

  it('does not read a tile in two runs at once', async () => {
    const { loader, ranges, respond } = adjacentTilesLoader({ delayed: true })
    const all = { upcoming: [0, 1, 2, 3].map((col) => ({ col, row: 0 })) }

    const first = loader.fetchTileBytes(0, 0, 0, undefined, all)
    const second = loader.fetchTileBytes(0, 3, 0, undefined, all)
    await vi.waitFor(() => {
      expect(ranges).toHaveLength(1)
    })
    // The first run took tiles 1 to 3, so tile 3 waits for it.
    expect(ranges).toEqual(['bytes=1000-1039'])
    respond()
    await expect(Promise.all([first, second])).resolves.toEqual([
      tileBytes(1000),
      tileBytes(1030),
    ])
    expect(ranges).toHaveLength(1)
  })

  it('cancels a run once every tile waiting for it has stopped', async () => {
    const { loader, signals, respond } = adjacentTilesLoader({ delayed: true })
    const firstController = new AbortController()
    const secondController = new AbortController()
    const upcoming = [{ col: 1, row: 0 }]
    const first = loader.fetchTileBytes(0, 0, 0, firstController.signal, { upcoming })

    await vi.waitFor(() => {
      expect(signals).toHaveLength(1)
    })
    const onSharedRead = vi.fn()
    const second = loader.fetchTileBytes(0, 1, 0, secondController.signal, {
      onSharedRead,
    })
    await vi.waitFor(() => {
      expect(onSharedRead).toHaveBeenCalled()
    })

    // The run goes on while tile 1 still waits for it.
    firstController.abort()
    await expect(first).rejects.toThrow()
    expect(signals[0]?.aborted).toBe(false)

    secondController.abort()
    await expect(second).rejects.toThrow()
    expect(signals[0]?.aborted).toBe(true)

    // A tile the cancelled run was reading ahead is read again.
    const third = loader.fetchTileBytes(0, 1, 0)
    await vi.waitFor(() => {
      expect(signals).toHaveLength(2)
    })
    respond()
    await expect(third).resolves.toHaveLength(10)
  })

  it('lets a caller stop waiting without cancelling a run other tiles share', async () => {
    const { loader, signals, respond } = adjacentTilesLoader({ delayed: true })
    const controller = new AbortController()
    const first = loader.fetchTileBytes(0, 0, 0, controller.signal, {
      upcoming: [{ col: 1, row: 0 }],
    })

    await vi.waitFor(() => {
      expect(signals).toHaveLength(1)
    })
    const onSharedRead = vi.fn()
    const second = loader.fetchTileBytes(0, 1, 0, undefined, { onSharedRead })
    await vi.waitFor(() => {
      expect(onSharedRead).toHaveBeenCalled()
    })
    controller.abort()
    respond()

    await expect(first).rejects.toThrow()
    await expect(second).resolves.toEqual(tileBytes(1010))
    expect(signals[0]?.aborted).toBe(false)
  })

  it('decodes each level with its own tags when the levels have them', () => {
    const levelZeroTables = Uint8Array.from([1])
    const levelOneTables = Uint8Array.from([2])
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/slide.svs',
      chunkIndex: new Map<string, TiffChunk>(),
      levelMeta: new Map([
        [0, { width: imagePixels(200), height: imagePixels(100), nCols: 2, nRows: 1 }],
        [1, { width: imagePixels(100), height: imagePixels(50), nCols: 1, nRows: 1 }],
      ]),
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 2,
      imageWidth: imagePixels(200),
      imageHeight: imagePixels(100),
      compression: 7,
      photometric: 2,
      jpegTables: levelZeroTables,
      levelDecodeMetadata: [levelZeroTables, levelOneTables].map((jpegTables) => ({
        compression: 7,
        photometric: 2,
        jpegTables,
      })),
    })

    expect(loader.tileDecodeOptions()).toEqual({
      compression: 7,
      photometric: 2,
      jpegTables: levelZeroTables,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
    })
    expect(loader.tileDecodeOptions(1, 0, 0)).toEqual({
      compression: 7,
      photometric: 2,
      jpegTables: levelOneTables,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
    })
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

  it('fetches separated planar sample chunks and reports split lengths', async () => {
    const levels = new Map<number, TiffLevelMeta>([
      [0, { width: imagePixels(100), height: imagePixels(100), nCols: 1, nRows: 1 }],
    ])
    const fetches: RequestInit[] = []
    const payloads = new Map<string, readonly number[]>([
      ['bytes=10-11', [1, 2]],
      ['bytes=20-22', [3, 4, 5]],
      ['bytes=30-33', [6, 7, 8, 9]],
    ])
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/image.ome.tif',
      bitsPerSample: [8, 8, 8],
      byteRangeCache: null,
      chunkIndex: new Map([
        [
          '0/0/0',
          {
            offset: 10,
            length: 2,
            sampleChunks: [
              { offset: 10, length: 2 },
              { offset: 20, length: 3 },
              { offset: 30, length: 4 },
            ],
          },
        ],
      ]),
      imageHeight: imagePixels(100),
      imageWidth: imagePixels(100),
      levelMeta: levels,
      numLevels: 1,
      planarConfiguration: 2,
      samplesPerPixel: 3,
      tileHeight: imagePixels(100),
      tileWidth: imagePixels(100),
      units,
      fetcher: async (_input, init) => {
        fetches.push(init ?? {})
        const range = (init?.headers as Record<string, string> | undefined)?.Range
        const payload = range === undefined ? undefined : payloads.get(range)

        return new Response(new Uint8Array(payload ?? []), {
          status: payload === undefined ? 404 : 206,
        })
      },
    })

    await expect(loader.fetchTileBytes(0, 0, 0)).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    )
    expect(loader.tileDecodeOptions(0, 0, 0)).toMatchObject({
      planarConfiguration: 2,
      planarSampleByteLengths: [2, 3, 4],
      samplesPerPixel: 3,
    })
    expect(fetches.map((init) => init.headers)).toEqual([
      { Range: 'bytes=10-11' },
      { Range: 'bytes=20-22' },
      { Range: 'bytes=30-33' },
    ])
  })

  it('indexes separated planar TIFF offsets by sample plane', async () => {
    const directory = tiffDirectory({
      BitsPerSample: new Uint16Array([8, 8, 8]),
      Compression: 1,
      PlanarConfiguration: 2,
      SamplesPerPixel: 3,
      TileByteCounts: new Uint32Array([1, 2, 3, 4, 5, 6]),
      TileOffsets: new BigUint64Array([10n, 20n, 30n, 40n, 50n, 60n]),
    })
    const image = {
      getFileDirectory: () => directory,
      getHeight: () => 100,
      getTileHeight: () => 100,
      getTileWidth: () => 100,
      getWidth: () => 200,
    }

    mockedFromCustomClient.mockResolvedValue({
      getImage: vi.fn(async () => image),
      littleEndian: true,
      parser: { parseFileDirectoryAt: vi.fn() },
    } as unknown as Awaited<ReturnType<typeof fromCustomClient>>)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    )

    const loader = await openTiff('https://example.test/aligned.ome.tif')

    expect(loader.tileDecodeOptions(0, 1, 0)).toMatchObject({
      planarConfiguration: 2,
      planarSampleByteLengths: [2, 4, 6],
      samplesPerPixel: 3,
    })
  })

  it('decodes sidecar tiles with the TIFF compression tags', async () => {
    mockTiff({ width: 300, height: 200, tileWidth: 100, tileHeight: 100 })
    stubZchunkStoreFetch(zchunkStoreManifest({ width: 300, height: 200, tile: 100 }))
    const onFallback = vi.fn()

    const loader = await openTiff(
      'https://example.test/sample.tif',
      undefined,
      onFallback,
    )

    expect(onFallback).not.toHaveBeenCalled()
    expect(loader.tileDecodeOptions()).toMatchObject({
      compression: 8,
      bitsPerSample: [16],
      samplesPerPixel: 1,
      predictor: 2,
      littleEndian: true,
    })
    await loader.fetchTileBytes(0, 2, 1)
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      'https://example.test/sample.tif',
      expect.objectContaining({ headers: { Range: 'bytes=900-903' } }),
    )
  })

  it('reads the sidecar the manifest names instead of the derived ones', async () => {
    mockTiff({ width: 300, height: 200, tileWidth: 100, tileHeight: 100 })
    stubZchunkStoreFetch(zchunkStoreManifest({ width: 300, height: 200, tile: 100 }), {
      sidecarUrl: 'https://sidecars.example.test/sample.zchunkstore',
    })
    const onFallback = vi.fn()

    const loader = await openTiff(
      'https://example.test/sample.tif',
      undefined,
      onFallback,
      {
        zchunkStoreUrl: 'https://sidecars.example.test/sample.zchunkstore',
      },
    )

    expect(onFallback).not.toHaveBeenCalled()
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      'https://example.test/sample.tif.zchunkstore',
      expect.anything(),
    )
    await loader.fetchTileBytes(0, 2, 1)
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      'https://example.test/sample.tif',
      expect.objectContaining({ headers: { Range: 'bytes=900-903' } }),
    )
  })

  it('reads tile offsets from the TIFF without a notice when there is no sidecar', async () => {
    mockTiff({ width: 300, height: 200, tileWidth: 100, tileHeight: 100 })
    stubZchunkStoreFetch(null, { sidecarUrl: 'https://example.test/unused.zchunkstore' })
    const onFallback = vi.fn()

    const loader = await openTiff(
      'https://example.test/sample.tif',
      undefined,
      onFallback,
    )

    expect(onFallback).not.toHaveBeenCalled()
    await loader.fetchTileBytes(0, 2, 1)
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      'https://example.test/sample.tif',
      expect.objectContaining({ headers: { Range: 'bytes=60-65' } }),
    )
  })

  it('reports a sidecar the manifest names but the host does not serve', async () => {
    mockTiff({ width: 300, height: 200, tileWidth: 100, tileHeight: 100 })
    stubZchunkStoreFetch(null, { sidecarUrl: 'https://example.test/unused.zchunkstore' })
    const onFallback = vi.fn()

    await openTiff('https://example.test/sample.tif', undefined, onFallback, {
      zchunkStoreUrl: 'https://sidecars.example.test/missing.zchunkstore',
    })

    expect(onFallback).toHaveBeenCalledOnce()
  })

  it("ignores a sidecar that has no tiles for the TIFF's channel", async () => {
    mockTiff({
      width: 300,
      height: 200,
      tileWidth: 100,
      tileHeight: 100,
      imageDescription: twoFileOmeXml,
    })
    stubZchunkStoreFetch(zchunkStoreManifest({ width: 300, height: 200, tile: 100 }), {
      sidecarUrl: 'https://example.test/run/images/.zchunkstore',
    })
    const onFallback = vi.fn()

    const loader = await openTiff(
      'https://example.test/run/images/stain_0001.ome.tif',
      undefined,
      onFallback,
    )

    expect(onFallback).toHaveBeenCalledOnce()
    await loader.fetchTileBytes(0, 2, 1)
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      'https://example.test/run/images/stain_0001.ome.tif',
      expect.objectContaining({ headers: { Range: 'bytes=60-65' } }),
    )
  })

  it('finds the folder sidecar of a multi-file OME-TIFF', async () => {
    mockTiff({
      width: 300,
      height: 200,
      tileWidth: 100,
      tileHeight: 100,
      imageDescription: twoFileOmeXml,
    })
    stubZchunkStoreFetch(
      zchunkStoreManifest({ width: 300, height: 200, tile: 100, channels: [0, 1] }),
      { sidecarUrl: 'https://example.test/run/images/.zchunkstore' },
    )
    const onFallback = vi.fn()

    const loader = await openTiff(
      'https://example.test/run/images/stain_0001.ome.tif',
      undefined,
      onFallback,
    )

    expect(onFallback).not.toHaveBeenCalled()
    await loader.fetchTileBytes(0, 2, 1)
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      'https://example.test/run/images/stain_0001.ome.tif',
      expect.objectContaining({ headers: { Range: 'bytes=1105-1105' } }),
    )
  })

  it.each([
    ['level 0 width', { width: 400, height: 200, tile: 100 }],
    ['level 0 height', { width: 300, height: 100, tile: 100 }],
    ['tile size', { width: 300, height: 200, tile: 128 }],
  ])('ignores a sidecar whose %s differs from the TIFF', async (_label, manifest) => {
    mockTiff({ width: 300, height: 200, tileWidth: 100, tileHeight: 100 })
    stubZchunkStoreFetch(zchunkStoreManifest(manifest))
    const onFallback = vi.fn()

    const loader = await openTiff(
      'https://example.test/sample.tif',
      undefined,
      onFallback,
    )

    expect(onFallback).toHaveBeenCalledOnce()
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        coalesceKey: 'morphology-zchunkstore-unused:https://example.test/sample.tif',
      }),
    )
    expect(loader.tileWidth).toBe(100)
    expect(loader.tileDecodeOptions()).toMatchObject({ compression: 8 })
    await loader.fetchTileBytes(0, 2, 1)
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      'https://example.test/sample.tif',
      expect.objectContaining({ headers: { Range: 'bytes=60-65' } }),
    )
  })

  it('opens the z planes of an OME-TIFF stack from one shared file', async () => {
    mockTiff({
      width: 300,
      height: 200,
      tileWidth: 100,
      tileHeight: 100,
      imageDescription: zStackOmeXml,
    })
    stubZchunkStoreFetch(null, { sidecarUrl: 'https://example.test/unused.zchunkstore' })

    const firstPlane = await openTiff('https://example.test/stack.ome.tif')
    const lastPlane = await openTiff('https://example.test/stack.ome.tif#ifd=2')
    const file = await mockedFromCustomClient.mock.results[0]?.value

    expect(mockedFromCustomClient).toHaveBeenCalledTimes(1)
    expect(file.getImage).toHaveBeenCalledWith(2)
    expect(firstPlane.zStack).toEqual({ sizeZ: 3, micrometersPerPlane: 3 })
    expect(lastPlane.zStack).toEqual({ sizeZ: 3, micrometersPerPlane: 3 })
    expect(lastPlane.channels[0]?.zPlanes).toEqual([
      { ifdIndex: 0 },
      { ifdIndex: 1 },
      { ifdIndex: 2 },
    ])
  })

  it('reopens a TIFF file whose open or directory read failed', async () => {
    stubZchunkStoreFetch(null, { sidecarUrl: 'https://example.test/unused.zchunkstore' })
    mockTiff({ width: 300, height: 200, tileWidth: 100, tileHeight: 100 })
    mockedFromCustomClient.mockRejectedValueOnce(new Error('HTTP 503'))
    mockedFromCustomClient.mockResolvedValueOnce({
      getImage: vi.fn(async () => {
        throw new Error('IFD read failed')
      }),
      littleEndian: true,
      parser: { parseFileDirectoryAt: vi.fn() },
    } as unknown as Awaited<ReturnType<typeof fromCustomClient>>)

    await expect(openTiff('https://example.test/sample.tif')).rejects.toThrow('HTTP 503')
    await expect(openTiff('https://example.test/sample.tif')).rejects.toThrow(
      'IFD read failed',
    )
    await expect(openTiff('https://example.test/sample.tif')).resolves.toBeInstanceOf(
      TiffPyramidLoader,
    )
    expect(mockedFromCustomClient).toHaveBeenCalledTimes(3)
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
      sourceVersion: '4096 "etag-1"',
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
        version: '4096 "etag-1"',
        start: 10,
        end: 14,
      }),
    ])
  })

  it('refetches cached tiles once the TIFF is overwritten at its URL', async () => {
    const byteRangeCache = new MemoryByteRangeCache()
    const loaderFor = (sourceVersion: string | undefined, value: number) =>
      new TiffPyramidLoader({
        url: 'https://example.test/image.ome.tif',
        chunkIndex: new Map([['0/0/0', { offset: 10, length: 4 }]]),
        levelMeta: new Map([
          [0, { width: imagePixels(100), height: imagePixels(100), nCols: 1, nRows: 1 }],
        ]),
        units,
        tileWidth: imagePixels(100),
        tileHeight: imagePixels(100),
        numLevels: 1,
        imageWidth: imagePixels(100),
        imageHeight: imagePixels(100),
        ...(sourceVersion === undefined ? {} : { sourceVersion }),
        byteRangeCache,
        fetcher: async () => new Response(new Uint8Array(4).fill(value), { status: 206 }),
      })

    await loaderFor('4096 "etag-1"', 1).fetchTileBytes(0, 0, 0)

    await expect(loaderFor('4096 "etag-1"', 9).fetchTileBytes(0, 0, 0)).resolves.toEqual(
      new Uint8Array(4).fill(1),
    )
    await expect(loaderFor('4096 "etag-2"', 2).fetchTileBytes(0, 0, 0)).resolves.toEqual(
      new Uint8Array(4).fill(2),
    )
    // Without a version the tile is cached by URL alone.
    await expect(loaderFor(undefined, 3).fetchTileBytes(0, 0, 0)).resolves.toEqual(
      new Uint8Array(4).fill(3),
    )
    await expect(loaderFor(undefined, 4).fetchTileBytes(0, 0, 0)).resolves.toEqual(
      new Uint8Array(4).fill(3),
    )
    expect(byteRangeCache.keys()).toHaveLength(3)
  })

  it('reads cached tiles but adds none when told not to persist', async () => {
    const byteRangeCache = new MemoryByteRangeCache()
    const fetches: string[] = []
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/image.ome.tif',
      chunkIndex: new Map([
        ['0/0/0', { offset: 10, length: 4 }],
        ['0/0/1', { offset: 14, length: 4 }],
        ['0/0/2', { offset: 18, length: 4 }],
      ]),
      levelMeta: new Map([
        [0, { width: imagePixels(300), height: imagePixels(100), nCols: 3, nRows: 1 }],
      ]),
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 1,
      imageWidth: imagePixels(300),
      imageHeight: imagePixels(100),
      byteRangeCache,
      fetcher: async (_input, init) => {
        const range = new Headers(init?.headers).get('Range') ?? ''
        fetches.push(range)
        const [start = 0, end = 0] = range.replace('bytes=', '').split('-').map(Number)
        return new Response(new Uint8Array(end - start + 1).fill(start), { status: 206 })
      },
    })

    await loader.fetchTileBytes(0, 0, 0)
    // Cached, so read from the cache.
    await expect(
      loader.fetchTileBytes(0, 0, 0, undefined, { persist: false }),
    ).resolves.toEqual(new Uint8Array(4).fill(10))
    // Not cached: read together, and neither kept.
    await loader.fetchTileBytes(0, 1, 0, undefined, {
      persist: false,
      upcoming: [{ col: 2, row: 0 }],
    })
    await loader.fetchTileBytes(0, 2, 0, undefined, { persist: false })

    expect(fetches).toEqual(['bytes=10-13', 'bytes=14-21'])
    expect(byteRangeCache.keys()).toHaveLength(1)
  })

  it('adds up the bytes a set of tiles reads', async () => {
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/image.ome.tif',
      chunkIndex: new Map([
        ['0/0/0', { offset: 10, length: 4 }],
        ['0/0/1', { offset: 14, length: 0 }],
        ['0/1/0', { offset: 14, length: 9 }],
      ]),
      levelMeta: new Map([
        [0, { width: imagePixels(200), height: imagePixels(200), nCols: 2, nRows: 2 }],
      ]),
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(100),
      numLevels: 1,
      imageWidth: imagePixels(200),
      imageHeight: imagePixels(200),
      byteRangeCache: null,
    })

    await expect(
      loader.tileReadBytes(0, [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 0, row: 1 },
        // Not in the index.
        { col: 1, row: 1 },
      ]),
    ).resolves.toBe(13)
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

  it('uses actual level dimensions for non-power-of-two TIFF pyramids', () => {
    const xeniumUnits: UnitsDescriptor = {
      ...units,
      micrometersPerPixel: micrometers(0.2125),
    }
    const levels = new Map<number, TiffLevelMeta>([
      [
        0,
        { width: imagePixels(53915), height: imagePixels(40894), nCols: 211, nRows: 160 },
      ],
      [
        1,
        { width: imagePixels(26958), height: imagePixels(20447), nCols: 106, nRows: 80 },
      ],
      [2, { width: imagePixels(6740), height: imagePixels(5112), nCols: 27, nRows: 20 }],
      [3, { width: imagePixels(842), height: imagePixels(639), nCols: 4, nRows: 3 }],
      [4, { width: imagePixels(210), height: imagePixels(160), nCols: 1, nRows: 1 }],
    ])
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/aligned.ome.tif',
      chunkIndex: new Map<string, TiffChunk>(),
      levelMeta: levels,
      units: xeniumUnits,
      tileWidth: imagePixels(256),
      tileHeight: imagePixels(256),
      numLevels: 5,
      imageWidth: imagePixels(53915),
      imageHeight: imagePixels(40894),
    })

    expect(loader.tileBounds(4, 0, 0)).toEqual({
      minX: micrometers(0),
      maxX: micrometers(11456.9375),
      minY: micrometers(0),
      maxY: micrometers(8689.975),
    })
    expect(
      loader.tilesForBbox(4, {
        minX: micrometers(1000),
        maxX: micrometers(11000),
        minY: micrometers(1000),
        maxY: micrometers(8000),
      }),
    ).toEqual([{ col: 0, row: 0 }])
    expect(loader.bestLevel(0.1)).toBe(3)
  })

  it('selects no tiles for a bbox that misses the image', () => {
    const loader = new TiffPyramidLoader({
      url: 'https://example.test/partial.ome.tif',
      chunkIndex: new Map<string, TiffChunk>(),
      levelMeta: new Map<number, TiffLevelMeta>([
        [0, { width: imagePixels(250), height: imagePixels(180), nCols: 3, nRows: 3 }],
      ]),
      units,
      tileWidth: imagePixels(100),
      tileHeight: imagePixels(80),
      numLevels: 1,
      imageWidth: imagePixels(250),
      imageHeight: imagePixels(180),
      origin: { x: 1000, y: 2000 },
    })
    const bbox = (minX: number, maxX: number, minY: number, maxY: number) => ({
      minX: micrometers(minX),
      maxX: micrometers(maxX),
      minY: micrometers(minY),
      maxY: micrometers(maxY),
    })

    // Left of and above the image.
    expect(loader.tilesForBbox(0, bbox(500, 900, 2000, 2200))).toEqual([])
    expect(loader.tilesForBbox(0, bbox(1000, 1100, 1500, 1900))).toEqual([])
    // Past the right and bottom edges, over the unused part of the last tiles.
    expect(loader.tilesForBbox(0, bbox(1260, 1280, 2000, 2050))).toEqual([])
    expect(loader.tilesForBbox(0, bbox(1000, 1050, 2185, 2230))).toEqual([])
    // Touching the left edge.
    expect(loader.tilesForBbox(0, bbox(950, 1000, 2000, 2050))).toEqual([])
    // Reaching onto the image from off its top-left and bottom-right corners.
    expect(loader.tilesForBbox(0, bbox(500, 1010, 1500, 2010))).toEqual([
      { col: 0, row: 0 },
    ])
    expect(loader.tilesForBbox(0, bbox(1240, 1500, 2170, 2500))).toEqual([
      { col: 2, row: 2 },
    ])
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

function tiffDirectory(values: Readonly<Record<string, unknown>>) {
  return {
    async loadValue(tagIdentifier: string | number): Promise<unknown> {
      return values[String(tagIdentifier)]
    },
  }
}

function mockTiff(size: {
  readonly width: number
  readonly height: number
  readonly tileWidth: number
  readonly tileHeight: number
  readonly imageDescription?: string
}): void {
  const directory = tiffDirectory({
    ImageDescription: size.imageDescription,
    BitsPerSample: new Uint16Array([16]),
    Compression: 8,
    Predictor: 2,
    SamplesPerPixel: 1,
    TileByteCounts: new Uint32Array([1, 2, 3, 4, 5, 6]),
    TileOffsets: new BigUint64Array([10n, 20n, 30n, 40n, 50n, 60n]),
  })
  const image = {
    getFileDirectory: () => directory,
    getHeight: () => size.height,
    getTileHeight: () => size.tileHeight,
    getTileWidth: () => size.tileWidth,
    getWidth: () => size.width,
  }

  mockedFromCustomClient.mockResolvedValue({
    getImage: vi.fn(async () => image),
    littleEndian: true,
    parser: { parseFileDirectoryAt: vi.fn() },
  } as unknown as Awaited<ReturnType<typeof fromCustomClient>>)
}

// A one-level sidecar listing every tile of the given channels. Tile (row 1,
// col 2) of channel 0 is at bytes 900-903.
function zchunkStoreManifest(size: {
  readonly width: number
  readonly height: number
  readonly tile: number
  readonly channels?: readonly number[]
}): unknown {
  const chunks: Record<string, unknown> = {}
  const rows = Math.ceil(size.height / size.tile)
  const cols = Math.ceil(size.width / size.tile)

  for (const channel of size.channels ?? [0]) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        chunks[`0/c/${channel.toString()}/${row.toString()}/${col.toString()}`] = {
          offset: 1000 + channel * 100 + row * cols + col,
          size: 1,
        }
      }
    }
  }

  return {
    'zarr.json': {
      zarr_format: 3,
      node_type: 'group',
      attributes: { multiscales: [{ datasets: [{ path: '0' }] }] },
    },
    '0/zarr.json': {
      zarr_format: 3,
      node_type: 'array',
      shape: [Math.max(...(size.channels ?? [0])) + 1, size.height, size.width],
      chunk_grid: { configuration: { chunk_shape: [1, size.tile, size.tile] } },
    },
    ...chunks,
    '0/c/0/1/2': { offset: 900, size: 4 },
  }
}

function stubZchunkStoreFetch(
  manifest: unknown,
  { sidecarUrl = 'https://example.test/sample.tif.zchunkstore' } = {},
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === sidecarUrl) {
        return Response.json(manifest)
      }

      if (!String(input).endsWith('.zchunkstore')) {
        return new Response(new Uint8Array(8), { status: 206 })
      }

      return new Response(null, { status: 404 })
    }),
  )
}

const twoFileOmeXml = `<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYZCT" Type="uint16" SizeX="300" SizeY="200" SizeZ="1" SizeC="2" SizeT="1">
      <Channel ID="Channel:0" Name="DAPI" SamplesPerPixel="1"/>
      <Channel ID="Channel:1" Name="18S" SamplesPerPixel="1"/>
      <TiffData FirstC="0" PlaneCount="1"><UUID FileName="stain_0000.ome.tif">urn:uuid:0</UUID></TiffData>
      <TiffData FirstC="1" PlaneCount="1"><UUID FileName="stain_0001.ome.tif">urn:uuid:1</UUID></TiffData>
    </Pixels>
  </Image>
</OME>`

const zStackOmeXml = `<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYZCT" Type="uint16" SizeX="300" SizeY="200" SizeZ="3" SizeC="1" SizeT="1" PhysicalSizeZ="3.0" PhysicalSizeZUnit="µm">
      <Channel ID="Channel:0" Name="DAPI" SamplesPerPixel="1"/>
      <TiffData PlaneCount="3"/>
    </Pixels>
  </Image>
</OME>`

function tileBytes(offset: number): Uint8Array {
  return Uint8Array.from({ length: 10 }, (_unused, index) => (offset + index) % 256)
}

// A 6 x 2 level written row by row from byte 1000, 10 bytes per tile, except
// tile (5, 1), stored at byte 50,000. Each response byte is its file offset
// modulo 256. Delayed responses wait for respond().
function adjacentTilesLoader(options: { readonly delayed?: boolean } = {}) {
  const chunks = new Map<string, TiffChunk>()

  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      chunks.set(`0/${row}/${col}`, { offset: 1000 + (row * 6 + col) * 10, length: 10 })
    }
  }

  chunks.set('0/1/5', { offset: 50_000, length: 10 })
  const ranges: string[] = []
  const signals: (AbortSignal | undefined)[] = []
  const waiting: (() => void)[] = []
  const loader = new TiffPyramidLoader({
    url: 'https://example.test/slide.svs',
    chunkIndex: chunks,
    levelMeta: new Map([
      [0, { width: imagePixels(600), height: imagePixels(200), nCols: 6, nRows: 2 }],
    ]),
    units,
    tileWidth: imagePixels(100),
    tileHeight: imagePixels(100),
    numLevels: 1,
    imageWidth: imagePixels(600),
    imageHeight: imagePixels(200),
    fetcher: async (_input, init) => {
      const range = new Headers(init?.headers).get('Range') ?? ''
      const [start = 0, end = 0] = range.slice(6).split('-').map(Number)
      ranges.push(range)
      signals.push(init?.signal ?? undefined)

      if (options.delayed === true) {
        await new Promise<void>((resolve) => {
          waiting.push(resolve)
        })
      }

      return new Response(
        Uint8Array.from(
          { length: end - start + 1 },
          (_unused, index) => (start + index) % 256,
        ),
        { status: 206 },
      )
    },
    byteRangeCache: null,
  })

  return {
    loader,
    ranges,
    signals,
    respond: () => {
      for (const resolve of waiting.splice(0)) {
        resolve()
      }
    },
  }
}
