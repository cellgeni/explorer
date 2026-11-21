import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import { DatasetCache, dropDatasets, retainDataset } from './datasetCache'
import { XeniumDataset } from './xeniumDataset'
import type { DuckDbClientLike } from './xeniumDataset'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { XeniumDuckDbConnection } from './xeniumDatasetRows'

const BBOX = {
  minX: micrometers(0),
  maxX: micrometers(10),
  minY: micrometers(0),
  maxY: micrometers(10),
}

describe('dataset cache', () => {
  it('keeps the datasets in use and the last few others, disposing older ones', async () => {
    const cache = new DatasetCache<FakeDataset>(2)
    const datasets = new Map<string, FakeDataset>()
    const open = (url: string) =>
      cache.get(url, url, async () => {
        const dataset = new FakeDataset()
        datasets.set(url, dataset)
        return dataset
      })
    const shown = 'https://example.test/cache-a/shown'
    const release = retainDataset(shown)

    await open(shown)
    for (const name of ['b', 'c', 'd', 'e']) {
      await open(`https://example.test/cache-a/${name}`)
    }
    await settle()

    expect(disposed(datasets)).toEqual([
      'https://example.test/cache-a/b',
      'https://example.test/cache-a/c',
    ])

    release()
    await settle()

    // The dataset shown until now is kept over the older of the others.
    expect(disposed(datasets)).toEqual([
      'https://example.test/cache-a/b',
      'https://example.test/cache-a/c',
      'https://example.test/cache-a/d',
    ])
    expect(await open(shown)).toBe(datasets.get(shown))
  })

  it('opens a disposed dataset again when it is asked for', async () => {
    const cache = new DatasetCache<FakeDataset>(0)
    const create = vi.fn(async () => new FakeDataset())
    const url = 'https://example.test/cache-b/a'

    const first = await cache.get(url, url, create)
    await settle()
    const second = await cache.get(url, url, create)

    expect(first.disposals).toBe(1)
    expect(second).not.toBe(first)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('keeps a URL retained twice until both release it', async () => {
    const cache = new DatasetCache<FakeDataset>(0)
    const url = 'https://example.test/cache-c/a/'
    const first = retainDataset(url)
    const second = retainDataset(url)
    const dataset = await cache.get(url, url, async () => new FakeDataset())

    first()
    first()
    await settle()
    expect(dataset.disposals).toBe(0)

    second()
    await settle()
    expect(dataset.disposals).toBe(1)
  })

  it('disposes an instance dropped while retained once its URL is released', async () => {
    const cache = new DatasetCache<FakeDataset>(2)
    const url = 'https://example.test/cache-d/a'
    const release = retainDataset(url)
    const dataset = await cache.get(
      `${url}\nselection=1`,
      url,
      async () => new FakeDataset(),
    )

    cache.delete((key) => key.startsWith(`${url}\n`))
    await settle()
    expect(dataset.disposals).toBe(0)

    release()
    await settle()
    expect(dataset.disposals).toBe(1)
  })

  it("drops a URL's datasets from every cache, keeping other URLs", async () => {
    const viewerCache = new DatasetCache<FakeDataset>(2)
    const sideCache = new DatasetCache<FakeDataset>(2)
    const url = 'https://example.test/cache-f/a'
    const other = 'https://example.test/cache-f/b'
    const open = (cache: DatasetCache<FakeDataset>, key: string, baseUrl: string) =>
      cache.get(key, baseUrl, async () => new FakeDataset())
    const viewerDataset = await open(viewerCache, `${url}\nselection=1`, url)
    const sideDataset = await open(sideCache, url, url)
    const kept = await open(viewerCache, other, other)

    dropDatasets(`${url}/`)
    await settle()

    expect(viewerDataset.disposals).toBe(1)
    expect(sideDataset.disposals).toBe(1)
    expect(kept.disposals).toBe(0)
    await expect(open(viewerCache, other, other)).resolves.toBe(kept)
    await expect(open(sideCache, url, url)).resolves.not.toBe(sideDataset)
  })

  it('does not keep a dataset that failed to open', async () => {
    const cache = new DatasetCache<FakeDataset>(2)
    const url = 'https://example.test/cache-e/a'
    const create = vi
      .fn<() => Promise<FakeDataset>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new FakeDataset())

    await expect(cache.get(url, url, create)).rejects.toThrow('offline')
    await expect(cache.get(url, url, create)).resolves.toBeInstanceOf(FakeDataset)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('ends the DuckDB workers of the Xenium datasets switched away from', async () => {
    const cache = new DatasetCache<XeniumDataset>(1)
    const workers = new Map<string, { terminated: boolean }>()
    const datasets = new Map<string, XeniumDataset>()
    const open = (url: string) =>
      cache.get(url, url, async () => {
        const dataset = new XeniumDataset({
          baseUrl: url,
          createDuckDbClient: async () => {
            const worker = { terminated: false }
            workers.set(url, worker)
            return {
              conn: emptyConnection(),
              loadSpatial: async () => {},
              close: async () => {
                worker.terminated = true
              },
            } satisfies DuckDbClientLike
          },
          fetcher: async () => new Response(JSON.stringify({})),
          openTiff: async () => ({}) as TiffPyramidLoader,
        })
        datasets.set(url, dataset)
        return dataset
      })
    const urls = ['a', 'b', 'c', 'd'].map(
      (name) => `https://example.test/cache-f/${name}`,
    )
    const [, , third = '', fourth = ''] = urls
    let release = () => {}

    // As the viewer does: the dataset shown is retained, and queried.
    for (const url of urls) {
      const retain = retainDataset(url)
      release()
      release = retain
      await (await open(url)).cells(BBOX)
    }
    await settle()

    expect(
      [...workers].filter(([, worker]) => worker.terminated).map(([url]) => url),
    ).toEqual(urls.slice(0, 2))

    // Closing the last one keeps it, as the one used last.
    release()
    await settle()
    expect(workers.get(third)?.terminated).toBe(true)
    expect(workers.get(fourth)?.terminated).toBe(false)
    expect(await open(fourth)).toBe(datasets.get(fourth))
  })
})

class FakeDataset {
  disposals = 0

  dispose(): void {
    this.disposals += 1
  }
}

function disposed(datasets: ReadonlyMap<string, FakeDataset>): string[] {
  return [...datasets].filter(([, dataset]) => dataset.disposals > 0).map(([url]) => url)
}

// Disposal waits for the dataset's promise.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function emptyConnection(): XeniumDuckDbConnection {
  return {
    async prepare() {
      return {
        async query() {
          return { toArray: () => [] }
        },
        async close() {},
      }
    },
    async query() {
      return { toArray: () => [] }
    },
  } as unknown as XeniumDuckDbConnection
}
