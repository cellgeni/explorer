import { describe, expect, it } from 'vitest'
import type { H5Structure } from '../../data/h5Structure'
import {
  H5T_CLASS,
  type H5DatasetInfo,
  type H5Dtype,
  type H5StructureNode,
} from '../../data/h5StructureTypes'
import {
  formatH5Value,
  h5Conventions,
  h5DtypeLabel,
  h5FilterLabel,
  h5MaxShapeLabel,
  h5NodeRole,
  h5PreviewReadBound,
  h5PreviewUnavailable,
  isH5Url,
} from './h5StructureModel'

const dtype = (overrides: Partial<H5Dtype>): H5Dtype => ({
  typeClass: H5T_CLASS.INTEGER,
  size: 4,
  signed: true,
  littleEndian: true,
  vlen: false,
  ...overrides,
})

const BOOL = dtype({
  typeClass: H5T_CLASS.ENUM,
  size: 1,
  enumMembers: [
    ['FALSE', 0],
    ['TRUE', 1],
  ],
})

const dataset = (overrides: Partial<H5DatasetInfo>): H5DatasetInfo => ({
  shape: [1000],
  maxShape: [1000],
  chunks: null,
  dtype: dtype({ typeClass: H5T_CLASS.FLOAT }),
  filters: [],
  ...overrides,
})

const node = (overrides: Partial<H5StructureNode>): H5StructureNode => ({
  path: 'a',
  name: 'a',
  kind: 'group',
  attributes: {},
  skippedAttributes: [],
  children: [],
  ...overrides,
})

describe('isH5Url', () => {
  it('matches HDF5 file names', () => {
    expect(isH5Url('https://bucket.test/run/sample.h5ad')).toBe(true)
    expect(isH5Url(' https://bucket.test/outs/cell_feature_matrix.h5?x=1 ')).toBe(true)
    expect(isH5Url('https://bucket.test/a.loom')).toBe(true)
    expect(isH5Url('https://bucket.test/a.h5ad.icechunk')).toBe(false)
    expect(isH5Url('https://bucket.test/a.zarr')).toBe(false)
    expect(isH5Url('sample.h5ad')).toBe(false)
  })
})

describe('h5DtypeLabel', () => {
  it('names types as numpy does', () => {
    expect(h5DtypeLabel(dtype({}))).toBe('int32')
    expect(h5DtypeLabel(dtype({ signed: false, size: 8 }))).toBe('uint64')
    expect(h5DtypeLabel(dtype({ typeClass: H5T_CLASS.FLOAT, size: 8 }))).toBe('float64')
    expect(h5DtypeLabel(BOOL)).toBe('bool')
    expect(
      h5DtypeLabel(dtype({ typeClass: H5T_CLASS.STRING, vlen: true, cset: 1 })),
    ).toBe('string (UTF-8, variable length)')
    expect(h5DtypeLabel(dtype({ typeClass: H5T_CLASS.STRING, size: 12, cset: 0 }))).toBe(
      'string (ASCII, 12 bytes)',
    )
    expect(
      h5DtypeLabel(
        dtype({
          typeClass: H5T_CLASS.COMPOUND,
          members: [
            { name: 'x', dtype: dtype({}) },
            { name: 'y', dtype: dtype({ typeClass: H5T_CLASS.FLOAT, size: 8 }) },
          ],
        }),
      ),
    ).toBe('compound {x: int32, y: float64}')
    expect(
      h5DtypeLabel(
        dtype({
          typeClass: H5T_CLASS.ARRAY,
          base: dtype({ typeClass: H5T_CLASS.FLOAT }),
          arrayShape: [3, 3],
        }),
      ),
    ).toBe('float32[3 × 3]')
    expect(
      h5DtypeLabel(dtype({ typeClass: H5T_CLASS.REFERENCE, refType: 'object' })),
    ).toBe('object reference')
  })
})

describe('h5FilterLabel', () => {
  it('names built-in filters and marks plugins', () => {
    expect(h5FilterLabel({ id: 1, name: 'deflate', values: [4] })).toBe('gzip (level 4)')
    expect(h5FilterLabel({ id: 2, name: 'shuffle', values: [] })).toBe('shuffle')
    expect(h5FilterLabel({ id: 32000, name: 'lzf', values: [] })).toBe(
      'LZF (plugin 32000)',
    )
    expect(h5FilterLabel({ id: 40000, name: '', values: [] })).toBe(
      'filter 40000 (plugin 40000)',
    )
  })
})

describe('h5MaxShapeLabel', () => {
  it('shows a max shape only when it differs', () => {
    expect(h5MaxShapeLabel(dataset({}))).toBeNull()
    expect(h5MaxShapeLabel(dataset({ maxShape: [null] }))).toBe('unlimited')
  })
})

describe('h5PreviewReadBound', () => {
  it('counts the chunks a preview touches', () => {
    // 100 rows of 4 bytes fall in the first chunk of 256.
    expect(h5PreviewReadBound(dataset({ chunks: [256] }))).toBe(1024)
    // A 2D block of 100 × 20 touches 2 × 1 chunks of 64 × 64.
    expect(
      h5PreviewReadBound(
        dataset({ shape: [1000, 1000], maxShape: [1000, 1000], chunks: [64, 64] }),
      ),
    ).toBe(2 * 64 * 64 * 4)
  })

  it('spans a contiguous dataset from its start to the block’s last element', () => {
    expect(h5PreviewReadBound(dataset({}))).toBe(400)
    // Rows 0 to 99, columns 0 to 19, of rows 30,000 wide.
    expect(
      h5PreviewReadBound(dataset({ shape: [1000, 30_000], maxShape: [1000, 30_000] })),
    ).toBe((99 * 30_000 + 20) * 4)
  })
})

describe('h5PreviewUnavailable', () => {
  it('explains datasets whose values cannot be read here', () => {
    expect(h5PreviewUnavailable(dataset({}))).toBeNull()
    expect(h5PreviewUnavailable(dataset({ shape: null }))).toMatch(/no dataspace/)
    expect(
      h5PreviewUnavailable(
        dataset({ filters: [{ id: 32001, name: 'blosc', values: [] }] }),
      ),
    ).toMatch(/Blosc \(plugin 32001\)/)
    expect(
      h5PreviewUnavailable(
        dataset({ dtype: dtype({ typeClass: H5T_CLASS.STRING, vlen: true }) }),
      ),
    ).toBeNull()
    expect(
      h5PreviewUnavailable(
        dataset({
          shape: [20_000],
          dtype: dtype({ typeClass: H5T_CLASS.VLEN, vlen: true, base: dtype({}) }),
        }),
      ),
    ).toMatch(/too large/)
  })
})

describe('formatH5Value', () => {
  it('shows booleans, enums, compounds and big integers', () => {
    expect(formatH5Value(1, BOOL)).toBe('True')
    expect(
      formatH5Value(
        2,
        dtype({
          typeClass: H5T_CLASS.ENUM,
          enumMembers: [
            ['a', 1],
            ['b', 2],
          ],
        }),
      ),
    ).toBe('b')
    expect(
      formatH5Value(
        [1, 2.5],
        dtype({
          typeClass: H5T_CLASS.COMPOUND,
          members: [
            { name: 'x', dtype: dtype({}) },
            { name: 'y', dtype: dtype({ typeClass: H5T_CLASS.FLOAT }) },
          ],
        }),
      ),
    ).toBe('{x: 1, y: 2.5}')
    const float32 = dtype({ typeClass: H5T_CLASS.FLOAT })
    expect(formatH5Value(Math.fround(0.98354566), float32)).toBe('0.98354566')
    expect(formatH5Value(Math.fround(0.1), float32)).toBe('0.1')
    expect(formatH5Value(0.1, dtype({ typeClass: H5T_CLASS.FLOAT, size: 8 }))).toBe('0.1')
    expect(formatH5Value(12345678901234567890n, dtype({ size: 8 }))).toBe(
      '12345678901234567890',
    )
    expect(
      formatH5Value('x'.repeat(300), dtype({ typeClass: H5T_CLASS.STRING })),
    ).toHaveLength(201)
  })
})

describe('h5NodeRole and h5Conventions', () => {
  it('recognises AnnData, 10x and Loom files', () => {
    expect(h5NodeRole(node({ attributes: { 'encoding-type': 'csr_matrix' } }))).toBe(
      'CSR matrix',
    )
    expect(h5NodeRole(node({ attributes: { h5sparse_format: 'csc' } }))).toBe(
      'CSC matrix',
    )

    const matrix = node({
      path: 'matrix',
      name: 'matrix',
      children: ['barcodes', 'data', 'indices', 'indptr'].map((name) =>
        node({ path: `matrix/${name}`, name, kind: 'dataset' }),
      ),
    })
    expect(h5NodeRole(matrix)).toBe('10x matrix')

    const structureOf = (root: H5StructureNode) => ({ root }) as unknown as H5Structure
    expect(
      h5Conventions(
        structureOf(
          node({
            path: '',
            attributes: { 'encoding-type': 'anndata', 'encoding-version': '0.1.0' },
          }),
        ),
      ),
    ).toEqual(['AnnData (encoding 0.1.0)'])
    expect(
      h5Conventions(
        structureOf(
          node({
            path: '',
            attributes: { software_version: 'xenium-3.0' },
            children: [matrix],
          }),
        ),
      ),
    ).toEqual(['10x feature-barcode matrix (xenium-3.0)'])
    expect(
      h5Conventions(
        structureOf(
          node({
            path: '',
            children: [
              node({ path: 'matrix', name: 'matrix', kind: 'dataset' }),
              node({ path: 'row_attrs', name: 'row_attrs' }),
              node({ path: 'col_attrs', name: 'col_attrs' }),
            ],
          }),
        ),
      ),
    ).toEqual(['Loom'])
  })
})
