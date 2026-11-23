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
  const annotationCalls: { url: string; groupId?: string }[] = []
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
      annotations: async (options: { readonly groupId?: string }) => {
        annotationCalls.push({
          url,
          ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
        })
        return [{ id: 'analysis:type:a', label: 'type: A', cellIds: ['c0'] }]
      },
    })) as unknown as CollectionPreviewLoaders['getSpatialDataset'],
    loadDatasetOverview: vi.fn(),
    loadGeneExpression: vi.fn(),
    loadAnnotations: vi.fn(),
  }

  return {
    loaders,
    overviewCalls,
    annotationCalls,
    expressions,
    finishOverview(url: string) {
      overviews.get(url)?.resolve([
        {
          cellId: 'c0',
          position: { x: micrometers(0), y: micrometers(0) },
          transcriptCount: 0,
        },
        {
          cellId: 'c1',
          position: { x: micrometers(4), y: micrometers(2) },
          transcriptCount: 0,
        },
      ])
    },
    // One cell per count.
    finishExpression(url: string, count: number | readonly number[]) {
      const counts = typeof count === 'number' ? [count] : count
      const call = expressions.find((entry) => entry.url === url)
      call?.done.resolve({
        genes: call.genes,
        maxCount: Math.max(...counts),
        elements: counts.map((cellCount, index) => ({
          id: `c${index}`,
          position: { x: micrometers(index), y: micrometers(0) },
          count: cellCount,
        })),
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

  it('keeps a dataset retained while its preview reads it', async () => {
    const fake = fakeDatasets()
    const retained = new Map<string, number>()
    const retainDataset = vi.fn((url: string) => {
      retained.set(url, (retained.get(url) ?? 0) + 1)
      return () => retained.set(url, (retained.get(url) ?? 0) - 1)
    })
    store = new CollectionPreviewStore(URLS, { ...fake.loaders, retainDataset })
    store.start()
    store.setVisible(A, true)
    await flush()

    expect(fake.overviewCalls).toEqual([A])
    expect(retained.get(A)).toBe(1)

    fake.finishOverview(A)
    await flush()

    expect(store.entry(A).cells).not.toBeNull()
    expect(retained.get(A)).toBe(0)
  })

  it('reads the sections shown side by side first, in view or not', async () => {
    const fake = fakeDatasets()
    store = new CollectionPreviewStore(URLS, fake.loaders, { concurrency: 1 })
    // A URL outside the collection is ignored.
    store.setLinked([C, 'https://example.test/other.zarr'])
    store.setVisible(A, true)
    store.start()
    await flush()
    expect(fake.overviewCalls).toEqual([C])

    fake.finishOverview(C)
    await flush()
    expect(fake.overviewCalls).toEqual([C, A])
    expect(store.entry(C).cells?.positions.length).toBe(4)

    // No longer side by side and not in view: not read again for new genes.
    fake.finishOverview(A)
    await flush()
    store.setLinked([])
    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum', annotationGroupId: null })
    await flush()
    expect(fake.expressions.map((call) => call.url)).toEqual([A])
  })

  it('reads the genes for each preview', async () => {
    const fake = fakeDatasets()
    store = new CollectionPreviewStore(URLS.slice(0, 2), fake.loaders)
    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum', annotationGroupId: null })
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
    fake.finishExpression(B, [...Array.from({ length: 199 }, () => 2), 50])
    await flush()

    expect(store.entry(A).scores?.maxScore).toBe(3)
    expect(store.entry(B).scores?.maxScore).toBe(50)
  })

  it('reads new genes without reading the cells again', async () => {
    const fake = fakeDatasets()
    store = new CollectionPreviewStore([A], fake.loaders)
    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum', annotationGroupId: null })
    store.start()
    store.setVisible(A, true)
    await flush()
    fake.finishOverview(A)
    await flush()

    const first = fake.expressions[0]
    store.setRequest({ genes: ['Gfap'], scoreMode: 'sum', annotationGroupId: null })
    expect(first?.signal?.aborted).toBe(true)
    // The old read ends before the next starts.
    fake.finishExpression(A, 5)
    await flush()

    expect(fake.expressions.map((call) => call.genes)).toEqual([['Aqp4'], ['Gfap']])
    expect(store.entry(A).scores).toBe(null)
    expect(fake.overviewCalls).toEqual([A])

    fake.expressions.splice(0, 1)
    fake.finishExpression(A, 2)
    await flush()
    expect(store.entry(A).scores?.maxScore).toBe(2)
  })

  it('reads the classes of an annotation set in place of the genes', async () => {
    const fake = fakeDatasets()
    store = new CollectionPreviewStore([A], fake.loaders)
    store.setRequest({
      genes: ['Aqp4'],
      scoreMode: 'sum',
      annotationGroupId: 'analysis:type',
    })
    store.start()
    store.setVisible(A, true)
    await flush()
    fake.finishOverview(A)
    await flush()
    await flush()

    expect(fake.expressions).toEqual([])
    expect(fake.annotationCalls).toEqual([{ url: A, groupId: 'analysis:type' }])
    expect(store.entry(A).classes?.classes).toEqual([
      { id: 'analysis:type:a', label: 'type: A', cellCount: 1 },
    ])
    expect([...(store.entry(A).classes?.classOf ?? [])]).toEqual([0, -1])

    // Back to genes: the classes go, and the scores are read.
    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum', annotationGroupId: null })
    await flush()
    expect(store.entry(A).classes).toBe(null)
    expect(fake.expressions.map((call) => call.genes)).toEqual([['Aqp4']])
  })

  // A class the open dataset lacks took the next palette colour in each
  // section's own order, without the colour its dataset stores (EXP-223).
  it('gives each class one colour in every preview, its stored one first', async () => {
    const fake = fakeDatasets()
    const classesByUrl: Record<string, readonly unknown[]> = {
      [A]: [
        { id: 'type:T', label: 'T', cellIds: ['c0'] },
        { id: 'type:B', label: 'B', cellIds: ['c1'] },
      ],
      [B]: [
        { id: 'type:Tumour', label: 'Tumour', color: '#d62728', cellIds: ['c0'] },
        { id: 'type:Immune', label: 'Immune', cellIds: ['c1'] },
      ],
      [C]: [
        { id: 'type:Stroma', label: 'Stroma', cellIds: ['c0'] },
        { id: 'type:Immune', label: 'Immune', cellIds: ['c1'] },
      ],
    }
    const getSpatialDataset = vi.fn(async (url: string) => ({
      ...(await fake.loaders.getSpatialDataset(url)),
      annotations: async () => classesByUrl[url],
    })) as unknown as CollectionPreviewLoaders['getSpatialDataset']
    store = new CollectionPreviewStore(URLS, { ...fake.loaders, getSpatialDataset })
    store.setRequest({ genes: [], scoreMode: 'sum', annotationGroupId: 'type' })
    store.start()
    for (const url of URLS) store.setVisible(url, true)
    await flush()
    for (const url of URLS) fake.finishOverview(url)
    await flush()
    await flush()

    expect(store.entry(B).classes?.classes[0]).toEqual({
      id: 'type:Tumour',
      label: 'Tumour',
      color: '#d62728',
      cellCount: 1,
    })
    // The open dataset (A) coloured its own classes.
    const main = { 'type:T': '#111111', 'type:B': '#222222' }
    const colors = store.classColors(main)
    expect(colors).toMatchObject({ ...main, 'type:Tumour': '#d62728' })
    const immune = colors['type:Immune']
    const stroma = colors['type:Stroma']
    expect(immune).toBeDefined()
    expect(stroma).toBeDefined()
    expect(new Set(Object.values(colors)).size).toBe(5)
    expect(store.classColors(main)).toBe(colors)
  })

  it('keeps the cells when the genes change during their read', async () => {
    const fake = fakeDatasets()
    store = new CollectionPreviewStore([A], fake.loaders)
    store.start()
    store.setVisible(A, true)
    await flush()

    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum', annotationGroupId: null })
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

    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum', annotationGroupId: null })
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

    store.setRequest({ genes: ['Aqp4'], scoreMode: 'sum', annotationGroupId: null })
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
