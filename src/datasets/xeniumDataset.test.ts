import { describe, expect, it, vi } from 'vitest'
import { intToCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import { XeniumDataset } from './xeniumDataset'
import type {
  ArrowTableLike,
  DuckDbPreparedStatementLike,
  SqlParameter,
} from '../data/gex'
import type { CellId } from '../data/cellid'
import type { DuckDbClientLike, XeniumDuckDbConnection } from './xeniumDataset'
import type { GexResult } from '../data/gex'
import type { TiffPyramidLoader } from '../tiff/loader'

class FakeTable implements ArrowTableLike {
  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  toArray(): readonly Record<string, unknown>[] {
    return this.rows
  }
}

class FakeStatement implements DuckDbPreparedStatementLike {
  params: readonly SqlParameter[] = []

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async query(...params: SqlParameter[]): Promise<ArrowTableLike> {
    this.params = params
    return new FakeTable(this.rows)
  }
}

class FakeConnection implements XeniumDuckDbConnection {
  readonly preparedSql: string[] = []
  readonly statements: FakeStatement[] = []

  constructor(
    private readonly rowsByQuery: readonly (readonly Record<string, unknown>[])[],
  ) {}

  async prepare(sql: string): Promise<DuckDbPreparedStatementLike> {
    const rows = this.rowsByQuery[this.statements.length] ?? []
    const statement = new FakeStatement(rows)

    this.preparedSql.push(sql)
    this.statements.push(statement)
    return statement
  }
}

function makeDataset(
  conn: XeniumDuckDbConnection,
  overrides: Partial<ConstructorParameters<typeof XeniumDataset>[0]> = {},
) {
  const duckDbClient: DuckDbClientLike = { conn }

  return new XeniumDataset({
    baseUrl: 'https://example.test/xenium/',
    duckDbClient,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          pixel_size: 0.5,
          images: {
            morphology_filepath: 'morphology.ome.tif',
            morphology_focus_filepath: 'morphology_focus/morphology_focus_0000.ome.tif',
          },
        }),
      ),
    openTiff: async () => ({}) as TiffPyramidLoader,
    ...overrides,
  })
}

describe('XeniumDataset', () => {
  it('loads metadata with capability flags and cell extent', async () => {
    const conn = new FakeConnection([[{ minX: 1, maxX: 20, minY: 2, maxY: 30 }]])
    const dataset = makeDataset(conn)

    await expect(dataset.meta()).resolves.toMatchObject({
      platform: 'xenium',
      units: {
        micrometersPerPixel: micrometers(0.5),
      },
      extent: {
        minX: micrometers(1),
        maxX: micrometers(20),
        minY: micrometers(2),
        maxY: micrometers(30),
      },
      capabilities: {
        transcripts: true,
        cellBoundaries: true,
        pyramidImage: true,
        multiChannel: false,
      },
    })
  })

  it('groups boundary vertices into polygon elements', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        { cell_id: cellId, x: 0, y: 0 },
        { cell_id: cellId, x: 10, y: 0 },
        { cell_id: cellId, x: 10, y: 10 },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.elements({
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(0),
        maxY: micrometers(10),
      }),
    ).resolves.toEqual({
      elements: [
        {
          id: cellId,
          geometry: {
            kind: 'polygon',
            rings: [
              [
                { x: micrometers(0), y: micrometers(0) },
                { x: micrometers(10), y: micrometers(0) },
                { x: micrometers(10), y: micrometers(10) },
              ],
            ],
          },
        },
      ],
    })
    expect(conn.statements[0]?.params).toContain(
      'https://example.test/xenium/cell_boundaries.parquet',
    )
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/cells.parquet',
      micrometers(-75),
      micrometers(85),
      micrometers(-75),
      micrometers(85),
      'https://example.test/xenium/cell_boundaries.parquet',
      micrometers(-150),
      micrometers(160),
      micrometers(-150),
      micrometers(160),
    ])
    expect(conn.preparedSql[0]).toContain('ORDER BY b.cell_id, b.file_row_number')
    expect(conn.preparedSql[0]).toContain('b.vertex_x BETWEEN')
  })

  it('delegates matrix, transcripts, and pyramid image loading', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([[{ cell_id: cellId }]])
    const matrixReader = vi.fn(
      async (_url: string, ids: readonly CellId[]): Promise<GexResult> => ({
        geneNames: ['Gad1'],
        cells: new Map(ids.map((id) => [id, { geneNames: ['Gad1'], counts: [1] }])),
      }),
    )
    const transcriptReader = vi.fn(
      async (): Promise<GexResult> => ({
        geneNames: [],
        cells: new Map(),
      }),
    )
    const overviewReader = vi.fn(async () => [
      {
        cellId,
        position: { x: micrometers(1), y: micrometers(2) },
        transcriptCount: 3,
      },
    ])
    const openTiff = vi.fn(async () => ({}) as TiffPyramidLoader)
    const dataset = makeDataset(conn, {
      matrixReader,
      transcriptReader,
      overviewReader,
      openTiff,
    })

    await dataset.matrix([cellId])
    await dataset.overviewCells(500)
    await dataset.transcripts(
      {
        kind: 'circle',
        cx: micrometers(5),
        cy: micrometers(5),
        radius: micrometers(2),
      },
      'cells-only',
      25,
    )
    await expect(dataset.image()).resolves.toMatchObject({ kind: 'pyramid' })

    expect(matrixReader).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      [cellId],
    )
    expect(overviewReader).toHaveBeenCalledWith(
      'https://example.test/xenium/cells.parquet',
      500,
    )
    expect(transcriptReader).toHaveBeenCalledWith(
      conn,
      'https://example.test/xenium/transcripts.parquet',
      expect.objectContaining({ kind: 'circle' }),
      'cells-only',
      [cellId],
      25,
    )
    expect(openTiff).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
    )
  })

  it('warms and reuses the memoized DuckDB client before ROI queries', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          x_centroid: 1,
          y_centroid: 2,
          transcript_counts: 3,
          cell_area: 4,
        },
      ],
    ])
    const createDuckDbClient = vi.fn(async (): Promise<DuckDbClientLike> => ({ conn }))
    const dataset = new XeniumDataset({
      baseUrl: 'https://example.test/xenium/',
      createDuckDbClient,
      fetcher: async () => new Response(JSON.stringify({})),
      openTiff: async () => ({}) as TiffPyramidLoader,
    })

    await dataset.warm()
    await dataset.cells({
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    })

    expect(createDuckDbClient).toHaveBeenCalledOnce()
    expect(conn.preparedSql[0]).toContain('FROM read_parquet( ? )')
  })

  it('loads transcript expression directly for known cell ids', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([])
    const transcriptReader = vi.fn(
      async (): Promise<GexResult> => ({
        geneNames: ['Actb'],
        cells: new Map([[cellId, { geneNames: ['Actb'], counts: [4] }]]),
      }),
    )
    const dataset = makeDataset(conn, { transcriptReader })

    await expect(dataset.transcriptsForCellIds([cellId], 30)).resolves.toMatchObject({
      geneNames: ['Actb'],
    })

    expect(transcriptReader).toHaveBeenCalledWith(
      conn,
      'https://example.test/xenium/transcripts.parquet',
      expect.objectContaining({ kind: 'circle' }),
      'cells-only',
      [cellId],
      30,
    )
    expect(conn.preparedSql).toHaveLength(0)
  })

  it('loads raw transcript rows within a bounding box for ROI export', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          feature_name: 'Actb',
          x_location: 2,
          y_location: 3,
          z_location: 1,
          qv: 35,
          overlaps_nucleus: true,
          is_gene: true,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.transcriptsInBbox(
        {
          minX: micrometers(0),
          maxX: micrometers(10),
          minY: micrometers(1),
          maxY: micrometers(20),
        },
        { limit: 250, minQv: 30 },
      ),
    ).resolves.toEqual([
      {
        cellId,
        featureName: 'Actb',
        position: { x: micrometers(2), y: micrometers(3) },
        zLocation: 1,
        qv: 35,
        overlapsNucleus: true,
        isGene: true,
      },
    ])
    expect(conn.preparedSql[0]).toContain('FROM read_parquet( ? )')
    expect(conn.preparedSql[0]).toContain('x_location BETWEEN ? AND ?')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(1),
      micrometers(20),
      30,
      250,
    ])
  })

  it('loads raw transcript rows for a selected cell', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          feature_name: 'Actb',
          x_location: 2,
          y_location: 3,
          z_location: 1,
          qv: 35,
          overlaps_nucleus: true,
          is_gene: true,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.transcriptsForCellId(cellId, { limit: 500, minQv: 30 }),
    ).resolves.toEqual([
      {
        cellId,
        featureName: 'Actb',
        position: { x: micrometers(2), y: micrometers(3) },
        zLocation: 1,
        qv: 35,
        overlapsNucleus: true,
        isGene: true,
      },
    ])
    expect(conn.preparedSql[0]).toContain('cell_id = ?')
    expect(conn.preparedSql[0]).toContain('ORDER BY z_location, feature_name')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      cellId,
      30,
      500,
    ])
  })

  it('loads selected-cell transcript z distribution with aggregate SQL', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          transcript_count: 4,
          z_count: 3,
          missing_z_count: 1,
          min_z: 0,
          max_z: 2,
          bin_index: 0,
          bin_count: 2,
        },
        {
          transcript_count: 4,
          z_count: 3,
          missing_z_count: 1,
          min_z: 0,
          max_z: 2,
          bin_index: 1,
          bin_count: 1,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.cellTranscriptZDistributionForCellId(cellId, {
        limit: 500,
        minQv: 30,
        binCount: 2,
      }),
    ).resolves.toEqual({
      bins: [
        { minZ: 0, maxZ: 1, count: 2, percent: 66.66666666666666 },
        { minZ: 1, maxZ: 2, count: 1, percent: 33.33333333333333 },
      ],
      transcriptCount: 4,
      zCount: 3,
      missingZCount: 1,
      minZ: 0,
      maxZ: 2,
      maxBinCount: 2,
      hitTranscriptLimit: false,
      minQv: 30,
    })
    expect(conn.preparedSql[0]).toContain('SELECT z_location')
    expect(conn.preparedSql[0]).toContain('COUNT(z_location) AS z_count')
    expect(conn.preparedSql[0]).toContain('GROUP BY bin_index')
    expect(conn.preparedSql[0]).not.toContain('feature_name')
    expect(conn.preparedSql[0]).not.toContain('x_location')
    expect(conn.preparedSql[0]).not.toContain('ORDER BY z_location')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      cellId,
      30,
      500,
      2,
      2,
    ])
  })

  it('adds spatial predicates to selected-cell transcript z distribution queries', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          transcript_count: 2,
          z_count: 2,
          missing_z_count: 0,
          min_z: 1,
          max_z: 2,
          bin_index: 0,
          bin_count: 2,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await dataset.cellTranscriptZDistributionForCellId(cellId, {
      limit: 500,
      minQv: 30,
      binCount: 2,
      bbox: {
        minX: micrometers(10),
        maxX: micrometers(20),
        minY: micrometers(30),
        maxY: micrometers(40),
      },
    })

    expect(conn.preparedSql[0]).toContain('cell_id = ?')
    expect(conn.preparedSql[0]).toContain('x_location BETWEEN ? AND ?')
    expect(conn.preparedSql[0]).toContain('y_location BETWEEN ? AND ?')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      cellId,
      30,
      micrometers(10),
      micrometers(20),
      micrometers(30),
      micrometers(40),
      500,
      2,
      2,
    ])
  })

  it('loads raw transcript rows within a lasso ROI for exact export', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          feature_name: 'Actb',
          x_location: 2,
          y_location: 3,
          z_location: 1,
          qv: 35,
          overlaps_nucleus: true,
          is_gene: true,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.transcriptsForSelection(
        {
          kind: 'lasso',
          bbox: {
            minX: micrometers(0),
            maxX: micrometers(10),
            minY: micrometers(1),
            maxY: micrometers(20),
          },
          points: [
            { x: micrometers(0), y: micrometers(1) },
            { x: micrometers(10), y: micrometers(1) },
            { x: micrometers(10), y: micrometers(20) },
          ],
        },
        { limit: 250, minQv: 30 },
      ),
    ).resolves.toHaveLength(1)

    expect(conn.preparedSql[0]).toContain('ST_Within')
    expect(conn.preparedSql[0]).toContain('x_location BETWEEN ? AND ?')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(1),
      micrometers(20),
      'POLYGON((0 1, 10 1, 10 20, 0 1))',
      30,
      250,
    ])
  })

  it('loads exact transcript points and gene/FOV groups for a viewport', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          transcript_id: 12,
          cell_id: cellId,
          feature_name: 'Actb',
          x_location: 2,
          y_location: 3,
          z_location: 1,
          qv: 35,
          fov_name: 'FOV-001',
          overlaps_nucleus: 1,
          nucleus_distance: 0,
          is_gene: true,
        },
      ],
      [
        {
          feature_name: 'Actb',
          fov_name: 'FOV-001',
          count: 7,
          mean_qv: 33.5,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.transcriptsForViewport(
        {
          minX: micrometers(0),
          maxX: micrometers(10),
          minY: micrometers(1),
          maxY: micrometers(20),
        },
        {
          pointLimit: 250,
          groupLimit: 12,
          minQv: 30,
          geneOnly: true,
          featureNames: ['Actb'],
        },
      ),
    ).resolves.toEqual({
      points: [
        {
          id: '12',
          transcriptId: '12',
          cellId,
          cellAssignment: 'known',
          featureName: 'Actb',
          fovName: 'FOV-001',
          position: { x: micrometers(2), y: micrometers(3) },
          zLocation: 1,
          qv: 35,
          overlapsNucleus: true,
          nucleusDistance: 0,
          isGene: true,
        },
      ],
      groups: [
        {
          featureName: 'Actb',
          fovName: 'FOV-001',
          count: 7,
          meanQv: 33.5,
        },
      ],
      hitPointLimit: false,
    })
    expect(conn.preparedSql[0]).not.toContain('ORDER BY')
    expect(conn.preparedSql[0]).toContain('feature_name IN (?)')
    expect(conn.preparedSql[1]).toContain('GROUP BY feature_name, fov_name')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(1),
      micrometers(20),
      30,
      'Actb',
      251,
    ])
    expect(conn.statements[1]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(1),
      micrometers(20),
      30,
      'Actb',
      12,
    ])
  })

  it('loads viewport-scoped expression counts for selected genes', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          x_centroid: 2,
          y_centroid: 3,
          transcript_counts: 25,
          cell_area: 40,
        },
      ],
    ])
    const matrixReader = vi.fn(
      async (_url: string, ids: readonly CellId[]): Promise<GexResult> => ({
        geneNames: ['Actb', 'Gad1', 'Slc17a7'],
        cells: new Map(
          ids.map((id) => [
            id,
            { geneNames: ['Actb', 'Gad1', 'Slc17a7'], counts: [7, 2, 3] },
          ]),
        ),
      }),
    )
    const dataset = makeDataset(conn, { matrixReader })

    await expect(
      dataset.geneExpression(
        {
          minX: micrometers(0),
          maxX: micrometers(10),
          minY: micrometers(0),
          maxY: micrometers(20),
        },
        ['Slc17a7', 'Gad1', 'Gad1'],
        { limit: 100 },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        genes: ['Gad1', 'Slc17a7'],
        maxCount: 5,
        elements: [
          {
            id: cellId,
            position: { x: micrometers(2), y: micrometers(3) },
            transcriptCount: 25,
            cellArea: 40,
            count: 5,
          },
        ],
        timing: {
          viewportCellsMs: expect.any(Number),
          matrixReadMs: expect.any(Number),
          scoreCellsMs: expect.any(Number),
          totalMs: expect.any(Number),
        },
      }),
    )

    expect(conn.preparedSql[0]).toContain('SELECT cell_id')
    expect(conn.preparedSql[0]).toContain('ORDER BY file_row_number')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/cells.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(0),
      micrometers(20),
      100,
    ])
    expect(matrixReader).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      [cellId],
    )
  })

  it('loads true cell ids and observations for a rectangular ROI', async () => {
    const cellId = intToCellId(1, 5)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          cell_feature_matrix_row: 17n,
          x_centroid: 12,
          y_centroid: 24,
          transcript_counts: 90,
          cell_area: 35,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.cells(
        {
          minX: micrometers(10),
          maxX: micrometers(20),
          minY: micrometers(20),
          maxY: micrometers(30),
        },
        { limit: 75 },
      ),
    ).resolves.toEqual([
      {
        id: cellId,
        position: { x: micrometers(12), y: micrometers(24) },
        transcriptCount: 90,
        cellArea: 35,
        cellFeatureMatrixRow: 17,
      },
    ])

    expect(conn.preparedSql[0]).toContain('FROM read_parquet')
    expect(conn.preparedSql[0]).toContain('ORDER BY file_row_number')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/cells.parquet',
      micrometers(10),
      micrometers(20),
      micrometers(20),
      micrometers(30),
      75,
    ])
  })

  it('loads true cell ids and observations for a lasso ROI', async () => {
    const cellId = intToCellId(1, 5)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          cell_feature_matrix_row: 17n,
          x_centroid: 12,
          y_centroid: 24,
          transcript_counts: 90,
          cell_area: 35,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.cells(
        {
          kind: 'lasso',
          bbox: {
            minX: micrometers(10),
            maxX: micrometers(20),
            minY: micrometers(20),
            maxY: micrometers(30),
          },
          points: [
            { x: micrometers(10), y: micrometers(20) },
            { x: micrometers(20), y: micrometers(20) },
            { x: micrometers(20), y: micrometers(30) },
          ],
        },
        { limit: 75 },
      ),
    ).resolves.toHaveLength(1)

    expect(conn.preparedSql[0]).toContain('ST_Within')
    expect(conn.preparedSql[0]).toContain('x_centroid BETWEEN ? AND ?')
    expect(conn.preparedSql[0]).toContain('ORDER BY file_row_number')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/cells.parquet',
      micrometers(10),
      micrometers(20),
      micrometers(20),
      micrometers(30),
      'POLYGON((10 20, 20 20, 20 30, 10 20))',
      75,
    ])
  })

  it('loads annotations from analysis.zarr and cell-feature matrix row ids', async () => {
    const conn = new FakeConnection([])
    const annotations = [
      {
        id: 'analysis:0:0',
        label: 'graphclust: Cluster 1',
        cellIds: [intToCellId(1, 1)],
      },
    ]
    const analysisAnnotationReader = vi.fn(async () => annotations)
    const dataset = makeDataset(conn, { analysisAnnotationReader })

    await expect(dataset.annotations()).resolves.toBe(annotations)
    expect(analysisAnnotationReader).toHaveBeenCalledWith(
      'https://example.test/xenium/analysis.zarr.zip',
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      {},
    )

    await dataset.annotations({ groupId: 'analysis:1' })
    expect(analysisAnnotationReader).toHaveBeenLastCalledWith(
      'https://example.test/xenium/analysis.zarr.zip',
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      { groupId: 'analysis:1' },
    )
  })

  it('applies a deterministic viewport-cell stride for sampled expression queries', async () => {
    const cellId = intToCellId(1, 2)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          x_centroid: 4,
          y_centroid: 6,
          transcript_counts: 12,
          cell_area: 18,
        },
      ],
    ])
    const matrixReader = vi.fn(
      async (_url: string, ids: readonly CellId[]): Promise<GexResult> => ({
        geneNames: ['Actb'],
        cells: new Map(ids.map((id) => [id, { geneNames: ['Actb'], counts: [2] }])),
      }),
    )
    const dataset = makeDataset(conn, { matrixReader })

    await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(0),
        maxY: micrometers(20),
      },
      ['Actb'],
      { limit: 100, sampleStride: 3 },
    )

    expect(conn.preparedSql[0]).toContain('hash(cell_id) % ? = 0')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/cells.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(0),
      micrometers(20),
      3,
      100,
    ])
  })
})
