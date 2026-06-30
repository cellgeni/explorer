import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import { AnnDataH5adDataset } from './h5adDataset'

describe('AnnDataH5adDataset', () => {
  it('loads H5AD points, obs annotations, metadata tracks, and dense expression', async () => {
    const bytes = await createTinyH5ad('dense')
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      fetcher: h5adFetcher(bytes),
    })

    await expect(dataset.meta()).resolves.toMatchObject({
      platform: 'h5ad',
      extent: {
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(0),
        maxY: micrometers(10),
      },
      capabilities: {
        transcripts: false,
        cellBoundaries: false,
        pyramidImage: false,
        multiChannel: false,
      },
    })

    const overview = await dataset.overview()

    expect(overview).toHaveLength(4)
    expect(overview[0]).toMatchObject({
      cellId: 'cell-a',
      position: { x: micrometers(0), y: micrometers(0) },
      metadata: {
        cluster: 'A',
        score: 0.10000000149011612,
      },
    })

    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1', 'Gapdh'])

    await expect(dataset.embeddings()).resolves.toMatchObject([
      {
        kind: 'X_pca',
        label: 'PCA',
        sourcePath: '/obsm/X_pca',
        points: [
          { id: 'cell-a', x: 1, y: 0 },
          { id: 'cell-b', x: 0, y: 1 },
          { id: 'cell-c', x: -1, y: 0 },
          { id: 'cell-d', x: 0, y: -1 },
        ],
      },
      {
        kind: 'X_spatial',
        label: 'Spatial',
        sourcePath: '/obsm/X_spatial',
      },
    ])

    await expect(dataset.annotations()).resolves.toEqual([
      {
        id: 'analysis:cluster:a',
        label: 'cluster: A',
        cellIds: ['cell-a', 'cell-c'],
      },
      {
        id: 'analysis:cluster:b',
        label: 'cluster: B',
        cellIds: ['cell-b', 'cell-d'],
      },
    ])

    await expect(dataset.metadataTracks()).resolves.toMatchObject([
      {
        id: 'h5ad:score',
        label: 'score',
        min: 0.10000000149011612,
        max: 0.8999999761581421,
      },
    ])

    const matrix = await dataset.matrix(['cell-b'])
    expect(matrix.cells.get('cell-b')).toEqual({
      geneNames: ['Actb', 'Gad1'],
      counts: [2, 3],
    })

    const expression = await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(5),
        minY: micrometers(0),
        maxY: micrometers(5),
      },
      ['Actb', 'Gad1'],
    )

    expect(expression).toMatchObject({
      genes: ['Actb', 'Gad1'],
      maxCount: 1,
      elements: [
        {
          id: 'cell-a',
          position: { x: micrometers(0), y: micrometers(0) },
          count: 1,
        },
      ],
    })
  })

  it('reads CSR sparse expression matrices', async () => {
    const bytes = await createTinyH5ad('csr')
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/sparse.h5ad',
      fetcher: h5adFetcher(bytes),
    })

    const matrix = await dataset.matrix(['cell-c'])

    expect(matrix.cells.get('cell-c')).toEqual({
      geneNames: ['Gad1', 'Gapdh'],
      counts: [4, 6],
    })

    const expression = await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(20),
        minY: micrometers(0),
        maxY: micrometers(20),
      },
      ['Gapdh'],
    )

    expect(expression.elements.map((element) => [element.id, element.count])).toEqual([
      ['cell-a', 5],
      ['cell-b', 0],
      ['cell-c', 6],
      ['cell-d', 8],
    ])
  })

  it('uses embedding coordinates and dataframe category sidecars', async () => {
    const bytes = await createTinyH5ad('dense', {
      categoricalEncoding: 'dataframe-categories',
      coordinateKey: 'X_umap',
    })
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/embedding.h5ad',
      fetcher: h5adFetcher(bytes),
    })

    await expect(dataset.overview()).resolves.toContainEqual(
      expect.objectContaining({
        cellId: 'cell-b',
        position: { x: micrometers(10), y: micrometers(0) },
        metadata: {
          cluster: 'B',
          score: 0.5,
        },
      }),
    )

    await expect(dataset.annotations()).resolves.toEqual([
      {
        id: 'analysis:cluster:a',
        label: 'cluster: A',
        cellIds: ['cell-a', 'cell-c'],
      },
      {
        id: 'analysis:cluster:b',
        label: 'cluster: B',
        cellIds: ['cell-b', 'cell-d'],
      },
    ])

    await expect(dataset.embeddings()).resolves.toMatchObject([
      {
        kind: 'X_umap',
        label: 'UMAP',
        sourcePath: '/obsm/X_umap',
      },
      {
        kind: 'X_pca',
        label: 'PCA',
        sourcePath: '/obsm/X_pca',
      },
    ])
  })

  it('rejects H5AD files over 300 MB before reading the body', async () => {
    const readBody = vi.fn(() => {
      throw new Error('body should not be read')
    })
    const byteLength = 350 * 1024 * 1024
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(byteLength) }),
      get body() {
        return readBody()
      },
      arrayBuffer: vi.fn(),
    } as unknown as Response
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/oversized.h5ad',
      fetcher: (async () => response) as typeof fetch,
    })

    await expect(dataset.meta()).rejects.toMatchObject({
      name: 'H5adFileSizeLimitExceededError',
      byteLength,
      maxBytes: 300 * 1024 * 1024,
      message:
        'H5AD file is 350.0 MB, exceeding the browser load limit of 300.0 MB.',
    })
    expect(readBody).not.toHaveBeenCalled()
  })
})

type MatrixKind = 'dense' | 'csr'
type CategoricalEncoding = 'group' | 'dataframe-categories'

interface TinyH5adOptions {
  readonly categoricalEncoding?: CategoricalEncoding
  readonly coordinateKey?: string
}

async function createTinyH5ad(
  matrixKind: MatrixKind,
  options: TinyH5adOptions = {},
): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/vitest-${matrixKind}.h5ad`
  const categoricalEncoding = options.categoricalEncoding ?? 'group'
  const coordinateKey = options.coordinateKey ?? 'X_spatial'

  try {
    FS.unlink(fileName)
  } catch {
    // No previous fixture file exists for the first run.
  }

  const file = new h5wasm.File(fileName, 'w')
  const obs = file.create_group('obs')
  obs.create_attribute('_index', 'cell_id')
  obs.create_attribute('column-order', ['cluster', 'score'])
  obs.create_dataset({ name: 'cell_id', data: ['cell-a', 'cell-b', 'cell-c', 'cell-d'] })
  obs.create_dataset({
    name: 'score',
    data: new Float32Array([0.1, 0.5, 0.9, 0.2]),
  })
  if (categoricalEncoding === 'group') {
    const cluster = obs.create_group('cluster')
    cluster.create_attribute('encoding-type', 'categorical')
    cluster.create_dataset({ name: 'categories', data: ['A', 'B'] })
    cluster.create_dataset({ name: 'codes', data: new Int8Array([0, 1, 0, 1]) })
  } else {
    obs.create_dataset({ name: 'cluster', data: new Int8Array([0, 1, 0, 1]) })
    const categories = obs.create_group('__categories')
    categories.create_dataset({ name: 'cluster', data: ['A', 'B'] })
  }

  const varGroup = file.create_group('var')
  varGroup.create_attribute('_index', 'gene_ids')
  varGroup.create_dataset({ name: 'gene_ids', data: ['Actb', 'Gad1', 'Gapdh'] })

  const obsm = file.create_group('obsm')
  obsm.create_dataset({
    name: coordinateKey,
    data: new Float32Array([0, 0, 10, 0, 0, 10, 10, 10]),
    shape: [4, 2],
  })
  obsm.create_dataset({
    name: 'X_pca',
    data: new Float32Array([1, 0, 9, 0, 1, 8, -1, 0, 7, 0, -1, 6]),
    shape: [4, 3],
  })

  if (matrixKind === 'dense') {
    file.create_dataset({
      name: 'X',
      data: new Float32Array([1, 0, 5, 2, 3, 0, 0, 4, 6, 7, 0, 8]),
      shape: [4, 3],
    })
  } else {
    const x = file.create_group('X')
    x.create_attribute('encoding-type', 'csr_matrix')
    x.create_attribute('shape', new Int32Array([4, 3]))
    x.create_dataset({ name: 'data', data: new Float32Array([1, 5, 2, 3, 4, 6, 7, 8]) })
    x.create_dataset({ name: 'indices', data: new Int32Array([0, 2, 0, 1, 1, 2, 0, 2]) })
    x.create_dataset({ name: 'indptr', data: new Int32Array([0, 2, 4, 6, 8]) })
  }

  file.close()

  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)

  return bytes
}

function h5adFetcher(bytes: Uint8Array): typeof fetch {
  return (async () => new Response(bytes.slice(), { status: 200 })) as typeof fetch
}
