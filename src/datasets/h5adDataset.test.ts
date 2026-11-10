import type { Group as H5wasmGroup } from 'h5wasm'
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

    await expect(dataset.metadataTracks()).resolves.toEqual([
      {
        id: 'h5ad:score',
        label: 'score',
        values: null,
        cellCount: 4,
        min: 0.10000000149011612,
        max: 0.8999999761581421,
      },
    ])
    const scoreValues = await dataset.metadataTrackValues('h5ad:score')
    expect(scoreValues.map(({ cellId }) => cellId)).toEqual([
      'cell-a',
      'cell-b',
      'cell-c',
      'cell-d',
    ])
    expect(scoreValues[2]?.value).toBeCloseTo(0.9)
    await expect(dataset.metadataTrackValues('h5ad:missing')).rejects.toThrow(
      'H5AD metadata track h5ad:missing does not exist.',
    )

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

    const sampled = await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(20),
        minY: micrometers(0),
        maxY: micrometers(20),
      },
      ['Gad1'],
      { sampleStride: 2 },
    )

    // Every expressing cell (b, c) and every second cell without (a, not d).
    expect(sampled.elements.map((element) => [element.id, element.count])).toEqual([
      ['cell-a', 0],
      ['cell-b', 3],
      ['cell-c', 4],
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

  it.each<CategoricalEncoding>(['group', 'dataframe-categories'])(
    'lists genes by a categorical feature_name (%s) and keeps the index as an alias',
    async (categoricalEncoding) => {
      const bytes = await createTinyH5ad('dense', {
        categoricalEncoding,
        featureNames: TINY_FEATURE_NAMES,
      })
      const dataset = new AnnDataH5adDataset({
        url: 'https://example.test/cellxgene.h5ad',
        fetcher: h5adFetcher(bytes),
      })

      await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1', 'Gapdh'])
      await expect(dataset.geneAliases()).resolves.toEqual(
        new Map([
          ['Actb', 'ENSMUSG00000029580'],
          ['Gad1', 'ENSMUSG00000070880'],
          ['Gapdh', 'ENSMUSG00000057666'],
        ]),
      )

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
    },
  )

  it('applies the gene-name rules to categorical codes', async () => {
    // A missing code is an empty name, and a shared category is a duplicate.
    const partial = new AnnDataH5adDataset({
      url: 'https://example.test/partial.h5ad',
      fetcher: h5adFetcher(
        await createTinyH5ad('dense', {
          featureNames: { categories: ['Actb'], codes: [0, -1, 0] },
        }),
      ),
    })

    await expect(partial.genePanel()).resolves.toEqual(['Actb', 'var-1', 'Actb-2'])
    await expect(partial.geneAliases()).resolves.toEqual(
      new Map([
        ['Actb', 'ENSMUSG00000029580'],
        ['var-1', 'ENSMUSG00000070880'],
        ['Actb-2', 'ENSMUSG00000057666'],
      ]),
    )

    // With every code missing the column is skipped and the index is kept.
    const empty = new AnnDataH5adDataset({
      url: 'https://example.test/empty.h5ad',
      fetcher: h5adFetcher(
        await createTinyH5ad('dense', {
          featureNames: { categories: ['Actb'], codes: [-1, -1, -1] },
        }),
      ),
    })

    await expect(empty.genePanel()).resolves.toEqual(TINY_GENE_IDS)
    await expect(empty.geneAliases()).resolves.toEqual(new Map())
  })

  it('keeps the var index as gene names without an alias', async () => {
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/index.h5ad',
      fetcher: h5adFetcher(await createTinyH5ad('dense')),
    })

    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1', 'Gapdh'])
    await expect(dataset.geneAliases()).resolves.toEqual(new Map())
  })

  it.each<[string, () => Promise<typeof fetch>]>([
    [
      'in memory',
      async () => h5adFetcher(await createTinyH5ad('csr', { nullableStrings: true })),
    ],
    [
      'kerchunk reference',
      async () => {
        const chunks = new RemoteH5adReferenceChunks()
        const referenceSpec = createTinyH5adReferenceSpec(
          (value) => chunks.ref(value),
          'csr',
          { nullableStrings: true },
        )
        return h5adRemoteReferenceFetcher(
          350 * 1024 * 1024,
          referenceSpec,
          chunks.bytes(),
          () => {
            throw new Error('body should not be read')
          },
        )
      },
    ],
  ])(
    'reads anndata 0.13 nullable indexes and obs columns (%s)',
    async (_backend, createFetcher) => {
      const dataset = new AnnDataH5adDataset({
        url: 'https://example.test/nullable.h5ad',
        fetcher: await createFetcher(),
      })

      // Masked index entries fall back to obs-N and var-N.
      await expect(dataset.cellIds()).resolves.toEqual([
        'cell-a',
        'obs-1',
        'cell-c',
        'cell-d',
      ])
      await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'var-1', 'Gapdh'])

      const overview = await dataset.overview()
      expect(overview.map(({ cellId, metadata }) => ({ cellId, metadata }))).toEqual([
        {
          cellId: 'cell-a',
          metadata: {
            cluster: 'A',
            batch: 'b1',
            score: Math.fround(0.1),
            count: 3,
            flag: 1,
          },
        },
        {
          cellId: 'obs-1',
          metadata: { cluster: 'B', batch: 'b2', score: 0.5, flag: 0 },
        },
        {
          cellId: 'cell-c',
          metadata: { cluster: 'A', score: Math.fround(0.9), count: 5, flag: 1 },
        },
        {
          cellId: 'cell-d',
          metadata: { cluster: 'B', batch: 'b1', score: Math.fround(0.2), count: 7 },
        },
      ])

      await expect(dataset.annotationGroups()).resolves.toEqual([
        {
          id: 'analysis:cluster',
          label: 'cluster',
          groupingName: 'cluster',
          groupCount: 2,
        },
        { id: 'analysis:batch', label: 'batch', groupingName: 'batch', groupCount: 2 },
      ])
      await expect(dataset.metadataTracks()).resolves.toMatchObject([
        { id: 'h5ad:score' },
        { id: 'h5ad:count', cellCount: 4, min: 3, max: 7 },
        { id: 'h5ad:flag', cellCount: 4, min: 0, max: 1 },
      ])
      const countValues = await dataset.metadataTrackValues('h5ad:count')
      expect(countValues.map(({ value }) => value)).toEqual([3, Number.NaN, 5, 7])

      const matrix = await dataset.matrix(['obs-1'])
      expect(matrix.cells.get('obs-1')).toEqual({
        geneNames: ['Actb', 'var-1'],
        counts: [2, 3],
      })
    },
  )

  it('reads a categorical feature_name through a kerchunk reference', async () => {
    const chunks = new RemoteH5adReferenceChunks()
    const referenceSpec = createTinyH5adReferenceSpec(
      (value) => chunks.ref(value),
      'csr',
      { featureNames: TINY_FEATURE_NAMES },
    )
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/reference-cellxgene.h5ad',
      fetcher: h5adRemoteReferenceFetcher(
        350 * 1024 * 1024,
        referenceSpec,
        chunks.bytes(),
        () => {
          throw new Error('body should not be read')
        },
      ),
    })

    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1', 'Gapdh'])
    await expect(dataset.geneAliases()).resolves.toEqual(
      new Map([
        ['Actb', 'ENSMUSG00000029580'],
        ['Gad1', 'ENSMUSG00000070880'],
        ['Gapdh', 'ENSMUSG00000057666'],
      ]),
    )

    const matrix = await dataset.matrix(['cell-c'])
    expect(matrix.cells.get('cell-c')).toEqual({
      geneNames: ['Gad1', 'Gapdh'],
      counts: [4, 6],
    })
  })

  it('reads reference keys with spaces in their names', async () => {
    const chunks = new RemoteH5adReferenceChunks()
    const spec = createTinyH5adReferenceSpec((value) => chunks.ref(value))
    const refs = spec.refs as Record<string, unknown>
    refs['obs/.zattrs'] = jsonRef({
      _index: 'cell_id',
      'column-order': ['cluster', 'score', 'Cancer Epithelial'],
    })
    refs['obs/Cancer Epithelial/.zarray'] = zarrArrayRef([4], [4], '<f4')
    refs['obs/Cancer Epithelial/0'] = chunks.ref(new Float32Array([0, 0.25, 0.5, 1]))
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/reference-spaces.h5ad',
      fetcher: h5adRemoteReferenceFetcher(350 * 1024 * 1024, spec, chunks.bytes(), () => {
        throw new Error('body should not be read')
      }),
    })

    await expect(dataset.overview()).resolves.toContainEqual(
      expect.objectContaining({
        cellId: 'cell-b',
        metadata: { cluster: 'B', score: 0.5, 'Cancer Epithelial': 0.25 },
      }),
    )
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

  it('blocks all-gene selected-cell profiles from reference-backed CSC matrices', async () => {
    const readBody = vi.fn(() => {
      throw new Error('body should not be read')
    })
    const byteLength = 350 * 1024 * 1024
    const chunks = new RemoteH5adReferenceChunks()
    const referenceSpec = createTinyH5adReferenceSpec((value) => chunks.ref(value), 'csc')
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/reference-csc.h5ad',
      fetcher: h5adRemoteReferenceFetcher(
        byteLength,
        referenceSpec,
        chunks.bytes(),
        readBody,
      ),
    })

    await expect(dataset.matrix(['cell-b'])).rejects.toMatchObject({
      name: 'H5adAllGeneCscMatrixUnsupportedError',
      rowCount: 4,
      geneCount: 3,
    })

    const selectedGeneExpression = await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(20),
        minY: micrometers(0),
        maxY: micrometers(20),
      },
      ['Actb'],
    )

    expect(
      selectedGeneExpression.elements.map((element) => [element.id, element.count]),
    ).toEqual([
      ['cell-a', 1],
      ['cell-b', 2],
      ['cell-c', 0],
      ['cell-d', 7],
    ])
    expect(readBody).not.toHaveBeenCalled()
  })

  it('reads selected genes of dense reference-backed matrices by column', async () => {
    const chunks = new RemoteH5adReferenceChunks()
    const referenceSpec = createTinyH5adReferenceSpec(
      (value) => chunks.ref(value),
      'dense',
    )
    const fetcher = h5adRemoteReferenceFetcher(
      350 * 1024 * 1024,
      referenceSpec,
      chunks.bytes(),
      () => {
        throw new Error('body should not be read')
      },
    )
    const rangeRequests: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/reference-dense.h5ad',
      fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        const range = request.headers.get('Range')

        if (range !== null) {
          rangeRequests.push(range)
        }

        return fetcher(request)
      }) as typeof fetch,
    })

    await expect(dataset.matrix(['cell-b'])).resolves.toMatchObject({
      cells: new Map([['cell-b', { geneNames: ['Actb', 'Gad1'], counts: [2, 3] }]]),
    })
    rangeRequests.length = 0

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
    // One read per row chunk, not one per cell.
    expect(rangeRequests).toHaveLength(2)
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

type MatrixKind = 'dense' | 'csr' | 'csc'
type CategoricalEncoding = 'group' | 'dataframe-categories'

interface TinyH5adOptions {
  readonly categoricalEncoding?: CategoricalEncoding
  readonly coordinateKey?: string
  // Writes the var index as Ensembl IDs and gene symbols as a categorical
  // `feature_name`, the CELLxGENE layout.
  readonly featureNames?: CategoricalFeatureNames
  // Writes the obs and var indexes and extra obs columns as nullable arrays,
  // the anndata 0.13 layout under pandas 3.
  readonly nullableStrings?: boolean
}

interface CategoricalFeatureNames {
  readonly categories: readonly string[]
  readonly codes: readonly number[]
}

interface NullableArrayFixture {
  readonly encoding: 'nullable-string-array' | 'nullable-integer' | 'nullable-boolean'
  readonly values: readonly string[] | BigInt64Array | Uint8Array
  readonly mask: readonly number[]
}

// One masked entry per array; masked slots hold values the reader must ignore.
const NULLABLE_OBS_INDEX: NullableArrayFixture = {
  encoding: 'nullable-string-array',
  values: ['cell-a', 'cell-b', 'cell-c', 'cell-d'],
  mask: [0, 1, 0, 0],
}
const NULLABLE_OBS_COLUMNS: Readonly<Record<string, NullableArrayFixture>> = {
  batch: {
    encoding: 'nullable-string-array',
    values: ['b1', 'b2', 'zz', 'b1'],
    mask: [0, 0, 1, 0],
  },
  count: {
    encoding: 'nullable-integer',
    values: new BigInt64Array([3n, 9n, 5n, 7n]),
    mask: [0, 1, 0, 0],
  },
  flag: {
    encoding: 'nullable-boolean',
    values: new Uint8Array([1, 0, 1, 1]),
    mask: [0, 0, 0, 1],
  },
}
const NULLABLE_VAR_INDEX: NullableArrayFixture = {
  encoding: 'nullable-string-array',
  values: ['Actb', 'Gad1', 'Gapdh'],
  mask: [0, 1, 0],
}

const TINY_GENE_IDS = ['ENSMUSG00000029580', 'ENSMUSG00000070880', 'ENSMUSG00000057666']
// Unsorted, so the fixture's codes are not the identity.
const TINY_FEATURE_NAMES: CategoricalFeatureNames = {
  categories: ['Gapdh', 'Actb', 'Gad1'],
  codes: [1, 2, 0],
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

  if (options.nullableStrings === true) {
    obs.create_attribute('_index', '_index')
    obs.create_attribute('column-order', [
      'cluster',
      'score',
      ...Object.keys(NULLABLE_OBS_COLUMNS),
    ])
    writeNullableArray(obs, '_index', NULLABLE_OBS_INDEX)

    for (const [key, column] of Object.entries(NULLABLE_OBS_COLUMNS)) {
      writeNullableArray(obs, key, column)
    }
  } else {
    obs.create_attribute('_index', 'cell_id')
    obs.create_attribute('column-order', ['cluster', 'score'])
    obs.create_dataset({
      name: 'cell_id',
      data: ['cell-a', 'cell-b', 'cell-c', 'cell-d'],
    })
  }

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

  if (options.nullableStrings === true) {
    varGroup.create_attribute('_index', '_index')
    writeNullableArray(varGroup, '_index', NULLABLE_VAR_INDEX)
  } else if (options.featureNames === undefined) {
    varGroup.create_attribute('_index', 'gene_ids')
    varGroup.create_dataset({ name: 'gene_ids', data: ['Actb', 'Gad1', 'Gapdh'] })
  } else {
    varGroup.create_attribute('_index', '_index')
    varGroup.create_attribute('column-order', ['feature_name'])
    varGroup.create_dataset({ name: '_index', data: [...TINY_GENE_IDS] })
    const codes = new Int16Array(options.featureNames.codes)
    const categories = [...options.featureNames.categories]

    if (categoricalEncoding === 'group') {
      const featureName = varGroup.create_group('feature_name')
      featureName.create_attribute('encoding-type', 'categorical')
      featureName.create_attribute('encoding-version', '0.2.0')
      featureName.create_dataset({ name: 'categories', data: categories })
      featureName.create_dataset({ name: 'codes', data: codes })
    } else {
      varGroup.create_dataset({ name: 'feature_name', data: codes })
      const varCategories = varGroup.create_group('__categories')
      varCategories.create_dataset({ name: 'feature_name', data: categories })
    }
  }

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
    x.create_attribute(
      'encoding-type',
      matrixKind === 'csc' ? 'csc_matrix' : 'csr_matrix',
    )
    x.create_attribute('shape', new Int32Array([4, 3]))
    const sparse = tinySparseMatrixFixture(matrixKind)
    x.create_dataset({ name: 'data', data: sparse.data })
    x.create_dataset({ name: 'indices', data: sparse.indices })
    x.create_dataset({ name: 'indptr', data: sparse.indptr })
  }

  file.close()

  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)

  return bytes
}

function writeNullableArray(
  parent: H5wasmGroup,
  name: string,
  array: NullableArrayFixture,
): void {
  const group = parent.create_group(name)

  for (const [key, value] of Object.entries(nullableArrayAttrs(array))) {
    group.create_attribute(key, value)
  }

  group.create_dataset({
    name: 'values',
    data:
      array.values instanceof BigInt64Array || array.values instanceof Uint8Array
        ? array.values
        : [...array.values],
  })
  group.create_dataset({ name: 'mask', data: new Uint8Array(array.mask) })
}

function nullableArrayAttrs(array: NullableArrayFixture): Record<string, string> {
  return {
    'encoding-type': array.encoding,
    'encoding-version': '0.1.0',
    ...(array.encoding === 'nullable-string-array' ? { 'na-value': 'NaN' } : {}),
  }
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
  matrixKind: MatrixKind = 'csr',
  options: Pick<TinyH5adOptions, 'featureNames' | 'nullableStrings'> = {},
): Record<string, unknown> {
  const { featureNames } = options

  return {
    version: 1,
    refs: {
      '.zgroup': jsonRef({ zarr_format: 2 }),
      'obs/.zgroup': jsonRef({ zarr_format: 2 }),
      ...(options.nullableStrings === true
        ? tinyNullableObsRefs(chunkRef)
        : {
            'obs/.zattrs': jsonRef({
              _index: 'cell_id',
              'column-order': ['cluster', 'score'],
            }),
            'obs/cell_id/.zarray': zarrArrayRef([4], [4], '|S6'),
            'obs/cell_id/0': chunkRef(
              fixedStringBytes(['cell-a', 'cell-b', 'cell-c', 'cell-d'], 6),
            ),
          }),
      'obs/cluster/.zarray': zarrArrayRef([4], [4], '|i1'),
      'obs/cluster/0': chunkRef(new Int8Array([0, 1, 0, 1])),
      'obs/score/.zarray': zarrArrayRef([4], [4], '<f4'),
      'obs/score/0': chunkRef(new Float32Array([0.1, 0.5, 0.9, 0.2])),
      'obs/__categories/.zgroup': jsonRef({ zarr_format: 2 }),
      'obs/__categories/cluster/.zarray': zarrArrayRef([2], [2], '|S1'),
      'obs/__categories/cluster/0': chunkRef(fixedStringBytes(['A', 'B'], 1)),
      'var/.zgroup': jsonRef({ zarr_format: 2 }),
      ...(options.nullableStrings === true
        ? {
            'var/.zattrs': jsonRef({ _index: '_index' }),
            ...nullableArrayRefs('var/_index', NULLABLE_VAR_INDEX, chunkRef),
          }
        : featureNames === undefined
          ? {
              'var/.zattrs': jsonRef({ _index: 'gene_ids' }),
              'var/gene_ids/.zarray': zarrArrayRef([3], [3], '|S5'),
              'var/gene_ids/0': chunkRef(fixedStringBytes(['Actb', 'Gad1', 'Gapdh'], 5)),
            }
          : tinyCategoricalVarRefs(chunkRef, featureNames)),
      'obsm/.zgroup': jsonRef({ zarr_format: 2 }),
      'obsm/X_umap/.zarray': zarrArrayRef([4, 2], [4, 2], '<f4'),
      'obsm/X_umap/0.0': chunkRef(new Float32Array([0, 0, 10, 0, 0, 10, 10, 10])),
      ...(matrixKind === 'dense'
        ? tinyDenseMatrixRefs(chunkRef)
        : tinySparseMatrixRefs(chunkRef, matrixKind)),
    },
  }
}

function tinyNullableObsRefs(chunkRef: ChunkRefFactory): Record<string, unknown> {
  return {
    'obs/.zattrs': jsonRef({
      _index: '_index',
      'column-order': ['cluster', 'score', ...Object.keys(NULLABLE_OBS_COLUMNS)],
    }),
    ...nullableArrayRefs('obs/_index', NULLABLE_OBS_INDEX, chunkRef),
    ...Object.fromEntries(
      Object.entries(NULLABLE_OBS_COLUMNS).flatMap(([key, column]) =>
        Object.entries(nullableArrayRefs(`obs/${key}`, column, chunkRef)),
      ),
    ),
  }
}

// A nullable array as kerchunk translates it: a group with `values` and a
// `|b1` mask.
function nullableArrayRefs(
  path: string,
  array: NullableArrayFixture,
  chunkRef: ChunkRefFactory,
): Record<string, unknown> {
  const length = array.mask.length
  const { values } = array
  const [dtype, valueBytes] =
    values instanceof BigInt64Array
      ? ['<i8', values]
      : values instanceof Uint8Array
        ? ['|b1', values]
        : ['|S8', fixedStringBytes(values, 8)]

  return {
    [`${path}/.zgroup`]: jsonRef({ zarr_format: 2 }),
    [`${path}/.zattrs`]: jsonRef(nullableArrayAttrs(array)),
    [`${path}/values/.zarray`]: zarrArrayRef([length], [length], dtype),
    [`${path}/values/0`]: chunkRef(valueBytes),
    [`${path}/mask/.zarray`]: zarrArrayRef([length], [length], '|b1'),
    [`${path}/mask/0`]: chunkRef(new Uint8Array(array.mask)),
  }
}

function tinyCategoricalVarRefs(
  chunkRef: ChunkRefFactory,
  featureNames: CategoricalFeatureNames,
): Record<string, unknown> {
  const categoryCount = featureNames.categories.length

  return {
    'var/.zattrs': jsonRef({ _index: '_index', 'column-order': ['feature_name'] }),
    'var/_index/.zarray': zarrArrayRef([3], [3], '|S18'),
    'var/_index/0': chunkRef(fixedStringBytes(TINY_GENE_IDS, 18)),
    'var/feature_name/.zgroup': jsonRef({ zarr_format: 2 }),
    'var/feature_name/.zattrs': jsonRef({
      'encoding-type': 'categorical',
      'encoding-version': '0.2.0',
      ordered: false,
    }),
    'var/feature_name/codes/.zarray': zarrArrayRef([3], [3], '<i2'),
    'var/feature_name/codes/0': chunkRef(new Int16Array(featureNames.codes)),
    'var/feature_name/categories/.zarray': zarrArrayRef(
      [categoryCount],
      [categoryCount],
      '|S5',
    ),
    'var/feature_name/categories/0': chunkRef(
      fixedStringBytes(featureNames.categories, 5),
    ),
  }
}

// Two row chunks of the 4 x 3 matrix.
function tinyDenseMatrixRefs(chunkRef: ChunkRefFactory): Record<string, unknown> {
  return {
    'X/.zarray': zarrArrayRef([4, 3], [2, 3], '<f4'),
    'X/0.0': chunkRef(new Float32Array([1, 0, 5, 2, 3, 0])),
    'X/1.0': chunkRef(new Float32Array([0, 4, 6, 7, 0, 8])),
  }
}

function tinySparseMatrixRefs(
  chunkRef: ChunkRefFactory,
  matrixKind: Extract<MatrixKind, 'csr' | 'csc'>,
): Record<string, unknown> {
  const sparse = tinySparseMatrixFixture(matrixKind)

  return {
    'X/.zgroup': jsonRef({ zarr_format: 2 }),
    'X/.zattrs': jsonRef({
      'encoding-type': matrixKind === 'csc' ? 'csc_matrix' : 'csr_matrix',
      shape: [4, 3],
    }),
    'X/data/.zarray': zarrArrayRef([8], [8], '<f4'),
    'X/data/0': chunkRef(sparse.data),
    'X/indices/.zarray': zarrArrayRef([8], [8], '<i4'),
    'X/indices/0': chunkRef(sparse.indices),
    'X/indptr/.zarray': zarrArrayRef(
      [sparse.indptr.length],
      [sparse.indptr.length],
      '<i4',
    ),
    'X/indptr/0': chunkRef(sparse.indptr),
  }
}

function tinySparseMatrixFixture(matrixKind: Extract<MatrixKind, 'csr' | 'csc'>): {
  readonly data: Float32Array
  readonly indices: Int32Array
  readonly indptr: Int32Array
} {
  if (matrixKind === 'csc') {
    return {
      data: new Float32Array([1, 2, 7, 3, 4, 5, 6, 8]),
      indices: new Int32Array([0, 1, 3, 1, 2, 0, 2, 3]),
      indptr: new Int32Array([0, 3, 5, 8]),
    }
  }

  return {
    data: new Float32Array([1, 5, 2, 3, 4, 6, 7, 8]),
    indices: new Int32Array([0, 2, 0, 1, 1, 2, 0, 2]),
    indptr: new Int32Array([0, 2, 4, 6, 8]),
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
