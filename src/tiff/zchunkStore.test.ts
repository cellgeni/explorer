import { describe, expect, it, vi } from 'vitest'
import {
  clearFolderListings,
  parseFolderListing,
  setFolderListing,
} from '../data/folderListing'
import {
  loadZchunkStorePyramidOptions,
  zchunkStoreCandidateUrls,
  zchunkStoreToPyramidOptions,
} from './zchunkStore'

describe('Zarr chunk store TIFF adapter', () => {
  it('tries file, folder, then dataset-root chunk stores for morphology focus images', () => {
    expect(
      zchunkStoreCandidateUrls(
        'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
      ),
    ).toEqual([
      'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif.zchunkstore',
      'https://example.test/xenium/morphology_focus/.zchunkstore',
      'https://example.test/xenium/.zchunkstore',
    ])
  })

  it('prefers a per-file chunk store over the folder store for root morphology images', () => {
    expect(
      zchunkStoreCandidateUrls('https://example.test/xenium/morphology.ome.tif'),
    ).toEqual([
      'https://example.test/xenium/morphology.ome.tif.zchunkstore',
      'https://example.test/xenium/.zchunkstore',
    ])
  })

  it('only tries the per-file chunk store for other TIFFs', () => {
    expect(zchunkStoreCandidateUrls('https://example.test/images/slide.ome.tif')).toEqual(
      ['https://example.test/images/slide.ome.tif.zchunkstore'],
    )
  })

  it('also tries the folder chunk store for files of a multi-file OME-TIFF', () => {
    expect(
      zchunkStoreCandidateUrls(
        'https://example.test/atera/morphology_2d/ch0000_dapi.ome.tif',
        {
          multiFile: true,
        },
      ),
    ).toEqual([
      'https://example.test/atera/morphology_2d/ch0000_dapi.ome.tif.zchunkstore',
      'https://example.test/atera/morphology_2d/.zchunkstore',
    ])
  })

  it('fetches only the sidecar the manifest names', async () => {
    const fetcher = vi
      .fn<(input: RequestInfo | URL) => Promise<Response>>()
      .mockImplementation(async () => new Response(null, { status: 404 }))

    await expect(
      loadZchunkStorePyramidOptions(
        'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
        { fetcher, zchunkStoreUrl: 'https://sidecars.example.test/run-1.zchunkstore' },
      ),
    ).resolves.toBeNull()
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://sidecars.example.test/run-1.zchunkstore',
    ])
  })

  it('skips derived sidecars the dataset folder index page does not list', async () => {
    const fetcher = vi
      .fn<(input: RequestInfo | URL) => Promise<Response>>()
      .mockImplementation(async () => new Response(null, { status: 404 }))
    setFolderListing(
      'https://example.test/bia-run/',
      parseFolderListing(
        '<title>Index of /bia-run</title><a href="morphology.ome.tif">morphology.ome.tif</a>',
        'https://example.test/bia-run/',
      ),
    )

    try {
      await expect(
        loadZchunkStorePyramidOptions('https://example.test/bia-run/morphology.ome.tif', {
          fetcher,
        }),
      ).resolves.toBeNull()
      // The folder sidecar is a dotfile, which index pages usually hide.
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        'https://example.test/bia-run/.zchunkstore',
      ])
    } finally {
      clearFolderListings()
    }
  })

  it('requests a sidecar shared by several channel files once', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === 'https://example.test/run/morphology_2d/.zchunkstore'
        ? Response.json(twoChannelStore())
        : new Response(null, { status: 403 }),
    )

    const [first, second] = await Promise.all(
      ['ch0000_dapi.ome.tif', 'ch0001_18s.ome.tif'].map((fileName, channelIndex) =>
        loadZchunkStorePyramidOptions(
          `https://example.test/run/morphology_2d/${fileName}`,
          {
            fetcher,
            channelIndex,
            multiFile: true,
          },
        ),
      ),
    )

    expect(first?.chunkIndex.get('0/0/0')).toEqual({ offset: 10, length: 1 })
    expect(second?.chunkIndex.get('0/0/0')).toEqual({ offset: 20, length: 2 })
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith('/morphology_2d/.zchunkstore'),
      ),
    ).toHaveLength(1)
  })

  it('uses the first chunk store in order even when a later one answers first', async () => {
    let answerFileStore: (response: Response) => void = () => undefined
    const fetcher = vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith('.ome.tif.zchunkstore')
        ? new Promise<Response>((resolve) => {
            answerFileStore = resolve
          })
        : Promise.resolve(Response.json(twoChannelStore())),
    )
    const options = loadZchunkStorePyramidOptions(
      'https://example.test/run/morphology_2d/ch0000_dapi.ome.tif',
      { fetcher, multiFile: true },
    )

    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(2)
    answerFileStore(Response.json(twoChannelStore({ offset: 99 })))

    await expect(options).resolves.toMatchObject({
      chunkIndex: new Map([['0/0/0', { offset: 99, length: 1 }]]),
    })
  })

  it('retries a chunk store after a network error', async () => {
    const fetcher = vi
      .fn<(input: RequestInfo | URL) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(Response.json(twoChannelStore()))
    const url = 'https://example.test/images/slide.ome.tif'

    await expect(loadZchunkStorePyramidOptions(url, { fetcher })).resolves.toBeNull()
    await expect(loadZchunkStorePyramidOptions(url, { fetcher })).resolves.not.toBeNull()
  })

  it('stops waiting when its own request is aborted', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined))
    const controller = new AbortController()
    const options = loadZchunkStorePyramidOptions(
      'https://example.test/images/slow.ome.tif',
      {
        fetcher,
        signal: controller.signal,
      },
    )

    controller.abort()

    await expect(options).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('maps Zarr v3 chunk metadata to TIFF pyramid options', () => {
    const options = zchunkStoreToPyramidOptions({
      'zarr.json': {
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          multiscales: [{ datasets: [{ path: '0' }, { path: '1' }] }],
        },
      },
      '0/zarr.json': {
        zarr_format: 3,
        node_type: 'array',
        shape: [4, 200, 300],
        chunk_grid: { configuration: { chunk_shape: [1, 100, 100] } },
      },
      '1/zarr.json': {
        zarr_format: 3,
        node_type: 'array',
        shape: [4, 100, 150],
        chunk_grid: { configuration: { chunk_shape: [1, 100, 100] } },
      },
      '0/c/0/1/2': { offset: 10, size: 4 },
      '0/c/1/1/2': { offset: 20, size: 4 },
      '1/c/0/0/1': { offset: 30, size: 8 },
    })

    expect(options.chunkIndex.get('0/1/2')).toEqual({ offset: 10, length: 4 })
    expect(options.chunkIndex.has('0/1/1')).toBe(false)
    expect(options.chunkIndex.get('1/0/1')).toEqual({ offset: 30, length: 8 })
    expect(options.levelMeta.get(0)).toEqual({
      width: 300,
      height: 200,
      nCols: 3,
      nRows: 2,
    })
    expect(options.tileWidth).toBe(100)
    expect(options.tileHeight).toBe(100)
    expect(options.numLevels).toBe(2)
    expect(options.imageWidth).toBe(300)
    expect(options.imageHeight).toBe(200)
  })

  it('maps a requested Zarr v3 channel index to TIFF chunks', () => {
    const options = zchunkStoreToPyramidOptions(
      {
        'zarr.json': {
          zarr_format: 3,
          node_type: 'group',
          attributes: {
            multiscales: [{ datasets: [{ path: '0' }] }],
          },
        },
        '0/zarr.json': {
          zarr_format: 3,
          node_type: 'array',
          shape: [4, 200, 300],
          chunk_grid: { configuration: { chunk_shape: [1, 100, 100] } },
        },
        '0/c/0/1/2': { offset: 10, size: 4 },
        '0/c/2/1/2': { offset: 20, size: 8 },
      },
      2,
    )

    expect(options.chunkIndex.get('0/1/2')).toEqual({ offset: 20, length: 8 })
  })

  it('also maps Observable-style Zarr v2 chunk-store keys', () => {
    const options = zchunkStoreToPyramidOptions({
      '.zattrs': {
        multiscales: [{ datasets: [{ path: '0' }] }],
      },
      '0/.zarray': {
        shape: [4, 120, 240],
        chunks: [1, 60, 80],
      },
      '0/0.1.2': { offset: 96, size: 32 },
    })

    expect(options.chunkIndex.get('0/1/2')).toEqual({ offset: 96, length: 32 })
    expect(options.levelMeta.get(0)).toEqual({
      width: 240,
      height: 120,
      nCols: 3,
      nRows: 2,
    })
    expect(options.tileWidth).toBe(80)
    expect(options.tileHeight).toBe(60)
  })
})

function twoChannelStore({ offset = 10 } = {}): unknown {
  return {
    'zarr.json': {
      zarr_format: 3,
      node_type: 'group',
      attributes: { multiscales: [{ datasets: [{ path: '0' }] }] },
    },
    '0/zarr.json': {
      zarr_format: 3,
      node_type: 'array',
      shape: [2, 100, 100],
      chunk_grid: { configuration: { chunk_shape: [1, 100, 100] } },
    },
    '0/c/0/0/0': { offset, size: 1 },
    '0/c/1/0/0': { offset: 20, size: 2 },
  }
}
