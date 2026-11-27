import { micrometers, type BBox } from '../../data/coords'
import type { CellOverviewPoint } from '../../data/hyparquetCells'
import type { SpatialDatasetDetection } from '../../datasets/datasetFactory'
import type { GeneExpressionBatch, Platform } from '../../datasets/spatialDataset'
import { cellAreaToRadiusMicrometers } from '../../rendering/deckLayerColors'
import { geneExpressionScores } from '../../rendering/geneExpressionRenderer'
import type { GeneExpressionScoreMode } from '../../rendering/deckLayerTypes'
import type {
  AnnotationLoader,
  DatasetOverviewLoader,
  DatasetRetainer,
  GeneExpressionLoader,
  SpatialDatasetDetector,
  SpatialDatasetLoader,
} from '../app-shell/appDependencies'
import { trueSizePointsFor } from '../app-shell/platformAdapter'
import { throwIfAborted } from '../../utils/abort'
import type { Annotation } from '../../data/annotation'

// What a collection preview reads: every cell's position once per dataset,
// and the selected genes' scores per gene selection, the classes of the
// selected annotation set, or the values of a metadata track. Datasets open through
// the same per-URL caches as the main view, so a previewed dataset opens
// faster when chosen. The panels of sections shown side by side draw the
// same data.

export interface CollectionPreviewLoaders {
  readonly detectSpatialDataset: SpatialDatasetDetector
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly loadDatasetOverview: DatasetOverviewLoader
  readonly loadGeneExpression: GeneExpressionLoader
  readonly loadAnnotations: AnnotationLoader
  // Keeps the datasets opened for a URL while a preview reads it.
  readonly retainDataset?: DatasetRetainer
  readonly fetchImpl?: typeof fetch
}

export interface PreviewBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

export interface PreviewCells {
  // Interleaved x, y, in the dataset's coordinates.
  readonly positions: Float32Array
  // Each drawn cell's ID, or '' without one.
  readonly cellIds: readonly string[]
  readonly bounds: PreviewBounds
  // For cells placed in 3D (CellOverviewPoint.z): each cell's z.
  readonly depths?: PreviewDepths
  // Each cell's radius, from its area, when any cell has one (previewRadius).
  readonly radius?: PreviewRadius
  // Points keep their physical size at every zoom, as the main view draws
  // the dataset's platform (Visium spots; AppPlatformAdapter.trueSizePoints).
  readonly trueSize?: boolean
}

// Radii in µm, as the main view sizes cells from their areas: one for every
// cell when they share it (Visium spots), else one per cell.
export type PreviewRadius = number | Float32Array

// A cell without an area: a point 10 µm across, like the smallest cell
// without one in the main view.
export const PREVIEW_CELL_RADIUS_MICROMETERS = 5

export interface PreviewDepths {
  readonly values: Float32Array
  readonly min: number
  readonly max: number
}

export interface PreviewScores {
  // Interleaved x, y of the scored cells, and each one's score.
  readonly positions: Float32Array
  readonly scores: Float32Array
  readonly maxScore: number
  // Each scored cell's z, for cells placed in 3D.
  readonly depths?: Float32Array
  // Each scored cell's radius, as PreviewCells.radius.
  readonly radius?: PreviewRadius
}

export interface PreviewClass {
  readonly id: string
  readonly label: string
  // The colour the dataset stores for the class, if any.
  readonly color?: string
  // Every cell of the class, drawn or not.
  readonly cellCount: number
}

export interface PreviewClasses {
  readonly classes: readonly PreviewClass[]
  // Each drawn cell's class, as an index into classes, or -1 for none. A
  // cell in several classes takes the first, as in the main view.
  readonly classOf: Int32Array
  // Each class's drawn cells, as indexes into the cells.
  readonly members: readonly Uint32Array[]
}

export interface PreviewValues {
  // Each drawn cell's value of the track, or NaN without one.
  readonly values: Float64Array
  // The cells with a value, and the lowest and highest of them (Infinity
  // and -Infinity without one).
  readonly count: number
  readonly min: number
  readonly max: number
}

// The metadata track cells are coloured by: the main view's, over one range
// in every section (CollectionPreviewStore.valueRange), so a colour means one
// value throughout. A section reads the track of the same ID; one without it
// draws its cells uncoloured.
export interface PreviewMetadataTrack {
  readonly id: string
  readonly label: string
  readonly min: number
  readonly max: number
}

// A track's values, as a dataset gives them.
export interface PreviewCellValue {
  readonly cellId: string
  readonly value: number
}

const shownClassOfCache = new WeakMap<
  PreviewClasses,
  { readonly key: string; readonly classOf: Int32Array }
>()

// Each drawn cell's class among those not hidden: the first class listing it
// that is shown, as the main view colours a cell, or -1. A cell in a hidden
// class and a shown one (the `All` set, overlapping labels) takes the shown
// one. With no class hidden, this is classOf itself.
export function shownClassOf(
  classes: PreviewClasses,
  hiddenIds: ReadonlySet<string>,
): Int32Array {
  const hidden = classes.classes.filter(({ id }) => hiddenIds.has(id))
  if (hidden.length === 0) return classes.classOf

  const key = hidden.map(({ id }) => id).join('\u0000')
  const cached = shownClassOfCache.get(classes)
  if (cached?.key === key) return cached.classOf

  const classOf = new Int32Array(classes.classOf.length).fill(-1)
  classes.classes.forEach(({ id }, classIndex) => {
    if (hiddenIds.has(id)) return
    for (const cell of classes.members[classIndex] ?? []) {
      if (classOf[cell] === -1) classOf[cell] = classIndex
    }
  })

  shownClassOfCache.set(classes, { key, classOf })
  return classOf
}

export interface PreviewSource {
  readonly cells: (signal?: AbortSignal) => Promise<PreviewCells>
  // Scores for every cell.
  readonly scores: (
    cells: PreviewCells,
    genes: readonly string[],
    scoreMode: GeneExpressionScoreMode,
    signal?: AbortSignal,
  ) => Promise<PreviewScores>
  // The classes of an annotation set, for the drawn cells.
  readonly classes: (
    cells: PreviewCells,
    groupId: string,
    signal?: AbortSignal,
  ) => Promise<PreviewClasses>
  // The values of a metadata track, for the drawn cells.
  readonly values: (
    cells: PreviewCells,
    trackId: string,
    signal?: AbortSignal,
  ) => Promise<PreviewValues>
}

export type PreviewUnavailable =
  | { readonly reason: 'no-cells' }
  | { readonly reason: 'too-large'; readonly byteLength: number }

// A plain .h5ad up to 64 MiB is downloaded whole; a larger one is read by
// range, at a cost that depends on its layout. A preview leaves a large one to
// be opened.
export const PREVIEW_MAX_WHOLE_FILE_BYTES = 64 * 1024 * 1024

export class PreviewUnavailableError extends Error {
  readonly unavailable: PreviewUnavailable

  constructor(unavailable: PreviewUnavailable) {
    super(previewUnavailableMessage(unavailable))
    this.name = 'PreviewUnavailableError'
    this.unavailable = unavailable
  }
}

export function previewUnavailableMessage(unavailable: PreviewUnavailable): string {
  return unavailable.reason === 'no-cells'
    ? 'No cells to preview'
    : `${formatMegabytes(unavailable.byteLength)} file, read when opened`
}

// Opens a dataset for previews. Xenium reads through the loaders the main
// view uses for it; the other platforms with cells through the dataset.
// Images and Visium HD bins have no preview. A dataset the main view has
// open is read whatever its size.
export async function openPreviewSource(
  url: string,
  loaders: CollectionPreviewLoaders,
  signal?: AbortSignal,
  options: { readonly open?: boolean } = {},
): Promise<PreviewSource> {
  const detection = await loaders.detectSpatialDataset(url, {
    ...(signal === undefined ? {} : { signal }),
  })
  throwIfAborted(signal)
  if (options.open !== true) {
    await rejectLargeWholeFile(detection, loaders.fetchImpl ?? fetch, signal)
  }

  if (detection.platform === 'image' || detection.platform === 'visium-hd') {
    throw new PreviewUnavailableError({ reason: 'no-cells' })
  }

  if (detection.platform === 'xenium') {
    return {
      cells: async (cellSignal) =>
        previewCells(
          await loaders.loadDatasetOverview(url, {
            limit: null,
            ...(cellSignal === undefined ? {} : { signal: cellSignal }),
          }),
          cellSignal,
        ),
      scores: async (cells, genes, scoreMode, scoreSignal) =>
        previewScores(
          cells,
          await loaders.loadGeneExpression(url, boundsBbox(cells.bounds), genes, {
            ...(scoreSignal === undefined ? {} : { signal: scoreSignal }),
          }),
          scoreMode,
          scoreSignal,
        ),
      classes: async (cells, groupId, classSignal) =>
        previewClasses(
          cells,
          await loaders.loadAnnotations(url, {
            groupId,
            ...(classSignal === undefined ? {} : { signal: classSignal }),
          }),
          classSignal,
        ),
      // Xenium has no metadata tracks of its own; imported ones belong to
      // the open dataset, which the main view gives (CollectionPreviewStore).
      values: async (cells, _trackId, valueSignal) =>
        previewValues(cells, [], valueSignal),
    }
  }

  const opened = await previewDataset(url, loaders)
  throwIfAborted(signal)

  if (!hasMethod(opened, 'overview') || !hasMethod(opened, 'geneExpression')) {
    throw new PreviewUnavailableError({ reason: 'no-cells' })
  }

  const hasAnnotations = hasMethod(opened, 'annotations')
  const hasTracks =
    hasMethod(opened, 'metadataTracks') && hasMethod(opened, 'metadataTrackValues')
  // Each read asks for the dataset again rather than keeping it, so a dataset
  // the cache has disposed is opened again (see datasetCache.ts).
  const dataset = () => previewDataset(url, loaders)

  return {
    cells: async (cellSignal) => {
      const opened = await dataset()
      const [overview, trueSize] = await Promise.all([
        opened.overview(),
        drawsTrueSize(opened),
      ])
      return previewCells(overview, cellSignal, trueSize)
    },
    scores: async (cells, genes, scoreMode, scoreSignal) =>
      previewScores(
        cells,
        await (
          await dataset()
        ).geneExpression(boundsBbox(cells.bounds), genes, {
          ...(scoreSignal === undefined ? {} : { signal: scoreSignal }),
        }),
        scoreMode,
        scoreSignal,
      ),
    // A dataset without annotations draws its cells without classes.
    classes: async (cells, groupId, classSignal) =>
      previewClasses(
        cells,
        hasAnnotations
          ? await (
              await dataset()
            ).annotations({
              groupId,
              ...(classSignal === undefined ? {} : { signal: classSignal }),
            })
          : [],
        classSignal,
      ),
    // A dataset without the track draws its cells without values.
    values: async (cells, trackId, valueSignal) =>
      previewValues(
        cells,
        hasTracks ? await trackValues(await dataset(), trackId, valueSignal) : [],
        valueSignal,
      ),
  }
}

// The reads a preview makes of a dataset other than Xenium; openPreviewSource
// checks they are there.
interface PreviewDataset {
  overview(): Promise<readonly CellOverviewPoint[]>
  geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: { readonly signal?: AbortSignal },
  ): Promise<GeneExpressionBatch>
  annotations(options: {
    readonly groupId?: string
    readonly signal?: AbortSignal
  }): Promise<readonly Annotation<string>[]>
  metadataTracks(): Promise<readonly { readonly id: string }[]>
  metadataTrackValues(
    trackId: string,
    options: { readonly signal?: AbortSignal },
  ): Promise<readonly PreviewCellValue[]>
  meta?(): Promise<{ readonly platform: Platform }>
}

// The track's values, or none when the dataset has no track of that ID, as
// asking for a missing one is an error.
async function trackValues(
  dataset: PreviewDataset,
  trackId: string,
  signal: AbortSignal | undefined,
): Promise<readonly PreviewCellValue[]> {
  const tracks = await dataset.metadataTracks()
  throwIfAborted(signal)
  if (!tracks.some((track) => track.id === trackId)) return []

  return dataset.metadataTrackValues(trackId, signal === undefined ? {} : { signal })
}

// Whether the main view would draw the dataset's points at their physical
// size; a dataset that does not say its platform is drawn as Xenium is.
async function drawsTrueSize(dataset: PreviewDataset): Promise<boolean> {
  const meta = await dataset.meta?.()
  return meta === undefined ? false : trueSizePointsFor(meta.platform)
}

async function previewDataset(
  url: string,
  loaders: CollectionPreviewLoaders,
): Promise<PreviewDataset> {
  return (await loaders.getSpatialDataset(url)) as unknown as PreviewDataset
}

function previewCells(
  cells: readonly CellOverviewPoint[],
  signal: AbortSignal | undefined,
  trueSize = false,
): PreviewCells {
  throwIfAborted(signal)

  if (cells.length === 0) {
    throw new PreviewUnavailableError({ reason: 'no-cells' })
  }

  // Every cell: a panel beside the main view draws them all when zoomed in.
  // The previews skip cells instead (PREVIEW_MAX_DRAWN_CELLS).
  const positions = new Float32Array(cells.length * 2)
  const cellIds = new Array<string>(cells.length)

  cells.forEach((cell, index) => {
    positions[index * 2] = cell.position.x
    positions[index * 2 + 1] = cell.position.y
    cellIds[index] = cell.cellId ?? ''
  })

  const bounds = previewBounds(positions)

  if (bounds === null) {
    throw new PreviewUnavailableError({ reason: 'no-cells' })
  }

  const depths = previewDepths(cells)
  const radius = previewRadius(cells.length, (index) => cells[index]?.cellArea)
  return {
    positions,
    cellIds,
    bounds,
    ...(depths === null ? {} : { depths }),
    ...(radius === undefined ? {} : { radius }),
    ...(trueSize ? { trueSize } : {}),
  }
}

// Each cell's radius in µm from its area, as cellAreaToRadiusMicrometers
// gives it in the main view, PREVIEW_CELL_RADIUS_MICROMETERS without one: a
// number when every cell has the same, so a Visium section stores none per
// spot; undefined when no cell has an area.
export function previewRadius(
  count: number,
  areaOf: (index: number) => number | undefined,
): PreviewRadius | undefined {
  let measured = false
  let shared = PREVIEW_CELL_RADIUS_MICROMETERS
  let radii: Float32Array | null = null

  for (let index = 0; index < count; index += 1) {
    const fromArea = cellAreaToRadiusMicrometers(areaOf(index))
    const radius = fromArea ?? PREVIEW_CELL_RADIUS_MICROMETERS
    if (fromArea !== undefined) measured = true

    if (index === 0) {
      shared = radius
    } else if (radii === null && radius !== shared) {
      radii = new Float32Array(count).fill(shared, 0, index)
    }
    if (radii !== null) radii[index] = radius
  }

  return measured ? (radii ?? shared) : undefined
}

// Every cell's z, when every cell has one and they are not all the same.
function previewDepths(cells: readonly CellOverviewPoint[]): PreviewDepths | null {
  const values = new Float32Array(cells.length)
  let min = Infinity
  let max = -Infinity

  for (let index = 0; index < cells.length; index += 1) {
    const z = cells[index]?.z
    if (z === undefined || !Number.isFinite(z)) return null

    values[index] = z
    min = Math.min(min, z)
    max = Math.max(max, z)
  }

  return max > min ? { values, min, max } : null
}

export function previewBounds(positions: Float32Array): PreviewBounds | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (let index = 0; index < positions.length; index += 2) {
    const x = positions[index] ?? Number.NaN
    const y = positions[index + 1] ?? Number.NaN
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null
}

// The bounds as a query box, a little larger so the cells on its edges, kept
// as float32, fall inside it.
function boundsBbox(bounds: PreviewBounds): BBox {
  const marginX = Math.max(Math.abs(bounds.maxX - bounds.minX) * 1e-3, 1e-3)
  const marginY = Math.max(Math.abs(bounds.maxY - bounds.minY) * 1e-3, 1e-3)

  return {
    minX: micrometers(bounds.minX - marginX),
    maxX: micrometers(bounds.maxX + marginX),
    minY: micrometers(bounds.minY - marginY),
    maxY: micrometers(bounds.maxY + marginY),
  }
}

function previewScores(
  cells: PreviewCells,
  batch: GeneExpressionBatch,
  scoreMode: GeneExpressionScoreMode,
  signal: AbortSignal | undefined,
): PreviewScores {
  throwIfAborted(signal)

  const scores = geneExpressionScores(
    batch.elements,
    batch.genes,
    scoreMode,
    batch.cellCount,
  )
  const positions = new Float32Array(batch.elements.length * 2)
  const values = new Float32Array(batch.elements.length)
  const cellDepths = cells.depths?.values
  const cellIndex = cellDepths === undefined ? null : previewCellIndex(cells)
  const depths = cellIndex === null ? null : new Float32Array(batch.elements.length)
  let maxScore = 0

  batch.elements.forEach((element, index) => {
    const score = scores[index] ?? 0
    positions[index * 2] = element.position.x
    positions[index * 2 + 1] = element.position.y
    values[index] = score
    // A stored NaN or infinity is no score, as in the main view.
    if (Number.isFinite(score)) maxScore = Math.max(maxScore, score)

    if (depths !== null) {
      const cell = cellIndex?.get(element.id)
      depths[index] = cell === undefined ? Number.NaN : (cellDepths?.[cell] ?? Number.NaN)
    }
  })

  const radius = previewRadius(
    batch.elements.length,
    (index) => batch.elements[index]?.cellArea,
  )

  return {
    positions,
    scores: values,
    maxScore,
    ...(depths === null ? {} : { depths }),
    ...(radius === undefined ? {} : { radius }),
  }
}

// Cell ID -> index in PreviewCells, built once per cells read.
const cellIndexCache = new WeakMap<PreviewCells, ReadonlyMap<string, number>>()

function previewCellIndex(cells: PreviewCells): ReadonlyMap<string, number> {
  const cached = cellIndexCache.get(cells)
  if (cached !== undefined) return cached

  const cellIndex = new Map<string, number>()
  cells.cellIds.forEach((cellId, index) => {
    if (cellId !== '') cellIndex.set(cellId, index)
  })
  cellIndexCache.set(cells, cellIndex)
  return cellIndex
}

function previewClasses(
  cells: PreviewCells,
  annotations: readonly Annotation<string>[],
  signal: AbortSignal | undefined,
): PreviewClasses {
  throwIfAborted(signal)

  const cellIndex = previewCellIndex(cells)
  const classOf = new Int32Array(cells.cellIds.length).fill(-1)
  const members = annotations.map((annotation, classIndex) => {
    const drawn: number[] = []
    for (const cellId of annotation.cellIds) {
      const index = cellIndex.get(cellId)
      if (index === undefined) continue
      drawn.push(index)
      if (classOf[index] === -1) classOf[index] = classIndex
    }
    return Uint32Array.from(drawn)
  })

  return {
    classes: annotations.map(({ id, label, color, cellIds }) => ({
      id,
      label,
      ...(color === undefined ? {} : { color }),
      cellCount: cellIds.length,
    })),
    classOf,
    members,
  }
}

// A track's values by drawn cell. A missing value (NaN, as AnnData stores
// one) or an infinite one is no value, as in the main view, and so is a cell
// the track does not list.
export function previewValues(
  cells: PreviewCells,
  values: readonly PreviewCellValue[],
  signal?: AbortSignal,
): PreviewValues {
  throwIfAborted(signal)

  const cellIndex = previewCellIndex(cells)
  const byCell = new Float64Array(cells.cellIds.length).fill(Number.NaN)

  for (const { cellId, value } of values) {
    const index = cellIndex.get(cellId)
    if (index === undefined || !Number.isFinite(value)) continue
    byCell[index] = value
  }

  let count = 0
  let min = Infinity
  let max = -Infinity

  for (const value of byCell) {
    if (Number.isNaN(value)) continue
    count += 1
    if (value < min) min = value
    if (value > max) max = value
  }

  return { values: byCell, count, min, max }
}

async function rejectLargeWholeFile(
  detection: SpatialDatasetDetection,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<void> {
  // A section is read with its file's other sections, in one read.
  if (
    detection.platform !== 'h5ad' ||
    detection.source !== undefined ||
    detection.section !== undefined
  ) {
    return
  }

  const response = await fetchImpl(detection.h5adUrl, {
    method: 'HEAD',
    ...(signal === undefined ? {} : { signal }),
  }).catch((error: unknown) => {
    if (signal?.aborted === true) throw error
    return null
  })
  const byteLength = Number(response?.headers.get('content-length') ?? Number.NaN)

  if (Number.isFinite(byteLength) && byteLength > PREVIEW_MAX_WHOLE_FILE_BYTES) {
    throw new PreviewUnavailableError({ reason: 'too-large', byteLength })
  }
}

function hasMethod(value: unknown, name: string): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[name] === 'function'
  )
}

// In MiB, the unit the 64 MiB limit is in (EXP-033).
function formatMegabytes(byteLength: number): string {
  return `${Math.round(byteLength / (1024 * 1024)).toLocaleString()} MiB`
}
