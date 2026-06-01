import { asCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import {
  gexFromCellFeatureMatrixZarr,
  gexFromTranscriptsParquet,
  selectionToSql,
} from '../data/gex'
import { createDuckDbClient } from '../data/duckdb'
import { readCellsOverview } from '../data/hyparquetCells'
import { openTiff } from '../tiff/loader'
import type { CellId } from '../data/cellid'
import type { BBox, DataPoint, UnitsDescriptor } from '../data/coords'
import type { TiffPyramidLoader } from '../tiff/loader'
import type {
  DuckDbPreparedStatementLike,
  GexResult,
  Selection,
  TranscriptDuckDbConnection,
  TranscriptScope,
} from '../data/gex'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
} from './spatialDataset'

export interface XeniumDatasetOptions {
  readonly baseUrl: string
  readonly fetcher?: typeof fetch
  readonly duckDbClient?: DuckDbClientLike | Promise<DuckDbClientLike>
  readonly createDuckDbClient?: () => Promise<DuckDbClientLike>
  readonly openTiff?: (url: string, signal?: AbortSignal) => Promise<TiffPyramidLoader>
  readonly matrixReader?: (url: string, ids: readonly CellId[]) => Promise<GexResult>
  readonly transcriptReader?: typeof gexFromTranscriptsParquet
  readonly overviewReader?: (
    url: string,
    limit?: number,
  ) => Promise<readonly CellOverviewPoint[]>
}

export interface DuckDbClientLike {
  readonly conn: XeniumDuckDbConnection
  close?(): Promise<void>
}

export interface XeniumDuckDbConnection extends TranscriptDuckDbConnection {
  prepare(sql: string): Promise<DuckDbPreparedStatementLike>
}

const DEFAULT_XENIUM_UNITS: UnitsDescriptor = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(0.2125),
  origin: 'top-left',
  imageYAxis: 'down',
}

export class XeniumDataset implements SpatialDataset {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch
  private readonly duckFactory: () => Promise<DuckDbClientLike>
  private readonly tiffOpener: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<TiffPyramidLoader>
  private readonly matrixReader: (
    url: string,
    ids: readonly CellId[],
  ) => Promise<GexResult>
  private readonly transcriptReader: typeof gexFromTranscriptsParquet
  private readonly overviewReader: (
    url: string,
    limit?: number,
  ) => Promise<readonly CellOverviewPoint[]>
  private duckClientPromise: Promise<DuckDbClientLike> | null = null
  private metaPromise: Promise<DatasetMeta> | null = null

  constructor(options: XeniumDatasetOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.tiffOpener = options.openTiff ?? openTiff
    this.matrixReader = options.matrixReader ?? gexFromCellFeatureMatrixZarr
    this.transcriptReader = options.transcriptReader ?? gexFromTranscriptsParquet
    this.overviewReader =
      options.overviewReader ??
      ((url, limit) =>
        readCellsOverview({
          url,
          fetcher: this.fetcher,
          ...(limit === undefined ? {} : { limit }),
        }))
    this.duckFactory =
      options.createDuckDbClient ??
      (() => {
        if (options.duckDbClient !== undefined) {
          return Promise.resolve(options.duckDbClient)
        }

        return createDuckDbClient()
      })
  }

  meta(): Promise<DatasetMeta> {
    this.metaPromise ??= this.loadMeta()
    return this.metaPromise
  }

  async elements(bbox: BBox): Promise<ElementBatch> {
    const conn = await this.conn()
    const margin = (bbox.maxX - bbox.minX) * 0.05
    const x0 = bbox.minX - margin
    const x1 = bbox.maxX + margin
    const y0 = bbox.minY - margin
    const y1 = bbox.maxY + margin
    const stmt = await conn.prepare(`
SELECT b.cell_id, b.vertex_x AS x, b.vertex_y AS y
FROM read_parquet( ? ) AS b
WHERE b.vertex_x BETWEEN ? AND ?
  AND b.vertex_y BETWEEN ? AND ?
  AND b.cell_id IN (
    SELECT cell_id FROM read_parquet( ? )
    WHERE x_centroid BETWEEN ? AND ?
      AND y_centroid BETWEEN ? AND ?
  )
ORDER BY b.cell_id
`)
    const result = await stmt.query(
      this.urlFor('cell_boundaries.parquet'),
      x0,
      x1,
      y0,
      y1,
      this.urlFor('cells.parquet'),
      x0,
      x1,
      y0,
      y1,
    )
    const verticesByCell = new Map<CellId, DataPoint[]>()

    for (const row of result.toArray()) {
      const parsed = parseBoundaryRow(row)
      const vertices = verticesByCell.get(parsed.cellId) ?? []
      vertices.push(parsed.point)
      verticesByCell.set(parsed.cellId, vertices)
    }

    return {
      elements: [...verticesByCell.entries()]
        .filter(([, points]) => points.length >= 3)
        .map(([cellId, points]) => ({
          id: cellId,
          geometry: {
            kind: 'polygon',
            rings: [points],
          },
        })),
    }
  }

  matrix(ids: readonly CellId[]): Promise<GexResult> {
    return this.matrixReader(this.urlFor('cell_feature_matrix.zarr.zip'), ids)
  }

  overviewCells(limit?: number): Promise<readonly CellOverviewPoint[]> {
    return this.overviewReader(this.urlFor('cells.parquet'), limit)
  }

  annotations(): Promise<readonly Annotation[]> {
    return Promise.resolve([])
  }

  async image(): Promise<ImageSource | null> {
    const loader = await this.tiffOpener(this.urlFor('morphology_mip.ome.tif'))
    return {
      kind: 'pyramid',
      loader,
    }
  }

  async transcripts(
    selection: Selection,
    scope: TranscriptScope,
    minQv: number,
  ): Promise<GexResult> {
    const conn = await this.conn()
    const cellIds =
      scope === 'cells-only' ? await this.cellIdsForSelection(selection) : []

    return this.transcriptReader(
      conn,
      this.urlFor('transcripts.parquet'),
      selection,
      scope,
      cellIds,
      minQv,
    )
  }

  private async loadMeta(): Promise<DatasetMeta> {
    const [experiment, extent] = await Promise.all([
      this.readExperimentMetadata(),
      this.loadExtent(),
    ])

    return {
      platform: 'xenium',
      units: {
        ...DEFAULT_XENIUM_UNITS,
        micrometersPerPixel: micrometers(
          experiment.pixelSizeMicrometers ?? DEFAULT_XENIUM_UNITS.micrometersPerPixel,
        ),
      },
      extent,
      capabilities: {
        transcripts: true,
        cellBoundaries: true,
        pyramidImage: true,
        multiChannel: false,
      },
    }
  }

  private async readExperimentMetadata(): Promise<{ pixelSizeMicrometers?: number }> {
    const response = await this.fetcher(this.urlFor('experiment.xenium'))

    if (!response.ok) {
      return {}
    }

    const json = (await response.json()) as unknown
    const payload = readObjectProperty(json, 'payload') ?? json

    if (!isRecord(payload)) {
      return {}
    }

    const pixelSize = findNumericProperty(payload, [
      'pixel_size',
      'pixel_size_um',
      'pixel_size_microns',
      'microns_per_pixel',
      'micrometers_per_pixel',
    ])

    return pixelSize === undefined ? {} : { pixelSizeMicrometers: pixelSize }
  }

  private async loadExtent(): Promise<BBox> {
    const conn = await this.conn()
    const stmt = await conn.prepare(`
SELECT min(x_centroid) AS minX,
       max(x_centroid) AS maxX,
       min(y_centroid) AS minY,
       max(y_centroid) AS maxY
FROM read_parquet( ? )
`)
    const result = await stmt.query(this.urlFor('cells.parquet'))
    const first = result.toArray()[0]

    if (first === undefined) {
      throw new Error('Unable to read Xenium cells.parquet extent.')
    }

    return parseExtentRow(first)
  }

  private async cellIdsForSelection(selection: Selection): Promise<readonly CellId[]> {
    const conn = await this.conn()
    const fragment = selectionToSql(selection, 'x_centroid', 'y_centroid')
    const stmt = await conn.prepare(`
SELECT cell_id
FROM read_parquet( ? )
WHERE ${fragment.sql}
ORDER BY file_row_number
`)
    const result = await stmt.query(this.urlFor('cells.parquet'), ...fragment.params)

    return result.toArray().map((row) => {
      const value = row.cell_id

      if (typeof value !== 'string') {
        throw new Error('Expected selected cell_id to be a string.')
      }

      return asCellId(value)
    })
  }

  private async conn(): Promise<XeniumDuckDbConnection> {
    this.duckClientPromise ??= this.duckFactory()
    return (await this.duckClientPromise).conn
  }

  private urlFor(path: string): string {
    return `${this.baseUrl}/${path}`
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function parseExtentRow(row: Record<string, unknown>): BBox {
  return {
    minX: micrometers(readNumericRowValue(row, 'minX')),
    maxX: micrometers(readNumericRowValue(row, 'maxX')),
    minY: micrometers(readNumericRowValue(row, 'minY')),
    maxY: micrometers(readNumericRowValue(row, 'maxY')),
  }
}

function parseBoundaryRow(row: Record<string, unknown>): {
  readonly cellId: CellId
  readonly point: DataPoint
} {
  const cellId = row.cell_id

  if (typeof cellId !== 'string') {
    throw new Error('Expected boundary row cell_id to be a string.')
  }

  return {
    cellId: asCellId(cellId),
    point: {
      x: micrometers(readNumericRowValue(row, 'x')),
      y: micrometers(readNumericRowValue(row, 'y')),
    },
  }
}

function readNumericRowValue(row: Record<string, unknown>, key: string): number {
  const value = row[key]

  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  throw new Error(`Expected row.${key} to be numeric.`)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function readObjectProperty(
  value: unknown,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const property = value[key]
  return isRecord(property) ? property : undefined
}

function findNumericProperty(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const property = value[key]

    if (typeof property === 'number') {
      return property
    }

    if (isRecord(property)) {
      const nested = findNumericProperty(property, keys)

      if (nested !== undefined) {
        return nested
      }
    }
  }

  for (const property of Object.values(value)) {
    if (!isRecord(property)) {
      continue
    }

    const nested = findNumericProperty(property, keys)

    if (nested !== undefined) {
      return nested
    }
  }

  return undefined
}
