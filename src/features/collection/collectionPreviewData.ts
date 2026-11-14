import { micrometers, type BBox } from '../../data/coords'
import type { CellOverviewPoint } from '../../data/hyparquetCells'
import type { SpatialDatasetDetection } from '../../datasets/datasetFactory'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import { geneExpressionScores } from '../../rendering/geneExpressionRenderer'
import type { GeneExpressionScoreMode } from '../../rendering/deckLayerTypes'
import type {
  DatasetOverviewLoader,
  GeneExpressionLoader,
  SpatialDatasetDetector,
  SpatialDatasetLoader,
} from '../app-shell/appDependencies'

// What a collection preview reads: every cell's position once per dataset,
// and the selected genes' scores per gene selection. Datasets open through
// the same per-URL caches as the main view, so a previewed dataset opens
// faster when chosen.

export interface CollectionPreviewLoaders {
  readonly detectSpatialDataset: SpatialDatasetDetector
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly loadDatasetOverview: DatasetOverviewLoader
  readonly loadGeneExpression: GeneExpressionLoader
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
  readonly bounds: PreviewBounds
}

export interface PreviewScores {
  // Interleaved x, y of the scored cells, and each one's score.
  readonly positions: Float32Array
  readonly scores: Float32Array
  readonly maxScore: number
}

export interface PreviewSource {
  readonly cells: (signal?: AbortSignal) => Promise<PreviewCells>
  // Scores for the cells in bounds, which is every cell for the cells' bounds.
  readonly scores: (
    bounds: PreviewBounds,
    genes: readonly string[],
    scoreMode: GeneExpressionScoreMode,
    signal?: AbortSignal,
  ) => Promise<PreviewScores>
}

export type PreviewUnavailable =
  | { readonly reason: 'no-cells' }
  | { readonly reason: 'too-large'; readonly byteLength: number }

// A plain .h5ad under the reader's 300 MiB limit is downloaded whole. A
// preview leaves a large one to be opened.
export const PREVIEW_MAX_WHOLE_FILE_BYTES = 64 * 1024 * 1024

// Beyond this many cells, every Nth is drawn: more do not change a preview.
export const PREVIEW_MAX_CELLS = 200_000

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
// Images and Visium HD bins have no preview.
export async function openPreviewSource(
  url: string,
  loaders: CollectionPreviewLoaders,
  signal?: AbortSignal,
): Promise<PreviewSource> {
  const detection = await loaders.detectSpatialDataset(url, {
    ...(signal === undefined ? {} : { signal }),
  })
  throwIfAborted(signal)
  await rejectLargeWholeFile(detection, loaders.fetchImpl ?? fetch, signal)

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
      scores: async (bounds, genes, scoreMode, scoreSignal) =>
        previewScores(
          await loaders.loadGeneExpression(url, boundsBbox(bounds), genes, {
            ...(scoreSignal === undefined ? {} : { signal: scoreSignal }),
          }),
          scoreMode,
          scoreSignal,
        ),
    }
  }

  const dataset = await loaders.getSpatialDataset(url)
  throwIfAborted(signal)

  if (!hasMethod(dataset, 'overview') || !hasMethod(dataset, 'geneExpression')) {
    throw new PreviewUnavailableError({ reason: 'no-cells' })
  }

  const readOverview = dataset.overview as () => Promise<readonly CellOverviewPoint[]>
  const readGeneExpression = dataset.geneExpression as (
    bbox: BBox,
    genes: readonly string[],
    options: { readonly signal?: AbortSignal },
  ) => Promise<GeneExpressionBatch>

  return {
    cells: async (cellSignal) =>
      previewCells(await readOverview.call(dataset), cellSignal),
    scores: async (bounds, genes, scoreMode, scoreSignal) =>
      previewScores(
        await readGeneExpression.call(dataset, boundsBbox(bounds), genes, {
          ...(scoreSignal === undefined ? {} : { signal: scoreSignal }),
        }),
        scoreMode,
        scoreSignal,
      ),
  }
}

function previewCells(
  cells: readonly CellOverviewPoint[],
  signal: AbortSignal | undefined,
): PreviewCells {
  throwIfAborted(signal)

  if (cells.length === 0) {
    throw new PreviewUnavailableError({ reason: 'no-cells' })
  }

  const stride = Math.max(1, Math.ceil(cells.length / PREVIEW_MAX_CELLS))
  const positions = new Float32Array(Math.ceil(cells.length / stride) * 2)
  let offset = 0

  for (let index = 0; index < cells.length; index += stride) {
    const cell = cells[index]
    if (cell === undefined) continue
    positions[offset] = cell.position.x
    positions[offset + 1] = cell.position.y
    offset += 2
  }

  const sampled = positions.subarray(0, offset)
  const bounds = previewBounds(sampled)

  if (bounds === null) {
    throw new PreviewUnavailableError({ reason: 'no-cells' })
  }

  return { positions: sampled, bounds }
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
  batch: GeneExpressionBatch,
  scoreMode: GeneExpressionScoreMode,
  signal: AbortSignal | undefined,
): PreviewScores {
  throwIfAborted(signal)

  const scores = geneExpressionScores(batch.elements, batch.genes, scoreMode)
  const positions = new Float32Array(batch.elements.length * 2)
  const values = new Float32Array(batch.elements.length)
  let maxScore = 0

  batch.elements.forEach((element, index) => {
    const score = scores[index] ?? 0
    positions[index * 2] = element.position.x
    positions[index * 2 + 1] = element.position.y
    values[index] = score
    maxScore = Math.max(maxScore, score)
  })

  return { positions, scores: values, maxScore }
}

async function rejectLargeWholeFile(
  detection: SpatialDatasetDetection,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (detection.platform !== 'h5ad' || detection.source !== undefined) return

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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Aborted', 'AbortError')
  }
}

function formatMegabytes(byteLength: number): string {
  return `${Math.round(byteLength / (1024 * 1024)).toLocaleString()} MB`
}
