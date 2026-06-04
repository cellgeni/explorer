import { beforeEach, describe, expect, it, vi } from 'vitest'
import { intToCellId } from './cellid'

const zarrMock = vi.hoisted(() => ({
  get: vi.fn(),
  open: vi.fn(),
  slice: vi.fn((start: number, end: number) => ({ end, start })),
}))

const storageMock = vi.hoisted(() => ({
  ZipFileStore: vi
    .fn()
    .mockImplementation(function MockZipFileStore(reader: { readonly url: string }) {
      return {
        kind: 'store',
        reader,
        url: reader.url,
      }
    }),
}))

vi.mock('@zarrita/storage', () => ({
  ZipFileStore: storageMock.ZipFileStore,
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
  beforeEach(() => {
    zarrMock.get.mockReset()
    zarrMock.open.mockReset()
    zarrMock.slice.mockClear()
    storageMock.ZipFileStore.mockClear()
  })

  it('reads the full cell_id array once per dataset URL', async () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)

    setupZarrMatrixMock({
      cellIdPairs: new Uint32Array([1, 1, 2, 1]),
      indptr: new Uint32Array([0, 1, 2]),
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
    const indptrReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/csc/indptr',
    )

    expect(cellIdReads).toHaveLength(1)
    expect(indptrReads).toHaveLength(2)
  })

  it('fetches sparse data ranges for target cells instead of the full row span', async () => {
    const cellA = intToCellId(10, 1)
    const cellB = intToCellId(20, 1)

    setupZarrMatrixMock({
      cellIdPairs: new Uint32Array([10, 1, 99, 1, 20, 1]),
      indptr: new Uint32Array([0, 1, 10_000, 10_001]),
    })

    const { gexFromCellFeatureMatrixZarrRows } = await import('./gex')
    const url = 'https://example.test/xenium/sparse-targets/cell_feature_matrix.zarr.zip'

    await expect(
      gexFromCellFeatureMatrixZarrRows(url, [
        { id: cellA, row: 0 },
        { id: cellB, row: 2 },
      ]),
    ).resolves.toMatchObject({
      geneNames: ['Actb', 'Gad1'],
    })

    const cellIdReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/cell_id',
    )
    const indexRanges = zarrMock.get.mock.calls
      .filter(([target]) => target.path === 'cell_features/csc/indices')
      .map(([, ranges]) => readRange(ranges))

    expect(cellIdReads).toHaveLength(0)
    expect(indexRanges).toEqual([
      { start: 0, end: 1 },
      { start: 10_000, end: 10_001 },
    ])
  })

  it('warms zarr matrix metadata and cell-major arrays without scanning every cell id', async () => {
    setupZarrMatrixMock({
      cellIdPairs: new Uint32Array([1, 1, 2, 1]),
      indptr: new Uint32Array([0, 1, 2]),
    })

    const { warmCellFeatureMatrixZarr } = await import('./gex')
    const url = 'https://example.test/xenium/warm-only/cell_feature_matrix.zarr.zip'

    await warmCellFeatureMatrixZarr(url)

    const cellIdReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/cell_id',
    )
    const indptrReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/csc/indptr',
    )
    const openedPaths = zarrMock.open.mock.calls
      .map(([target]) => target.path)
      .filter((path): path is string => typeof path === 'string')

    expect(cellIdReads).toHaveLength(0)
    expect(indptrReads).toHaveLength(0)
    expect(openedPaths).toEqual(
      expect.arrayContaining([
        'cell_features/csc/indptr',
        'cell_features/csc/indices',
        'cell_features/csc/data',
      ]),
    )
  })

  it('reuses warmed cell-major array handles for row-targeted ROI gene reads', async () => {
    const cellA = intToCellId(1, 1)

    setupZarrMatrixMock({
      cellIdPairs: new Uint32Array([1, 1, 2, 1]),
      indptr: new Uint32Array([0, 1, 2]),
    })

    const { gexFromCellFeatureMatrixZarrRows, warmCellFeatureMatrixZarr } =
      await import('./gex')
    const url = 'https://example.test/xenium/warmed-rows/cell_feature_matrix.zarr.zip'

    await warmCellFeatureMatrixZarr(url)
    zarrMock.open.mockClear()

    await expect(
      gexFromCellFeatureMatrixZarrRows(url, [{ id: cellA, row: 0 }]),
    ).resolves.toMatchObject({
      geneNames: ['Actb', 'Gad1'],
    })

    const reopenedCellMajorArrays = zarrMock.open.mock.calls.filter(
      ([target]) =>
        target.path === 'cell_features/csc/indptr' ||
        target.path === 'cell_features/csc/indices' ||
        target.path === 'cell_features/csc/data',
    )

    expect(reopenedCellMajorArrays).toHaveLength(0)
  })

  it('warms and memoizes the decoded cell-id row map before ROI gene reads', async () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)

    setupZarrMatrixMock({
      cellIdPairs: new Uint32Array([1, 1, 2, 1]),
      indptr: new Uint32Array([0, 1, 2]),
    })

    const { gexFromCellFeatureMatrixZarr, warmCellFeatureMatrixZarrCellIdIndex } =
      await import('./gex')
    const url = 'https://example.test/xenium/warm-index/cell_feature_matrix.zarr.zip'

    await warmCellFeatureMatrixZarrCellIdIndex(url)

    const warmCellIdReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/cell_id',
    )
    expect(warmCellIdReads).toHaveLength(1)

    zarrMock.get.mockClear()

    await expect(gexFromCellFeatureMatrixZarr(url, [cellB, cellA])).resolves.toMatchObject(
      {
        geneNames: ['Actb', 'Gad1'],
      },
    )

    const roiCellIdReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/cell_id',
    )
    expect(roiCellIdReads).toHaveLength(0)
  })
})

function setupZarrMatrixMock(options: {
  readonly cellIdPairs: Uint32Array
  readonly indptr: Uint32Array
}): void {
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
      return array(target.path, [options.cellIdPairs.length / 2, 2])
    }

    return array(target.path)
  })
  zarrMock.get.mockImplementation(async (target: MockZarrNode, ranges: unknown) => {
    if (target.path === 'cell_features/cell_id') {
      return { data: options.cellIdPairs }
    }

    if (target.path === 'cell_features/csc/indptr') {
      const { start, end } = readRange(ranges, options.indptr.length)

      return { data: options.indptr.slice(start, end) }
    }

    if (target.path === 'cell_features/csc/indices') {
      const { start, end } = readRange(ranges)
      const length = Math.max(0, end - start)

      return {
        data: Uint16Array.from({ length }, (_value, offset) =>
          start + offset === 0 ? 0 : 1,
        ),
      }
    }

    if (target.path === 'cell_features/csc/data') {
      const { start, end } = readRange(ranges)
      const length = Math.max(0, end - start)

      return {
        data: Uint32Array.from({ length }, (_value, offset) =>
          start + offset === 0 ? 5 : 7,
        ),
      }
    }

    throw new Error(`Unexpected zarr.get target: ${target.path}`)
  })
}

function readRange(
  ranges: unknown,
  fallbackEnd = 0,
): { readonly start: number; readonly end: number } {
  const firstRange = Array.isArray(ranges) ? ranges[0] : null

  return isRangeLike(firstRange)
    ? { start: firstRange.start, end: firstRange.end }
    : { start: 0, end: fallbackEnd }
}

function isRangeLike(value: unknown): value is {
  readonly start: number
  readonly end: number
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'start' in value &&
    typeof value.start === 'number' &&
    'end' in value &&
    typeof value.end === 'number'
  )
}
