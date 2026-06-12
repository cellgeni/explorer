import { beforeEach, describe, expect, it, vi } from 'vitest'
import { intToCellId } from './cellid'

const zarrMock = vi.hoisted(() => ({
  get: vi.fn(),
  open: vi.fn(),
  slice: vi.fn((start: number, end: number) => ({ end, start })),
}))

const storageMock = vi.hoisted(() => ({
  ZipFileStore: vi.fn().mockImplementation(function MockZipFileStore(reader: {
    readonly url: string
  }) {
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

  it('fetches distant indptr target ranges concurrently during cold ROI gene reads', async () => {
    const cellA = intToCellId(10, 1)
    const cellB = intToCellId(20, 1)
    const indptr = new Uint32Array(20_003)
    indptr[0] = 0
    indptr[1] = 1
    indptr[20_000] = 2
    indptr[20_001] = 3

    setupZarrMatrixMock({
      cellIdPairs: new Uint32Array(40_002),
      indptr,
    })

    const defaultGet = zarrMock.get.getMockImplementation()
    let activeIndptrReads = 0
    let maxActiveIndptrReads = 0

    zarrMock.get.mockImplementation(async (target: MockZarrNode, ranges: unknown) => {
      if (target.path === 'cell_features/csc/indptr') {
        activeIndptrReads += 1
        maxActiveIndptrReads = Math.max(maxActiveIndptrReads, activeIndptrReads)
        await new Promise((resolve) => setTimeout(resolve, 25))
        activeIndptrReads -= 1
      }

      if (defaultGet === undefined) {
        throw new Error('Expected default zarr.get implementation.')
      }

      return defaultGet(target, ranges)
    })

    const { gexFromCellFeatureMatrixZarrRows } = await import('./gex')
    const url =
      'https://example.test/xenium/concurrent-indptr/cell_feature_matrix.zarr.zip'

    await expect(
      gexFromCellFeatureMatrixZarrRows(url, [
        { id: cellA, row: 0 },
        { id: cellB, row: 20_000 },
      ]),
    ).resolves.toMatchObject({
      geneNames: ['Actb', 'Gad1'],
    })

    expect(maxActiveIndptrReads).toBeGreaterThan(1)
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

  it('reports when warmed zarr matrix metadata lacks cell-major CSC arrays', async () => {
    setupZarrMatrixMock({
      cellIdPairs: new Uint32Array([1, 1, 2, 1]),
      indptr: new Uint32Array([0, 1, 2]),
      hasCellMajorCsc: false,
    })

    const { warmCellFeatureMatrixZarr } = await import('./gex')
    const url =
      'https://example.test/xenium/feature-major-only/cell_feature_matrix.zarr.zip'

    await expect(warmCellFeatureMatrixZarr(url)).resolves.toEqual({
      url,
      hasCellMajorCsc: false,
      cellCount: 2,
      featureCount: 2,
    })
  })

  it('warms distributed ROI sparse row reads without scanning every cell id', async () => {
    const indptr = Uint32Array.from({ length: 129 }, (_value, index) => index)

    setupZarrMatrixMock({
      cellIdPairs: new Uint32Array(256),
      indptr,
    })

    const { warmCellFeatureMatrixZarrRoiStats } = await import('./gex')
    const url = 'https://example.test/xenium/warm-roi-stats/cell_feature_matrix.zarr.zip'

    await warmCellFeatureMatrixZarrRoiStats(url)

    const cellIdReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/cell_id',
    )
    const indptrReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/csc/indptr',
    )
    const fullIndptrReads = indptrReads.filter(([, ranges]) => {
      const range = readRange(ranges, indptr.length)

      return range.start === 0 && range.end === indptr.length
    })
    const indexReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/csc/indices',
    )
    const dataReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/csc/data',
    )

    expect(cellIdReads).toHaveLength(0)
    expect(indptrReads.length).toBeGreaterThan(0)
    expect(fullIndptrReads).toHaveLength(1)
    expect(indexReads.length).toBeGreaterThan(0)
    expect(dataReads.length).toBeGreaterThan(0)
  })

  it('reuses a warmed full cell-major indptr for later ROI gene reads', async () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(1, 2)
    const indptr = Uint32Array.from({ length: 129 }, (_value, index) => index)

    setupZarrMatrixMock({
      cellIdPairs: new Uint32Array(256),
      indptr,
    })

    const { gexFromCellFeatureMatrixZarrRows, warmCellFeatureMatrixZarrRoiStats } =
      await import('./gex')
    const url =
      'https://example.test/xenium/warm-full-indptr/cell_feature_matrix.zarr.zip'

    await warmCellFeatureMatrixZarrRoiStats(url)
    zarrMock.get.mockClear()

    await expect(
      gexFromCellFeatureMatrixZarrRows(url, [
        { id: cellA, row: 0 },
        { id: cellB, row: 127 },
      ]),
    ).resolves.toMatchObject({
      geneNames: ['Actb', 'Gad1'],
    })

    const indptrReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/csc/indptr',
    )

    expect(indptrReads).toHaveLength(0)
  })

  it('does not block small ROI previews on a pending full indptr warmup', async () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(1, 2)
    const indptr = Uint32Array.from({ length: 10_001 }, (_value, index) => index)

    setupZarrMatrixMock({
      cellIdPairs: new Uint32Array(20_000),
      indptr,
    })

    const defaultGet = zarrMock.get.getMockImplementation()
    let releaseFullIndptr!: () => void
    let fullIndptrStarted!: () => void
    const fullIndptrRelease = new Promise<void>((resolve) => {
      releaseFullIndptr = resolve
    })
    const fullIndptrRequest = new Promise<void>((resolve) => {
      fullIndptrStarted = resolve
    })

    zarrMock.get.mockImplementation(async (target: MockZarrNode, ranges: unknown) => {
      if (target.path === 'cell_features/csc/indptr') {
        const range = readRange(ranges, indptr.length)

        if (range.start === 0 && range.end === indptr.length) {
          fullIndptrStarted()
          await fullIndptrRelease
        }
      }

      if (defaultGet === undefined) {
        throw new Error('Expected default zarr.get implementation.')
      }

      return defaultGet(target, ranges)
    })

    const { gexFromCellFeatureMatrixZarrRows, warmCellFeatureMatrixZarrRoiStats } =
      await import('./gex')
    const url =
      'https://example.test/xenium/pending-full-indptr/cell_feature_matrix.zarr.zip'
    const warmup = warmCellFeatureMatrixZarrRoiStats(url)

    await fullIndptrRequest

    await expect(
      gexFromCellFeatureMatrixZarrRows(url, [
        { id: cellA, row: 0 },
        { id: cellB, row: 9_000 },
      ]),
    ).resolves.toMatchObject({
      geneNames: ['Actb', 'Gad1'],
    })

    const slicedIndptrReads = zarrMock.get.mock.calls.filter(([target, ranges]) => {
      if (target.path !== 'cell_features/csc/indptr') {
        return false
      }

      const range = readRange(ranges, indptr.length)
      return range.end - range.start < indptr.length
    })

    expect(slicedIndptrReads.length).toBeGreaterThan(0)

    releaseFullIndptr()
    await warmup
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

    await expect(
      gexFromCellFeatureMatrixZarr(url, [cellB, cellA]),
    ).resolves.toMatchObject({
      geneNames: ['Actb', 'Gad1'],
    })

    const roiCellIdReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/cell_id',
    )
    expect(roiCellIdReads).toHaveLength(0)
  })

  it('uses feature-major selected-gene reads for large target cell sets', async () => {
    const cellCount = 50_001
    const cellIds = Array.from({ length: cellCount }, (_value, index) =>
      intToCellId(1, index + 1),
    )
    const cellIdPairs = Uint32Array.from({ length: cellCount * 2 }, (_value, index) =>
      index % 2 === 0 ? 1 : Math.floor(index / 2) + 1,
    )

    setupZarrMatrixMock({
      cellIdPairs,
      indptr: new Uint32Array([0, 1, 2]),
      featureIndptr: new Uint32Array([0, 2, 2]),
      featureIndices: new Uint32Array([0, cellCount - 1]),
      featureData: new Uint32Array([9, 4]),
    })

    const { gexFromCellFeatureMatrixZarrSelectedGenes } = await import('./gex')
    const url =
      'https://example.test/xenium/feature-major-large/cell_feature_matrix.zarr.zip'
    const result = await gexFromCellFeatureMatrixZarrSelectedGenes(url, cellIds, ['Actb'])

    expect(result.geneNames).toEqual(['Actb'])
    expect(result.cells.get(cellIds[0] ?? intToCellId(0, 0))).toEqual({
      geneNames: ['Actb'],
      counts: [9],
    })
    expect(result.cells.get(cellIds[cellCount - 1] ?? intToCellId(0, 0))).toEqual({
      geneNames: ['Actb'],
      counts: [4],
    })

    const featureMajorReads = zarrMock.get.mock.calls
      .filter(([target]) => target.path === 'cell_features/indices')
      .map(([, ranges]) => readRange(ranges))
    const cellMajorIndexReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/csc/indices',
    )

    expect(featureMajorReads).toEqual([{ start: 0, end: 2 }])
    expect(cellMajorIndexReads).toHaveLength(0)
  })

  it('uses feature-major selected-gene reads for overview-sized samples', async () => {
    const cellCount = 15_000
    const cellIds = Array.from({ length: cellCount }, (_value, index) =>
      intToCellId(1, index + 1),
    )
    const cellIdPairs = Uint32Array.from({ length: cellCount * 2 }, (_value, index) =>
      index % 2 === 0 ? 1 : Math.floor(index / 2) + 1,
    )
    const onStageTiming = vi.fn()

    setupZarrMatrixMock({
      cellIdPairs,
      indptr: new Uint32Array([0, 1, 2]),
      featureIndptr: new Uint32Array([0, 2, 2]),
      featureIndices: new Uint32Array([0, cellCount - 1]),
      featureData: new Uint32Array([9, 4]),
    })

    const { gexFromCellFeatureMatrixZarrSelectedGenes } = await import('./gex')
    const url =
      'https://example.test/xenium/feature-major-overview/cell_feature_matrix.zarr.zip'
    const result = await gexFromCellFeatureMatrixZarrSelectedGenes(
      url,
      cellIds,
      ['Actb'],
      { onStageTiming },
    )

    expect(result.geneNames).toEqual(['Actb'])
    expect(result.cells.get(cellIds[0] ?? intToCellId(0, 0))).toEqual({
      geneNames: ['Actb'],
      counts: [9],
    })
    expect(result.cells.get(cellIds[cellCount - 1] ?? intToCellId(0, 0))).toEqual({
      geneNames: ['Actb'],
      counts: [4],
    })

    const featureMajorReads = zarrMock.get.mock.calls
      .filter(([target]) => target.path === 'cell_features/indices')
      .map(([, ranges]) => readRange(ranges))
    const cellMajorIndexReads = zarrMock.get.mock.calls.filter(
      ([target]) => target.path === 'cell_features/csc/indices',
    )

    expect(featureMajorReads).toEqual([{ start: 0, end: 2 }])
    expect(cellMajorIndexReads).toHaveLength(0)
    expect(onStageTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'matrix-feature-major-selected-genes',
      }),
    )
  })
})

function setupZarrMatrixMock(options: {
  readonly cellIdPairs: Uint32Array
  readonly indptr: Uint32Array
  readonly featureIndptr?: Uint32Array
  readonly featureIndices?: Uint32Array
  readonly featureData?: Uint32Array
  readonly hasCellMajorCsc?: boolean
}): void {
  const root = node('')
  const cellFeatures = node('cell_features', {
    feature_keys: ['Actb', 'Gad1'],
    feature_types: ['Gene Expression', 'Gene Expression'],
  })
  const hasCellMajorCsc = options.hasCellMajorCsc ?? true

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

    if (target.path.startsWith('cell_features/csc/') && !hasCellMajorCsc) {
      throw new Error(`${target.path} not found`)
    }

    if (target.path === 'cell_features/csc/indptr') {
      return array(target.path, [options.indptr.length])
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

    if (target.path === 'cell_features/indptr') {
      const indptr = options.featureIndptr ?? new Uint32Array([0, 0, 0])
      const { start, end } = readRange(ranges, indptr.length)

      return { data: indptr.slice(start, end) }
    }

    if (target.path === 'cell_features/indices') {
      const indices = options.featureIndices ?? new Uint32Array(0)
      const { start, end } = readRange(ranges, indices.length)

      return { data: indices.slice(start, end) }
    }

    if (target.path === 'cell_features/data') {
      const data = options.featureData ?? new Uint32Array(0)
      const { start, end } = readRange(ranges, data.length)

      return { data: data.slice(start, end) }
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
