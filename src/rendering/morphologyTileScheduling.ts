import { TIFF_COMPRESSION_LZW, TIFF_COMPRESSION_NONE } from '../codecs/tiffTile'
import type { ImagePyramidLoader } from '../data/imagePyramid'

const MAX_INITIAL_TILE_REQUESTS = 96
const MAX_HEAVY_INITIAL_TILE_REQUESTS = 18
const MAX_HEAVY_TILE_CACHE_TILES = 18
const MAX_HEAVY_CONCURRENT_TILE_REQUESTS = 1
const PREFETCH_SCREEN_MARGIN_PIXELS = 256
const LARGE_TILE_PIXEL_COUNT = 512 * 512

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
    return {
      maxCacheTiles: options.baseMaxCacheTiles,
      maxConcurrentRequests: options.baseMaxConcurrentRequests,
      maxInitialTileRequests: MAX_INITIAL_TILE_REQUESTS,
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
