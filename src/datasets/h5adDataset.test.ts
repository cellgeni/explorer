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

    await expect(dataset.annotationGroups()).resolves.toEqual([
      {
        id: 'analysis:cluster',
        label: 'cluster',
        groupingName: 'cluster',
        groupCount: 2,
      },
    ])

    await expect(dataset.embeddingOptions()).resolves.toEqual([
      {
        kind: 'X_pca',
        label: 'PCA',
        sourcePath: '/obsm/X_pca',
      },
      {
        kind: 'X_spatial',
        label: 'Spatial',
        sourcePath: '/obsm/X_spatial',
      },
    ])

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

    await expect(dataset.embeddings({ kind: 'X_pca' })).resolves.toMatchObject([
      {
        kind: 'X_pca',
        label: 'PCA',
        sourcePath: '/obsm/X_pca',
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

    await expect(dataset.annotations({ groupId: 'analysis:cluster' })).resolves.toEqual([
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

  it('loads oversized H5AD files through a companion kerchunk reference', async () => {
    const readBody = vi.fn(() => {
      throw new Error('body should not be read')
    })
    const byteLength = 350 * 1024 * 1024
    const chunks = new RemoteH5adReferenceChunks()
    const referenceSpec = createTinyH5adReferenceSpec((value) => chunks.ref(value))
    const progress: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/reference.h5ad',
      fetcher: h5adRemoteReferenceFetcher(
        byteLength,
        referenceSpec,
        chunks.bytes(),
        readBody,
      ),
      onProgress: (message) => {
        progress.push(message)
      },
    })

    await expect(dataset.meta()).resolves.toMatchObject({
      platform: 'h5ad',
      extent: {
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(0),
        maxY: micrometers(10),
      },
    })
    expect(readBody).not.toHaveBeenCalled()

    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1', 'Gapdh'])
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

    const matrix = await dataset.matrix(['cell-c'])
    expect(matrix.cells.get('cell-c')).toEqual({
      geneNames: ['Gad1', 'Gapdh'],
      counts: [4, 6],
    })
    expect(progress).toEqual([
      'H5AD size check started',
      'H5AD file is 350.0 MB, above the 300.0 MB browser limit',
      'Looking for H5AD reference https://example.test/reference.h5ad.json',
      'Loading H5AD reference https://example.test/reference.h5ad.json',
      'H5AD reference loaded; opening referenced arrays',
      'H5AD reference ready: 4 cells, 3 genes',
    ])
  })

  it('warns when oversized H5AD files do not have a companion reference', async () => {
    const readBody = vi.fn(() => {
      throw new Error('body should not be read')
    })
    const byteLength = 350 * 1024 * 1024
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/oversized.h5ad',
      fetcher: h5adReferenceFetcher(byteLength, null, readBody),
    })

    await expect(dataset.meta()).rejects.toMatchObject({
      name: 'H5adReferenceFileUnavailableError',
      byteLength,
      maxBytes: 300 * 1024 * 1024,
      message:
        'H5AD file is 350.0 MB, exceeding the browser load limit of 300.0 MB, and no readable kerchunk reference file was found at https://example.test/oversized.h5ad.json.',
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

function h5adReferenceFetcher(
  byteLength: number,
  referenceSpec: Record<string, unknown> | null,
  readBody: () => unknown,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)

    if (url.pathname.endsWith('.h5ad.json')) {
      return referenceSpec === null
        ? new Response(null, { status: 404 })
        : Response.json(referenceSpec)
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(byteLength) },
      })
    }

    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(byteLength) }),
      get body() {
        return readBody()
      },
      arrayBuffer: vi.fn(),
    } as unknown as Response
  }) as typeof fetch
}

function h5adRemoteReferenceFetcher(
  byteLength: number,
  referenceSpec: Record<string, unknown>,
  remoteBytes: Uint8Array,
  readBody: () => unknown,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)

    if (url.hostname === 's3.amazonaws.com') {
      throw new TypeError('unexpected AWS S3 reference fetch')
    }

    if (url.pathname.endsWith('.h5ad.json')) {
      return Response.json(referenceSpec)
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(byteLength) },
      })
    }

    const range = request.headers.get('Range')

    if (range !== null) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)

      if (match === null) {
        return new Response(null, { status: 416 })
      }

      const start = Number(match[1])
      const end = Number(match[2])
      return new Response(remoteBytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${remoteBytes.byteLength}`,
          'Content-Length': String(end - start + 1),
        },
      })
    }

    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(byteLength) }),
      get body() {
        return readBody()
      },
      arrayBuffer: vi.fn(),
    } as unknown as Response
  }) as typeof fetch
}

type ChunkRefFactory = (value: ArrayBufferView) => string | [string, number, number]

function createTinyH5adReferenceSpec(
  chunkRef: ChunkRefFactory = bytesRef,
): Record<string, unknown> {
  return {
    version: 1,
    refs: {
      '.zgroup': jsonRef({ zarr_format: 2 }),
      'obs/.zgroup': jsonRef({ zarr_format: 2 }),
      'obs/.zattrs': jsonRef({
        _index: 'cell_id',
        'column-order': ['cluster', 'score'],
      }),
      'obs/cell_id/.zarray': zarrArrayRef([4], [4], '|S6'),
      'obs/cell_id/0': chunkRef(
        fixedStringBytes(['cell-a', 'cell-b', 'cell-c', 'cell-d'], 6),
      ),
      'obs/cluster/.zarray': zarrArrayRef([4], [4], '|i1'),
      'obs/cluster/0': chunkRef(new Int8Array([0, 1, 0, 1])),
      'obs/score/.zarray': zarrArrayRef([4], [4], '<f4'),
      'obs/score/0': chunkRef(new Float32Array([0.1, 0.5, 0.9, 0.2])),
      'obs/__categories/.zgroup': jsonRef({ zarr_format: 2 }),
      'obs/__categories/cluster/.zarray': zarrArrayRef([2], [2], '|S1'),
      'obs/__categories/cluster/0': chunkRef(fixedStringBytes(['A', 'B'], 1)),
      'var/.zgroup': jsonRef({ zarr_format: 2 }),
      'var/.zattrs': jsonRef({ _index: 'gene_ids' }),
      'var/gene_ids/.zarray': zarrArrayRef([3], [3], '|S5'),
      'var/gene_ids/0': chunkRef(fixedStringBytes(['Actb', 'Gad1', 'Gapdh'], 5)),
      'obsm/.zgroup': jsonRef({ zarr_format: 2 }),
      'obsm/X_umap/.zarray': zarrArrayRef([4, 2], [4, 2], '<f4'),
      'obsm/X_umap/0.0': chunkRef(new Float32Array([0, 0, 10, 0, 0, 10, 10, 10])),
      'X/.zgroup': jsonRef({ zarr_format: 2 }),
      'X/.zattrs': jsonRef({
        'encoding-type': 'csr_matrix',
        shape: [4, 3],
      }),
      'X/data/.zarray': zarrArrayRef([8], [8], '<f4'),
      'X/data/0': chunkRef(new Float32Array([1, 5, 2, 3, 4, 6, 7, 8])),
      'X/indices/.zarray': zarrArrayRef([8], [8], '<i4'),
      'X/indices/0': chunkRef(new Int32Array([0, 2, 0, 1, 1, 2, 0, 2])),
      'X/indptr/.zarray': zarrArrayRef([5], [5], '<i4'),
      'X/indptr/0': chunkRef(new Int32Array([0, 2, 4, 6, 8])),
    },
  }
}

function zarrArrayRef(
  shape: readonly number[],
  chunks: readonly number[],
  dtype: string,
): string {
  return jsonRef({
    zarr_format: 2,
    shape,
    chunks,
    dtype,
    compressor: null,
    fill_value: null,
    order: 'C',
    filters: null,
  })
}

function jsonRef(value: unknown): string {
  return JSON.stringify(value)
}

class RemoteH5adReferenceChunks {
  private readonly sourceUrl = 's3://mp33/public/h5ad/reference.h5ad'
  private readonly chunks: Uint8Array[] = []
  private byteLength = 0

  ref(value: ArrayBufferView): [string, number, number] {
    const bytes = bytesFromArrayBufferView(value)
    const offset = this.byteLength
    this.chunks.push(bytes)
    this.byteLength += bytes.byteLength
    return [this.sourceUrl, offset, bytes.byteLength]
  }

  bytes(): Uint8Array {
    const bytes = new Uint8Array(this.byteLength)
    let offset = 0

    for (const chunk of this.chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    return bytes
  }
}

function bytesRef(value: ArrayBufferView): string {
  return `base64:${Buffer.from(bytesFromArrayBufferView(value)).toString('base64')}`
}

function bytesFromArrayBufferView(value: ArrayBufferView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function fixedStringBytes(values: readonly string[], width: number): Uint8Array {
  const encoder = new TextEncoder()
  const bytes = new Uint8Array(values.length * width)

  values.forEach((value, row) => {
    const encoded = encoder.encode(value)
    bytes.set(encoded.slice(0, width), row * width)
  })

  return bytes
}
