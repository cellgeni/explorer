import type { DecodedJpeg2000 } from '../codecs/jpeg2000'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import { TileDecodeWorkerPool, type DecodeWorkerFactory } from '../workers/tileDecodePool'
import { sampleTileBytes } from '../workers/tileSamplesCore'
import type { ImagePixels, TileIndex } from './coords'
import type { ImagePyramidTilePixels } from './imagePyramid'
import { sampleDecodedTile, type TileSamples, type TileSampling } from './tileSamples'

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

export async function computeChannelAutoContrast(
  loader: AutoContrastTileLoader,
  options: ComputeChannelAutoContrastOptions = {},
): Promise<ChannelAutoContrast> {
  const level = Math.max(0, loader.numLevels - 1)
  const tiles = loader.tilesForLevel(level)
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

  if (sampleCount === 0) {
    throw new Error('Unable to auto-contrast channel because no pixels were sampled.')
  }

  const samples = joinSamples(tileSamples, sampleCount)
  samples.sort()

  const low = percentile(samples, options.lowPercentile ?? DEFAULT_LOW_PERCENTILE)
  const high = percentile(samples, options.highPercentile ?? DEFAULT_HIGH_PERCENTILE)
  const min = Math.floor(low)
  const max = Math.ceil(high)
  const contrast = max > min ? { min, max } : { min, max: min + 1 }

  return {
    ...contrast,
    histogram: buildHistogram(samples, contrast.min, contrast.max),
  }
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
  const range = Math.max(1, max - min)

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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Auto contrast request aborted.')
  error.name = 'AbortError'
  return error
}
