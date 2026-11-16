import { describe, expect, it } from 'vitest'
import {
  ANNDATA_ZARR_FIXTURE_ORIGIN,
  annDataZarrFixtureFetcher,
} from '../test/annDataZarrFixtures'
import { ICECHUNK_FIXTURE_ORIGIN, icechunkFixtureFetcher } from '../test/icechunkFixtures'
import { byteRangeFetcher, zipArchive } from '../test/zipFixtures'
import {
  readZarrStructure,
  summarizeZarrArray,
  ZarrStructureNotFoundError,
  zarrStoreRootUrl,
  type ZarrStructureNode,
} from './zarrStructure'

const encoder = new TextEncoder()
const STORE_ORIGIN = 'https://store.test'

// Every node's path and kind, depth first, as `obs/cluster (group)`.
function outline(node: ZarrStructureNode): string[] {
  return [
    `${node.path === '' ? '/' : node.path} (${node.kind}${node.unlisted === true ? ', unlisted' : ''}${node.implicit === true ? ', implicit' : ''})`,
    ...node.children.flatMap(outline),
  ]
}

function find(node: ZarrStructureNode, path: string): ZarrStructureNode | undefined {
  if (node.path === path) return node

  for (const child of node.children) {
    const found = find(child, path)
    if (found !== undefined) return found
  }

  return undefined
}

// Serves JSON documents by path at https://store.test, 404 otherwise.
function jsonFetcher(
  files: Readonly<Record<string, unknown>>,
  requests: string[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    requests.push(`${url.pathname}${url.search}`)
    const file = files[url.pathname]
    return file === undefined
      ? new Response(null, { status: 404 })
      : new Response(JSON.stringify(file))
  }) as typeof fetch
}

describe('Zarr store structure', () => {
  it('finds the store root of metadata file and folder URLs', () => {
    expect(zarrStoreRootUrl('https://x.test/a.zarr/')).toBe('https://x.test/a.zarr')
    expect(zarrStoreRootUrl('https://x.test/a.zarr/zarr.json#z=2')).toBe(
      'https://x.test/a.zarr',
    )
    expect(zarrStoreRootUrl('https://x.test/a.zarr/.zattrs?token=1')).toBe(
      'https://x.test/a.zarr?token=1',
    )
    expect(zarrStoreRootUrl('https://x.test/a.zarr/images/he')).toBe(
      'https://x.test/a.zarr/images/he',
    )
  })

  it('lists every node of a store with consolidated metadata', async () => {
    const requests: string[] = []
    const structure = await readZarrStructure(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      { fetcher: annDataZarrFixtureFetcher({ requests }) },
    )

    expect(structure).toMatchObject({
      url: `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      source: 'consolidated',
      zarrFormat: 2,
      listing: null,
      groupCount: 13,
      arrayCount: 14,
      fileCount: 0,
      truncated: false,
      conventions: ['AnnData 0.1.0'],
    })
    // Groups first, then arrays, by name; a column name keeps its spaces.
    expect(find(structure.root, 'obs')?.children.map((child) => child.name)).toEqual([
      '_index',
      'cluster',
      'stage  ',
      'score',
    ])
    expect(find(structure.root, 'obs/cluster')?.attributes).toMatchObject({
      'encoding-type': 'categorical',
    })
    expect(find(structure.root, 'X')?.array).toEqual({
      shape: [6, 4],
      chunks: [6, 2],
      dtype: 'float32',
      codecs: ['blosc(cname=lz4, clevel=5, shuffle=1, blocksize=0)'],
      fillValue: 0,
      order: 'C',
      chunkCount: 2,
      decodedBytes: 96,
    })
    // The consolidated metadata alone, with no request per node.
    expect(requests.filter((request) => !request.endsWith('zmetadata'))).toEqual([
      '/tiny.zarr/zarr.json',
    ])
  })

  it('walks a store without consolidated metadata through the groups its attributes name', async () => {
    const progress: number[] = []
    const structure = await readZarrStructure(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr/`,
      {
        fetcher: annDataZarrFixtureFetcher({
          hidden: ['/tiny.zarr/.zmetadata'],
          missingStatus: 403,
        }),
        onProgress: (count) => progress.push(count),
      },
    )

    expect(structure).toMatchObject({
      source: 'walked',
      zarrFormat: 2,
      listing: null,
      truncated: false,
    })
    // Dataframe columns, categoricals and nullable arrays are named by their
    // attributes; obsm keys are probed by name; dicts stay unlisted.
    expect(outline(structure.root)).toEqual([
      '/ (group)',
      'layers (group, unlisted)',
      'obs (group)',
      'obs/_index (group)',
      'obs/_index/mask (array)',
      'obs/_index/values (array)',
      'obs/cluster (group)',
      'obs/cluster/categories (array)',
      'obs/cluster/codes (array)',
      'obs/stage   (group)',
      'obs/stage  /categories (array)',
      'obs/stage  /codes (array)',
      'obs/score (array)',
      'obsm (group, unlisted)',
      'obsm/spatial (array)',
      'obsm/X_umap (array)',
      'obsp (group, unlisted)',
      'uns (group, unlisted)',
      'var (group)',
      'var/_index (group)',
      'var/_index/mask (array)',
      'var/_index/values (array)',
      'varm (group, unlisted)',
      'varp (group, unlisted)',
      'raw (array)',
      'X (array)',
    ])
    expect(progress.at(-1)).toBeGreaterThanOrEqual(26)
  })

  it('names every group child from an S3 listing', async () => {
    const structure = await readZarrStructure(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      {
        fetcher: annDataZarrFixtureFetcher({
          hidden: ['/tiny.zarr/.zmetadata'],
          listing: 'virtual-hosted',
        }),
      },
    )

    expect(structure).toMatchObject({
      source: 'walked',
      listing: 'S3 listing',
      groupCount: 13,
      arrayCount: 14,
    })
    expect(outline(structure.root).filter((line) => line.includes('unlisted'))).toEqual(
      [],
    )
    expect(find(structure.root, 'obsm')?.children.map((child) => child.name)).toEqual([
      'spatial',
      'X_scvi',
      'X_umap',
    ])
  })

  it('walks a v3 store', async () => {
    const structure = await readZarrStructure(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.v3.zarr`,
      { fetcher: annDataZarrFixtureFetcher() },
    )

    expect(structure).toMatchObject({ source: 'walked', zarrFormat: 3 })
    expect(find(structure.root, 'X')?.children.map((child) => child.name)).toEqual([
      'data',
      'indices',
      'indptr',
    ])
    expect(find(structure.root, 'X/data')?.array).toMatchObject({
      dtype: 'float32',
      shape: [expect.any(Number)],
    })
    // Attributes are kept apart from the rest of zarr.json.
    expect(find(structure.root, 'X')?.metadata).not.toHaveProperty('attributes')
  })

  it('follows OME-NGFF multiscales, labels and bioformats2raw series', async () => {
    const array = (shape: number[]) => ({
      zarr_format: 2,
      shape,
      chunks: shape,
      dtype: '|u1',
      compressor: null,
      fill_value: 0,
      order: 'C',
      filters: null,
    })
    const multiscales = (paths: string[]) => ({
      multiscales: [{ version: '0.4', datasets: paths.map((path) => ({ path })) }],
    })
    const structure = await readZarrStructure(`${STORE_ORIGIN}/series.zarr`, {
      fetcher: jsonFetcher({
        '/series.zarr/.zgroup': { zarr_format: 2 },
        '/series.zarr/.zattrs': { 'bioformats2raw.layout': 3 },
        '/series.zarr/OME/.zgroup': { zarr_format: 2 },
        '/series.zarr/OME/.zattrs': { series: ['0'] },
        '/series.zarr/0/.zgroup': { zarr_format: 2 },
        '/series.zarr/0/.zattrs': multiscales(['0', '1']),
        '/series.zarr/0/0/.zarray': array([1, 64, 64]),
        '/series.zarr/0/1/.zarray': array([1, 32, 32]),
        '/series.zarr/0/labels/.zgroup': { zarr_format: 2 },
        '/series.zarr/0/labels/.zattrs': { labels: ['cells'] },
        '/series.zarr/0/labels/cells/.zgroup': { zarr_format: 2 },
        '/series.zarr/0/labels/cells/.zattrs': multiscales(['0']),
        '/series.zarr/0/labels/cells/0/.zarray': array([64, 64]),
      }),
    })

    expect(structure.conventions).toEqual(['bioformats2raw'])
    expect(outline(structure.root)).toEqual([
      '/ (group)',
      '0 (group)',
      '0/labels (group)',
      '0/labels/cells (group)',
      '0/labels/cells/0 (array)',
      '0/0 (array)',
      '0/1 (array)',
      'OME (group, unlisted)',
    ])
  })

  it('stops a walk at the node limit', async () => {
    const structure = await readZarrStructure(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      {
        fetcher: annDataZarrFixtureFetcher({ hidden: ['/tiny.zarr/.zmetadata'] }),
        maxNodes: 5,
      },
    )

    expect(structure.truncated).toBe(true)
    expect(structure.groupCount + structure.arrayCount).toBeLessThanOrEqual(5)
  })

  it('says when no Zarr metadata is at the URL', async () => {
    await expect(
      readZarrStructure(`${STORE_ORIGIN}/missing.zarr`, { fetcher: jsonFetcher({}) }),
    ).rejects.toBeInstanceOf(ZarrStructureNotFoundError)
  })

  it('reads a zip: metadata from its files, chunk sizes, and other files', async () => {
    const url = `${STORE_ORIGIN}/structure/sample.zarr.zip`
    const json = (value: unknown) => encoder.encode(JSON.stringify(value))
    const fetcher = byteRangeFetcher(
      new Map([
        [
          url,
          zipArchive([
            { name: 'sample.zarr/.zgroup', data: json({ zarr_format: 2 }) },
            {
              name: 'sample.zarr/.zattrs',
              data: json({ spatialdata_attrs: { version: '0.1' } }),
            },
            { name: 'sample.zarr/shapes/.zgroup', data: json({ zarr_format: 2 }) },
            {
              name: 'sample.zarr/shapes/cells/.zgroup',
              data: json({ zarr_format: 2 }),
              deflate: true,
            },
            {
              name: 'sample.zarr/shapes/cells/.zattrs',
              data: json({ 'encoding-type': 'ngff:shapes' }),
            },
            {
              name: 'sample.zarr/shapes/cells/shapes.parquet',
              data: new Uint8Array(300),
              deflate: true,
            },
            {
              name: 'sample.zarr/labels/seg/0/.zarray',
              data: json({
                zarr_format: 2,
                shape: [4, 4],
                chunks: [2, 4],
                dtype: '<u4',
                compressor: { id: 'zstd', level: 3 },
                filters: null,
                fill_value: 0,
                order: 'C',
              }),
            },
            { name: 'sample.zarr/labels/seg/0/0.0', data: new Uint8Array(10) },
            { name: 'sample.zarr/labels/seg/0/1.0', data: new Uint8Array(12) },
          ]),
        ],
      ]),
    )
    const structure = await readZarrStructure(url, { fetcher })

    expect(structure).toMatchObject({
      source: 'zip',
      zarrFormat: 2,
      conventions: ['SpatialData 0.1'],
      fileCount: 1,
      zip: { fileCount: 9, root: 'sample.zarr/' },
    })
    expect(outline(structure.root)).toEqual([
      '/ (group)',
      'labels (group, implicit)',
      'labels/seg (group, implicit)',
      'labels/seg/0 (array)',
      'shapes (group)',
      'shapes/cells (group)',
      'shapes/cells/shapes.parquet (file)',
    ])
    expect(find(structure.root, 'labels/seg/0')).toMatchObject({
      storedBytes: 22,
      storedChunks: 2,
      array: { dtype: 'uint32', codecs: ['zstd(level=3)'], chunkCount: 2 },
    })
    expect(find(structure.root, 'shapes/cells/shapes.parquet')).toMatchObject({
      storedBytes: 300,
      deflated: true,
    })
    expect(find(structure.root, 'labels/seg/0')).not.toHaveProperty('deflated')
  })

  it('lists an Icechunk snapshot', async () => {
    const structure = await readZarrStructure(
      `${ICECHUNK_FIXTURE_ORIGIN}/anndata.icechunk`,
      { fetcher: icechunkFixtureFetcher() },
    )

    expect(structure).toMatchObject({
      source: 'icechunk',
      zarrFormat: 3,
      conventions: [expect.stringMatching(/^AnnData/)],
    })
    expect(find(structure.root, 'obs/cluster/codes')?.kind).toBe('array')
  })

  it('summarizes sharded v3 arrays and variable-length strings', () => {
    expect(
      summarizeZarrArray({
        zarr_format: 3,
        node_type: 'array',
        shape: [100, 1000],
        data_type: 'uint16',
        chunk_grid: { name: 'regular', configuration: { chunk_shape: [100, 500] } },
        dimension_names: ['y', null],
        fill_value: 0,
        codecs: [
          {
            name: 'sharding_indexed',
            configuration: {
              chunk_shape: [10, 50],
              codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
              index_codecs: [{ name: 'crc32c' }],
              index_location: 'end',
            },
          },
        ],
      }),
    ).toEqual({
      shape: [100, 1000],
      chunks: [100, 500],
      innerChunks: [10, 50],
      dtype: 'uint16',
      dimensionNames: ['y', null],
      codecs: ['sharding_indexed(chunk_shape=[10, 50], index_location=end)'],
      innerCodecs: ['bytes(endian=little)'],
      fillValue: 0,
      chunkCount: 2,
      decodedBytes: 200_000,
    })
    const strings = summarizeZarrArray({
      zarr_format: 2,
      shape: [3],
      chunks: [3],
      dtype: '|O',
      filters: [{ id: 'vlen-utf8' }],
      compressor: null,
      fill_value: null,
    })

    expect(strings).toMatchObject({
      dtype: 'string (variable length)',
      codecs: ['vlen-utf8'],
    })
    expect(strings).not.toHaveProperty('decodedBytes')
    expect(
      summarizeZarrArray({ zarr_format: 2, shape: [2], dtype: '<U5' }),
    ).toMatchObject({ dtype: 'string (5 characters)', decodedBytes: 40 })
  })
})
