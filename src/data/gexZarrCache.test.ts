import { describe, expect, it, vi } from 'vitest'
import { intToCellId } from './cellid'

const zarrMock = vi.hoisted(() => ({
  get: vi.fn(),
  open: vi.fn(),
  slice: vi.fn((start: number, end: number) => ({ end, start })),
}))

vi.mock('@zarrita/storage', () => ({
  ZipFileStore: {
    fromUrl: vi.fn((url: string) => ({ kind: 'store', url })),
  },
}))

vi.mock('zarrita', () => zarrMock)

interface MockZarrNode {
  readonly kind?: string
  readonly path: string
  readonly attrs?: Record<string, unknown>
  readonly shape?: readonly number[]
  resolve(path: string): MockZarrNode
}

function node(path: string, attrs?: Record<string, unknown>): MockZarrNode {
  return {
    path,
    ...(attrs === undefined ? {} : { attrs }),
    resolve(childPath: string) {
      return node(path.length === 0 ? childPath : `${path}/${childPath}`, attrs)
    },
  }
}

function array(path: string, shape: readonly number[] = [2]): MockZarrNode {
  return {
    path,
    shape,
    resolve(childPath: string) {
      return array(`${path}/${childPath}`)
    },
  }
}

describe('Zarr cell feature matrix cache', () => {
  it('reads the full cell_id array once per dataset URL', async () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)
    const root = node('')
    const cellFeatures = node('cell_features', {
      feature_keys: ['Actb', 'Gad1'],
      feature_types: ['Gene Expression', 'Gene Expression'],
    })

    zarrMock.open.mockImplementation(async (target: MockZarrNode) => {
      if (target.kind === 'store') {
        return root
      }

      if (target.path === 'cell_features') {
        return cellFeatures
      }

      if (target.path === 'cell_features/cell_id') {
        return array(target.path, [2, 2])
      }

      return array(target.path)
    })
    zarrMock.get.mockImplementation(async (target: MockZarrNode, ranges: unknown) => {
      if (target.path === 'cell_features/cell_id') {
        return { data: new Uint32Array([1, 1, 2, 1]) }
      }

      if (target.path === 'cell_features/csc/indptr') {
        const start = readRangeStart(ranges)

        return {
          data: start === 0 ? new Uint32Array([0, 1]) : new Uint32Array([1, 2]),
        }
      }

      if (target.path === 'cell_features/csc/indices') {
        const start = readRangeStart(ranges)

        return { data: new Uint16Array([start === 0 ? 0 : 1]) }
      }

      if (target.path === 'cell_features/csc/data') {
        const start = readRangeStart(ranges)

        return { data: new Uint32Array([start === 0 ? 5 : 7]) }
      }

      throw new Error(`Unexpected zarr.get target: ${target.path}`)
    })

    const { gexFromCellFeatureMatrixZarr } = await import('./gex')
    const url = 'https://example.test/xenium/cell_feature_matrix.zarr.zip'

    await expect(gexFromCellFeatureMatrixZarr(url, [cellA])).resolves.toMatchObject({
      geneNames: ['Actb', 'Gad1'],
    })
    await expect(gexFromCellFeatureMatrixZarr(url, [cellB])).resolves.toMatchObject({
      geneNames: ['Actb', 'Gad1'],
    })

    const cellIdReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/cell_id',
    )

    expect(cellIdReads).toHaveLength(1)
  })
})

function readRangeStart(ranges: unknown): number {
  const firstRange = Array.isArray(ranges) ? ranges[0] : null

  return isRangeLike(firstRange) ? firstRange.start : 0
}

function isRangeLike(value: unknown): value is { readonly start: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'start' in value &&
    typeof value.start === 'number'
  )
}
