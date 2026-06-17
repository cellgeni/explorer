import { useEffect, useMemo, useRef, useState } from 'react'
import { micrometers, scaleFromZoom, type BBox, type TileIndex } from '../data/coords'
import { normalizeLayerOpacity } from '../rendering/layerOpacity'
import {
  drawFlatImage,
  drawMorphologyTileChannels,
  morphologyViewportBbox,
  selectCenteredTiles,
} from '../rendering/morphologyCanvas'
import { tileSchedulingForLoader } from '../rendering/morphologyTileScheduling'
import { TileCache } from '../tiff/tileCache'
import type { DisplayWindow } from '../codecs/jpeg2000'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { ReadyTile, TileCacheEntry } from '../tiff/tileCache'
import type { OverviewViewState } from '../rendering/deckLayers'

const MAX_CONCURRENT_TILE_REQUESTS = 4

export interface MorphologyCanvasProps {
  readonly loader?: TiffPyramidLoader | null
  readonly channels?: readonly MorphologyCanvasChannel[]
  readonly flatImage?: FlatMorphologyCanvasImage | null
  readonly opacity?: number
  readonly viewState: OverviewViewState
  readonly onTileError?: (error: Error) => void
  readonly maxConcurrentTileRequests?: number
  readonly tileCacheMaxTiles?: number
  readonly onTileCacheEviction?: (evictedTileCount: number) => void
}

export interface MorphologyCanvasChannel {
  readonly id: string
  readonly loader: TiffPyramidLoader
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
}: MorphologyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cacheRecordsRef = useRef<Map<string, ChannelCacheRecord>>(new Map())
  const [viewport, setViewport] = useState<CssViewportSize>({
    width: 0,
    height: 0,
  })
  const [flatImageElement, setFlatImageElement] = useState<LoadedFlatImage | null>(null)
  const flatImageUrl = flatImage?.url ?? null
  const onTileErrorRef = useRef(onTileError)
  const renderChannels = useMemo(
    () => visibleMorphologyChannels(loader, channels),
    [channels, loader],
  )

  useEffect(() => {
    onTileErrorRef.current = onTileError
  }, [onTileError])

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
    const image = new Image()
    image.crossOrigin = 'anonymous'

    const ready =
      typeof image.decode === 'function'
        ? null
        : new Promise<void>((resolve, reject) => {
            image.onload = () => resolve()
            image.onerror = () =>
              reject(new Error(`Failed to load flat morphology image ${flatImageUrl}`))
          })

    image.src = flatImageUrl

    void (ready ?? image.decode())
      .then(() => {
        if (!cancelled) {
          setFlatImageElement({ image, url: flatImageUrl })
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        const loadError =
          error instanceof Error
            ? error
            : new Error(`Failed to load flat morphology image ${flatImageUrl}`)
        onTileErrorRef.current?.(loadError)
      })

    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
    }
  }, [flatImageUrl])

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
      clearCacheRecords(cacheRecordsRef.current)
      return
    }

    const bbox = morphologyViewportBbox(viewState, viewport)
    const basePerChannelConcurrency = Math.max(
      1,
      Math.floor(maxConcurrentTileRequests / renderChannels.length),
    )
    const channelRequests = renderChannels.map((channel) =>
      prepareChannelRequest({
        bbox,
        baseMaxConcurrentRequests: basePerChannelConcurrency,
        channel,
        cacheRecords: cacheRecordsRef.current,
        maxCacheTiles: tileCacheMaxTiles,
        ...(onTileCacheEviction === undefined ? {} : { onTileCacheEviction }),
        viewState,
        ...(onTileError === undefined ? {} : { onTileError }),
      }),
    )
    const activeKeys = new Set(channelRequests.map((request) => request.cacheKey))
    const abortController = new AbortController()
    let cancelled = false
    let drewCurrentRequest = false

    pruneInactiveCacheRecords(cacheRecordsRef.current, activeKeys)

    const drawReadyTiles = () => {
      if (cancelled || drewCurrentRequest) {
        return
      }

      const currentRequestIsReady = requestedTilesAreReadyToDraw(channelRequests)
      const batches = currentRequestIsReady
        ? channelTileBatches(channelRequests, bbox, { requestedLevelOnly: true })
        : channelTileBatches(channelRequests, bbox, { requestedLevelOnly: false })

      if (!currentRequestIsReady && !tileBatchesHaveTiles(batches)) {
        return
      }

      drewCurrentRequest = currentRequestIsReady
      syncCanvasBackingStore(canvas, context, viewport)
      drawMorphologyTileChannels(context, batches, viewState, viewport)
    }

    drawReadyTiles()
    void Promise.allSettled(
      channelRequests.map((request) =>
        requestTilesInPriorityOrder({
          cache: request.cache,
          level: request.level,
          loader: request.channel.loader,
          maxConcurrentRequests: request.maxConcurrentRequests,
          onTileSettled: drawReadyTiles,
          signal: abortController.signal,
          tiles: request.tiles,
        }),
      ),
    ).then(drawReadyTiles)

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [
    flatImage,
    flatImageElement,
    maxConcurrentTileRequests,
    onTileCacheEviction,
    onTileError,
    renderChannels,
    tileCacheMaxTiles,
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

interface RequestTilesOptions {
  readonly cache: TileCache
  readonly level: number
  readonly loader: TiffPyramidLoader
  readonly maxConcurrentRequests: number
  readonly onTileSettled: () => void
  readonly signal: AbortSignal
  readonly tiles: readonly TileIndex[]
}

async function requestTilesInPriorityOrder(options: RequestTilesOptions): Promise<void> {
  const queue = [...options.tiles]
  const workerCount = Math.min(options.maxConcurrentRequests, queue.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (!options.signal.aborted) {
      const tile = queue.shift()

      if (tile === undefined) {
        return
      }

      const entry = await options.cache.request(
        options.loader,
        options.level,
        tile.col,
        tile.row,
        options.signal,
      )

      if (!isAbortEntry(entry)) {
        options.onTileSettled()
      }
    }
  })

  await Promise.allSettled(workers)
}

interface ChannelCacheRecord {
  readonly cache: TileCache
  readonly maxTiles: number
}

interface ChannelRequest {
  readonly cache: TileCache
  readonly cacheKey: string
  readonly channel: MorphologyCanvasChannel
  readonly level: number
  readonly maxConcurrentRequests: number
  readonly tiles: readonly TileIndex[]
}

type ChannelTileBatch = Parameters<typeof drawMorphologyTileChannels>[1][number]

function channelTileBatches(
  requests: readonly ChannelRequest[],
  bbox: BBox,
  options: { readonly requestedLevelOnly: boolean },
): readonly ChannelTileBatch[] {
  return requests.map((request) => ({
    color: request.channel.color,
    opacity: normalizeLayerOpacity(request.channel.opacity ?? 1),
    tiles: readyTilesForChannelRequest(request, bbox, options),
  }))
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

function visibleMorphologyChannels(
  loader: TiffPyramidLoader | null | undefined,
  channels: readonly MorphologyCanvasChannel[] | undefined,
): readonly MorphologyCanvasChannel[] {
  if (channels !== undefined && channels.length > 0) {
    return channels.filter((channel) => channel.enabled)
  }

  if (loader === null || loader === undefined) {
    return []
  }

  return [
    {
      id: loader.url,
      loader,
      enabled: true,
      color: [255, 255, 255],
      opacity: 1,
    },
  ]
}

function prepareChannelRequest(options: {
  readonly baseMaxConcurrentRequests: number
  readonly bbox: BBox
  readonly channel: MorphologyCanvasChannel
  readonly cacheRecords: Map<string, ChannelCacheRecord>
  readonly maxCacheTiles: number
  readonly onTileCacheEviction?: (evictedTileCount: number) => void
  readonly onTileError?: (error: Error) => void
  readonly viewState: OverviewViewState
}): ChannelRequest {
  const level = options.channel.loader.bestLevel(2 ** options.viewState.zoom)
  const scheduling = tileSchedulingForLoader(options.channel.loader, {
    baseMaxCacheTiles: options.maxCacheTiles,
    baseMaxConcurrentRequests: options.baseMaxConcurrentRequests,
  })
  const requestBbox =
    scheduling.prefetchScreenMarginPixels <= 0
      ? options.bbox
      : expandBboxByScreenPixels(
          options.bbox,
          options.viewState.zoom,
          scheduling.prefetchScreenMarginPixels,
        )
  const cacheKey = channelCacheKey(options.channel)
  let record = options.cacheRecords.get(cacheKey)

  if (record === undefined) {
    const normalMaxTiles = Math.max(
      24,
      Math.floor(options.maxCacheTiles / Math.max(1, options.cacheRecords.size + 1)),
    )
    const maxTiles = Math.min(scheduling.maxCacheTiles, normalMaxTiles)
    record = {
      cache: new TileCache({
        maxTiles,
        color: options.channel.color,
        alphaFromIntensity: options.channel.alphaFromIntensity ?? true,
        ...(options.channel.contrast === undefined
          ? {}
          : { displayWindow: options.channel.contrast }),
        ...(options.onTileError === undefined ? {} : { onError: options.onTileError }),
        ...(options.onTileCacheEviction === undefined
          ? {}
          : { onEvict: options.onTileCacheEviction }),
      }),
      maxTiles,
    }
    options.cacheRecords.set(cacheKey, record)
  }

  return {
    cache: record.cache,
    cacheKey,
    channel: options.channel,
    level,
    maxConcurrentRequests: scheduling.maxConcurrentRequests,
    tiles: selectCenteredTiles(
      options.channel.loader.tilesForBbox(level, requestBbox),
      Math.min(scheduling.maxInitialTileRequests, record.maxTiles),
      options.bbox,
      (tile) => options.channel.loader.tileBounds(level, tile.col, tile.row),
    ),
  }
}

function channelCacheKey(channel: MorphologyCanvasChannel): string {
  const contrastKey =
    channel.contrast === undefined
      ? 'auto'
      : `${channel.contrast.lo.toString()}:${channel.contrast.hi.toString()}`
  const alphaKey = channel.alphaFromIntensity === false ? 'opaque' : 'intensity-alpha'
  return `${channel.id}:${channel.loader.url}:${contrastKey}:${alphaKey}`
}

function pruneInactiveCacheRecords(
  records: Map<string, ChannelCacheRecord>,
  activeKeys: ReadonlySet<string>,
): void {
  for (const [key, record] of records.entries()) {
    if (activeKeys.has(key)) {
      continue
    }

    record.cache.clear()
    records.delete(key)
  }
}

function clearCacheRecords(records: Map<string, ChannelCacheRecord>): void {
  for (const record of records.values()) {
    record.cache.clear()
  }

  records.clear()
}

function isAbortEntry(entry: TileCacheEntry): boolean {
  return entry.state === 'error' && entry.error.name === 'AbortError'
}

function expandBboxByScreenPixels(bbox: BBox, zoom: number, screenPixels: number): BBox {
  const margin = screenPixels / scaleFromZoom(zoom)

  return {
    minX: micrometers(Math.max(0, bbox.minX - margin)),
    maxX: micrometers(bbox.maxX + margin),
    minY: micrometers(Math.max(0, bbox.minY - margin)),
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
