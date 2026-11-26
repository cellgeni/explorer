import type { Group as H5wasmGroup } from 'h5wasm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import type { GeneValuesRead } from '../data/geneValues'
import {
  ICECHUNK_FIXTURE_ORIGIN,
  icechunkFixtureFetcher,
  type IcechunkFixtureRequest,
} from '../test/icechunkFixtures'
import type { AnnDataMemoryTable } from './annDataMemory'
import { loadDatasetCollection } from './annDataSectionCollection'
import {
  AnnDataH5adDataset,
  type AnnDataH5adDatasetOptions,
  type AnnDataLabelsOpener,
  uniqueSlugIds,
} from './h5adDataset'
import type { ImagePyramidLoader } from '../data/imagePyramid'
import {
  ANNDATA_ZARR_FIXTURE_ORIGIN,
  annDataZarrFixtureFetcher,
} from '../test/annDataZarrFixtures'
import { withCellMetadata } from '../test/cellMetadataFixtures'
import { summarizeRoiGeneExpression } from '../data/roiGeneStats'
import { geneExpressionScores } from '../rendering/geneExpressionRenderer'
import { createInProcessH5Worker } from '../data/h5WorkerFile'

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

    const overview = withCellMetadata(await dataset.overview())

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
    // The z-score still counts cell-d: values 0, 3, 4 and 0 have mean 1.75 and
    // SD 1.79.
    expect(sampled.cellCount).toBe(4)
    expect(
      geneExpressionScores(
        sampled.elements,
        // Z-scores combine two or more genes; a second leaves them as they are.
        [...sampled.genes, 'Other'],
        'z-score',
        sampled.cellCount,
      )[2],
    ).toBeCloseTo(1.26, 2)
  })

  it.each(['csr', 'csc', 'dense'] as const)(
    'keeps negative values of a %s matrix in multi-gene and ROI reads',
    async (matrixKind) => {
      // Actb, Gad1 and Gapdh per cell, as a scaled matrix stores them.
      const dataset = new AnnDataH5adDataset({
        url: 'https://example.test/scaled.h5ad',
        fetcher: h5adFetcher(
          await createTinyH5ad(matrixKind, { x: [2, -1, 0, 0, 3, 1, 1, 0, 0, 0, 0, 4] }),
        ),
      })
      const cellIds = ['cell-a', 'cell-b']

      const stats = summarizeRoiGeneExpression(await dataset.matrix(cellIds), {
        cellCount: 2,
        sampledCellIds: cellIds,
      })
      // Gad1 stores -1 and 3; only cell-b detects it.
      expect(stats.genes.find(({ gene }) => gene === 'Gad1')).toMatchObject({
        count: 2,
        meanPerCell: 1,
        detectedCells: 1,
      })

      const expression = await dataset.geneExpression(
        {
          minX: micrometers(0),
          maxX: micrometers(20),
          minY: micrometers(0),
          maxY: micrometers(5),
        },
        ['Actb', 'Gad1'],
      )
      expect(expression.elements.map(({ id, count }) => [id, count])).toEqual([
        ['cell-a', 1],
        ['cell-b', 3],
      ])
      expect(geneExpressionScores(expression.elements, ['Actb', 'Gad1'], 'mean')).toEqual(
        [0.5, 1.5],
      )

      // Plots reads the same values.
      const [gad1] = await dataset.geneValues(['Gad1'])
      expect(gad1 !== undefined && 'values' in gad1 ? [...gad1.values] : gad1).toEqual(
        expect.arrayContaining([-1, 3]),
      )
    },
  )

  it.each(['csr', 'csc', 'dense'] as const)(
    'gives repeated %s names suffixes that no stored name has',
    async (matrixKind) => {
      // Cells c0, c0, c0-2, c3 and genes G, G, G-2: the second of each takes
      // -3, as -2 is stored.
      const dataset = new AnnDataH5adDataset({
        url: 'https://example.test/repeated.h5ad',
        fetcher: h5adFetcher(
          await createTinyH5ad(matrixKind, {
            obsNames: ['c0', 'c0', 'c0-2', 'c3'],
            featureNames: { categories: ['G', 'G-2'], codes: [0, 0, 1] },
            x: [1, 6, 10, 2, 7, 20, 3, 8, 30, 4, 9, 40],
          }),
        ),
      })

      await expect(dataset.cellIds()).resolves.toEqual(['c0', 'c0-3', 'c0-2', 'c3'])
      await expect(dataset.genePanel()).resolves.toEqual(['G', 'G-3', 'G-2'])

      // The map, Plots and a cell's profile read one column per name.
      const expression = await dataset.geneExpression(
        {
          minX: micrometers(-1),
          maxX: micrometers(20),
          minY: micrometers(-1),
          maxY: micrometers(20),
        },
        ['G-2'],
      )
      expect(expression.elements.map(({ id, count }) => [id, count])).toEqual([
        ['c0', 10],
        ['c0-3', 20],
        ['c0-2', 30],
        ['c3', 40],
      ])
      const [g2, g3] = await dataset.geneValues(['G-2', 'G-3'])
      expect(g2 !== undefined && 'values' in g2 ? [...g2.values] : g2).toEqual([
        10, 20, 30, 40,
      ])
      expect(g3 !== undefined && 'values' in g3 ? [...g3.values] : g3).toEqual([
        6, 7, 8, 9,
      ])
      const profile = (await dataset.matrix(['c0-3'])).cells.get('c0-3')
      expect(
        Object.fromEntries(
          profile?.geneNames.map((gene, index) => [gene, profile.counts[index]]) ?? [],
        ),
      ).toEqual({ G: 2, 'G-3': 7, 'G-2': 20 })
    },
  )

  it('uses embedding coordinates and dataframe category sidecars', async () => {
    const bytes = await createTinyH5ad('dense', {
      categoricalEncoding: 'dataframe-categories',
      coordinateKey: 'X_umap',
    })
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/embedding.h5ad',
      fetcher: h5adFetcher(bytes),
    })

    expect(withCellMetadata(await dataset.overview())).toContainEqual(
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

  it('places cells in 3D by a third column of obsm spatial', async () => {
    const open = async (options: TinyH5adOptions) =>
      (
        await new AnnDataH5adDataset({
          url: 'https://example.test/stack.h5ad',
          fetcher: h5adFetcher(await createTinyH5ad('dense', options)),
        }).overview()
      ).map((point) => [point.cellId, point.position.x, point.z])

    expect(
      await open({
        coordinateKey: 'spatial',
        coordinates: [0, 0, 0, 10, 0, 60, 0, 10, 120, 10, 10, 180],
      }),
    ).toEqual([
      ['cell-a', 0, 0],
      ['cell-b', 10, 60],
      ['cell-c', 0, 120],
      ['cell-d', 10, 180],
    ])
    // A column of zeros pads 2D coordinates; a third UMAP column is no depth.
    expect(
      await open({
        coordinateKey: 'spatial',
        coordinates: [0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0],
      }),
    ).toEqual([
      ['cell-a', 0, undefined],
      ['cell-b', 10, undefined],
      ['cell-c', 0, undefined],
      ['cell-d', 10, undefined],
    ])
    expect(
      (
        await open({
          coordinateKey: 'X_umap',
          coordinates: [0, 0, 0, 10, 0, 60, 0, 10, 120, 10, 10, 180],
        })
      ).map(([, , z]) => z),
    ).toEqual([undefined, undefined, undefined, undefined])
  })

  it('scales a third spatial column with image-pixel coordinates', async () => {
    const bytes = await createTinyH5ad('dense', {
      coordinates: [0, 0, 0, 10, 0, 40, 0, 10, 80, 10, 10, 120],
    })
    const loader = {
      url: 'https://example.test/section-raw.zarr',
      units: {
        dataUnit: 'micrometer',
        imageUnit: 'pixel',
        micrometersPerPixel: micrometers(0.25),
        origin: 'top-left',
        imageYAxis: 'down',
      },
      channels: [{ id: 'c0' }],
    } as unknown as ImagePyramidLoader
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      fetcher: h5adFetcher(bytes),
      image: { url: loader.url, coordinates: 'image-pixels' },
      openImage: vi.fn().mockResolvedValue(loader),
    })

    expect((await dataset.overview()).map((point) => point.z)).toEqual([0, 10, 20, 30])
  })

  it('lists only obsm matrices named as embeddings', async () => {
    const twoColumns = [0, 0, 1, 0, 0, 1, 1, 1]
    const bytes = await createTinyH5ad('dense', {
      extraObsm: {
        UMAP: twoColumns,
        // cell2location cell-type abundances and scvi-tools covariates.
        means_cell_abundance_w_sf: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        _scvi_extra_categorical_covs: twoColumns,
      },
    })
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/cell2location.h5ad',
      fetcher: h5adFetcher(bytes),
    })

    await expect(
      dataset.embeddingOptions().then((options) => options.map((option) => option.kind)),
    ).resolves.toEqual(['X_pca', 'X_spatial', 'UMAP'])
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

  it('shows an attached image and places pixel coordinates on it', async () => {
    const bytes = await createTinyH5ad('dense')
    const loader = {
      url: 'https://example.test/section-raw.zarr',
      units: {
        dataUnit: 'micrometer',
        imageUnit: 'pixel',
        micrometersPerPixel: micrometers(0.25),
        origin: 'top-left',
        imageYAxis: 'down',
      },
      channels: [{ id: 'c0' }, { id: 'c1' }],
    } as unknown as ImagePyramidLoader
    const openImage = vi.fn().mockResolvedValue(loader)
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      fetcher: h5adFetcher(bytes),
      image: { url: loader.url, coordinates: 'image-pixels' },
      openImage,
    })

    const overview = await dataset.overview()

    expect(overview.map((point) => point.position)).toContainEqual({
      x: micrometers(2.5),
      y: micrometers(0),
    })
    await expect(
      dataset.cells({
        minX: micrometers(2),
        minY: micrometers(-1),
        maxX: micrometers(3),
        maxY: micrometers(1),
      }),
    ).resolves.toEqual([
      { id: 'cell-b', position: { x: micrometers(2.5), y: micrometers(0) } },
    ])
    await expect(dataset.meta()).resolves.toMatchObject({
      platform: 'h5ad',
      units: { micrometersPerPixel: micrometers(0.25) },
      extent: { maxX: micrometers(2.5), maxY: micrometers(2.5) },
      capabilities: { pyramidImage: true, multiChannel: true },
    })
    await expect(dataset.image()).resolves.toEqual({ kind: 'pyramid', loader })
    expect(openImage).toHaveBeenCalledTimes(1)
    expect(openImage).toHaveBeenCalledWith('https://example.test/section-raw.zarr')
  })

  it('counts only cells inside a lasso towards its limit', async () => {
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      fetcher: h5adFetcher(await createTinyH5ad('dense')),
    })
    // The 10 µm square's corners, less the corner at the origin: cell-a is
    // in the lasso's bounding box but outside the lasso.
    const point = (x: number, y: number) => ({ x: micrometers(x), y: micrometers(y) })
    const lasso = {
      kind: 'lasso' as const,
      bbox: {
        minX: micrometers(-2),
        minY: micrometers(-2),
        maxX: micrometers(13),
        maxY: micrometers(13),
      },
      points: [point(9, -2), point(13, -2), point(13, 13), point(-2, 13), point(-2, 9)],
    }
    const ids = (cells: readonly { readonly id: string }[]) => cells.map(({ id }) => id)

    expect(ids(await dataset.cells(lasso))).toEqual(['cell-b', 'cell-c', 'cell-d'])
    expect(ids(await dataset.cells(lasso, { limit: 2 }))).toEqual(['cell-b', 'cell-c'])
  })

  it('keeps micrometre coordinates, and coordinates whose image fails, as read', async () => {
    const bytes = await createTinyH5ad('dense')
    const loader = {
      url: 'https://example.test/he.ome.tif',
      units: { micrometersPerPixel: micrometers(0.25) },
      channels: [],
    } as unknown as ImagePyramidLoader
    const micrometreDataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      fetcher: h5adFetcher(bytes),
      image: { url: loader.url, coordinates: 'micrometers' },
      openImage: vi.fn().mockResolvedValue(loader),
    })
    const openImage = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 403'))
      .mockRejectedValueOnce(new Error('HTTP 403'))
      .mockResolvedValue(loader)
    const onProgress = vi.fn()
    const failingDataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      fetcher: h5adFetcher(bytes),
      onProgress,
      image: { url: loader.url, coordinates: 'image-pixels' },
      openImage,
    })

    expect((await micrometreDataset.meta()).extent.maxX).toBe(micrometers(10))
    expect((await failingDataset.meta()).extent.maxX).toBe(micrometers(10))
    expect(onProgress).toHaveBeenCalledWith(
      'Attached image could not be opened, so cell coordinates are read as micrometres',
    )
    // A failed open is tried again when the image is asked for.
    await expect(failingDataset.image()).resolves.toEqual({ kind: 'pyramid', loader })
  })

  it('outlines cells from attached labels named by obs names', async () => {
    // The label image is half the image's resolution: 80 x 80 pixels over a
    // 160 x 160 image at 0.25 µm per pixel, so a label pixel is 0.5 µm.
    const loader = {
      url: 'https://example.test/section-raw.zarr',
      imageWidth: 160,
      imageHeight: 160,
      units: { micrometersPerPixel: micrometers(0.25) },
      channels: [],
    } as unknown as ImagePyramidLoader
    const ring = (x: number) => new Float64Array([x, 0, x + 2, 0, x + 2, 2, x, 2])
    // The reader returns the same ring arrays while their chunks stay loaded.
    const traced = [
      { label: 1, ring: ring(0) },
      { label: 3, ring: ring(10) },
      // No cell is named 9.
      { label: 9, ring: ring(20) },
    ]
    const outlines = vi.fn(async () => traced)
    const openLabels = vi.fn(async () => ({
      levels: [{ width: 80, height: 80 }],
      outlines,
    })) as unknown as AnnDataLabelsOpener
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      fetcher: h5adFetcher(
        await createTinyH5ad('dense', { obsNames: ['1', '2', '3', 'cell-d'] }),
      ),
      image: {
        url: loader.url,
        coordinates: 'image-pixels',
        labelsUrl: 'https://example.test/section-label.zarr',
      },
      openImage: vi.fn().mockResolvedValue(loader),
      openLabels,
    })
    const bbox = {
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(10),
      maxY: micrometers(5),
    }

    expect((await dataset.meta()).capabilities.cellBoundaries).toBe(true)
    const { elements } = await dataset.elements(bbox)

    expect(elements.map((element) => element.id)).toEqual(['1', '3'])
    expect(elements[1]?.geometry).toEqual({
      kind: 'polygon',
      rings: [
        [
          { x: micrometers(5), y: micrometers(0) },
          { x: micrometers(6), y: micrometers(0) },
          { x: micrometers(6), y: micrometers(1) },
          { x: micrometers(5), y: micrometers(1) },
        ],
      ],
    })
    // The view is asked for in label pixels, for cells the table names.
    expect(outlines).toHaveBeenCalledWith(
      { minX: 0, minY: 0, maxX: 20, maxY: 10 },
      expect.objectContaining({ maxPixels: 16_000_000 }),
    )
    const include = (
      outlines.mock.calls[0] as unknown as [unknown, { include(label: number): boolean }]
    )[1].include
    expect([1, 2, 3, 4, 9].map(include)).toEqual([true, true, true, false, false])
    // The same rings give the same elements, and the store opens once.
    expect((await dataset.elements(bbox)).elements[0]).toBe(elements[0])
    expect(openLabels).toHaveBeenCalledTimes(1)
  })

  it('matches labels by a named column, the instance key, a label column, or obs names', async () => {
    const loader = {
      url: 'https://example.test/section-raw.zarr',
      imageWidth: 80,
      imageHeight: 80,
      units: { micrometersPerPixel: micrometers(1) },
      channels: [],
    } as unknown as ImagePyramidLoader
    const traced = [1, 2, 3, 4, 5].map((label) => ({
      label,
      ring: new Float64Array([label, 0, label + 1, 0, label + 1, 1]),
    }))
    const bbox = {
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(80),
      maxY: micrometers(80),
    }
    const outlinedCells = async (
      fixture: TinyH5adOptions,
      labelColumn?: string,
    ): Promise<readonly string[]> => {
      const dataset = new AnnDataH5adDataset({
        url: 'https://example.test/tiny.h5ad',
        fetcher: h5adFetcher(await createTinyH5ad('dense', fixture)),
        image: {
          url: loader.url,
          coordinates: 'micrometers',
          labelsUrl: 'https://example.test/section-label.zarr',
          ...(labelColumn === undefined ? {} : { labelColumn }),
        },
        openImage: vi.fn().mockResolvedValue(loader),
        openLabels: (async () => ({
          levels: [{ width: 80, height: 80 }],
          outlines: async (
            _bounds: unknown,
            { include }: { include(label: number): boolean },
          ) => traced.filter(({ label }) => include(label)),
        })) as unknown as AnnDataLabelsOpener,
      })
      const { elements } = await dataset.elements(bbox)
      return elements.map((element) => String(element.id))
    }
    // Obs names 0 to 3 are not the labels; the columns hold them.
    const obsNames = ['0', '1', '2', '3']
    const extraObs = {
      cell_labels: Int32Array.from([2, 3, 4, 5]),
      label_text: ['5', '4', 'none', '1'],
    }

    // Named columns: integers, or strings of whole numbers.
    expect(await outlinedCells({ obsNames, extraObs }, 'cell_labels')).toEqual([
      '0',
      '1',
      '2',
      '3',
    ])
    expect(await outlinedCells({ obsNames, extraObs }, 'label_text')).toEqual([
      '3',
      '1',
      '0',
    ])
    // The SpatialData instance key, without a named column.
    expect(
      await outlinedCells({
        obsNames,
        extraObs,
        spatialDataInstanceKey: 'cell_labels',
      }),
    ).toEqual(['0', '1', '2', '3'])
    // An instance key that holds no labels, such as a Xenium table's
    // barcodes, gives way to the column named like labels.
    expect(
      await outlinedCells({
        obsNames,
        extraObs: {
          cell_id: ['aaaamblj-1', 'aaaanhff-1', 'aaabjknp-1', 'aaablaep-1'],
          cell_labels: Int32Array.from([2, 3, 4, 5]),
        },
        spatialDataInstanceKey: 'cell_id',
        spatialDataInstanceKeyIn: 'attributes',
      }),
    ).toEqual(['0', '1', '2', '3'])
    // The instance key in the table's attributes, as spatialdata 0.2 and later
    // write it.
    expect(
      await outlinedCells({
        obsNames,
        extraObs: {
          cell_labels: Int32Array.from([2, 3, 4, 5]),
          id: ['4', '3', '2', '1'],
        },
        spatialDataInstanceKey: 'id',
        spatialDataInstanceKeyIn: 'attributes',
      }),
    ).toEqual(['3', '2', '1', '0'])
    // Otherwise the obs names: labels 1 to 3.
    expect(
      await outlinedCells({
        obsNames,
        extraObs: { area: Int32Array.from([1, 2, 3, 4]) },
      }),
    ).toEqual(['1', '2', '3'])
  })

  it('reports a named label column that gives no cells when boundaries load', async () => {
    const dataset = (labelColumn: string) =>
      createTinyH5ad('dense', { extraObs: { label_text: ['a', 'b', 'c', 'd'] } }).then(
        (bytes) =>
          new AnnDataH5adDataset({
            url: 'https://example.test/tiny.h5ad',
            fetcher: h5adFetcher(bytes),
            image: {
              url: 'https://example.test/section-raw.zarr',
              coordinates: 'micrometers',
              labelsUrl: 'https://example.test/section-label.zarr',
              labelColumn,
            },
            openImage: vi.fn(),
            openLabels: vi.fn() as unknown as AnnDataLabelsOpener,
          }),
      )
    const bbox = {
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(10),
      maxY: micrometers(10),
    }
    const missing = await dataset('cell_labels')
    const text = await dataset('label_text')

    // Boundaries are offered, so the error shows where they load.
    expect((await missing.meta()).capabilities.cellBoundaries).toBe(true)
    await expect(missing.elements(bbox)).rejects.toThrow(
      'The attached labels match no cells: obs has no column "cell_labels".',
    )
    await expect(text.elements(bbox)).rejects.toThrow(
      'obs column "label_text" holds no whole-number labels',
    )
  })

  it('has no boundaries without labels or label-numbered obs names', async () => {
    const openLabels = vi.fn() as unknown as AnnDataLabelsOpener
    const bbox = {
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(10),
      maxY: micrometers(10),
    }
    const named = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      fetcher: h5adFetcher(await createTinyH5ad('dense')),
      image: {
        url: 'https://example.test/section-raw.zarr',
        coordinates: 'micrometers',
        labelsUrl: 'https://example.test/section-label.zarr',
      },
      openImage: vi.fn().mockResolvedValue({ units: {}, channels: [] }),
      openLabels,
    })
    const unlabelled = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      fetcher: h5adFetcher(
        await createTinyH5ad('dense', { obsNames: ['1', '2', '3', '4'] }),
      ),
    })

    expect((await named.meta()).capabilities.cellBoundaries).toBe(false)
    await expect(named.elements(bbox)).resolves.toEqual({ elements: [] })
    expect(openLabels).not.toHaveBeenCalled()
    expect((await unlabelled.meta()).capabilities.cellBoundaries).toBe(false)
    await expect(unlabelled.elements(bbox)).resolves.toEqual({ elements: [] })
  })

  it('has no image without an attached one', async () => {
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      fetcher: h5adFetcher(await createTinyH5ad('dense')),
    })

    await expect(dataset.image()).resolves.toBeNull()
  })

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

  it('leaves rows without a label out of annotations and cell metadata', async () => {
    // A negative code marks a missing categorical label.
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/missing-labels.h5ad',
      fetcher: h5adFetcher(
        await createTinyH5ad('dense', { clusterCodes: [0, -1, 0, 1] }),
      ),
    })

    await expect(dataset.annotations()).resolves.toEqual([
      { id: 'analysis:cluster:a', label: 'cluster: A', cellIds: ['cell-a', 'cell-c'] },
      { id: 'analysis:cluster:b', label: 'cluster: B', cellIds: ['cell-d'] },
    ])
    const overview = withCellMetadata(await dataset.overview())
    expect(overview.find(({ cellId }) => cellId === 'cell-b')?.metadata).toEqual({
      score: 0.5,
    })
  })

  it('lists classes in category order, leaving out categories without cells', async () => {
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/order.h5ad',
      // B first by cell; no cell is A.
      fetcher: h5adFetcher(await createTinyH5ad('dense', { clusterCodes: [1, 1, 1, 1] })),
    })
    const reordered = new AnnDataH5adDataset({
      url: 'https://example.test/reordered.h5ad',
      fetcher: h5adFetcher(await createTinyH5ad('dense', { clusterCodes: [1, 0, 1, 0] })),
    })

    await expect(dataset.annotations()).resolves.toEqual([
      {
        id: 'analysis:cluster:b',
        label: 'cluster: B',
        cellIds: ['cell-a', 'cell-b', 'cell-c', 'cell-d'],
      },
    ])
    await expect(
      reordered.annotations().then((annotations) => annotations.map(({ id }) => id)),
    ).resolves.toEqual(['analysis:cluster:a', 'analysis:cluster:b'])
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

      const overview = withCellMetadata(await dataset.overview())
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
      // A masked string is a missing label.
      await expect(dataset.annotations({ groupId: 'analysis:batch' })).resolves.toEqual([
        { id: 'analysis:batch:b1', label: 'batch: b1', cellIds: ['cell-a', 'cell-d'] },
        { id: 'analysis:batch:b2', label: 'batch: b2', cellIds: ['obs-1'] },
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

    expect(withCellMetadata(await dataset.overview())).toContainEqual(
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
    expect(withCellMetadata(await dataset.overview())).toContainEqual(
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
    const { dataset, rangeRequests } = denseReferenceDataset()

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

  it('reads all-gene profiles from a dense matrix chunked by gene once per chunk', async () => {
    // Every chunk holds all four cells and one gene.
    const { dataset, rangeRequests } = denseReferenceDataset({ chunks: [4, 1] })
    await dataset.meta()
    rangeRequests.length = 0

    const profiles = await dataset.matrix(['cell-a', 'cell-b', 'cell-d'])

    expect(profiles.cells).toEqual(
      new Map([
        ['cell-a', { geneNames: ['Actb', 'Gapdh'], counts: [1, 5] }],
        ['cell-b', { geneNames: ['Actb', 'Gad1'], counts: [2, 3] }],
        ['cell-d', { geneNames: ['Actb', 'Gapdh'], counts: [7, 8] }],
      ]),
    )
    // One read per chunk for the three cells, not one per cell and chunk.
    expect(rangeRequests).toHaveLength(3)
    expect(new Set(rangeRequests).size).toBe(3)
  })

  it('reads each dense chunk once for the cells and genes it holds', async () => {
    // Two by two chunks, stored column-major; the second chunk column is half
    // padding past the third gene.
    const { dataset, rangeRequests } = denseReferenceDataset({
      chunks: [2, 2],
      order: 'F',
    })
    await dataset.meta()
    rangeRequests.length = 0

    const profiles = await dataset.matrix(['cell-d', 'cell-a', 'cell-b'])

    expect(profiles.cells).toEqual(
      new Map([
        ['cell-d', { geneNames: ['Actb', 'Gapdh'], counts: [7, 8] }],
        ['cell-a', { geneNames: ['Actb', 'Gapdh'], counts: [1, 5] }],
        ['cell-b', { geneNames: ['Actb', 'Gad1'], counts: [2, 3] }],
      ]),
    )
    expect(rangeRequests).toHaveLength(4)
    rangeRequests.length = 0

    const expression = await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(20),
        minY: micrometers(0),
        maxY: micrometers(20),
      },
      ['Gad1', 'Actb'],
    )

    expect(expression.elements.map((element) => [element.id, element.count])).toEqual([
      ['cell-a', 1],
      ['cell-b', 5],
      ['cell-c', 4],
      ['cell-d', 7],
    ])
    // Both genes are in the first chunk column: one read per row chunk.
    expect(rangeRequests).toHaveLength(2)
  })

  it('refuses all-gene profiles when one cell is in too many dense chunk bytes', async () => {
    // A cell's genes are in three 16-byte chunks.
    const { dataset, rangeRequests } = denseReferenceDataset(
      { chunks: [4, 1] },
      { denseCellProfileMaxBytes: 47 },
    )
    await dataset.meta()
    rangeRequests.length = 0

    await expect(dataset.matrix(['cell-b'])).rejects.toMatchObject({
      name: 'H5adDenseCellProfileOverBudgetError',
      message:
        "AnnData dense /X is chunked by gene, in chunks of 4 cells x 1 gene, so one cell's profile would read 3 chunks holding 48 B of values, over the 47 B limit.",
      rowCount: 4,
      geneCount: 3,
      chunkShape: [4, 1],
      chunkCount: 3,
      byteLength: 48,
      maxBytes: 47,
      chunkedByGene: true,
    })
    expect(rangeRequests).toEqual([])

    const expression = await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(20),
        minY: micrometers(0),
        maxY: micrometers(20),
      },
      ['Gad1'],
    )

    expect(expression.elements.map((element) => [element.id, element.count])).toEqual([
      ['cell-a', 0],
      ['cell-b', 3],
      ['cell-c', 4],
      ['cell-d', 0],
    ])
    expect(rangeRequests).toHaveLength(1)

    const { dataset: withinBudget } = denseReferenceDataset(
      { chunks: [4, 1] },
      { denseCellProfileMaxBytes: 48 },
    )

    await expect(withinBudget.matrix(['cell-b'])).resolves.toMatchObject({
      cells: new Map([['cell-b', { geneNames: ['Actb', 'Gad1'], counts: [2, 3] }]]),
    })
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
        'H5AD file is 350.0 MB, exceeding the browser load limit of 300.0 MB, and no readable kerchunk reference file was found at https://example.test/oversized.h5ad.json, nor an Icechunk repository at https://example.test/oversized.h5ad.icechunk.',
    })
    expect(readBody).not.toHaveBeenCalled()
  })

  it('loads oversized H5AD files through a companion Icechunk repository', async () => {
    const requests: IcechunkFixtureRequest[] = []
    const progress: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: `${ICECHUNK_FIXTURE_ORIGIN}/tiny.h5ad`,
      fetcher: icechunkFixtureFetcher({
        headLengths: { '/tiny.h5ad': 350 * 1024 * 1024 },
        requests,
      }),
      onProgress: (message) => {
        progress.push(message)
      },
    })

    await expect(dataset.meta()).resolves.toMatchObject({
      platform: 'h5ad',
      extent: {
        minX: micrometers(0),
        maxX: micrometers(20),
        minY: micrometers(0),
        maxY: micrometers(20),
      },
    })
    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1', 'Gapdh', 'Sst'])
    expect(withCellMetadata(await dataset.overview())).toContainEqual(
      expect.objectContaining({
        cellId: 'cell-b',
        position: { x: micrometers(10), y: micrometers(0) },
        metadata: { cluster: 'B', score: 0.5 },
      }),
    )
    const matrix = await dataset.matrix(['cell-c'])
    expect(matrix.cells.get('cell-c')).toEqual({
      geneNames: ['Gad1', 'Gapdh', 'Sst'],
      counts: [4, 6, 1],
    })

    // The H5AD itself is only read by range, never downloaded.
    expect(
      requests.filter(
        (request) =>
          request.path === '/tiny.h5ad' &&
          request.method === 'GET' &&
          request.range === null,
      ),
    ).toEqual([])
    expect(progress.slice(0, 5)).toEqual([
      'H5AD size check started',
      'H5AD file is 350.0 MB, above the 300.0 MB browser limit',
      `Looking for H5AD reference ${ICECHUNK_FIXTURE_ORIGIN}/tiny.h5ad.json`,
      `Looking for H5AD Icechunk repository ${ICECHUNK_FIXTURE_ORIGIN}/tiny.h5ad.icechunk`,
      expect.stringMatching(/^H5AD Icechunk repository opened: \d+ groups and arrays$/),
    ])
    expect(progress.at(-1)).toBe('H5AD Icechunk repository ready: 6 cells, 4 genes')
  })

  it('reads a companion Icechunk repository from the H5AD next to it', async () => {
    const requests: IcechunkFixtureRequest[] = []
    const dataset = new AnnDataH5adDataset({
      url: `${ICECHUNK_FIXTURE_ORIGIN}/renamed.h5ad`,
      fetcher: icechunkFixtureFetcher({
        aliases: {
          '/renamed.h5ad.icechunk': '/tiny.h5ad.icechunk',
          '/renamed.h5ad': '/tiny.h5ad',
        },
        headLengths: { '/renamed.h5ad': 350 * 1024 * 1024 },
        requests,
      }),
    })

    const matrix = await dataset.matrix(['cell-d'])

    expect(matrix.cells.get('cell-d')).toEqual({
      geneNames: ['Actb', 'Gapdh'],
      counts: [7, 8],
    })
    // The repository stores https://example.test/tiny.h5ad.
    expect(requests.some((request) => request.path === '/tiny.h5ad')).toBe(false)
    expect(requests).toContainEqual(
      expect.objectContaining({ path: '/renamed.h5ad', range: expect.any(String) }),
    )
  })

  it('loads AnnData written into an Icechunk repository', async () => {
    const progress: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: `${ICECHUNK_FIXTURE_ORIGIN}/anndata.icechunk`,
      icechunk: true,
      fetcher: icechunkFixtureFetcher(),
      onProgress: (message) => {
        progress.push(message)
      },
    })

    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1', 'Gapdh', 'Sst'])
    await expect(dataset.annotationGroups()).resolves.toEqual([
      {
        id: 'analysis:cluster',
        label: 'cluster',
        groupingName: 'cluster',
        groupCount: 2,
      },
    ])
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
      ['cell-e', 0],
      ['cell-f', 0],
    ])
    expect(progress.at(-1)).toBe('Icechunk AnnData ready: 6 cells, 4 genes')
  })
})

describe('AnnDataH5adDataset attached image with non-square pixels', () => {
  // Pixels 0.5 µm wide and 2 µm tall.
  const loader = {
    url: 'https://example.test/he.zarr',
    imageWidth: 100,
    imageHeight: 100,
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(0.5),
      yMicrometersPerPixel: micrometers(2),
      origin: 'top-left',
      imageYAxis: 'down',
    },
    channels: [],
  } as unknown as ImagePyramidLoader
  const memorySource = {
    label: 'Memory table',
    load: async () => ({
      obsNames: ['1', '2'],
      obs: [],
      varNames: ['A'],
      X: {
        kind: 'csr' as const,
        data: new Float32Array([1, 2]),
        indices: new Int32Array([0, 0]),
        indptr: new Int32Array([0, 1, 2]),
      },
      // Image pixels (x, y).
      obsm: { spatial: { values: new Float32Array([20, 10, 60, 40]), columns: 2 } },
    }),
  }

  it('places image-pixel coordinates by the pixel width and height', async () => {
    const dataset = new AnnDataH5adDataset({
      url: 'memory://anisotropic',
      memorySource,
      image: { url: loader.url, coordinates: 'image-pixels' },
      openImage: vi.fn().mockResolvedValue(loader),
    })
    const overview = await dataset.overview()

    expect(overview.map((point) => point.position)).toEqual([
      { x: micrometers(10), y: micrometers(20) },
      { x: micrometers(30), y: micrometers(80) },
    ])
  })

  it('converts the view to label pixels by the pixel height', async () => {
    // 50 x 50 label pixels over the 100 x 100 image: each 1 µm wide, 4 µm tall.
    const outlines = vi.fn(async () => [])
    const openLabels = vi.fn(async () => ({
      levels: [{ width: 50, height: 50 }],
      outlines,
    })) as unknown as AnnDataLabelsOpener
    const dataset = new AnnDataH5adDataset({
      url: 'memory://anisotropic-labels',
      memorySource,
      image: { url: loader.url, coordinates: 'micrometers', labelsUrl: 'labels.zarr' },
      openImage: vi.fn().mockResolvedValue(loader),
      openLabels,
    })

    await dataset.elements({
      minX: micrometers(0),
      maxX: micrometers(100),
      minY: micrometers(0),
      maxY: micrometers(100),
    })

    expect(outlines).toHaveBeenCalledWith(
      { minX: 0, minY: 0, maxX: 100, maxY: 25 },
      expect.anything(),
    )
  })
})

describe('AnnDataH5adDataset gene values (plan 22-A)', () => {
  // The tiny fixture's matrix, cells by genes (Actb, Gad1, Gapdh).
  const expected = {
    Actb: [
      [0, 1],
      [1, 2],
      [3, 7],
    ],
    Gad1: [
      [1, 3],
      [2, 4],
    ],
    Gapdh: [
      [0, 5],
      [2, 6],
      [3, 8],
    ],
  }

  it.each(['dense', 'csr', 'csc'] as const)(
    'reads every cell of each gene from a %s matrix in memory',
    async (matrixKind) => {
      const dataset = new AnnDataH5adDataset({
        url: 'https://example.test/tiny.h5ad',
        fetcher: h5adFetcher(await createTinyH5ad(matrixKind)),
      })

      await expect(dataset.estimateGeneValuesRead(['Gapdh'])).resolves.toEqual({
        kind: 'read',
        bytes: 0,
      })
      await expect(dataset.geneValuesRowIds()).resolves.toEqual([
        'cell-a',
        'cell-b',
        'cell-c',
        'cell-d',
      ])
      const reads = await dataset.geneValues(['Gapdh', 'Actb', 'Nope', 'Gad1'])

      expect(
        reads.map((read) =>
          'error' in read
            ? read.error
            : [...read.rows]
                .map((row, index) => [row, read.values[index]])
                .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0)),
        ),
      ).toEqual([
        expected.Gapdh,
        expected.Actb,
        'Nope is not in the expression matrix.',
        expected.Gad1,
      ])

      // The same values the cell profile reads, cell by cell.
      const matrix = await dataset.matrix(['cell-a', 'cell-b', 'cell-c', 'cell-d'])
      for (const [gene, entries] of Object.entries(expected)) {
        for (const [row, value] of entries) {
          const cell = matrix.cells.get(
            ['cell-a', 'cell-b', 'cell-c', 'cell-d'][row ?? 0] ?? '',
          )
          expect(cell?.counts[cell.geneNames.indexOf(gene)]).toBe(value)
        }
      }
    },
  )

  // Each gene's (row, value) pairs, sorted by row, or its error.
  function sortedReads(reads: readonly GeneValuesRead[]) {
    return reads.map((read) =>
      'error' in read
        ? read.error
        : [...read.rows]
            .map((row, index) => [row, read.values[index]])
            .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0)),
    )
  }

  // The tiny matrix, oversized so it opens through its kerchunk reference,
  // with the Range header of each read.
  function referenceDataset(
    matrixKind: MatrixKind,
    denseChunking?: TinyDenseChunking,
  ): { readonly dataset: AnnDataH5adDataset; readonly rangeRequests: string[] } {
    if (matrixKind === 'dense') return denseReferenceDataset(denseChunking)

    const chunks = new RemoteH5adReferenceChunks()
    const spec = createTinyH5adReferenceSpec((value) => chunks.ref(value), matrixKind)
    const fetcher = h5adRemoteReferenceFetcher(
      350 * 1024 * 1024,
      spec,
      chunks.bytes(),
      () => {
        throw new Error('body should not be read')
      },
    )
    const rangeRequests: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: `https://example.test/reference-${matrixKind}.h5ad`,
      fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        const range = request.headers.get('Range')
        if (range !== null) rangeRequests.push(range)
        return fetcher(request)
      }) as typeof fetch,
    })

    return { dataset, rangeRequests }
  }

  // Gad1 alone: all of a CSR matrix's 8 values and indices at 4 bytes each,
  // its own 2 under CSC, and the dense chunks that hold its column.
  it.each([
    { name: 'CSR', matrixKind: 'csr', gad1Bytes: 64, detail: /stored by cell/ },
    { name: 'CSC', matrixKind: 'csc', gad1Bytes: 16, detail: /stored by gene/ },
    {
      name: 'dense in 2 × 3 chunks',
      matrixKind: 'dense',
      chunking: { chunks: [2, 3] },
      gad1Bytes: 48,
      detail: /chunks of 2 cells by 3 genes/,
    },
    {
      name: 'dense in column-major 2 × 2 chunks',
      matrixKind: 'dense',
      chunking: { chunks: [2, 2], order: 'F' },
      gad1Bytes: 32,
      detail: /dense/,
    },
    {
      name: 'dense in 3 × 2 chunks, padded past the last cell',
      matrixKind: 'dense',
      chunking: { chunks: [3, 2] },
      gad1Bytes: 48,
      detail: /dense/,
    },
    {
      name: 'dense chunked by gene',
      matrixKind: 'dense',
      chunking: { chunks: [4, 1] },
      gad1Bytes: 16,
      detail: /dense/,
    },
  ] satisfies readonly {
    name: string
    matrixKind: MatrixKind
    chunking?: TinyDenseChunking
    gad1Bytes: number
    detail: RegExp
  }[])(
    'reads every cell of each gene from a $name matrix over HTTP',
    async ({ matrixKind, chunking, gad1Bytes, detail }) => {
      const { dataset, rangeRequests } = referenceDataset(matrixKind, chunking)

      await expect(dataset.estimateGeneValuesRead(['Gad1'])).resolves.toEqual({
        kind: 'read',
        bytes: gad1Bytes,
        detail: expect.stringMatching(detail),
      })
      // Estimates read nothing.
      rangeRequests.length = 0
      await dataset.estimateGeneValuesRead(['Actb', 'Gapdh'])
      expect(rangeRequests).toEqual([])

      const reads = await dataset.geneValues(['Gapdh', 'Actb', 'Nope', 'Gad1'])

      expect(sortedReads(reads)).toEqual([
        expected.Gapdh,
        expected.Actb,
        'Nope is not in the expression matrix.',
        expected.Gad1,
      ])
    },
  )

  it('reads only the chunks that hold the genes from a dense matrix', async () => {
    const { dataset, rangeRequests } = referenceDataset('dense', { chunks: [4, 1] })
    await dataset.geneValuesRowIds()
    rangeRequests.length = 0

    const [gad1] = await dataset.geneValues(['Gad1'])

    expect(sortedReads([gad1 as GeneValuesRead])).toEqual([expected.Gad1])
    expect(rangeRequests).toHaveLength(1)
  })

  it.each([
    { name: 'dense Zarr v2 chunked by gene', store: 'tiny.zarr' },
    { name: 'CSR Zarr v3', store: 'tiny.v3.zarr' },
  ])('reads the same values as cell profiles from $name', async ({ store }) => {
    const dataset = new AnnDataH5adDataset({
      url: `${ANNDATA_ZARR_FIXTURE_ORIGIN}/${store}`,
      zarr: true,
      fetcher: annDataZarrFixtureFetcher(),
    })
    const genes = ['Actb', 'Gad1', 'Gapdh', 'Sst']
    const rowIds = (await dataset.geneValuesRowIds()) as readonly string[]
    const reads = await dataset.geneValues(genes)
    const profiles = await dataset.matrix(rowIds as never)

    for (const [index, read] of reads.entries()) {
      if ('error' in read) throw new Error(read.error)
      const gene = genes[index] ?? ''
      const fromProfiles = rowIds.flatMap((cellId, row) => {
        const cell = profiles.cells.get(cellId as never)
        const value = cell?.counts[cell.geneNames.indexOf(gene)] ?? 0
        return value === 0 ? [] : [[row, value]]
      })
      expect(sortedReads([read])[0]).toEqual(fromProfiles)
    }
  })
})

describe('AnnDataH5adDataset read by range', () => {
  const allCells = ['cell-a', 'cell-b', 'cell-c', 'cell-d']
  const wholeExtent = {
    minX: micrometers(0),
    maxX: micrometers(20),
    minY: micrometers(0),
    maxY: micrometers(20),
  }
  // A layer the viewer never reads, between the superblock and the groups it
  // does, so a read of it would show in the bytes fetched. The first range
  // request, 1 MiB from the start, takes some of it.
  const padding = 4 * 1024 * 1024

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads only the groups it uses, and /X whole, by range in the H5 worker', async () => {
    const bytes = await createTinyH5ad('csr', { padding })
    const host = stubH5adRangeHost(bytes)
    const progress: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/sparse.h5ad',
      h5WorkerFactory: host.h5WorkerFactory,
      onProgress: (message) => progress.push(message),
    })

    await expect(dataset.matrix(['cell-c'])).resolves.toMatchObject({
      cells: new Map([['cell-c', { geneNames: ['Gad1', 'Gapdh'], counts: [4, 6] }]]),
    })
    const expression = await dataset.geneExpression(wholeExtent, ['Gapdh'])
    expect(expression.elements.map((element) => [element.id, element.count])).toEqual([
      ['cell-a', 5],
      ['cell-b', 0],
      ['cell-c', 6],
      ['cell-d', 8],
    ])
    // /X is held in memory, as from a downloaded file.
    await expect(dataset.estimateGeneValuesRead(['Gapdh'])).resolves.toEqual({
      kind: 'read',
      bytes: 0,
    })

    expect(host.requests.filter(({ range }) => range === null)).toEqual([
      { method: 'HEAD', range: null, url: 'https://example.test/sparse.h5ad' },
    ])
    expect(host.rangeReads.length).toBeGreaterThan(0)
    expect(host.fetchedBytes()).toBeLessThan(bytes.byteLength - padding / 2)
    expect(progress).toContainEqual(
      expect.stringMatching(
        /^H5AD arrays read by range \([\d.]+ [KM]B of [\d.]+ MB in \d+ range requests?\)$/,
      ),
    )
  })

  it.each(['dense', 'csr', 'csc'] as const)(
    'slices a %s /X per request above the matrix budget',
    async (matrixKind) => {
      const host = stubH5adRangeHost(await createTinyH5ad(matrixKind, { padding }))
      const dataset = new AnnDataH5adDataset({
        url: 'https://example.test/tiny.h5ad',
        h5WorkerFactory: host.h5WorkerFactory,
        rangeMatrixMaxBytes: 0,
      })

      const expression = await dataset.geneExpression(wholeExtent, ['Gapdh', 'Gad1'])
      expect(expression.elements.map((element) => [element.id, element.count])).toEqual([
        ['cell-a', 5],
        ['cell-b', 3],
        ['cell-c', 10],
        ['cell-d', 8],
      ])
      // Plots read the genes by range too, at a cost the layout sets.
      const estimate = await dataset.estimateGeneValuesRead(['Gapdh', 'Gad1'])
      expect(estimate).toMatchObject({ kind: 'read' })
      expect(estimate.kind === 'read' ? estimate.bytes : 0).toBe(
        { dense: 4 * 3 * 4, csr: 8 * 8, csc: 5 * 8 }[matrixKind],
      )
      const reads = await dataset.geneValues(['Gapdh', 'Gad1'])
      expect(
        reads.map((read) =>
          'error' in read
            ? read.error
            : [...read.rows].map((row, index) => [row, read.values[index]]),
        ),
      ).toEqual([
        [
          [0, 5],
          [2, 6],
          [3, 8],
        ],
        [
          [1, 3],
          [2, 4],
        ],
      ])

      // A CSC matrix read lazily cannot give every gene of a cell.
      if (matrixKind === 'csc') {
        await expect(dataset.matrix(['cell-c'])).rejects.toMatchObject({
          name: 'H5adAllGeneCscMatrixUnsupportedError',
        })
        return
      }

      const matrix = await dataset.matrix(['cell-d', 'cell-a', 'cell-c'])
      expect(matrix.cells).toEqual(
        new Map([
          ['cell-d', { geneNames: ['Actb', 'Gapdh'], counts: [7, 8] }],
          ['cell-a', { geneNames: ['Actb', 'Gapdh'], counts: [1, 5] }],
          ['cell-c', { geneNames: ['Gad1', 'Gapdh'], counts: [4, 6] }],
        ]),
      )
    },
  )

  it('never sends a slice of /X still waiting when the request is aborted', async () => {
    const host = stubH5adRangeHost(await createTinyH5ad('csr'))
    const controller = new AbortController()
    const slices: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      rangeMatrixMaxBytes: 0,
      h5WorkerFactory: () => {
        const worker = host.h5WorkerFactory()
        const postMessage = worker.postMessage.bind(worker)
        worker.postMessage = (message, transfer) => {
          if (message.op === 'read' && message.slice !== undefined) {
            slices.push(message.path)
            controller.abort()
          }

          postMessage(message, transfer)
        }
        return worker
      },
    })
    await dataset.meta()

    await expect(
      dataset.geneExpression(wholeExtent, ['Gapdh'], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    // The data slice queued behind the indices was dropped.
    expect(slices).toEqual(['/X/indices'])
  })

  it('ends the H5 worker when every load reading the file is cancelled', async () => {
    const host = stubH5adRangeHost(await createTinyH5ad('csr'))
    const controller = new AbortController()
    const reads: string[] = []
    const terminated: boolean[] = []
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      h5WorkerFactory: () => {
        const worker = host.h5WorkerFactory()
        const index = terminated.push(false) - 1
        const postMessage = worker.postMessage.bind(worker)
        const terminate = worker.terminate.bind(worker)
        worker.postMessage = (message, transfer) => {
          if (message.op === 'read') {
            reads.push(message.path)
            controller.abort()
          }

          postMessage(message, transfer)
        }
        worker.terminate = () => {
          terminated[index] = true
          terminate()
        }
        return worker
      },
    })

    await expect(dataset.overview({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    // The worker ended at its first read, so nothing after it was read.
    expect(terminated).toEqual([true])
    expect(reads).toHaveLength(1)
    // The next caller opens the file again.
    await expect(dataset.overview()).resolves.toHaveLength(4)
    expect(terminated).toEqual([true, false])
  })

  it('downloads a small file whole without range requests', async () => {
    const bytes = await createTinyH5ad('csr')
    const host = stubH5adRangeHost(bytes, { headByteLength: bytes.byteLength })
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      h5WorkerFactory: host.h5WorkerFactory,
    })

    await expect(dataset.cellIds()).resolves.toEqual(allCells)
    expect(host.requests.map(({ method, range }) => [method, range])).toEqual([
      ['HEAD', null],
      ['GET', null],
    ])
  })

  it('downloads the file whole when its host ignores range requests', async () => {
    const host = stubH5adRangeHost(await createTinyH5ad('csr'), { answersRange: false })
    const progress: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/tiny.h5ad',
      h5WorkerFactory: host.h5WorkerFactory,
      onProgress: (message) => progress.push(message),
    })

    await expect(dataset.cellIds()).resolves.toEqual(allCells)
    expect(host.requests.map(({ method, range }) => [method, range])).toEqual([
      ['HEAD', null],
      ['GET', 'bytes=0-1048575'],
      ['GET', null],
    ])
    expect(host.rangeReads).toEqual([])
    expect(progress).toContain(
      'H5AD host does not answer range requests; downloading the whole file',
    )
  })

  it('reads a file over the size limit by range without looking for a companion', async () => {
    // HEAD says 350 MiB; the range replies give the fixture's true size.
    const host = stubH5adRangeHost(await createTinyH5ad('csr'), {
      headByteLength: 350 * 1024 * 1024,
    })
    const progress: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/oversized.h5ad',
      h5WorkerFactory: host.h5WorkerFactory,
      onProgress: (message) => progress.push(message),
    })

    await expect(dataset.cellIds()).resolves.toEqual(allCells)
    expect(progress.slice(0, 2)).toEqual([
      'H5AD size check started',
      'H5AD file is 350.0 MB; reading by range',
    ])
    // A .h5ad.json or .h5ad.icechunk next to it would not be read.
    expect(host.companionRequests).toEqual([])
    // The H5AD itself is never fetched whole.
    expect(host.requests.filter(({ range }) => range === null)).toEqual([
      { method: 'HEAD', range: null, url: 'https://example.test/oversized.h5ad' },
    ])
  })

  it('looks for a companion when an oversized file cannot be read by range', async () => {
    const host = stubH5adRangeHost(await createTinyH5ad('csr'), {
      headByteLength: 350 * 1024 * 1024,
      answersRange: false,
    })
    const progress: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/oversized.h5ad',
      h5WorkerFactory: host.h5WorkerFactory,
      onProgress: (message) => progress.push(message),
    })

    await expect(dataset.meta()).rejects.toMatchObject({
      name: 'H5adReferenceFileUnavailableError',
    })
    expect(progress.slice(0, 5)).toEqual([
      'H5AD size check started',
      'H5AD file is 350.0 MB; reading by range',
      'H5AD host does not answer range requests',
      'H5AD file is 350.0 MB, above the 300.0 MB browser limit',
      'Looking for H5AD reference https://example.test/oversized.h5ad.json',
    ])
    expect(host.companionRequests[0]).toBe('https://example.test/oversized.h5ad.json')
    expect(host.companionRequests.slice(1)).toContainEqual(
      expect.stringMatching(/^https:\/\/example\.test\/oversized\.h5ad\.icechunk\//),
    )
    // Only the first range request; the file is never downloaded whole.
    expect(host.requests.map(({ method, range }) => [method, range])).toEqual([
      ['HEAD', null],
      ['GET', 'bytes=0-1048575'],
    ])
  })
})

interface H5adRangeHostOptions {
  // HEAD's Content-Length; none by default, as when a HEAD fails.
  readonly headByteLength?: number
  readonly answersRange?: boolean
}

// Serves `bytes` at any .h5ad URL through a stubbed global fetch (other paths,
// such as companion references, are 404 and listed in `companionRequests`), and
// starts in-process H5 workers that read it by range as the real worker does.
function stubH5adRangeHost(bytes: Uint8Array, options: H5adRangeHostOptions = {}) {
  const requests: { method: string; range: string | null; url: string }[] = []
  const companionRequests: string[] = []
  const rangeReads: (readonly [number, number])[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const range = new Headers(init?.headers).get('range')

      if (!new URL(url).pathname.endsWith('.h5ad')) {
        companionRequests.push(url)
        return new Response(null, { status: 404 })
      }

      requests.push({ method, range, url })

      if (method === 'HEAD') {
        return new Response(null, {
          headers:
            options.headByteLength === undefined
              ? {}
              : { 'content-length': String(options.headByteLength) },
        })
      }

      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')

      if (match === null || options.answersRange === false) {
        return new Response(bytes.slice())
      }

      const start = Number(match[1])
      const end = Math.min(Number(match[2]) + 1, bytes.byteLength)
      return new Response(bytes.slice(start, end), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end - 1}/${bytes.byteLength}` },
      })
    }),
  )

  return {
    requests,
    companionRequests,
    rangeReads,
    // The first range request and the range reads after it.
    fetchedBytes: () =>
      requests
        .filter(({ method, range }) => method === 'GET' && range !== null)
        .reduce((sum) => sum + Math.min(1024 * 1024, bytes.byteLength), 0) +
      rangeReads.reduce((sum, [start, end]) => sum + end - start, 0),
    h5WorkerFactory: () =>
      createInProcessH5Worker({
        createRangeRead: () => (start, end) => {
          rangeReads.push([start, end])
          return bytes.slice(start, end)
        },
      }),
  }
}

type MatrixKind = 'dense' | 'csr' | 'csc'
type CategoricalEncoding = 'group' | 'dataframe-categories'

interface TinyH5adOptions {
  readonly categoricalEncoding?: CategoricalEncoding
  // The obs index; defaults to cell-a to cell-d.
  readonly obsNames?: readonly string[]
  // More obs columns, one value per cell.
  readonly extraObs?: Readonly<Record<string, Int32Array | readonly string[]>>
  // Written as `uns/spatialdata_attrs/instance_key`, as spatialdata before 0.2
  // did, or with `in: 'attributes'` as the root's `instance_key` attribute.
  readonly spatialDataInstanceKey?: string
  readonly spatialDataInstanceKeyIn?: 'uns' | 'attributes'
  readonly coordinateKey?: string
  // The coordinate matrix, with as many columns as its values allow; defaults
  // to the corners of a 10 µm square.
  readonly coordinates?: readonly number[]
  // Writes the var index as Ensembl IDs and gene symbols as a categorical
  // `feature_name`, the CELLxGENE layout.
  readonly featureNames?: CategoricalFeatureNames
  // Writes the obs and var indexes and extra obs columns as nullable arrays,
  // the anndata 0.13 layout under pandas 3.
  readonly nullableStrings?: boolean
  // Codes of the categorical obs `cluster` column (categories A and B); -1
  // marks a missing label.
  readonly clusterCodes?: readonly number[]
  // More obsm matrices, by name, with as many columns as their values allow.
  readonly extraObsm?: Readonly<Record<string, readonly number[]>>
  // Bytes of a `layers/padding` dataset written before the groups the viewer
  // reads.
  readonly padding?: number
  // X as 4 rows of 3 values, written in the matrix kind's layout.
  readonly x?: readonly number[]
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
  const clusterCodes = new Int8Array(options.clusterCodes ?? [0, 1, 0, 1])

  try {
    FS.unlink(fileName)
  } catch {
    // No previous fixture file exists for the first run.
  }

  const file = new h5wasm.File(fileName, 'w')

  if (options.padding !== undefined) {
    file
      .create_group('layers')
      .create_dataset({ name: 'padding', data: new Uint8Array(options.padding) })
  }

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
    obs.create_attribute('column-order', [
      'cluster',
      'score',
      ...Object.keys(options.extraObs ?? {}),
    ])
    obs.create_dataset({
      name: 'cell_id',
      data: [...(options.obsNames ?? ['cell-a', 'cell-b', 'cell-c', 'cell-d'])],
    })
  }

  obs.create_dataset({
    name: 'score',
    data: new Float32Array([0.1, 0.5, 0.9, 0.2]),
  })

  for (const [name, values] of Object.entries(options.extraObs ?? {})) {
    obs.create_dataset({
      name,
      data: values instanceof Int32Array ? values : [...values],
    })
  }

  if (
    options.spatialDataInstanceKey !== undefined &&
    options.spatialDataInstanceKeyIn === 'attributes'
  ) {
    file.create_attribute('instance_key', options.spatialDataInstanceKey)
  } else if (options.spatialDataInstanceKey !== undefined) {
    file
      .create_group('uns')
      .create_group('spatialdata_attrs')
      .create_dataset({ name: 'instance_key', data: options.spatialDataInstanceKey })
  }
  if (categoricalEncoding === 'group') {
    const cluster = obs.create_group('cluster')
    cluster.create_attribute('encoding-type', 'categorical')
    cluster.create_dataset({ name: 'categories', data: ['A', 'B'] })
    cluster.create_dataset({ name: 'codes', data: clusterCodes })
  } else {
    obs.create_dataset({ name: 'cluster', data: clusterCodes })
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
  const coordinates = options.coordinates ?? [0, 0, 10, 0, 0, 10, 10, 10]
  obsm.create_dataset({
    name: coordinateKey,
    data: new Float32Array(coordinates),
    shape: [4, coordinates.length / 4],
  })
  obsm.create_dataset({
    name: 'X_pca',
    data: new Float32Array([1, 0, 9, 0, 1, 8, -1, 0, 7, 0, -1, 6]),
    shape: [4, 3],
  })

  for (const [name, values] of Object.entries(options.extraObsm ?? {})) {
    obsm.create_dataset({
      name,
      data: new Float32Array(values),
      shape: [4, values.length / 4],
    })
  }

  if (matrixKind === 'dense') {
    file.create_dataset({
      name: 'X',
      data: new Float32Array(options.x ?? [1, 0, 5, 2, 3, 0, 0, 4, 6, 7, 0, 8]),
      shape: [4, 3],
    })
  } else {
    const x = file.create_group('X')
    x.create_attribute(
      'encoding-type',
      matrixKind === 'csc' ? 'csc_matrix' : 'csr_matrix',
    )
    x.create_attribute('shape', new Int32Array([4, 3]))
    const sparse =
      options.x === undefined
        ? tinySparseMatrixFixture(matrixKind)
        : sparseMatrixFromRows(options.x, 3, matrixKind)
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

    if (url.pathname.includes('.h5ad.icechunk/')) {
      return new Response(null, { status: 404 })
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

// An oversized H5AD read through a reference with a dense /X, and the Range
// headers of the chunk reads it makes.
function denseReferenceDataset(
  denseChunking?: TinyDenseChunking,
  options: Pick<AnnDataH5adDatasetOptions, 'denseCellProfileMaxBytes'> = {},
): { readonly dataset: AnnDataH5adDataset; readonly rangeRequests: string[] } {
  const chunks = new RemoteH5adReferenceChunks()
  const referenceSpec = createTinyH5adReferenceSpec(
    (value) => chunks.ref(value),
    'dense',
    denseChunking === undefined ? {} : { denseChunking },
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
    ...options,
  })

  return { dataset, rangeRequests }
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

interface TinyDenseChunking {
  readonly chunks: readonly [number, number]
  readonly order?: 'C' | 'F'
}

function createTinyH5adReferenceSpec(
  chunkRef: ChunkRefFactory = bytesRef,
  matrixKind: MatrixKind = 'csr',
  options: Pick<TinyH5adOptions, 'featureNames' | 'nullableStrings'> & {
    readonly denseChunking?: TinyDenseChunking
  } = {},
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
        ? tinyDenseMatrixRefs(chunkRef, options.denseChunking)
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
const TINY_DENSE_X = [
  [1, 0, 5],
  [2, 3, 0],
  [0, 4, 6],
  [7, 0, 8],
] as const
// Fills the part of an edge chunk past /X, so reading it shows up.
const TINY_DENSE_X_PADDING = 99

function tinyDenseMatrixRefs(
  chunkRef: ChunkRefFactory,
  { chunks: [chunkRows, chunkCols], order = 'C' }: TinyDenseChunking = { chunks: [2, 3] },
): Record<string, unknown> {
  const rows = TINY_DENSE_X.length
  const cols = TINY_DENSE_X[0].length
  const refs: Record<string, unknown> = {
    'X/.zarray': zarrArrayRef([rows, cols], [chunkRows, chunkCols], '<f4', order),
  }

  for (let rowChunk = 0; rowChunk * chunkRows < rows; rowChunk += 1) {
    for (let colChunk = 0; colChunk * chunkCols < cols; colChunk += 1) {
      const values = new Float32Array(chunkRows * chunkCols)

      for (let row = 0; row < chunkRows; row += 1) {
        for (let col = 0; col < chunkCols; col += 1) {
          const value: number | undefined =
            TINY_DENSE_X[rowChunk * chunkRows + row]?.[colChunk * chunkCols + col]
          values[order === 'C' ? row * chunkCols + col : col * chunkRows + row] =
            value ?? TINY_DENSE_X_PADDING
        }
      }

      refs[`X/${rowChunk}.${colChunk}`] = chunkRef(values)
    }
  }

  return refs
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

// The non-zero values of a row-major matrix in CSR or CSC layout.
function sparseMatrixFromRows(
  values: readonly number[],
  cols: number,
  matrixKind: Extract<MatrixKind, 'csr' | 'csc'>,
): {
  readonly data: Float32Array
  readonly indices: Int32Array
  readonly indptr: Int32Array
} {
  const rows = values.length / cols
  const [outer, inner] = matrixKind === 'csr' ? [rows, cols] : [cols, rows]
  const data: number[] = []
  const indices: number[] = []
  const indptr = [0]

  for (let major = 0; major < outer; major += 1) {
    for (let minor = 0; minor < inner; minor += 1) {
      const value =
        matrixKind === 'csr'
          ? (values[major * cols + minor] ?? 0)
          : (values[minor * cols + major] ?? 0)

      if (value !== 0) {
        data.push(value)
        indices.push(minor)
      }
    }
    indptr.push(data.length)
  }

  return {
    data: new Float32Array(data),
    indices: new Int32Array(indices),
    indptr: new Int32Array(indptr),
  }
}

function zarrArrayRef(
  shape: readonly number[],
  chunks: readonly number[],
  dtype: string,
  order: 'C' | 'F' = 'C',
): string {
  return jsonRef({
    zarr_format: 2,
    shape,
    chunks,
    dtype,
    compressor: null,
    fill_value: null,
    order,
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

describe('AnnDataH5adDataset sections', () => {
  const SECTIONS: TinyH5adOptions = {
    coordinateKey: 'spatial',
    extraObs: {
      section: ['s2', 's1', 's2', 's1'],
      z_um: new Int32Array([60, 0, 60, 0]),
    },
  }

  async function openFile(options: TinyH5adOptions = SECTIONS) {
    return new AnnDataH5adDataset({
      url: 'https://example.test/sections.h5ad',
      fetcher: h5adFetcher(await createTinyH5ad('dense', options)),
    })
  }

  function openSection(file: AnnDataH5adDataset, column: string, value: string) {
    const release = vi.fn()
    const holdFile = vi.fn(() => ({ dataset: Promise.resolve(file), release }))
    const dataset = new AnnDataH5adDataset({
      url: file.url,
      section: { column, value, holdFile },
    })
    return { dataset, holdFile, release }
  }

  it('lists the obs columns and sections that split a table', async () => {
    const file = await openFile()

    await expect(file.sectionColumns()).resolves.toEqual([
      { column: 'section', sectionCount: 2 },
      { column: 'cluster', sectionCount: 2 },
    ])
    // Strings as first seen, with each section's depth from obs z_um.
    await expect(file.sections('section')).resolves.toEqual([
      { value: 's2', cellCount: 2, z: 60 },
      { value: 's1', cellCount: 2, z: 0 },
    ])
    // Categories in order; numbers ascending.
    await expect(file.sections('cluster')).resolves.toMatchObject([
      { value: 'A', cellCount: 2 },
      { value: 'B', cellCount: 2 },
    ])
    await expect(file.sections('z_um')).resolves.toEqual([
      { value: '0', cellCount: 2, z: 0 },
      { value: '60', cellCount: 2, z: 60 },
    ])
    await expect(file.sections('stage')).rejects.toThrow(
      'obs has no column "stage" to split into sections.',
    )
  })

  it('counts the sections a categorical column gives, not the categories it declares', async () => {
    // A subset that kept unused categories: four declared, one or two used.
    const dataset = new AnnDataH5adDataset({
      url: 'memory://unused-categories',
      memorySource: {
        label: 'Memory table',
        load: async () => ({
          obsNames: ['c0', 'c1', 'c2', 'c3'],
          obs: [
            {
              name: 'sample',
              kind: 'categorical' as const,
              codes: new Int8Array([2, 2, 2, 2]),
              categories: ['s1', 's2', 's3', 's4'],
            },
            {
              name: 'section',
              kind: 'categorical' as const,
              codes: new Int8Array([0, 3, 3, -1]),
              categories: ['a', 'b', 'c', 'd'],
            },
          ],
          varNames: ['A'],
          X: {
            kind: 'csr' as const,
            data: new Float32Array([1]),
            indices: new Int32Array([0]),
            indptr: new Int32Array([0, 1, 1, 1, 1]),
          },
          obsm: {
            spatial: { values: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), columns: 2 },
          },
        }),
      },
    })

    await expect(dataset.sectionColumns()).resolves.toEqual([
      { column: 'section', sectionCount: 2 },
    ])
    await expect(dataset.sections('section')).resolves.toHaveLength(2)
  })

  it('splits by a whole-number section column, as anndata stores integer IDs (EXP-041)', async () => {
    const file = await openFile({
      coordinateKey: 'spatial',
      extraObs: {
        section: new Int32Array([2, 1, 2, 3]),
        z_um: new Int32Array([10, 0, 10, 20]),
        // A number column not named like a section column is not listed.
        n_counts: new Int32Array([5, 6, 7, 8]),
      },
    })

    await expect(file.sectionColumns()).resolves.toEqual([
      { column: 'section', sectionCount: 3 },
      { column: 'cluster', sectionCount: 2 },
    ])

    const collection = await loadDatasetCollection(file.url, {
      openDataset: async () => file,
    })
    expect(collection.datasets.map(({ name, z }) => ({ name, z }))).toEqual([
      { name: '1', z: 0 },
      { name: '2', z: 10 },
      { name: '3', z: 20 },
    ])
  })

  it('takes a depth from a third obsm spatial column shared by each section', async () => {
    const file = await openFile({
      coordinateKey: 'spatial',
      coordinates: [0, 0, 60, 10, 0, 0, 0, 10, 60, 10, 10, 0],
      extraObs: { section: ['s2', 's1', 's2', 's1'] },
    })
    const { dataset } = openSection(file, 'section', 's2')

    await expect(file.sections('section')).resolves.toEqual([
      { value: 's2', cellCount: 2, z: 60 },
      { value: 's1', cellCount: 2, z: 0 },
    ])
    // A section's cells in one plane have no depths of their own.
    expect((await dataset.overview()).map((point) => point.z)).toEqual([
      undefined,
      undefined,
    ])
  })

  it('keeps cells with their own z at their table z, relative to the section', async () => {
    // Sections 60 µm apart by obs z_um; each cell's table z (obsm spatial's
    // third column) is within 2 µm of its section's.
    const file = await openFile({
      ...SECTIONS,
      coordinates: [0, 0, 61, 10, 0, 0, 0, 10, 62, 10, 10, 2],
    })
    const z = async (value: string) =>
      (await openSection(file, 'section', value).dataset.overview()).map(
        (point) => point.z,
      )

    await expect(file.sections('section')).resolves.toEqual([
      { value: 's2', cellCount: 2, z: 60 },
      { value: 's1', cellCount: 2, z: 0 },
    ])
    // The stack draws a cell at its section's z plus its own: 61 and 62 µm,
    // where the whole table puts them, rather than 121 and 122.
    await expect(z('s2')).resolves.toEqual([1, 2])
    await expect(z('s1')).resolves.toEqual([0, 2])
    expect((await file.overview()).map((point) => point.z)).toEqual([61, 0, 62, 2])
  })

  it('opens one section as a dataset of its rows, read through the file', async () => {
    const file = await openFile()
    const { dataset, holdFile } = openSection(file, 'section', 's1')

    expect(
      (await dataset.overview()).map((point) => [
        point.cellId,
        point.position.x,
        point.position.y,
      ]),
    ).toEqual([
      ['cell-b', 10, 0],
      ['cell-d', 10, 10],
    ])
    await expect(dataset.cellIds()).resolves.toEqual(['cell-b', 'cell-d'])
    await expect(dataset.annotationGroups()).resolves.toMatchObject([
      { id: 'analysis:cluster', groupCount: 1 },
      { id: 'analysis:section', groupCount: 1 },
    ])
    expect(
      (await dataset.annotations({ groupId: 'analysis:cluster' })).map((annotation) => [
        annotation.label,
        annotation.cellIds,
      ]),
    ).toEqual([['cluster: B', ['cell-b', 'cell-d']]])
    await expect(dataset.metadataTracks()).resolves.toMatchObject([
      { label: 'score', cellCount: 2, min: expect.closeTo(0.2), max: 0.5 },
      { label: 'z_um', cellCount: 2, min: 0, max: 0 },
    ])
    expect((await dataset.matrix(['cell-d'])).cells.get('cell-d')).toEqual({
      geneNames: ['Actb', 'Gapdh'],
      counts: [7, 8],
    })
    expect(
      (
        await dataset.geneExpression(
          {
            minX: micrometers(-1),
            maxX: micrometers(11),
            minY: micrometers(-1),
            maxY: micrometers(11),
          },
          ['Gapdh'],
        )
      ).elements.map((element) => [element.id, element.count]),
    ).toEqual([
      ['cell-b', 0],
      ['cell-d', 8],
    ])
    // Plot values by the section's own rows.
    await expect(dataset.geneValuesRowIds()).resolves.toEqual(['cell-b', 'cell-d'])
    await expect(dataset.geneValues(['Actb'])).resolves.toEqual([
      { gene: 'Actb', rows: Uint32Array.of(0, 1), values: Float32Array.of(2, 7) },
    ])
    expect((await dataset.embeddings({ kind: 'X_pca' }))[0]?.points).toEqual([
      { id: 'cell-b', x: 0, y: 1 },
      { id: 'cell-d', x: 0, y: -1 },
    ])
    expect((await dataset.meta()).extent).toEqual({
      minX: 10,
      maxX: 10,
      minY: 0,
      maxY: 10,
    })
    expect(holdFile).toHaveBeenCalledTimes(1)
  })

  it('lets go of the file when disposed, leaving it open for its other users', async () => {
    const file = await openFile()
    const { dataset, holdFile, release } = openSection(file, 'section', 's2')

    await dataset.overview()
    dataset.dispose()

    expect(release).toHaveBeenCalledTimes(1)
    await expect(file.cellIds()).resolves.toHaveLength(4)
    // Read again, it holds the file again.
    await expect(dataset.cellIds()).resolves.toEqual(['cell-a', 'cell-c'])
    expect(holdFile).toHaveBeenCalledTimes(2)
  })

  it('reports a value the column does not hold, and lets go of the file', async () => {
    const file = await openFile()
    const { dataset, release } = openSection(file, 'section', 's9')

    await expect(dataset.overview()).rejects.toThrow(
      'obs column "section" has no cells with the value "s9".',
    )
    expect(release).toHaveBeenCalledTimes(1)
  })
})

describe('AnnData set, class and track IDs', () => {
  function memoryDataset(obs: AnnDataMemoryTable['obs']): AnnDataH5adDataset {
    return new AnnDataH5adDataset({
      url: 'memory://unique-ids',
      memorySource: {
        label: 'Memory table',
        load: async () => ({
          obsNames: ['c0', 'c1', 'c2', 'c3'],
          obs,
          varNames: ['A'],
          X: {
            kind: 'csr',
            data: new Float32Array([1]),
            indices: new Int32Array([0]),
            indptr: new Int32Array([0, 1, 1, 1, 1]),
          },
          obsm: {
            spatial: { values: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), columns: 2 },
          },
        }),
      },
    })
  }

  it('suffixes names that slug alike, and keeps the plain slug for the first', () => {
    expect(uniqueSlugIds(['a', 'b', 'a', 'a'])).toEqual(['a', 'b', 'a-2', 'a-3'])
    // `a-2` is another name's own slug, so the repeat skips it.
    expect(uniqueSlugIds(['a', 'a', 'a-2'])).toEqual(['a', 'a-3', 'a-2'])
  })

  it('gives classes, sets and tracks whose names slug alike their own IDs', async () => {
    const dataset = memoryDataset([
      {
        name: 'Cell Type',
        kind: 'categorical',
        codes: new Int8Array([0, 1, 0, 1]),
        categories: ['CD4+ T cell', 'CD4- T cell'],
      },
      {
        name: 'cell_type',
        kind: 'categorical',
        codes: new Int8Array([1, 1, 0, 0]),
        categories: ['神经元', '星形胶质细胞'],
      },
      { name: 'S_score', kind: 'numeric', values: new Float32Array([1, 2, 3, 4]) },
      { name: 'S.score', kind: 'numeric', values: new Float32Array([10, 20, 30, 40]) },
    ])

    const groups = await dataset.annotationGroups()
    expect(groups.map((group) => [group.groupingName, group.id])).toEqual([
      ['Cell Type', 'analysis:cell-type'],
      ['cell_type', 'analysis:cell-type-2'],
    ])
    await expect(dataset.annotations()).resolves.toMatchObject([
      { id: 'analysis:cell-type:cd4-t-cell', label: 'Cell Type: CD4+ T cell' },
      { id: 'analysis:cell-type:cd4-t-cell-2', label: 'Cell Type: CD4- T cell' },
      { id: 'analysis:cell-type-2:annotation', label: 'cell_type: 神经元' },
      { id: 'analysis:cell-type-2:annotation-2', label: 'cell_type: 星形胶质细胞' },
    ])
    const second = await dataset.annotations({ groupId: 'analysis:cell-type-2' })
    expect(second.map((annotation) => annotation.label)).toEqual([
      'cell_type: 神经元',
      'cell_type: 星形胶质细胞',
    ])

    const tracks = await dataset.metadataTracks()
    expect(tracks.map((track) => [track.label, track.id])).toEqual([
      ['S_score', 'h5ad:s-score'],
      ['S.score', 'h5ad:s-score-2'],
    ])
    const values = await dataset.metadataTrackValues('h5ad:s-score-2')
    expect(values.map((value) => value.value)).toEqual([10, 20, 30, 40])
  })

  // "All" read the columns the picker lists apart under "More columns", one
  // class per cell for a Census file's observation_joinid (EXP-251).
  it('leaves the columns that name cells out of All, and reads one picked by name', async () => {
    const dataset = memoryDataset([
      {
        name: 'cell_type',
        kind: 'categorical',
        codes: new Int8Array([0, 1, 0, 1]),
        categories: ['T cell', 'B cell'],
      },
      {
        name: 'observation_joinid',
        kind: 'categorical',
        codes: new Int8Array([0, 1, 2, 3]),
        categories: ['j0', 'j1', 'j2', 'j3'],
      },
      {
        name: 'barcode',
        kind: 'categorical',
        codes: new Int16Array([0, 1, 2, 3]),
        categories: Array.from({ length: 501 }, (_, index) => `b${index}`),
      },
    ])

    const groups = await dataset.annotationGroups()
    expect(groups.map((group) => group.label)).toEqual([
      'cell_type',
      'observation_joinid',
      'barcode',
    ])
    const all = await dataset.annotations()
    expect(all.map((annotation) => annotation.label)).toEqual([
      'cell_type: T cell',
      'cell_type: B cell',
    ])
    await expect(dataset.annotations({ groupId: 'all' })).resolves.toEqual(all)
    const picked = await dataset.annotations({ groupId: groups[1]!.id })
    expect(picked).toHaveLength(4)
  })
})
