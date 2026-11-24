import { useEffect, useMemo, useRef, useState } from 'react'
import {
  micrometers,
  scaleFromZoom,
  unplaceFrameBbox,
  type BBox,
  type TileIndex,
} from '../data/coords'
import { normalizeLayerOpacity } from '../rendering/layerOpacity'
import {
  drawFlatImage,
  drawMorphologyTileChannels,
  morphologyViewportBbox,
  selectCenteredTiles,
} from '../rendering/morphologyCanvas'
import { tileSchedulingForLoader } from '../rendering/morphologyTileScheduling'
import { MorphologyTileStore } from '../rendering/morphologyTileStore'
import { visibleMorphologyChannels } from './morphologyCanvasChannels'
import type { DisplayWindow } from '../codecs/jpeg2000'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { ImagePyramidLoader } from '../data/imagePyramid'
import type {
  MorphologyTileChannel,
  MorphologyTileChannelSpec,
} from '../rendering/morphologyTileStore'
import type { TileCache, ReadyTile } from '../tiff/tileCache'
import type { TileRequestScheduler } from '../tiff/tileRequestScheduler'
import type { OverviewViewState } from '../rendering/deckLayers'

const MAX_CONCURRENT_TILE_REQUESTS = 4

export interface MorphologyCanvasProps {
  readonly loader?: ImagePyramidLoader | null
  readonly channels?: readonly MorphologyCanvasChannel[]
  readonly flatImage?: FlatMorphologyCanvasImage | null
  readonly opacity?: number
  readonly viewState: OverviewViewState
  readonly onTileError?: (error: Error) => void
  readonly maxConcurrentTileRequests?: number
  readonly tileCacheMaxTiles?: number
  readonly onTileCacheEviction?: (evictedTileCount: number) => void
  // Tiles shared with other canvases; without one the canvas keeps its own.
  readonly tileStore?: MorphologyTileStore
  // Among canvases sharing a store, lower is read first.
  readonly tilePriority?: number
}

export interface MorphologyCanvasChannel {
  readonly id: string
  readonly loader: ImagePyramidLoader
  readonly enabled: boolean
  readonly color: readonly [number, number, number]
  readonly contrast?: DisplayWindow
  readonly alphaFromIntensity?: boolean
  readonly opacity?: number
}

export interface FlatMorphologyCanvasImage {
  readonly url: string
  readonly size?: readonly [number, number]
  readonly scaleFactor: number
  readonly micrometersPerPixel: number
}

interface LoadedFlatImage {
  readonly image: HTMLImageElement
  readonly url: string
}

function naturalImageSize(image: HTMLImageElement): readonly [number, number] | null {
  return image.naturalWidth > 0 && image.naturalHeight > 0
    ? [image.naturalWidth, image.naturalHeight]
    : null
}

export function MorphologyCanvas({
  loader,
  channels,
  flatImage = null,
  opacity = 1,
  viewState,
  onTileError,
  maxConcurrentTileRequests = MAX_CONCURRENT_TILE_REQUESTS,
  tileCacheMaxTiles = 120,
  onTileCacheEviction,
  tileStore,
  tilePriority = 0,
}: MorphologyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ownTileStore] = useState(() => new MorphologyTileStore())
  const [canvasKey] = useState(() => Symbol('morphology canvas'))
  const store = tileStore ?? ownTileStore
  const [viewport, setViewport] = useState<CssViewportSize>({
    width: 0,
    height: 0,
  })
  const [flatImageElement, setFlatImageElement] = useState<LoadedFlatImage | null>(null)
  const flatImageUrl = flatImage?.url ?? null
  const onTileErrorRef = useRef(onTileError)
  // Tile loads outlive view changes, so they redraw with the latest view.
  const drawRef = useRef<(() => void) | null>(null)
  const renderChannels = useMemo(
    () => visibleMorphologyChannels(loader, channels),
    [channels, loader],
  )

  useEffect(() => {
    onTileErrorRef.current = onTileError
  }, [onTileError])

  useEffect(
    () => () => {
      store.release(canvasKey)
    },
    [canvasKey, store],
  )

  useEffect(() => {
    const canvas = canvasRef.current

    if (canvas === null) {
      return
    }

    const updateViewport = () => {
      const rect = canvas.getBoundingClientRect()
      setViewport({
        width: rect.width || canvas.clientWidth,
        height: rect.height || canvas.clientHeight,
      })
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport)
    observer?.observe(canvas)

    return () => {
      window.removeEventListener('resize', updateViewport)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (flatImageUrl === null) {
      return
    }

    if (typeof Image === 'undefined') {
      return
    }

    let cancelled = false

    store.flatImage(flatImageUrl).then(
      (image) => {
        if (!cancelled) {
          setFlatImageElement({ image, url: flatImageUrl })
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          onTileErrorRef.current?.(error as Error)
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [flatImageUrl, store])

  useEffect(() => {
    const canvas = canvasRef.current

    if (canvas === null || viewport.width <= 0 || viewport.height <= 0) {
      return
    }

    const context = canvas.getContext('2d')

    if (context === null) {
      return
    }

    if (renderChannels.length === 0) {
      syncCanvasBackingStore(canvas, context, viewport)

      if (
        flatImage !== null &&
        flatImageElement !== null &&
        flatImageElement.url === flatImage.url
      ) {
        const imageSize = flatImage.size ?? naturalImageSize(flatImageElement.image)

        if (imageSize !== null) {
          drawFlatImage(
            context,
            {
              image: flatImageElement.image,
              micrometersPerPixel: flatImage.micrometersPerPixel,
              scaleFactor: flatImage.scaleFactor,
              size: imageSize,
            },
            viewState,
            viewport,
          )
        } else {
          context.clearRect(0, 0, viewport.width, viewport.height)
        }
      } else {
        context.clearRect(0, 0, viewport.width, viewport.height)
      }
      store.use(canvasKey, [])
      return
    }

    const bbox = morphologyViewportBbox(viewState, viewport)
    const basePerChannelConcurrency = Math.max(
      1,
      Math.floor(maxConcurrentTileRequests / renderChannels.length),
    )
    const plans = renderChannels.map((channel) =>
      planChannelRequest({
        bbox,
        baseMaxConcurrentRequests: basePerChannelConcurrency,
        channel,
        maxCacheTiles: tileCacheMaxTiles,
        ...(onTileCacheEviction === undefined ? {} : { onTileCacheEviction }),
        prefetch: store.prefetch,
        viewState,
        ...(onTileError === undefined ? {} : { onTileError }),
      }),
    )
    const held = store.use(
      canvasKey,
      plans.map((plan) => plan.spec),
    )
    const channelRequests = plans.map((plan, index) =>
      channelRequest(plan, held[index] as MorphologyTileChannel),
    )
    let cancelled = false
    let drewCurrentRequest = false

    const drawReadyTiles = () => {
      if (cancelled || drewCurrentRequest) {
        return
      }

      const currentRequestIsReady = requestedTilesAreReadyToDraw(channelRequests)
      const batches = currentRequestIsReady
        ? channelTileBatches(channelRequests, { requestedLevelOnly: true })
        : channelTileBatches(channelRequests, { requestedLevelOnly: false })

      if (!currentRequestIsReady && !tileBatchesHaveTiles(batches)) {
        return
      }

      // A tile that failed and will be read again draws when it comes.
      drewCurrentRequest =
        currentRequestIsReady && !requestedTilesWillRetry(channelRequests)
      syncCanvasBackingStore(canvas, context, viewport)
      drawMorphologyTileChannels(context, batches, viewState, viewport)
    }

    drawRef.current = drawReadyTiles
    drawReadyTiles()

    for (const request of channelRequests) {
      request.scheduler.update({
        loader: request.channel.loader,
        level: request.level,
        tiles: request.tiles,
        maxConcurrentRequests: request.maxConcurrentRequests,
        onSettled: () => {
          drawRef.current?.()
        },
        client: canvasKey,
        priority: tilePriority,
      })
    }

    return () => {
      cancelled = true
    }
  }, [
    canvasKey,
    flatImage,
    flatImageElement,
    maxConcurrentTileRequests,
    onTileCacheEviction,
    onTileError,
    renderChannels,
    store,
    tileCacheMaxTiles,
    tilePriority,
    viewState,
    viewport,
  ])

  return (
    <canvas
      ref={canvasRef}
      className="morphology-canvas"
      style={{ opacity: normalizeLayerOpacity(opacity) }}
      aria-hidden="true"
    />
  )
}

interface ChannelRequest {
  readonly cache: TileCache
  readonly scheduler: TileRequestScheduler<ImagePyramidLoader>
  readonly channel: MorphologyCanvasChannel
  // The viewport in the loader's frame.
  readonly bbox: BBox
  readonly level: number
  readonly maxConcurrentRequests: number
  readonly tiles: readonly TileIndex[]
}

type ChannelTileBatch = Parameters<typeof drawMorphologyTileChannels>[1][number]

function channelTileBatches(
  requests: readonly ChannelRequest[],
  options: { readonly requestedLevelOnly: boolean },
): readonly ChannelTileBatch[] {
  return requests.map((request) => {
    const { placement } = request.channel.loader

    return {
      color: request.channel.color,
      opacity: normalizeLayerOpacity(request.channel.opacity ?? 1),
      tiles: readyTilesForChannelRequest(request, request.bbox, options),
      ...(placement === undefined ? {} : { placement }),
    }
  })
}

function tileBatchesHaveTiles(batches: readonly ChannelTileBatch[]): boolean {
  return batches.some((batch) => batch.tiles.length > 0)
}

function readyTilesForChannelRequest(
  request: ChannelRequest,
  bbox: BBox,
  options: { readonly requestedLevelOnly: boolean },
): readonly ReadyTile[] {
  if (options.requestedLevelOnly) {
    return request.cache.readyTiles(bbox, request.level)
  }

  const readyTiles = request.cache.readyTiles(bbox)
  const fallbackLevel = fallbackTileLevel(readyTiles, request.level)

  if (fallbackLevel === null) {
    return []
  }

  return readyTiles.filter((tile) => tile.level === fallbackLevel)
}

function fallbackTileLevel(
  readyTiles: readonly ReadyTile[],
  requestedLevel: number,
): number | null {
  let fallbackLevel: number | null = null
  let fallbackDistance = Number.POSITIVE_INFINITY

  for (const tile of readyTiles) {
    const distance = Math.abs(tile.level - requestedLevel)

    if (
      fallbackLevel === null ||
      distance < fallbackDistance ||
      (distance === fallbackDistance && tile.level > fallbackLevel)
    ) {
      fallbackLevel = tile.level
      fallbackDistance = distance
    }
  }

  return fallbackLevel
}

function requestedTilesAreReadyToDraw(requests: readonly ChannelRequest[]): boolean {
  for (const request of requests) {
    for (const tile of request.tiles) {
      const entry = request.cache.get(request.level, tile.col, tile.row)

      if (entry === undefined || entry.state === 'loading') {
        return false
      }
    }
  }

  return true
}

function requestedTilesWillRetry(requests: readonly ChannelRequest[]): boolean {
  return requests.some((request) =>
    request.tiles.some((tile) => {
      const entry = request.cache.get(request.level, tile.col, tile.row)
      return entry?.state === 'error' && entry.retryAt !== undefined
    }),
  )
}

interface ChannelRequestPlan {
  readonly spec: MorphologyTileChannelSpec
  readonly channel: MorphologyCanvasChannel
  // The viewport in the loader's frame.
  readonly bbox: BBox
  readonly requestBbox: BBox
  readonly level: number
  readonly maxConcurrentRequests: number
  readonly maxInitialTileRequests: number
}

function planChannelRequest(options: {
  readonly baseMaxConcurrentRequests: number
  readonly bbox: BBox
  readonly channel: MorphologyCanvasChannel
  readonly maxCacheTiles: number
  readonly onTileCacheEviction?: (evictedTileCount: number) => void
  readonly onTileError?: (error: Error) => void
  readonly prefetch: boolean
  readonly viewState: OverviewViewState
}): ChannelRequestPlan {
  const { loader } = options.channel
  const level = loader.bestLevel(2 ** options.viewState.zoom)
  const scheduling = tileSchedulingForLoader(loader, {
    baseMaxCacheTiles: options.maxCacheTiles,
    baseMaxConcurrentRequests: options.baseMaxConcurrentRequests,
  })
  // Tiles are selected and cached in the loader's frame.
  const bbox =
    loader.placement === undefined
      ? options.bbox
      : unplaceFrameBbox(loader.placement, options.bbox)
  const requestBbox =
    !options.prefetch || scheduling.prefetchScreenMarginPixels <= 0
      ? bbox
      : expandBboxByScreenPixels(
          bbox,
          options.viewState.zoom,
          scheduling.prefetchScreenMarginPixels,
        )

  return {
    spec: {
      key: channelCacheKey(options.channel),
      cacheOptions: (heldChannels) => {
        const normalMaxTiles = Math.max(
          24,
          Math.floor(scheduling.maxCacheTiles / Math.max(1, heldChannels + 1)),
        )

        return {
          maxTiles: Math.min(scheduling.maxCacheTiles, normalMaxTiles),
          color: options.channel.color,
          alphaFromIntensity: options.channel.alphaFromIntensity ?? true,
          ...(options.channel.contrast === undefined
            ? {}
            : { displayWindow: options.channel.contrast }),
          ...(options.onTileError === undefined ? {} : { onError: options.onTileError }),
          ...(options.onTileCacheEviction === undefined
            ? {}
            : { onEvict: options.onTileCacheEviction }),
        }
      },
    },
    channel: options.channel,
    bbox,
    requestBbox,
    level,
    maxConcurrentRequests: scheduling.maxConcurrentRequests,
    maxInitialTileRequests: scheduling.maxInitialTileRequests,
  }
}

function channelRequest(
  plan: ChannelRequestPlan,
  held: MorphologyTileChannel,
): ChannelRequest {
  const { loader } = plan.channel
  const { level } = plan

  return {
    cache: held.cache,
    scheduler: held.scheduler,
    channel: plan.channel,
    bbox: plan.bbox,
    level,
    maxConcurrentRequests: plan.maxConcurrentRequests,
    tiles: selectCenteredTiles(
      loader.tilesForBbox(level, plan.requestBbox),
      Math.min(plan.maxInitialTileRequests, held.maxTiles),
      plan.bbox,
      (tile) => loader.tileBounds(level, tile.col, tile.row),
    ),
  }
}

// Tiles are decoded in the channel's colour and contrast, so a cache holds
// one of each: a new colour, like a new window, needs a cache of its own.
function channelCacheKey(channel: MorphologyCanvasChannel): string {
  const contrastKey =
    channel.contrast === undefined
      ? 'auto'
      : `${channel.contrast.lo.toString()}:${channel.contrast.hi.toString()}`
  const alphaKey = channel.alphaFromIntensity === false ? 'opaque' : 'intensity-alpha'
  return `${channel.id}:${channel.loader.url}:${contrastKey}:${channel.color.join(',')}:${alphaKey}`
}

// Not clamped to x, y >= 0: an image can sit at a negative origin (MERSCOPE
// mosaics, SpatialData translations), and tilesForBbox clips to the image.
function expandBboxByScreenPixels(bbox: BBox, zoom: number, screenPixels: number): BBox {
  const margin = screenPixels / scaleFromZoom(zoom)

  return {
    minX: micrometers(bbox.minX - margin),
    maxX: micrometers(bbox.maxX + margin),
    minY: micrometers(bbox.minY - margin),
    maxY: micrometers(bbox.maxY + margin),
  }
}

function syncCanvasBackingStore(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  viewport: CssViewportSize,
): void {
  const pixelRatio = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(viewport.width * pixelRatio))
  const height = Math.max(1, Math.round(viewport.height * pixelRatio))

  if (canvas.width !== width) {
    canvas.width = width
  }

  if (canvas.height !== height) {
    canvas.height = height
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
}
