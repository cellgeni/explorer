import type * as zarr from 'zarrita'
import { describe, expect, it, vi } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import type { ImagePyramidLoader } from '../data/imagePyramid'
import { morphologyImageFromPyramidLoader } from '../data/morphologyImage'
import { sampleDecodedTile } from '../data/tileSamples'
import { ICECHUNK_FIXTURE_ORIGIN, icechunkFixtureFetcher } from '../test/icechunkFixtures'
import { chunkWindowSamples, decodeChunk } from '../workers/zarrDecodeCore'
import type { ZarrDecodeRequest, ZarrDecodeResponse } from '../workers/zarrDecodeMessages'
import { ZarrDecodePool, type ZarrDecodeWorkerLike } from '../workers/zarrDecodePool'
import {
  omeZarrImageRootUrl,
  omeZarrPlaneSelectionUrl,
  openOmeZarrImageWithOptions,
} from './omeZarrLoader'

const encoder = new TextEncoder()

// Holds chunks and samples them with the real worker code, behind a
// structured-clone boundary.
class SamplingZarrWorker implements ZarrDecodeWorkerLike {
  onmessage: ((event: MessageEvent<ZarrDecodeResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private readonly chunks = new Map<string, Promise<zarr.Chunk<zarr.DataType>>>()

  postMessage(message: ZarrDecodeRequest): void {
    const request = structuredClone(message)

    if (request.type === 'put-chunk') {
      this.chunks.set(request.cacheKey, decodeChunk(request.source, request.bytes))
      return
    }

    if (request.type !== 'sample-tile') {
      throw new Error(`Unexpected ${request.type} request.`)
    }

    const chunk = this.chunks.get(request.cacheKey)
    void (async (): Promise<ZarrDecodeResponse> => {
      if (chunk === undefined) {
        return { type: 'miss', id: request.id }
      }

      const tile = chunkWindowSamples(await chunk, request.window, request.sampling)
      return { type: 'samples', id: request.id, ...tile }
    })().then((response) => {
      this.onmessage?.({
        data: structuredClone(response),
      } as MessageEvent<ZarrDecodeResponse>)
    })
  }

  terminate(): void {}
}

describe('OME-Zarr image loader', () => {
  it('opens an OME-Zarr 0.5 image from an Icechunk repository', async () => {
    const loader = await openOmeZarrImageWithOptions(
      `${ICECHUNK_FIXTURE_ORIGIN}/image.icechunk`,
      { fetcher: icechunkFixtureFetcher() },
    )

    expect([loader.imageWidth, loader.imageHeight]).toEqual([8, 8])
    expect([loader.tileWidth, loader.tileHeight]).toEqual([4, 4])
    expect(loader.units.micrometersPerPixel).toBe(0.5)

    const tile = await loader.loadTilePixels(0, 1, 1)

    // Pixel (x=4, y=4) of the image, whose value is 4 × its index.
    expect(tile.pixels[0]).toBe((4 * 8 + 4) * 4)
  })

  it('opens legacy multiscales metadata and exposes RGB channel loaders', async () => {
    const rootUrl = 'https://example.test/images/sample.ome.zarr'
    const loader = await openOmeZarrImageWithOptions(rootUrl, {
      fetcher: fetcherForFiles(legacyV2OmeZarrFiles('/images/sample.ome.zarr')),
    })

    expect(loader.url).toBe(rootUrl)
    expect(loader.imageWidth).toBe(4)
    expect(loader.imageHeight).toBe(4)
    expect(loader.tileWidth).toBe(2)
    expect(loader.tileHeight).toBe(2)
    expect(loader.units.micrometersPerPixel).toBe(0.5)
    expect(loader.channels).toEqual([
      expect.objectContaining({
        id: 'Channel:0',
        name: 'Red',
        color: [255, 0, 0],
        alphaFromIntensity: false,
      }),
      expect.objectContaining({
        id: 'Channel:1',
        name: 'Green',
        color: [0, 255, 0],
        sourceUrl: `${rootUrl}#c=1`,
        alphaFromIntensity: false,
      }),
      expect.objectContaining({
        id: 'Channel:2',
        name: 'Blue',
        color: [0, 0, 255],
        sourceUrl: `${rootUrl}#c=2`,
        alphaFromIntensity: false,
      }),
    ])
  })

  it('splits large chunks into virtual tiles that share one chunk read', async () => {
    const rootPath = '/images/big.zarr'
    const size = 600
    const pixels = new Uint8Array(size * size)

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        pixels[y * size + x] = (x + y) % 251
      }
    }

    const fetcher = fetcherForFiles(
      new Map([
        [`${rootPath}/.zgroup`, jsonBytes({ zarr_format: 2 })],
        [
          `${rootPath}/.zattrs`,
          jsonBytes({
            multiscales: [
              {
                axes: [
                  { name: 'y', type: 'space' },
                  { name: 'x', type: 'space' },
                ],
                datasets: [{ path: '0' }],
              },
            ],
          }),
        ],
        [`${rootPath}/0/.zarray`, jsonBytes(v2ArrayMetadata([size, size], [size, size]))],
        [`${rootPath}/0/0.0`, pixels],
      ]),
    )
    const loader = await openOmeZarrImageWithOptions(`https://example.test${rootPath}`, {
      fetcher,
    })

    expect([loader.tileWidth, loader.tileHeight]).toEqual([300, 300])
    expect(loader.tilesForLevel(0)).toHaveLength(4)

    const tiles = await Promise.all(
      loader.tilesForLevel(0).map((tile) => loader.loadTilePixels(0, tile.col, tile.row)),
    )
    const bottomRight = tiles[3]

    expect(bottomRight?.width).toBe(300)
    // Pixel (x=310, y=305) of the image is (10, 5) in the bottom-right tile.
    expect(bottomRight?.pixels[5 * 300 + 10]).toBe((310 + 305) % 251)
    expect(
      requestedPaths(fetcher).filter((path) => path === `${rootPath}/0/0.0`),
    ).toHaveLength(1)
  })

  it('treats SpatialData index-labelled 8-bit three-channel images as RGB', async () => {
    const rootUrl = 'https://example.test/images/he.zarr'
    const loader = await openOmeZarrImageWithOptions(rootUrl, {
      fetcher: fetcherForFiles(
        legacyV2OmeZarrFiles('/images/he.zarr', {
          omero: { channels: [{ label: 0 }, { label: 1 }, { label: '2' }] },
        }),
      ),
    })

    expect(loader.channels.map((channel) => [channel.name, channel.color])).toEqual([
      ['Red', [255, 0, 0]],
      ['Green', [0, 255, 0]],
      ['Blue', [0, 0, 255]],
    ])
    expect(loader.channels.every((channel) => channel.alphaFromIntensity === false)).toBe(
      true,
    )
  })

  it('keeps index-labelled 16-bit three-channel images as fluorescence channels', async () => {
    const loader = await openOmeZarrImageWithOptions(
      'https://example.test/images/if.zarr',
      {
        fetcher: fetcherForFiles(
          legacyV2OmeZarrFiles('/images/if.zarr', {
            omero: { channels: [{ label: 0 }, { label: 1 }, { label: 2 }] },
            dtype: '<u2',
          }),
        ),
      },
    )

    expect(loader.channels.map((channel) => channel.name)).toEqual([
      'Channel 1',
      'Channel 2',
      'Channel 3',
    ])
    expect(loader.channels.some((channel) => channel.alphaFromIntensity === false)).toBe(
      false,
    )
  })

  it('parses v0.5 metadata under the ome attribute and converts spatial units', async () => {
    const loader = await openOmeZarrImageWithOptions(
      'https://example.test/plain/zarr.json',
      {
        fetcher: fetcherForFiles(v3OmeZarrFiles('/plain')),
      },
    )

    expect(loader.imageWidth).toBe(20)
    expect(loader.imageHeight).toBe(10)
    expect(loader.tileWidth).toBe(5)
    expect(loader.tileHeight).toBe(5)
    expect(loader.units.micrometersPerPixel).toBe(0.5)
    expect(loader.channels).toEqual([
      expect.objectContaining({
        id: 'Channel:0',
        name: 'DAPI',
        color: [88, 144, 255],
        contrast: { min: 5, max: 200 },
      }),
      expect.objectContaining({
        id: 'Channel:1',
        name: 'Marker',
        sourceUrl: 'https://example.test/plain/zarr.json#c=1',
      }),
    ])
  })

  it('selects tiles and level bounds from OME-Zarr coordinate transforms', async () => {
    const loader = await openOmeZarrImageWithOptions(
      'https://example.test/images/sample.ome.zarr',
      {
        fetcher: fetcherForFiles(legacyV2OmeZarrFiles('/images/sample.ome.zarr')),
      },
    )
    const bbox: BBox = {
      minX: micrometers(0),
      maxX: micrometers(2),
      minY: micrometers(0),
      maxY: micrometers(2),
    }

    expect(loader.bestLevel(1)).toBe(1)
    expect(loader.bestLevel(2)).toBe(0)
    expect(loader.tilesForBbox(0, bbox)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
    ])
    expect(loader.tileBounds(0, 1, 1)).toEqual({
      minX: 1,
      maxX: 2,
      minY: 1,
      maxY: 2,
    })
  })

  it('places levels in an external coordinate system with a planar transform', async () => {
    const loader = await openOmeZarrImageWithOptions(
      'https://example.test/images/sample.ome.zarr',
      {
        fetcher: fetcherForFiles(legacyV2OmeZarrFiles('/images/sample.ome.zarr')),
        planarTransform: { scaleX: 2, scaleY: 3, translateX: 100, translateY: 50 },
      },
    )

    expect(loader.units.micrometersPerPixel).toBe(1)
    expect(loader.tileBounds(0, 1, 1)).toEqual({
      minX: 102,
      maxX: 104,
      minY: 53,
      maxY: 56,
    })
    expect(
      loader.tilesForBbox(0, {
        minX: micrometers(100),
        maxX: micrometers(101),
        minY: micrometers(54),
        maxY: micrometers(55),
      }),
    ).toEqual([{ col: 0, row: 1 }])
  })

  it('samples a virtual tile in the worker that holds its chunk', async () => {
    const rootPath = '/images/sampled.zarr'
    const size = 600
    const pixels = Uint8Array.from(
      { length: size * size },
      (_value, index) => index % 251,
    )
    const files = new Map([
      [`${rootPath}/.zgroup`, jsonBytes({ zarr_format: 2 })],
      [
        `${rootPath}/.zattrs`,
        jsonBytes({
          multiscales: [
            {
              axes: [
                { name: 'y', type: 'space' },
                { name: 'x', type: 'space' },
              ],
              datasets: [{ path: '0' }],
            },
          ],
        }),
      ],
      [`${rootPath}/0/.zarray`, jsonBytes(v2ArrayMetadata([size, size], [size, size]))],
      [`${rootPath}/0/0.0`, pixels],
    ])
    const url = `https://example.test${rootPath}`
    const inWorker = await openOmeZarrImageWithOptions(url, {
      fetcher: fetcherForFiles(files),
      decodePool: new ZarrDecodePool({
        size: 1,
        workerFactory: () => new SamplingZarrWorker(),
      }),
    })
    const onMainThread = await openOmeZarrImageWithOptions(url, {
      fetcher: fetcherForFiles(files),
      decodePool: null,
    })
    const sampling = { startIndex: 90_001, stride: 7, width: 300, height: 300 }
    const decoded = await onMainThread.loadTilePixels(0, 1, 1)
    const expected = sampleDecodedTile(
      decoded.pixels,
      decoded.width,
      decoded.height,
      sampling,
    )

    const tile = await inWorker.sampleTilePixels(0, 1, 1, sampling)

    expect(Array.from(tile?.samples ?? [])).toEqual(Array.from(expected.samples))
    expect(tile?.pixelCount).toBe(90_000)
    expect(expected.samples.length).toBeGreaterThan(12_000)
    await expect(onMainThread.sampleTilePixels(0, 1, 1, sampling)).resolves.toBeNull()
  })

  it('reads a selected Zarr channel tile as decoded pixels and bitmap data', async () => {
    vi.stubGlobal(
      'ImageData',
      class MockImageData {
        readonly data: Uint8ClampedArray
        readonly width: number
        readonly height: number

        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data
          this.width = width
          this.height = height
        }
      },
    )
    const createBitmap = vi.fn(async (imageData: ImageData) => {
      return { close: vi.fn(), imageData } as unknown as ImageBitmap
    })

    try {
      const loader = await openOmeZarrImageWithOptions(
        'https://example.test/images/sample.ome.zarr#c=1',
        {
          createBitmap,
          fetcher: fetcherForFiles(legacyV2OmeZarrFiles('/images/sample.ome.zarr')),
        },
      )

      await expect(loader.loadTilePixels(0, 0, 0)).resolves.toMatchObject({
        width: 2,
        height: 2,
        pixels: new Uint8Array([10, 20, 30, 40]),
      })

      const decoded = await loader.loadTile(0, 0, 0, {
        color: [0, 255, 0],
        displayWindow: { lo: 0, hi: 40 },
        alphaFromIntensity: true,
      })

      expect(decoded.width).toBe(2)
      expect(decoded.height).toBe(2)
      expect(decoded.lo).toBe(0)
      expect(decoded.hi).toBe(40)
      expect(createBitmap).toHaveBeenCalledOnce()
      expect(
        Array.from((createBitmap.mock.calls[0]?.[0] as ImageData).data.slice(0, 4)),
      ).toEqual([0, 64, 0, 64])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('treats 403s for missing metadata keys as absent on buckets that deny listing', async () => {
    const rootPath = '/images/sample.ome.zarr'
    const files = legacyV2OmeZarrFiles(rootPath)
    files.delete(`${rootPath}/0/.zattrs`)
    files.delete(`${rootPath}/1/.zattrs`)
    const fetcher = fetcherForFiles(files, { missingStatus: 403 })
    const loader = await openOmeZarrImageWithOptions(
      `https://example.test${rootPath}#c=1`,
      { fetcher },
    )

    expect(loader.imageWidth).toBe(4)
    expect(loader.channels).toHaveLength(3)
    await expect(loader.loadTilePixels(0, 0, 0)).resolves.toMatchObject({
      pixels: new Uint8Array([10, 20, 30, 40]),
    })

    const channelZero = await openOmeZarrImageWithOptions(
      `https://example.test${rootPath}#c=0`,
      { fetcher },
    )

    // Chunk 403s are real access failures, not missing (fill-value) chunks.
    await expect(channelZero.loadTilePixels(0, 0, 0)).rejects.toThrow('403')
  })

  it('reads level metadata from consolidated metadata when the image root has it', async () => {
    const rootPath = '/images/sample.ome.zarr'
    const files = legacyV2OmeZarrFiles(rootPath)
    const metadata = Object.fromEntries(
      Array.from(files)
        .filter(([path]) => /\/\.z(?:group|attrs|array)$/.test(path))
        .map(([path, bytes]) => [
          path.slice(rootPath.length + 1),
          JSON.parse(new TextDecoder().decode(bytes)) as unknown,
        ]),
    )
    const fetcher = fetcherForFiles(
      new Map([
        [`${rootPath}/.zmetadata`, jsonBytes({ zarr_consolidated_format: 1, metadata })],
        [`${rootPath}/0/1.0.0`, files.get(`${rootPath}/0/1.0.0`) ?? new Uint8Array()],
      ]),
      { missingStatus: 403 },
    )
    const loader = await openOmeZarrImageWithOptions(
      `https://example.test${rootPath}#c=1`,
      { fetcher },
    )

    expect(loader.imageWidth).toBe(4)
    await expect(loader.loadTilePixels(0, 0, 0)).resolves.toMatchObject({
      pixels: new Uint8Array([10, 20, 30, 40]),
    })
    expect(requestedPaths(fetcher)).not.toContainEqual(
      expect.stringMatching(/\.z(?:group|attrs|array)$/),
    )
  })

  it('normalizes metadata URLs to their Zarr root', () => {
    expect(omeZarrImageRootUrl('https://example.test/image/zarr.json')).toBe(
      'https://example.test/image',
    )
    expect(omeZarrImageRootUrl('https://example.test/image/.zattrs?token=1')).toBe(
      'https://example.test/image?token=1',
    )
  })

  it('opens the first series of a bioformats2raw layout', async () => {
    const rootPath = '/images/converted.zarr'
    const layoutFiles = new Map([
      [`${rootPath}/.zgroup`, jsonBytes({ zarr_format: 2 })],
      [`${rootPath}/.zattrs`, jsonBytes({ 'bioformats2raw.layout': 3 })],
    ])
    const withSeries = await openOmeZarrImageWithOptions(
      `https://example.test${rootPath}#c=1`,
      {
        fetcher: fetcherForFiles(
          new Map([
            ...layoutFiles,
            [`${rootPath}/OME/.zgroup`, jsonBytes({ zarr_format: 2 })],
            [`${rootPath}/OME/.zattrs`, jsonBytes({ series: ['1'] })],
            ...legacyV2OmeZarrFiles(`${rootPath}/1`),
          ]),
        ),
      },
    )

    expect(withSeries.imageWidth).toBe(4)
    expect(withSeries.channels).toHaveLength(3)
    await expect(withSeries.loadTilePixels(0, 0, 0)).resolves.toMatchObject({
      pixels: new Uint8Array([10, 20, 30, 40]),
    })

    // Without an OME group, the first series is at 0.
    const withoutOmeGroup = await openOmeZarrImageWithOptions(
      `https://example.test${rootPath}#c=1`,
      {
        fetcher: fetcherForFiles(
          new Map([...layoutFiles, ...legacyV2OmeZarrFiles(`${rootPath}/0`)]),
          { missingStatus: 403 },
        ),
      },
    )

    await expect(withoutOmeGroup.loadTilePixels(0, 0, 0)).resolves.toMatchObject({
      pixels: new Uint8Array([10, 20, 30, 40]),
    })
  })

  it('opens a z-stack on the plane omero rendering settings name, else the middle one', async () => {
    const rootPath = '/images/stack.ome.zarr'
    const open = (omero?: unknown) =>
      openOmeZarrImageWithOptions(`https://example.test${rootPath}`, {
        fetcher: fetcherForFiles(zStackOmeZarrFiles(rootPath, { omero })),
      })
    const withDefaultZ = await open({ rdefs: { defaultZ: 2 } })
    const zPlanes = [{ zIndex: 0 }, { zIndex: 1 }, { zIndex: 2 }]

    expect(withDefaultZ.zStack).toEqual({ sizeZ: 3, defaultZPlane: 2 })
    expect(withDefaultZ.channels.map((channel) => channel.zPlanes)).toEqual([
      zPlanes,
      zPlanes,
    ])
    await expect(firstPixel(withDefaultZ)).resolves.toBe(3)

    // Without rendering settings, or with an out-of-range plane, the middle
    // plane is read, as for other z-stacks.
    for (const omero of [undefined, { rdefs: { defaultZ: 3 } }]) {
      const loader = await open(omero)

      expect(loader.zStack?.defaultZPlane).toBe(1)
      await expect(firstPixel(loader)).resolves.toBe(2)
    }
  })

  it('selects a z plane with a z hash parameter beside the channel selector', async () => {
    const rootUrl = 'https://example.test/images/stack.ome.zarr'
    const fetcher = fetcherForFiles(zStackOmeZarrFiles('/images/stack.ome.zarr'))
    const open = (hash: string) =>
      openOmeZarrImageWithOptions(`${rootUrl}${hash}`, { fetcher })
    const channelOnePlaneZero = await open('#c=1&z=0')

    expect(channelOnePlaneZero.zStack?.defaultZPlane).toBe(0)
    await expect(firstPixel(channelOnePlaneZero)).resolves.toBe(11)

    // The image's channel loaders read the plane its URL selects.
    const planeTwo = await open('#z=2')

    await expect(firstPixel(planeTwo)).resolves.toBe(3)
    expect(planeTwo.channels[1]?.sourceUrl).toBe(`${rootUrl}#z=2&c=1`)

    // Selectors that are not planes of the stack read the default plane.
    for (const hash of ['#z=3', '#z=-1', '#z=one', '#z=']) {
      await expect(firstPixel(await open(hash))).resolves.toBe(2)
    }

    expect(omeZarrPlaneSelectionUrl(`${rootUrl}#c=1`, 2)).toBe(`${rootUrl}#c=1&z=2`)
  })

  it('reports the z spacing only when the z axis has a length unit', async () => {
    const rootPath = '/images/stack.ome.zarr'
    const open = (zAxisUnit?: string) =>
      openOmeZarrImageWithOptions(`https://example.test${rootPath}`, {
        fetcher: fetcherForFiles(
          zStackOmeZarrFiles(rootPath, {
            zScale: 500,
            ...(zAxisUnit === undefined ? {} : { zAxisUnit }),
          }),
        ),
      })

    expect((await open('nanometer')).zStack?.micrometersPerPlane).toBe(0.5)
    // bioformats2raw writes a unitless z scale when the spacing is unknown.
    expect((await open()).zStack).not.toHaveProperty('micrometersPerPlane')
  })

  it('reads the matching plane of pyramid levels downsampled along z', async () => {
    const rootPath = '/images/isotropic.ome.zarr'
    const files = new Map([
      [`${rootPath}/.zgroup`, jsonBytes({ zarr_format: 2 })],
      [
        `${rootPath}/.zattrs`,
        jsonBytes({
          multiscales: [
            {
              axes: [
                { name: 'z', type: 'space' },
                { name: 'y', type: 'space' },
                { name: 'x', type: 'space' },
              ],
              datasets: [{ path: '0' }, { path: '1' }],
            },
          ],
        }),
      ],
      [`${rootPath}/0/.zarray`, jsonBytes(v2ArrayMetadata([4, 2, 2], [1, 2, 2]))],
      [`${rootPath}/1/.zarray`, jsonBytes(v2ArrayMetadata([2, 1, 1], [1, 1, 1]))],
      ...[0, 1, 2, 3].map(
        (z) =>
          [`${rootPath}/0/${z.toString()}.0.0`, new Uint8Array(4).fill(z + 1)] as const,
      ),
      ...[0, 1].map(
        (z) =>
          [`${rootPath}/1/${z.toString()}.0.0`, new Uint8Array([10 * (z + 1)])] as const,
      ),
    ])
    const loader = await openOmeZarrImageWithOptions(
      `https://example.test${rootPath}#z=3`,
      { fetcher: fetcherForFiles(files) },
    )

    await expect(loader.loadTilePixels(0, 0, 0)).resolves.toMatchObject({
      pixels: new Uint8Array([4, 4, 4, 4]),
    })
    // Level 1 halves z, so level-0 plane 3 is its plane 1.
    await expect(loader.loadTilePixels(1, 0, 0)).resolves.toMatchObject({
      pixels: new Uint8Array([20]),
    })
  })

  it('opens other z planes of a morphology z-stack with a z selector', async () => {
    const rootUrl = 'https://example.test/images/stack.ome.zarr'
    const fetcher = fetcherForFiles(
      zStackOmeZarrFiles('/images/stack.ome.zarr', { omero: { rdefs: { defaultZ: 2 } } }),
    )
    const openImage = vi.fn((url: string) =>
      openOmeZarrImageWithOptions(url, { fetcher }),
    )
    const baseLoader = await openImage(rootUrl)
    const image = await morphologyImageFromPyramidLoader(rootUrl, baseLoader, {
      openImage,
    })

    expect(image.zStack).toMatchObject({ sizeZ: 3, zPlane: 2 })
    // Channel 0 at the default plane is the image URL's own loader.
    expect(image.channelLoaders[0]?.loader).toBe(baseLoader)
    expect(image.channelLoaders[1]?.loader.url).toBe(`${rootUrl}#c=1`)
    await expect(channelFirstPixels(image.channelLoaders)).resolves.toEqual([3, 13])

    const firstPlane = await image.zStack?.openPlane(0)

    expect(firstPlane?.zStack?.zPlane).toBe(0)
    expect(firstPlane?.channelLoaders.map((channel) => channel.loader.url)).toEqual([
      `${rootUrl}#z=0`,
      `${rootUrl}#c=1&z=0`,
    ])
    await expect(channelFirstPixels(firstPlane?.channelLoaders ?? [])).resolves.toEqual([
      1, 11,
    ])

    // A restored plane opens there.
    const restored = await morphologyImageFromPyramidLoader(rootUrl, baseLoader, {
      openImage,
      zPlane: 1,
    })

    await expect(channelFirstPixels(restored.channelLoaders)).resolves.toEqual([2, 12])
  })

  it('rejects generic Zarr groups without OME multiscales metadata', async () => {
    await expect(
      openOmeZarrImageWithOptions('https://example.test/generic.zarr', {
        fetcher: fetcherForFiles(
          new Map([
            ['/generic.zarr/.zgroup', jsonBytes({ zarr_format: 2 })],
            ['/generic.zarr/.zattrs', jsonBytes({ unrelated: true })],
          ]),
        ),
      }),
    ).rejects.toThrow('missing multiscales metadata')
  })
})

function legacyV2OmeZarrFiles(
  rootPath: string,
  options: { readonly omero?: unknown; readonly dtype?: string } = {},
): Map<string, Uint8Array> {
  const attrs = {
    ...(options.omero === undefined ? {} : { omero: options.omero }),
    multiscales: [
      {
        axes: [
          { name: 'c', type: 'channel' },
          { name: 'y', type: 'space', unit: 'micrometer' },
          { name: 'x', type: 'space', unit: 'micrometer' },
        ],
        datasets: [
          {
            path: '0',
            coordinateTransformations: [{ type: 'scale', scale: [1, 0.5, 0.5] }],
          },
          {
            path: '1',
            coordinateTransformations: [{ type: 'scale', scale: [1, 1, 1] }],
          },
        ],
      },
    ],
  }

  return new Map([
    [`${rootPath}/.zgroup`, jsonBytes({ zarr_format: 2 })],
    [`${rootPath}/.zattrs`, jsonBytes(attrs)],
    [
      `${rootPath}/0/.zarray`,
      jsonBytes(v2ArrayMetadata([3, 4, 4], [1, 2, 2], options.dtype)),
    ],
    [`${rootPath}/0/.zattrs`, jsonBytes({ _ARRAY_DIMENSIONS: ['c', 'y', 'x'] })],
    [
      `${rootPath}/1/.zarray`,
      jsonBytes(v2ArrayMetadata([3, 2, 2], [1, 2, 2], options.dtype)),
    ],
    [`${rootPath}/1/.zattrs`, jsonBytes({ _ARRAY_DIMENSIONS: ['c', 'y', 'x'] })],
    [`${rootPath}/0/1.0.0`, new Uint8Array([10, 20, 30, 40])],
  ])
}

// A c, z, y, x image of 2 channels by 3 planes of 2 × 2 pixels. Each plane is
// filled with 10c + z + 1.
function zStackOmeZarrFiles(
  rootPath: string,
  options: {
    readonly omero?: unknown
    readonly zAxisUnit?: string
    readonly zScale?: number
  } = {},
): Map<string, Uint8Array> {
  const files = new Map([
    [`${rootPath}/.zgroup`, jsonBytes({ zarr_format: 2 })],
    [
      `${rootPath}/.zattrs`,
      jsonBytes({
        ...(options.omero === undefined ? {} : { omero: options.omero }),
        multiscales: [
          {
            axes: [
              { name: 'c', type: 'channel' },
              {
                name: 'z',
                type: 'space',
                ...(options.zAxisUnit === undefined ? {} : { unit: options.zAxisUnit }),
              },
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            datasets: [
              {
                path: '0',
                coordinateTransformations: [
                  { type: 'scale', scale: [1, options.zScale ?? 1, 1, 1] },
                ],
              },
            ],
          },
        ],
      }),
    ],
    [`${rootPath}/0/.zarray`, jsonBytes(v2ArrayMetadata([2, 3, 2, 2], [1, 1, 2, 2]))],
  ])

  for (const c of [0, 1]) {
    for (const z of [0, 1, 2]) {
      files.set(
        `${rootPath}/0/${c.toString()}.${z.toString()}.0.0`,
        new Uint8Array(4).fill(10 * c + z + 1),
      )
    }
  }

  return files
}

async function firstPixel(loader: ImagePyramidLoader): Promise<number | undefined> {
  return (await loader.loadTilePixels?.(0, 0, 0))?.pixels[0]
}

function channelFirstPixels(
  channels: readonly { readonly loader: ImagePyramidLoader }[],
): Promise<(number | undefined)[]> {
  return Promise.all(channels.map((channel) => firstPixel(channel.loader)))
}

function v3OmeZarrFiles(rootPath: string): Map<string, Uint8Array> {
  const groupMetadata = {
    zarr_format: 3,
    node_type: 'group',
    attributes: {
      ome: {
        version: '0.5',
        multiscales: [
          {
            axes: [
              { name: 'c', type: 'channel' },
              { name: 'y', type: 'space', unit: 'nanometer' },
              { name: 'x', type: 'space', unit: 'nanometer' },
            ],
            datasets: [
              {
                path: '0',
                coordinateTransformations: [{ type: 'scale', scale: [1, 500, 500] }],
              },
            ],
          },
        ],
        omero: {
          channels: [
            {
              label: 'DAPI',
              color: '5890FF',
              window: { start: 5, end: 200 },
            },
            {
              label: 'Marker',
              color: 'D73F7C',
              window: { start: 1, end: 100 },
            },
          ],
        },
      },
    },
  }

  return new Map([
    [`${rootPath}/zarr.json`, jsonBytes(groupMetadata)],
    [`${rootPath}/0/zarr.json`, jsonBytes(v3ArrayMetadata([2, 10, 20], [1, 5, 5]))],
  ])
}

function v2ArrayMetadata(
  shape: readonly number[],
  chunks: readonly number[],
  dtype = '|u1',
) {
  return {
    zarr_format: 2,
    shape,
    chunks,
    dtype,
    compressor: null,
    fill_value: 0,
    order: 'C',
    filters: null,
    dimension_separator: '.',
  }
}

function v3ArrayMetadata(shape: readonly number[], chunks: readonly number[]) {
  return {
    zarr_format: 3,
    node_type: 'array',
    shape,
    data_type: 'uint8',
    chunk_grid: {
      name: 'regular',
      configuration: { chunk_shape: chunks },
    },
    chunk_key_encoding: {
      name: 'default',
      configuration: { separator: '/' },
    },
    codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
    fill_value: 0,
    attributes: { dimension_names: ['c', 'y', 'x'] },
  }
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

function fetcherForFiles(
  files: ReadonlyMap<string, Uint8Array>,
  options: { readonly missingStatus?: number } = {},
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input)
    const bytes = files.get(url.pathname)

    return bytes === undefined
      ? new Response(null, { status: options.missingStatus ?? 404 })
      : new Response(copyToArrayBuffer(bytes))
  }) as unknown as typeof fetch
}

function requestedPaths(fetcher: typeof fetch): string[] {
  return vi.mocked(fetcher).mock.calls.map(([input]) => requestUrl(input).pathname)
}

function requestUrl(input: RequestInfo | URL): URL {
  return input instanceof Request ? new URL(input.url) : new URL(String(input))
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)

  new Uint8Array(buffer).set(bytes)
  return buffer
}
