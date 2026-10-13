import { describe, expect, it, vi } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import { omeZarrImageRootUrl, openOmeZarrImageWithOptions } from './omeZarrLoader'

const encoder = new TextEncoder()

describe('OME-Zarr image loader', () => {
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

function legacyV2OmeZarrFiles(rootPath: string): Map<string, Uint8Array> {
  const attrs = {
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
    [`${rootPath}/0/.zarray`, jsonBytes(v2ArrayMetadata([3, 4, 4], [1, 2, 2]))],
    [`${rootPath}/0/.zattrs`, jsonBytes({ _ARRAY_DIMENSIONS: ['c', 'y', 'x'] })],
    [`${rootPath}/1/.zarray`, jsonBytes(v2ArrayMetadata([3, 2, 2], [1, 2, 2]))],
    [`${rootPath}/1/.zattrs`, jsonBytes({ _ARRAY_DIMENSIONS: ['c', 'y', 'x'] })],
    [`${rootPath}/0/1.0.0`, new Uint8Array([10, 20, 30, 40])],
  ])
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

function v2ArrayMetadata(shape: readonly number[], chunks: readonly number[]) {
  return {
    zarr_format: 2,
    shape,
    chunks,
    dtype: '|u1',
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
