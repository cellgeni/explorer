import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import {
  ANNDATA_ZARR_FIXTURE_ORIGIN,
  annDataZarrFixtureFetcher,
} from '../test/annDataZarrFixtures'
import { openAnnDataZarrStore } from './annDataZarrStore'
import { AnnDataH5adDataset } from './h5adDataset'

const OBSM_KEYS = ['X_spatial', 'spatial', 'X_umap']

describe('AnnData Zarr stores', () => {
  it('reads a store with consolidated metadata without requesting node metadata', async () => {
    const requests: string[] = []
    const progress: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      zarr: true,
      fetcher: annDataZarrFixtureFetcher({ requests }),
      onProgress: (message) => {
        progress.push(message)
      },
    })

    await expectTinyAnnData(dataset)
    await expect(embeddingKinds(dataset)).resolves.toContain('X_scvi')
    expect(
      requests.filter((request) => /\/\.z(?:array|group|attrs)$/.test(request)),
    ).toEqual([])
    expect(progress).toContain(
      'AnnData Zarr store opened from consolidated metadata: 27 groups and arrays',
    )
    expect(progress.at(-1)).toBe('AnnData Zarr store ready: 6 cells, 4 genes')
  })

  it('walks a v2 store without consolidated metadata, naming obsm from an S3 listing', async () => {
    const requests: string[] = []
    const progress: string[] = []
    const dataset = new AnnDataH5adDataset({
      url: `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      zarr: true,
      fetcher: annDataZarrFixtureFetcher({
        listing: 'virtual-hosted',
        hidden: ['/tiny.zarr/.zmetadata'],
        requests,
      }),
      onProgress: (message) => {
        progress.push(message)
      },
    })

    await expectTinyAnnData(dataset)
    await expect(embeddingKinds(dataset)).resolves.toContain('X_scvi')
    expect(requests.filter((request) => request.includes('list-type'))).toEqual([
      '/?list-type=2&delimiter=%2F&prefix=tiny.zarr%2Fobsm%2F',
    ])
    expect(progress).toContain(
      'AnnData Zarr store has no consolidated metadata; read 22 groups and arrays (obsm named by the S3 listing)',
    )
    // Groups the viewer does not read are not walked.
    expect(
      requests.filter((request) =>
        /^\/tiny\.zarr\/(?:layers|obsp|varm|varp|raw)\//.test(request),
      ),
    ).toEqual([])
    // A node's .zattrs encoding names its kind, so the other kind's metadata
    // is not requested.
    expect(requests).not.toContain('/tiny.zarr/obs/.zarray')
    expect(requests).not.toContain('/tiny.zarr/obs/score/.zgroup')
  })

  it('probes well-known obsm names when the host has no listing', async () => {
    const fetcher = annDataZarrFixtureFetcher({ hidden: ['/tiny.zarr/.zmetadata'] })
    const opened = await openAnnDataZarrStore(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      {
        fetcher,
        obsmKeys: OBSM_KEYS,
      },
    )

    expect(opened).toMatchObject({ zarrFormat: 2, metadata: 'walked', listing: null })
    expect(nodePaths(opened.store.contents(), '/obsm/')).toEqual([
      '/obsm/X_umap',
      '/obsm/spatial',
    ])

    const dataset = new AnnDataH5adDataset({
      url: `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      zarr: true,
      fetcher,
    })

    await expectTinyAnnData(dataset)
    await expect(embeddingKinds(dataset)).resolves.not.toContain('X_scvi')
  })

  it('walks a v3 store with a CSR X', async () => {
    const dataset = new AnnDataH5adDataset({
      url: `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.v3.zarr`,
      zarr: true,
      fetcher: annDataZarrFixtureFetcher({ listing: 'virtual-hosted' }),
    })

    await expectTinyAnnData(dataset)
    await expect(embeddingKinds(dataset)).resolves.toContain('X_scvi')
  })

  it('lists a path-style S3 bucket', async () => {
    const requests: string[] = []
    const opened = await openAnnDataZarrStore(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/bucket/tiny.v3.zarr`,
      {
        fetcher: annDataZarrFixtureFetcher({ listing: 'path-style', requests }),
        obsmKeys: OBSM_KEYS,
      },
    )

    expect(opened).toMatchObject({
      zarrFormat: 3,
      metadata: 'walked',
      listing: 'S3 listing',
    })
    expect(nodePaths(opened.store.contents(), '/obsm/')).toEqual([
      '/obsm/X_scvi',
      '/obsm/X_umap',
      '/obsm/spatial',
    ])
    expect(requests.filter((request) => request.includes('list-type'))).toEqual([
      '/?list-type=2&delimiter=%2F&prefix=bucket%2Ftiny.v3.zarr%2Fobsm%2F',
      '/bucket?list-type=2&delimiter=%2F&prefix=tiny.v3.zarr%2Fobsm%2F',
    ])
  })

  it('lists folders from index pages', async () => {
    const opened = await openAnnDataZarrStore(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      {
        fetcher: annDataZarrFixtureFetcher({
          listing: 'index page',
          hidden: ['/tiny.zarr/.zmetadata'],
        }),
        obsmKeys: OBSM_KEYS,
      },
    )

    expect(opened).toMatchObject({ metadata: 'walked', listing: 'index page' })
    expect(nodePaths(opened.store.contents(), '/obsm/')).toEqual([
      '/obsm/X_scvi',
      '/obsm/X_umap',
      '/obsm/spatial',
    ])
  })

  it('reports a URL that holds no Zarr group', async () => {
    await expect(
      openAnnDataZarrStore(`${ANNDATA_ZARR_FIXTURE_ORIGIN}/missing.zarr`, {
        fetcher: annDataZarrFixtureFetcher(),
      }),
    ).rejects.toThrow(
      `No Zarr group was found at ${ANNDATA_ZARR_FIXTURE_ORIGIN}/missing.zarr (no zarr.json or .zgroup).`,
    )
  })
})

async function expectTinyAnnData(dataset: AnnDataH5adDataset): Promise<void> {
  await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1', 'Gapdh', 'Sst'])
  // URL resolution would trim the column name's trailing spaces.
  await expect(dataset.annotationGroups()).resolves.toEqual([
    {
      id: 'analysis:cluster',
      label: 'cluster',
      groupingName: 'cluster',
      groupCount: 2,
    },
    {
      id: 'analysis:stage',
      label: 'stage  ',
      groupingName: 'stage  ',
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
  const matrix = await dataset.matrix(['cell-d'])
  expect(matrix.cells.get('cell-d')).toEqual({
    geneNames: ['Actb', 'Gapdh'],
    counts: [7, 8],
  })
}

async function embeddingKinds(dataset: AnnDataH5adDataset): Promise<string[]> {
  return (await dataset.embeddingOptions()).map((option) => option.kind)
}

function nodePaths(
  nodes: readonly { readonly path: string }[],
  prefix: string,
): string[] {
  return nodes
    .map((node) => node.path)
    .filter((path) => path.startsWith(prefix))
    .sort()
}
