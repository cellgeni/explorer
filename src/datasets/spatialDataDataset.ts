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
  describeMissingChunks,
  openSpatialDataStore,
  readSpatialDataCatalog,
  selectSpatialDataView,
  SpatialDataIncompleteStoreError,
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
import { applyAffine, composeAffine, type Affine2D } from './spatialDataTransforms'
import { SpatialDataLabelsReader } from './spatialDataLabels'
import {
  declaredSpatialDataUnits,
  estimateUnitsFromAreas,
  estimateUnitsFromVisiumHdBins,
  estimateUnitsFromVisiumSpots,
  formatSpatialDataUnits,
  overrideSpatialDataUnits,
  polygonArea,
  UNKNOWN_SPATIALDATA_UNITS,
  type SpatialDataUnits,
} from './spatialDataUnits'
import { ZarrChunkUnavailableError } from '../zarr/zarrStores'
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

export interface SpatialDataLabelsRequest {
  readonly store: SpatialDataStore
  readonly zarrFormat: 2 | 3
  readonly path: string
  readonly attrs: Readonly<Record<string, unknown>>
  // Element coordinates -> coordinate-system units.
  readonly affine: Affine2D
}

export type SpatialDataLabelsOpener = (
  request: SpatialDataLabelsRequest,
) => Promise<SpatialDataLabelsReader>

// Which coordinate system, image, and unit scale a store is shown with.
export interface SpatialDataSelection {
  readonly coordinateSystem?: string
  readonly image?: string
  readonly micrometersPerUnit?: number
}

export interface SpatialDataDatasetOptions extends SpatialDataSelection {
  readonly url: string
  readonly fetcher?: typeof fetch
  readonly onProgress?: H5adLoadProgressReporter
  readonly readShapes?: SpatialDataShapesReader
  readonly openImage?: SpatialDataImageOpener
  readonly openLabels?: SpatialDataLabelsOpener
}

export interface SpatialDataSummary {
  readonly coordinateSystem: string
  readonly coordinateSystems: readonly string[]
  readonly image?: string
  readonly images: readonly string[]
  readonly table?: string
  readonly regions: readonly string[]
  readonly boundaries?: string
  readonly skippedElements: readonly string[]
  readonly units: SpatialDataUnits
}

interface SpatialDataState {
  readonly store: SpatialDataStore
  readonly zarrFormat: 2 | 3
  readonly catalog: SpatialDataCatalog
  readonly view: SpatialDataView
  readonly table: AnnDataH5adDataset | null
  // Units known without reading data: a user override or declared axis units.
  readonly staticUnits: SpatialDataUnits | null
}

type BoundarySource =
  | { readonly kind: 'shapes'; readonly entry: SpatialDataPlacedElement }
  | { readonly kind: 'labels'; readonly entry: SpatialDataPlacedElement }

// Per-row placement in coordinate-system units, before unit scaling.
type RawPlacement =
  | { readonly kind: 'shape'; readonly shape: SpatialDataShape }
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | null

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
// Label pixels traced per boundary request; coarser pyramid levels are used
// when the viewport would need more.
const LABEL_OUTLINE_MAX_PIXELS = 16_000_000
const AREA_COLUMNS = ['cell_area', 'area'] as const
const LABEL_COLUMN_PATTERN = /label/i

export class SpatialDataDataset implements SpatialDataset<SpatialElementId> {
  readonly url: string
  private readonly fetcher: typeof fetch
  private readonly onProgress: H5adLoadProgressReporter | undefined
  private readonly selection: SpatialDataSelection
  private readonly readShapes: SpatialDataShapesReader
  private readonly openImage: SpatialDataImageOpener
  private readonly openLabels: SpatialDataLabelsOpener
  private statePromise: Promise<SpatialDataState> | null = null
  private imagePromise: Promise<ImagePyramidLoader | null> | null = null
  private boundaryIndexPromise: Promise<readonly BoundaryIndexEntry[]> | null = null
  private readonly labelReaders = new Map<string, Promise<SpatialDataLabelsReader>>()
  // Cell elements for cached label rings, so unchanged cells keep the same
  // objects across viewport requests.
  private readonly labelElementsByRing = new WeakMap<Float64Array, SpatialElement>()
  // Filled while the table resolves row coordinates; shapes are in µm.
  private readonly regionShapeByCellId = new Map<string, SpatialDataShape>()
  private readonly cellIdByInstanceId = new Map<string, string>()
  private readonly labelCellIdsByRegion = new Map<string, Map<number, string>>()
  private resolvedUnits: SpatialDataUnits | null = null

  constructor(options: SpatialDataDatasetOptions) {
    this.url = options.url.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.onProgress = options.onProgress
    this.selection = {
      ...(options.coordinateSystem === undefined
        ? {}
        : { coordinateSystem: options.coordinateSystem }),
      ...(options.image === undefined ? {} : { image: options.image }),
      ...(options.micrometersPerUnit === undefined
        ? {}
        : { micrometersPerUnit: options.micrometersPerUnit }),
    }
    this.readShapes = options.readShapes ?? readSpatialDataShapes
    this.openLabels =
      options.openLabels ??
      ((request) =>
        SpatialDataLabelsReader.open(
          request.store,
          request.zarrFormat,
          request.path,
          request.attrs,
          request.affine,
        ))
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
    const [boundaries, units] = await Promise.all([this.boundarySource(), this.units()])

    return {
      coordinateSystem: view.coordinateSystem,
      coordinateSystems: view.coordinateSystems,
      ...(view.image === undefined ? {} : { image: view.image.element.name }),
      images: view.images.map((entry) => entry.element.name),
      ...(view.table === undefined ? {} : { table: view.table.name }),
      regions: [...view.regionShapes, ...view.regionLabels].map(
        (entry) => entry.element.name,
      ),
      ...(boundaries === null ? {} : { boundaries: boundaries.entry.element.name }),
      skippedElements: view.skippedElements.map(
        (element) => `${element.kind}/${element.name}`,
      ),
      units,
    }
  }

  // Micrometers per coordinate-system unit. Estimating it may read the table.
  async units(): Promise<SpatialDataUnits> {
    const { staticUnits, table } = await this.state()

    if (staticUnits !== null) {
      return staticUnits
    }

    if (table !== null) {
      await table.overview()
    }

    return this.resolvedUnits ?? UNKNOWN_SPATIALDATA_UNITS
  }

  async meta(): Promise<DatasetMeta> {
    const { table } = await this.state()
    const [loader, tableMeta, boundaries] = await Promise.all([
      this.imageLoader(),
      table === null ? null : table.meta(),
      this.boundarySource(),
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
        cellBoundaries: boundaries !== null,
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
    const source = await this.boundarySource()

    if (source?.kind === 'labels') {
      return { elements: await this.labelElements(source.entry, bbox) }
    }

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

    const { micrometersPerUnit } = await this.units()

    return {
      kind: 'pyramid',
      loader,
      openChannelLoader: (url, signal) =>
        this.openImage({
          url,
          location: zarr.root(store).resolve(image.element.path),
          transform: planarTransformFromAffine(
            scaleAffine(image.affine, micrometersPerUnit),
          ),
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
    const view = selectSpatialDataView(catalog, {
      ...(this.selection.coordinateSystem === undefined
        ? {}
        : { coordinateSystem: this.selection.coordinateSystem }),
      ...(this.selection.image === undefined ? {} : { image: this.selection.image }),
    })
    const staticUnits =
      (this.selection.micrometersPerUnit === undefined
        ? null
        : overrideSpatialDataUnits(this.selection.micrometersPerUnit)) ??
      declaredSpatialDataUnits(
        catalog.elements
          .filter((element) => element.kind !== 'tables')
          .map((element) => element.attrs),
        view.coordinateSystem,
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
              resolveCoordinates: (obs) =>
                this.resolveTableCoordinates(view, staticUnits, obs),
              describeError: (error) =>
                this.describeTableError(store, tableInfo.path, error),
              onReady: () => this.reportMissingTableChunks(store, tableInfo.path),
            },
          })

    if (table === null) {
      this.resolvedUnits = staticUnits ?? UNKNOWN_SPATIALDATA_UNITS
    }

    return { store, zarrFormat, catalog, view, table, staticUnits }
  }

  private describeTableError(
    store: SpatialDataStore,
    tablePath: string,
    error: unknown,
  ): unknown {
    const missing = missingChunksUnder(store, tablePath)

    return missing.length === 0 || error instanceof ZarrChunkUnavailableError
      ? error
      : new SpatialDataIncompleteStoreError(this.url, missing, error)
  }

  // Absent numeric chunks read as zeros; flag them so silently empty columns
  // or coordinates are visible in the log.
  private reportMissingTableChunks(store: SpatialDataStore, tablePath: string): void {
    const missing = missingChunksUnder(store, tablePath)

    if (missing.length > 0) {
      this.onProgress?.(
        `SpatialData table read missing chunks as fill values; the store may be incomplete: ${describeMissingChunks(missing)}`,
      )
    }
  }

  private async resolveTableCoordinates(
    view: SpatialDataView,
    staticUnits: SpatialDataUnits | null,
    obs: AnnDataObsAccess,
  ): Promise<readonly DataPoint[] | null> {
    const table = view.table

    if (
      table === undefined ||
      (view.regionShapes.length === 0 && view.regionLabels.length === 0)
    ) {
      // The table does not annotate an element placed in this coordinate
      // system; fall back to raw obsm coordinates.
      this.resolvedUnits = staticUnits ?? UNKNOWN_SPATIALDATA_UNITS
      return null
    }

    const [instances, regions, obsmPoints, shapesByRegion] = await Promise.all([
      table.instanceKey === undefined
        ? Promise.resolve(null)
        : obs.readObsColumn(table.instanceKey),
      table.regionKey === undefined
        ? Promise.resolve(null)
        : obs.readObsColumn(table.regionKey).catch((error: unknown) => {
            // A single-region table does not need its region column.
            if (
              table.regions.length !== 1 ||
              !(error instanceof ZarrChunkUnavailableError)
            ) {
              throw error
            }

            this.onProgress?.(
              `SpatialData table ${table.name}: region column unreadable, using ${table.regions[0] ?? ''}. ${error.message}`,
            )
            return null
          }),
      view.regionLabels.length > 0 ? obs.readObsmPoints() : Promise.resolve(null),
      this.loadRegionShapes(view.regionShapes),
    ])
    const labelValues =
      view.regionLabels.length > 0
        ? await readLabelValues(obs, instances, table.instanceKey)
        : null
    const defaultRegion = table.regions.length === 1 ? table.regions[0] : undefined
    const labelAffines = new Map(
      view.regionLabels.map((entry) => [entry.element.name, entry.affine]),
    )
    const labelRowsByRegion = new Map<string, Map<number, number>>()
    const placements: RawPlacement[] = []

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
        this.cellIdByInstanceId.set(shape.id, cellId)
        placements.push({ kind: 'shape', shape })
        return
      }

      const labelAffine = region === undefined ? undefined : labelAffines.get(region)

      if (labelAffine === undefined || region === undefined) {
        placements.push(null)
        return
      }

      const label = labelValues?.[row]

      if (label !== undefined && label !== null) {
        const rows = labelRowsByRegion.get(region) ?? new Map<number, number>()
        rows.set(label, row)
        labelRowsByRegion.set(region, rows)
      }

      const point = obsmPoints?.[row]
      placements.push(
        point === undefined
          ? null
          : { kind: 'point', ...applyAffine(labelAffine, point.x, point.y) },
      )
    })

    for (const [region, rows] of labelRowsByRegion) {
      this.labelCellIdsByRegion.set(
        region,
        new Map(
          Array.from(rows, ([label, row]) => [label, obs.cellIds[row] ?? String(row)]),
        ),
      )
    }

    const units =
      staticUnits ??
      (await this.estimateUnits({
        view,
        obs,
        placements,
        shapesByRegion,
        obsmPoints,
        labelRowsByRegion,
      })) ??
      UNKNOWN_SPATIALDATA_UNITS
    this.resolvedUnits = units
    const scale = units.micrometersPerUnit
    const coordinates: DataPoint[] = placements.map((placement, row) => {
      if (placement === null) {
        return UNPLACED_POINT
      }

      if (placement.kind === 'point') {
        return dataPoint(placement.x * scale, placement.y * scale)
      }

      const shape = scaleShape(placement.shape, scale)
      this.regionShapeByCellId.set(obs.cellIds[row] ?? String(row), shape)
      return dataPoint(shape.centroid.x, shape.centroid.y)
    })
    const placedRows = coordinates.filter((point) => Number.isFinite(point.x)).length
    this.onProgress?.(
      `SpatialData placed ${placedRows.toLocaleString()} of ${coordinates.length.toLocaleString()} table rows in ${view.coordinateSystem}`,
    )
    this.onProgress?.(`SpatialData units: ${formatSpatialDataUnits(units)}`)

    if (placedRows === 0) {
      throw new Error(
        view.regionShapes.length === 0 && obsmPoints === null
          ? `SpatialData table ${table.name} annotates labels ${table.regions.join(', ')} but has no obsm spatial coordinates to place its rows.`
          : `SpatialData table ${table.name} rows did not match any ${table.regions.join(', ')} instances in coordinate system ${view.coordinateSystem}.`,
      )
    }

    return coordinates
  }

  private async estimateUnits(context: {
    readonly view: SpatialDataView
    readonly obs: AnnDataObsAccess
    readonly placements: readonly RawPlacement[]
    readonly shapesByRegion: ReadonlyMap<string, ReadonlyMap<string, SpatialDataShape>>
    readonly obsmPoints: readonly { readonly x: number; readonly y: number }[] | null
    readonly labelRowsByRegion: ReadonlyMap<string, ReadonlyMap<number, number>>
  }): Promise<SpatialDataUnits | null> {
    const { view, obs, placements } = context

    for (const entry of view.regionShapes) {
      const shapes = Array.from(
        context.shapesByRegion.get(entry.element.name)?.values() ?? [],
      )
      const estimate = estimateUnitsFromVisiumHdBins(
        entry.element.name,
        shapes
          .slice(0, 2_000)
          .map((shape) =>
            shape.geometry.kind === 'polygon'
              ? polygonArea(shape.geometry.rings[0] ?? [])
              : Number.NaN,
          ),
      )

      if (estimate !== null) {
        return estimate
      }
    }

    const areaColumn = AREA_COLUMNS.find((name) => obs.columnNames.includes(name))
    const areas = areaColumn === undefined ? null : await obs.readObsColumn(areaColumn)

    if (areaColumn !== undefined && areas !== null) {
      const polygonPairs = placements.flatMap((placement, row) =>
        placement?.kind === 'shape' && placement.shape.geometry.kind === 'polygon'
          ? [
              {
                micrometersSquared: numericOrNaN(areas[row]),
                unitsSquared: polygonArea(placement.shape.geometry.rings[0] ?? []),
              },
            ]
          : [],
      )
      const fromPolygons = estimateUnitsFromAreas(
        polygonPairs,
        `${areaColumn} vs segmentation polygons`,
      )

      if (fromPolygons !== null) {
        return fromPolygons
      }

      for (const entry of view.regionLabels) {
        const rows = context.labelRowsByRegion.get(entry.element.name)

        if (rows === undefined || rows.size === 0 || context.obsmPoints === null) {
          continue
        }

        const pairs = await this.labelAreaPairs(entry, rows, context.obsmPoints, areas)
        const fromLabels = estimateUnitsFromAreas(
          pairs,
          `${areaColumn} vs ${entry.element.name} label pixels`,
        )

        if (fromLabels !== null) {
          return fromLabels
        }
      }
    }

    if (obs.columnNames.includes('array_row') && obs.columnNames.includes('array_col')) {
      const centers = placements.flatMap((placement) =>
        placement?.kind === 'shape' && placement.shape.geometry.kind === 'circle'
          ? [placement.shape.geometry.center]
          : [],
      )
      return estimateUnitsFromVisiumSpots(centers)
    }

    return null
  }

  // Pixel counts of labels in the chunk holding most rows, paired with the
  // rows' areas in µm². Cells cut by the chunk edge are outliers that the
  // median ignores.
  private async labelAreaPairs(
    entry: SpatialDataPlacedElement,
    rowsByLabel: ReadonlyMap<number, number>,
    obsmPoints: readonly { readonly x: number; readonly y: number }[],
    areas: readonly (string | number | null)[],
  ): Promise<
    readonly { readonly micrometersSquared: number; readonly unitsSquared: number }[]
  > {
    const reader = await this.labelsReader(entry)
    const counts = new Map<string, { col: number; row: number; count: number }>()

    for (const point of obsmPoints) {
      const chunk = reader.chunkAtElementPoint(0, point)

      if (chunk === null) {
        continue
      }

      const key = `${chunk.col.toString()}/${chunk.row.toString()}`
      const entryCount = counts.get(key) ?? { ...chunk, count: 0 }
      entryCount.count += 1
      counts.set(key, entryCount)
    }

    const busiest = Array.from(counts.values()).sort(
      (left, right) => right.count - left.count,
    )[0]

    if (busiest === undefined) {
      return []
    }

    this.onProgress?.(`SpatialData labels ${entry.element.name}: measuring cell areas`)
    const trace = await reader.trace(0, busiest.col, busiest.row)
    const pixelArea = reader.pixelArea(0)

    return Array.from(trace.labels, (label, index) => {
      const row = rowsByLabel.get(label)
      const count = trace.pixelCounts[index] ?? 0
      return {
        micrometersSquared: row === undefined ? Number.NaN : numericOrNaN(areas[row]),
        unitsSquared: count * pixelArea,
      }
    })
  }

  private async loadRegionShapes(
    regions: readonly SpatialDataPlacedElement[],
  ): Promise<ReadonlyMap<string, ReadonlyMap<string, SpatialDataShape>>> {
    const entries = await Promise.all(
      regions.map(async (entry) => {
        const shapes = await this.readElementShapes(entry, entry.affine)
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
    affine: Affine2D,
  ): Promise<readonly SpatialDataShape[]> {
    this.onProgress?.(`SpatialData shapes ${entry.element.name} loading`)
    const shapes = await this.readShapes({
      url: this.elementUrl(`${entry.element.path}/shapes.parquet`),
      affine,
      fetcher: this.fetcher,
    })
    this.onProgress?.(
      `SpatialData shapes ${entry.element.name} ready: ${shapes.length.toLocaleString()} geometries`,
    )
    return shapes
  }

  private labelsReader(
    entry: SpatialDataPlacedElement,
  ): Promise<SpatialDataLabelsReader> {
    const existing = this.labelReaders.get(entry.element.name)

    if (existing !== undefined) {
      return existing
    }

    const promise = this.state()
      .then(({ store, zarrFormat }) =>
        this.openLabels({
          store,
          zarrFormat,
          path: entry.element.path,
          attrs: entry.element.attrs,
          affine: entry.affine,
        }),
      )
      .catch((error: unknown) => {
        this.labelReaders.delete(entry.element.name)
        throw error
      })
    this.labelReaders.set(entry.element.name, promise)
    return promise
  }

  private async labelElements(
    entry: SpatialDataPlacedElement,
    bbox: BBox,
  ): Promise<readonly SpatialElement[]> {
    const cellIds = this.labelCellIdsByRegion.get(entry.element.name)

    if (cellIds === undefined || cellIds.size === 0) {
      return []
    }

    const [{ micrometersPerUnit: scale }, reader] = await Promise.all([
      this.units(),
      this.labelsReader(entry),
    ])
    const outlines = await reader.outlines(
      {
        minX: bbox.minX / scale,
        maxX: bbox.maxX / scale,
        minY: bbox.minY / scale,
        maxY: bbox.maxY / scale,
      },
      { maxPixels: LABEL_OUTLINE_MAX_PIXELS, include: (label) => cellIds.has(label) },
    )

    return outlines.flatMap((outline) => {
      const cached = this.labelElementsByRing.get(outline.ring)

      if (cached !== undefined) {
        return [cached]
      }

      const cellId = cellIds.get(outline.label)

      if (cellId === undefined) {
        return []
      }

      const ring: DataPoint[] = []

      for (let index = 0; index < outline.ring.length; index += 2) {
        ring.push(
          dataPoint(
            (outline.ring[index] ?? 0) * scale,
            (outline.ring[index + 1] ?? 0) * scale,
          ),
        )
      }

      const element: SpatialElement = {
        id: cellId,
        geometry: { kind: 'polygon', rings: [ring] },
      }
      this.labelElementsByRing.set(outline.ring, element)
      return [element]
    })
  }

  private async boundarySource(): Promise<BoundarySource | null> {
    const { view, table } = await this.state()

    if (
      table === null ||
      (view.regionShapes.length === 0 && view.regionLabels.length === 0)
    ) {
      return null
    }

    await table.overview()

    if (view.regionShapes.length === 0) {
      const entry = view.regionLabels.find(
        (candidate) =>
          (this.labelCellIdsByRegion.get(candidate.element.name)?.size ?? 0) > 0,
      )
      return entry === undefined ? null : { kind: 'labels', entry }
    }

    // Region circles (for example Xenium cell_circles) are replaced by a
    // polygon companion that shares their index when one is available.
    const regionShapes = Array.from(this.regionShapeByCellId.values())
    const regionsArePolygons =
      regionShapes.length > 0 &&
      regionShapes.every((shape) => shape.geometry.kind === 'polygon')
    const entry =
      regionsArePolygons || view.boundaryCandidates.length === 0
        ? view.regionShapes[0]
        : (view.boundaryCandidates[0] ?? view.regionShapes[0])

    return entry === undefined ? null : { kind: 'shapes', entry }
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
    const source = await this.boundarySource()

    if (source?.kind !== 'shapes') {
      return []
    }

    const boundary = source.entry
    const isRegion = view.regionShapes.some((entry) => entry.element === boundary.element)
    const { micrometersPerUnit } = await this.units()
    const shapesByCellId = isRegion
      ? this.regionShapeByCellId
      : this.companionShapesByCellId(
          await this.readElementShapes(
            boundary,
            scaleAffine(boundary.affine, micrometersPerUnit),
          ),
        )
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

          const image = view.image

          return this.units().then(({ micrometersPerUnit }) =>
            this.openImage({
              url: this.elementUrl(image.element.path),
              location: zarr.root(store).resolve(image.element.path),
              transform: planarTransformFromAffine(
                scaleAffine(image.affine, micrometersPerUnit),
              ),
            }),
          )
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

function missingChunksUnder(store: SpatialDataStore, path: string): readonly string[] {
  const prefix = `${path.replace(/^\/+|\/+$/g, '')}/`
  return store.missingChunkKeys().filter((key) => key.startsWith(prefix))
}

function scaleAffine(affine: Affine2D, scale: number): Affine2D {
  return scale === 1
    ? affine
    : composeAffine({ a: scale, b: 0, c: 0, d: 0, e: scale, f: 0 }, affine)
}

function scaleShape(shape: SpatialDataShape, scale: number): SpatialDataShape {
  if (scale === 1) {
    return shape
  }

  const point = (value: { readonly x: number; readonly y: number }) => ({
    x: value.x * scale,
    y: value.y * scale,
  })

  return {
    id: shape.id,
    centroid: point(shape.centroid),
    geometry:
      shape.geometry.kind === 'circle'
        ? {
            kind: 'circle',
            center: point(shape.geometry.center),
            radius: shape.geometry.radius * scale,
          }
        : {
            kind: 'polygon',
            rings: shape.geometry.rings.map((ring) => ring.map(point)),
          },
  }
}

// Integer label ids per table row: the instance column when it holds the
// label values (the SpatialData convention), otherwise an integer obs column
// named like `cell_labels`.
async function readLabelValues(
  obs: AnnDataObsAccess,
  instances: readonly (string | number | null)[] | null,
  instanceKey: string | undefined,
): Promise<readonly (number | null)[] | null> {
  const asLabels = (values: readonly (string | number | null)[] | null) => {
    if (values === null) {
      return null
    }

    const labels = values.map((value) =>
      typeof value === 'number' && Number.isInteger(value) ? value : null,
    )
    const present = labels.filter((value) => value !== null).length
    return present > values.length / 2 ? labels : null
  }
  const fromInstances = asLabels(instances)

  if (fromInstances !== null) {
    return fromInstances
  }

  const candidates = obs.columnNames
    .filter((name) => name !== instanceKey && LABEL_COLUMN_PATTERN.test(name))
    .sort((left, right) => left.length - right.length)

  for (const name of candidates) {
    const labels = asLabels(await obs.readObsColumn(name))

    if (labels !== null) {
      return labels
    }
  }

  return null
}

function numericOrNaN(value: string | number | null | undefined): number {
  return typeof value === 'number' ? value : Number.NaN
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
