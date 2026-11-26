import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../data/annotation'
import { micrometers, type DataPoint } from '../../data/coords'
import { lazyIdLookup } from '../../data/lazyIdLookup'
import type { RoiSelection } from '../../data/roiSelection'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import { annotationSetGrouping } from '../annotations/annotationModel'
import type { GeometricAnnotationFeature } from '../annotations/geometricAnnotationModel'
import { CellImageMeasurements } from '../query/cellImageMeasurements'
import { CellColumnReader } from '../query/cellColumnReader'
import { overviewCellColumns, type CellQueryColumn } from '../query/cellQueryModel'
import {
  answerPythonRequest,
  categoryColumnByRow,
  numberColumnByRow,
  type PythonDataContext,
} from './pythonData'

const URL = 'https://example.test/sample.h5ad'

function cell(id: string, x: number, y: number, cellArea?: number): OverviewCellDatum {
  // The overview negates y for deck.gl.
  return {
    id,
    position: [x, -y, 0],
    radiusPixels: 2,
    fillColor: [0, 0, 0, 255],
    ...(cellArea === undefined ? {} : { cellArea }),
  }
}

const CELLS = [
  cell('a', 1, 1, 10),
  cell('b', 5, 5, 60),
  cell('c', 9, 1),
  cell('d', 20, 20, 80),
]

function point(x: number, y: number): DataPoint {
  return { x: micrometers(x), y: micrometers(y) }
}

const BOX: RoiSelection = {
  kind: 'box',
  bbox: {
    minX: micrometers(0),
    minY: micrometers(0),
    maxX: micrometers(6),
    maxY: micrometers(6),
  },
}
const SQUARE_WITH_HOLE: GeometricAnnotationFeature = {
  id: 'f1',
  objectId: 'uuid',
  label: 'Tumour',
  color: '#ff0000',
  visible: true,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [point(0, 0), point(10, 0), point(10, 10), point(0, 10)],
      [point(4, 4), point(6, 4), point(6, 6), point(4, 6)],
    ],
  },
}
const AREA_COLUMN: CellQueryColumn = {
  id: 'cell:area',
  label: 'Cell area',
  kind: 'number',
  group: 'Cell',
  source: { kind: 'cell', field: 'cellArea' },
}
const KMEANS: readonly Annotation<string>[] = [
  { id: 'analysis:kmeans:one', label: 'kmeans: one', cellIds: ['a', 'b', 'zz'] },
  { id: 'analysis:kmeans:two', label: 'kmeans: two', cellIds: ['b', 'c'] },
]
const KMEANS_SET_ID = annotationSetGrouping(KMEANS[0]!).id
const KMEANS_COLUMN: CellQueryColumn = {
  id: `set:${KMEANS_SET_ID}`,
  label: 'kmeans',
  kind: 'category',
  group: 'Classes',
  source: { kind: 'set', setKind: 'loaded', setId: KMEANS_SET_ID },
}

function context(overrides: Partial<PythonDataContext> = {}): PythonDataContext {
  return {
    datasetUrl: URL,
    datasetName: 'sample.h5ad',
    cells: CELLS,
    elementNoun: 'cells',
    columns: [AREA_COLUMN, KMEANS_COLUMN],
    columnReader: (() => {
      const reader = new CellColumnReader({
        loadSetAnnotations: async () => [],
        loadMetadataTrackValues: async () => [],
        appendDebugEvent: () => undefined,
      })
      reader.sync(URL, { setGroupIds: [], trackIds: [] }, true)
      return reader
    })(),
    columnContext: {
      datasetUrl: URL,
      cells: CELLS,
      placedCellIds: lazyIdLookup(
        CELLS,
        (item) => item.id,
        () => true,
      ),
      cellColumns: overviewCellColumns(CELLS),
      annotations: KMEANS,
      savedSelections: [],
      metadataTracks: [],
      imageSnapshot: new CellImageMeasurements().getSnapshot(),
      imageOverLimit: new Map(),
    },
    geneNames: ['CD3E', 'MS4A1'],
    genes: async () => ({
      read: async () => Float32Array.of(0, 25, 0, Number.NaN),
      layers: async () => ['counts', 'raw'],
    }),
    savedSelections: [
      { id: 's1', name: 'ROI 1', color: '#fff', visible: true, selection: BOX },
    ],
    currentSelection: null,
    features: [SQUARE_WITH_HOLE],
    view: { center: [10, 10], bounds: [0, 0, 20, 20] },
    selectedCellId: 'c',
    draw: () => undefined,
    ...overrides,
  }
}

describe('answerPythonRequest', () => {
  it('describes the dataset, with its columns and layers', async () => {
    const answer = await answerPythonRequest({ kind: 'dataset' }, () => context())
    expect(answer.value).toEqual({
      name: 'sample.h5ad',
      count: 4,
      noun: 'cells',
      columns: [
        { id: 'cell:area', label: 'Cell area', kind: 'number', group: 'Cell' },
        { id: KMEANS_COLUMN.id, label: 'kmeans', kind: 'category', group: 'Classes' },
      ],
      hasGenes: true,
      layers: ['counts', 'raw'],
    })
  })

  it('gives positions in µm with y down, transferred', async () => {
    const answer = await answerPythonRequest({ kind: 'positions' }, () => context())
    expect(answer.value).toEqual({
      x: Float64Array.of(1, 5, 9, 20),
      y: Float64Array.of(1, 5, 1, 20),
    })
    expect(answer.transfer).toHaveLength(2)
  })

  it('reads columns through the column reader, by row', async () => {
    const area = await answerPythonRequest(
      { kind: 'number-column', columnId: 'cell:area' },
      () => context(),
    )
    expect(area.value).toEqual(Float64Array.of(10, 60, Number.NaN, 80))

    const kmeans = await answerPythonRequest(
      { kind: 'category-column', columnId: KMEANS_COLUMN.id },
      () => context(),
    )
    expect(kmeans.value).toEqual({
      codes: Int32Array.of(0, 0, 1, -1),
      labels: ['one', 'two'],
      extraRows: Int32Array.of(1),
      extraCodes: Int32Array.of(1),
    })

    await expect(
      answerPythonRequest({ kind: 'number-column', columnId: 'track:gone' }, () =>
        context(),
      ),
    ).rejects.toThrow('The dataset has no column track:gone.')
  })

  it('reads genes, and says when the dataset has no matrix', async () => {
    const read = vi.fn(async () => Float32Array.of(1, 2, 3, 4))
    const answer = await answerPythonRequest(
      { kind: 'gene', name: 'CD3E', layer: 'counts', allowLarge: true },
      () => context({ genes: async () => ({ read, layers: async () => [] }) }),
    )
    expect(read).toHaveBeenCalledWith('CD3E', { layer: 'counts', allowLarge: true })
    expect(answer.value).toEqual(Float32Array.of(1, 2, 3, 4))
    await expect(
      answerPythonRequest(
        { kind: 'gene', name: 'CD3E', layer: null, allowLarge: false },
        () => context({ genes: async () => null }),
      ),
    ).rejects.toThrow('This dataset has no expression matrix to read CD3E from.')
  })

  it('lists shapes, and tests cells against them as the canvas does', async () => {
    const current: RoiSelection = {
      kind: 'lasso',
      bbox: {
        minX: micrometers(8),
        minY: micrometers(0),
        maxX: micrometers(10),
        maxY: micrometers(2),
      },
      points: [point(8, 0), point(10, 0), point(10, 2), point(8, 2)],
    }
    const rois = await answerPythonRequest({ kind: 'rois' }, () =>
      context({ currentSelection: current }),
    )
    expect(rois.value).toEqual([
      {
        key: 'selection:s1',
        name: 'ROI 1',
        kind: 'selection',
        polygons: [Float64Array.of(0, 0, 6, 0, 6, 6, 0, 6)],
        box: true,
      },
      {
        key: 'current',
        name: 'Current selection',
        kind: 'current',
        polygons: [Float64Array.of(8, 0, 10, 0, 10, 2, 8, 2)],
        box: false,
      },
      {
        key: 'feature:f1',
        name: 'Tumour',
        kind: 'feature',
        polygons: [Float64Array.of(0, 0, 10, 0, 10, 10, 0, 10)],
        box: false,
      },
    ])

    const inBox = await answerPythonRequest(
      { kind: 'contains', key: 'selection:s1' },
      () => context(),
    )
    expect(inBox.value).toEqual(Uint8Array.of(1, 1, 0, 0))
    // b sits in the hole.
    const inFeature = await answerPythonRequest(
      { kind: 'contains', key: 'feature:f1' },
      () => context(),
    )
    expect(inFeature.value).toEqual(Uint8Array.of(1, 0, 1, 0))
    const inCurrent = await answerPythonRequest(
      { kind: 'contains', key: 'current' },
      () => context({ currentSelection: current }),
    )
    expect(inCurrent.value).toEqual(Uint8Array.of(0, 0, 1, 0))
    await expect(
      answerPythonRequest({ kind: 'contains', key: 'feature:gone' }, () => context()),
    ).rejects.toThrow('That shape is no longer listed.')
  })

  it('gives the selected row, the view and gene names, and passes drawing on', async () => {
    expect((await answerPythonRequest({ kind: 'selected' }, () => context())).value).toBe(
      2,
    )
    expect(
      (
        await answerPythonRequest({ kind: 'selected' }, () =>
          context({ selectedCellId: 'gone' }),
        )
      ).value,
    ).toBeNull()
    expect((await answerPythonRequest({ kind: 'view' }, () => context())).value).toEqual({
      center: [10, 10],
      bounds: [0, 0, 20, 20],
    })
    expect(
      (await answerPythonRequest({ kind: 'gene-names' }, () => context())).value,
    ).toEqual(['CD3E', 'MS4A1'])
    const draw = vi.fn()
    await answerPythonRequest(
      { kind: 'draw', command: { op: 'others', mode: 'hide' } },
      () => context({ draw }),
    )
    expect(draw).toHaveBeenCalledWith({ op: 'others', mode: 'hide' })
  })

  it('refuses every request with no dataset open', async () => {
    await expect(
      answerPythonRequest({ kind: 'positions' }, () => context({ datasetUrl: null })),
    ).rejects.toThrow('No dataset is open.')
  })
})

describe('columns by row', () => {
  it('joins classes listed by ID as a plain lookup does', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-e]$/), { minLength: 1 }),
        fc.array(fc.array(fc.stringMatching(/^[a-g]$/)), { maxLength: 4 }),
        (ids, classes) => {
          const cells = ids.map((id) => cell(id, 0, 0))
          const column = categoryColumnByRow(
            {
              type: 'category-column',
              columnId: 'set:x',
              classes: classes.map((cellIds, index) => ({
                id: `c${index.toString()}`,
                label: `C${index.toString()}`,
                cellIds,
              })),
            },
            cells,
          )
          ids.forEach((id, row) => {
            const memberOf = classes.flatMap((cellIds, index) =>
              cellIds.includes(id) ? [index] : [],
            )
            const listed = [
              column.codes[row],
              ...Array.from(column.extraRows).flatMap((extraRow, at) =>
                extraRow === row ? [column.extraCodes[at]] : [],
              ),
            ].filter((code) => code !== -1)
            expect(listed).toEqual(memberOf)
          })
        },
      ),
    )
  })

  it('joins numbers listed by ID, NaN for cells with none', () => {
    expect(
      numberColumnByRow(
        {
          type: 'number-column-by-id',
          columnId: 'track:t',
          cellIds: ['c', 'zz', 'a'],
          values: Float64Array.of(3, 9, 1),
        },
        CELLS,
      ),
    ).toEqual(Float64Array.of(1, Number.NaN, 3, Number.NaN))
  })
})
