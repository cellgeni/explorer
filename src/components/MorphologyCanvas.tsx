import { useEffect, useMemo, useRef, useState } from 'react'
import { micrometers, scaleFromZoom, type BBox, type TileIndex } from '../data/coords'
import { normalizeLayerOpacity } from '../rendering/layerOpacity'
import {
  drawMorphologyTileChannels,
  morphologyViewportBbox,
  selectCenteredTiles,
} from '../rendering/morphologyCanvas'
import { tileSchedulingForLoader } from '../rendering/morphologyTileScheduling'
import { TileCache } from '../tiff/tileCache'
import type { DisplayWindow } from '../codecs/jpeg2000'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { TileCacheEntry } from '../tiff/tileCache'
import type { OverviewViewState } from '../rendering/deckLayers'

const MAX_CONCURRENT_TILE_REQUESTS = 4

export interface MorphologyCanvasProps {
  readonly loader?: TiffPyramidLoader | null
  readonly channels?: readonly MorphologyCanvasChannel[]
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

export function MorphologyCanvas({
  loader,
  channels,
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
  const renderChannels = useMemo(
    () => visibleMorphologyChannels(loader, channels),
    [channels, loader],
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
    const canvas = canvasRef.current

    if (canvas === null || viewport.width <= 0 || viewport.height <= 0) {
      return
    }

    const context = canvas.getContext('2d')

    if (context === null) {
      return
    }

    syncCanvasBackingStore(canvas, context, viewport)

    if (renderChannels.length === 0) {
      context.clearRect(0, 0, viewport.width, viewport.height)
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

    pruneInactiveCacheRecords(cacheRecordsRef.current, activeKeys)

    const drawReadyTiles = () => {
      if (cancelled) {
        return
      }

      syncCanvasBackingStore(canvas, context, viewport)
      drawMorphologyTileChannels(
        context,
        channelRequests.map((request) => ({
          color: request.channel.color,
          opacity: normalizeLayerOpacity(request.channel.opacity ?? 1),
          tiles: request.cache.readyTiles(bbox, request.level),
        })),
        viewState,
        viewport,
      )
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
    )

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [
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
}

interface ChannelRequest {
  readonly cache: TileCache
  readonly cacheKey: string
  readonly channel: MorphologyCanvasChannel
  readonly level: number
  readonly maxConcurrentRequests: number
  readonly tiles: readonly TileIndex[]
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
    record = {
      cache: new TileCache({
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
      }),
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
      scheduling.maxInitialTileRequests,
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
