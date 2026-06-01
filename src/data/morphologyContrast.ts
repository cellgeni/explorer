import { decodeJpeg2000 } from '../codecs/jpeg2000'
import type { DecodedJpeg2000, Jpeg2000Pixels } from '../codecs/jpeg2000'
import type { ImagePixels, TileIndex } from './coords'

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
  fetchTileBytes(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
}

export interface ComputeChannelAutoContrastOptions {
  readonly signal?: AbortSignal
  readonly lowPercentile?: number
  readonly highPercentile?: number
  readonly maxSamples?: number
  readonly decodeTile?: (bytes: Uint8Array) => Promise<DecodedJpeg2000>
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
  const decodeTile = options.decodeTile ?? decodeJpeg2000
  const samples: number[] = []
  let pixelIndex = 0

  for (const tile of tiles) {
    throwIfAborted(options.signal)

    const bytes = await loader.fetchTileBytes(level, tile.col, tile.row, options.signal)
    const decoded = await decodeTile(bytes)
    const sourceSize = loader.tileSourceSize(level, tile.col, tile.row)
    const width = Math.min(sourceSize.width, decoded.width)
    const height = Math.min(sourceSize.height, decoded.height)

    collectTileSamples({
      height,
      pixelIndex,
      pixels: decoded.pixels,
      samples,
      sampleStride,
      sourceWidth: decoded.width,
      width,
    })
    pixelIndex += width * height
  }

  if (samples.length === 0) {
    throw new Error('Unable to auto-contrast channel because no pixels were sampled.')
  }

  samples.sort((a, b) => a - b)

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

function collectTileSamples(options: {
  readonly height: number
  readonly pixelIndex: number
  readonly pixels: Jpeg2000Pixels
  readonly samples: number[]
  readonly sampleStride: number
  readonly sourceWidth: number
  readonly width: number
}): void {
  let pixelIndex = options.pixelIndex

  for (let y = 0; y < options.height; y += 1) {
    const rowOffset = y * options.sourceWidth

    for (let x = 0; x < options.width; x += 1) {
      if (pixelIndex % options.sampleStride === 0) {
        options.samples.push(options.pixels[rowOffset + x] ?? 0)
      }

      pixelIndex += 1
    }
  }
}

function percentile(sortedValues: readonly number[], percentileValue: number): number {
  const clamped = Math.max(0, Math.min(100, percentileValue))
  const index = Math.round(((sortedValues.length - 1) * clamped) / 100)
  return sortedValues[index] ?? 0
}

function buildHistogram(
  sortedValues: readonly number[],
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
