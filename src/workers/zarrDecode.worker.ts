/// <reference lib="webworker" />

import type * as zarr from 'zarrita'
import { labelWindow, traceLabelEdges } from '../datasets/spatialDataLabelTrace'
import { numericPixelsToRgba } from '../zarr/omeZarrPixels'
import { chunkWindow, decodeChunk } from './zarrDecodeCore'
import type {
  ZarrChunkSource,
  ZarrDecodeRequest,
  ZarrDecodeResponse,
  ZarrRenderTileMessage,
  ZarrTraceLabelsMessage,
} from './zarrDecodeMessages'

const workerScope = self as DedicatedWorkerGlobalScope
// Decoded chunks kept per worker; requests for one chunk go to one worker.
const CHUNK_CACHE_MAX_BYTES = 128 * 1024 * 1024

interface CachedChunk {
  readonly promise: Promise<zarr.Chunk<zarr.DataType>>
  bytes: number
}

const chunks = new Map<string, CachedChunk>()
let cachedBytes = 0

workerScope.onmessage = (event: MessageEvent<ZarrDecodeRequest>) => {
  const message = event.data

  if (message.type === 'put-chunk') {
    putChunk(message.cacheKey, message.source, message.bytes)
    return
  }

  if (message.type === 'render-tile') {
    void renderTile(message)
    return
  }

  void traceLabels(message)
}

function putChunk(cacheKey: string, source: ZarrChunkSource, bytes: ArrayBuffer | null) {
  const existing = chunks.get(cacheKey)

  if (existing !== undefined) {
    cachedBytes -= existing.bytes
  }

  const entry: CachedChunk = { promise: decodeChunk(source, bytes), bytes: 0 }
  chunks.set(cacheKey, entry)
  entry.promise.then(
    (chunk) => {
      if (chunks.get(cacheKey) !== entry) {
        return
      }

      entry.bytes = (chunk.data as { readonly byteLength?: number }).byteLength ?? 0
      cachedBytes += entry.bytes
      evict()
    },
    () => {
      if (chunks.get(cacheKey) === entry) {
        chunks.delete(cacheKey)
      }
    },
  )
}

async function renderTile(message: ZarrRenderTileMessage): Promise<void> {
  const entry = chunks.get(message.cacheKey)

  if (entry === undefined) {
    respond({ type: 'miss', id: message.id })
    return
  }

  // Refresh recency.
  chunks.delete(message.cacheKey)
  chunks.set(message.cacheKey, entry)

  try {
    const chunk = await entry.promise
    const pixels = chunkWindow(chunk, message.window)
    const rgba = numericPixelsToRgba(
      pixels,
      message.window.width,
      message.window.height,
      message.render,
    )
    const bitmap = await createImageBitmap(
      new ImageData(
        new Uint8ClampedArray(rgba.rgba) as Uint8ClampedArray<ArrayBuffer>,
        message.window.width,
        message.window.height,
      ),
    )
    respond(
      {
        type: 'tile',
        id: message.id,
        bitmap,
        width: message.window.width,
        height: message.window.height,
        lo: rgba.lo,
        hi: rgba.hi,
      },
      [bitmap],
    )
  } catch (error) {
    respond({ type: 'error', id: message.id, error: errorMessage(error) })
  }
}

async function traceLabels(message: ZarrTraceLabelsMessage): Promise<void> {
  try {
    const chunk = await decodeChunk(message.source, message.bytes)
    const { window } = message
    const labels = labelWindow(
      chunk.data as unknown as ArrayLike<number | bigint>,
      chunk.stride,
      window.xAxis,
      window.yAxis,
      window.width,
      window.height,
    )
    const trace = traceLabelEdges(
      labels,
      window.width,
      window.height,
      message.levelX0,
      message.levelY0,
      message.levelWidth,
    )
    respond({ type: 'labels', id: message.id, trace }, [
      trace.labels.buffer,
      trace.edgeOffsets.buffer,
      trace.edges.buffer,
      trace.bounds.buffer,
      trace.pixelCounts.buffer,
    ])
  } catch (error) {
    respond({ type: 'error', id: message.id, error: errorMessage(error) })
  }
}

function evict(): void {
  for (const [key, entry] of chunks) {
    if (cachedBytes <= CHUNK_CACHE_MAX_BYTES || chunks.size <= 1) {
      return
    }

    if (entry.bytes === 0) {
      continue
    }

    chunks.delete(key)
    cachedBytes -= entry.bytes
  }
}

function respond(response: ZarrDecodeResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(response, transfer)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
