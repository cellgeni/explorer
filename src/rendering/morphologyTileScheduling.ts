import { TIFF_COMPRESSION_LZW, TIFF_COMPRESSION_NONE } from '../codecs/tiffTile'
import type { ImagePyramidLoader } from '../data/imagePyramid'

const MAX_INITIAL_TILE_REQUESTS = 96
const MAX_HEAVY_INITIAL_TILE_REQUESTS = 18
const MAX_HEAVY_TILE_CACHE_TILES = 18
const MAX_HEAVY_CONCURRENT_TILE_REQUESTS = 1
const PREFETCH_SCREEN_MARGIN_PIXELS = 256
const LARGE_TILE_PIXEL_COUNT = 512 * 512
// The tile budgets are sized for 512-pixel tiles. Smaller tiles get
// proportionally more tiles, cache slots, and concurrent loads, up to 4x: an
// SVS slide in 240-pixel tiles with 4x pyramid steps needs 100-300 tiles to
// fill one view.
const MAX_SMALL_TILE_BUDGET_SCALE = 4

export interface TileSchedulingOptions {
  readonly baseMaxCacheTiles: number
  readonly baseMaxConcurrentRequests: number
}

export interface TileSchedulingProfile {
  readonly maxCacheTiles: number
  readonly maxConcurrentRequests: number
  readonly maxInitialTileRequests: number
  readonly prefetchScreenMarginPixels: number
}

export function tileSchedulingForLoader(
  loader: Pick<ImagePyramidLoader, 'tileDecodeOptions'> &
    Partial<Pick<ImagePyramidLoader, 'tileWidth' | 'tileHeight'>>,
  options: TileSchedulingOptions,
): TileSchedulingProfile {
  const decodeOptions = loader.tileDecodeOptions?.() ?? {}
  const tilePixelCount =
    (decodeOptions.tileWidth ?? loader.tileWidth ?? 0) *
    (decodeOptions.tileHeight ?? loader.tileHeight ?? 0)
  const isLargeRawTile =
    tilePixelCount >= LARGE_TILE_PIXEL_COUNT &&
    (decodeOptions.compression === TIFF_COMPRESSION_LZW ||
      decodeOptions.compression === TIFF_COMPRESSION_NONE)

  if (!isLargeRawTile) {
    const budgetScale =
      tilePixelCount > 0
        ? Math.min(
            MAX_SMALL_TILE_BUDGET_SCALE,
            Math.max(1, LARGE_TILE_PIXEL_COUNT / tilePixelCount),
          )
        : 1

    return {
      maxCacheTiles: Math.round(options.baseMaxCacheTiles * budgetScale),
      maxConcurrentRequests: Math.round(options.baseMaxConcurrentRequests * budgetScale),
      maxInitialTileRequests: Math.round(MAX_INITIAL_TILE_REQUESTS * budgetScale),
      prefetchScreenMarginPixels: PREFETCH_SCREEN_MARGIN_PIXELS,
    }
  }

  return {
    maxCacheTiles: Math.min(options.baseMaxCacheTiles, MAX_HEAVY_TILE_CACHE_TILES),
    maxConcurrentRequests: Math.min(
      options.baseMaxConcurrentRequests,
      MAX_HEAVY_CONCURRENT_TILE_REQUESTS,
    ),
    maxInitialTileRequests: MAX_HEAVY_INITIAL_TILE_REQUESTS,
    prefetchScreenMarginPixels: 0,
  }
}
