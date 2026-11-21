import type { DecodedJpeg2000 } from '../codecs/jpeg2000'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import { TileDecodeWorkerPool, type DecodeWorkerFactory } from '../workers/tileDecodePool'
import { sampleTileBytes } from '../workers/tileSamplesCore'
import type { ImagePixels, TileIndex } from './coords'
import type { ImagePyramidTilePixels } from './imagePyramid'
import { sampleDecodedTile, type TileSamples, type TileSampling } from './tileSamples'
import { throwIfAborted } from '../utils/abort'

export interface ChannelAutoContrast {
  readonly min: number
  readonly max: number
  readonly histogram: ChannelHistogram
}

export interface ChannelHistogram {
  readonly bins: readonly number[]
  readonly maxCount: number
  readonly min: number
  readonly max: number
  readonly sampleCount: number
  // Otsu's threshold on the samples other than 0, the default for Cell
  // Query's `% above` (plan 26-D6); unset when fewer than two values remain.
  readonly threshold?: number
}

export interface AutoContrastTileLoader {
  readonly numLevels: number
  tilesForLevel(level: number): readonly TileIndex[]
  tileSourceSize(
    level: number,
    col: number,
    row: number,
  ): { readonly width: ImagePixels; readonly height: ImagePixels }
  fetchTileBytes?(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
  tileDecodeOptions?(level: number, col: number, row: number): TiffTileDecodeMetadata
  loadTilePixels?(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<ImagePyramidTilePixels>
  // Samples a tile off the main thread; null when it cannot.
  sampleTilePixels?(
    level: number,
    col: number,
    row: number,
    sampling: TileSampling,
    signal?: AbortSignal,
  ): Promise<TileSamples | null>
}

export interface ComputeChannelAutoContrastOptions {
  readonly signal?: AbortSignal
  readonly lowPercentile?: number
  readonly highPercentile?: number
  readonly maxSamples?: number
  // Decodes tile bytes on this thread instead of in a worker.
  readonly decodeTile?: (bytes: Uint8Array) => Promise<DecodedJpeg2000>
  // Starts the worker that decodes and samples tile bytes; a tile decode
  // worker by default. Where there is no Worker, tiles are decoded on this
  // thread.
  readonly workerFactory?: DecodeWorkerFactory
}

const DEFAULT_LOW_PERCENTILE = 0.5
const DEFAULT_HIGH_PERCENTILE = 99.8
const DEFAULT_MAX_SAMPLES = 250_000
const DEFAULT_HISTOGRAM_BINS = 32
// Tiles read from the smallest level, spread over it, so an image without a
// pyramid is not read whole.
const MAX_AUTO_CONTRAST_TILES = 64

export async function computeChannelAutoContrast(
  loader: AutoContrastTileLoader,
  options: ComputeChannelAutoContrastOptions = {},
): Promise<ChannelAutoContrast> {
  const level = Math.max(0, loader.numLevels - 1)
  const tiles = spreadTiles(loader.tilesForLevel(level), MAX_AUTO_CONTRAST_TILES)
  const maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_MAX_SAMPLES)
  const totalPixels = countVisiblePixels(loader, level, tiles)
  const sampleStride = Math.max(1, Math.ceil(totalPixels / maxSamples))
  const workers = new TileWorkers(options)
  const tileSamples: Float64Array[] = []
  let sampleCount = 0
  let pixelIndex = 0

  try {
    for (const tile of tiles) {
      throwIfAborted(options.signal)

      const sourceSize = loader.tileSourceSize(level, tile.col, tile.row)
      const sampled = await sampleTile(loader, level, tile, workers, options, {
        startIndex: pixelIndex,
        stride: sampleStride,
        width: sourceSize.width,
        height: sourceSize.height,
      })

      tileSamples.push(sampled.samples)
      sampleCount += sampled.samples.length
      pixelIndex += sampled.pixelCount
    }
  } catch (cause) {
    // Aborting ends the worker, which fails its request.
    throwIfAborted(options.signal)
    throw cause
  } finally {
    workers.end()
  }

  // NaN marks no-data pixels in some float images; it would sort last and
  // become the high percentile.
  const samples = joinSamples(tileSamples, sampleCount).filter(Number.isFinite)

  if (samples.length === 0) {
    throw new Error('Unable to auto-contrast channel because no pixels were sampled.')
  }

  samples.sort()

  const low = percentile(samples, options.lowPercentile ?? DEFAULT_LOW_PERCENTILE)
  const high = percentile(samples, options.highPercentile ?? DEFAULT_HIGH_PERCENTILE)
  // Whole-number data gets a whole-number window, rounded outward. Fractional
  // data, such as a float image of values below 1, keeps its percentiles.
  const wholeNumbers = samples.every(Number.isInteger)
  const min = wholeNumbers ? Math.floor(low) : low
  const max = wholeNumbers ? Math.ceil(high) : high
  const contrast = max > min ? { min, max } : { min, max: min + 1 }

  const threshold = otsuThreshold(samples)

  return {
    ...contrast,
    histogram: {
      ...buildHistogram(samples, contrast.min, contrast.max),
      ...(threshold === undefined ? {} : { threshold }),
    },
  }
}

const OTSU_BINS = 256

// Otsu's threshold on sorted samples, leaving out zeros: an image's area
// outside the scan is 0 and would otherwise be a class of its own (17% of
// the Xenium demo's DAPI). Values at or above it are the brighter class.
// Whole for whole-number samples.
export function otsuThreshold(sortedSamples: Float64Array): number | undefined {
  let first = 0

  while (first < sortedSamples.length && (sortedSamples[first] ?? 0) <= 0) {
    first += 1
  }

  const low = sortedSamples[first]
  const high = sortedSamples[sortedSamples.length - 1]

  if (low === undefined || high === undefined || !(high > low)) {
    return undefined
  }

  const width = (high - low) / OTSU_BINS
  const counts = new Float64Array(OTSU_BINS)
  const sums = new Float64Array(OTSU_BINS)
  let wholeNumbers = true

  for (let index = first; index < sortedSamples.length; index += 1) {
    const value = sortedSamples[index] ?? 0
    const bin = Math.min(OTSU_BINS - 1, Math.floor((value - low) / width))
    counts[bin] = (counts[bin] ?? 0) + 1
    sums[bin] = (sums[bin] ?? 0) + value
    wholeNumbers &&= Number.isInteger(value)
  }

  const total = sortedSamples.length - first
  const totalSum = sums.reduce((sum, value) => sum + value, 0)
  let belowCount = 0
  let belowSum = 0
  let bestSplit = -1
  let bestVariance = -1

  // The split after bin `split` with the largest between-class variance.
  for (let split = 0; split < OTSU_BINS - 1; split += 1) {
    belowCount += counts[split] ?? 0
    belowSum += sums[split] ?? 0
    const aboveCount = total - belowCount

    if (belowCount === 0 || aboveCount === 0) {
      continue
    }

    const meanDifference = belowSum / belowCount - (totalSum - belowSum) / aboveCount
    const variance = belowCount * aboveCount * meanDifference * meanDifference

    if (variance > bestVariance) {
      bestVariance = variance
      bestSplit = split
    }
  }

  if (bestSplit < 0) {
    return undefined
  }

  const edge = low + (bestSplit + 1) * width
  return wholeNumbers ? Math.ceil(edge) : Number(edge.toPrecision(4))
}

// At most `maxTiles` of `tiles`, from evenly spaced rows and evenly spaced
// within each row. Few rows keep a stripped image's reads to few bands.
export function spreadTiles(
  tiles: readonly TileIndex[],
  maxTiles: number,
): readonly TileIndex[] {
  if (tiles.length <= maxTiles) {
    return tiles
  }

  const rows = new Map<number, TileIndex[]>()

  for (const tile of tiles) {
    const row = rows.get(tile.row)

    if (row === undefined) {
      rows.set(tile.row, [tile])
    } else {
      row.push(tile)
    }
  }

  const rowKeys = [...rows.keys()].sort((left, right) => left - right)
  const rowCount = Math.min(rowKeys.length, Math.ceil(Math.sqrt(maxTiles)))
  const perRow = Math.max(1, Math.floor(maxTiles / rowCount))

  return evenlySpaced(rowKeys, rowCount).flatMap((row) =>
    evenlySpaced(rows.get(row) ?? [], perRow),
  )
}

function evenlySpaced<T>(items: readonly T[], count: number): readonly T[] {
  if (items.length <= count) {
    return items
  }

  return Array.from(
    { length: count },
    (_unused, index) => items[Math.floor(((index + 0.5) * items.length) / count)],
  ).filter((item) => item !== undefined)
}

// The tile decode worker for one auto-contrast run, started on its first tile
// bytes and ended with the run or on abort.
class TileWorkers {
  private pool: TileDecodeWorkerPool | null = null
  private readonly workerFactory: DecodeWorkerFactory | undefined
  private readonly signal: AbortSignal | undefined
  private readonly onAbort = () => {
    this.end()
  }

  constructor(options: ComputeChannelAutoContrastOptions) {
    this.workerFactory = options.workerFactory
    this.signal = options.signal
  }

  // Null where tiles are decoded on this thread.
  get(): TileDecodeWorkerPool | null {
    if (
      this.pool === null &&
      (this.workerFactory !== undefined || typeof Worker !== 'undefined')
    ) {
      this.pool = new TileDecodeWorkerPool({
        size: 1,
        ...(this.workerFactory === undefined
          ? {}
          : { workerFactory: this.workerFactory }),
      })
      this.signal?.addEventListener('abort', this.onAbort, { once: true })
    }

    return this.pool
  }

  end(): void {
    this.signal?.removeEventListener('abort', this.onAbort)
    this.pool?.terminate()
    this.pool = null
  }
}

async function sampleTile(
  loader: AutoContrastTileLoader,
  level: number,
  tile: TileIndex,
  workers: TileWorkers,
  options: ComputeChannelAutoContrastOptions,
  sampling: TileSampling,
): Promise<TileSamples> {
  const { signal } = options
  const fromLoader = await loader.sampleTilePixels?.(
    level,
    tile.col,
    tile.row,
    sampling,
    signal,
  )

  if (fromLoader !== undefined && fromLoader !== null) {
    return fromLoader
  }

  if (loader.loadTilePixels !== undefined) {
    const decoded = await loader.loadTilePixels(level, tile.col, tile.row, signal)
    return sampleDecodedTile(decoded.pixels, decoded.width, decoded.height, sampling)
  }

  if (loader.fetchTileBytes === undefined) {
    throw new Error('Unable to auto-contrast channel without readable tile pixels.')
  }

  const bytes = await loader.fetchTileBytes(level, tile.col, tile.row, signal)

  if (options.decodeTile !== undefined) {
    // A tile the file leaves out has no pixels to sample.
    const decoded =
      bytes.byteLength === 0
        ? { pixels: new Uint8Array(0), width: 0, height: 0 }
        : await options.decodeTile(bytes)
    return sampleDecodedTile(decoded.pixels, decoded.width, decoded.height, sampling)
  }

  const decodeOptions: TiffTileDecodeMetadata =
    loader.tileDecodeOptions?.(level, tile.col, tile.row) ?? {}
  const pool = bytes.byteLength === 0 ? null : workers.get()

  return pool === null
    ? sampleTileBytes(bytes, decodeOptions, sampling)
    : pool.sample(bytes, decodeOptions, sampling)
}

function countVisiblePixels(
  loader: AutoContrastTileLoader,
  level: number,
  tiles: readonly TileIndex[],
): number {
  let total = 0

  for (const tile of tiles) {
    const sourceSize = loader.tileSourceSize(level, tile.col, tile.row)
    total += sourceSize.width * sourceSize.height
  }

  return total
}

function joinSamples(tileSamples: readonly Float64Array[], length: number): Float64Array {
  if (tileSamples.length === 1 && tileSamples[0]?.length === length) {
    return tileSamples[0]
  }

  const samples = new Float64Array(length)
  let offset = 0

  for (const values of tileSamples) {
    samples.set(values, offset)
    offset += values.length
  }

  return samples
}

function percentile(sortedValues: Float64Array, percentileValue: number): number {
  const clamped = Math.max(0, Math.min(100, percentileValue))
  const index = Math.round(((sortedValues.length - 1) * clamped) / 100)
  return sortedValues[index] ?? 0
}

function buildHistogram(
  sortedValues: Float64Array,
  min: number,
  max: number,
): ChannelHistogram {
  const bins = new Array<number>(DEFAULT_HISTOGRAM_BINS).fill(0)
  // A float window can be narrower than 1.
  const range = max > min ? max - min : 1

  for (const value of sortedValues) {
    const ratio = (value - min) / range
    const bin = Math.max(
      0,
      Math.min(DEFAULT_HISTOGRAM_BINS - 1, Math.floor(ratio * DEFAULT_HISTOGRAM_BINS)),
    )

    bins[bin] = (bins[bin] ?? 0) + 1
  }

  return {
    bins,
    maxCount: Math.max(1, ...bins),
    min,
    max,
    sampleCount: sortedValues.length,
  }
}
