import * as zarr from 'zarrita'
import {
  micrometers,
  type BBox,
  type DataPoint,
  type UnitsDescriptor,
} from '../data/coords'
import type { CellFeatureMatrixReadOptions, GexResult } from '../data/gex'
import type { RoiSelectionInput } from '../data/roiSelection'
import type {
  ContinuousCellMetadataTrack,
  ContinuousCellMetadataValue,
} from '../data/customAnnotations'
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
import type { ZippedZarrStore } from '../zarr/zarrZipStore'
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
  SHAPE_CIRCLE,
  SHAPE_POLYGON,
  shapeRing,
  type SpatialDataShapes,
  type SpatialDataShapesReader,
} from './spatialDataShapes'
import { readSpatialDataShapesInWorker } from './spatialDataShapesWorker'
import { applyAffine, composeAffine, type Affine2D } from './spatialDataTransforms'
import { SpatialDataLabelsReader } from './spatialDataLabels'
import {
  declaredSpatialDataUnits,
  estimateUnitsFromAreas,
  estimateUnitsFromVisiumHdBins,
  estimateUnitsFromVisiumSpots,
  formatSpatialDataUnits,
  overrideSpatialDataUnits,
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
  // Set for a zipped store; its Parquet files are read from the zip.
  readonly zip?: ZippedZarrStore
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
  | { readonly kind: 'shape'; readonly shapes: SpatialDataShapes; readonly index: number }
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | null

// A region element's shapes, matched to table rows by instance id.
interface RegionShapes {
  readonly shapes: SpatialDataShapes
  readonly lookup: ShapeLookup
  // Table cell id per shape, set when a row is placed on the shape.
  readonly cellIds: (string | undefined)[]
}

// Table rows placed on region shapes, kept for the boundary layer.
interface RegionRows {
  readonly cellIds: readonly string[]
  readonly placements: readonly RawPlacement[]
  // µm per coordinate-system unit.
  readonly scale: number
}

// Shapes drawn as cell boundaries, with the factor that takes their
// coordinates to µm.
interface ScaledShapes {
  readonly shapes: SpatialDataShapes
  readonly scale: number
}

// Cell outlines for the boundary layer; elements are built only for the
// cells a viewport request returns.
interface BoundaryIndex {
  readonly ids: readonly string[]
  // Cell i's outline is shape shapeIndexes[i] of sources[sourceIndexes[i]].
  readonly sources: readonly ScaledShapes[]
  readonly sourceIndexes: Uint16Array
  readonly shapeIndexes: Uint32Array
  // minX, minY, maxX, maxY per cell, in µm.
  readonly bounds: Float64Array
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
  // The fetcher passed in, so an Icechunk repository that detection opened
  // with it is reused; undefined for the global fetch.
  private readonly storeFetcher: typeof fetch | undefined
  private readonly onProgress: H5adLoadProgressReporter | undefined
  private readonly selection: SpatialDataSelection
  private readonly readShapes: SpatialDataShapesReader
  private readonly openImage: SpatialDataImageOpener
  private readonly openLabels: SpatialDataLabelsOpener
  private statePromise: Promise<SpatialDataState> | null = null
  private imagePromise: Promise<ImagePyramidLoader | null> | null = null
  private boundaryIndexPromise: Promise<BoundaryIndex> | null = null
  private readonly labelReaders = new Map<string, Promise<SpatialDataLabelsReader>>()
  // Cell elements for cached label rings, so unchanged cells keep the same
  // objects across viewport requests.
  private readonly labelElementsByRing = new WeakMap<Float64Array, SpatialElement>()
  // Shape elements of the last viewport request by boundary index cell,
  // reused by the next so cells still in view keep the same objects. Only the
  // cells in view are kept: building every outline at once costs gigabytes
  // for large segmentations.
  private shapeElements: {
    readonly index: BoundaryIndex
    readonly byCell: ReadonlyMap<number, SpatialElement>
  } | null = null
  // Filled while the table resolves row coordinates.
  private regionShapes: ReadonlyMap<string, RegionShapes> = new Map()
  private regionRows: RegionRows | null = null
  private regionShapesArePolygons = false
  private readonly labelCellIdsByRegion = new Map<string, Map<number, string>>()
  private resolvedUnits: SpatialDataUnits | null = null

  constructor(options: SpatialDataDatasetOptions) {
    this.url = options.url.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.storeFetcher = options.fetcher
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
    this.readShapes = options.readShapes ?? readSpatialDataShapesInWorker
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

    // Reading the table places its rows, which resolves the units.
    if (table !== null) {
      await table.cellIds()
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
    const { bounds } = index
    const previous =
      this.shapeElements?.index === index ? this.shapeElements.byCell : new Map()
    const byCell = new Map<number, SpatialElement>()

    for (let cell = 0; cell < index.ids.length; cell += 1) {
      const offset = cell * 4

      if (
        (bounds[offset] ?? 0) > bbox.maxX ||
        (bounds[offset + 1] ?? 0) > bbox.maxY ||
        (bounds[offset + 2] ?? 0) < bbox.minX ||
        (bounds[offset + 3] ?? 0) < bbox.minY
      ) {
        continue
      }

      byCell.set(cell, previous.get(cell) ?? boundaryElement(index, cell))
    }

    this.shapeElements = { index, byCell }
    return { elements: Array.from(byCell.values()) }
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
    options: CellFeatureMatrixReadOptions & {
      readonly limit?: number
      readonly sampleStride?: number
    } = {},
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

  async metadataTrackValues(
    trackId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly ContinuousCellMetadataValue[]> {
    const table = await this.tableOrNull()

    if (table === null) {
      throw new Error(`SpatialData metadata track ${trackId} has no table.`)
    }

    return table.metadataTrackValues(trackId, options)
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

  async geneAliases(): Promise<ReadonlyMap<string, string>> {
    return (await this.tableOrNull())?.geneAliases() ?? new Map()
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
    const { store, zarrFormat, zip } = await openSpatialDataStore(
      this.url,
      this.storeFetcher === undefined ? {} : { fetcher: this.storeFetcher },
    )
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

    return {
      store,
      zarrFormat,
      ...(zip === undefined ? {} : { zip }),
      catalog,
      view,
      table,
      staticUnits,
    }
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
      const regionShapes = region === undefined ? undefined : shapesByRegion.get(region)
      const index =
        instanceId === null || regionShapes === undefined
          ? -1
          : regionShapes.lookup.indexOf(instanceId)

      if (regionShapes !== undefined && index >= 0) {
        regionShapes.cellIds[index] = cellId
        placements.push({ kind: 'shape', shapes: regionShapes.shapes, index })
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
    const coordinates: DataPoint[] = placements.map((placement) => {
      if (placement === null) {
        return UNPLACED_POINT
      }

      if (placement.kind === 'point') {
        return dataPoint(placement.x * scale, placement.y * scale)
      }

      const { centroids } = placement.shapes
      return dataPoint(
        (centroids[placement.index * 2] ?? Number.NaN) * scale,
        (centroids[placement.index * 2 + 1] ?? Number.NaN) * scale,
      )
    })
    this.regionShapes = shapesByRegion
    this.regionRows = { cellIds: obs.cellIds, placements, scale }
    this.regionShapesArePolygons =
      placements.some((placement) => placement?.kind === 'shape') &&
      placements.every(
        (placement) =>
          placement?.kind !== 'shape' ||
          placement.shapes.kinds[placement.index] === SHAPE_POLYGON,
      )
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
    readonly shapesByRegion: ReadonlyMap<string, RegionShapes>
    readonly obsmPoints: readonly { readonly x: number; readonly y: number }[] | null
    readonly labelRowsByRegion: ReadonlyMap<string, ReadonlyMap<number, number>>
  }): Promise<SpatialDataUnits | null> {
    const { view, obs, placements } = context

    for (const entry of view.regionShapes) {
      const areas = context.shapesByRegion.get(entry.element.name)?.shapes.areas
      const estimate = estimateUnitsFromVisiumHdBins(
        entry.element.name,
        Array.from(areas?.subarray(0, 2_000) ?? []),
      )

      if (estimate !== null) {
        return estimate
      }
    }

    const areaColumn = AREA_COLUMNS.find((name) => obs.columnNames.includes(name))
    const areas = areaColumn === undefined ? null : await obs.readObsColumn(areaColumn)

    if (areaColumn !== undefined && areas !== null) {
      const polygonPairs = placements.flatMap((placement, row) =>
        placement?.kind === 'shape' &&
        placement.shapes.kinds[placement.index] === SHAPE_POLYGON
          ? [
              {
                micrometersSquared: numericOrNaN(areas[row]),
                unitsSquared: placement.shapes.areas[placement.index] ?? Number.NaN,
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
        placement?.kind === 'shape' &&
        placement.shapes.kinds[placement.index] === SHAPE_CIRCLE
          ? [
              {
                x: placement.shapes.centroids[placement.index * 2] ?? Number.NaN,
                y: placement.shapes.centroids[placement.index * 2 + 1] ?? Number.NaN,
              },
            ]
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
  ): Promise<ReadonlyMap<string, RegionShapes>> {
    const entries = await Promise.all(
      regions.map(async (entry) => {
        const shapes = await this.readElementShapes(entry, entry.affine)
        const regionShapes: RegionShapes = {
          shapes,
          lookup: new ShapeLookup(shapes.ids),
          cellIds: new Array<string | undefined>(shapes.ids.length),
        }
        return [entry.element.name, regionShapes] as const
      }),
    )

    return new Map(entries)
  }

  private async readElementShapes(
    entry: SpatialDataPlacedElement,
    affine: Affine2D,
  ): Promise<SpatialDataShapes> {
    this.onProgress?.(`SpatialData shapes ${entry.element.name} loading`)
    const path = `${entry.element.path}/shapes.parquet`
    const { zip } = await this.state()
    const file = zip?.file(path)

    if (file === null) {
      throw new Error(
        `SpatialData shapes ${entry.element.name}: ${path} is missing from the zip.`,
      )
    }

    const shapes = await this.readShapes({
      url: this.elementUrl(path),
      ...(file === undefined ? {} : { file }),
      affine,
      ...(this.storeFetcher === undefined ? {} : { fetcher: this.storeFetcher }),
    })
    this.onProgress?.(
      `SpatialData shapes ${entry.element.name} ready: ${shapes.ids.length.toLocaleString()} geometries`,
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

    // Placing the table's rows records which labels and shapes they use.
    await table.cellIds()

    if (view.regionShapes.length === 0) {
      const entry = view.regionLabels.find(
        (candidate) =>
          (this.labelCellIdsByRegion.get(candidate.element.name)?.size ?? 0) > 0,
      )
      return entry === undefined ? null : { kind: 'labels', entry }
    }

    // Region circles (for example Xenium cell_circles) are replaced by a
    // polygon companion that shares their index when one is available.
    const entry =
      this.regionShapesArePolygons || view.boundaryCandidates.length === 0
        ? view.regionShapes[0]
        : (view.boundaryCandidates[0] ?? view.regionShapes[0])

    return entry === undefined ? null : { kind: 'shapes', entry }
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

  private async readBoundaryIndex(): Promise<BoundaryIndex> {
    const { view } = await this.state()
    const source = await this.boundarySource()

    if (source?.kind !== 'shapes') {
      return boundaryIndexOf([], [], [], [])
    }

    const boundary = source.entry

    if (view.regionShapes.some((entry) => entry.element === boundary.element)) {
      return this.regionBoundaryIndex()
    }

    const { micrometersPerUnit } = await this.units()
    const companion = await this.readElementShapes(
      boundary,
      scaleAffine(boundary.affine, micrometersPerUnit),
    )

    // Fall back to region geometry when the companion does not share the
    // region index.
    return this.companionBoundaryIndex(companion) ?? this.regionBoundaryIndex()
  }

  private regionBoundaryIndex(): BoundaryIndex {
    const rows = this.regionRows
    const ids: string[] = []
    const sources: ScaledShapes[] = []
    const sourceIndexes: number[] = []
    const shapeIndexes: number[] = []

    rows?.placements.forEach((placement, row) => {
      if (placement?.kind !== 'shape') {
        return
      }

      let source = sources.findIndex((entry) => entry.shapes === placement.shapes)

      if (source < 0) {
        source = sources.length
        sources.push({ shapes: placement.shapes, scale: rows.scale })
      }

      ids.push(rows.cellIds[row] ?? String(row))
      sourceIndexes.push(source)
      shapeIndexes.push(placement.index)
    })

    return boundaryIndexOf(ids, sources, sourceIndexes, shapeIndexes)
  }

  // Companion shapes (already in µm) matched to table cells through the
  // region shapes that share their index, or null when none match.
  private companionBoundaryIndex(shapes: SpatialDataShapes): BoundaryIndex | null {
    const regions = Array.from(this.regionShapes.values())
    const ids: string[] = []
    const shapeIndexes: number[] = []

    regions.forEach((region) => {
      region.lookup.rewind()
    })
    shapes.ids.forEach((instanceId, index) => {
      for (const region of regions) {
        const cellId = region.cellIds[region.lookup.indexOf(instanceId)]

        if (cellId !== undefined) {
          ids.push(cellId)
          shapeIndexes.push(index)
          return
        }
      }
    })

    return ids.length === 0
      ? null
      : boundaryIndexOf(
          ids,
          [{ shapes, scale: 1 }],
          shapeIndexes.map(() => 0),
          shapeIndexes,
        )
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

function boundaryIndexOf(
  ids: readonly string[],
  sources: readonly ScaledShapes[],
  sourceIndexes: readonly number[],
  shapeIndexes: readonly number[],
): BoundaryIndex {
  const bounds = new Float64Array(ids.length * 4)

  shapeIndexes.forEach((shapeIndex, cell) => {
    const source = sources[sourceIndexes[cell] ?? 0]

    for (let corner = 0; corner < 4 && source !== undefined; corner += 1) {
      bounds[cell * 4 + corner] =
        (source.shapes.bounds[shapeIndex * 4 + corner] ?? 0) * source.scale
    }
  })

  return {
    ids,
    sources,
    sourceIndexes: Uint16Array.from(sourceIndexes),
    shapeIndexes: Uint32Array.from(shapeIndexes),
    bounds,
  }
}

function boundaryElement(index: BoundaryIndex, cell: number): SpatialElement {
  const source = index.sources[index.sourceIndexes[cell] ?? 0]

  return {
    id: index.ids[cell] ?? String(cell),
    geometry: {
      kind: 'polygon',
      rings: [
        source === undefined ? [] : outlinePoints(source, index.shapeIndexes[cell] ?? 0),
      ],
    },
  }
}

// A shape's outline in µm; circles become 32-segment polygons.
function outlinePoints({ shapes, scale }: ScaledShapes, index: number): DataPoint[] {
  const points: DataPoint[] = []

  if (shapes.kinds[index] === SHAPE_POLYGON) {
    const ring = shapeRing(shapes, index)

    for (let offset = 0; offset < ring.length; offset += 2) {
      points.push(dataPoint((ring[offset] ?? 0) * scale, (ring[offset + 1] ?? 0) * scale))
    }

    return points
  }

  const x = (shapes.centroids[index * 2] ?? 0) * scale
  const y = (shapes.centroids[index * 2 + 1] ?? 0) * scale
  const radius = (shapes.radii[index] ?? 0) * scale

  for (let segment = 0; segment < CIRCLE_BOUNDARY_SEGMENTS; segment += 1) {
    const angle = (2 * Math.PI * segment) / CIRCLE_BOUNDARY_SEGMENTS
    points.push(dataPoint(x + radius * Math.cos(angle), y + radius * Math.sin(angle)))
  }

  return points
}

// Finds shapes by instance id. Tables usually list rows in the order of their
// shapes, so the shape after the last one found is tried first, and the id
// index (a Map as large as the element) is built only when that misses.
class ShapeLookup {
  private next = 0
  private byId: Map<string, number> | null = null

  constructor(private readonly ids: readonly string[]) {}

  // The shape's index, or -1.
  indexOf(id: string): number {
    let index = this.ids[this.next] === id ? this.next : -1

    if (index < 0) {
      this.byId ??= indexById(this.ids)
      index = this.byId.get(id) ?? -1
    }

    if (index >= 0) {
      this.next = index + 1
    }

    return index
  }

  // Starts the next lookups from the first shape again.
  rewind(): void {
    this.next = 0
  }
}

function indexById(ids: readonly string[]): Map<string, number> {
  const byId = new Map<string, number>()
  ids.forEach((id, index) => {
    byId.set(id, index)
  })
  return byId
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
