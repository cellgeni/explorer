import { describe, expect, it, vi } from 'vitest'
import { intToCellId } from '../data/cellid'
import { micrometers, type BBox } from '../data/coords'
import { geneExpressionScores } from '../rendering/geneExpressionRenderer'
import { array, group, strings } from '../test/ateraFixtures'
import { createH5Bytes } from '../test/h5Fixtures'
import { AnnDataH5adDataset } from './h5adDataset'
import { AteraDataset, type AteraZipStore } from './ateraDataset'
import {
  VisiumHdDataset,
  type VisiumHdBinDescriptor,
  type VisiumHdScalefactors,
} from './visiumHdDataset'
import { parseVisiumHdTissuePositionRows } from './visiumHdOverview'
import { XeniumDataset, type XeniumDuckDbConnection } from './xeniumDataset'
import type {
  ArrowTableLike,
  DuckDbPreparedStatementLike,
  GexResult,
  SelectedGeneMatrixRows,
  SqlParameter,
} from '../data/gex'
import type { CellId } from '../data/cellid'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { GeneExpressionBatch, GeneExpressionPopulation } from './spatialDataset'

// Every platform's selected-gene reader gets the same layout: four cells in a
// 2 x 2 block, 16 µm apart. GENEA is expressed by cells 1 and 3 and GENEB by
// cells 0 and 3. The reads select GENEA, so cells 0 and 2 are the zero cells.
const CELLS = [
  { x: 100, y: 200, GENEA: 0, GENEB: 3 },
  { x: 116, y: 200, GENEA: 2, GENEB: 0 },
  { x: 100, y: 216, GENEA: 0, GENEB: 0 },
  { x: 116, y: 216, GENEA: 4, GENEB: 1 },
] as const
const GENES = ['GENEA', 'GENEB'] as const
type LayoutGene = (typeof GENES)[number]
const SELECTED = ['GENEA']

const WHOLE_LAYOUT: BBox = {
  minX: micrometers(0),
  maxX: micrometers(300),
  minY: micrometers(0),
  maxY: micrometers(300),
}
// The top row, cells 0 and 1.
const TOP_ROW: BBox = {
  minX: micrometers(90),
  maxX: micrometers(130),
  minY: micrometers(190),
  maxY: micrometers(205),
}
const READS = [
  { label: 'the whole layout', box: WHOLE_LAYOUT, cellsRead: [0, 1, 2, 3] },
  { label: 'a view of two cells', box: TOP_ROW, cellsRead: [0, 1] },
] as const

interface Reader {
  // The ID this platform gives each layout cell.
  readonly ids: readonly string[]
  readonly read: (
    box: BBox,
    options?: { readonly sampleStride?: number },
  ) => Promise<GeneExpressionBatch>
  // What `elements` holds of the cells read when no sample is asked for.
  readonly population: GeneExpressionPopulation
  // The read of the whole layout with `sampleStride: 2`: the batch's
  // population, the layout cells it lists and how many cells it was read for.
  readonly sampled: {
    readonly population: GeneExpressionPopulation
    readonly listed: readonly number[]
    readonly cellCount: number
  }
}

const READERS: readonly {
  readonly name: string
  readonly open: () => Promise<Reader>
}[] = [
  { name: 'Xenium, per-cell matrix reads', open: () => xeniumReader(false) },
  { name: 'Xenium, selected-gene matrix rows', open: () => xeniumReader(true) },
  { name: 'H5AD', open: h5adReader },
  { name: 'Atera', open: ateraReader },
  { name: 'Visium HD', open: visiumHdReader },
]

function expressionOf(cell: number): number {
  return CELLS[cell]?.GENEA ?? 0
}

describe.each(READERS)('GeneExpressionBatch from $name', ({ open }) => {
  it.each(READS)(
    'lists the cells its population says for $label',
    async ({ box, cellsRead }) => {
      const reader = await open()

      const batch = await reader.read(box)

      // 'all' lists every cell read; 'expressing' only those with expression.
      const listed =
        reader.population === 'all'
          ? cellsRead
          : cellsRead.filter((cell) => expressionOf(cell) > 0)
      expect(batch.population).toBe(reader.population)
      expect(batch.elements.map((element) => reader.ids.indexOf(element.id))).toEqual(
        listed,
      )
      expect(batch.elements.map((element) => element.count)).toEqual(
        listed.map(expressionOf),
      )
      // The cells a z-score counts are those in the box.
      expect(batch.cellCount ?? batch.elements.length).toBe(cellsRead.length)
      expect(batch.maxCount).toBe(Math.max(...cellsRead.map(expressionOf)))
    },
  )

  it.each(READS)(
    'gives each cell the same z-score for $label',
    async ({ box, cellsRead }) => {
      const reader = await open()

      const batch = await reader.read(box)

      // Over every cell read, zeros included.
      const values = cellsRead.map(expressionOf)
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      const deviation = Math.sqrt(
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
      )
      const scores = geneExpressionScores(
        batch.elements,
        batch.genes,
        'z-score',
        batch.cellCount,
      )

      expect(scores).toHaveLength(batch.elements.length)
      batch.elements.forEach((element, position) => {
        expect(scores[position]).toBeCloseTo((element.count - mean) / deviation, 10)
      })
    },
  )

  it('records what a sample of 2 keeps', async () => {
    const reader = await open()

    const batch = await reader.read(WHOLE_LAYOUT, { sampleStride: 2 })

    expect(batch.population).toBe(reader.sampled.population)
    expect(batch.elements.map((element) => reader.ids.indexOf(element.id))).toEqual(
      reader.sampled.listed,
    )
    expect(batch.cellCount).toBe(reader.sampled.cellCount)
  })
})

function layoutIds(prefix: (index: number) => string): readonly string[] {
  return CELLS.map((_cell, index) => prefix(index))
}

// The layout cells whose centres are in a box.
function cellsInBox(box: BBox): readonly number[] {
  return CELLS.flatMap((cell, index) =>
    cell.x >= box.minX && cell.x <= box.maxX && cell.y >= box.minY && cell.y <= box.maxY
      ? [index]
      : [],
  )
}

// A gene's count in a cell, by name.
function countOf(cell: number, gene: string): number {
  return CELLS[cell]?.[gene as LayoutGene] ?? 0
}

async function xeniumReader(byMatrixRows: boolean): Promise<Reader> {
  const ids = CELLS.map((_cell, index) => intToCellId(1, index + 1))
  const cellRow = (index: number) => ({
    cell_id: ids[index],
    cell_feature_matrix_row: index,
    x_centroid: CELLS[index]?.x,
    y_centroid: CELLS[index]?.y,
    transcript_counts: 10 + index,
    cell_area: 20 + index,
  })
  // DuckDB would answer the box and the row check; the layout does here.
  let box = WHOLE_LAYOUT
  const conn: XeniumDuckDbConnection = {
    prepare: async (sql): Promise<DuckDbPreparedStatementLike> => ({
      query: async (...params: SqlParameter[]): Promise<ArrowTableLike> => {
        const rows = sql.includes('file_row_number IN')
          ? params.slice(1).map((row) => cellRow(Number(row)))
          : cellsInBox(box).map(cellRow)

        return { toArray: () => rows }
      },
    }),
  }
  const matrixReader = vi.fn(
    async (
      _url: string,
      requested: readonly CellId[],
      genes: readonly string[],
    ): Promise<GexResult> => ({
      geneNames: [...genes],
      cells: new Map(
        requested.map((id) => {
          const cell = ids.indexOf(id)
          const expressed = genes.filter((gene) => countOf(cell, gene) > 0)

          return [
            id,
            {
              geneNames: expressed,
              counts: expressed.map((gene) => countOf(cell, gene)),
            },
          ]
        }),
      ),
    }),
  )
  const rowsReader = async (
    _url: string,
    genes: readonly string[],
  ): Promise<SelectedGeneMatrixRows> => ({
    nCells: CELLS.length,
    features: genes.map((gene) => {
      const rows = CELLS.flatMap((_cell, index) =>
        countOf(index, gene) > 0 ? [index] : [],
      )

      return {
        gene,
        rows: Uint32Array.from(rows),
        counts: Uint32Array.from(rows.map((row) => countOf(row, gene))),
      }
    }),
    cellIdForRow: (row) => ids[row] ?? intToCellId(0, 0),
  })
  const dataset = new XeniumDataset({
    // The row check is kept per URL, so each reader has its own.
    baseUrl: `https://example.test/xenium-${byMatrixRows ? 'rows' : 'cells'}/`,
    duckDbClient: { conn, loadSpatial: async () => {} },
    fetcher: async () => new Response(JSON.stringify({ pixel_size: 0.5 })),
    openTiff: async () => ({}) as TiffPyramidLoader,
    geneExpressionMatrixReader: matrixReader,
    selectedGeneRowsReader: byMatrixRows ? rowsReader : null,
  })

  return {
    ids,
    read: (readBox, options = {}) => {
      box = readBox
      return dataset.geneExpression(readBox, SELECTED, options)
    },
    // Only the cells with expression are listed.
    population: 'expressing',
    // The stride is ignored: every cell in the box is read, so that no
    // expressing cell is lost.
    sampled: { population: 'expressing', listed: [1, 3], cellCount: 4 },
  }
}

async function h5adReader(): Promise<Reader> {
  const ids = layoutIds((index) => `cell-${index}`)
  const bytes = await createH5Bytes((file) => {
    const obs = file.create_group('obs')
    obs.create_attribute('_index', 'cell_id')
    obs.create_dataset({ name: 'cell_id', data: [...ids] })
    const variables = file.create_group('var')
    variables.create_attribute('_index', 'gene_ids')
    variables.create_dataset({ name: 'gene_ids', data: [...GENES] })
    file.create_group('obsm').create_dataset({
      name: 'X_spatial',
      data: new Float32Array(CELLS.flatMap((cell) => [cell.x, cell.y])),
      shape: [CELLS.length, 2],
    })
    file.create_dataset({
      name: 'X',
      data: new Float32Array(CELLS.flatMap((cell) => GENES.map((gene) => cell[gene]))),
      shape: [CELLS.length, GENES.length],
    })
  })
  const dataset = new AnnDataH5adDataset({
    url: 'https://example.test/layout.h5ad',
    fetcher: (async () => new Response(bytes.slice(), { status: 200 })) as typeof fetch,
  })

  return {
    ids,
    read: (box, options = {}) => dataset.geneExpression(box, SELECTED, options),
    // Every cell in the box is listed, zeros included.
    population: 'all',
    // Every cell with expression and every second one without: cell 0 is the
    // first zero cell and stays, cell 2 is the second and goes.
    sampled: { population: 'sampled', listed: [0, 1, 3], cellCount: 4 },
  }
}

async function ateraReader(): Promise<Reader> {
  const baseUrl = 'https://example.test/atera'
  const ids = layoutIds((index) => `aaaaaaa${index}-1`)
  const matrix = new Map<string, Uint8Array>()
  group(matrix, '', { 'encoding-type': 'anndata', 'encoding-version': '0.1.0' })
  // The CSR matrix has a row per cell and a column per gene.
  group(matrix, 'X', { 'encoding-type': 'csr_matrix', shape: [4, 2] })
  array(matrix, 'X/indptr', '<i8', [0, 1, 2, 2, 4])
  array(matrix, 'X/indices', '<i8', [1, 0, 0, 1])
  array(matrix, 'X/data', '<i4', [3, 2, 4, 1])
  group(matrix, 'obs', {
    _index: 'barcode',
    'column-order': ['cell_id', 'centroid_column', 'centroid_row'],
    'encoding-type': 'dataframe',
  })
  strings(matrix, 'obs/barcode', ids)
  array(matrix, 'obs/cell_id', '<i8', [1, 2, 3, 4])
  array(
    matrix,
    'obs/centroid_column',
    '<f4',
    CELLS.map((cell) => cell.x),
  )
  array(
    matrix,
    'obs/centroid_row',
    '<f4',
    CELLS.map((cell) => cell.y),
  )
  group(matrix, 'obsm', { 'encoding-type': 'dict' })
  group(matrix, 'var', {
    _index: 'feature_id',
    'column-order': ['feature_name', 'feature_id'],
    'encoding-type': 'dataframe',
  })
  strings(matrix, 'var/feature_id', ['ENSG1', 'ENSG2'])
  strings(matrix, 'var/feature_name', [...GENES])
  // The CSC matrix reads a gene as a column: GENEA is in cells 1 and 3, GENEB
  // in cells 0 and 3.
  const csc = new Map<string, Uint8Array>()
  group(csc, '', { 'encoding-type': 'anndata' })
  group(csc, 'X', { 'encoding-type': 'csc_matrix', shape: [4, 2] })
  array(csc, 'X/indptr', '<i8', [0, 2, 4])
  array(csc, 'X/indices', '<i8', [1, 3, 0, 3])
  array(csc, 'X/data', '<i4', [2, 4, 3, 1])
  const stores = new Map([
    [`${baseUrl}/cell_feature_matrix.zarr.zip`, matrix],
    [`${baseUrl}/matrices/csc.zarr.zip`, csc],
  ])
  const openZipStore = async (url: string): Promise<AteraZipStore> => {
    const entries = stores.get(url)

    if (entries === undefined) {
      throw new Error(`No fixture for ${url}`)
    }

    return {
      entryNames: [...entries.keys()],
      store: { get: async (key: string) => entries.get(key.replace(/^\//, '')) },
    }
  }
  const dataset = new AteraDataset({
    baseUrl: `${baseUrl}/`,
    fetcher: (async (input: RequestInfo | URL) =>
      String(input) === `${baseUrl}/experiment.spatial`
        ? Response.json({
            pixel_size: 0.2125,
            explorer_files: { cell_feature_viz_zarr_filepath: 'matrices/csc.zarr.zip' },
          })
        : new Response(null, { status: 404 })) as typeof fetch,
    openZipStore,
  })

  return {
    ids,
    read: (box, options = {}) => dataset.geneExpression(box, SELECTED, options),
    population: 'all',
    sampled: { population: 'sampled', listed: [0, 1, 3], cellCount: 4 },
  }
}

const BIN_16: VisiumHdBinDescriptor = {
  binSizeMicrometers: 16,
  outputPath: 'binned_outputs/square_016um',
  tissuePositionsPath: 'binned_outputs/square_016um/spatial/tissue_positions.parquet',
  scalefactorsPath: 'binned_outputs/square_016um/spatial/scalefactors_json.json',
  filteredMatrixH5Path: 'binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
}

const SCALEFACTORS: VisiumHdScalefactors = {
  micronsPerPixel: 0.5,
  tissueHiresScale: 0.25,
  tissueLowresScale: 0.025,
  binSizeMicrometers: 16,
  spotDiameterFullres: 32,
  registrationTargetImageScale: 0.125,
  tissueHiresImageWidth: 6000,
  tissueHiresImageHeight: 5143,
  tissueLowresImageWidth: 600,
  tissueLowresImageHeight: 514,
}

async function visiumHdReader(): Promise<Reader> {
  const ids = layoutIds((index) => `BC-${index}`)
  // A 16 µm bin is 32 pixels at 0.5 µm per pixel. The array row runs along x
  // and the array column along y, as in the Visium HD dataset tests.
  const positions = parseVisiumHdTissuePositionRows(
    CELLS.map((cell, index) => ({
      barcode: ids[index],
      in_tissue: 1,
      array_row: (cell.x - 100) / 16,
      array_col: (cell.y - 200) / 16,
      pxl_row_in_fullres: cell.y * 2,
      pxl_col_in_fullres: cell.x * 2,
    })),
  )
  const dataset = new VisiumHdDataset({
    baseUrl: 'https://example.test/visium-hd/',
    bins: [BIN_16],
    tissuePositionsReader: async () => positions,
    scalefactorsReader: async () => SCALEFACTORS,
    featureSliceReader: async (_url, targets, genes) => ({
      geneNames: [...genes],
      cells: new Map(
        targets.map((target) => {
          const cell = ids.indexOf(target.id)
          const expressed = genes.filter((gene) => countOf(cell, gene) > 0)

          return [
            target.id,
            {
              geneNames: expressed,
              counts: expressed.map((gene) => countOf(cell, gene)),
            },
          ]
        }),
      ),
    }),
  })

  return {
    ids,
    read: (box, options = {}) => dataset.geneExpression(box, SELECTED, options),
    // Only the bins with expression are listed.
    population: 'expressing',
    // DIFFERS from the other readers: the stride thins the bins read, whether
    // or not they express. Bins 0 and 2 are read; the expressing bins 1 and 3
    // never are, so the batch lists none. The app asks Visium HD for a stride
    // of 1 only (planGeneExpressionLod), so this is not reached today.
    sampled: { population: 'expressing', listed: [], cellCount: 2 },
  }
}
