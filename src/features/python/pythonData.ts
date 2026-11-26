import { micrometers, type DataPoint, type Micrometers } from '../../data/coords'
import { roiSelectionContains, type RoiSelection } from '../../data/roiSelection'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import type {
  PythonCategoryColumn,
  PythonColumnInfo,
  PythonDataRequest,
  PythonDrawCommand,
  PythonRoiInfo,
  PythonViewInfo,
} from '../../workers/pythonMessages'
import type { CellQueryColumnRequest } from '../../workers/cellQueryMessages'
import type { GeometricAnnotationFeature } from '../annotations/geometricAnnotationModel'
import type { CellColumnContext, CellColumnReader } from '../query/cellColumnReader'
import type { CellQueryColumn } from '../query/cellQueryModel'
import type { SavedSelection } from '../roi/selectionListModel'
import type { PythonDataAnswer, PythonDataProvider } from './pythonSession'

// The app's answers to Python (plan 29-D4): the open dataset's cells by
// overview row, as the canvas draws them. Positions are in µm with y down,
// as the ruler shows them; the overview stores y negated for deck.gl. Every
// array is made for the answer and transferred, so the app keeps nothing
// Python can change.

export interface PythonGeneReader {
  // The gene's value in every overview row: 0 where the matrix stores none,
  // NaN for a cell it does not list. Over the budget it rejects with an
  // error named GeneReadTooLarge or GeneReadRefused (29-D6).
  readonly read: (
    gene: string,
    options: { readonly layer?: string; readonly allowLarge?: boolean },
  ) => Promise<Float32Array>
  readonly layers: () => Promise<readonly string[]>
}

export interface PythonDataContext {
  readonly datasetUrl: string | null
  readonly datasetName: string
  readonly cells: readonly OverviewCellDatum[]
  readonly elementNoun: string
  // Cell Query's columns, without the saved selections and image columns.
  readonly columns: readonly CellQueryColumn[]
  readonly columnReader: CellColumnReader
  readonly columnContext: Omit<CellColumnContext, 'loads'>
  readonly geneNames: readonly string[]
  // Null for a dataset with no matrix to read by gene.
  readonly genes: () => Promise<PythonGeneReader | null>
  readonly savedSelections: readonly SavedSelection[]
  // The selection drawn but not saved.
  readonly currentSelection: RoiSelection | null
  readonly features: readonly GeometricAnnotationFeature[]
  readonly view: PythonViewInfo | null
  readonly selectedCellId: string | null
  readonly draw: (command: PythonDrawCommand) => void
}

const CURRENT_KEY = 'current'

export function createPythonDataProvider(
  context: () => PythonDataContext,
): PythonDataProvider {
  return {
    answer: async (request) => answerPythonRequest(request, context),
  }
}

export async function answerPythonRequest(
  request: PythonDataRequest,
  context: () => PythonDataContext,
): Promise<PythonDataAnswer> {
  const current = context()
  if (current.datasetUrl === null) throw new Error('No dataset is open.')
  const { cells } = current

  switch (request.kind) {
    case 'dataset': {
      const genes = await current.genes()
      return {
        value: {
          name: current.datasetName,
          count: cells.length,
          noun: current.elementNoun,
          columns: current.columns.map(pythonColumnInfo),
          hasGenes: genes !== null,
          layers: genes === null ? [] : await genes.layers(),
        },
      }
    }
    case 'positions': {
      const x = new Float64Array(cells.length)
      const y = new Float64Array(cells.length)
      cells.forEach((cell, row) => {
        x[row] = cell.position[0] ?? Number.NaN
        y[row] = -(cell.position[1] ?? Number.NaN)
      })
      return { value: { x, y }, transfer: [x.buffer, y.buffer] }
    }
    case 'cell-ids':
      return { value: cells.map((cell) => cell.id) }
    case 'number-column': {
      const read = await readColumn(current, request.columnId, context)
      const values = numberColumnByRow(read, cells)
      return { value: values, transfer: [values.buffer] }
    }
    case 'category-column': {
      const read = await readColumn(current, request.columnId, context)
      const column = categoryColumnByRow(read, cells)
      return {
        value: column,
        transfer: [
          column.codes.buffer,
          column.extraRows.buffer,
          column.extraCodes.buffer,
        ],
      }
    }
    case 'gene-names':
      return { value: [...current.geneNames] }
    case 'gene': {
      const genes = await current.genes()
      if (genes === null) {
        throw new Error(
          `This dataset has no expression matrix to read ${request.name} from.`,
        )
      }
      const values = await genes.read(request.name, {
        ...(request.layer === null ? {} : { layer: request.layer }),
        allowLarge: request.allowLarge,
      })
      return { value: values, transfer: [values.buffer] }
    }
    case 'selected': {
      const id = current.selectedCellId
      const row = id === null ? -1 : (rowsById(cells).get(id) ?? -1)
      return { value: row < 0 ? null : row }
    }
    case 'rois':
      return { value: pythonRois(current) }
    case 'contains': {
      const mask = containsMask(current, request.key)
      return { value: mask, transfer: [mask.buffer] }
    }
    case 'view':
      if (current.view === null) throw new Error('The canvas has not shown a view yet.')
      return { value: current.view }
    case 'draw':
      current.draw(request.command)
      return { value: null }
  }
}

function pythonColumnInfo(column: CellQueryColumn): PythonColumnInfo {
  return {
    id: column.id,
    label: column.label,
    kind: column.kind,
    group: column.group === 'Image' ? 'Metadata' : column.group,
  }
}

async function readColumn(
  current: PythonDataContext,
  columnId: string,
  context: () => PythonDataContext,
): Promise<CellQueryColumnRequest> {
  const column = current.columns.find((candidate) => candidate.id === columnId)
  if (column === undefined) throw new Error(`The dataset has no column ${columnId}.`)
  return current.columnReader.read(column, () => context().columnContext)
}

// Overview rows by cell ID, made once per list of cells.
const rowIndexes = new WeakMap<
  readonly OverviewCellDatum[],
  ReadonlyMap<string, number>
>()

function rowsById(cells: readonly OverviewCellDatum[]): ReadonlyMap<string, number> {
  let rows = rowIndexes.get(cells)
  if (rows === undefined) {
    const made = new Map<string, number>()
    cells.forEach((cell, row) => {
      if (!made.has(cell.id)) made.set(cell.id, row)
    })
    rows = made
    rowIndexes.set(cells, rows)
  }
  return rows
}

// A number column's value in every row, NaN for none.
export function numberColumnByRow(
  read: CellQueryColumnRequest,
  cells: readonly OverviewCellDatum[],
): Float64Array {
  switch (read.type) {
    case 'number-column':
      return Float64Array.from(read.values)
    case 'number-column-by-id': {
      const values = new Float64Array(cells.length).fill(Number.NaN)
      const rows = rowsById(cells)
      read.cellIds.forEach((cellId, index) => {
        const row = rows.get(cellId)
        if (row !== undefined) values[row] = read.values[index] ?? Number.NaN
      })
      return values
    }
    default:
      throw new Error(`${read.columnId} holds classes, not numbers.`)
  }
}

// A set's classes by row: each row's first class, and the further classes
// of rows listed by more than one, as Cell Query's store keeps them.
export function categoryColumnByRow(
  read: CellQueryColumnRequest,
  cells: readonly OverviewCellDatum[],
): PythonCategoryColumn {
  switch (read.type) {
    case 'category-column-by-row':
      return {
        codes: Int32Array.from(read.codes),
        labels: [...read.labels],
        extraRows: new Int32Array(0),
        extraCodes: new Int32Array(0),
      }
    case 'category-column': {
      const rows = rowsById(cells)
      const codes = new Int32Array(cells.length).fill(-1)
      const extraRows: number[] = []
      const extraCodes: number[] = []
      read.classes.forEach((queryClass, code) => {
        const seen = new Set<number>()
        for (const cellId of queryClass.cellIds) {
          const row = rows.get(cellId)
          if (row === undefined || seen.has(row)) continue
          seen.add(row)
          if (codes[row] === -1) {
            codes[row] = code
          } else if (codes[row] !== code) {
            extraRows.push(row)
            extraCodes.push(code)
          }
        }
      })
      return {
        codes,
        labels: read.classes.map((queryClass) => queryClass.label),
        extraRows: Int32Array.from(extraRows),
        extraCodes: Int32Array.from(extraCodes),
      }
    }
    default:
      throw new Error(`${read.columnId} holds numbers, not classes.`)
  }
}

// Saved selections, the selection being drawn, then imported features.
export function pythonRois(current: PythonDataContext): readonly PythonRoiInfo[] {
  return [
    ...current.savedSelections.map((saved) =>
      selectionRoi(`selection:${saved.id}`, saved.name, 'selection', saved.selection),
    ),
    ...(current.currentSelection === null
      ? []
      : [
          selectionRoi(
            CURRENT_KEY,
            'Current selection',
            'current',
            current.currentSelection,
          ),
        ]),
    ...current.features.map((feature) => ({
      key: `feature:${feature.id}`,
      name: feature.label,
      kind: 'feature' as const,
      polygons: featurePolygons(feature).map((rings) => flatPoints(rings[0] ?? [])),
      box: false,
    })),
  ]
}

function selectionRoi(
  key: string,
  name: string,
  kind: 'selection' | 'current',
  selection: RoiSelection,
): PythonRoiInfo {
  if (selection.kind === 'box') {
    const { minX, minY, maxX, maxY } = selection.bbox
    return {
      key,
      name,
      kind,
      polygons: [Float64Array.of(minX, minY, maxX, minY, maxX, maxY, minX, maxY)],
      box: true,
    }
  }
  return { key, name, kind, polygons: [flatPoints(selection.points)], box: false }
}

function flatPoints(points: readonly DataPoint[]): Float64Array {
  const flat = new Float64Array(points.length * 2)
  points.forEach((point, index) => {
    flat[index * 2] = point.x
    flat[index * 2 + 1] = point.y
  })
  return flat
}

function featurePolygons(
  feature: GeometricAnnotationFeature,
): readonly (readonly (readonly DataPoint[])[])[] {
  return feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates
}

// Which cells' centroids the shape holds (29-D9): the canvas's own test for
// selections; for a feature, inside an outer ring and outside its holes.
export function containsMask(current: PythonDataContext, key: string): Uint8Array {
  const contains = shapeTest(current, key)
  const mask = new Uint8Array(current.cells.length)
  const point: { x: Micrometers; y: Micrometers } = {
    x: micrometers(0),
    y: micrometers(0),
  }
  current.cells.forEach((cell, row) => {
    point.x = micrometers(cell.position[0] ?? Number.NaN)
    point.y = micrometers(-(cell.position[1] ?? Number.NaN))
    if (contains(point)) mask[row] = 1
  })
  return mask
}

function shapeTest(
  current: PythonDataContext,
  key: string,
): (point: DataPoint) => boolean {
  const selection =
    key === CURRENT_KEY
      ? current.currentSelection
      : (current.savedSelections.find((saved) => `selection:${saved.id}` === key)
          ?.selection ?? null)
  if (selection !== null) return (point) => roiSelectionContains(selection, point)

  const feature = current.features.find((candidate) => `feature:${candidate.id}` === key)
  if (feature === undefined) throw new Error('That shape is no longer listed.')
  const polygons = featurePolygons(feature).map((rings) =>
    rings.map((ring) => ringSelection(ring)),
  )
  return (point) =>
    polygons.some(
      ([outer, ...holes]) =>
        outer !== undefined &&
        roiSelectionContains(outer, point) &&
        !holes.some((hole) => roiSelectionContains(hole, point)),
    )
}

function ringSelection(points: readonly DataPoint[]): RoiSelection {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { x, y } of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return {
    kind: 'lasso',
    bbox: {
      minX: micrometers(minX),
      minY: micrometers(minY),
      maxX: micrometers(maxX),
      maxY: micrometers(maxY),
    },
    points,
  }
}
