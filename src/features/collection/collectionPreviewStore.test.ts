import { afterEach, describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type { CollectionPreviewLoaders } from './collectionPreviewData'
import { CollectionPreviewStore } from './collectionPreviewStore'

const URLS = [
  'https://example.test/a.zarr',
  'https://example.test/b.zarr',
  'https://example.test/c.zarr',
]
const [A, B, C] = URLS as [string, string, string]

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// An AnnData-like dataset per URL whose reads wait until the test lets them
// finish.
function fakeDatasets() {
  const overviews = new Map<string, Deferred<unknown>>()
  const expressions: {
    url: string
    genes: readonly string[]
    signal?: AbortSignal
    done: Deferred<unknown>
  }[] = []
  const overviewCalls: string[] = []
  const loaders: CollectionPreviewLoaders = {
    detectSpatialDataset: vi.fn(async (baseUrl: string) => ({
      platform: 'h5ad' as const,
      baseUrl,
      h5adUrl: baseUrl,
      source: 'zarr' as const,
      checked: [],
    })),
    getSpatialDataset: vi.fn(async (url: string) => ({
      overview: () => {
        overviewCalls.push(url)
        const done = deferred<unknown>()
        overviews.set(url, done)
        return done.promise
      },
      geneExpression: (
        _bbox: unknown,
        genes: readonly string[],
        options: { readonly signal?: AbortSignal },
      ) => {
        const done = deferred<unknown>()
        expressions.push({
          url,
          genes,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          done,
        })
        return done.promise
      },
    })) as unknown as CollectionPreviewLoaders['getSpatialDataset'],
    loadDatasetOverview: vi.fn(),
    loadGeneExpression: vi.fn(),
  }

  return {
    loaders,
    overviewCalls,
    expressions,
    finishOverview(url: string) {
      overviews.get(url)?.resolve([
        { position: { x: micrometers(0), y: micrometers(0) }, transcriptCount: 0 },
        { position: { x: micrometers(4), y: micrometers(2) }, transcriptCount: 0 },
      ])
    },
    finishExpression(url: string, count: number) {
      const call = expressions.find((entry) => entry.url === url)
      call?.done.resolve({
        genes: call.genes,
        maxCount: count,
        elements: [
          { id: 'a', position: { x: micrometers(0), y: micrometers(0) }, count },
        ],
      })
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let store: CollectionPreviewStore | null = null

afterEach(() => {
  store?.stop()
  store = null
})

describe('CollectionPreviewStore', () => {
  it('reads only previews in view, a few at a time, and not while paused', async () => {
    const fake = fakeDatasets()
    store = new CollectionPreviewStore(URLS, fake.loaders, { concurrency: 2 })
    store.setPaused(true)
    store.start()
    for (const url of URLS) store.setVisible(url, true)
    await flush()
    expect(fake.overviewCalls).toEqual([])

    store.setPaused(false)
    await flush()
    expect(fake.overviewCalls).toEqual([A, B])
    expect(store.entry(A).loading).toBe(true)

    fake.finishOverview(A)
    await flush()
    expect(store.entry(A)).toMatchObject({ loading: false, scores: null })
    expect(store.entry(A).cells?.bounds).toEqual({ minX: 0, maxX: 4, minY: 0, maxY: 2 })
    expect(fake.overviewCalls).toEqual([A, B, C])
  })

  it('reads the genes for each preview and shares one scale', async () => {
    const fake = fakeDatasets()
    store = new CollectionPreviewStore(URLS.slice(0, 2), fake.loaders)
    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum' })
    store.start()
    store.setVisible(A, true)
    store.setVisible(B, true)
    await flush()
    fake.finishOverview(A)
    fake.finishOverview(B)
    await flush()

    expect(fake.expressions.map((call) => [call.url, call.genes])).toEqual([
      [A, ['Aqp4']],
      [B, ['Aqp4']],
    ])
    fake.finishExpression(A, 3)
    fake.finishExpression(B, 8)
    await flush()

    expect(store.entry(A).scores?.maxScore).toBe(3)
    expect(store.scaleMax()).toBe(8)
  })

  it('reads new genes without reading the cells again', async () => {
    const fake = fakeDatasets()
    store = new CollectionPreviewStore([A], fake.loaders)
    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum' })
    store.start()
    store.setVisible(A, true)
    await flush()
    fake.finishOverview(A)
    await flush()

    const first = fake.expressions[0]
    store.setRequest({ genes: ['Gfap'], scoreMode: 'sum' })
    expect(first?.signal?.aborted).toBe(true)
    // The old read ends before the next starts.
    fake.finishExpression(A, 5)
    await flush()

    expect(fake.expressions.map((call) => call.genes)).toEqual([['Aqp4'], ['Gfap']])
    expect(store.entry(A).scores).toBe(null)
    expect(store.scaleMax()).toBe(0)
    expect(fake.overviewCalls).toEqual([A])

    fake.expressions.splice(0, 1)
    fake.finishExpression(A, 2)
    await flush()
    expect(store.entry(A).scores?.maxScore).toBe(2)
  })

  it('keeps the cells when the genes change during their read', async () => {
    const fake = fakeDatasets()
    store = new CollectionPreviewStore([A], fake.loaders)
    store.start()
    store.setVisible(A, true)
    await flush()

    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum' })
    fake.finishOverview(A)
    await flush()

    expect(store.entry(A).cells).not.toBe(null)
    expect(fake.overviewCalls).toEqual([A])
    expect(fake.expressions.map((call) => call.genes)).toEqual([['Aqp4']])
  })

  it('says why a dataset has no preview, without trying again', async () => {
    const loaders: CollectionPreviewLoaders = {
      ...fakeDatasets().loaders,
      detectSpatialDataset: vi.fn(async (baseUrl: string) => ({
        platform: 'image' as const,
        baseUrl,
        imageUrl: baseUrl,
        checked: [],
      })),
    }
    store = new CollectionPreviewStore([A], loaders)
    store.start()
    store.setVisible(A, true)
    await flush()

    expect(store.entry(A)).toMatchObject({
      unavailable: 'No cells to preview',
      loading: false,
    })

    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum' })
    await flush()
    expect(loaders.detectSpatialDataset).toHaveBeenCalledTimes(1)
  })

  it('reports a failed read, and tries again for other genes', async () => {
    const fake = fakeDatasets()
    const getSpatialDataset = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockImplementation(fake.loaders.getSpatialDataset)
    store = new CollectionPreviewStore([A], { ...fake.loaders, getSpatialDataset })
    store.start()
    store.setVisible(A, true)
    await flush()

    expect(store.entry(A).error).toBe('HTTP 500')

    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum' })
    await flush()
    expect(store.entry(A).error).toBe(null)
    expect(fake.overviewCalls).toEqual([A])
  })

  it('stops reading when stopped, and goes on after a start', async () => {
    const fake = fakeDatasets()
    store = new CollectionPreviewStore([A], fake.loaders)
    store.start()
    store.setVisible(A, true)
    await flush()

    store.stop()
    fake.finishOverview(A)
    await flush()
    expect(store.entry(A)).toMatchObject({ cells: null, loading: false, error: null })

    store.start()
    await flush()
    fake.finishOverview(A)
    await flush()
    expect(store.entry(A).cells).not.toBe(null)
  })
})
