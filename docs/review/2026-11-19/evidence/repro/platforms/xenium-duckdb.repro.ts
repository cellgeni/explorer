// @vitest-environment node
// PLT review: Xenium readers against a real DuckDB-WASM (Node build) and
// tiny Parquet files written by DuckDB, typed like XOA 2.x output.
//
// Expected values are written by hand from the XOA file contract:
// - transcripts.parquet `cell_id` is "UNASSIGNED" for transcripts outside
//   every cell (seen in the demo's first row group: 2,330 of 262,144 rows,
//   1,808 of them gene calls with QV >= 20; evidence/platforms/
//   xenium-demo-transcripts-unassigned.log).
// - nucleus_boundaries.parquet has label_id from XOA 2.0; 1.x files lack it.
// - XOA 1.0.x wrote int32 cell_id (documented as unsupported).
//
// Run: npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//        docs/review/2026-11-19/evidence/repro/platforms/xenium-duckdb.repro.ts
import { beforeAll, describe, expect, it } from 'vitest'
import { micrometers } from '../../../../../../src/data/coords'
import { loadDatasetRoiTranscripts } from '../../../../../../src/data/roiTranscripts'
import { loadDatasetTranscriptViewport } from '../../../../../../src/data/transcriptOverlay'
import { XeniumDataset } from '../../../../../../src/datasets/xeniumDataset'
import { createNodeDuckDb, type NodeDuckDb } from './duckdbNode'
import type { CellId } from '../../../../../../src/data/cellid'
import type { SelectedGeneMatrixRows } from '../../../../../../src/data/gex'

const BOX = {
  minX: micrometers(0),
  maxX: micrometers(100),
  minY: micrometers(0),
  maxY: micrometers(100),
}

let duck: NodeDuckDb
let BASE = ''

function dataset(
  overrides: Partial<ConstructorParameters<typeof XeniumDataset>[0]> = {},
): XeniumDataset {
  return new XeniumDataset({
    baseUrl: BASE,
    duckDbClient: duck.client as never,
    fetcher: async () => new Response('{}'),
    validateRangeSupport: async () => {},
    ...overrides,
  })
}

beforeAll(async () => {
  duck = await createNodeDuckDb()
  BASE = `${duck.dir}/xenium`
  // Two transcripts in the box: one in cell aaaaaaab-1, one outside every
  // cell. Both are gene calls with QV >= 20, so both pass the default filters.
  duck.parquet(
    `${BASE}/transcripts.parquet`,
    `SELECT * FROM (VALUES
      (1::UBIGINT, 'aaaaaaab-1', 1::UTINYINT, 'GENE_A', 10.0::FLOAT, 20.0::FLOAT, 5.0::FLOAT, 30.0::FLOAT, 'fov_1', 0.0::FLOAT, true),
      (2::UBIGINT, 'UNASSIGNED', 0::UTINYINT, 'GENE_A', 30.0::FLOAT, 40.0::FLOAT, 6.0::FLOAT, 35.0::FLOAT, 'fov_1', 4.5::FLOAT, true)
    ) t(transcript_id, cell_id, overlaps_nucleus, feature_name, x_location, y_location, z_location, qv, fov_name, nucleus_distance, is_gene)`,
  )
}, 60_000)

describe('Xenium transcripts.parquet with UNASSIGNED cell_id (XOA >= 1.3)', () => {
  it('ROI transcript export returns both transcripts, the unassigned one with no cell', async () => {
    const read = loadDatasetRoiTranscripts(
      BASE,
      { kind: 'box', bbox: BOX },
      { getDataset: () => dataset(), validateRangeSupport: async () => {} },
    )

    // Expected (hand-written): two rows, cell IDs ['aaaaaaab-1', null].
    await expect(read.then((rows) => rows.map((row) => row.cellId))).resolves.toEqual([
      'aaaaaaab-1',
      null,
    ])
  })

  it('exact transcripts from transcripts.parquet mark the unassigned one as unassigned', async () => {
    const read = loadDatasetTranscriptViewport(BASE, BOX, {
      getDataset: () => dataset(),
      // No transcripts.zarr.zip: the Parquet path is the only exact source.
      validateRangeSupport: async (url: string) => {
        if (url.endsWith('transcripts.zarr.zip')) throw new Error('404')
      },
      onFallback: () => {},
    })

    await expect(
      read.then((result) => result.points.map((point) => point.cellAssignment)),
    ).resolves.toEqual(['known', 'unassigned'])
  })
})

describe('Xenium nucleus_boundaries.parquet label_id (real DuckDB errors)', () => {
  beforeAll(() => {
    duck.parquet(
      `${BASE}/cells.parquet`,
      `SELECT * FROM (VALUES
        ('aaaaaaab-1', 10.0::DOUBLE, 20.0::DOUBLE, 5::BIGINT, 30.0::DOUBLE),
        ('aaaaaaac-1', 60.0::DOUBLE, 70.0::DOUBLE, 7::BIGINT, 40.0::DOUBLE)
      ) t(cell_id, x_centroid, y_centroid, transcript_counts, cell_area)`,
    )
  })

  it('XOA 2.x: a cell with two nuclei gives <cell> and <cell>#nucleus-2', async () => {
    duck.parquet(
      `${BASE}/nucleus_boundaries.parquet`,
      `SELECT * FROM (VALUES
        ('aaaaaaab-1', 9.0::FLOAT, 19.0::FLOAT, 1::UINT32), ('aaaaaaab-1', 10.0::FLOAT, 19.0::FLOAT, 1::UINT32), ('aaaaaaab-1', 10.0::FLOAT, 20.0::FLOAT, 1::UINT32),
        ('aaaaaaab-1', 11.0::FLOAT, 21.0::FLOAT, 2::UINT32), ('aaaaaaab-1', 12.0::FLOAT, 21.0::FLOAT, 2::UINT32), ('aaaaaaab-1', 12.0::FLOAT, 22.0::FLOAT, 2::UINT32),
        ('aaaaaaac-1', 60.0::FLOAT, 70.0::FLOAT, 1::UINT32), ('aaaaaaac-1', 61.0::FLOAT, 70.0::FLOAT, 1::UINT32), ('aaaaaaac-1', 61.0::FLOAT, 71.0::FLOAT, 1::UINT32)
      ) t(cell_id, vertex_x, vertex_y, label_id)`,
    )
    const nuclei = await dataset().segmentationElements('nucleus', BOX)

    expect(nuclei.map((nucleus) => nucleus.id).sort()).toEqual([
      'aaaaaaab-1',
      'aaaaaaab-1#nucleus-2',
      'aaaaaaac-1',
    ])
  })

  it('XOA 1.x: no label_id column falls back to one nucleus per cell', async () => {
    // Its own folder: DuckDB caches a file's metadata by path.
    const base = `${duck.dir}/xenium-xoa1`
    duck.parquet(
      `${base}/cells.parquet`,
      `SELECT * FROM read_parquet('${BASE}/cells.parquet')`,
    )
    duck.parquet(
      `${base}/nucleus_boundaries.parquet`,
      `SELECT * FROM (VALUES
        ('aaaaaaab-1', 9.0::FLOAT, 19.0::FLOAT), ('aaaaaaab-1', 10.0::FLOAT, 19.0::FLOAT), ('aaaaaaab-1', 10.0::FLOAT, 20.0::FLOAT),
        ('aaaaaaac-1', 60.0::FLOAT, 70.0::FLOAT), ('aaaaaaac-1', 61.0::FLOAT, 70.0::FLOAT), ('aaaaaaac-1', 61.0::FLOAT, 71.0::FLOAT)
      ) t(cell_id, vertex_x, vertex_y)`,
    )
    const nuclei = await dataset({ baseUrl: base }).segmentationElements('nucleus', BOX)

    expect(nuclei.map((nucleus) => nucleus.id).sort()).toEqual([
      'aaaaaaab-1',
      'aaaaaaac-1',
    ])
  })
})

describe('Xenium cells.parquet with int32 cell_id (XOA 1.0.x, documented unsupported)', () => {
  it('ROI cells reject with a message', async () => {
    const url = `${duck.dir}/xenium-v1/cells.parquet`
    duck.parquet(
      url,
      `SELECT * FROM (VALUES (1::INTEGER, 10.0::DOUBLE, 20.0::DOUBLE, 5::BIGINT, 30.0::DOUBLE))
       t(cell_id, x_centroid, y_centroid, transcript_counts, cell_area)`,
    )
    const ds = new XeniumDataset({
      baseUrl: `${duck.dir}/xenium-v1`,
      duckDbClient: duck.client as never,
      fetcher: async () => new Response('{}'),
    })

    await expect(ds.cells({ kind: 'box', bbox: BOX })).rejects.toThrow(
      'Expected viewport cell row cell_id to be a string.',
    )
  })
})

describe('Xenium selected-gene expression joined by matrix row', () => {
  // Matrix rows (cell_feature_matrix.zarr.zip order) and GENE_A counts:
  //   row 0 aaaaaaaa-1: 1, row 1 aaaaaaab-1: 2, row 2 aaaaaaac-1: 3, row 3 aaaaaaad-1: 4
  const matrixOrder = ['aaaaaaaa-1', 'aaaaaaab-1', 'aaaaaaac-1', 'aaaaaaad-1'] as CellId[]
  const expected = new Map([
    ['aaaaaaaa-1', 1],
    ['aaaaaaab-1', 2],
    ['aaaaaaac-1', 3],
    ['aaaaaaad-1', 4],
  ])
  const rowsReader = async (): Promise<SelectedGeneMatrixRows> => ({
    nCells: 4,
    features: [
      {
        gene: 'GENE_A',
        rows: Uint32Array.from([0, 1, 2, 3]),
        counts: Uint32Array.from([1, 2, 3, 4]),
      },
    ],
    cellIdForRow: (row) => matrixOrder[row] as CellId,
  })
  const byIdReader = async (_url: string, ids: readonly CellId[]) => ({
    geneNames: ['GENE_A'],
    cells: new Map(
      ids.map((id) => [id, { geneNames: ['GENE_A'], counts: [expected.get(id) ?? 0] }]),
    ),
  })

  it('cells.parquet in a different order: counts still follow cell IDs', async () => {
    const base = `${duck.dir}/xenium-reordered`
    duck.parquet(
      `${base}/cells.parquet`,
      `SELECT * FROM (VALUES
        ('aaaaaaab-1', 10.0::DOUBLE, 10.0::DOUBLE, 5::BIGINT, 30.0::DOUBLE),
        ('aaaaaaaa-1', 20.0::DOUBLE, 20.0::DOUBLE, 5::BIGINT, 30.0::DOUBLE),
        ('aaaaaaad-1', 30.0::DOUBLE, 30.0::DOUBLE, 5::BIGINT, 30.0::DOUBLE),
        ('aaaaaaac-1', 40.0::DOUBLE, 40.0::DOUBLE, 5::BIGINT, 30.0::DOUBLE)
      ) t(cell_id, x_centroid, y_centroid, transcript_counts, cell_area)`,
    )
    const ds = new XeniumDataset({
      baseUrl: base,
      duckDbClient: duck.client as never,
      fetcher: async () => new Response('{}'),
      selectedGeneRowsReader: rowsReader,
      geneExpressionMatrixReader: byIdReader,
    })
    const batch = await ds.geneExpression(BOX, ['GENE_A'], { limit: 100 })

    expect(new Map(batch.elements.map((element) => [element.id, element.count]))).toEqual(
      expected,
    )
  })
})
