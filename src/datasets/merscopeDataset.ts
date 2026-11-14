// Vizgen MERSCOPE region output. `cell_by_gene.csv` and `cell_metadata.csv`
// are read into an in-memory AnnData table (counts in `/X`, cell centres in
// `obsm/spatial`, metadata in `obs`), so cells, genes, annotations, metadata
// tracks, ROI, and expression use the AnnData read paths. This class adds the
// cell boundaries, from `cell_boundaries.parquet` or a vpt
// `<method>_micron_space.parquet`, and the overview's transcript counts.
// Coordinates are stage micrometres as written. Images and transcripts are
// not read yet.

import { micrometers, type BBox, type DataPoint } from '../data/coords'
import type {
  AnalysisEmbedding,
  AnalysisEmbeddingKind,
  AnalysisEmbeddingOption,
} from '../data/analysisEmbeddings'
import type {
  ContinuousCellMetadataTrack,
  ContinuousCellMetadataValue,
} from '../data/customAnnotations'
import type {
  AnnotationGroupOption,
  LoadDatasetAnnotationsOptions,
} from '../data/datasetAnnotations'
import type { CellFeatureMatrixReadOptions, GexResult } from '../data/gex'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type { RoiSelectionInput } from '../data/roiSelection'
import {
  AnnDataH5adDataset,
  type AnnDataMemoryTable,
  type H5adLoadProgressReporter,
} from './h5adDataset'
import {
  MERSCOPE_BOUNDARY_ID_COLUMN,
  MERSCOPE_BOUNDARY_PLANE_COLUMN,
  MERSCOPE_TOTAL_COUNTS_COLUMN,
  MERSCOPE_TRANSCRIPT_COUNT_COLUMN,
  type MerscopeTable,
} from './merscopeFormat'
import { fileName, type MerscopeTableReader } from './merscopeTableReader'
import { readMerscopeTableInWorker } from './merscopeTableWorker'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
  SpatialElement,
  SpatialElementId,
} from './spatialDataset'
import {
  shapeRing,
  type SpatialDataShapes,
  type SpatialDataShapesReader,
} from './spatialDataShapes'
import { readSpatialDataShapesInWorker } from './spatialDataShapesWorker'
import { IDENTITY_AFFINE } from './spatialDataTransforms'
import type {
  DatasetCell,
  GeneExpressionBatch,
  GeneExpressionElement,
} from './xeniumDataset'

export interface MerscopeFileUrls {
  readonly cellByGene: string
  readonly cellMetadata: string
  readonly cellBoundaries?: string
}

export interface MerscopeDatasetOptions {
  readonly baseUrl: string
  readonly files: MerscopeFileUrls
  // The boundary file's size, when detection learned it.
  readonly cellBoundariesByteLength?: number
  readonly fetcher?: typeof fetch
  readonly onProgress?: H5adLoadProgressReporter
  // Replaced in tests.
  readonly readTable?: MerscopeTableReader
  readonly readShapes?: SpatialDataShapesReader
}

// What the load found, for the debug log and notices.
export interface MerscopeSummary {
  readonly cellCount: number
  readonly geneCount: number
  readonly blankColumnCount: number
  readonly countsOnlyCells: number
  readonly metadataOnlyCells: number
  readonly emptyColumns: readonly string[]
  readonly cellBoundaries: {
    readonly fileName: string
    readonly byteLength?: number
  } | null
}

interface MerscopeOverview {
  readonly points: readonly CellOverviewPoint[]
  readonly rowById: ReadonlyMap<string, number>
  readonly transcriptCounts: readonly number[] | null
}

// Cell outlines for the boundary layer; elements are built only for the cells
// a viewport request returns.
interface BoundaryIndex {
  readonly shapes: SpatialDataShapes
  // Kept shapes: table cells' outlines.
  readonly shapeIndexes: Uint32Array
  // minX, minY, maxX, maxY per kept shape, in µm.
  readonly bounds: Float64Array
}

const MERSCOPE_UNITS = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(1),
  origin: 'top-left',
  imageYAxis: 'down',
} as const

export class MerscopeDataset implements SpatialDataset<SpatialElementId> {
  readonly baseUrl: string
  private readonly files: MerscopeFileUrls
  private readonly cellBoundariesByteLength: number | undefined
  private readonly fetcher: typeof fetch | undefined
  private readonly onProgress: H5adLoadProgressReporter | undefined
  private readonly readShapes: SpatialDataShapesReader
  private readonly table: AnnDataH5adDataset
  // Filled when the table is read.
  private loaded: MerscopeTable | null = null
  private overviewPromise: Promise<MerscopeOverview> | null = null
  private boundaryIndexPromise: Promise<BoundaryIndex> | null = null
  // Elements of the last viewport request by kept shape, reused by the next
  // so cells still in view keep the same objects.
  private boundaryElements: {
    readonly index: BoundaryIndex
    readonly byShape: ReadonlyMap<number, SpatialElement>
  } | null = null

  constructor(options: MerscopeDatasetOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.files = options.files
    this.cellBoundariesByteLength = options.cellBoundariesByteLength
    this.fetcher = options.fetcher
    this.onProgress = options.onProgress
    this.readShapes = options.readShapes ?? readSpatialDataShapesInWorker
    const readTable = options.readTable ?? readMerscopeTableInWorker

    this.table = new AnnDataH5adDataset({
      url: this.baseUrl,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      memorySource: {
        label: 'MERSCOPE output',
        load: async (onProgress) => {
          const table = await readTable({
            files: {
              cellByGene: options.files.cellByGene,
              cellMetadata: options.files.cellMetadata,
            },
            ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
            ...(onProgress === undefined ? {} : { onProgress }),
          })
          this.loaded = table
          return merscopeAnnDataTable(table)
        },
      },
    })
  }

  async meta(): Promise<DatasetMeta> {
    const tableMeta = await this.table.meta()
    const boundaries = this.files.cellBoundaries

    return {
      platform: 'merscope',
      units: MERSCOPE_UNITS,
      extent: tableMeta.extent,
      capabilities: {
        transcripts: false,
        cellBoundaries: boundaries !== undefined,
        pyramidImage: false,
        multiChannel: false,
      },
      ...(boundaries === undefined
        ? {}
        : {
            segmentations: [
              {
                id: 'cell',
                kind: 'cell' as const,
                label: 'Cell boundaries',
                sourceKind: 'parquet' as const,
                path: fileName(boundaries),
              },
            ],
          }),
    }
  }

  // Reads the tables, then reports what they hold.
  async summary(): Promise<MerscopeSummary> {
    const [cellIds, genes] = await Promise.all([
      this.table.cellIds(),
      this.table.genePanel(),
    ])
    const loaded = this.loaded
    const boundaries = this.files.cellBoundaries

    return {
      cellCount: cellIds.length,
      geneCount: genes.length,
      blankColumnCount: loaded?.blankColumnCount ?? 0,
      countsOnlyCells: loaded?.countsOnlyCells ?? 0,
      metadataOnlyCells: loaded?.metadataOnlyCells ?? 0,
      emptyColumns: loaded?.emptyColumns ?? [],
      cellBoundaries:
        boundaries === undefined
          ? null
          : {
              fileName: fileName(boundaries),
              ...(this.cellBoundariesByteLength === undefined
                ? {}
                : { byteLength: this.cellBoundariesByteLength }),
            },
    }
  }

  // Cell outlines in the box. The boundary file is read whole on the first
  // request.
  async elements(bbox: BBox): Promise<ElementBatch<SpatialElementId>> {
    if (this.files.cellBoundaries === undefined) {
      return { elements: [] }
    }

    const index = await this.boundaryIndex()
    const { bounds } = index
    const previous =
      this.boundaryElements?.index === index ? this.boundaryElements.byShape : new Map()
    const byShape = new Map<number, SpatialElement>()

    for (let kept = 0; kept < index.shapeIndexes.length; kept += 1) {
      const offset = kept * 4

      if (
        (bounds[offset] ?? 0) > bbox.maxX ||
        (bounds[offset + 1] ?? 0) > bbox.maxY ||
        (bounds[offset + 2] ?? 0) < bbox.minX ||
        (bounds[offset + 3] ?? 0) < bbox.minY
      ) {
        continue
      }

      byShape.set(kept, previous.get(kept) ?? boundaryElement(index, kept))
    }

    this.boundaryElements = { index, byShape }
    return { elements: Array.from(byShape.values()) }
  }

  async overview(): Promise<readonly CellOverviewPoint[]> {
    return (await this.overviewIndex()).points
  }

  async matrix(ids: readonly SpatialElementId[]): Promise<GexResult<SpatialElementId>> {
    return this.table.matrix(ids)
  }

  async geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: CellFeatureMatrixReadOptions & {
      readonly limit?: number
      readonly sampleStride?: number
    } = {},
  ): Promise<GeneExpressionBatch> {
    const [batch, overview] = await Promise.all([
      this.table.geneExpression(bbox, genes, options),
      this.overviewIndex(),
    ])

    return {
      ...batch,
      elements: batch.elements.map(
        (element): GeneExpressionElement =>
          withTranscriptCount(element, overview, element.id),
      ),
    }
  }

  async annotationGroups(): Promise<readonly AnnotationGroupOption[]> {
    return this.table.annotationGroups()
  }

  async annotations(
    options: LoadDatasetAnnotationsOptions = {},
  ): Promise<readonly Annotation<SpatialElementId>[]> {
    return this.table.annotations(options)
  }

  async metadataTracks(): Promise<readonly ContinuousCellMetadataTrack[]> {
    return this.table.metadataTracks()
  }

  async metadataTrackValues(
    trackId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly ContinuousCellMetadataValue[]> {
    return this.table.metadataTrackValues(trackId, options)
  }

  async embeddings(
    options: {
      readonly kind?: AnalysisEmbeddingKind
      readonly signal?: AbortSignal
    } = {},
  ): Promise<readonly AnalysisEmbedding[]> {
    return this.table.embeddings(options)
  }

  async embeddingOptions(): Promise<readonly AnalysisEmbeddingOption[]> {
    return this.table.embeddingOptions()
  }

  // Genes only: Blank columns are summed into the `blank_count` track.
  async genePanel(): Promise<readonly string[]> {
    return this.table.genePanel()
  }

  async geneAliases(): Promise<ReadonlyMap<string, string>> {
    return this.table.geneAliases()
  }

  async cellIds(): Promise<readonly string[]> {
    return this.table.cellIds()
  }

  // ROI cells, with the transcript counts the ROI summary averages.
  async cells(
    selection: RoiSelectionInput,
    options: { readonly limit?: number } = {},
  ): Promise<readonly DatasetCell[]> {
    const [cells, overview] = await Promise.all([
      this.table.cells(selection, options),
      this.overviewIndex(),
    ])

    return cells.map((cell) => withTranscriptCount(cell, overview, cell.id))
  }

  async image(): Promise<ImageSource | null> {
    return null
  }

  private overviewIndex(): Promise<MerscopeOverview> {
    if (this.overviewPromise === null) {
      this.overviewPromise = this.readOverview().catch((error: unknown) => {
        this.overviewPromise = null
        throw error
      })
    }

    return this.overviewPromise
  }

  // Each cell's transcript count is the metadata's `transcript_count`, or the
  // sum of its gene counts when the metadata has none (the 2022 release).
  private async readOverview(): Promise<MerscopeOverview> {
    const [tablePoints, cellIds, transcriptCount, totalCounts] = await Promise.all([
      this.table.overview(),
      this.table.cellIds(),
      this.table.numericObsColumn(MERSCOPE_TRANSCRIPT_COUNT_COLUMN),
      this.table.numericObsColumn(MERSCOPE_TOTAL_COUNTS_COLUMN),
    ])
    const transcriptCounts = transcriptCount ?? totalCounts
    const rowById = new Map<string, number>()

    cellIds.forEach((id, row) => {
      rowById.set(id, row)
    })

    const points = tablePoints.map((point) => {
      const row = point.cellId === undefined ? undefined : rowById.get(point.cellId)
      const count = row === undefined ? undefined : transcriptCounts?.[row]

      return count === undefined || !Number.isFinite(count)
        ? point
        : { ...point, transcriptCount: count }
    })

    return { points, rowById, transcriptCounts }
  }

  private boundaryIndex(): Promise<BoundaryIndex> {
    if (this.boundaryIndexPromise === null) {
      this.boundaryIndexPromise = this.readBoundaryIndex().catch((error: unknown) => {
        this.boundaryIndexPromise = null
        throw error
      })
    }

    return this.boundaryIndexPromise
  }

  // One outline per table cell, from the middle z plane. Outlines of cells
  // the table does not hold are left out.
  private async readBoundaryIndex(): Promise<BoundaryIndex> {
    const url = this.files.cellBoundaries

    if (url === undefined) {
      throw new Error('This MERSCOPE dataset has no cell boundary file.')
    }

    this.onProgress?.(`MERSCOPE ${fileName(url)} loading`)
    const [shapes, overview] = await Promise.all([
      this.readShapes({
        url,
        affine: IDENTITY_AFFINE,
        idColumn: MERSCOPE_BOUNDARY_ID_COLUMN,
        planeColumn: MERSCOPE_BOUNDARY_PLANE_COLUMN,
        wholeFile: true,
        ...(this.fetcher === undefined ? {} : { fetcher: this.fetcher }),
      }),
      this.overviewIndex(),
    ])
    const shapeIndexes: number[] = []
    const seen = new Set<string>()

    shapes.ids.forEach((id, index) => {
      if (overview.rowById.has(id) && !seen.has(id)) {
        seen.add(id)
        shapeIndexes.push(index)
      }
    })

    if (shapeIndexes.length === 0 && shapes.ids.length > 0) {
      throw new Error(
        `None of the ${shapes.ids.length.toLocaleString()} outlines in ${fileName(
          url,
        )} belong to cells in the cell tables; the files may come from different segmentations.`,
      )
    }

    const bounds = new Float64Array(shapeIndexes.length * 4)

    shapeIndexes.forEach((shapeIndex, kept) => {
      bounds.set(shapes.bounds.subarray(shapeIndex * 4, shapeIndex * 4 + 4), kept * 4)
    })
    this.onProgress?.(
      `MERSCOPE cell boundaries ready: ${shapeIndexes.length.toLocaleString()} cells${
        shapes.plane === undefined ? '' : ` at z plane ${shapes.plane}`
      }${
        shapeIndexes.length < overview.rowById.size
          ? `; ${(overview.rowById.size - shapeIndexes.length).toLocaleString()} cells have no outline`
          : ''
      }`,
    )

    return { shapes, shapeIndexes: Uint32Array.from(shapeIndexes), bounds }
  }
}

// The AnnData layout of a MERSCOPE table: obs per cell, `/X` per gene, and
// the cell centres in `obsm/spatial`, in µm.
export function merscopeAnnDataTable(table: MerscopeTable): AnnDataMemoryTable {
  return {
    obsNames: table.ids,
    obs: table.obs,
    varNames: table.genes,
    X: { kind: 'csr', data: table.data, indices: table.indices, indptr: table.indptr },
    obsm: { spatial: { values: table.spatial, columns: 2 } },
  }
}

function withTranscriptCount<T extends { readonly transcriptCount?: number }>(
  value: T,
  overview: MerscopeOverview,
  id: string,
): T {
  const row = overview.rowById.get(id)
  const count = row === undefined ? undefined : overview.transcriptCounts?.[row]

  return count === undefined || !Number.isFinite(count)
    ? value
    : { ...value, transcriptCount: count }
}

function boundaryElement(index: BoundaryIndex, kept: number): SpatialElement {
  const shapeIndex = index.shapeIndexes[kept] ?? 0
  const ring = shapeRing(index.shapes, shapeIndex)
  const points: DataPoint[] = []

  for (let offset = 0; offset < ring.length; offset += 2) {
    points.push({
      x: micrometers(ring[offset] ?? 0),
      y: micrometers(ring[offset + 1] ?? 0),
    })
  }

  return {
    id: index.shapes.ids[shapeIndex] ?? String(shapeIndex),
    geometry: { kind: 'polygon', rings: [points] },
  }
}
