import { describe, expect, it } from 'vitest'
import { structureFromFlatNodes, type ZarrStructure } from '../../zarr/zarrStructure'
import {
  formatBytes,
  formatShape,
  isZarrStoreUrl,
  nodeRole,
  nodeSummary,
  nodeUrl,
  parquetFileOf,
  parquetNote,
  structureNotes,
} from './storeStructureModel'
import { filterStructure, findNode } from './structureTree'

function structure(
  flat: Parameters<typeof structureFromFlatNodes>[0]['flat'],
  overrides: Partial<Parameters<typeof structureFromFlatNodes>[0]> = {},
): ZarrStructure {
  return structureFromFlatNodes({
    url: 'https://bucket.test/sample.zarr',
    source: 'consolidated',
    zarrFormat: 2,
    listing: null,
    flat,
    truncated: false,
    ...overrides,
  })
}

describe('store structure model', () => {
  it('recognises Zarr store, zip and Icechunk addresses', () => {
    for (const url of [
      'https://bucket.test/sample.zarr',
      'https://bucket.test/sample.ome.zarr/',
      'https://bucket.test/sample.zarr/images/he',
      'https://bucket.test/store/zarr.json',
      'https://bucket.test/store/.zattrs',
      'https://bucket.test/store/.zgroup',
      'https://bucket.test/store/.zmetadata',
      'https://bucket.test/sample.zarr.zip',
      'https://bucket.test/sample.icechunk/',
      '  https://bucket.test/sample.zarr  ',
    ]) {
      expect(isZarrStoreUrl(url), url).toBe(true)
    }

    for (const url of [
      '',
      'not a url',
      'https://bucket.test/run/',
      'https://bucket.test/sample.h5ad',
      'https://bucket.test/sample.zarr/cells.parquet',
      'https://bucket.test/image.ome.tif',
    ]) {
      expect(isZarrStoreUrl(url), url).toBe(false)
    }
  })

  it('formats shapes and sizes', () => {
    expect(formatShape([])).toBe('scalar')
    expect(formatShape([3, 21_571, 19_505])).toBe('3 × 21,571 × 19,505')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1_260_000_000)).toBe('1.26 GB')
  })

  it("names a node's role from its attributes", () => {
    const tree = structure([
      { path: '', kind: 'group', attributes: { spatialdata_attrs: { version: '0.1' } } },
      {
        path: 'tables/table/obs/cell_type',
        kind: 'group',
        attributes: { 'encoding-type': 'categorical' },
      },
      {
        path: 'images/he',
        kind: 'group',
        attributes: { multiscales: [{ datasets: [{ path: '0' }, { path: '1' }] }] },
      },
      {
        path: 'labels/cells',
        kind: 'group',
        attributes: {
          ome: { multiscales: [{ datasets: [{ path: '0' }] }], 'image-label': {} },
        },
      },
      {
        path: 'shapes/cells',
        kind: 'group',
        attributes: { 'encoding-type': 'ngff:shapes' },
      },
      { path: 'plain', kind: 'group' },
    ])
    const find = (path: string) => findNode(tree.root, path)
    const role = (path: string) => {
      const node = find(path)
      return node === undefined ? undefined : nodeRole(node)
    }

    expect(nodeRole(tree.root)).toBe('SpatialData')
    expect(role('tables/table/obs/cell_type')).toBe('categorical')
    expect(role('images/he')).toBe('image, 2 levels')
    expect(role('labels/cells')).toBe('label image, 1 level')
    expect(role('shapes/cells')).toBe('SpatialData shapes')
    expect(role('plain')).toBeNull()

    const shapes = find('shapes/cells')
    expect(shapes === undefined ? null : parquetNote(shapes)).toContain('shapes.parquet')
    expect(shapes === undefined ? null : nodeSummary(shapes)).toBe('')
    expect(nodeSummary(find('plain') ?? tree.root)).toBe('empty')
  })

  it('filters by name or path, keeping and opening the ancestors of matches', () => {
    const tree = structure([
      { path: '', kind: 'group' },
      { path: 'obs', kind: 'group' },
      { path: 'obs/cluster', kind: 'group' },
      { path: 'obs/cluster/codes', kind: 'array' },
      { path: 'var', kind: 'group' },
      { path: 'var/_index', kind: 'array' },
    ])

    expect(filterStructure(tree.root, '  ')).toBeNull()
    expect(filterStructure(tree.root, 'CODES')).toEqual({
      visible: new Set(['obs/cluster/codes', 'obs/cluster', 'obs', '']),
      expanded: new Set(['obs/cluster', 'obs', '']),
      matchCount: 1,
    })
    // Below a match, everything shows; only ancestors open.
    expect(filterStructure(tree.root, 'cluster')).toEqual({
      visible: new Set(['obs/cluster/codes', 'obs/cluster', 'obs', '']),
      expanded: new Set(['obs', '']),
      matchCount: 1,
    })
    expect(filterStructure(tree.root, 'nothing')?.matchCount).toBe(0)
    // With a '/', the whole path is matched.
    expect(filterStructure(tree.root, 's/cl')?.matchCount).toBe(2)
    // As the details show it, with a leading '/'.
    expect(filterStructure(tree.root, '/obs/cluster')?.visible).toEqual(
      new Set(['obs/cluster/codes', 'obs/cluster', 'obs', '']),
    )
    // As the Parquet details show a nested field: a dotted path.
    expect(filterStructure(tree.root, 'cluster.codes')?.matchCount).toBe(1)
    expect(filterStructure(tree.root, 'nothing.here')?.matchCount).toBe(0)
  })

  it('gives nodes of HTTP stores an address of their own', () => {
    const tree = structure([
      { path: '', kind: 'group' },
      { path: 'obs/stage  ', kind: 'group' },
    ])
    const stage = tree.root.children[0]?.children[0]

    expect(stage === undefined ? null : nodeUrl(tree, stage)).toBe(
      'https://bucket.test/sample.zarr/obs/stage%20%20',
    )
    expect(nodeUrl(tree, tree.root)).toBe('https://bucket.test/sample.zarr')
    expect(nodeUrl({ ...tree, source: 'zip' }, tree.root)).toBeNull()
  })

  it('finds the Parquet files Browse File can open', () => {
    const shapes = { 'encoding-type': 'ngff:shapes' }
    const consolidated = structure([
      { path: '', kind: 'group' },
      { path: 'shapes/cells', kind: 'group', attributes: shapes },
      {
        path: 'points/tx',
        kind: 'group',
        attributes: { 'encoding-type': 'ngff:points' },
      },
    ])
    const of = (tree: ZarrStructure, path: string) => {
      const node = findNode(tree.root, path)
      return node === undefined ? undefined : parquetFileOf(tree, node)
    }

    // Unlisted, but where SpatialData writes it.
    expect(of(consolidated, 'shapes/cells')).toEqual({
      url: 'https://bucket.test/sample.zarr/shapes/cells/shapes.parquet',
    })
    // Before a query that grants the store.
    expect(
      of(
        { ...consolidated, url: 'https://bucket.test/sample.zarr?token=abc' },
        'shapes/cells',
      ),
    ).toEqual({
      url: 'https://bucket.test/sample.zarr/shapes/cells/shapes.parquet?token=abc',
    })
    // Points are a folder of parts.
    expect(of(consolidated, 'points/tx')).toBeNull()
    expect(of({ ...consolidated, source: 'icechunk' }, 'shapes/cells')).toBeNull()

    const listed = [
      { path: '', kind: 'group' },
      { path: 'shapes/cells', kind: 'group', attributes: shapes },
      { path: 'shapes/cells/shapes.parquet', kind: 'file' },
      { path: 'points/tx/points.parquet/part.0.parquet', kind: 'file' },
      { path: 'notes.txt', kind: 'file' },
    ] as const
    const walked = structure([...listed], { source: 'walked' })
    const zipped = structure([...listed], {
      source: 'zip',
      url: 'https://bucket.test/sample.zarr.zip',
    })

    expect(of(walked, 'shapes/cells')).toBeNull()
    expect(of(walked, 'shapes/cells/shapes.parquet')).toEqual({
      url: 'https://bucket.test/sample.zarr/shapes/cells/shapes.parquet',
    })
    expect(of(walked, 'points/tx/points.parquet/part.0.parquet')).toEqual({
      url: 'https://bucket.test/sample.zarr/points/tx/points.parquet/part.0.parquet',
    })
    expect(of(walked, 'notes.txt')).toBeNull()
    expect(of(zipped, 'shapes/cells/shapes.parquet')).toEqual({
      url: 'https://bucket.test/sample.zarr.zip',
      zipPath: 'shapes/cells/shapes.parquet',
    })
  })

  it('says when the tree may be incomplete', () => {
    expect(structureNotes(structure([{ path: '', kind: 'group' }]))).toEqual([])
    expect(
      structureNotes(
        structure([{ path: '', kind: 'group', unlisted: true }], {
          source: 'walked',
          truncated: true,
        }),
      ),
    ).toEqual([
      'Stopped after 1 node; the store holds more.',
      expect.stringContaining('the host does not list folders'),
    ])
  })
})
