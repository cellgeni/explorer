import * as zarr from 'zarrita'
import {
  micrometers,
  type BBox,
  type DataPoint,
  type UnitsDescriptor,
} from '../data/coords'
import type { CellFeatureMatrixReadOptions, GexResult } from '../data/gex'
import type { RoiSelectionInput } from '../data/roiSelection'
import type { ContinuousCellMetadataTrack } from '../data/customAnnotations'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type { AnalysisEmbedding, AnalysisEmbeddingKind } from '../data/analysisEmbeddings'
import type { AnalysisEmbeddingOption } from '../data/analysisEmbeddings'
import type {
  AnnotationGroupOption,
  LoadDatasetAnnotationsOptions,
} from '../data/datasetAnnotations'
import type { ImagePyramidLoader } from '../data/imagePyramid'
import { datasetFileUrl } from '../data/datasetFiles'
import {
  openOmeZarrImageWithOptions,
  type OmeZarrPlanarTransform,
} from '../zarr/omeZarrLoader'
import {
  AnnDataH5adDataset,
  type AnnDataObsAccess,
  type H5adLoadProgressReporter,
} from './h5adDataset'
import {
  openSpatialDataStore,
  readSpatialDataCatalog,
  selectSpatialDataView,
  type SpatialDataCatalog,
  type SpatialDataPlacedElement,
  type SpatialDataStore,
  type SpatialDataView,
} from './spatialDataCatalog'
import {
  instanceIdString,
  readSpatialDataShapes,
  type SpatialDataShape,
  type SpatialDataShapesReader,
} from './spatialDataShapes'
import { applyAffine, type Affine2D } from './spatialDataTransforms'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
  SpatialElement,
  SpatialElementId,
} from './spatialDataset'
import type { DatasetCell, GeneExpressionBatch } from './xeniumDataset'

export interface SpatialDataImageRequest {
  // Element URL; per-channel requests carry an OME-Zarr `#c=N` selection.
  readonly url: string
  readonly location: zarr.Location<zarr.Readable>
  readonly transform: OmeZarrPlanarTransform
  readonly signal?: AbortSignal
}

export type SpatialDataImageOpener = (
  request: SpatialDataImageRequest,
) => Promise<ImagePyramidLoader>

export interface SpatialDataDatasetOptions {
  readonly url: string
  readonly fetcher?: typeof fetch
  readonly onProgress?: H5adLoadProgressReporter
  readonly coordinateSystem?: string
  readonly readShapes?: SpatialDataShapesReader
  readonly openImage?: SpatialDataImageOpener
}

export interface SpatialDataSummary {
  readonly coordinateSystem: string
  readonly coordinateSystems: readonly string[]
  readonly image?: string
  readonly table?: string
  readonly regions: readonly string[]
  readonly boundaries?: string
  readonly skippedElements: readonly string[]
}

interface SpatialDataState {
  readonly store: SpatialDataStore
  readonly catalog: SpatialDataCatalog
  readonly view: SpatialDataView
  readonly table: AnnDataH5adDataset | null
}

interface BoundaryIndexEntry {
  readonly id: string
  readonly bbox: BBox
  readonly element: SpatialElement
}

const DEFAULT_SPATIALDATA_UNITS: UnitsDescriptor = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(1),
  origin: 'top-left',
  imageYAxis: 'down',
}

const CIRCLE_BOUNDARY_SEGMENTS = 32

export class SpatialDataDataset implements SpatialDataset<SpatialElementId> {
  readonly url: string
  private readonly fetcher: typeof fetch
  private readonly onProgress: H5adLoadProgressReporter | undefined
  private readonly coordinateSystem: string | undefined
  private readonly readShapes: SpatialDataShapesReader
  private readonly openImage: SpatialDataImageOpener
  private statePromise: Promise<SpatialDataState> | null = null
  private imagePromise: Promise<ImagePyramidLoader | null> | null = null
  private boundaryIndexPromise: Promise<readonly BoundaryIndexEntry[]> | null = null
  // Filled while the table resolves row coordinates from region shapes.
  private readonly regionShapeByCellId = new Map<string, SpatialDataShape>()
  private readonly cellIdByInstanceId = new Map<string, string>()

  constructor(options: SpatialDataDatasetOptions) {
    this.url = options.url.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.onProgress = options.onProgress
    this.coordinateSystem = options.coordinateSystem
    this.readShapes = options.readShapes ?? readSpatialDataShapes
    this.openImage =
      options.openImage ??
      ((request) =>
        openOmeZarrImageWithOptions(request.url, {
          planarTransform: request.transform,
          location: request.location,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        }))
  }

  async summary(): Promise<SpatialDataSummary> {
    const { view } = await this.state()
    const boundaries = await this.boundaryElement()

    return {
      coordinateSystem: view.coordinateSystem,
      coordinateSystems: view.coordinateSystems,
      ...(view.image === undefined ? {} : { image: view.image.element.name }),
      ...(view.table === undefined ? {} : { table: view.table.name }),
      regions: [...view.regionShapes, ...view.regionLabels].map(
        (entry) => entry.element.name,
      ),
      ...(boundaries === null ? {} : { boundaries: boundaries.element.name }),
      skippedElements: view.skippedElements.map(
        (element) => `${element.kind}/${element.name}`,
      ),
    }
  }

  async meta(): Promise<DatasetMeta> {
    const { view, table } = await this.state()
    const [loader, tableMeta] = await Promise.all([
      this.imageLoader(),
      table === null ? null : table.meta(),
    ])
    const extents: BBox[] = []

    if (tableMeta !== null) {
      extents.push(tableMeta.extent)
    }

    if (loader !== null) {
      const origin = loader.tileBounds(0, 0, 0)
      extents.push({
        minX: origin.minX,
        minY: origin.minY,
        maxX: micrometers(
          origin.minX + loader.imageWidth * loader.units.micrometersPerPixel,
        ),
        maxY: micrometers(
          origin.minY + loader.imageHeight * loader.units.micrometersPerPixel,
        ),
      })
    }

    return {
      platform: 'spatialdata',
      units: loader?.units ?? DEFAULT_SPATIALDATA_UNITS,
      extent: unionBboxes(extents),
      capabilities: {
        transcripts: false,
        cellBoundaries: table !== null && view.regionShapes.length > 0,
        pyramidImage: loader !== null,
        multiChannel: (loader?.channels.length ?? 0) > 1,
      },
      ...(loader === null
        ? {}
        : {
            channels: loader.channels.map((channel) => ({
              id: channel.id,
              index: channel.index,
              name: channel.name,
              color: channel.color,
              contrast: channel.contrast,
            })),
          }),
    }
  }

  async elements(bbox: BBox): Promise<ElementBatch<SpatialElementId>> {
    const index = await this.boundaryIndex()

    return {
      elements: index
        .filter((entry) => bboxesIntersect(entry.bbox, bbox))
        .map((entry) => entry.element),
    }
  }

  async overview(): Promise<readonly CellOverviewPoint[]> {
    return (await this.tableOrNull())?.overview() ?? []
  }

  async matrix(ids: readonly SpatialElementId[]): Promise<GexResult<SpatialElementId>> {
    const table = await this.tableOrNull()

    return table === null
      ? {
          geneNames: [],
          cells: new Map(ids.map((id) => [id, { geneNames: [], counts: [] }])),
        }
      : table.matrix(ids)
  }

  async geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: CellFeatureMatrixReadOptions & { readonly limit?: number } = {},
  ): Promise<GeneExpressionBatch> {
    const table = await this.tableOrNull()

    return table === null
      ? { elements: [], genes, maxCount: 0 }
      : table.geneExpression(bbox, genes, options)
  }

  async annotationGroups(): Promise<readonly AnnotationGroupOption[]> {
    return (await this.tableOrNull())?.annotationGroups() ?? []
  }

  async annotations(
    options: LoadDatasetAnnotationsOptions = {},
  ): Promise<readonly Annotation<SpatialElementId>[]> {
    return (await this.tableOrNull())?.annotations(options) ?? []
  }

  async metadataTracks(): Promise<readonly ContinuousCellMetadataTrack[]> {
    return (await this.tableOrNull())?.metadataTracks() ?? []
  }

  async embeddings(
    options: {
      readonly kind?: AnalysisEmbeddingKind
      readonly signal?: AbortSignal
    } = {},
  ): Promise<readonly AnalysisEmbedding[]> {
    return (await this.tableOrNull())?.embeddings(options) ?? []
  }

  async embeddingOptions(): Promise<readonly AnalysisEmbeddingOption[]> {
    return (await this.tableOrNull())?.embeddingOptions() ?? []
  }

  async genePanel(): Promise<readonly string[]> {
    return (await this.tableOrNull())?.genePanel() ?? []
  }

  async cells(
    selection: RoiSelectionInput,
    options: { readonly limit?: number } = {},
  ): Promise<readonly DatasetCell[]> {
    return (await this.tableOrNull())?.cells(selection, options) ?? []
  }

  async image(): Promise<ImageSource | null> {
    const loader = await this.imageLoader()
    const { store, view } = await this.state()
    const image = view.image

    if (loader === null || image === undefined) {
      return null
    }

    return {
      kind: 'pyramid',
      loader,
      openChannelLoader: (url, signal) =>
        this.openImage({
          url,
          location: zarr.root(store).resolve(image.element.path),
          transform: planarTransformFromAffine(image.affine),
          ...(signal === undefined ? {} : { signal }),
        }),
    }
  }

  imageUrl(): Promise<string | null> {
    return this.state().then(({ view }) =>
      view.image === undefined ? null : this.elementUrl(view.image.element.path),
    )
  }

  private async tableOrNull(): Promise<AnnDataH5adDataset | null> {
    return (await this.state()).table
  }

  private state(): Promise<SpatialDataState> {
    if (this.statePromise === null) {
      this.statePromise = this.readState().catch((error: unknown) => {
        this.statePromise = null
        throw error
      })
    }

    return this.statePromise
  }

  private async readState(): Promise<SpatialDataState> {
    this.onProgress?.('SpatialData metadata loading')
    const { store, zarrFormat } = await openSpatialDataStore(this.url, {
      fetcher: this.fetcher,
    })
    const catalog = await readSpatialDataCatalog(store, zarrFormat)
    const view = selectSpatialDataView(
      catalog,
      this.coordinateSystem === undefined
        ? {}
        : { coordinateSystem: this.coordinateSystem },
    )
    this.onProgress?.(
      `SpatialData metadata loaded: ${catalog.elements.length.toLocaleString()} elements, coordinate system ${view.coordinateSystem}`,
    )
    const tableInfo = view.table
    const table =
      tableInfo === undefined
        ? null
        : new AnnDataH5adDataset({
            url: `${this.url}#${tableInfo.path}`,
            fetcher: this.fetcher,
            ...(this.onProgress === undefined ? {} : { onProgress: this.onProgress }),
            zarrSource: {
              store,
              zarrFormat,
              path: tableInfo.path,
              nodes: catalog.nodes,
              label: `SpatialData table ${tableInfo.name}`,
              resolveCoordinates: (obs) => this.resolveTableCoordinates(view, obs),
            },
          })

    return { store, catalog, view, table }
  }

  private async resolveTableCoordinates(
    view: SpatialDataView,
    obs: AnnDataObsAccess,
  ): Promise<readonly DataPoint[] | null> {
    const table = view.table

    if (table === undefined) {
      return null
    }

    if (view.regionShapes.length === 0 && view.regionLabels.length === 0) {
      // The table does not annotate an element placed in this coordinate
      // system; fall back to raw obsm coordinates.
      return null
    }

    const [instances, regions, obsmPoints, shapesByRegion] = await Promise.all([
      table.instanceKey === undefined
        ? Promise.resolve(null)
        : obs.readObsColumn(table.instanceKey),
      table.regionKey === undefined
        ? Promise.resolve(null)
        : obs.readObsColumn(table.regionKey),
      view.regionLabels.length > 0 ? obs.readObsmPoints() : Promise.resolve(null),
      this.loadRegionShapes(view.regionShapes),
    ])
    const defaultRegion = table.regions.length === 1 ? table.regions[0] : undefined
    const labelAffines = new Map(
      view.regionLabels.map((entry) => [entry.element.name, entry.affine]),
    )
    const coordinates: DataPoint[] = []

    obs.cellIds.forEach((cellId, row) => {
      const instanceId =
        instances === null ? cellId : instanceIdString(instances[row] ?? null)
      const regionValue = regions?.[row]
      const region = typeof regionValue === 'string' ? regionValue : defaultRegion
      const shape =
        instanceId === null || region === undefined
          ? undefined
          : shapesByRegion.get(region)?.get(instanceId)

      if (shape !== undefined) {
        this.regionShapeByCellId.set(cellId, shape)
        this.cellIdByInstanceId.set(shape.id, cellId)
        coordinates.push(dataPoint(shape.centroid.x, shape.centroid.y))
        return
      }

      const labelAffine = region === undefined ? undefined : labelAffines.get(region)
      const point = obsmPoints?.[row]

      if (labelAffine !== undefined && point !== undefined) {
        const placed = applyAffine(labelAffine, point.x, point.y)
        coordinates.push(dataPoint(placed.x, placed.y))
        return
      }

      coordinates.push(UNPLACED_POINT)
    })

    const placedRows = coordinates.filter((point) => Number.isFinite(point.x)).length
    this.onProgress?.(
      `SpatialData placed ${placedRows.toLocaleString()} of ${coordinates.length.toLocaleString()} table rows in ${view.coordinateSystem}`,
    )

    if (placedRows === 0) {
      throw new Error(
        `SpatialData table ${table.name} rows did not match any ${table.regions.join(', ')} instances in coordinate system ${view.coordinateSystem}.`,
      )
    }

    return coordinates
  }

  private async loadRegionShapes(
    regions: readonly SpatialDataPlacedElement[],
  ): Promise<ReadonlyMap<string, ReadonlyMap<string, SpatialDataShape>>> {
    const entries = await Promise.all(
      regions.map(async (entry) => {
        const shapes = await this.readElementShapes(entry)
        return [
          entry.element.name,
          new Map(shapes.map((shape) => [shape.id, shape])),
        ] as const
      }),
    )

    return new Map(entries)
  }

  private async readElementShapes(
    entry: SpatialDataPlacedElement,
  ): Promise<readonly SpatialDataShape[]> {
    this.onProgress?.(`SpatialData shapes ${entry.element.name} loading`)
    const shapes = await this.readShapes({
      url: this.elementUrl(`${entry.element.path}/shapes.parquet`),
      affine: entry.affine,
      fetcher: this.fetcher,
    })
    this.onProgress?.(
      `SpatialData shapes ${entry.element.name} ready: ${shapes.length.toLocaleString()} geometries`,
    )
    return shapes
  }

  private async boundaryElement(): Promise<SpatialDataPlacedElement | null> {
    const { view, table } = await this.state()

    if (table === null || view.regionShapes.length === 0) {
      return null
    }

    // Region circles (for example Xenium cell_circles) are replaced by a
    // polygon companion that shares their index when one is available.
    await table.overview()
    const regionShapes = Array.from(this.regionShapeByCellId.values())
    const regionsArePolygons =
      regionShapes.length > 0 &&
      regionShapes.every((shape) => shape.geometry.kind === 'polygon')

    if (regionsArePolygons || view.boundaryCandidates.length === 0) {
      return view.regionShapes[0] ?? null
    }

    return view.boundaryCandidates[0] ?? view.regionShapes[0] ?? null
  }

  private boundaryIndex(): Promise<readonly BoundaryIndexEntry[]> {
    if (this.boundaryIndexPromise === null) {
      this.boundaryIndexPromise = this.readBoundaryIndex().catch((error: unknown) => {
        this.boundaryIndexPromise = null
        throw error
      })
    }

    return this.boundaryIndexPromise
  }

  private async readBoundaryIndex(): Promise<readonly BoundaryIndexEntry[]> {
    const { view } = await this.state()
    const boundary = await this.boundaryElement()

    if (boundary === null) {
      return []
    }

    const isRegion = view.regionShapes.some((entry) => entry.element === boundary.element)
    const shapesByCellId = isRegion
      ? this.regionShapeByCellId
      : this.companionShapesByCellId(await this.readElementShapes(boundary))
    const index: BoundaryIndexEntry[] = []

    for (const [cellId, shape] of shapesByCellId) {
      const ring = boundaryRing(shape)

      if (ring.length < 3) {
        continue
      }

      index.push({
        id: cellId,
        bbox: bboxForRing(ring),
        element: {
          id: cellId,
          geometry: { kind: 'polygon', rings: [ring] },
        },
      })
    }

    return index
  }

  private companionShapesByCellId(
    shapes: readonly SpatialDataShape[],
  ): ReadonlyMap<string, SpatialDataShape> {
    const byCellId = new Map<string, SpatialDataShape>()

    for (const shape of shapes) {
      const cellId = this.cellIdByInstanceId.get(shape.id)

      if (cellId !== undefined) {
        byCellId.set(cellId, shape)
      }
    }

    // Fall back to region geometry when the companion does not share the
    // region index.
    return byCellId.size === 0 ? this.regionShapeByCellId : byCellId
  }

  private imageLoader(): Promise<ImagePyramidLoader | null> {
    if (this.imagePromise === null) {
      this.imagePromise = this.state()
        .then(({ store, view }) => {
          if (view.image === undefined) {
            return null
          }

          return this.openImage({
            url: this.elementUrl(view.image.element.path),
            location: zarr.root(store).resolve(view.image.element.path),
            transform: planarTransformFromAffine(view.image.affine),
          })
        })
        .catch((error: unknown) => {
          this.imagePromise = null
          throw error
        })
    }

    return this.imagePromise
  }

  private elementUrl(path: string): string {
    return datasetFileUrl(this.url, path)
  }
}

const UNPLACED_POINT: DataPoint = {
  x: Number.NaN as DataPoint['x'],
  y: Number.NaN as DataPoint['y'],
}

function dataPoint(x: number, y: number): DataPoint {
  return Number.isFinite(x) && Number.isFinite(y)
    ? { x: micrometers(x), y: micrometers(y) }
    : UNPLACED_POINT
}

function planarTransformFromAffine(affine: Affine2D): OmeZarrPlanarTransform {
  return {
    scaleX: affine.a,
    scaleY: affine.e,
    translateX: affine.c,
    translateY: affine.f,
  }
}

function boundaryRing(shape: SpatialDataShape): readonly DataPoint[] {
  if (shape.geometry.kind === 'polygon') {
    return (shape.geometry.rings[0] ?? []).map((point) => dataPoint(point.x, point.y))
  }

  const { center, radius } = shape.geometry
  return Array.from({ length: CIRCLE_BOUNDARY_SEGMENTS }, (_value, index) => {
    const angle = (2 * Math.PI * index) / CIRCLE_BOUNDARY_SEGMENTS
    return dataPoint(
      center.x + radius * Math.cos(angle),
      center.y + radius * Math.sin(angle),
    )
  })
}

function bboxForRing(ring: readonly DataPoint[]): BBox {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of ring) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

function bboxesIntersect(left: BBox, right: BBox): boolean {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  )
}

function unionBboxes(boxes: readonly BBox[]): BBox {
  if (boxes.length === 0) {
    return {
      minX: micrometers(0),
      maxX: micrometers(1),
      minY: micrometers(0),
      maxY: micrometers(1),
    }
  }

  return {
    minX: micrometers(Math.min(...boxes.map((box) => box.minX))),
    maxX: micrometers(Math.max(...boxes.map((box) => box.maxX))),
    minY: micrometers(Math.min(...boxes.map((box) => box.minY))),
    maxY: micrometers(Math.max(...boxes.map((box) => box.maxY))),
  }
}
