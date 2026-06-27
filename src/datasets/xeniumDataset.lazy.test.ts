import { describe, expect, it, vi } from 'vitest'
import { intToCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import { XeniumDataset } from './xeniumDataset'
import type {
  ArrowTableLike,
  DuckDbPreparedStatementLike,
  GexResult,
  SqlParameter,
} from '../data/gex'
import type { CellId } from '../data/cellid'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type { Annotation } from './spatialDataset'
import type { DuckDbClientLike } from './xeniumDataset'
import type { TiffPyramidLoader } from '../tiff/loader'

const lazyMocks = vi.hoisted(() => ({
  importedModules: [] as string[],
  createDuckDbClient: vi.fn(),
  gexFromCellFeatureMatrixZarr: vi.fn(),
  gexFromCellFeatureMatrixZarrRows: vi.fn(),
  gexFromCellFeatureMatrixZarrSelectedGenes: vi.fn(),
  gexFromTranscriptsParquet: vi.fn(),
  loadMorphologyImage: vi.fn(),
  openTiff: vi.fn(),
  readAnalysisZarrAnnotations: vi.fn(),
  readCellsOverview: vi.fn(),
}))

vi.mock('../data/analysisAnnotations', () => {
  lazyMocks.importedModules.push('analysisAnnotations')
  return {
    readAnalysisZarrAnnotations: lazyMocks.readAnalysisZarrAnnotations,
  }
})

vi.mock('../data/duckdb', () => {
  lazyMocks.importedModules.push('duckdb')
  return {
    createDuckDbClient: lazyMocks.createDuckDbClient,
  }
})

vi.mock('../data/gex', () => {
  lazyMocks.importedModules.push('gex')
  return {
    gexFromCellFeatureMatrixZarr: lazyMocks.gexFromCellFeatureMatrixZarr,
    gexFromCellFeatureMatrixZarrRows: lazyMocks.gexFromCellFeatureMatrixZarrRows,
    gexFromCellFeatureMatrixZarrSelectedGenes:
      lazyMocks.gexFromCellFeatureMatrixZarrSelectedGenes,
    gexFromTranscriptsParquet: lazyMocks.gexFromTranscriptsParquet,
  }
})

vi.mock('../data/hyparquetCells', () => {
  lazyMocks.importedModules.push('hyparquetCells')
  return {
    readCellsOverview: lazyMocks.readCellsOverview,
  }
})

vi.mock('../data/morphologyImage', () => {
  lazyMocks.importedModules.push('morphologyImage')
  return {
    loadMorphologyImage: lazyMocks.loadMorphologyImage,
  }
})

vi.mock('../tiff/loader', () => {
  lazyMocks.importedModules.push('tiffLoader')
  return {
    openTiff: lazyMocks.openTiff,
  }
})

class FakeTable implements ArrowTableLike {
  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  toArray(): readonly Record<string, unknown>[] {
    return this.rows
  }
}

class FakeStatement implements DuckDbPreparedStatementLike {
  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async query(...params: SqlParameter[]): Promise<ArrowTableLike> {
    void params
    return new FakeTable(this.rows)
  }
}

class FakeConnection {
  private preparedCount = 0

  constructor(
    private readonly rowsByQuery: readonly (readonly Record<string, unknown>[])[],
  ) {}

  async prepare(sql: string): Promise<DuckDbPreparedStatementLike> {
    void sql
    const rows = this.rowsByQuery[this.preparedCount] ?? []

    this.preparedCount += 1
    return new FakeStatement(rows)
  }
}

function gexResultFor(cellId: CellId, count: number): GexResult {
  return {
    geneNames: ['Actb'],
    cells: new Map([[cellId, { geneNames: ['Actb'], counts: [count] }]]),
  }
}

describe('XeniumDataset lazy defaults', () => {
  it('keeps heavyweight default readers unloaded until their capabilities run', async () => {
    lazyMocks.importedModules.length = 0
    vi.clearAllMocks()

    const cellId = intToCellId(1, 1)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({})))
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          cell_feature_matrix_row: 12n,
          x_centroid: 2,
          y_centroid: 3,
          transcript_counts: 5,
          cell_area: 8,
        },
      ],
    ])
    const duckClient: DuckDbClientLike = { conn }
    const overviewPoint: CellOverviewPoint = {
      cellId,
      position: { x: micrometers(2), y: micrometers(3) },
      transcriptCount: 5,
    }
    const annotation: Annotation = {
      id: 'analysis:0:0',
      label: 'graphclust: Cluster 1',
      cellIds: [cellId],
    }
    const tiffLoader = { levels: [] } as unknown as TiffPyramidLoader

    lazyMocks.createDuckDbClient.mockResolvedValue(duckClient)
    lazyMocks.gexFromCellFeatureMatrixZarr.mockResolvedValue(gexResultFor(cellId, 1))
    lazyMocks.gexFromCellFeatureMatrixZarrRows.mockResolvedValue(
      gexResultFor(cellId, 2),
    )
    lazyMocks.gexFromCellFeatureMatrixZarrSelectedGenes.mockResolvedValue(
      gexResultFor(cellId, 3),
    )
    lazyMocks.gexFromTranscriptsParquet.mockResolvedValue(gexResultFor(cellId, 4))
    lazyMocks.readCellsOverview.mockResolvedValue([overviewPoint])
    lazyMocks.readAnalysisZarrAnnotations.mockResolvedValue([annotation])
    lazyMocks.openTiff.mockResolvedValue(tiffLoader)
    lazyMocks.loadMorphologyImage.mockImplementation(
      async (
        _baseUrl: string,
        options: {
          readonly openImage: (
            url: string,
            signal?: AbortSignal,
          ) => Promise<TiffPyramidLoader>
        },
      ) => ({
        loader: await options.openImage(
          'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
        ),
      }),
    )

    const dataset = new XeniumDataset({
      baseUrl: 'https://example.test/xenium/',
      fetcher,
    })

    expect(lazyMocks.importedModules).toEqual([])
    expect(lazyMocks.createDuckDbClient).not.toHaveBeenCalled()

    await expect(dataset.matrix([cellId])).resolves.toMatchObject({
      geneNames: ['Actb'],
    })
    expect(lazyMocks.importedModules).toEqual(['gex'])
    expect(lazyMocks.gexFromCellFeatureMatrixZarr).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      [cellId],
    )

    await dataset.matrixForCells([
      {
        id: cellId,
        position: { x: micrometers(2), y: micrometers(3) },
        transcriptCount: 5,
        cellArea: 8,
        cellFeatureMatrixRow: 12,
      },
    ])
    expect(lazyMocks.gexFromCellFeatureMatrixZarrRows).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      [{ id: cellId, row: 12 }],
    )

    await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(0),
        maxY: micrometers(10),
      },
      ['Actb'],
    )
    expect(lazyMocks.importedModules).toEqual(['gex', 'duckdb'])
    expect(lazyMocks.createDuckDbClient).toHaveBeenCalledOnce()
    expect(lazyMocks.gexFromCellFeatureMatrixZarrSelectedGenes).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      [cellId],
      ['Actb'],
      {},
    )

    await dataset.transcripts(
      {
        kind: 'circle',
        cx: micrometers(2),
        cy: micrometers(3),
        radius: micrometers(1),
      },
      'spatial',
      25,
    )
    expect(lazyMocks.gexFromTranscriptsParquet).toHaveBeenCalledWith(
      conn,
      'https://example.test/xenium/transcripts.parquet',
      expect.objectContaining({ kind: 'circle' }),
      'spatial',
      [],
      25,
    )

    await expect(dataset.overviewCells(50)).resolves.toEqual([overviewPoint])
    expect(lazyMocks.readCellsOverview).toHaveBeenCalledWith({
      url: 'https://example.test/xenium/cells.parquet',
      fetcher,
      limit: 50,
    })

    await expect(dataset.annotations({ groupId: 'analysis:0' })).resolves.toEqual([
      annotation,
    ])
    expect(lazyMocks.readAnalysisZarrAnnotations).toHaveBeenCalledWith(
      'https://example.test/xenium/analysis.zarr.zip',
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      { groupId: 'analysis:0' },
    )

    await expect(dataset.image()).resolves.toEqual({
      kind: 'pyramid',
      loader: tiffLoader,
    })
    expect(lazyMocks.loadMorphologyImage).toHaveBeenCalledWith(
      'https://example.test/xenium',
      {
        fetcher,
        openImage: expect.any(Function),
      },
    )
    expect(lazyMocks.openTiff).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
      undefined,
    )

    expect(lazyMocks.importedModules).toEqual([
      'gex',
      'duckdb',
      'hyparquetCells',
      'analysisAnnotations',
      'morphologyImage',
      'tiffLoader',
    ])
  })
})
